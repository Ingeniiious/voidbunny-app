import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { fetchStats, type ServerStats } from '../lib/api';

const POLL_MS = 3000;
const GB = 1024 * 1024 * 1024;
// Re-toast at most every 5 min per metric, so flapping at the threshold
// doesn't spam. Only fires on *ascending* transitions (ok→warn, warn→crit).
const TOAST_COOLDOWN_MS = 5 * 60 * 1000;

type Level = 'ok' | 'warn' | 'critical';
function levelFor(pct: number): Level {
  if (pct >= 85) return 'critical';
  if (pct >= 70) return 'warn';
  return 'ok';
}
const rankOf = (l: Level) => (l === 'critical' ? 2 : l === 'warn' ? 1 : 0);

function formatGB(bytes: number): string {
  return (bytes / GB).toFixed(1);
}

// Tint thresholds — same scale used for the RAM bar and the CPU bar.
function toneFor(pct: number): { bar: string; text: string; dot: string; level: Level } {
  if (pct >= 85) return { bar: 'bg-panel-danger', text: 'text-panel-danger', dot: 'bg-panel-danger', level: 'critical' };
  if (pct >= 70) return { bar: 'bg-amber-500', text: 'text-amber-500', dot: 'bg-amber-500', level: 'warn' };
  return { bar: 'bg-panel-text', text: 'text-panel-text', dot: 'bg-emerald-500', level: 'ok' };
}

// Dropdown anchored to the trigger button via getBoundingClientRect. Uses
// `position: fixed` so it escapes the header's `overflow-hidden`, AND is
// portaled to <body> so it escapes the header's z-30 sticky stacking context
// (otherwise z-[61] only stacks within the header, and terminal/tab overlays
// at z-20+ in the main content paint over it).
const DROPDOWN_WIDTH = 288; // px — keep in sync with w-72
const VIEWPORT_PAD = 8;

export default function StatsPill() {
  const [stats, setStats] = useState<ServerStats | null>(null);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  // Track the highest level we've toasted at, per metric, so we only fire on
  // ascending transitions and survive component remounts within a tab.
  const memLevelRef = useRef<Level>('ok');
  const cpuLevelRef = useRef<Level>('ok');
  const lastMemToastRef = useRef(0);
  const lastCpuToastRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function tick() {
      try {
        const s = await fetchStats();
        if (cancelled) return;
        setStats(s);
        setErr(false);

        const memPct = Math.round((s.mem.used / s.mem.total) * 100);
        const cpuPct = Math.min(999, Math.round((s.cpu.load1 / s.cpu.count) * 100));
        const now = Date.now();

        const newMem = levelFor(memPct);
        if (
          rankOf(newMem) > rankOf(memLevelRef.current) &&
          now - lastMemToastRef.current > TOAST_COOLDOWN_MS
        ) {
          if (newMem === 'critical') {
            toast.error(`Memory at ${memPct}%`, {
              description: 'Close idle terminals to free RAM.',
              duration: 6000,
            });
          } else if (newMem === 'warn') {
            toast.warning(`Memory at ${memPct}%`, {
              description: 'Getting tight — consider closing unused tabs.',
              duration: 5000,
            });
          }
          lastMemToastRef.current = now;
        }
        memLevelRef.current = newMem;

        const newCpu = levelFor(cpuPct);
        if (
          rankOf(newCpu) > rankOf(cpuLevelRef.current) &&
          now - lastCpuToastRef.current > TOAST_COOLDOWN_MS
        ) {
          if (newCpu === 'critical') {
            toast.error(`CPU load ${cpuPct}%`, {
              description: 'Server is saturated — something heavy is running.',
              duration: 6000,
            });
          } else if (newCpu === 'warn') {
            toast.warning(`CPU load ${cpuPct}%`, {
              description: "Sustained load — check what's running.",
              duration: 5000,
            });
          }
          lastCpuToastRef.current = now;
        }
        cpuLevelRef.current = newCpu;
      } catch {
        if (!cancelled) setErr(true);
      } finally {
        if (!cancelled && !document.hidden) {
          timer = setTimeout(tick, POLL_MS);
        }
      }
    }

    function onVis() {
      if (document.hidden) {
        if (timer) { clearTimeout(timer); timer = null; }
      } else {
        tick();
      }
    }

    tick();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  // Anchor the dropdown to the trigger's bottom-right, clamped to viewport.
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const btn = triggerRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const top = r.bottom + 8;
      const desiredLeft = r.right - DROPDOWN_WIDTH;
      const left = Math.max(VIEWPORT_PAD, Math.min(window.innerWidth - DROPDOWN_WIDTH - VIEWPORT_PAD, desiredLeft));
      setPos({ top, left });
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!stats) {
    return (
      <div className="hidden xs:flex items-center px-2 h-6 rounded-full bg-panel-bg border border-panel-border">
        <span className="text-[10px] font-mono text-panel-muted">{err ? 'stats —' : '…'}</span>
      </div>
    );
  }

  const memPct = Math.round((stats.mem.used / stats.mem.total) * 100);
  const cpuPct = Math.min(999, Math.round((stats.cpu.load1 / stats.cpu.count) * 100));
  const memTone = toneFor(memPct);
  const cpuTone = toneFor(cpuPct);
  const diskPct = stats.disk ? Math.round((stats.disk.used / stats.disk.total) * 100) : 0;
  const diskTone = stats.disk ? toneFor(diskPct) : null;
  // Worst level across visible metrics — used for the trigger's status dot.
  const worstRank = Math.max(
    rankOf(memTone.level),
    rankOf(cpuTone.level),
    diskTone ? rankOf(diskTone.level) : 0,
  );
  const worstDot = worstRank === 2 ? 'bg-panel-danger' : worstRank === 1 ? 'bg-amber-500' : 'bg-emerald-500';

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-2 px-2 h-7 rounded-full bg-panel-bg/80 border transition-colors backdrop-blur-sm ${
          open ? 'border-panel-text/60' : 'border-panel-border hover:border-panel-text/60'
        }`}
        aria-label="Server stats"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span className="flex items-center gap-1">
          <span className="text-[10px] font-mono text-panel-muted">M</span>
          <span className="w-8 sm:w-12 h-1.5 rounded-full bg-panel-border overflow-hidden">
            <span
              className={`block h-full ${memTone.bar} transition-all`}
              style={{ width: `${Math.min(100, memPct)}%` }}
            />
          </span>
          <span className={`text-[11px] font-mono tabular-nums ${memTone.text}`}>{memPct}%</span>
        </span>
        <span className="hidden sm:flex items-center gap-1 pl-2 border-l border-panel-border">
          <span className="text-[10px] font-mono text-panel-muted">C</span>
          <span className="w-12 h-1.5 rounded-full bg-panel-border overflow-hidden">
            <span
              className={`block h-full ${cpuTone.bar} transition-all`}
              style={{ width: `${Math.min(100, cpuPct)}%` }}
            />
          </span>
          <span className={`text-[11px] font-mono tabular-nums ${cpuTone.text}`}>{cpuPct}%</span>
        </span>
      </button>

      {open && pos && createPortal(
        <>
          {/* Backdrop catches outside clicks. Fixed so it sits above everything. */}
          <div
            className="fixed inset-0 z-[60]"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-label="Server stats"
            style={{ top: pos.top, left: pos.left, width: DROPDOWN_WIDTH }}
            className="fixed z-[61] origin-top-right rounded-xl border border-panel-border bg-panel-surface/90 backdrop-blur-xl shadow-2xl shadow-black/30 font-mono text-xs overflow-hidden animate-stats-pop motion-reduce:animate-none"
          >
            {/* Header strip with status dot and label */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-panel-border bg-panel-bg/40">
              <div className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full ${worstDot}`} aria-hidden />
                <span className="text-[10px] uppercase tracking-[0.14em] text-panel-muted">system</span>
              </div>
              <span className="text-[10px] text-panel-muted tabular-nums">live · {Math.round(POLL_MS / 1000)}s</span>
            </div>

            {/* Metric rows */}
            <div className="px-3 py-2 space-y-2.5">
              <Row
                label="RAM"
                value={`${formatGB(stats.mem.used)} / ${formatGB(stats.mem.total)} GB`}
                pct={memPct}
                tone={memTone}
              />
              <Row
                label="CPU"
                value={`${stats.cpu.load1.toFixed(2)} · ${stats.cpu.count}c`}
                pct={cpuPct}
                tone={cpuTone}
              />
              {stats.disk && diskTone && (
                <Row
                  label="DSK"
                  value={`${formatGB(stats.disk.used)} / ${formatGB(stats.disk.total)} GB`}
                  pct={diskPct}
                  tone={diskTone}
                />
              )}
            </div>

            {/* Load averages */}
            <div className="px-3 py-2 border-t border-panel-border bg-panel-bg/30 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-[0.14em] text-panel-muted">load avg</span>
              <span className="text-[10px] text-panel-muted tabular-nums">
                <span className="text-panel-text">{stats.cpu.load1.toFixed(2)}</span>
                <span className="mx-1.5 opacity-40">·</span>
                <span>{stats.cpu.load5.toFixed(2)}</span>
                <span className="mx-1.5 opacity-40">·</span>
                <span>{stats.cpu.load15.toFixed(2)}</span>
              </span>
            </div>

            {/* Footer: version chips */}
            <div className="px-3 py-2 border-t border-panel-border flex items-center justify-between text-[10px]">
              <span className="inline-flex items-center gap-1 text-panel-muted">
                <span className="opacity-60">ui</span>
                <span className="text-panel-text tabular-nums">v{__APP_VERSION__}</span>
              </span>
              <span className="inline-flex items-center gap-1 text-panel-muted">
                <span className="opacity-60">api</span>
                <span className="text-panel-text tabular-nums">v{stats.version ?? '?'}</span>
              </span>
            </div>

            {memPct >= 85 && (
              <div className="px-3 py-2 border-t border-panel-border bg-panel-danger/10 text-[11px] text-panel-danger">
                Memory tight — close idle terminals to free RAM.
              </div>
            )}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

function Row({
  label,
  value,
  pct,
  tone,
}: {
  label: string;
  value: string;
  pct: number;
  tone: { bar: string; text: string; dot: string; level: Level };
}) {
  return (
    <div>
      <div className="flex justify-between items-baseline gap-2">
        <span className="flex items-center gap-1.5 text-panel-muted">
          <span className={`w-1 h-1 rounded-full ${tone.dot}`} aria-hidden />
          <span className="uppercase tracking-[0.12em] text-[10px]">{label}</span>
        </span>
        <span className={`tabular-nums ${tone.text}`}>{value}</span>
      </div>
      <div className="mt-1.5 w-full h-1 rounded-full bg-panel-border/70 overflow-hidden">
        <span
          className={`block h-full ${tone.bar} transition-[width] duration-500 ease-out`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}
