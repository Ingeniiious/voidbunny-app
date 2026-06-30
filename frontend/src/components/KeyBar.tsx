import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ClipboardPaste, CornerDownLeft } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { toast } from 'sonner';
import MicButton from './MicButton';
import CliLogo from './CliLogo';
import { isTouchCapable } from '../lib/device';
import { IS_MOCK, uploadAttachment, UploadError, type CliKind } from '../lib/api';
import { getSettings, onSettingsChange } from '../lib/settings';

// Remix Icon — upload-2-line (https://remixicon.com). Inline so we don't pull
// in the package for one glyph; sized to match lucide's w-4 h-4 neighbours.
function UploadIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

const PROJECT_NAME_RE = /^[A-Za-z0-9._-]{1,64}$/;
const FALLBACK_PROJECT = '_other';
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

// Pull the project bucket name out of the active terminal's cwd. Anything
// under $HOME/<top>/... buckets as `<top>`; anything else (including bare
// $HOME) falls back to `_other` so the upload still lands somewhere.
function projectFromCwd(cwd: string | null | undefined): string {
  if (!cwd || typeof cwd !== 'string') return FALLBACK_PROJECT;
  const trimmed = cwd.replace(/\/+$/, '');
  if (trimmed === '' || trimmed === '/') return FALLBACK_PROJECT;
  const parts = trimmed.split('/').filter(Boolean);
  if (parts.length < 3 || parts[0] !== 'home') return FALLBACK_PROJECT;
  const top = parts[2];
  return PROJECT_NAME_RE.test(top) ? top : FALLBACK_PROJECT;
}

// Reduce a picked file's name to something the backend will accept and that
// reads cleanly when pasted into a terminal: alphanumerics + ._- only, dots
// preserved (extension stays intact), leading dots stripped (no .hidden).
function sanitizeFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() || raw;
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '');
  if (!cleaned) return `upload-${Date.now()}`;
  return cleaned.length > 200 ? cleaned.slice(0, 200) : cleaned;
}

interface KeyDef {
  label: string;
  seq: string;
  aria?: string;
}

const ESC: KeyDef    = { label: 'Esc',    seq: '\x1b' };
const TAB: KeyDef    = { label: 'Tab',    seq: '\x09' };
const SHTAB: KeyDef  = { label: '⇧Tab',   seq: '\x1b[Z', aria: 'Shift+Tab' };
const CTRL_C: KeyDef = { label: 'Ctrl+C', seq: '\x03' };
const CTRL_D: KeyDef = { label: 'Ctrl+D', seq: '\x04' };
const CTRL_L: KeyDef = { label: 'Ctrl+L', seq: '\x0c', aria: 'Clear screen' };
const CTRL_R: KeyDef = { label: 'Ctrl+R', seq: '\x12', aria: 'Reverse search' };
const CTRL_U: KeyDef = { label: 'Ctrl+U', seq: '\x15', aria: 'Kill line' };
const UP: KeyDef     = { label: '↑',      seq: '\x1b[A', aria: 'Arrow Up' };
const DOWN: KeyDef   = { label: '↓',      seq: '\x1b[B', aria: 'Arrow Down' };
const LEFT: KeyDef   = { label: '←',      seq: '\x1b[D', aria: 'Arrow Left' };
const RIGHT: KeyDef  = { label: '→',      seq: '\x1b[C', aria: 'Arrow Right' };
const PIPE: KeyDef   = { label: '|',      seq: '|' };
const TILDE: KeyDef  = { label: '~',      seq: '~' };
const SLASH: KeyDef  = { label: '/',      seq: '/' };
const DASH: KeyDef   = { label: '-',      seq: '-' };
const UNDER: KeyDef  = { label: '_',      seq: '_' };

// Real-keyboard grid: each row fills the full width edge-to-edge regardless
// of how many keys it holds, so the expanded panel reads as a proper on-
// screen keyboard instead of a wrapping toolbar.
const GRID_ROWS: KeyDef[][] = [
  [ESC, TAB, SHTAB, CTRL_C],
  [CTRL_D, CTRL_L, CTRL_R, CTRL_U],
  [LEFT, DOWN, UP, RIGHT, PIPE, TILDE, SLASH, DASH, UNDER],
];

interface Props {
  onSend: (seq: string) => void;
  activeCwd?: string | null;
}

const TAP_THRESHOLD = 8;
const COLLAPSE_KEY = 'panel.keybar.collapsed';

// Default-collapsed on desktop (real keyboard makes the on-screen key grid
// redundant — but the toolbar with Mic/Send/Paste/Upload is still useful).
// Touch devices default to expanded since that's where the grid earns its keep.
function readCollapsed(): boolean {
  if (typeof localStorage === 'undefined') return !isTouchCapable;
  const stored = localStorage.getItem(COLLAPSE_KEY);
  if (stored === '1') return true;
  if (stored === '0') return false;
  return !isTouchCapable;
}

// Spring shared across the floating chrome so collapse / expand all feel
// like the same physical surface, not two different transitions.
const SPRING = { type: 'spring' as const, stiffness: 420, damping: 36, mass: 0.7 };

export default function KeyBar({ onSend, activeCwd }: Props) {
  // Track at-most-one active touch. If pointer moves beyond threshold or scroll
  // takes over, the press is treated as a scroll gesture and no key is sent.
  const press = useRef<{ x: number; y: number; seq: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);
  const [uploading, setUploading] = useState(false);
  const [launchers, setLaunchersState] = useState<CliKind[]>(() => getSettings().launchers);
  const reducedMotion = useReducedMotion();

  useEffect(() => onSettingsChange(() => {
    setLaunchersState(getSettings().launchers);
  }), []);

  const handleUploadClick = () => {
    if (uploading) return;
    if (IS_MOCK) {
      toast.info('Mock mode — uploads are disabled');
      return;
    }
    fileInputRef.current?.click();
  };

  const handleFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input so picking the same file twice still triggers `change`.
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_ATTACHMENT_BYTES) {
      toast.error('File too large', { description: 'Limit is 25 MB' });
      return;
    }

    const project = projectFromCwd(activeCwd);
    const name = sanitizeFileName(file.name);

    setUploading(true);
    const toastId = toast.loading(`Uploading ${name}…`);
    try {
      const result = await uploadAttachment(project, name, file);
      toast.success(`Uploaded ${name}`, { id: toastId, description: `→ ${project}/`, duration: 2200 });
      // Bracketed paste with surrounding spaces so the path doesn't merge
      // with what the user has typed and doesn't auto-execute on shells that
      // interpret \r inside a paste.
      onSend(`\x1b[200~ ${result.path} \x1b[201~`);
    } catch (err) {
      const message = err instanceof UploadError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Upload failed';
      toast.error('Upload failed', { id: toastId, description: message });
    } finally {
      setUploading(false);
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard?.readText?.();
      if (!text) {
        toast.error('Clipboard is empty');
        return;
      }
      // Wrap with bracketed paste markers so multi-line pastes don't auto-submit
      // in shells / Claude CLI that have bracketed-paste enabled (most modern ones).
      onSend(`\x1b[200~${text}\x1b[201~`);
      const chars = text.length;
      const lines = text.split('\n').length;
      toast.success(
        `Pasted ${chars} char${chars === 1 ? '' : 's'}`,
        { description: lines > 1 ? `${lines} lines` : undefined, duration: 1800 },
      );
    } catch (e) {
      toast.error('Paste failed', {
        description: e instanceof Error ? e.message : 'Clipboard access denied',
      });
    }
  };

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      return next;
    });
  };

  const renderKey = (k: KeyDef, index: number) => (
    <motion.button
      key={k.label + k.seq}
      type="button"
      layout
      initial={reducedMotion ? false : { opacity: 0, y: 6, scale: 0.92 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 4, scale: 0.94 }}
      transition={
        reducedMotion
          ? { duration: 0.12 }
          : { ...SPRING, delay: Math.min(index, 16) * 0.012 }
      }
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        press.current = { x: e.clientX, y: e.clientY, seq: k.seq };
      }}
      onPointerMove={(e) => {
        const p = press.current;
        if (!p) return;
        if (
          Math.abs(e.clientX - p.x) > TAP_THRESHOLD ||
          Math.abs(e.clientY - p.y) > TAP_THRESHOLD
        ) {
          press.current = null;
        }
      }}
      onPointerUp={(e) => {
        const p = press.current;
        press.current = null;
        if (!p) return;
        if (
          Math.abs(e.clientX - p.x) > TAP_THRESHOLD ||
          Math.abs(e.clientY - p.y) > TAP_THRESHOLD
        ) {
          return;
        }
        e.preventDefault();
        onSend(p.seq);
      }}
      onPointerCancel={() => { press.current = null; }}
      onContextMenu={(e) => e.preventDefault()}
      aria-label={k.aria ?? k.label}
      className="flex-1 min-w-0 h-9 px-1 rounded-lg bg-panel-bg/70 border border-panel-border/70 text-panel-text font-mono text-xs whitespace-nowrap active:bg-panel-border active:scale-95 transition-[background-color,transform] touch-manipulation select-none"
    >
      {k.label}
    </motion.button>
  );

  // Toolbar is split into two visual groups by a vertical divider:
  //   left  — input controls (Mic, Send, Esc) — what you press while writing
  //   right — paste + user-configured CLI launchers (Paste, Upload, [CLIs…])
  // Launchers are user-picked in Settings (panel.settings.launchers) — empty
  // is a valid choice. The collapse chevron is anchored to the far right
  // (ml-auto) so it always sits in the same corner regardless of how many
  // launchers are present.
  const launcherBtn =
    'h-9 w-9 flex-shrink-0 rounded-lg bg-panel-bg/70 border border-panel-border/70 flex items-center justify-center touch-manipulation select-none opacity-80 hover:opacity-100 transition-opacity';

  const toolbar = (
    <>
      <MicButton onText={onSend} />

      <motion.button
        type="button"
        layout
        whileTap={reducedMotion ? undefined : { scale: 0.94 }}
        onPointerDown={(e) => { e.preventDefault(); }}
        onClick={() => onSend('\r')}
        aria-label="Send Enter"
        className="relative h-9 px-3 rounded-lg font-mono text-xs font-semibold text-white whitespace-nowrap touch-manipulation select-none flex items-center gap-1.5 overflow-hidden shadow-[0_6px_18px_-6px_rgb(var(--cli-claude)/0.7)]"
      >
        {/* Deep brand-orange gradient — every stop ≥4.5:1 contrast with white
            "Send" label so the button stays WCAG AA across the full pan. */}
        <span
          aria-hidden
          className="absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(120deg, #c2410c 0%, #9a3412 50%, #c2410c 100%)',
          }}
        />
        {/* Warm top highlight — brand-tinted gloss bevel that keeps the deep
            base from reading muddy, without raising the label's background
            luminance enough to break contrast. */}
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-1/2 pointer-events-none"
          style={{
            background:
              'linear-gradient(180deg, rgb(var(--cli-claude) / 0.35) 0%, transparent 100%)',
          }}
        />
        <CornerDownLeft className="relative w-3.5 h-3.5 drop-shadow-[0_1px_1px_rgba(0,0,0,0.25)]" />
        <span className="relative drop-shadow-[0_1px_1px_rgba(0,0,0,0.25)]">Send</span>
      </motion.button>

      <motion.button
        type="button"
        layout
        whileTap={reducedMotion ? undefined : { scale: 0.92 }}
        onPointerDown={(e) => { e.preventDefault(); }}
        onClick={() => onSend('\x1b')}
        aria-label="Send Escape"
        title="Send Escape"
        className="h-9 px-3 rounded-lg bg-panel-bg/70 border border-panel-border/70 text-panel-text font-mono text-xs whitespace-nowrap active:bg-panel-border touch-manipulation select-none flex-shrink-0 flex items-center justify-center"
      >
        Esc
      </motion.button>

      {/* Group divider — purely decorative; separates input controls on the
          left from paste/launcher chips on the right. */}
      <motion.span
        layout
        aria-hidden
        className="self-center h-6 w-px mx-1 bg-panel-border/70 rounded-full"
      />

      <motion.button
        type="button"
        layout
        whileTap={reducedMotion ? undefined : { scale: 0.92 }}
        onPointerDown={(e) => { e.preventDefault(); }}
        onClick={handlePaste}
        aria-label="Paste from clipboard"
        title="Paste from clipboard"
        className="h-9 w-9 flex-shrink-0 rounded-lg bg-panel-bg/70 border border-panel-border/70 text-panel-text flex items-center justify-center active:bg-panel-border transition-colors touch-manipulation select-none"
      >
        <ClipboardPaste className="w-4 h-4" />
      </motion.button>

      <motion.button
        type="button"
        layout
        whileTap={reducedMotion ? undefined : { scale: 0.92 }}
        onPointerDown={(e) => { e.preventDefault(); }}
        onClick={handleUploadClick}
        aria-label="Upload file or photo"
        title="Upload file or photo"
        disabled={uploading}
        className={`relative overflow-hidden h-9 w-9 flex-shrink-0 rounded-lg bg-panel-bg/70 border border-panel-border/70 text-panel-text flex items-center justify-center active:bg-panel-border transition-colors touch-manipulation select-none ${
          uploading ? 'btn-shimmer' : ''
        }`}
      >
        <UploadIcon className="w-4 h-4" />
      </motion.button>

      <input
        ref={fileInputRef}
        type="file"
        accept="*/*"
        onChange={handleFilePicked}
        className="hidden"
        aria-hidden
        tabIndex={-1}
      />

      {launchers.map((cli) => (
        <motion.button
          key={cli}
          type="button"
          layout
          whileTap={reducedMotion ? undefined : { scale: 0.92 }}
          onPointerDown={(e) => { e.preventDefault(); }}
          onClick={() => onSend(cli)}
          aria-label={`Type ${cli}`}
          title={`Type '${cli}'`}
          className={launcherBtn}
        >
          <CliLogo cli={cli} className="w-4 h-4" />
        </motion.button>
      ))}

      <motion.button
        type="button"
        layout
        whileTap={reducedMotion ? undefined : { scale: 0.92 }}
        onPointerDown={(e) => { e.preventDefault(); }}
        onClick={toggleCollapsed}
        aria-label={collapsed ? 'Expand keyboard shortcuts' : 'Collapse keyboard shortcuts'}
        aria-expanded={!collapsed}
        title={collapsed ? 'Expand shortcuts' : 'Collapse shortcuts'}
        className="ml-auto h-9 w-9 flex-shrink-0 rounded-lg bg-panel-bg/70 border border-panel-border/70 text-panel-muted flex items-center justify-center touch-manipulation select-none"
      >
        <motion.span
          aria-hidden
          animate={{ rotate: collapsed ? 180 : 0 }}
          transition={reducedMotion ? { duration: 0.12 } : SPRING}
          className="inline-flex"
        >
          <ChevronDown className="w-4 h-4" />
        </motion.span>
      </motion.button>
    </>
  );

  return (
    <div
      className="flex-shrink-0 px-2 pt-1"
      style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
    >
      <motion.div
        layout
        transition={reducedMotion ? { duration: 0.15 } : SPRING}
        className="relative rounded-2xl border border-panel-border/60 bg-panel-surface/85 backdrop-blur-xl shadow-[0_10px_30px_-12px_rgba(0,0,0,0.45),0_2px_6px_-2px_rgba(0,0,0,0.25)] overflow-hidden"
      >
        <motion.div layout className="flex items-center gap-1 px-2 py-1.5">
          {toolbar}
        </motion.div>

        <AnimatePresence initial={false}>
          {!collapsed && (
            <motion.div
              key="keys"
              initial={reducedMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
              animate={reducedMotion ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
              exit={reducedMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
              transition={reducedMotion ? { duration: 0.15 } : { ...SPRING, opacity: { duration: 0.18 } }}
              className="overflow-hidden"
            >
              <div className="px-2 pb-2 pt-0.5 border-t border-panel-border/40">
                <div className="flex flex-col gap-1">
                  {GRID_ROWS.map((row, ri) => (
                    <div key={ri} className="flex items-stretch gap-1">
                      {row.map((k, ci) => renderKey(k, ri * 8 + ci))}
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
