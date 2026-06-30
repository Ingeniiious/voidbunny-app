import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { ClipboardAddon } from '@xterm/addon-clipboard';
import { getWsTicket } from '../lib/api';
import type { WorkingCli } from './TabLabel';
import TerminalSelectOverlay from './TerminalSelectOverlay';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/ui/popover';

// Snapshot the visible viewport + ~200 lines of scrollback into a single
// plain-text string the DOM overlay can render. `BufferLine.translateToString`
// returns plain text — xterm parses ANSI into cell attributes, not the
// returned string — so there's no escape leakage. Lines marked `isWrapped`
// are continuations of the previous logical line; we glue them back together
// so URLs / paths copy intact (matching Terminal.app).
function snapshotTermBuffer(term: Terminal): string {
  const buf = term.buffer.active;
  const total = buf.length;
  const startY = Math.max(0, total - (term.rows + 200));
  const out: string[] = [];
  let accum = '';
  let pending = false;
  // `isWrapped: true` on row N means "N is the continuation of row N-1" —
  // so wrapped lines glue *backward* into the current accumulator, and any
  // non-wrapped line flushes the previous logical line and starts a new
  // one. (Doing it the other way around, as a previous revision did, joined
  // each continuation to the *following* logical line — "Hello \nWorld\n
  // Goodbye" with World wrapped came out as ["Hello ", "WorldGoodbye"]
  // instead of ["Hello World", "Goodbye"]. Found by CodeRabbit.)
  for (let y = startY; y < total; y++) {
    const line = buf.getLine(y);
    if (!line) continue;
    const text = line.translateToString(true);
    if (line.isWrapped && pending) {
      accum += text;
    } else {
      if (pending) out.push(accum);
      accum = text;
      pending = true;
    }
  }
  if (pending) out.push(accum);
  return out.join('\n');
}

interface Props {
  sessionId: string;
  active: boolean;
  onOpenUrl?: (url: string) => void;
  onWorkingChange?: (working: boolean, cli?: WorkingCli) => void;
  // Fires when the CLI is paused on a yes/no prompt the user needs to answer
  // (mirrors the backend's `waiting` phase in busy.js — same regex set).
  // Mutually exclusive with `working`.
  onAttentionChange?: (attention: boolean) => void;
}

export interface TerminalTabHandle {
  send: (data: string) => void;
  focus: () => void;
  // Opens the DOM selection overlay. Used by the in-terminal "Select" button
  // and by external callers (e.g. a future toolbar). Idempotent.
  openSelect: () => void;
}

const TerminalTab = forwardRef<TerminalTabHandle, Props>(function TerminalTab({ sessionId, active, onOpenUrl, onWorkingChange, onAttentionChange }, ref) {
  // Stash the latest onOpenUrl in a ref so the WebLinksAddon handler (created
  // once on mount) always sees the current callback. Without this the handler
  // closes over the first render's value and stops working if the parent
  // recreates the function.
  const onOpenUrlRef = useRef(onOpenUrl);
  onOpenUrlRef.current = onOpenUrl;
  const onWorkingChangeRef = useRef(onWorkingChange);
  onWorkingChangeRef.current = onWorkingChange;
  const onAttentionChangeRef = useRef(onAttentionChange);
  onAttentionChangeRef.current = onAttentionChange;
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  // DOM selection overlay state. The overlay replaces the old line-based
  // mobile / mouse-mode select-mode entirely — DOM <pre> gives character-
  // precision selection AND surfaces the OS-native copy callout on iOS /
  // Android, neither of which is possible on xterm's canvas.
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [overlaySnapshot, setOverlaySnapshot] = useState('');
  // Counts new PTY-output lines that arrived while the overlay was open.
  // Drives the "+N new — tap to refresh" pill in the overlay. Reset on
  // every re-snapshot. Using a ref alongside state so the ws.onmessage
  // closure can increment it without re-reading React state.
  const staleLinesRef = useRef(0);
  const [staleLines, setStaleLines] = useState(0);
  const overlayOpenRef = useRef(false);
  overlayOpenRef.current = overlayOpen;
  const [copyToast, setCopyToast] = useState<string | null>(null);
  // 'open' on the optimistic first attempt; 'reconnecting' after a drop.
  // The initial open is now silent (no pill, no text) — for the common
  // sub-250 ms case the user sees nothing but the shell prompt arriving.
  // If the open stalls, `showSkeleton` fades in a soft placeholder instead.
  // iOS/Android suspend the page when backgrounded which kills the ws after
  // ~30s, so a visible 'reconnecting' pill is still wanted on later drops.
  const [connStatus, setConnStatus] = useState<'open' | 'reconnecting'>('open');
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [showSkeleton, setShowSkeleton] = useState(false);
  // Desktop selection: present when the user has highlighted text with the
  // mouse. Drives the floating Copy pill — keeps a copy of the selected text
  // so the click handler doesn't depend on `term` still having the selection
  // by the time the click fires.
  const [desktopSelection, setDesktopSelection] = useState<string>('');
  // Terminal URL clicks pop a small menu (open here vs. copy URL) at the
  // click point. `x`/`y` are viewport coordinates from the original event.
  const [linkPrompt, setLinkPrompt] = useState<{ url: string; x: number; y: number } | null>(null);

  // Opens the DOM selection overlay with a fresh buffer snapshot. Stable
  // identity (deps: []) so we can hand it to the imperative handle and the
  // keyboard handler without re-binding on every render.
  const openOverlay = useCallback(() => {
    const term = termRef.current;
    if (!term) return;
    setOverlaySnapshot(snapshotTermBuffer(term));
    staleLinesRef.current = 0;
    setStaleLines(0);
    setOverlayOpen(true);
    // Buzz on mobile so a long-press feels like it landed on something.
    try { navigator.vibrate?.(10); } catch { /* ignore */ }
  }, []);

  const closeOverlay = useCallback(() => {
    setOverlayOpen(false);
    setOverlaySnapshot('');
    staleLinesRef.current = 0;
    setStaleLines(0);
  }, []);

  const refreshOverlay = useCallback(() => {
    const term = termRef.current;
    if (!term) return;
    setOverlaySnapshot(snapshotTermBuffer(term));
    staleLinesRef.current = 0;
    setStaleLines(0);
  }, []);

  useImperativeHandle(ref, () => ({
    // Just write to the PTY — do NOT call term.focus() here. Re-focusing xterm
    // refocuses the hidden helper-textarea, which on iOS pops the OS keyboard
    // back up the moment the user taps Send / a KeyBar key / the mic. Callers
    // that explicitly want focus restored should call `focus()` themselves.
    send: (data: string) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(data);
    },
    focus: () => termRef.current?.focus(),
    openSelect: openOverlay,
  }), [openOverlay]);

  useEffect(() => {
    if (!containerRef.current) return;

    const themeFor = (dark: boolean) =>
      dark
        ? {
            background: '#0a0a0d',
            foreground: '#f5f5f7',
            cursor: '#f5f5f7',
            cursorAccent: '#0a0a0d',
            selectionBackground: '#2a2a30',
          }
        : {
            background: '#ffffff',
            foreground: '#0a0a0d',
            cursor: '#0a0a0d',
            cursorAccent: '#ffffff',
            selectionBackground: '#e0e0e6',
          };

    const term = new Terminal({
      theme: themeFor(document.documentElement.classList.contains('dark')),
      fontFamily: '"JetBrains Mono", ui-monospace, monospace',
      fontSize: 13,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000,
      smoothScrollDuration: 100,
      // When an app (Claude Code, tmux) enables mouse tracking, plain
      // click-drag is forwarded to the PTY instead of producing a local
      // selection — the highlight flashes and then disappears. These two
      // options let Mac users hold Option, and right-click select a word,
      // as escape hatches. The bigger hammer is the "Select" button (and
      // mouse-capture handlers below) which works on every platform.
      macOptionClickForcesSelection: true,
      rightClickSelectsWord: true,
    });

    // Keep xterm's colors in sync with the app theme. xterm bakes the theme
    // into its renderer at construction; without this observer, flipping
    // light/dark in the header leaves the terminal stuck on the old palette.
    const themeObserver = new MutationObserver(() => {
      const dark = document.documentElement.classList.contains('dark');
      term.options.theme = themeFor(dark);
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    const fit = new FitAddon();
    // Terminal URLs pop a small "open here vs. copy URL" menu instead of
    // going straight to in-app Brave. The copy path is what makes remote
    // OAuth flows usable — the user wants to finish login on the device
    // they're sitting at, not inside the panel's headless Brave.
    const links = new WebLinksAddon((event, uri) => {
      setLinkPrompt({ url: uri, x: event.clientX, y: event.clientY });
    });
    term.loadAddon(fit);
    term.loadAddon(links);
    // OSC 52 support: lets programs running inside the terminal (e.g. tmux
    // `set-clipboard on`, neovim `unnamedplus`, `wl-copy`) write to the
    // browser clipboard via escape sequences. Independent of the DOM
    // selection overlay — fixes the "clipboard works in tmux on Linux but
    // not in the panel" footgun.
    term.loadAddon(new ClipboardAddon());

    term.open(containerRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    // Detect when an agent CLI is actively running. Each CLI prints a
    // distinct "press X to abort" hint while a request is in flight:
    //   - Claude Code  → "esc to interrupt"   (status row above composer)
    //   - Codex CLI    → "esc to interrupt"   (same phrase; shown only while
    //                     a turn is streaming, not at idle)
    //   - Gemini CLI   → "(esc to cancel, N s)"
    // The phrase alone isn't enough to identify *which* CLI we're looking at
    // (Claude and Codex collide), so the backend's process-tree scan owns
    // identity (session.cli) and this scanner only owns the busy/idle bit.
    // We pass the locally-inferred cli up as a hint — Layout falls back to
    // it only when the backend hasn't reported one yet.
    const CLI_PATTERNS: Array<{ cli: WorkingCli; re: RegExp }> = [
      // Gemini's marker is unique to Gemini (countdown digits), so we
      // check it first.
      { cli: 'gemini', re: /\(esc to cancel,\s*\d/i },
      // Claude's reliable busy marker is the spinner row's ellipsis
      // followed by its timer in parens, e.g. "Synthesizing… (4m 52s · …)"
      // or "Adding listing column… (24m 25s · …)". The ellipsis can come
      // several words after the gerund, so matching gerund-immediately-
      // followed-by-ellipsis misses most frames. Idle/finished rows are
      // past tense without an ellipsis ("Worked for 20m 28s"). Plan-mode
      // status rows have an ellipsis but no timer ("plan mode on … · esc
      // to interrupt"). We tag this as Claude here only as a best-guess
      // fallback — the backend `cli` field overrides on render.
      { cli: 'claude', re: /…\s*\(\d+[ms]/ },
    ];
    // Waiting-prompt markers. Mirrors backend/busy.js — same regexes drive
    // the push notification, so the tab label and the notification can't
    // disagree on whether the CLI is asking. Scanned only when the busy
    // marker is absent (mutually exclusive) and against the bottom of the
    // viewport (an answered prompt scrolls away — anything higher is stale).
    const WAITING_PATTERNS: RegExp[] = [
      /Do you want to proceed\?/i,
      /Do you want to make this edit/i,
      /Do you want to create/i,
      /Ready to code\?/i,
      /Would you like to/i,
      /\bauto-accept edits\b/i,
      /\bpress\s+enter\s+to\s+(confirm|continue|apply)/i,
      /\bApply\s+changes\?/i,
      /\(y\/n\)/i,
      // Claude Code "interview" prompts — the multi-option pickers (e.g. from
      // AskUserQuestion) and the single-option picker. Without these the tab
      // doesn't flag attention while Claude is stuck waiting on a choice. The
      // hint strings are exact copy from the CLI binary, so over-matching on
      // unrelated buffer content is unlikely.
      /Space to toggle.*Enter to confirm/i,
      /Tab\/Arrow keys to navigate/i,
      /\bEnter to select\b/i,
    ];
    const WAITING_TAIL_ROWS = 20;
    let workingState = false;
    let workingCli: WorkingCli | undefined;
    let attentionState = false;
    let lastSeen = 0;
    const sampleWork = () => {
      const buf = term.buffer.active;
      // Scan the entire visible viewport (term.rows) instead of just the last
      // 8 buffer rows. Codex and Gemini render their busy hint a few rows
      // above the prompt, so a small window can miss it for a beat or two
      // and that's what made detection feel sluggish vs. Claude.
      const rows = Math.max(term.rows, 24);
      const start = Math.max(0, buf.length - rows);
      let foundCli: WorkingCli | undefined;
      for (let i = start; i < buf.length; i++) {
        const line = buf.getLine(i)?.translateToString(true) ?? '';
        for (const { cli, re } of CLI_PATTERNS) {
          if (re.test(line)) { foundCli = cli; break; }
        }
        if (foundCli) break;
      }
      const now = Date.now();
      if (foundCli) { lastSeen = now; workingCli = foundCli; }
      // Shorter idle window (700 ms) so going from busy → idle is felt
      // promptly. The sampler runs every 250 ms below, so we still cover
      // two redraws inside the window — a single glitched scan won't flip it.
      const next = now - lastSeen < 700;
      if (next !== workingState || (next && foundCli && foundCli !== workingCli)) {
        workingState = next;
        onWorkingChangeRef.current?.(next, next ? workingCli : undefined);
      }

      // Waiting-prompt scan. Only check when the busy marker isn't showing —
      // a CLI that's mid-turn might *also* have an old prompt scrolled in
      // the tail, and we don't want to flag those frames.
      let waiting = false;
      if (!next) {
        const waitStart = Math.max(0, buf.length - WAITING_TAIL_ROWS);
        const tailLines: string[] = [];
        for (let i = waitStart; i < buf.length; i++) {
          tailLines.push(buf.getLine(i)?.translateToString(true) ?? '');
        }
        const tail = tailLines.join('\n');
        for (const re of WAITING_PATTERNS) {
          if (re.test(tail)) { waiting = true; break; }
        }
      }
      if (waiting !== attentionState) {
        attentionState = waiting;
        onAttentionChangeRef.current?.(waiting);
      }
    };
    const workInterval = window.setInterval(sampleWork, 250);

    // Desktop copy/paste. xterm focuses a hidden textarea so the browser's
    // native Cmd/Ctrl+C never fires on the page — we have to intercept it
    // ourselves. Conventions:
    //   - macOS: ⌘C copies, ⌘V pastes (standard).
    //   - Linux/Windows: Ctrl+Shift+C / Ctrl+Shift+V (gnome-terminal style)
    //     OR plain Ctrl+C / Ctrl+V *only when there is a selection* — the
    //     "smart copy" behaviour Windows Terminal popularised. With nothing
    //     selected, Ctrl+C falls through to xterm and sends SIGINT as
    //     expected.
    const isMac = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
    const writeClipboard = (text: string) => {
      navigator.clipboard.writeText(text).catch(() => {
        try {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.setAttribute('readonly', '');
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        } catch { /* ignore */ }
      });
    };
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      const k = e.key.toLowerCase();
      const onlyMeta = e.metaKey && !e.ctrlKey && !e.altKey;
      const onlyCtrl = e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
      const ctrlShift = e.ctrlKey && e.shiftKey && !e.metaKey && !e.altKey;
      const metaShift = e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey;
      const copyExplicit = isMac ? (onlyMeta && k === 'c') : (ctrlShift && k === 'c');
      const pasteExplicit = isMac ? (onlyMeta && k === 'v') : (ctrlShift && k === 'v');
      // Cmd/Ctrl+Shift+S → open the DOM selection overlay. Lets desktop
      // users escape xterm's canvas-selection without reaching for the
      // toolbar Select button.
      const openSelectShortcut = isMac ? (metaShift && k === 's') : (ctrlShift && k === 's');
      // Smart Ctrl+C / Ctrl+V on non-Mac: only intercept when there's a
      // selection (copy) so a bare Ctrl+C still works as SIGINT otherwise.
      const sel = term.getSelection();
      const smartCopy = !isMac && onlyCtrl && k === 'c' && !!sel;
      const smartPaste = !isMac && onlyCtrl && k === 'v';
      if (openSelectShortcut) {
        openOverlay();
        e.preventDefault();
        return false;
      }
      if (copyExplicit || smartCopy) {
        if (!sel) return true;
        writeClipboard(sel);
        // Visual confirmation + clear selection so a follow-up Ctrl+C goes
        // through to the shell as SIGINT instead of re-copying the same text.
        term.clearSelection();
        setDesktopSelection('');
        setCopyToast('Copied');
        window.setTimeout(() => setCopyToast(null), 1200);
        e.preventDefault();
        return false;
      }
      if (pasteExplicit || smartPaste) {
        navigator.clipboard.readText().then((text) => {
          const w = wsRef.current;
          if (text && w && w.readyState === WebSocket.OPEN) w.send(text);
        }).catch(() => { /* ignore — browser may block w/o user gesture context */ });
        e.preventDefault();
        return false;
      }
      return true;
    });

    // Track selection state so the floating Copy pill can appear / disappear
    // as the user drags. While the DOM overlay is open xterm's selection
    // is irrelevant (the overlay sits on top with its own native selection).
    const onSelChange = term.onSelectionChange(() => {
      if (overlayOpenRef.current) { setDesktopSelection(''); return; }
      setDesktopSelection(term.getSelection());
    });

    // --- WebSocket with auto-reconnect ---------------------------------
    // The PTY session lives on the backend keyed by `sessionId` so we can
    // close + reopen the ws and re-attach to the same shell. Reconnect
    // strategy: exponential backoff capped at 10s, immediate reattempt
    // on visibility / online events (mobile wake-up).
    let closedByCleanup = false;
    let attempt = 0;
    let reconnectTimer: number | null = null;
    // Skeleton only fades in if the open *stalls*. Cleared by ws.onopen so
    // common-case sub-250 ms opens never flash any transition UI.
    let skeletonTimer: number | null = window.setTimeout(() => {
      skeletonTimer = null;
      setShowSkeleton(true);
    }, 250);

    const scheduleReconnect = () => {
      if (closedByCleanup) return;
      if (reconnectTimer != null) return;
      // 1s, 2s, 4s, 8s, 10s, 10s, …
      const delay = Math.min(10_000, 1000 * Math.pow(2, attempt));
      attempt += 1;
      setReconnectAttempt(attempt);
      setConnStatus('reconnecting');
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    const connect = async () => {
      if (closedByCleanup) return;
      let ticket: string;
      try {
        ticket = await getWsTicket();
      } catch {
        scheduleReconnect();
        return;
      }
      if (closedByCleanup) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(
        `${proto}//${window.location.host}/terminal?ticket=${encodeURIComponent(ticket)}&sid=${encodeURIComponent(sessionId)}`
      );
      wsRef.current = ws;

      ws.onopen = () => {
        attempt = 0;
        setReconnectAttempt(0);
        setConnStatus('open');
        if (skeletonTimer != null) { clearTimeout(skeletonTimer); skeletonTimer = null; }
        setShowSkeleton(false);
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      };
      ws.onmessage = (e) => {
        const data = typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data);
        term.write(data);
        // While the DOM overlay is open the canvas behind keeps receiving
        // output, but the overlay's snapshot is frozen (re-rendering would
        // collapse the user's selection mid-copy). Surface a "+N new"
        // pill instead so the user can refresh when they're done.
        if (overlayOpenRef.current) {
          // Cheap rough-count: every newline byte is one new visual line.
          // Doesn't have to be exact — the pill is a hint, not a counter.
          let nl = 0;
          for (let i = 0; i < data.length; i++) if (data.charCodeAt(i) === 10) nl++;
          if (nl > 0) {
            staleLinesRef.current += nl;
            setStaleLines(staleLinesRef.current);
          }
        }
      };
      ws.onclose = () => {
        if (closedByCleanup) return;
        if (wsRef.current === ws) wsRef.current = null;
        scheduleReconnect();
      };
      ws.onerror = () => { /* onclose will fire next; reconnect is driven there */ };
    };

    connect();

    // Reconnect immediately when the tab/app becomes visible again or the
    // network comes back — beats waiting out the backoff after wake.
    const wakeReconnect = () => {
      if (closedByCleanup) return;
      const w = wsRef.current;
      if (w && (w.readyState === WebSocket.OPEN || w.readyState === WebSocket.CONNECTING)) return;
      if (reconnectTimer != null) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      attempt = 0;
      setReconnectAttempt(0);
      connect();
    };
    const onVisibility = () => { if (document.visibilityState === 'visible') wakeReconnect(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', wakeReconnect);
    window.addEventListener('pageshow', wakeReconnect);

    const onData = term.onData((data) => {
      const w = wsRef.current;
      if (w && w.readyState === WebSocket.OPEN) w.send(data);
    });

    const ro = new ResizeObserver(() => {
      if (!fitRef.current || !termRef.current) return;
      try {
        fitRef.current.fit();
        const w = wsRef.current;
        if (w && w.readyState === WebSocket.OPEN) {
          w.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        }
      } catch { /* ignore */ }
    });
    ro.observe(containerRef.current);

    // Mobile touch-scroll. xterm.js has no native touch-scroll, and inside
    // tmux mouse-mode the visible scrollback lives in tmux (copy-mode), not
    // in xterm's own buffer — so term.scrollLines() does nothing useful.
    // Instead we mimic what a desktop wheel does: send SGR mouse-wheel
    // escape sequences to the PTY. tmux receives them, enters copy-mode,
    // and scrolls its pane. Capture phase so xterm's own touch→mouse
    // translation (which would otherwise start a text selection) doesn't
    // swallow the gesture first.
    const el = containerRef.current;
    const TAP_THRESHOLD = 8;
    const MAX_LINES_PER_EVENT = 40;
    const LONG_PRESS_MS = 500;
    let touchStartY = 0;
    let lastY = 0;
    let accumulator = 0;
    let scrolling = false;
    let longPressTimer: number | null = null;

    const sendWheel = (lines: number) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN || lines === 0) return;
      const button = lines < 0 ? 64 : 65; // 64 = wheel-up (older), 65 = wheel-down (newer)
      const count = Math.min(MAX_LINES_PER_EVENT, Math.abs(lines));
      const seq = `\x1b[<${button};1;1M`;
      let payload = '';
      for (let i = 0; i < count; i++) payload += seq;
      ws.send(payload);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        scrolling = false;
        if (longPressTimer != null) { clearTimeout(longPressTimer); longPressTimer = null; }
        return;
      }
      const y = e.touches[0].clientY;
      touchStartY = lastY = y;
      accumulator = 0;
      scrolling = false;

      // Already in the DOM overlay: it owns all touches; don't arm long-press
      // or scroll-forward, the overlay's own pointer-events handles them.
      if (overlayOpenRef.current) return;

      // Arm a long-press timer. Movement past TAP_THRESHOLD (in onTouchMove)
      // cancels it. On fire: open the DOM selection overlay — real selectable
      // text, OS-native iOS / Android copy callout, character-precision.
      longPressTimer = window.setTimeout(() => {
        longPressTimer = null;
        openOverlay();
      }, LONG_PRESS_MS);
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1 || !termRef.current || !el) return;
      if (overlayOpenRef.current) return;
      const y = e.touches[0].clientY;

      const totalDy = touchStartY - y;
      // Cancel pending long-press as soon as the finger moves past threshold.
      if (longPressTimer != null && Math.abs(totalDy) > TAP_THRESHOLD) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      if (!scrolling) {
        if (Math.abs(totalDy) <= TAP_THRESHOLD) return;
        scrolling = true;
      }
      e.preventDefault();
      e.stopPropagation();
      const dy = lastY - y;
      lastY = y;
      accumulator += dy;
      const lineH = el.clientHeight / Math.max(1, termRef.current.rows);
      const lines = Math.trunc(accumulator / lineH);
      if (lines !== 0) {
        accumulator -= lines * lineH;
        sendWheel(lines);
      }
    };
    const onTouchEnd = () => {
      scrolling = false;
      if (longPressTimer != null) { clearTimeout(longPressTimer); longPressTimer = null; }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true, capture: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true, capture: true });

    // Desktop drag-to-select: xterm's native drag-selection handles the
    // common case (no mouse-mode app). When an app *is* using mouse mode
    // (Claude Code, tmux, vim), drag forwards to the PTY and selection
    // never lands — that's where the DOM Selection Overlay comes in. The
    // user opens it via the in-terminal Select button or Cmd/Ctrl+Shift+S.
    // No mouse-down/move handlers needed here anymore.

    return () => {
      closedByCleanup = true;
      themeObserver.disconnect();
      window.clearInterval(workInterval);
      // Intentionally NOT firing onWorkingChange(false) / onAttentionChange(false)
      // here. Unmount happens both when the session is actually gone *and* when
      // the parent re-arranges JSX (e.g. grid-mode toggle re-parents this tab
      // under GridView). Signalling "idle" on the latter would flip every
      // currently-busy tab into the "unseen completion" shimmer the moment the
      // user enters grid mode. The Layout instead garbage-collects per-session
      // state reactively off the `sessions` array — closeSession / the server
      // refresh both go through there, so removed sessions still get cleaned.
      if (reconnectTimer != null) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (skeletonTimer != null) { clearTimeout(skeletonTimer); skeletonTimer = null; }
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', wakeReconnect);
      window.removeEventListener('pageshow', wakeReconnect);
      onData.dispose();
      onSelChange.dispose();
      ro.disconnect();
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
      if (longPressTimer != null) clearTimeout(longPressTimer);
      try { wsRef.current?.close(); } catch { /* ignore */ }
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      wsRef.current = null;
    };
  }, [sessionId]);

  const handleDesktopCopy = async () => {
    const term = termRef.current;
    const text = desktopSelection || term?.getSelection() || '';
    if (!text) return;
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch { /* ignore */ }
    }
    setCopyToast(ok ? 'Copied' : 'Copy failed');
    window.setTimeout(() => setCopyToast(null), 1200);
    term?.clearSelection();
    setDesktopSelection('');
  };

  // Escape dismisses the URL prompt without firing either action.
  useEffect(() => {
    if (!linkPrompt) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLinkPrompt(null);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [linkPrompt]);

  useEffect(() => {
    // Tab going away: close the overlay. Preserving an in-flight selection
    // across tab switches gives the user no benefit and adds bug surface
    // (snapshot from another tab's buffer flashes in for a frame, etc.).
    if (!active) {
      if (overlayOpenRef.current) closeOverlay();
      return;
    }
    queueMicrotask(() => {
      try {
        fitRef.current?.fit();
        const term = termRef.current;
        const ws = wsRef.current;
        if (term && ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        }
        // Skip focus on touch devices — focusing xterm's hidden helper-textarea
        // pops the iOS/Android soft keyboard up on every tab switch.
        const isTouch =
          typeof window !== 'undefined' &&
          window.matchMedia?.('(hover: none) and (pointer: coarse)').matches;
        if (!isTouch) term?.focus();
      } catch { /* ignore */ }
    });
  }, [active, closeOverlay]);

  return (
    <div
      className="absolute inset-0 bg-panel-bg"
      style={{ display: active ? 'block' : 'none' }}
    >
      <div
        ref={containerRef}
        className="absolute inset-0 p-2"
      />
      {/* Reconnect pill: only after a *dropped* socket, never on first open. */}
      {connStatus === 'reconnecting' && (
        <div className="pointer-events-none absolute left-3 top-3 z-20 flex">
          <div className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-amber-500/90 px-2.5 py-1 text-[11px] font-mono text-zinc-900 shadow-lg">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-zinc-900 animate-pulse" />
            {reconnectAttempt > 1 ? `Reconnecting… (try ${reconnectAttempt})` : 'Reconnecting…'}
          </div>
        </div>
      )}
      {/* First-open skeleton: only fades in if the open stalls > 250 ms, so
          the common sub-250 ms case shows nothing. Painted on the same
          bg-panel-bg as the xterm canvas — when the real terminal renders on
          top there's no visible swap, just the prompt appearing. */}
      {showSkeleton && connStatus === 'open' && (
        <div
          className="pointer-events-none absolute inset-0 z-10 p-2"
          aria-hidden="true"
        >
          <div className="flex flex-col gap-2 pl-1 pt-1">
            <div className="h-3 w-2/5 rounded bg-panel-border/60 animate-pulse" />
            <div className="h-3 w-1/4 rounded bg-panel-border/50 animate-pulse" />
            <div className="h-3 w-1/3 rounded bg-panel-border/40 animate-pulse" />
          </div>
        </div>
      )}
      {/* Selection-present pill (no mouse-mode case): xterm's native canvas
          drag already produced a selection. One tap copies it. */}
      {!overlayOpen && desktopSelection && (
        <div className="pointer-events-none absolute right-3 top-3 z-20 hidden sm:flex justify-end">
          <button
            type="button"
            onMouseDown={(e) => {
              // Don't let xterm's mousedown handler fire — that would clear
              // the selection before our click handler can read it.
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={handleDesktopCopy}
            className="pointer-events-auto rounded-full bg-blue-600 px-3 py-1 text-xs font-medium text-white shadow-lg transition-colors hover:bg-blue-500 active:bg-blue-700 animate-in fade-in-0 zoom-in-95 duration-150"
            title="Copy selection (⌘C / Ctrl+Shift+C)"
          >
            Copy selection
          </button>
        </div>
      )}
      {/* Always-visible Select button. Opens the DOM selection overlay
          where the user can pick text character-by-character — and on
          iOS / Android, the OS native Copy / Select All / Share callout
          appears. Hidden when the overlay is already open or when a
          desktop selection is already in flight (the Copy pill above
          handles that case). */}
      {!overlayOpen && !desktopSelection && (
        <div className="pointer-events-none absolute right-3 top-3 z-20 flex justify-end">
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onClick={openOverlay}
            aria-label="Select text"
            title="Select & copy (⌘⇧S / Ctrl+Shift+S)"
            className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-zinc-900/80 px-2.5 py-1 text-[11px] font-medium text-white shadow-lg backdrop-blur transition-colors hover:bg-zinc-900 active:bg-black dark:bg-zinc-100/80 dark:text-zinc-900 dark:hover:bg-zinc-100"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 4h4" />
              <path d="M16 4h4v4" />
              <path d="M20 16v4h-4" />
              <path d="M4 16v4h4" />
              <path d="M4 8v8" />
              <path d="M20 8v4" />
            </svg>
            <span className="hidden sm:inline">Select</span>
          </button>
        </div>
      )}
      <TerminalSelectOverlay
        open={overlayOpen}
        snapshot={overlaySnapshot}
        staleLines={staleLines}
        onClose={closeOverlay}
        onRefresh={refreshOverlay}
      />
      {copyToast && (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center">
          <div className="rounded-full bg-zinc-900/90 px-3 py-1 text-xs font-medium text-white shadow-lg dark:bg-zinc-100/90 dark:text-zinc-900">
            {copyToast}
          </div>
        </div>
      )}
      {/* URL click prompt — shadcn Popover anchored at the exact click point.
          The invisible 1×1 PopoverAnchor under PopoverContent's Portal gives
          Radix collision detection to flip sides if we're near the viewport
          edge, and pairs with the animation classes in popover.tsx for a
          tiny scale+fade entrance instead of a hard pop-in. */}
      <Popover
        open={!!linkPrompt}
        onOpenChange={(open) => { if (!open) setLinkPrompt(null); }}
      >
        {linkPrompt && (
          <PopoverAnchor asChild>
            <div
              aria-hidden
              className="pointer-events-none fixed"
              style={{ left: linkPrompt.x, top: linkPrompt.y, width: 1, height: 1 }}
            />
          </PopoverAnchor>
        )}
        {linkPrompt && (
          <PopoverContent
            side="bottom"
            align="start"
            sideOffset={8}
            collisionPadding={8}
            className="w-72 gap-0 p-0"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <div className="border-b border-panel-border px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-panel-muted">
                Open link
              </div>
              <div
                className="mt-0.5 truncate font-mono text-xs text-panel-text/80"
                title={linkPrompt.url}
              >
                {linkPrompt.url}
              </div>
            </div>
            <div className="flex flex-col p-1 text-sm">
              <button
                type="button"
                onClick={() => {
                  const url = linkPrompt.url;
                  setLinkPrompt(null);
                  const handler = onOpenUrlRef.current;
                  if (handler) handler(url);
                  else window.open(url, '_blank', 'noopener,noreferrer');
                }}
                className="rounded-md px-3 py-2 text-left transition-colors hover:bg-panel-bg active:bg-panel-bg"
              >
                Open in in-app browser
              </button>
              <button
                type="button"
                onClick={async () => {
                  const url = linkPrompt.url;
                  setLinkPrompt(null);
                  let ok = false;
                  try {
                    await navigator.clipboard.writeText(url);
                    ok = true;
                  } catch {
                    try {
                      const ta = document.createElement('textarea');
                      ta.value = url;
                      ta.setAttribute('readonly', '');
                      ta.style.position = 'fixed';
                      ta.style.opacity = '0';
                      document.body.appendChild(ta);
                      ta.select();
                      ok = document.execCommand('copy');
                      document.body.removeChild(ta);
                    } catch { /* ignore */ }
                  }
                  setCopyToast(ok ? 'URL copied' : 'Copy failed');
                  window.setTimeout(() => setCopyToast(null), 1200);
                }}
                className="rounded-md px-3 py-2 text-left transition-colors hover:bg-panel-bg active:bg-panel-bg"
              >
                Copy URL to clipboard
              </button>
              <button
                type="button"
                onClick={() => setLinkPrompt(null)}
                className="rounded-md px-3 py-2 text-left text-panel-muted transition-colors hover:bg-panel-bg"
              >
                Cancel
              </button>
            </div>
          </PopoverContent>
        )}
      </Popover>
    </div>
  );
});

export default TerminalTab;
