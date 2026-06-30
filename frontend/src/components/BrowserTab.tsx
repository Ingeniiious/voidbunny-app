import { useEffect, useRef, useState } from 'react';
import { Keyboard, ArrowLeft, ArrowRight, RotateCw, Link2, Code2, ClipboardPaste, Search, Sliders, X, Camera } from 'lucide-react';
import RFB from '@novnc/novnc';
import { toast } from 'sonner';
import { getWsTicket, fetchStats, resizeBrowser, screenshotBrowser } from '../lib/api';

// Per-device performance overrides. localStorage is already per-device, so no
// device-id keying needed — the user's phone, tablet, and laptop each store
// their own preferred quality/scale and pick them up on next mount.
const QUALITY_KEY      = 'panel.browser.quality';      // 'auto' | Tier
const SCALE_KEY        = 'panel.browser.scale';        // 'auto' | '0.5' | '0.75' | '1' | '1.5' | '2' | 'custom'
const SCALE_CUSTOM_KEY = 'panel.browser.scale.custom'; // numeric multiplier when scaleChoice === 'custom'

// Bounds for the custom scale slider/input. Below ~0.4 the framebuffer drops
// under our 280 px minimum on small windows; above 3 the server has to push a
// silly number of pixels for diminishing sharpness gain. Step is fine enough to
// dial in a sweet spot but coarse enough not to hammer xrandr while sliding.
const SCALE_MIN  = 0.4;
const SCALE_MAX  = 3;
const SCALE_STEP = 0.05;

type QualityChoice = 'auto' | Tier;
type ScaleChoice   = 'auto' | '0.5' | '0.75' | '1' | '1.5' | '2' | 'custom';

function readQuality(): QualityChoice {
  if (typeof localStorage === 'undefined') return 'auto';
  const v = localStorage.getItem(QUALITY_KEY);
  return v === 'high' || v === 'mid' || v === 'low' ? v : 'auto';
}
function readScale(): ScaleChoice {
  if (typeof localStorage === 'undefined') return 'auto';
  const v = localStorage.getItem(SCALE_KEY);
  if (v === '0.5' || v === '0.75' || v === '1' || v === '1.5' || v === '2' || v === 'custom') return v;
  return 'auto';
}
function readCustomScale(): number {
  if (typeof localStorage === 'undefined') return 1;
  const n = Number(localStorage.getItem(SCALE_CUSTOM_KEY));
  if (!Number.isFinite(n) || n < SCALE_MIN || n > SCALE_MAX) return 1;
  return Math.round(n * 100) / 100;
}

// Tiers for the auto-tuner. Three named profiles is plenty — finer than this
// just causes the tuner to flap mid-scroll. `q` is JPEG quality (0-9), `c` is
// zlib compression (0-9). Higher q = sharper image, higher c = more server CPU.
const TUNING_TIERS = {
  high: { q: 9, c: 1 },   // Hetzner uplink + idle server: max quality, min CPU work
  mid:  { q: 7, c: 3 },   // moderate pressure or weaker client link
  low:  { q: 5, c: 6 },   // CPU-bound server or slow/metered client link
} as const;
type Tier = keyof typeof TUNING_TIERS;

// Pick a tier from a server-pressure score (load1/cores, ~1.0 = saturated) and
// a client downlink estimate in Mbps. Either signal alone can demote the tier;
// we never promote past what the worse signal allows.
function pickTier(pressure: number, downlinkMbps: number): Tier {
  if (pressure > 1.2 || downlinkMbps < 1.5) return 'low';
  if (pressure > 0.7 || downlinkMbps < 5)   return 'mid';
  return 'high';
}

interface NetworkInformation {
  downlink?: number;
  effectiveType?: '2g' | '3g' | '4g' | 'slow-2g';
  saveData?: boolean;
}
function readDownlink(): number {
  // navigator.connection is Chromium-only. On Safari/Firefox we assume the
  // link is fast (the host is the actual bottleneck, not the client).
  const conn = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  if (!conn) return 100;
  if (conn.saveData) return 0.5;          // user explicitly asked for data savings
  if (conn.effectiveType === 'slow-2g') return 0.1;
  if (conn.effectiveType === '2g')      return 0.5;
  if (conn.effectiveType === '3g')      return 2;
  return conn.downlink ?? 50;             // 4g/wifi: trust the reported number
}

// X11 keysyms for the named keys we forward. Inlined from
// `@novnc/novnc/core/input/keysym.js` because the package's `exports` field
// doesn't expose deep subpaths, so Vite can't resolve them.
const XK_BackSpace = 0xff08;
const XK_Tab       = 0xff09;
const XK_Return    = 0xff0d;
const XK_Escape    = 0xff1b;
const XK_Home      = 0xff50;
const XK_Left      = 0xff51;
const XK_Up        = 0xff52;
const XK_Right     = 0xff53;
const XK_Down      = 0xff54;
const XK_Page_Up   = 0xff55;
const XK_Page_Down = 0xff56;
const XK_End       = 0xff57;
const XK_Delete    = 0xffff;
const XK_Shift_L   = 0xffe1;
const XK_Control_L = 0xffe3;
const XK_Alt_L     = 0xffe9;

// Standard X11 Unicode → keysym mapping (same logic as noVNC's keysymdef.lookup):
// Latin-1 codepoints map to themselves; everything else gets the 0x01000000
// "Unicode keysym" prefix.
function unicodeToKeysym(cp: number): number | null {
  if (cp == null || cp < 0x20) return null;
  if (cp >= 0x20 && cp <= 0x7e) return cp;        // ASCII printable
  if (cp >= 0xa0 && cp <= 0xff) return cp;        // Latin-1 supplement
  return 0x01000000 | cp;
}

interface Props {
  browserId: string;
  active: boolean;
  mode: 'desktop' | 'mobile';
}

// One Brave-in-Xvfb instance per tab, viewed via noVNC. The WS upgrade uses
// a short-lived single-use ticket fetched over the auth'd HTTP API — the JWT
// itself never appears in the URL.
export default function BrowserTab({ browserId, active, mode }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RFB | null>(null);
  const hiddenInputRef = useRef<HTMLTextAreaElement>(null);
  // 'connecting' is still tracked internally for downstream UI (the keyboard
  // FAB hides until 'open'), but the visible pill is gated by `showSkeleton`
  // — only fades in if the open takes longer than 250 ms. Disconnected still
  // shows its pill immediately, since that's a real failure signal.
  const [status, setStatus] = useState<'connecting' | 'open' | 'disconnected'>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [isTouch] = useState(() =>
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(hover: none) and (pointer: coarse)').matches,
  );
  const [perfOpen, setPerfOpen] = useState(false);
  const [qualityChoice, setQualityChoice] = useState<QualityChoice>(readQuality);
  const [scaleChoice, setScaleChoice] = useState<ScaleChoice>(readScale);
  const [customScale, setCustomScale] = useState<number>(readCustomScale);
  // Surface the last framebuffer dimensions we sent so the popover can show
  // "768×432 px" to the user — useful while they're hunting for the right
  // multiplier and want to remember what worked.
  const [lastFbDims, setLastFbDims] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    setStatus('connecting');
    setError(null);
    setShowSkeleton(false);
    const skeletonTimer = window.setTimeout(() => setShowSkeleton(true), 250);

    let cancelled = false;
    let rfb: RFB | null = null;

    const onConnect = () => {
      setStatus('open');
      setError(null);
      clearTimeout(skeletonTimer);
      setShowSkeleton(false);
    };
    const onDisconnect = (e: unknown) => {
      setStatus('disconnected');
      const clean = (e as { detail?: { clean?: boolean } })?.detail?.clean !== false;
      if (!clean) setError('connection dropped — try reopening the tab');
    };
    // Remote clipboard → device clipboard. Fires whenever the user copies
    // inside the in-app Brave (Ctrl+C / right-click Copy). x11vnc forwards
    // CLIPBOARD selection updates via the RFB ServerCutText message, which
    // noVNC surfaces as this event.
    //
    // Mobile Safari + many browsers block `navigator.clipboard.writeText`
    // outside a fresh user gesture — and by the time this event arrives,
    // the user's gesture context is often gone. So we try the silent path
    // first, and on any failure fall through to a sticky toast with a
    // "Copy" action — the toast tap is itself a fresh gesture, so the
    // writeText call inside it always succeeds.
    let lastRemoteText = '';
    const previewOf = (text: string): string => {
      const flat = text.replace(/\s+/g, ' ').trim();
      return flat.length > 60 ? flat.slice(0, 57) + '…' : flat;
    };
    const showCopyToast = (text: string) => {
      toast('Copied from browser', {
        description: previewOf(text),
        duration: 8000,
        action: {
          label: 'Tap to copy',
          onClick: async () => {
            try {
              await navigator.clipboard.writeText(text);
              toast.success('Copied to clipboard');
            } catch {
              toast.error('Clipboard blocked — long-press the preview to copy');
            }
          },
        },
      });
    };
    const onRemoteClipboard = (e: unknown) => {
      const text = (e as { detail?: { text?: string } })?.detail?.text;
      if (!text || text === lastRemoteText) return;
      lastRemoteText = text;
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(
          () => {
            toast.success('Copied from browser', {
              description: previewOf(text),
              duration: 2200,
            });
          },
          () => showCopyToast(text),
        );
      } else {
        showCopyToast(text);
      }
    };

    (async () => {
      let ticket: string;
      try {
        ticket = await getWsTicket();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'failed to authorize WS upgrade');
        return;
      }
      if (cancelled || !containerRef.current) return;

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${window.location.host}/browser?ticket=${encodeURIComponent(ticket)}&id=${encodeURIComponent(browserId)}`;

      try {
        rfb = new RFB(containerRef.current, url, { shared: true });
        rfb.scaleViewport = true;
        rfb.resizeSession = false;
        rfb.background = '#0a0a0d';
        rfb.showDotCursor = true;
        rfb.qualityLevel = TUNING_TIERS.high.q;
        rfb.compressionLevel = TUNING_TIERS.high.c;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'failed to start RFB');
        return;
      }

      rfbRef.current = rfb;
      rfb.addEventListener('connect', onConnect);
      rfb.addEventListener('disconnect', onDisconnect);
      rfb.addEventListener('clipboard', onRemoteClipboard);
    })();

    return () => {
      cancelled = true;
      clearTimeout(skeletonTimer);
      rfb?.removeEventListener('connect', onConnect);
      rfb?.removeEventListener('disconnect', onDisconnect);
      rfb?.removeEventListener('clipboard', onRemoteClipboard);
      try { rfb?.disconnect(); } catch { /* ignore */ }
      rfbRef.current = null;
    };
  }, [browserId]);

  // Auto-tuner: every 6s while the tab is active and the session is open,
  // sample server load + client link and pick the appropriate quality tier.
  // We only call into RFB when the tier actually changes — flipping settings
  // every cycle would churn SetEncodings traffic for no reason.
  //
  // If the user has pinned a quality in the Perf popover (qualityChoice !=
  // 'auto'), the tuner short-circuits to that tier and skips the polling —
  // the explicit choice is the whole point of the override.
  useEffect(() => {
    if (!active || status !== 'open') return;
    let cancelled = false;
    let currentTier: Tier | null = null;

    const apply = (tier: Tier) => {
      if (cancelled || tier === currentTier) return;
      const rfb = rfbRef.current;
      if (!rfb) return;
      rfb.qualityLevel = TUNING_TIERS[tier].q;
      rfb.compressionLevel = TUNING_TIERS[tier].c;
      currentTier = tier;
    };

    if (qualityChoice !== 'auto') {
      apply(qualityChoice);
      return () => { cancelled = true; };
    }

    const tick = async () => {
      try {
        const stats = await fetchStats();
        if (cancelled) return;
        const cores = Math.max(1, stats.cpu.count);
        const pressure = stats.cpu.load1 / cores;
        apply(pickTier(pressure, readDownlink()));
      } catch {
        // Stats endpoint hiccup — leave the tier alone. The next tick retries.
      }
    };

    tick();
    const id = window.setInterval(tick, 6000);
    return () => { cancelled = true; clearInterval(id); };
  }, [active, status, qualityChoice]);

  // Keep the Brave framebuffer in sync with the tab's actual size. A
  // ResizeObserver on the container — debounced 200 ms so window-drag
  // bursts don't fire dozens of resize calls — pings the backend, which
  // xrandr-resizes the Xvfb root window and CDP-resizes the Brave window.
  // Gated on the tab being active because backgrounded tabs would still
  // get layout pings (e.g. when the sidebar opens) and we don't want to
  // resize an instance the user isn't currently looking at.
  useEffect(() => {
    if (!active || status !== 'open' || !containerRef.current) return;
    const el = containerRef.current;

    let cancelled = false;
    let debounceTimer: number | null = null;
    let lastSentW = 0;
    let lastSentH = 0;

    // Scale = framebuffer pixels per CSS pixel. 'auto' = 1:1 — same model the
    // terminal uses (fixed-CSS-size content, adapt the count to the
    // container), which keeps Brave's cursor / tabs / chrome at predictable,
    // legible sizes on every device. Previously 'auto' tracked the host DPR,
    // but on retina that halved everything visually after noVNC's
    // scaleViewport shrank the canvas back to fit. Users who want retina
    // sharpness can still pin 1.5× / 2× / custom.
    const dpr =
      scaleChoice === 'auto'   ? 1 :
      scaleChoice === 'custom' ? customScale :
      Number(scaleChoice);

    const send = (cssW: number, cssH: number) => {
      if (cancelled) return;
      const w = Math.max(280, Math.min(3840, Math.round(cssW * dpr)));
      const h = Math.max(280, Math.min(3840, Math.round(cssH * dpr)));
      // No-op if the dimensions barely changed — a 1 px wobble from
      // browser layout/scrollbar quirks shouldn't trigger an xrandr.
      if (Math.abs(w - lastSentW) < 4 && Math.abs(h - lastSentH) < 4) return;
      lastSentW = w;
      lastSentH = h;
      setLastFbDims({ w, h });
      resizeBrowser(browserId, w, h).catch((err) => {
        console.warn(`[browser ${browserId}] resize failed:`, err);
      });
    };

    // Re-run noVNC's internal _updateScale() against the current container.
    // noVNC only re-fits its canvas on three signals: the scaleViewport
    // setter, a window-resize event, and a server framebuffer-resize event.
    // None of those fire when our grid cell shrinks (window stays the same,
    // backend hasn't been told yet) — so without this poke the canvas keeps
    // its old CSS transform and gets clipped by the cell's overflow-hidden.
    // Reassigning the same `true` value re-invokes the setter, which is
    // enough to trigger the rescale.
    const rescaleNow = () => {
      const rfb = rfbRef.current;
      if (rfb) rfb.scaleViewport = true;
    };

    // Fire once on connect/activate so a freshly-opened tab snaps to the
    // current container size, even if the create-time guess was a few
    // pixels off (mobile keyboard, sidebar toggle, etc.).
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      rescaleNow();
      send(rect.width, rect.height);
    }

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      // Visual refit happens synchronously so the canvas tracks the cell
      // immediately. Backend xrandr still runs debounced so a window-drag
      // burst doesn't fire dozens of resize RPCs.
      rescaleNow();
      // Big jumps (grid toggle, rotate, sidebar open/close) flush
      // immediately so noVNC isn't scaling a stale framebuffer for 200 ms —
      // that stale window is what produced the brief "everything too big"
      // or "everything too small" flash after a layout change. Small
      // wobbles (window drag, scrollbar quirks) stay debounced so xrandr
      // isn't hammered.
      const lastCssW = lastSentW / dpr;
      const lastCssH = lastSentH / dpr;
      const big =
        lastSentW === 0 ||
        Math.abs(width  - lastCssW) > width  * 0.15 ||
        Math.abs(height - lastCssH) > height * 0.15;
      if (debounceTimer != null) clearTimeout(debounceTimer);
      if (big) {
        send(width, height);
      } else {
        debounceTimer = window.setTimeout(() => send(width, height), 200);
      }
    });
    ro.observe(el);

    return () => {
      cancelled = true;
      if (debounceTimer != null) clearTimeout(debounceTimer);
      ro.disconnect();
    };
  }, [active, status, browserId, mode, scaleChoice, customScale]);

  // Translate a DOM keyboard event to an X11 keysym.
  function domKeyToKeysym(e: React.KeyboardEvent): number | null {
    switch (e.key) {
      case 'Enter':      return XK_Return;
      case 'Backspace':  return XK_BackSpace;
      case 'Tab':        return XK_Tab;
      case 'Escape':     return XK_Escape;
      case 'ArrowLeft':  return XK_Left;
      case 'ArrowRight': return XK_Right;
      case 'ArrowUp':    return XK_Up;
      case 'ArrowDown':  return XK_Down;
      case 'Home':       return XK_Home;
      case 'End':        return XK_End;
      case 'Delete':     return XK_Delete;
      case 'PageUp':     return XK_Page_Up;
      case 'PageDown':   return XK_Page_Down;
    }
    if (e.key.length === 1) {
      const cp = e.key.codePointAt(0);
      return cp != null ? unicodeToKeysym(cp) : null;
    }
    return null;
  }

  // Clearing the textarea every event keeps the IME caret at position 0 —
  // otherwise GBoard / Safari swipe-typing gets confused about cursor state.
  function resetHidden() {
    if (hiddenInputRef.current) hiddenInputRef.current.value = '';
  }

  const onHiddenKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ks = domKeyToKeysym(e);
    if (ks != null) {
      rfbRef.current?.sendKey(ks, e.code || null, true);
      e.preventDefault();
    }
    resetHidden();
  };

  const onHiddenKeyUp = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ks = domKeyToKeysym(e);
    if (ks != null) {
      rfbRef.current?.sendKey(ks, e.code || null, false);
      e.preventDefault();
    }
  };

  // iOS Safari fires `beforeinput` (with e.data) for plain letters instead of
  // keydown. Forward each character through sendKey down+up.
  const onHiddenBeforeInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const native = e.nativeEvent as InputEvent;
    const data = native.data ?? '';
    for (const ch of data) {
      const cp = ch.codePointAt(0);
      if (cp == null) continue;
      const ks = unicodeToKeysym(cp);
      if (ks == null) continue;
      rfbRef.current?.sendKey(ks, null, true);
      rfbRef.current?.sendKey(ks, null, false);
    }
    e.preventDefault();
    resetHidden();
  };

  // IME (e.g. Pinyin, Japanese) composition — flushed on commit.
  const onHiddenCompositionEnd = (e: React.CompositionEvent<HTMLTextAreaElement>) => {
    for (const ch of e.data ?? '') {
      const cp = ch.codePointAt(0);
      if (cp == null) continue;
      const ks = unicodeToKeysym(cp);
      if (ks == null) continue;
      rfbRef.current?.sendKey(ks, null, true);
      rfbRef.current?.sendKey(ks, null, false);
    }
    resetHidden();
  };

  const toggleKeyboard = () => {
    if (keyboardOpen) hiddenInputRef.current?.blur();
    else hiddenInputRef.current?.focus();
  };

  // Press a key with modifiers held, then release everything in reverse order.
  // Brave (like any X client) sees the modifier state via X events, so this is
  // equivalent to a physical chord like Ctrl+Shift+I.
  function sendChord(modifiers: Array<typeof XK_Control_L | typeof XK_Shift_L | typeof XK_Alt_L>, keysym: number) {
    const rfb = rfbRef.current;
    if (!rfb) return;
    for (const m of modifiers) rfb.sendKey(m, null, true);
    rfb.sendKey(keysym, null, true);
    rfb.sendKey(keysym, null, false);
    for (let i = modifiers.length - 1; i >= 0; i--) rfb.sendKey(modifiers[i], null, false);
  }

  // Stop the button from stealing focus from the hidden textarea — keeps the
  // on-screen keyboard open if it was already up, and avoids a layout jump.
  const preventFocusSteal = (e: React.PointerEvent | React.MouseEvent) => {
    e.preventDefault();
  };

  // CDP-driven screenshot. Saves to UPLOADS_ROOT/voidbunny-screenshots/ on
  // the server; the returned absolute path is dropped into a toast so the
  // user can copy it and reference the file from any terminal (cat it,
  // attach it to an agent prompt, scp out, whatever).
  const [screenshotting, setScreenshotting] = useState(false);
  const takeScreenshot = async () => {
    if (screenshotting) return;
    setScreenshotting(true);
    const id = toast.loading('Capturing screenshot…');
    try {
      const r = await screenshotBrowser(browserId);
      const kb = Math.max(1, Math.round(r.bytes / 1024));
      toast.success('Screenshot saved', {
        id,
        description: r.path,
        duration: 7000,
        action: {
          label: 'Copy path',
          onClick: () => {
            navigator.clipboard?.writeText(r.path)
              .then(() => toast.success('Path copied'))
              .catch(() => toast.error('Clipboard blocked'));
          },
        },
      });
      // Quiet console line so power users can still find it after the toast
      // fades. Bytes/title included for debugging if a capture looks empty.
      console.info(`[panel] screenshot ${kb}KB → ${r.path}`, { title: r.title });
    } catch (e) {
      toast.error('Screenshot failed', {
        id,
        description: e instanceof Error ? e.message : 'unknown error',
      });
    } finally {
      setScreenshotting(false);
    }
  };

  const pickQuality = (next: QualityChoice) => {
    setQualityChoice(next);
    try { localStorage.setItem(QUALITY_KEY, next); } catch { /* ignore */ }
  };
  const pickScale = (next: ScaleChoice) => {
    setScaleChoice(next);
    try { localStorage.setItem(SCALE_KEY, next); } catch { /* ignore */ }
  };
  const pickCustomScale = (next: number) => {
    const clamped = Math.max(SCALE_MIN, Math.min(SCALE_MAX, Math.round(next * 100) / 100));
    setCustomScale(clamped);
    try { localStorage.setItem(SCALE_CUSTOM_KEY, String(clamped)); } catch { /* ignore */ }
  };

  const goBack    = () => sendChord([XK_Alt_L], XK_Left);
  const goForward = () => sendChord([XK_Alt_L], XK_Right);
  const reload    = () => sendChord([XK_Control_L], 'r'.charCodeAt(0));
  const findInPage = () => sendChord([XK_Control_L], 'f'.charCodeAt(0));
  const focusUrl  = () => {
    sendChord([XK_Control_L], 'l'.charCodeAt(0));
    // After focusing the URL bar the user almost certainly wants to type,
    // so pop the soft keyboard automatically.
    hiddenInputRef.current?.focus();
  };
  const devTools  = () => sendChord([XK_Control_L, XK_Shift_L], 'I'.charCodeAt(0));

  // Device clipboard → remote (in-app Brave). Push the text into the X
  // CLIPBOARD selection via RFB ClientCutText, then send Ctrl+V so whatever
  // input is focused inside Brave actually receives it. Without the Ctrl+V
  // step the clipboard updates but nothing pastes — and on touch the user
  // has no key-combo to trigger paste themselves.
  const pasteIntoBrowser = async () => {
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch (e) {
      toast.error('Clipboard read blocked', {
        description: e instanceof Error ? e.message : 'Allow clipboard access for this site.',
      });
      return;
    }
    if (!text) {
      toast.error('Clipboard is empty');
      return;
    }
    const rfb = rfbRef.current;
    if (!rfb) {
      toast.error('Browser not connected');
      return;
    }
    try {
      rfb.clipboardPasteFrom(text);
    } catch (e) {
      toast.error('Couldn’t push clipboard', {
        description: e instanceof Error ? e.message : 'RFB rejected the cut buffer.',
      });
      return;
    }
    // Tiny delay so the cut-buffer round-trip completes before Ctrl+V fires.
    // 40 ms is below human-perceptible latency but above the typical RFB
    // turn-around inside the same LAN/loopback hop the panel runs over.
    window.setTimeout(() => sendChord([XK_Control_L], 'v'.charCodeAt(0)), 40);
    toast.success('Pasted into browser', {
      description: text.length > 60 ? text.slice(0, 57) + '…' : text,
      duration: 1600,
    });
  };

  return (
    <div
      className="absolute inset-0 bg-panel-bg"
      style={{ display: active ? 'block' : 'none' }}
    >
      <div ref={containerRef} className="absolute inset-0" />

      <textarea
        ref={hiddenInputRef}
        aria-label="Browser keyboard input"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        autoComplete="off"
        inputMode="text"
        value=""
        onChange={() => { /* swallow — we read via key/beforeinput */ }}
        onFocus={() => setKeyboardOpen(true)}
        onBlur={() => setKeyboardOpen(false)}
        onKeyDown={onHiddenKeyDown}
        onKeyUp={onHiddenKeyUp}
        onBeforeInput={onHiddenBeforeInput}
        onCompositionEnd={onHiddenCompositionEnd}
        className="absolute"
        style={{
          left: 0, bottom: 0, width: 1, height: 1,
          opacity: 0, caretColor: 'transparent',
          border: 0, padding: 0, resize: 'none',
        }}
      />

      {status === 'open' && (
        <PerfPopover
          open={perfOpen}
          onClose={() => setPerfOpen(false)}
          quality={qualityChoice}
          scale={scaleChoice}
          customScale={customScale}
          fbDims={lastFbDims}
          onPickQuality={pickQuality}
          onPickScale={pickScale}
          onPickCustomScale={pickCustomScale}
        />
      )}

      {/* Desktop entry point for the Perf popover. On touch the popover is
          opened from the FAB stack below; desktop has no FAB, so this small
          icon button in the top-right is the only way in. Visually muted so
          it doesn't fight Brave content; lights up when the popover is open. */}
      {!isTouch && status === 'open' && (
        <button
          type="button"
          onClick={() => setPerfOpen((v) => !v)}
          aria-label="Browser performance settings"
          title="Performance (frame rate · resolution)"
          className={`absolute right-2 top-2 z-30 flex items-center justify-center rounded-md backdrop-blur-md transition-colors ${
            perfOpen
              ? 'bg-panel-text/95 text-panel-bg'
              : 'bg-zinc-900/60 text-zinc-100/80 hover:text-zinc-100 hover:bg-zinc-900/85 dark:bg-zinc-100/60 dark:text-zinc-900/80 dark:hover:bg-zinc-100/85'
          }`}
          style={{ width: 28, height: 28 }}
        >
          <Sliders className="w-3.5 h-3.5" />
        </button>
      )}

      {isTouch && status === 'open' && (
        <div className="absolute right-3 bottom-3 z-30 flex flex-col items-end gap-2">
          <button
            type="button"
            onPointerDown={preventFocusSteal}
            onClick={() => setPerfOpen((v) => !v)}
            aria-label="Performance settings"
            title="Performance (frame rate · resolution)"
            className={`flex items-center justify-center rounded-full shadow-lg ${
              perfOpen
                ? 'bg-panel-text text-panel-bg'
                : 'bg-zinc-900/85 text-zinc-100 dark:bg-zinc-100/85 dark:text-zinc-900'
            }`}
            style={{ width: 40, height: 40 }}
          >
            <Sliders className="w-[18px] h-[18px]" />
          </button>
          <button
            type="button"
            onPointerDown={preventFocusSteal}
            onClick={takeScreenshot}
            disabled={screenshotting}
            aria-label="Save screenshot"
            title="Save screenshot to ~/voidbunny-uploads/voidbunny-screenshots"
            className="flex items-center justify-center rounded-full shadow-lg bg-zinc-900/85 text-zinc-100 dark:bg-zinc-100/85 dark:text-zinc-900 disabled:opacity-60"
            style={{ width: 40, height: 40 }}
          >
            <Camera className="w-[18px] h-[18px]" />
          </button>
          <button
            type="button"
            onPointerDown={preventFocusSteal}
            onClick={devTools}
            aria-label="Toggle DevTools"
            className="flex items-center justify-center rounded-full shadow-lg bg-zinc-900/85 text-zinc-100 dark:bg-zinc-100/85 dark:text-zinc-900"
            style={{ width: 40, height: 40 }}
          >
            <Code2 className="w-[18px] h-[18px]" />
          </button>
          <button
            type="button"
            onPointerDown={preventFocusSteal}
            onClick={findInPage}
            aria-label="Find in page"
            title="Find in page (Ctrl+F)"
            className="flex items-center justify-center rounded-full shadow-lg bg-zinc-900/85 text-zinc-100 dark:bg-zinc-100/85 dark:text-zinc-900"
            style={{ width: 40, height: 40 }}
          >
            <Search className="w-[18px] h-[18px]" />
          </button>
          <button
            type="button"
            onPointerDown={preventFocusSteal}
            onClick={pasteIntoBrowser}
            aria-label="Paste from device clipboard"
            title="Paste from device clipboard"
            className="flex items-center justify-center rounded-full shadow-lg bg-zinc-900/85 text-zinc-100 dark:bg-zinc-100/85 dark:text-zinc-900"
            style={{ width: 40, height: 40 }}
          >
            <ClipboardPaste className="w-[18px] h-[18px]" />
          </button>
          <button
            type="button"
            onPointerDown={preventFocusSteal}
            onClick={focusUrl}
            aria-label="Address bar"
            className="flex items-center justify-center rounded-full shadow-lg bg-zinc-900/85 text-zinc-100 dark:bg-zinc-100/85 dark:text-zinc-900"
            style={{ width: 40, height: 40 }}
          >
            <Link2 className="w-[18px] h-[18px]" />
          </button>
          <button
            type="button"
            onPointerDown={preventFocusSteal}
            onClick={reload}
            aria-label="Reload page"
            className="flex items-center justify-center rounded-full shadow-lg bg-zinc-900/85 text-zinc-100 dark:bg-zinc-100/85 dark:text-zinc-900"
            style={{ width: 40, height: 40 }}
          >
            <RotateCw className="w-[18px] h-[18px]" />
          </button>
          <button
            type="button"
            onPointerDown={preventFocusSteal}
            onClick={goForward}
            aria-label="Forward"
            title="Forward (Alt+→)"
            className="flex items-center justify-center rounded-full shadow-lg bg-zinc-900/85 text-zinc-100 dark:bg-zinc-100/85 dark:text-zinc-900"
            style={{ width: 40, height: 40 }}
          >
            <ArrowRight className="w-[18px] h-[18px]" />
          </button>
          <button
            type="button"
            onPointerDown={preventFocusSteal}
            onClick={goBack}
            aria-label="Back"
            className="flex items-center justify-center rounded-full shadow-lg bg-zinc-900/85 text-zinc-100 dark:bg-zinc-100/85 dark:text-zinc-900"
            style={{ width: 40, height: 40 }}
          >
            <ArrowLeft className="w-[18px] h-[18px]" />
          </button>
          <button
            type="button"
            onClick={toggleKeyboard}
            aria-label={keyboardOpen ? 'Hide keyboard' : 'Show keyboard'}
            className={`flex items-center justify-center rounded-full shadow-lg ${
              keyboardOpen
                ? 'bg-panel-text text-panel-bg'
                : 'bg-zinc-900/85 text-zinc-100 dark:bg-zinc-100/85 dark:text-zinc-900'
            }`}
            style={{ width: 44, height: 44 }}
          >
            <Keyboard className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Disconnected pill shows immediately (real failure signal). The
          'connecting' pill is gated by `showSkeleton` so a sub-250 ms open
          never flashes any transition UI. */}
      {status === 'disconnected' && (
        <div className="pointer-events-none absolute left-3 top-3 z-20 flex">
          <div className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-amber-500/90 px-2.5 py-1 text-[11px] font-mono text-zinc-900 shadow-lg">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-zinc-900" />
            {error ?? 'Disconnected'}
          </div>
        </div>
      )}
      {status === 'connecting' && showSkeleton && (
        <div className="pointer-events-none absolute inset-0 z-10" aria-hidden="true">
          <div className="absolute left-3 top-3 flex">
            <div className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-zinc-900/85 px-2.5 py-1 text-[11px] font-mono text-zinc-100 shadow-lg dark:bg-zinc-100/85 dark:text-zinc-900">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-zinc-400 animate-pulse" />
              Starting browser…
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const QUALITY_OPTIONS: ReadonlyArray<{ value: QualityChoice; label: string; hint: string }> = [
  { value: 'auto', label: 'Auto',   hint: 'tunes to network + server load' },
  { value: 'high', label: 'High',   hint: 'sharp · best for fast wifi' },
  { value: 'mid',  label: 'Medium', hint: 'balanced default' },
  { value: 'low',  label: 'Low',    hint: 'softer · best for cellular' },
];

const SCALE_OPTIONS: ReadonlyArray<{ value: ScaleChoice; label: string; hint: string }> = [
  { value: 'auto',   label: 'Auto',   hint: 'match window 1:1 (recommended)' },
  { value: '0.5',    label: '0.5×',   hint: 'biggest chrome — lowest detail' },
  { value: '0.75',   label: '0.75×',  hint: 'bigger Brave UI' },
  { value: '1',      label: '1×',     hint: 'lowest pixel count' },
  { value: '1.5',    label: '1.5×',   hint: 'sharper text' },
  { value: '2',      label: '2×',     hint: 'retina — highest CPU' },
  { value: 'custom', label: 'Custom', hint: 'dial in any multiplier' },
];

interface PerfPopoverProps {
  open: boolean;
  onClose: () => void;
  quality: QualityChoice;
  scale: ScaleChoice;
  customScale: number;
  fbDims: { w: number; h: number } | null;
  onPickQuality: (q: QualityChoice) => void;
  onPickScale: (s: ScaleChoice) => void;
  onPickCustomScale: (n: number) => void;
}

// Bottom-anchored popover so it lands above the FAB stack without overlapping
// either edge of a phone screen. Each pick persists immediately — there's no
// Apply button, just instant feedback the same way Settings rows work.
function PerfPopover({
  open, onClose, quality, scale, customScale, fbDims,
  onPickQuality, onPickScale, onPickCustomScale,
}: PerfPopoverProps) {
  if (!open) return null;
  return (
    <div className="absolute inset-x-3 bottom-20 z-40 sm:left-auto sm:right-3 sm:w-[22rem] sm:bottom-auto sm:top-12">
      <div className="rounded-xl border border-panel-border bg-panel-surface/95 backdrop-blur-md shadow-2xl">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-panel-border">
          <div>
            <h3 className="font-mono text-xs uppercase tracking-wider text-panel-muted">
              Browser performance
            </h3>
            <p className="text-[10px] text-panel-muted/80 mt-0.5">
              Saved on this device.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close performance settings"
            className="p-1 -mr-1 rounded text-panel-muted hover:text-panel-text"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-4 py-3 space-y-4">
          <PerfRow
            title="Frame rate · quality"
            options={QUALITY_OPTIONS}
            value={quality}
            onPick={onPickQuality}
            columns={4}
          />
          <div>
            <PerfRow
              title="Resolution scale"
              options={SCALE_OPTIONS}
              value={scale}
              onPick={onPickScale}
              columns={4}
            />
            {scale === 'custom' && (
              <CustomScaleRow value={customScale} onChange={onPickCustomScale} />
            )}
            {fbDims && (
              <div className="text-[10px] text-panel-muted/70 font-mono mt-2">
                framebuffer: {fbDims.w} × {fbDims.h} px
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CustomScaleRow({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="mt-2 rounded-md bg-panel-bg/60 border border-panel-border px-3 py-2 space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={SCALE_MIN}
          max={SCALE_MAX}
          step={SCALE_STEP}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 accent-orange-500"
          aria-label="Custom resolution multiplier"
        />
        <input
          type="number"
          min={SCALE_MIN}
          max={SCALE_MAX}
          step={SCALE_STEP}
          value={value}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(n);
          }}
          className="w-16 font-mono text-xs bg-panel-bg border border-panel-border rounded px-1.5 py-1 text-panel-text focus:outline-none focus:border-panel-muted"
          aria-label="Custom multiplier value"
        />
      </div>
      <div className="text-[10px] text-panel-muted/80 font-mono">
        {value.toFixed(2)}× · drag to find what looks right ({SCALE_MIN}–{SCALE_MAX})
      </div>
    </div>
  );
}

function PerfRow<T extends string>({
  title, options, value, onPick, columns = 4,
}: {
  title: string;
  options: ReadonlyArray<{ value: T; label: string; hint: string }>;
  value: T;
  onPick: (v: T) => void;
  columns?: number;
}) {
  const active = options.find((o) => o.value === value);
  const gridCols = columns === 7 ? 'grid-cols-7'
    : columns === 6 ? 'grid-cols-6'
    : columns === 5 ? 'grid-cols-5'
    : columns === 3 ? 'grid-cols-3'
    : 'grid-cols-4';
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-wider text-panel-muted/90 mb-1.5">
        {title}
      </div>
      <div className={`grid ${gridCols} gap-1`}>
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onPick(opt.value)}
            aria-pressed={value === opt.value}
            className={`px-2 py-1.5 rounded-md font-mono text-xs transition-colors ${
              value === opt.value
                ? 'bg-panel-bg border border-orange-400/50 text-panel-text'
                : 'bg-panel-bg/40 border border-panel-border text-panel-muted hover:text-panel-text hover:border-panel-text/40'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {active && (
        <div className="text-[10px] text-panel-muted/80 font-mono mt-1.5">
          {active.hint}
        </div>
      )}
    </div>
  );
}
