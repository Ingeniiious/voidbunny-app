import { useRef, useCallback, useEffect, useMemo, useState, forwardRef, useImperativeHandle } from 'react';
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, rectSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Terminal as TerminalIcon } from 'lucide-react';
import TerminalTab, { type TerminalTabHandle } from './TerminalTab';
import BrowserTab from './BrowserTab';
import BraveLogo from './BraveLogo';
import CliLogo from './CliLogo';
import KeyBar from './KeyBar';
import { GripIcon } from './GridViewIcons';
import type { WorkingCli } from './TabLabel';
import type { CliKind } from '../lib/api';
import { shellQuote } from '../lib/shell';
import { useMobileDropTarget, mergeRefs } from '../lib/mobileDrag';

// Mirrors the MIME the FileTree sets on dragstart. Filtering by this type
// means an OS-file drag (the browser sets `Files`) doesn't trip the drop
// highlight or paste anything — only in-app tree drags do.
const PATH_MIME = 'application/x-voidbunny-path';

function hasPathPayload(dt: DataTransfer): boolean {
  // `types` is a DOMStringList; some browsers also report it as a regular
  // array. Cast through unknown to keep TS happy across both.
  const types = Array.from(dt.types as unknown as ArrayLike<string>);
  return types.includes(PATH_MIME);
}

export interface Session {
  id: string;
  name: string;
  cwd?: string | null;
  kind?: 'terminal' | 'browser';
  mode?: 'desktop' | 'mobile';
  // Detected by the backend's /api/sessions process-tree scan. Drives the
  // tab's logo + colour the instant a session loads, before the in-browser
  // buffer scanner has had a chance to fire.
  cli?: CliKind | null;
}

export interface TerminalManagerHandle {
  send: (seq: string) => void;
}

interface Props {
  sessions: Session[];
  activeId: string;
  // When true, render every session simultaneously in a row-bucketed flex
  // grid instead of stacking and showing only `activeId`.
  gridMode?: boolean;
  // In grid mode, clicking a cell promotes that session to `activeId` so the
  // KeyBar (and the existing single-source-of-focus model) follows.
  onSelectSession?: (id: string) => void;
  onOpenUrl?: (url: string) => void;
  onWorkingChange?: (sessionId: string, working: boolean, cli?: WorkingCli) => void;
  onAttentionChange?: (sessionId: string, attention: boolean) => void;
  // Drag-reorder hook for grid mode. Called with the dragged session's id and
  // the id of the drop target (the cell whose slot it should take).
  onReorderSessions?: (fromId: string, toId: string) => void;
}

// Min effective cell width before we collapse a column. Mirrors the old
// `minmax(360px, 1fr)` value the auto-fit grid used.
const MIN_CELL_PX = 360;
// Min height per row when the container is too short to give every row a
// full share. Matches the old `gridAutoRows: minmax(240px, 1fr)` floor.
const MIN_ROW_PX = 240;

const TerminalManager = forwardRef<TerminalManagerHandle, Props>(function TerminalManager(
  { sessions, activeId, gridMode, onSelectSession, onOpenUrl, onWorkingChange, onAttentionChange, onReorderSessions },
  ref,
) {
  const tabRefs = useRef<Record<string, TerminalTabHandle | null>>({});

  const sendToActive = useCallback((seq: string) => {
    tabRefs.current[activeId]?.send(seq);
  }, [activeId]);

  useImperativeHandle(ref, () => ({ send: sendToActive }), [sendToActive]);

  // KeyBar only makes sense over a terminal — hide it when a browser tab is active.
  const activeSession = sessions.find((s) => s.id === activeId);
  const showKeyBar = !activeSession || activeSession.kind !== 'browser';

  // File-tree → terminal drop. Promotes the targeted cell to active if it
  // isn't already (so the visual focus follows the drop), then writes the
  // shell-quoted path into the PTY — same code path as a clipboard paste.
  // Browser cells reject the drop since they're not PTYs.
  const handlePathDrop = useCallback((sessionId: string, path: string) => {
    const target = sessions.find((s) => s.id === sessionId);
    if (!target || target.kind === 'browser') return;
    if (sessionId !== activeId) onSelectSession?.(sessionId);
    // Leading space so the path doesn't smash up against any text the user
    // had already typed (e.g. "summarize<DROP>" → "summarize '/path/to/x'").
    tabRefs.current[sessionId]?.send(' ' + shellQuote(path));
  }, [sessions, activeId, onSelectSession]);

  const renderSession = (s: Session, active: boolean) =>
    s.kind === 'browser' ? (
      <BrowserTab key={s.id} browserId={s.id} active={active} mode={s.mode ?? 'desktop'} />
    ) : (
      <TerminalTab
        key={s.id}
        ref={(el) => { tabRefs.current[s.id] = el; }}
        sessionId={s.id}
        active={active}
        onOpenUrl={onOpenUrl}
        onWorkingChange={onWorkingChange ? (w, cli) => onWorkingChange(s.id, w, cli) : undefined}
        onAttentionChange={onAttentionChange ? (a) => onAttentionChange(s.id, a) : undefined}
      />
    );

  return (
    <div className="w-full h-full flex flex-col">
      {gridMode ? (
        <GridView
          sessions={sessions}
          activeId={activeId}
          onSelectSession={onSelectSession}
          onReorderSessions={onReorderSessions}
          onPathDrop={handlePathDrop}
          renderSession={renderSession}
        />
      ) : (
        // Stacked mode: only one terminal is visible at a time, so the whole
        // content area is a drop target for the active session. We still
        // suppress the drop when the active session is a browser tab (browser
        // tabs don't accept path injection).
        <StackedDropArea
          activeSession={activeSession}
          onPathDrop={handlePathDrop}
        >
          {sessions.map((s) => renderSession(s, s.id === activeId))}
        </StackedDropArea>
      )}
      {showKeyBar && <KeyBar onSend={sendToActive} activeCwd={activeSession?.cwd ?? null} />}
    </div>
  );
});

interface GridViewProps {
  sessions: Session[];
  activeId: string;
  onSelectSession?: (id: string) => void;
  onReorderSessions?: (fromId: string, toId: string) => void;
  onPathDrop?: (sessionId: string, path: string) => void;
  renderSession: (s: Session, active: boolean) => React.ReactNode;
}

function GridView({ sessions, activeId, onSelectSession, onReorderSessions, onPathDrop, renderSession }: GridViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // Track container width so we can clamp columns when the panel is too
  // narrow to give every column ≥ MIN_CELL_PX. ResizeObserver is the right
  // tool here — window resize alone misses sidebar-open transitions etc.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Bucket sessions into rows of `cols`. cols = min(maxColsByWidth, ceil(√N))
  // — square-ish layouts (2×2 for 4, 3×3 for 9, 3+2 for 5, etc.) with a hard
  // ceiling so cells never go below MIN_CELL_PX.
  const rows = useMemo(() => {
    const n = sessions.length;
    if (!n) return [] as Session[][];
    const maxCols = containerWidth > 0
      ? Math.max(1, Math.floor(containerWidth / MIN_CELL_PX))
      : Math.ceil(Math.sqrt(n));
    const cols = Math.max(1, Math.min(maxCols, Math.ceil(Math.sqrt(n))));
    const out: Session[][] = [];
    for (let i = 0; i < n; i += cols) out.push(sessions.slice(i, i + cols));
    return out;
  }, [sessions, containerWidth]);

  // distance:6 means a click on the grip stays a click until the pointer
  // moves 6px — preserves tap-to-promote-active on the cell body. Touch
  // sensor gets a small delay so vertical scroll doesn't accidentally drag.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
  );

  const handleDragEnd = useCallback((e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    onReorderSessions?.(String(active.id), String(over.id));
  }, [onReorderSessions]);

  const ids = useMemo(() => sessions.map((s) => s.id), [sessions]);

  return (
    <div ref={containerRef} className="flex-1 min-h-0 overflow-y-auto p-1.5">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ids} strategy={rectSortingStrategy}>
          <div className="flex flex-col gap-1.5 h-full">
            {rows.map((row, rowIdx) => (
              <div
                key={rowIdx}
                className="flex gap-1.5 flex-1 min-h-0"
                style={{ minHeight: MIN_ROW_PX }}
              >
                {row.map((s) => (
                  <SortableCell
                    key={s.id}
                    session={s}
                    active={s.id === activeId}
                    onSelect={onSelectSession}
                    onPathDrop={onPathDrop}
                  >
                    {renderSession(s, true)}
                  </SortableCell>
                ))}
              </div>
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

interface SortableCellProps {
  session: Session;
  active: boolean;
  onSelect?: (id: string) => void;
  onPathDrop?: (sessionId: string, path: string) => void;
  children: React.ReactNode;
}

function SortableCell({ session, active, onSelect, onPathDrop, children }: SortableCellProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: session.id });
  // Path-drop highlight. Set true while a valid (in-app) tree drag is over
  // this cell; cleared on leave / drop. Browser cells never accept drops, so
  // they never set this flag.
  const [isDropTarget, setIsDropTarget] = useState(false);
  const acceptsDrop = session.kind !== 'browser';
  // Mobile touch-drag drop target. Mirrors the native HTML5 handlers below
  // for fingers. `isHovered` from the hook drives the same orange overlay
  // the desktop path uses, so there's a single visual state to reason about.
  const { ref: mobileDropRef, isHovered: mobileHover } = useMobileDropTarget({
    accepts: 'path',
    onDrop: (path) => onPathDrop?.(session.id, path),
    disabled: !acceptsDrop,
  });
  const showDropOverlay = isDropTarget || mobileHover;

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : undefined,
    opacity: isDragging ? 0.85 : 1,
  };

  // Icon for the title bar: Brave for browser cells, the CLI mark when we
  // know which agent is running, otherwise a generic terminal glyph.
  const icon = session.kind === 'browser'
    ? <BraveLogo className="w-3.5 h-3.5 flex-shrink-0" />
    : session.cli
      ? <CliLogo cli={session.cli as WorkingCli} />
      : <TerminalIcon className="w-3.5 h-3.5 flex-shrink-0" />;

  return (
    <div
      ref={mergeRefs<HTMLDivElement>(setNodeRef, mobileDropRef)}
      style={style}
      // mouseDown (not click) so React state lands BEFORE xterm's own
      // mousedown handler focuses the cell's hidden textarea — keeps the
      // KeyBar's `sendToActive` lookup aligned with the visual focus.
      onMouseDown={() => onSelect?.(session.id)}
      onTouchStart={() => onSelect?.(session.id)}
      onDragOver={acceptsDrop ? (e) => {
        if (!hasPathPayload(e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        if (!isDropTarget) setIsDropTarget(true);
      } : undefined}
      onDragLeave={acceptsDrop ? (e) => {
        // Filter spurious leaves fired while crossing internal children. Only
        // clear when the pointer actually exits the cell's bounds.
        const next = e.relatedTarget as Node | null;
        if (next && e.currentTarget.contains(next)) return;
        setIsDropTarget(false);
      } : undefined}
      onDrop={acceptsDrop ? (e) => {
        if (!hasPathPayload(e.dataTransfer)) return;
        e.preventDefault();
        setIsDropTarget(false);
        const path = e.dataTransfer.getData(PATH_MIME);
        if (path) onPathDrop?.(session.id, path);
      } : undefined}
      className={`group relative flex-1 flex flex-col min-w-0 min-h-0 rounded-md overflow-hidden border transition-colors ${
        active
          ? 'border-orange-500 ring-2 ring-orange-500/50'
          : 'border-panel-border hover:border-panel-muted'
      }`}
    >
      {/* Title bar — names the cell so the user can tell at a glance which
          tab is which. Without this, grid mode just shows N near-identical
          terminal frames. Active cell picks up the brand accent on the
          name; inactive cells stay muted so the focused one reads first. */}
      <div
        className={`flex items-center justify-between gap-2 px-2 h-7 border-b text-xs font-mono flex-shrink-0 ${
          active
            ? 'bg-panel-surface border-orange-500/40 text-panel-text'
            : 'bg-panel-surface/70 border-panel-border text-panel-muted'
        }`}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {icon}
          <span className="truncate" title={session.name}>{session.name}</span>
        </div>
        {/* Drag handle. Sits in the title bar (replacing the old floating
            corner button) so it no longer overlaps terminal content. dnd-kit
            listeners live on the handle, not the cell — clicks inside the
            terminal still focus xterm normally. Brand-orange on hover and
            when the cell is active to pick up the selected accent colour. */}
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Drag ${session.name}`}
          title="Drag to reorder"
          className={`flex items-center justify-center w-5 h-5 rounded cursor-grab active:cursor-grabbing touch-none transition-colors hover:text-orange-500 ${
            active ? 'text-orange-500' : 'text-panel-muted'
          }`}
          // Stop the mousedown from bubbling so cell-promote-to-active doesn't
          // fire mid-drag (which would steal focus and disorient the user).
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
        >
          <GripIcon size={12} />
        </button>
      </div>
      {/* Content frame. TerminalTab / BrowserTab paint themselves via
          `absolute inset-0`, so they need a positioned, sized parent — this
          wrapper gives them one below the title bar. */}
      <div className="relative flex-1 min-h-0">
        {children}
        {showDropOverlay && <PathDropOverlay />}
      </div>
    </div>
  );
}

interface StackedDropAreaProps {
  activeSession: Session | undefined;
  onPathDrop: (sessionId: string, path: string) => void;
  children: React.ReactNode;
}

// Stacked-mode drop wrapper. Only one terminal is visible (the active one),
// so the whole content area is a single drop target that always routes to
// `activeSession.id`. Mirrors SortableCell's drop logic without the
// per-cell promotion (there's nothing to promote — only one cell is shown).
function StackedDropArea({ activeSession, onPathDrop, children }: StackedDropAreaProps) {
  const [isDropTarget, setIsDropTarget] = useState(false);
  const accepts = !!activeSession && activeSession.kind !== 'browser';
  // Mobile touch-drag — routes to the active session. Same accepts gating
  // as the HTML5 path so browser tabs reject mobile drops too.
  const { ref: mobileDropRef, isHovered: mobileHover } = useMobileDropTarget({
    accepts: 'path',
    onDrop: (path) => { if (activeSession) onPathDrop(activeSession.id, path); },
    disabled: !accepts,
  });
  const showDropOverlay = isDropTarget || mobileHover;

  return (
    <div
      ref={mobileDropRef}
      className="relative flex-1 min-h-0"
      onDragOver={accepts ? (e) => {
        if (!hasPathPayload(e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        if (!isDropTarget) setIsDropTarget(true);
      } : undefined}
      onDragLeave={accepts ? (e) => {
        const next = e.relatedTarget as Node | null;
        if (next && e.currentTarget.contains(next)) return;
        setIsDropTarget(false);
      } : undefined}
      onDrop={accepts && activeSession ? (e) => {
        if (!hasPathPayload(e.dataTransfer)) return;
        e.preventDefault();
        setIsDropTarget(false);
        const path = e.dataTransfer.getData(PATH_MIME);
        if (path) onPathDrop(activeSession.id, path);
      } : undefined}
    >
      {children}
      {showDropOverlay && <PathDropOverlay />}
    </div>
  );
}

// Brand-orange dashed inset ring + small "Drop path" pill. Painted over the
// terminal content while a tree drag is hovering — gives the user a clear
// "yes, I'll catch this" signal without redrawing the terminal itself.
function PathDropOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-start justify-center">
      <div className="absolute inset-1 rounded-md border-2 border-dashed border-orange-500/80 bg-orange-500/5" />
      <div className="relative mt-3 rounded-full bg-orange-500/95 px-3 py-1 text-[11px] font-mono text-white shadow-lg">
        Drop path
      </div>
    </div>
  );
}

export default TerminalManager;
