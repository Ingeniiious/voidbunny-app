import { useEffect, useRef, useState } from 'react';

interface Props {
  open: boolean;
  snapshot: string;
  staleLines: number;
  onClose: () => void;
  onRefresh: () => void;
}

// DOM-based selection overlay. xterm renders to canvas, so the OS-native
// Copy / Select All / Share callout can never appear on the terminal itself
// (and partial-word selection feels blocky). When the user opens this overlay
// we drop a real <pre> over the canvas with `user-select: text` and
// `-webkit-touch-callout: default`, which gives:
//   - character-precise drag selection on desktop (no more "snaps to line")
//   - the native iOS / Android selection toolbar on mobile
// The canvas underneath keeps running but is non-interactive. New PTY output
// during selection lands in the canvas and surfaces a "+N new" pill so the
// user can refresh the snapshot when they want to.
export default function TerminalSelectOverlay({ open, snapshot, staleLines, onClose, onRefresh }: Props) {
  const preRef = useRef<HTMLPreElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [dark, setDark] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark'),
  );

  // Keep the overlay's bg/fg in sync with the app theme toggle. Cheap — only
  // observes the html element's class attribute, same pattern xterm uses.
  useEffect(() => {
    if (!open) return;
    const obs = new MutationObserver(() => {
      setDark(document.documentElement.classList.contains('dark'));
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, [open]);

  // On open: scroll to the bottom (so what the user was reading on the canvas
  // is still on screen), and clear any leftover selection from a previous
  // mount so the callout doesn't pop the moment the overlay appears.
  useEffect(() => {
    if (!open) return;
    const pre = preRef.current;
    if (pre) pre.scrollTop = pre.scrollHeight;
    try { window.getSelection()?.removeAllRanges(); } catch { /* ignore */ }
  }, [open, snapshot]);

  // Escape closes the overlay. Capture phase so xterm's own key handler can't
  // steal it (the helper-textarea may still be focused underneath).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  const handleCopyAll = async () => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(snapshot);
      ok = true;
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = snapshot;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch { /* ignore */ }
    }
    setCopied(ok ? 'Copied' : 'Copy failed');
    window.setTimeout(() => setCopied(null), 1200);
  };

  const bg = dark ? '#0a0a0d' : '#ffffff';
  const fg = dark ? '#f5f5f7' : '#0a0a0d';
  const muted = dark ? '#a1a1aa' : '#52525b';
  const border = dark ? '#27272a' : '#e4e4e7';

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 z-30 flex flex-col animate-in fade-in-0 duration-150"
      style={{ background: bg }}
    >
      {/* Top toolbar — title + Copy All + Done. pointer-events-auto on the
          bar but the <pre> below is the only thing the user actually wants
          to interact with for selection. */}
      <div
        className="flex items-center gap-2 px-3 h-9 border-b flex-shrink-0 text-xs font-mono"
        style={{ borderColor: border, color: muted, background: bg }}
      >
        <SelectIcon />
        <span>Select &amp; copy</span>
        <span className="opacity-60 hidden sm:inline">— drag to highlight, the OS menu (or ⌘C) copies</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={handleCopyAll}
            className="rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
            style={{ background: '#2563eb', color: '#ffffff' }}
          >
            Copy all
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close select mode"
            className="rounded-md w-7 h-7 inline-flex items-center justify-center transition-colors"
            style={{ color: fg }}
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      {/* Stale-output pill. Renders only when new PTY output has arrived
          since the snapshot. Tap to re-snapshot (which collapses the current
          selection — unavoidable; mutating a <pre>'s text node during a live
          selection throws IndexSizeError on every browser). */}
      {staleLines > 0 && (
        <div className="absolute left-1/2 top-12 z-10 -translate-x-1/2">
          <button
            type="button"
            onClick={onRefresh}
            className="rounded-full px-3 py-1 text-[11px] font-mono shadow-lg animate-in fade-in-0 slide-in-from-top-1 duration-150"
            style={{ background: '#f59e0b', color: '#0a0a0d' }}
          >
            +{staleLines} new {staleLines === 1 ? 'line' : 'lines'} — tap to refresh
          </button>
        </div>
      )}

      {/* The actual selectable surface. Every property here exists for a
          specific reason — do not trim:
            user-select / -webkit-user-select: text  → enables selection
            -webkit-touch-callout: default           → enables the iOS callout
            touch-action: pan-y                      → keeps vertical scroll
            white-space: pre                         → preserves terminal wrap
            overscroll-behavior: contain             → no rubber-band into the
                                                       page when scrolling at
                                                       the top/bottom on iOS
            tabIndex=0                               → keyboard focus for
                                                       Cmd/Ctrl+A select-all
       */}
      <pre
        ref={preRef}
        tabIndex={0}
        className="flex-1 min-h-0 m-0 px-3 py-2 overflow-auto outline-none focus:outline-none"
        style={{
          color: fg,
          background: bg,
          fontFamily: '"JetBrains Mono", ui-monospace, monospace',
          fontSize: 13,
          lineHeight: 1.35,
          whiteSpace: 'pre',
          userSelect: 'text',
          WebkitUserSelect: 'text',
          WebkitTouchCallout: 'default',
          WebkitOverflowScrolling: 'touch',
          touchAction: 'pan-y',
          overscrollBehavior: 'contain',
        } as React.CSSProperties}
      >
        {snapshot}
      </pre>

      {/* Mirror of TerminalTab's copy-toast styling for consistency. */}
      {copied && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center">
          <div
            className="rounded-full px-3 py-1 text-xs font-medium shadow-lg"
            style={{ background: dark ? '#f4f4f5' : '#18181b', color: dark ? '#18181b' : '#f4f4f5' }}
          >
            {copied}
          </div>
        </div>
      )}
    </div>
  );
}

function SelectIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 4h4" />
      <path d="M16 4h4v4" />
      <path d="M20 16v4h-4" />
      <path d="M4 16v4h4" />
      <path d="M4 8v8" />
      <path d="M20 8v4" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
