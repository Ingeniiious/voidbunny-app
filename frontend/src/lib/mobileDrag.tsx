import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

// Touch-driven drag-and-drop. Mirrors the desktop HTML5 dragstart/drop flow
// for fingers, because mobile browsers don't translate touch into native
// drag events. Source rows arm a long-press; the timer firing transitions
// us into "dragging" — a portal-rendered ghost follows the finger, drop
// targets self-highlight via elementFromPoint hit-testing, and on release
// the matched target's onDrop fires. Designed to live alongside the
// existing native drag-drop, not replace it: the same row stays
// `draggable` for mouse users and additively gets touch handlers.

const LONG_PRESS_MS = 500;
const TAP_THRESHOLD = 8;

interface Registered {
  accepts: string;
  onDrop: (payload: string) => void;
  setHovered: (hovered: boolean) => void;
}

interface DragState {
  payload: string;
  accepts: string;
  x: number;
  y: number;
  label: string;
}

interface CtxValue {
  registerTarget: (id: string, target: Registered) => () => void;
  beginDrag: (info: { payload: string; accepts: string; x: number; y: number; label: string }) => void;
  updateDrag: (x: number, y: number) => void;
  endDrag: () => void;
  cancelDrag: () => void;
  isDragging: boolean;
  draggingAccepts: string | null;
}

const Ctx = createContext<CtxValue | null>(null);

interface ProviderProps {
  children: ReactNode;
  onDragStart?: (payload: string) => void;
  onDragEnd?: () => void;
}

export function MobileDragProvider({ children, onDragStart, onDragEnd }: ProviderProps) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const targetsRef = useRef<Map<string, Registered>>(new Map());
  const hoveredIdRef = useRef<string | null>(null);

  const setHoveredId = useCallback((next: string | null) => {
    const prev = hoveredIdRef.current;
    if (prev === next) return;
    if (prev) targetsRef.current.get(prev)?.setHovered(false);
    if (next) targetsRef.current.get(next)?.setHovered(true);
    hoveredIdRef.current = next;
  }, []);

  const registerTarget = useCallback((id: string, target: Registered) => {
    targetsRef.current.set(id, target);
    return () => {
      targetsRef.current.delete(id);
      if (hoveredIdRef.current === id) hoveredIdRef.current = null;
    };
  }, []);

  // Resolve the screen point to a registered target. The ghost has
  // pointer-events:none so it never wins the hit-test; we just need to
  // walk up from whatever DOM element is at (x,y).
  const resolveTarget = useCallback((x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y) as Element | null;
    if (!el) return null;
    const host = el.closest('[data-mobile-drop-id]') as HTMLElement | null;
    if (!host) return null;
    const id = host.getAttribute('data-mobile-drop-id');
    if (!id || !targetsRef.current.has(id)) return null;
    return id;
  }, []);

  const beginDrag = useCallback((info: { payload: string; accepts: string; x: number; y: number; label: string }) => {
    setDrag(info);
    setHoveredId(resolveTarget(info.x, info.y));
    onDragStart?.(info.payload);
  }, [onDragStart, resolveTarget, setHoveredId]);

  const updateDrag = useCallback((x: number, y: number) => {
    setDrag((prev) => (prev ? { ...prev, x, y } : prev));
    setHoveredId(resolveTarget(x, y));
  }, [resolveTarget, setHoveredId]);

  const finish = useCallback((commit: boolean) => {
    const current = drag;
    const hoveredId = hoveredIdRef.current;
    setHoveredId(null);
    setDrag(null);
    if (commit && current && hoveredId) {
      const t = targetsRef.current.get(hoveredId);
      if (t && t.accepts === current.accepts) t.onDrop(current.payload);
    }
    onDragEnd?.();
  }, [drag, onDragEnd, setHoveredId]);

  const endDrag = useCallback(() => finish(true), [finish]);
  const cancelDrag = useCallback(() => finish(false), [finish]);

  // Block scrolling / pinch-zoom while a drag is in progress. Capture phase
  // on document so neither xterm nor the sidebar's overflow-y-auto can
  // hijack the gesture mid-flight.
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: TouchEvent) => { e.preventDefault(); };
    document.addEventListener('touchmove', onMove, { passive: false, capture: true });
    return () => document.removeEventListener('touchmove', onMove, { capture: true } as EventListenerOptions);
  }, [drag]);

  const value = useMemo<CtxValue>(() => ({
    registerTarget,
    beginDrag,
    updateDrag,
    endDrag,
    cancelDrag,
    isDragging: drag !== null,
    draggingAccepts: drag?.accepts ?? null,
  }), [registerTarget, beginDrag, updateDrag, endDrag, cancelDrag, drag]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {drag && typeof document !== 'undefined' && createPortal(
        <DragGhost x={drag.x} y={drag.y} label={drag.label} />,
        document.body,
      )}
    </Ctx.Provider>
  );
}

function DragGhost({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <div
      aria-hidden="true"
      className="fixed top-0 left-0 z-[9999] pointer-events-none select-none"
      style={{
        transform: `translate3d(${x + 12}px, ${y + 12}px, 0)`,
        transition: 'transform 16ms linear',
      }}
    >
      <div className="flex items-center gap-1.5 rounded-full bg-orange-500/95 px-3 py-1 text-[11px] font-mono text-white shadow-lg backdrop-blur">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
        </svg>
        <span className="max-w-[40vw] truncate">{label}</span>
      </div>
    </div>
  );
}

interface SourceOptions {
  accepts: string;
  getPayload: () => string;
  getLabel?: () => string;
  // Disable on instances that should not be draggable (e.g. row in a
  // read-only state). Default false.
  disabled?: boolean;
}

interface SourceHandlers {
  onTouchStart: (e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: (e: React.TouchEvent) => void;
  onTouchCancel: (e: React.TouchEvent) => void;
}

export function useMobileDragSource(opts: SourceOptions): { touchHandlers: SourceHandlers } {
  const ctx = useContext(Ctx);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const stateRef = useRef<{
    startX: number;
    startY: number;
    timer: number | null;
    dragging: boolean;
  }>({ startX: 0, startY: 0, timer: null, dragging: false });

  const clearTimer = () => {
    const s = stateRef.current;
    if (s.timer != null) { clearTimeout(s.timer); s.timer = null; }
  };

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (!ctx || optsRef.current.disabled) return;
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    const s = stateRef.current;
    s.startX = t.clientX;
    s.startY = t.clientY;
    s.dragging = false;
    clearTimer();
    s.timer = window.setTimeout(() => {
      s.timer = null;
      const o = optsRef.current;
      const payload = o.getPayload();
      const label = o.getLabel?.() ?? payload.split('/').pop() ?? payload;
      s.dragging = true;
      try { navigator.vibrate?.(10); } catch { /* ignore */ }
      ctx.beginDrag({ payload, accepts: o.accepts, x: s.startX, y: s.startY, label });
    }, LONG_PRESS_MS);
  }, [ctx]);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!ctx) return;
    if (e.touches.length !== 1) {
      clearTimer();
      if (stateRef.current.dragging) ctx.cancelDrag();
      stateRef.current.dragging = false;
      return;
    }
    const t = e.touches[0];
    const s = stateRef.current;
    if (s.dragging) {
      ctx.updateDrag(t.clientX, t.clientY);
      return;
    }
    // Still in the arming window — cancel the long-press if the finger
    // moved past TAP_THRESHOLD (user is scrolling, not dragging).
    if (s.timer != null) {
      const dx = t.clientX - s.startX;
      const dy = t.clientY - s.startY;
      if (dx * dx + dy * dy > TAP_THRESHOLD * TAP_THRESHOLD) clearTimer();
    }
  }, [ctx]);

  const onTouchEnd = useCallback(() => {
    if (!ctx) return;
    clearTimer();
    if (stateRef.current.dragging) ctx.endDrag();
    stateRef.current.dragging = false;
  }, [ctx]);

  const onTouchCancel = useCallback(() => {
    if (!ctx) return;
    clearTimer();
    if (stateRef.current.dragging) ctx.cancelDrag();
    stateRef.current.dragging = false;
  }, [ctx]);

  // Cleanup the timer if the source unmounts mid-arm.
  useEffect(() => () => clearTimer(), []);

  return useMemo(
    () => ({ touchHandlers: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel } }),
    [onTouchStart, onTouchMove, onTouchEnd, onTouchCancel],
  );
}

interface TargetOptions {
  accepts: string;
  onDrop: (payload: string) => void;
  disabled?: boolean;
}

interface TargetResult {
  // Returned ref does two things: registers the target with the provider
  // and stamps `data-mobile-drop-id` on the element so elementFromPoint
  // can resolve back to it during a drag.
  ref: (el: HTMLElement | null) => void;
  isHovered: boolean;
  // True only when a drag whose `accepts` matches this target is in flight.
  // Lets the caller render its hover overlay just for compatible drags.
  isDragActive: boolean;
}

export function useMobileDropTarget(opts: TargetOptions): TargetResult {
  const ctx = useContext(Ctx);
  const id = useId();
  const [isHovered, setIsHovered] = useState(false);
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const elRef = useRef<HTMLElement | null>(null);

  // Register / unregister with the provider. `setHovered` is wired here so
  // the provider can drive our local state when hit-testing finds us.
  useEffect(() => {
    if (!ctx) return;
    if (opts.disabled) {
      setIsHovered(false);
      return;
    }
    const unregister = ctx.registerTarget(id, {
      accepts: opts.accepts,
      onDrop: (payload) => optsRef.current.onDrop(payload),
      setHovered: setIsHovered,
    });
    return unregister;
  }, [ctx, id, opts.accepts, opts.disabled]);

  const ref = useCallback((el: HTMLElement | null) => {
    elRef.current = el;
    if (el) el.setAttribute('data-mobile-drop-id', id);
  }, [id]);

  const isDragActive = !!ctx && ctx.isDragging && ctx.draggingAccepts === opts.accepts && !opts.disabled;

  return { ref, isHovered, isDragActive };
}

// Small merger so callers that already have a dnd-kit `setNodeRef` (or
// any other RefCallback) can combine it with our drop ref on the same
// element. Returns a RefCallback that fans out to each input ref.
export function mergeRefs<T>(...refs: Array<((el: T | null) => void) | React.MutableRefObject<T | null> | null | undefined>) {
  return (el: T | null) => {
    for (const r of refs) {
      if (!r) continue;
      if (typeof r === 'function') r(el);
      else (r as React.MutableRefObject<T | null>).current = el;
    }
  };
}
