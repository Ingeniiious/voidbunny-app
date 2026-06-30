import { useEffect, useMemo, useRef, useState } from 'react';
import { Menu, X, Sun, Moon, Terminal as TerminalIcon, Plus, TerminalSquare } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import HeaderDither from './HeaderDither';
import Sidebar from './Sidebar';
import StatsPill from './StatsPill';
import TabLabel, { type WorkingCli } from './TabLabel';
import CliLogo from './CliLogo';
import BraveLogo from './BraveLogo';
import MockTerminalTab from './MockTerminalTab';
import MockBrowserTab from './MockBrowserTab';
import KeyBar from './KeyBar';
import { GripIcon } from './GridViewIcons';
import { getTheme, setTheme, type Theme } from '../lib/theme';
import type { Session } from './TerminalManager';

// `?mock=1` showcase: real Layout chrome (header, sidebar, tab strip,
// KeyBar) rendered against a fixed set of mocked sessions in grid mode.
// Used by the marketing site to capture device screenshots — keep this
// file in sync with Layout.tsx's JSX so the mock stays representative.

interface MockSession extends Session {
  // pre-baked terminal buffer (xterm.write input) or browser iframe src.
  content?: string;
  src?: string;
  // CLI hint already injected as Session.cli; this is the WorkingCli value
  // for the pulsing badge / shimmer state.
  working?: WorkingCli;
}

const MOCK_SESSIONS: MockSession[] = [
  {
    id: 'mock-claude',
    name: 'voidbunny-app',
    kind: 'terminal',
    cwd: '/home/void/voidbunny-app',
    cli: 'claude',
    working: 'claude',
    content:
      '\x1b[90mvoid@bunny\x1b[0m:\x1b[34m~/voidbunny-app\x1b[0m$ claude\r\n' +
      '\x1b[38;5;209m✻ Welcome to Claude Code!\x1b[0m\r\n' +
      '\x1b[90m   /help for help, /status for your current setup\x1b[0m\r\n' +
      '\x1b[90m   cwd: /home/void/voidbunny-app\x1b[0m\r\n' +
      '\r\n' +
      '\x1b[38;5;208m●\x1b[0m \x1b[38;5;209mReading\x1b[0m \x1b[90msite/public/install.sh (127 lines)\x1b[0m\r\n' +
      '\x1b[38;5;208m●\x1b[0m \x1b[38;5;209mGrep\x1b[0m  \x1b[90m"PANEL_PASSWORD" — 4 matches in 3 files\x1b[0m\r\n' +
      '\x1b[38;5;208m●\x1b[0m \x1b[38;5;209mEdit\x1b[0m  \x1b[90msite/public/install.sh\x1b[0m \x1b[32m+114\x1b[0m \x1b[31m−13\x1b[0m\r\n' +
      '\x1b[38;5;208m●\x1b[0m \x1b[38;5;209mEdit\x1b[0m  \x1b[90mdeploy/panel.service\x1b[0m \x1b[32m+6\x1b[0m \x1b[31m−1\x1b[0m\r\n' +
      '\x1b[38;5;208m●\x1b[0m \x1b[38;5;209mBash\x1b[0m  \x1b[90mnpm run typecheck\x1b[0m\r\n' +
      '  \x1b[32m✓\x1b[0m \x1b[90mno errors in 1.4s\x1b[0m\r\n' +
      '\x1b[38;5;208m●\x1b[0m \x1b[38;5;209mBash\x1b[0m  \x1b[90mbash -n site/public/install.sh\x1b[0m\r\n' +
      '  \x1b[32m✓\x1b[0m \x1b[90msyntax ok\x1b[0m\r\n' +
      '\r\n' +
      '\x1b[38;5;208m●\x1b[0m Wired the one-line installer: pins the GitHub\r\n' +
      '  tarball at \x1b[32mv0.1.0\x1b[0m, bcrypt-prompts for the\r\n' +
      '  panel password before writing \x1b[90m.env\x1b[0m, and POSTs\r\n' +
      '  a no-PII install hit so the live counter on\r\n' +
      '  \x1b[90m/stats\x1b[0m ticks. Ready for review.\r\n' +
      '\r\n' +
      '\x1b[90m> \x1b[0m\x1b[7m \x1b[0m\r\n' +
      '\x1b[90m  esc to interrupt\x1b[0m',
  },
  {
    id: 'mock-codex',
    name: 'deploy-scripts',
    kind: 'terminal',
    cwd: '/home/void/deploy-scripts',
    cli: 'codex',
    working: 'codex',
    content:
      '\x1b[90mvoid@bunny\x1b[0m:\x1b[34m~/deploy-scripts\x1b[0m$ codex\r\n' +
      '\x1b[38;5;42m┌─ codex-cli 0.130.0 ─────────────────┐\x1b[0m\r\n' +
      '\x1b[38;5;42m│\x1b[0m signed in as void@bunny             \x1b[38;5;42m│\x1b[0m\r\n' +
      '\x1b[38;5;42m│\x1b[0m cwd: ~/deploy-scripts                \x1b[38;5;42m│\x1b[0m\r\n' +
      '\x1b[38;5;42m└──────────────────────────────────────┘\x1b[0m\r\n' +
      '\r\n' +
      '\x1b[38;5;42m▸ user\x1b[0m\r\n' +
      '  harden the systemd unit for the panel\r\n' +
      '\r\n' +
      '\x1b[38;5;42m▸ codex\x1b[0m\r\n' +
      '  Patching \x1b[90mdeploy/panel.service\x1b[0m:\r\n' +
      '\r\n' +
      '  \x1b[32m+ ProtectKernelTunables=true\x1b[0m\r\n' +
      '  \x1b[32m+ ProtectKernelModules=true\x1b[0m\r\n' +
      '  \x1b[32m+ RestrictSUIDSGID=true\x1b[0m\r\n' +
      '  \x1b[32m+ LockPersonality=true\x1b[0m\r\n' +
      '  \x1b[31m- ReadWritePaths=/home/void /tmp\x1b[0m\r\n' +
      '  \x1b[32m+ ReadWritePaths=/home/void\x1b[0m\r\n' +
      '\r\n' +
      '  Tightens the unit to fail closed if a child\r\n' +
      '  tries to load a kernel module or escalate\r\n' +
      '  SUID. PrivateTmp=true already covers /tmp.\r\n' +
      '\r\n' +
      '  \x1b[90mapply patch?  [y]es  [n]o  [d]iff\x1b[0m\r\n' +
      '\x1b[90m  esc to interrupt\x1b[0m',
  },
  {
    id: 'mock-gemini',
    name: 'site',
    kind: 'terminal',
    cwd: '/home/void/voidbunny-app/site',
    cli: 'gemini',
    working: 'gemini',
    content:
      '\x1b[90mvoid@bunny\x1b[0m:\x1b[34m~/voidbunny-app/site\x1b[0m$ gemini\r\n' +
      '\x1b[38;5;141m ✦  Gemini 0.42.0\x1b[0m     \x1b[90mmodel: 2.5-pro\x1b[0m\r\n' +
      '\x1b[90m────────────────────────────────────────\x1b[0m\r\n' +
      '\r\n' +
      '\x1b[38;5;141m›\x1b[0m rewrite the landing-page hero to lead\r\n' +
      '  with "no API keys, just your subscription"\r\n' +
      '\r\n' +
      '\x1b[38;5;141m✦\x1b[0m Drafted three variants in \x1b[90mcomponents/hero.tsx\x1b[0m.\r\n' +
      '  Showing variant A vs current:\r\n' +
      '\r\n' +
      '\x1b[31m-   Self-host a control panel for your dev box.\x1b[0m\r\n' +
      '\x1b[32m+   No API keys. Plug in your Claude,\x1b[0m\r\n' +
      '\x1b[32m+   ChatGPT, or Gemini subscription and\x1b[0m\r\n' +
      '\x1b[32m+   ssh from any tab on any device.\x1b[0m\r\n' +
      '\r\n' +
      '  Variant B leans on the multi-agent angle,\r\n' +
      '  variant C on the mobile-first angle.\r\n' +
      '\r\n' +
      '\x1b[90m  [a] apply A   [b] variant B   [c] variant C\x1b[0m\r\n' +
      '\x1b[90m  (esc to cancel, 12s)\x1b[0m',
  },
  {
    id: 'mock-browser',
    name: 'Browser 1',
    kind: 'browser',
    mode: 'desktop',
    // Param `?mock_browser_src=` lets the screenshot script override the URL
    // (e.g. point at a local Next dev server). Default = live marketing site.
    src: (typeof window !== 'undefined'
      && new URLSearchParams(window.location.search).get('mock_browser_src'))
      || 'https://voidbunny.xyz/',
  },
];

export default function MockApp() {
  const [theme, setThemeState] = useState<Theme>(getTheme());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeId, setActiveId] = useState<string>('mock-codex');
  // Mirror Layout's matchMedia gate: grid is meaningless below 640px and the
  // real panel auto-flips to single view there. Without this the mobile
  // screenshot shows cells stacked off the bottom of the viewport and the
  // KeyBar disappears below the fold.
  const [isWide, setIsWide] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(min-width: 640px)');
    const onChange = () => setIsWide(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const gridMode = isWide;
  const sessions = useMemo<MockSession[]>(() => MOCK_SESSIONS, []);
  const workingMap = useMemo<Record<string, WorkingCli>>(() => {
    const out: Record<string, WorkingCli> = {};
    for (const s of sessions) {
      if (s.working) out[s.id] = s.working;
    }
    return out;
  }, [sessions]);
  const unseenMap = {} as Record<string, boolean>;

  useEffect(() => { setTheme(theme); }, [theme]);

  const toggleTheme = () => setThemeState((t) => (t === 'dark' ? 'light' : 'dark'));
  const noop = () => {};
  const noopAsync = async () => {};

  return (
    <div className="h-dvh flex flex-col bg-panel-bg text-panel-text">
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
            homePath="/home/void"
            activeId={activeId}
            isTouch={false}
            workingMap={workingMap}
            unseenMap={unseenMap}
            gridMode={true}
            onToggleGridMode={noop}
            onSelectSession={setActiveId}
            onNewSession={noopAsync}
            onNewBrowser={noopAsync}
            onCloseSession={noop}
            onLogout={noop}
            onOpenSettings={noop}
            onCdFolder={noop}
          />
        </aside>

        <AnimatePresence>
          {sidebarOpen && (
            <div className="sm:hidden fixed inset-0 z-50 flex">
              <motion.div
                className="absolute inset-0 bg-black/60"
                onClick={() => setSidebarOpen(false)}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              />
              <motion.aside
                className="relative w-72 max-w-[85vw] bg-panel-surface border-r border-panel-border flex flex-col will-change-transform overflow-hidden"
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ type: 'spring', stiffness: 380, damping: 38 }}
              >
                <HeaderDither tint="gray" />
                <div className="relative z-10 flex-1 flex flex-col min-h-0">
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
                    homePath="/home/void"
                    activeId={activeId}
                    isTouch={true}
                    workingMap={workingMap}
                    unseenMap={unseenMap}
                    gridMode={false}
                    onToggleGridMode={noop}
                    onSelectSession={(id) => { setActiveId(id); setSidebarOpen(false); }}
                    onNewSession={noopAsync}
                    onNewBrowser={noopAsync}
                    onCloseSession={noop}
                    onLogout={noop}
                    onOpenSettings={noop}
                    onCdFolder={noop}
                  />
                </div>
              </motion.aside>
            </div>
          )}
        </AnimatePresence>

        <main className="flex-1 flex flex-col min-w-0">
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
                  />
                  <span
                    role="button"
                    onClick={(e) => { e.stopPropagation(); }}
                    className="text-panel-muted hover:text-panel-danger p-1 -m-1"
                    aria-label={`Close ${s.name}`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </span>
                </button>
              );
            })}
            <button
              className="flex items-center justify-center gap-1 px-2.5 text-panel-muted hover:text-panel-text border-r border-panel-border"
              aria-label="New terminal"
              title="New terminal"
            >
              <Plus className="w-3.5 h-3.5" />
              <TerminalSquare className="w-3.5 h-3.5" />
            </button>
            <button
              className="flex items-center justify-center gap-1 px-2.5 text-panel-muted hover:text-panel-text border-r border-panel-border"
              aria-label="New browser"
              title="New browser"
            >
              <Plus className="w-3.5 h-3.5" />
              <BraveLogo className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex-1 min-h-0">
            <MockGrid
              sessions={sessions}
              activeId={activeId}
              gridMode={gridMode}
              onSelect={setActiveId}
            />
          </div>
        </main>
      </div>
    </div>
  );
}

interface MockGridProps {
  sessions: MockSession[];
  activeId: string;
  gridMode: boolean;
  onSelect: (id: string) => void;
}

function MockGrid({ sessions, activeId, gridMode, onSelect }: MockGridProps) {
  // Mirror TerminalManager's GridView shape: row-bucketed flex grid with
  // cols = ceil(sqrt(N)) when wide enough; KeyBar pinned at the bottom.
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setContainerWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rows = useMemo(() => {
    const n = sessions.length;
    if (!n) return [] as MockSession[][];
    const maxCols = containerWidth > 0 ? Math.max(1, Math.floor(containerWidth / 360)) : Math.ceil(Math.sqrt(n));
    const cols = Math.max(1, Math.min(maxCols, Math.ceil(Math.sqrt(n))));
    const out: MockSession[][] = [];
    for (let i = 0; i < n; i += cols) out.push(sessions.slice(i, i + cols));
    return out;
  }, [sessions, containerWidth]);

  // When gridMode is off (phone breakpoint), render only the active session
  // edge-to-edge so the KeyBar fits below the fold the same way the real
  // Layout does on mobile.
  const active = sessions.find((s) => s.id === activeId) ?? sessions[0];

  return (
    <div className="w-full h-full flex flex-col">
      {gridMode ? (
        <div ref={containerRef} className="flex-1 min-h-0 overflow-y-auto p-1.5">
          <div className="flex flex-col gap-1.5 h-full">
            {rows.map((row, rowIdx) => (
              <div key={rowIdx} className="flex gap-1.5 flex-1 min-h-0" style={{ minHeight: 240 }}>
                {row.map((s) => {
                  const isActive = s.id === activeId;
                  return (
                    <div
                      key={s.id}
                      onMouseDown={() => onSelect(s.id)}
                      className={`group relative flex-1 min-w-0 min-h-0 rounded-md overflow-hidden border transition-colors ${
                        isActive
                          ? 'border-orange-500 ring-2 ring-orange-500/50'
                          : 'border-panel-border hover:border-panel-muted'
                      }`}
                    >
                      {s.kind === 'browser' && s.src
                        ? <MockBrowserTab src={s.src} />
                        : <MockTerminalTab content={s.content ?? ''} cursorBlink={isActive} />}
                      <button
                        type="button"
                        aria-label={`Drag ${s.name}`}
                        title="Drag to reorder"
                        className={`absolute top-1 right-1 z-10 flex items-center justify-center w-6 h-6 rounded bg-panel-surface/80 backdrop-blur-sm border ${
                          isActive
                            ? 'text-orange-500 border-orange-500/60'
                            : 'text-panel-muted border-panel-border'
                        }`}
                      >
                        <GripIcon size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="relative flex-1 min-h-0">
          {active && (active.kind === 'browser' && active.src
            ? <MockBrowserTab src={active.src} />
            : <MockTerminalTab content={active.content ?? ''} cursorBlink={true} />)}
        </div>
      )}
      <KeyBar onSend={() => {}} activeCwd={null} />
    </div>
  );
}
