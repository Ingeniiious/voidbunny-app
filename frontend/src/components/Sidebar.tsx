import { useEffect, useRef, useState } from 'react';
import { X, Terminal as TerminalIcon, LogOut, Smartphone, Search, File as FileIcon, Eye, EyeOff, Settings as SettingsIcon } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import FileTree, { FilePreview } from './FileTree';
import TabLabel, { type WorkingCli } from './TabLabel';
import CliLogo from './CliLogo';
import BraveLogo from './BraveLogo';
import ConfirmDialog from './ConfirmDialog';
import { GridViewIcon, SingleViewIcon } from './GridViewIcons';
import type { Session } from './TerminalManager';
import { searchFiles, type SearchHit, type SearchMode } from '../lib/api';

const SHOW_HIDDEN_KEY = 'panel.fileTree.showHidden';

function readShowHidden(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(SHOW_HIDDEN_KEY) === '1';
}

interface Props {
  sessions: Session[];
  homePath: string;
  activeId: string | null;
  isTouch?: boolean;
  workingMap?: Record<string, WorkingCli>;
  unseenMap?: Record<string, boolean>;
  attentionMap?: Record<string, boolean>;
  gridMode?: boolean;
  onToggleGridMode?: () => void;
  onSelectSession: (id: string) => void;
  onNewSession: () => void | Promise<void>;
  onNewBrowser: (mode?: 'desktop' | 'mobile') => void | Promise<void>;
  onCloseSession: (id: string) => void;
  onLogout: () => void;
  onOpenSettings: () => void;
  onCdFolder?: (path: string) => void;
}

export default function Sidebar({ sessions, homePath, activeId, isTouch, workingMap, unseenMap, attentionMap, gridMode, onToggleGridMode, onSelectSession, onNewSession, onNewBrowser, onCloseSession, onLogout, onOpenSettings, onCdFolder }: Props) {
  const [confirmLogout, setConfirmLogout] = useState(false);

  const iconBtn = 'flex items-center justify-center h-9 w-9 flex-shrink-0 rounded-md bg-panel-bg border border-panel-border transition-colors';

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-2 py-2 border-b border-panel-border flex items-center gap-0.5">
        <button
          type="button"
          onClick={onOpenSettings}
          title="Settings"
          aria-label="Settings"
          className={`${iconBtn} text-panel-muted hover:border-panel-text hover:text-panel-text`}
        >
          <SettingsIcon className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => setConfirmLogout(true)}
          title="Log out"
          aria-label="Log out"
          className={`${iconBtn} text-panel-muted hover:border-panel-danger hover:text-panel-danger`}
        >
          <LogOut className="w-4 h-4" />
        </button>
        <div className="mx-0.5 h-5 w-px bg-panel-border" aria-hidden />
        <button
          type="button"
          onClick={onNewSession}
          title="New terminal"
          aria-label="New terminal"
          className={`${iconBtn} text-panel-text hover:border-panel-text`}
        >
          <TerminalIcon className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => onNewBrowser('desktop')}
          title="New browser"
          aria-label="New browser"
          className={`${iconBtn} text-panel-text hover:border-panel-text`}
        >
          <BraveLogo className="w-4 h-4" />
        </button>
        {isTouch && (
          <button
            type="button"
            onClick={() => onNewBrowser('mobile')}
            title="New mobile browser"
            aria-label="New mobile browser"
            className={`${iconBtn} text-panel-text hover:border-panel-text`}
          >
            <Smartphone className="w-4 h-4" />
          </button>
        )}
        {/* Grid/single view toggle. Lives here (not in the tab strip) so all
            view-mode controls cluster with Logout/New-*. Hidden until there
            are at least two sessions — grid-of-one is meaningless. */}
        {onToggleGridMode && sessions.length >= 2 && (
          <button
            type="button"
            onClick={onToggleGridMode}
            title={gridMode ? 'Switch to single view' : 'Switch to grid view'}
            aria-label={gridMode ? 'Switch to single view' : 'Switch to grid view'}
            aria-pressed={!!gridMode}
            className={`${iconBtn} ${
              gridMode
                ? 'border-orange-500/60 text-orange-500 hover:border-orange-500'
                : 'text-panel-text hover:border-panel-text'
            }`}
          >
            {gridMode ? <SingleViewIcon size={16} /> : <GridViewIcon size={16} />}
          </button>
        )}
      </div>

      <div className="px-2 py-2 border-b border-panel-border">
        <div className="px-1 text-[10px] uppercase tracking-wider text-panel-muted mb-1.5 font-mono">
          Sessions
        </div>
        {sessions.map((s) => (
          <div
            key={s.id}
            onClick={() => onSelectSession(s.id)}
            className={`group flex items-center gap-2 px-2 py-1 rounded text-sm font-mono cursor-pointer ${
              s.id === activeId
                ? 'bg-panel-bg text-panel-text'
                : 'text-panel-muted hover:bg-panel-bg/50 hover:text-panel-text'
            }`}
          >
            {s.kind === 'browser'
              ? <BraveLogo className="w-3.5 h-3.5 flex-shrink-0" />
              : (s.cli ?? workingMap?.[s.id])
                ? <CliLogo cli={(s.cli ?? workingMap![s.id])!} />
                : <TerminalIcon className="w-3.5 h-3.5 flex-shrink-0" />}
            <span className="flex-1 truncate">
              <TabLabel
                name={s.name}
                working={!!workingMap?.[s.id]}
                cli={workingMap?.[s.id]}
                unseen={!!unseenMap?.[s.id]}
                attention={!!attentionMap?.[s.id]}
              />
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onCloseSession(s.id); }}
              className="opacity-0 group-hover:opacity-100 text-panel-muted hover:text-panel-danger"
              aria-label={`Close ${s.name}`}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      <FileSearchPanel homePath={homePath} onCdFolder={onCdFolder} />

      <AnimatePresence>
        {confirmLogout && (
          <ConfirmDialog
            title="Log out?"
            description="You'll need to re-enter your password to get back in. Open terminal sessions stay alive."
            confirmLabel="Log out"
            onClose={() => setConfirmLogout(false)}
            onConfirm={() => { setConfirmLogout(false); onLogout(); }}
          />
        )}
      </AnimatePresence>

    </div>
  );
}

// Search bar + results that sits below the Sessions block and replaces the
// file tree while a query is active. Empty query = file tree as usual.
function FileSearchPanel({ homePath, onCdFolder }: { homePath: string; onCdFolder?: (path: string) => void }) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('name');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState<boolean>(readShowHidden);
  const abortRef = useRef<AbortController | null>(null);

  const toggleHidden = () => {
    setShowHidden((v) => {
      const next = !v;
      try { localStorage.setItem(SHOW_HIDDEN_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  };

  const trimmed = query.trim();
  const isSearching = trimmed.length > 0;

  useEffect(() => {
    if (!isSearching) {
      abortRef.current?.abort();
      setResults([]);
      setError(null);
      setTruncated(false);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    abortRef.current?.abort();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);

    const handle = window.setTimeout(() => {
      searchFiles(trimmed, { mode, signal: ctrl.signal })
        .then((res) => {
          if (ctrl.signal.aborted) return;
          setResults(res.results);
          setTruncated(res.truncated);
        })
        .catch((err: unknown) => {
          if (ctrl.signal.aborted) return;
          setError(err instanceof Error ? err.message : 'search failed');
          setResults([]);
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setLoading(false);
        });
    }, 200);

    return () => {
      window.clearTimeout(handle);
      ctrl.abort();
    };
  }, [trimmed, mode, isSearching]);

  return (
    <>
      <div className="px-3 py-2 border-b border-panel-border space-y-1.5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-panel-muted pointer-events-none" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={mode === 'name' ? 'Search files…' : 'Search file contents…'}
            className="w-full pl-7 pr-7 py-1.5 rounded-md bg-panel-bg border border-panel-border text-sm font-mono text-panel-text placeholder:text-panel-muted focus:outline-none focus:border-panel-muted"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-panel-muted hover:text-panel-text"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div className="flex gap-1 font-mono text-[10px]">
          <button
            type="button"
            onClick={() => setMode('name')}
            className={`px-2 py-0.5 rounded uppercase tracking-wider ${
              mode === 'name'
                ? 'bg-panel-text text-panel-bg'
                : 'bg-panel-bg text-panel-muted border border-panel-border hover:text-panel-text'
            }`}
          >
            Name
          </button>
          <button
            type="button"
            onClick={() => setMode('content')}
            className={`px-2 py-0.5 rounded uppercase tracking-wider ${
              mode === 'content'
                ? 'bg-panel-text text-panel-bg'
                : 'bg-panel-bg text-panel-muted border border-panel-border hover:text-panel-text'
            }`}
          >
            Content
          </button>
          {isSearching && (
            <span className="ml-auto self-center text-panel-muted normal-case tracking-normal">
              {loading
                ? 'searching…'
                : `${results.length}${truncated ? '+' : ''} ${results.length === 1 ? 'hit' : 'hits'}`}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin overscroll-contain scroll-smooth">
        {isSearching ? (
          <div className="py-1 font-mono text-xs">
            {error && <div className="px-3 py-2 text-red-400">{error}</div>}
            {!error && !loading && results.length === 0 && (
              <div className="px-3 py-2 text-panel-muted">no matches</div>
            )}
            {results.map((hit, i) => (
              <button
                key={`${hit.path}:${hit.line ?? 0}:${i}`}
                onClick={() => setPreviewPath(hit.path)}
                className="w-full text-left px-3 py-1 hover:bg-panel-bg/50 group"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <FileIcon className="w-3.5 h-3.5 flex-shrink-0 text-panel-muted" />
                  <span className="truncate text-panel-text">{hit.name}</span>
                  {hit.line ? (
                    <span className="text-panel-muted flex-shrink-0">:{hit.line}</span>
                  ) : null}
                </div>
                <div className="pl-5 text-[10px] text-panel-muted truncate">
                  {hit.path === homePath
                    ? "~"
                    : hit.path.startsWith(homePath + "/")
                      ? "~/" + hit.path.slice(homePath.length + 1)
                      : hit.path}
                </div>
                {hit.preview && (
                  <div className="pl-5 mt-0.5 text-panel-muted truncate" title={hit.preview}>
                    {hit.preview}
                  </div>
                )}
              </button>
            ))}
            {truncated && (
              <div className="px-3 py-1 text-[10px] text-panel-muted">
                showing first {results.length} — narrow the query for more
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="px-3 py-2 flex items-center gap-2 text-[10px] uppercase tracking-wider text-panel-muted font-mono">
              <span className="flex-1 truncate">
                Files <span className="ml-1 text-panel-muted/70 normal-case tracking-normal text-[10px]">— tap <span className="font-mono">cd</span> or double-tap a folder to cd</span>
              </span>
              <button
                type="button"
                onClick={toggleHidden}
                className="p-0.5 text-panel-muted hover:text-panel-text normal-case tracking-normal"
                aria-label={showHidden ? 'Hide dotfiles' : 'Show dotfiles'}
                title={showHidden ? 'Hide dotfiles (.ssh, .npm, …)' : 'Show dotfiles (.ssh, .npm, …)'}
              >
                {showHidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              </button>
            </div>
            <FileTree rootPath={homePath} showHidden={showHidden} onCdFolder={onCdFolder} />
          </>
        )}
      </div>

      {previewPath && <FilePreview path={previewPath} onClose={() => setPreviewPath(null)} />}
    </>
  );
}
