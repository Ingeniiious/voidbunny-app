import { useState, useCallback, useEffect, useRef } from 'react';
import { Menu, Plus, X, Sun, Moon, TerminalSquare, Terminal as TerminalIcon } from 'lucide-react';
import { RiBarChartBoxLine, RiTerminalLine } from '@remixicon/react';
import { AnimatePresence, motion } from 'motion/react';
import DashboardView from './dashboard/DashboardView';
import HeaderDither from './HeaderDither';
import Sidebar from './Sidebar';
import StatsPill from './StatsPill';
import TabLabel, { type WorkingCli } from './TabLabel';
import CliLogo from './CliLogo';
import BraveLogo from './BraveLogo';
import ConfirmDialog from './ConfirmDialog';
import SettingsDialog from './SettingsDialog';
import NotifBanner from './NotifBanner';
import TerminalManager from './TerminalManager';
import type { Session, TerminalManagerHandle } from './TerminalManager';
import {
  fetchConfig, listSessions, createSession, deleteSession,
  listBrowsers, createBrowser, deleteBrowser, openBrowserUrl,
} from '../lib/api';
import { subscribePanelEvents } from '../lib/fileWatch';
import { toast } from 'sonner';
import { getTheme, setTheme, type Theme } from '../lib/theme';
import { isTouchCapable } from '../lib/device';
import { shellQuote } from '../lib/shell';
import { MobileDragProvider } from '../lib/mobileDrag';

interface Props {
  onLogout: () => void;
}

// Tab label = basename of the active pane's cwd (e.g. "AiChatB2B"), so the
// user can tell at a glance which terminal is running which repo. Falls back
// to "bash N" when the pane is at $HOME or cwd is unknown.
const HOME = '/home/void';
function nameFor(cwd: string | null | undefined, index: number, home = HOME): string {
  if (cwd && cwd !== home && cwd !== '/') {
    const base = cwd.replace(/\/+$/, '').split('/').pop();
    if (base) return base;
  }
  return `bash ${index}`;
}

// Tab name = page title from CDP (the same string you'd see in a real
// browser's tab) if known, otherwise "Browser N" (or "Browser N · mobile").
// The title is best-effort and arrives via the listBrowsers poll; until
// Brave finishes its first load, we show the placeholder so the tab strip
// never reads as blank. Truncate the title aggressively — tab cells are
// narrow and a full <title> can be a paragraph.
function browserNameFor(index: number, mode?: 'desktop' | 'mobile', title?: string): string {
  const cleaned = title?.trim();
  if (cleaned) {
    const flat = cleaned.replace(/\s+/g, ' ');
    return flat.length > 32 ? flat.slice(0, 30) + '…' : flat;
  }
  const base = `Browser ${index}`;
  return mode === 'mobile' ? `${base} · mobile` : base;
}

export default function Layout({ onLogout }: Props) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setThemeState] = useState<Theme>(getTheme());
  const [loading, setLoading] = useState(true);
  const [panelHome, setPanelHome] = useState(HOME);
  // Per-session agent state. Value is the running CLI name when busy ('claude'
  // / 'gemini' / 'codex') or undefined when idle, driven by TerminalTab's
  // buffer scanner. Sidebar/Tab labels read both the presence (working?) and
  // the value (which color) from the same map.
  const [workingMap, setWorkingMap] = useState<Record<string, WorkingCli>>({});
  const [unseenMap, setUnseenMap] = useState<Record<string, boolean>>({});
  // Sessions that are paused on a yes/no prompt. Driven by TerminalTab's
  // buffer scanner (same regex set as backend/busy.js so the tab indicator
  // and the push notification stay in sync). Mutually exclusive with
  // workingMap by construction — the scanner only flags waiting when busy
  // isn't, but we also gate explicitly in TabLabel for paranoia.
  const [attentionMap, setAttentionMap] = useState<Record<string, boolean>>({});
  // Grid view shows every open session simultaneously in a CSS-grid (column
  // count auto-fit from container width). Default off; persisted to
  // localStorage; auto-disabled below 640px because grid cells under that
  // width would be unreadable. The matchMedia listener below enforces the
  // narrow-screen rule one-way (only ever flips OFF — never re-enables on
  // grow, since that'd surprise users mid-session).
  const [gridMode, setGridMode] = useState<boolean>(() => {
    try { return localStorage.getItem('panel.gridMode') === '1'; } catch { return false; }
  });
  const terminalRef = useRef<TerminalManagerHandle>(null);
  // Ref to the actual content-area div (below header + tab bar, to the right
  // of the sidebar). We measure this — not `window.innerWidth/Height` —
  // when sizing a new browser instance, so the Brave framebuffer matches
  // the area the user will actually see, not the whole window.
  const contentRef = useRef<HTMLDivElement>(null);
  // Mirror of activeId for callbacks that need the *current* value without
  // re-binding on every change (e.g. handleWorkingChange — its identity must
  // be stable so the TerminalManager prop doesn't force a tab re-render).
  const activeIdRef = useRef<string | null>(activeId);
  activeIdRef.current = activeId;
  // Catches iPad (which lies about being a Mac) in addition to phones — see
  // lib/device.ts. Drives both the touch-affordances (mobile drawer trigger,
  // mobile-browser shortcut in Sidebar) and the tab-close confirmation.
  const [isTouch] = useState<boolean>(isTouchCapable);
  // Pending tab to close after touch confirmation. null = no dialog open.
  // Desktop bypasses this entirely — see the X-button handler below.
  const [closingSession, setClosingSession] = useState<Session | null>(null);
  // 'terminals' (default) vs 'dashboard'. Dashboard is a separate full-page
  // view inside <main> — the tab strip + terminals stay mounted (visually
  // hidden) so switching back doesn't kill any running CLI.
  const [view, setView] = useState<'terminals' | 'dashboard'>('terminals');

  const cdToFolder = useCallback((path: string) => {
    terminalRef.current?.send(`cd ${shellQuote(path)}\r`);
    setSidebarOpen(false);
  }, []);

  useEffect(() => {
    setTheme(theme);
  }, [theme]);

  useEffect(() => {
    try { localStorage.setItem('panel.gridMode', gridMode ? '1' : '0'); } catch { /* ignore */ }
  }, [gridMode]);

  // Persist the user's manual session order (from grid-mode drag-reorder) so
  // it survives a page refresh. Stored as an array of IDs; the initial load
  // below applies this order, appending any unknown/new IDs at the end.
  useEffect(() => {
    if (!sessions.length) return;
    try { localStorage.setItem('panel.sessionOrder', JSON.stringify(sessions.map((s) => s.id))); } catch { /* ignore */ }
  }, [sessions]);

  // Reorder handler used by the sortable grid in TerminalManager. Pure swap
  // of array indices — the order-persistence effect above writes it through
  // to localStorage on the same render.
  const reorderSessions = useCallback((fromId: string, toId: string) => {
    if (fromId === toId) return;
    setSessions((prev) => {
      const from = prev.findIndex((s) => s.id === fromId);
      const to = prev.findIndex((s) => s.id === toId);
      if (from < 0 || to < 0) return prev;
      const next = prev.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  // Phone-or-narrower guard. matchMedia only ever flips gridMode OFF — never
  // ON — so growing a window back doesn't surprise the user with a sudden
  // grid; they have to click the toggle themselves. Runs once on mount so a
  // stale "1" in localStorage on a phone load auto-clears immediately.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(min-width: 640px)');
    const enforce = () => { if (!mq.matches) setGridMode(false); };
    enforce();
    mq.addEventListener('change', enforce);
    return () => mq.removeEventListener('change', enforce);
  }, []);

  // The moment a tab becomes active, clear its "unseen completion" flag —
  // the user is now actively looking at it.
  useEffect(() => {
    if (!activeId) return;
    setUnseenMap((prev) => {
      if (!prev[activeId]) return prev;
      const next = { ...prev };
      delete next[activeId];
      return next;
    });
  }, [activeId]);

  // Garbage-collect per-session state when a session leaves the sessions
  // array. This is the authoritative cleanup path — closeSession + the
  // 5s refresh loop both go through `setSessions`, so any disappearance
  // funnels through here. Doing it reactively (not from TerminalTab's
  // unmount cleanup) means a parent JSX re-arrangement that unmount-then-
  // remounts a TerminalTab (e.g. toggling grid mode, which swaps the
  // GridView wrapper in/out) doesn't fire a fake busy→idle transition
  // and accidentally flip live tabs into the "unseen" shimmer state.
  useEffect(() => {
    const live = new Set(sessions.map((s) => s.id));
    const purge = <T,>(m: Record<string, T>): Record<string, T> => {
      let changed = false;
      const next: Record<string, T> = {};
      for (const [id, v] of Object.entries(m)) {
        if (live.has(id)) next[id] = v;
        else changed = true;
      }
      return changed ? next : m;
    };
    setWorkingMap((m) => purge(m));
    setUnseenMap((m) => purge(m));
    setAttentionMap((m) => purge(m));
  }, [sessions]);

  // Dynamic document.title: "<active tab> — Voidbunny", with a ● prefix
  // when an agent is running in the active tab and a (N) badge for other
  // tabs that finished work while you were elsewhere. Lets you tell
  // multiple panel windows apart in the browser/OS tab switcher.
  useEffect(() => {
    const active = sessions.find((s) => s.id === activeId);
    const name = active?.name;
    const working = activeId ? !!workingMap[activeId] : false;
    const unseenCount = Object.entries(unseenMap)
      .filter(([id, v]) => v && id !== activeId).length;
    const badge = unseenCount > 0 ? `(${unseenCount}) ` : '';
    const dot = working ? '● ' : '';
    document.title = name
      ? `${badge}${dot}${name} — Voidbunny`
      : `${badge}Voidbunny`;
  }, [activeId, sessions, workingMap, unseenMap]);

  // Receive working-state updates from each TerminalTab. A working→idle
  // transition on a non-active tab raises its "unseen" flag, which the
  // TabLabel renders as a shimmer until the user switches to that tab.
  const handleWorkingChange = useCallback((id: string, working: boolean, cli?: WorkingCli) => {
    setWorkingMap((prev) => {
      const prevCli = prev[id];
      const was = !!prevCli;
      const nextCli = working ? (cli ?? prevCli ?? 'claude') : undefined;
      if (was === working && prevCli === nextCli) return prev;
      const next = { ...prev };
      if (nextCli) next[id] = nextCli;
      else delete next[id];
      // Transition from busy → done while the user was elsewhere = "yo,
      // check this out". We dodge a stale-closure issue by reading the
      // current activeId off a ref that's updated on every render below.
      if (was && !working && activeIdRef.current !== id) {
        setUnseenMap((u) => (u[id] ? u : { ...u, [id]: true }));
      }
      return next;
    });
  }, []);

  // "Needs you" state per session. Real-time signal — when the user looks at
  // the tab, the prompt is right there, so we don't roll this into the unseen
  // shimmer. Just track the bool and let TabLabel render the amber crossfade.
  const handleAttentionChange = useCallback((id: string, attention: boolean) => {
    setAttentionMap((prev) => {
      const was = !!prev[id];
      if (was === attention) return prev;
      const next = { ...prev };
      if (attention) next[id] = true;
      else delete next[id];
      return next;
    });
  }, []);

  const toggleTheme = () => setThemeState((t) => (t === 'dark' ? 'light' : 'dark'));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [config, terms, browsers] = await Promise.all([fetchConfig(), listSessions(), listBrowsers()]);
        if (!cancelled) setPanelHome(config.home);
        if (cancelled) return;
        const sortedTerms = [...terms].sort((a, b) => a.created - b.created);
        const termSessions: Session[] = sortedTerms.map((s, i) => ({
          id: s.id, name: nameFor(s.cwd, i + 1, config.home), cwd: s.cwd, kind: 'terminal', cli: s.cli ?? null,
        }));
        const sortedBrowsers = [...browsers].sort((a, b) => a.createdAt - b.createdAt);
        const browserSessions: Session[] = sortedBrowsers.map((b, i) => ({
          id: b.id, name: browserNameFor(i + 1, b.mode, b.title), kind: 'browser', mode: b.mode,
        }));
        const combined = [...termSessions, ...browserSessions];

        if (termSessions.length === 0) {
          // Always make sure at least one terminal exists on first boot.
          const fresh = await createSession();
          if (cancelled) return;
          combined.unshift({ id: fresh.id, name: nameFor(fresh.cwd, 1, config.home), cwd: fresh.cwd, kind: 'terminal' });
        }
        // Apply any persisted manual order from a previous drag-reorder. Known
        // IDs come first in saved order; unknown/new IDs (sessions created
        // outside this client, or while the order was stale) append at the end.
        let savedOrder: string[] = [];
        try {
          const raw = localStorage.getItem('panel.sessionOrder');
          if (raw) savedOrder = JSON.parse(raw);
        } catch { /* ignore — bad JSON, fall back to default order */ }
        const idIndex = new Map(combined.map((s, i) => [s.id, i]));
        const ordered: Session[] = [];
        const used = new Set<string>();
        for (const id of savedOrder) {
          if (idIndex.has(id) && !used.has(id)) {
            ordered.push(combined[idIndex.get(id)!]);
            used.add(id);
          }
        }
        for (const s of combined) {
          if (!used.has(s.id)) ordered.push(s);
        }
        setSessions(ordered);
        setActiveId(ordered[ordered.length - 1].id);
      } catch (err) {
        console.error('failed to load sessions', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Poll the backend so tab labels update when the user `cd`s to a different
  // repo. Only runs while the tab is visible — no point burning requests on
  // a backgrounded mobile app. Refresh once on load and on every visibility-
  // change so you see the latest the moment you return to the tab.
  useEffect(() => {
    let cancelled = false;
    let interval: number | null = null;

    const refresh = async () => {
      try {
        const [terms, browsers] = await Promise.all([listSessions(), listBrowsers()]);
        if (cancelled) return;
        const sortedTerms = [...terms].sort((a, b) => a.created - b.created);
        const termById = new Map(sortedTerms.map((s) => [s.id, s]));
        const browserById = new Map(browsers.map((b) => [b.id, b]));
        setSessions((prev) => {
          // Zip server data onto current local ordering — preserves any
          // sessions still being created locally.
          let termIndex = 0;
          let browserIndex = 0;
          let changed = false;
          const next: Session[] = prev.map((p) => {
            if (p.kind === 'browser') {
              const fresh = browserById.get(p.id);
              // Drop browser entries that no longer exist on the server.
              if (!fresh) { changed = true; return null as unknown as Session; }
              const i = browserIndex++;
              const name = browserNameFor(i + 1, fresh.mode, fresh.title);
              if (name === p.name) return p;
              changed = true;
              return { ...p, name };
            }
            const i = termIndex++;
            const fresh = termById.get(p.id);
            if (!fresh) return p;
            const name = nameFor(fresh.cwd, i + 1, panelHome);
            const cli = fresh.cli ?? null;
            if (name === p.name && fresh.cwd === p.cwd && cli === (p.cli ?? null)) return p;
            changed = true;
            return { ...p, name, cwd: fresh.cwd, kind: 'terminal', cli };
          }).filter(Boolean) as Session[];
          // Append any server sessions we don't know about yet (created
          // from another tab / browser).
          for (const s of sortedTerms) {
            if (!next.some((p) => p.id === s.id)) {
              changed = true;
              const termCount = next.filter((p) => (p.kind ?? 'terminal') === 'terminal').length;
              next.push({ id: s.id, name: nameFor(s.cwd, termCount + 1, panelHome), cwd: s.cwd, kind: 'terminal', cli: s.cli ?? null });
            }
          }
          for (const b of browsers) {
            if (!next.some((p) => p.id === b.id)) {
              changed = true;
              const browserCount = next.filter((p) => p.kind === 'browser').length;
              next.push({ id: b.id, name: browserNameFor(browserCount + 1, b.mode, b.title), kind: 'browser', mode: b.mode });
            }
          }
          return changed ? next : prev;
        });
      } catch { /* transient — try again next tick */ }
    };

    const start = () => {
      if (interval != null) return;
      interval = window.setInterval(refresh, 5000);
    };
    const stop = () => {
      if (interval != null) { clearInterval(interval); interval = null; }
    };
    const onVis = () => {
      if (document.visibilityState === 'visible') { refresh(); start(); }
      else stop();
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [panelHome]);

  const newSession = useCallback(async () => {
    try {
      const fresh = await createSession();
      setSessions((prev) => {
        const termCount = prev.filter((p) => (p.kind ?? 'terminal') === 'terminal').length;
        const next: Session[] = [...prev, { id: fresh.id, name: nameFor(fresh.cwd, termCount + 1, panelHome), cwd: fresh.cwd, kind: 'terminal', cli: null }];
        return next;
      });
      setActiveId(fresh.id);
    } catch (err) {
      console.error('failed to create session', err);
    }
  }, [panelHome]);

  const newBrowser = useCallback(async (mode: 'desktop' | 'mobile' = 'desktop', url?: string) => {
    try {
      // Use the live content-area rect so the framebuffer matches the area
      // the user will actually see (sidebar + tab bar are already excluded
      // by the ref's position). The window-minus-84 fallback only fires if
      // the ref isn't mounted yet — vanishingly rare in practice.
      const rect = contentRef.current?.getBoundingClientRect();
      const containerW = Math.max(280, Math.round(rect?.width ?? Math.max(280, window.innerWidth)));
      const containerH = Math.max(280, Math.round(rect?.height ?? Math.max(280, window.innerHeight - 84)));
      const hostDpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);

      // In grid mode, estimate the slot this tab will land in instead of
      // booting at full content-area size — otherwise the new Brave window
      // renders huge for ~200 ms before BrowserTab's ResizeObserver tells
      // the backend to shrink it. Mirrors TerminalManager's cols math
      // (min(maxColsByWidth, ceil(√N))) and the 6 px gap (`gap-1.5`).
      let cellW = containerW;
      let cellH = containerH;
      if (gridMode && sessions.length >= 1) {
        const n = sessions.length + 1;
        const maxCols = Math.max(1, Math.floor(containerW / 360));
        const cols = Math.max(1, Math.min(maxCols, Math.ceil(Math.sqrt(n))));
        const rows = Math.ceil(n / cols);
        cellW = Math.max(280, Math.floor((containerW - 6 * (cols - 1)) / cols));
        cellH = Math.max(280, Math.floor((containerH - 6 * (rows - 1)) / rows));
      }

      // Framebuffer = (cell) container in physical pixels for both modes, so
      // noVNC does 1:1 (no scaling / letterboxing / "zoomed-out square" look).
      const fbW = Math.round(cellW * hostDpr);
      const fbH = Math.round(cellH * hostDpr);

      // Mobile vs desktop differ only in DSF — i.e. how Brave maps physical
      // → CSS pixels. Desktop = host DPR (so a CSS-pixel matches the user's
      // pixel). Mobile = framebuffer width / 412, so the CSS viewport stays
      // phone-width regardless of how big the user's panel is, which is
      // what triggers mobile layouts on responsive sites.
      const PHONE_CSS_W = 412;
      const dsf = mode === 'mobile'
        ? Math.max(1, Math.min(5, Math.round((fbW / PHONE_CSS_W) * 100) / 100))
        : hostDpr;
      const viewport = { width: fbW, height: fbH };
      const fresh = await createBrowser(mode, viewport, { theme, url, deviceScaleFactor: dsf });
      setSessions((prev) => {
        const browserCount = prev.filter((p) => p.kind === 'browser').length;
        const next: Session[] = [
          ...prev,
          { id: fresh.id, name: browserNameFor(browserCount + 1, mode), kind: 'browser', mode },
        ];
        return next;
      });
      setActiveId(fresh.id);
    } catch (err) {
      console.error('failed to create browser', err);
      // 429 from the backend means we hit the concurrency cap; surface it.
      alert(err instanceof Error ? err.message : 'failed to create browser');
    }
  }, [theme, gridMode, sessions]);

  // CLI shim → in-app Brave: backend opens the URL itself (via CDP) and
  // pushes a `panel-open` event with the resulting instance id. We just need
  // to surface the tab and switch focus. If the backend created a brand new
  // browser, optimistically add it to the local session list so the tab strip
  // updates instantly — the 5s session-list poll will reconcile its name
  // (page title) shortly after.
  //
  // We also surface a toast on both panel-open and panel-callback so the user
  // gets a clear "yes, the CLI talked to the panel" signal — without it,
  // OAuth flows like CodeRabbit's leave a long silent gap where the user
  // can't tell whether the URL routing succeeded or whether the callback
  // ever fired back to the CLI's loopback listener.
  useEffect(() => {
    return subscribePanelEvents((evt) => {
      if (evt.type === 'panel-open') {
        const id = evt.browserId;
        setSessions((prev) => {
          if (prev.some((s) => s.id === id)) return prev;
          const browserCount = prev.filter((p) => p.kind === 'browser').length;
          return [
            ...prev,
            { id, name: browserNameFor(browserCount + 1, evt.mode), kind: 'browser', mode: evt.mode },
          ];
        });
        setActiveId(id);
        let host = '';
        try { host = new URL(evt.url).host; } catch { /* leave blank */ }
        toast.success('Opened in panel browser', {
          description: host || evt.url,
          duration: 3000,
        });
        return;
      }
      if (evt.type === 'panel-callback') {
        // Bring the browser tab forward so the user can see what happened on
        // the callback page (success / consent / error). The CLI's local
        // listener has already heard the redirect — this toast is the
        // user-facing confirmation that the round-trip closed.
        setActiveId(evt.browserId);
        toast.success('Sign-in callback received', {
          description: evt.host,
          duration: 4000,
        });
        return;
      }
    });
  }, []);

  // Route terminal link clicks to the in-app Brave. We reuse the most-recent
  // Brave instance if one exists — opens the URL as a new tab inside it —
  // rather than spawning a fresh Xvfb+Brave+x11vnc triplet per click (each is
  // ~250 MB and the backend caps at 3). With no instances we create one and
  // hand the URL in so the very first tab loads it directly.
  const openUrlInBrave = useCallback(async (url: string) => {
    const browsers = sessions.filter((s) => s.kind === 'browser');
    if (browsers.length > 0) {
      const target = browsers[browsers.length - 1];
      setActiveId(target.id);
      try {
        await openBrowserUrl(target.id, url);
      } catch (err) {
        console.error('failed to open url in browser', err);
        alert(err instanceof Error ? err.message : 'failed to open url in browser');
      }
      return;
    }
    await newBrowser('desktop', url);
  }, [sessions, newBrowser]);

  const closeSession = useCallback(async (id: string) => {
    const target = sessions.find((s) => s.id === id);
    const isBrowser = target?.kind === 'browser';
    try {
      if (isBrowser) await deleteBrowser(id);
      else await deleteSession(id);
    } catch (err) {
      console.error('failed to delete session', err);
    }
    setWorkingMap((m) => {
      if (!m[id]) return m;
      const next = { ...m };
      delete next[id];
      return next;
    });
    setUnseenMap((m) => {
      if (!m[id]) return m;
      const next = { ...m };
      delete next[id];
      return next;
    });
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      const hasTerminal = next.some((s) => (s.kind ?? 'terminal') === 'terminal');
      if (!hasTerminal) {
        // No terminals left — auto-spawn one so the app is never empty.
        createSession()
          .then((fresh) => {
            const newTerm: Session = { id: fresh.id, name: nameFor(fresh.cwd, 1, panelHome), cwd: fresh.cwd, kind: 'terminal', cli: null };
            setSessions((curr) => [...curr, newTerm]);
            setActiveId(fresh.id);
          })
          .catch((err) => console.error('failed to spawn replacement session', err));
      }
      if (id === activeId && next.length > 0) setActiveId(next[next.length - 1].id);
      return next;
    });
  }, [activeId, sessions, panelHome]);

  return (
    // Touch drag-drop pipeline. Mobile browsers don't translate touch into
    // HTML5 dragstart/drop events, so the sidebar→terminal file-drag is dead
    // on phones unless we run a parallel touch-event flow. The provider also
    // owns the floating ghost (portaled to body) and auto-closes the mobile
    // sidebar drawer when a drag begins, so the user can actually see the
    // drop target instead of staring at the open drawer.
    <MobileDragProvider onDragStart={() => setSidebarOpen(false)}>
    <div className="h-dvh flex flex-col bg-panel-bg text-panel-text">
      {/* Height grows to 3rem + safe-area-inset-top so iOS PWA notch padding
          doesn't eat into the h-12 row (box-sizing: border-box would otherwise
          squash the header content into the tab bar below it). */}
      <header
        className="relative flex items-center justify-between px-3 sm:px-4 border-b border-panel-border bg-panel-surface flex-shrink-0 z-30 sticky top-0 overflow-hidden"
        style={{
          paddingTop: 'env(safe-area-inset-top)',
          height: 'calc(3rem + env(safe-area-inset-top))',
        }}
      >
        <HeaderDither />
        <div className="relative z-10 flex items-center gap-2">
          <button
            onClick={() => setSidebarOpen(true)}
            className="sm:hidden p-1.5 -ml-1.5 text-panel-muted hover:text-panel-text"
            aria-label="Open sidebar"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="text-base font-semibold tracking-wide">Panel</span>
        </div>
        {/* Centered bunny mark — absolute so the left/right groups stay anchored
            to their edges and don't push the logo off-center. The `top` calc
            centers it inside the 3rem content row instead of the full header
            height; without this the logo drifts up under the iPhone Dynamic
            Island as the safe-area-inset-top grows. */}
        <img
          src="/logo-48.webp"
          alt="voidbunny"
          width={24}
          height={24}
          draggable={false}
          style={{ top: 'calc(env(safe-area-inset-top) + 1.5rem)' }}
          className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 z-10 pointer-events-none select-none"
        />
        <div className="relative z-10 flex items-center gap-2">
          <button
            onClick={() => setView((v) => (v === 'dashboard' ? 'terminals' : 'dashboard'))}
            className="p-1.5 text-panel-muted hover:text-panel-text"
            aria-label={view === 'dashboard' ? 'Show terminals' : 'Show dashboard'}
            title={view === 'dashboard' ? 'Back to terminals' : 'Activity dashboard'}
          >
            {view === 'dashboard'
              ? <RiTerminalLine className="w-4 h-4" />
              : <RiBarChartBoxLine className="w-4 h-4" />}
          </button>
          <StatsPill />
          <button
            onClick={toggleTheme}
            className="p-1.5 text-panel-muted hover:text-panel-text"
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </header>

      <div className="flex-1 flex min-h-0 relative">
        <aside className="hidden sm:flex w-64 border-r border-panel-border bg-panel-surface flex-col flex-shrink-0">
          <Sidebar
            sessions={sessions}
            homePath={panelHome}
            activeId={activeId}
            isTouch={isTouch}
            workingMap={workingMap}
            unseenMap={unseenMap}
            attentionMap={attentionMap}
            gridMode={gridMode}
            onToggleGridMode={() => setGridMode((g) => !g)}
            onSelectSession={setActiveId}
            onNewSession={newSession}
            onNewBrowser={newBrowser}
            onCloseSession={closeSession}
            onLogout={onLogout}
            onOpenSettings={() => setSettingsOpen(true)}
            onCdFolder={cdToFolder}
          />
        </aside>

        <AnimatePresence>
          {sidebarOpen && (
            // Edge-to-edge wrapper. Safe-area inset is intentionally NOT
            // applied here — the backdrop and the drawer panel must extend
            // under the iOS status bar / Dynamic Island so the PWA doesn't
            // show an empty strip above the drawer. The inset is consumed
            // inside the drawer header below instead.
            <div className="sm:hidden fixed inset-0 z-50 flex">
              <motion.div
                className="absolute inset-0 bg-black/60"
                onClick={() => setSidebarOpen(false)}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
              />
              <motion.aside
                className="relative w-72 max-w-[85vw] bg-panel-surface border-r border-panel-border flex flex-col will-change-transform overflow-hidden"
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ type: 'spring', stiffness: 380, damping: 38, mass: 0.9 }}
              >
                {/* Ambient dither shader behind the drawer content — same
                    component as the main header but with a gray tint in light
                    mode. The orange tint used in the header was drowning the
                    file-tree text against the near-white drawer surface; gray
                    recedes behind text while keeping the texture. Folder
                    titles in FileTree are tinted brand-orange in light mode
                    to pick up the brand colour the dither lost. */}
                <HeaderDither tint="gray" />
                <div className="relative z-10 flex-1 flex flex-col min-h-0">
                  {/* Mirror the main header's safe-area handling so the drawer's
                      "Panel" title bar lines up with the row underneath the
                      Dynamic Island instead of being clipped by it. */}
                  <div
                    className="flex items-center justify-between px-3 border-b border-panel-border flex-shrink-0"
                    style={{
                      paddingTop: 'env(safe-area-inset-top)',
                      height: 'calc(3rem + env(safe-area-inset-top))',
                    }}
                  >
                    <span className="text-base font-semibold tracking-wide">Panel</span>
                    <button
                      onClick={() => setSidebarOpen(false)}
                      className="p-1 text-panel-muted hover:text-panel-text"
                      aria-label="Close sidebar"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  <Sidebar
                    sessions={sessions}
                    homePath={panelHome}
                    activeId={activeId}
                    isTouch={isTouch}
                    workingMap={workingMap}
                    unseenMap={unseenMap}
                    attentionMap={attentionMap}
                    gridMode={gridMode}
                    onToggleGridMode={() => setGridMode((g) => !g)}
                    onSelectSession={(id) => { setActiveId(id); setSidebarOpen(false); }}
                    onNewSession={async () => { await newSession(); setSidebarOpen(false); }}
                    onNewBrowser={async (mode) => { await newBrowser(mode); setSidebarOpen(false); }}
                    onCloseSession={closeSession}
                    onLogout={() => { setSidebarOpen(false); onLogout(); }}
                    onOpenSettings={() => { setSidebarOpen(false); setSettingsOpen(true); }}
                    onCdFolder={cdToFolder}
                  />
                </div>
              </motion.aside>
            </div>
          )}
        </AnimatePresence>

        <main className="flex-1 flex flex-col min-w-0 relative">
          {/* Dashboard overlay. Terminals + tab strip stay mounted below it
              (hidden by absolute positioning) so any running CLI keeps
              ticking — switching back to terminals shows the live buffer. */}
          {view === 'dashboard' && (
            // z-30 so we cover the TerminalTab's "Select" pill (z-20) and
            // the desktop copy-selection pill (also z-20) — otherwise they
            // bleed through into the dashboard's upper-right corner.
            <div className="absolute inset-0 z-30 bg-panel-bg overflow-hidden">
              <DashboardView onCdFolder={(p) => { setView('terminals'); cdToFolder(p); }} />
            </div>
          )}
          <div className="flex items-stretch h-9 border-b border-panel-border bg-panel-surface overflow-x-auto scrollbar-none scroll-smooth overscroll-x-contain flex-shrink-0">
            {sessions.map((s) => {
              const cli = s.cli ?? workingMap[s.id];
              return (
                <button
                  key={s.id}
                  onClick={() => setActiveId(s.id)}
                  className={`flex items-center gap-2 px-3 text-xs font-mono border-r border-panel-border whitespace-nowrap ${
                    s.id === activeId
                      ? 'bg-panel-bg text-panel-text'
                      : 'text-panel-muted hover:text-panel-text'
                  }`}
                >
                  {s.kind === 'browser'
                    ? <BraveLogo className="w-3.5 h-3.5 flex-shrink-0" />
                    : cli
                      ? <CliLogo cli={cli} />
                      : <TerminalIcon className="w-3.5 h-3.5 flex-shrink-0" />}
                  <TabLabel
                    name={s.name}
                    working={!!workingMap[s.id]}
                    cli={workingMap[s.id]}
                    unseen={!!unseenMap[s.id]}
                    attention={!!attentionMap[s.id]}
                  />
                  <span
                    role="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      // Touch users: confirm first — the X is small and easy
                      // to hit by accident while scrolling the tab strip.
                      // Desktop: keep the one-click close so a real pointer
                      // doesn't pay the friction it doesn't need.
                      if (isTouch) setClosingSession(s);
                      else closeSession(s.id);
                    }}
                    className="text-panel-muted hover:text-panel-danger p-1 -m-1"
                    aria-label={`Close ${s.name}`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </span>
                </button>
              );
            })}
            <button
              onClick={newSession}
              className="flex items-center justify-center gap-1 px-2.5 text-panel-muted hover:text-panel-text border-r border-panel-border"
              aria-label="New terminal"
              title="New terminal"
            >
              <Plus className="w-3.5 h-3.5" />
              <TerminalSquare className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => newBrowser()}
              className="flex items-center justify-center gap-1 px-2.5 text-panel-muted hover:text-panel-text border-r border-panel-border"
              aria-label="New browser"
              title="New browser"
            >
              <Plus className="w-3.5 h-3.5" />
              <BraveLogo className="w-3.5 h-3.5" />
            </button>
          </div>

          <div ref={contentRef} className="flex-1 min-h-0">
            {!loading && activeId && (
              <TerminalManager
                ref={terminalRef}
                sessions={sessions}
                activeId={activeId}
                // Grid-of-one is silly — auto-collapse to single while only one
                // session exists. Toggle preference stays "on" so adding a new
                // tab re-grids immediately.
                gridMode={gridMode && sessions.length > 1}
                onSelectSession={setActiveId}
                onOpenUrl={openUrlInBrave}
                onWorkingChange={handleWorkingChange}
                onAttentionChange={handleAttentionChange}
                onReorderSessions={reorderSessions}
              />
            )}
            {loading && (
              <div className="h-full flex items-center justify-center text-sm text-panel-muted font-mono">
                loading sessions…
              </div>
            )}
          </div>
        </main>
      </div>

      {/* Tab-close confirmation. Touch-only — opens when isTouch=true on the
          X button. Wrapping in AnimatePresence so the dialog can play its
          exit transition on Cancel/Confirm instead of unmounting instantly. */}
      <AnimatePresence>
        {closingSession && (
          <ConfirmDialog
            title={`Close this ${closingSession.kind === 'browser' ? 'browser tab' : 'terminal session'}?`}
            description={
              <>
                <span className="font-mono text-panel-text">{closingSession.name}</span> will end.
                {closingSession.kind === 'browser'
                  ? ' Any open pages in this browser will be lost.'
                  : ' Anything still running in the shell will be killed.'}
              </>
            }
            confirmLabel="Close"
            onClose={() => setClosingSession(null)}
            onConfirm={() => {
              const id = closingSession.id;
              setClosingSession(null);
              closeSession(id);
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      </AnimatePresence>

      <NotifBanner onOpenSettings={() => setSettingsOpen(true)} />
    </div>
    </MobileDragProvider>
  );
}

