import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import type { HeatmapDay } from '../../lib/activity';
import { formatDuration } from '../../lib/activity';
import CliLogo from '../CliLogo';

interface Props {
  days: HeatmapDay[];
}

// GitHub-style contribution grid. 53 columns of 7-day weeks, oldest on the
// left. The trailing column may be a partial week — we still render the cells
// but those that fall outside [from, to] stay blank.
//
// Color intensity is bucketed by busy_ms. The accent hue is the day's
// dominant CLI (top_cli) so a day spent in Codex looks visibly different
// from a day spent in Claude — matches the panel's per-CLI colour language.

const WEEKDAY_LABELS = ['Mon', '', 'Wed', '', 'Fri', '', ''];

function bucketIntensity(busyMs: number, p75: number, p95: number): number {
  if (!busyMs) return 0;
  if (busyMs < p75 * 0.4) return 1;
  if (busyMs < p75)        return 2;
  if (busyMs < p95)        return 3;
  return 4;
}

function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function ActivityHeatmap({ days }: Props) {
  const [hover, setHover] = useState<HeatmapDay | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Build a Map for O(1) day lookup, and the 53×7 grid scaffold.
  const { weeks, monthLabels, p75, p95 } = useMemo(() => {
    const byDate = new Map<string, HeatmapDay>(days.map((d) => [d.date, d]));

    // Anchor the right-most column on today so the grid always shows the
    // present at the far right (matches GitHub's layout).
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const endWeekday = today.getDay(); // 0..6 (Sun..Sat); we render Mon-first
    const endOffsetFromMon = (endWeekday + 6) % 7;

    const COLS = 53;
    const grid: (HeatmapDay | null)[][] = Array.from({ length: COLS }, () => Array(7).fill(null));
    const start = new Date(today);
    start.setDate(start.getDate() - ((COLS - 1) * 7 + endOffsetFromMon));

    const labels: { col: number; label: string }[] = [];
    let lastMonth = -1;
    for (let col = 0; col < COLS; col++) {
      for (let row = 0; row < 7; row++) {
        const d = new Date(start);
        d.setDate(start.getDate() + col * 7 + row);
        if (d > today) break;
        const key = ymdLocal(d);
        grid[col][row] = byDate.get(key) || { date: key, count: 0, busy_ms: 0, top_cli: null };
        // First Monday of a new month marks the column where its label goes.
        if (row === 0 && d.getMonth() !== lastMonth) {
          labels.push({ col, label: d.toLocaleDateString(undefined, { month: 'short' }) });
          lastMonth = d.getMonth();
        }
      }
    }

    // Distribution for color buckets — percentile-based so a single freak day
    // doesn't flatten the rest of the grid.
    const busy = days.map((d) => d.busy_ms).filter((v) => v > 0).sort((a, b) => a - b);
    const p = (q: number) => busy.length ? busy[Math.floor((busy.length - 1) * q)] : 0;
    return { weeks: grid, monthLabels: labels, p75: p(0.75), p95: p(0.95) };
  }, [days]);

  // Jump the horizontal scroll to the right edge on mount and whenever the
  // grid re-renders (e.g. after a dashboard refresh). Without this the
  // narrow viewport on phones lands you on January and you have to scroll
  // a year forward to see today.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [days]);

  // Aggregate totals shown in the header strip above the grid.
  const total = useMemo(() => {
    let busy = 0;
    let activeDays = 0;
    let bestDay = { date: '', busy_ms: 0 };
    for (const d of days) {
      busy += d.busy_ms;
      if (d.busy_ms > 0) activeDays++;
      if (d.busy_ms > bestDay.busy_ms) bestDay = d;
    }
    return { busy, activeDays, bestDay };
  }, [days]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="rounded-2xl border border-panel-border bg-panel-surface/70 backdrop-blur-xl p-4 sm:p-5"
    >
      <header className="flex items-end justify-between flex-wrap gap-2 mb-3">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-panel-muted">
            Activity · last 12 months
          </div>
          <div className="font-sans text-2xl sm:text-3xl text-panel-text mt-1">
            {formatDuration(total.busy)}
            <span className="text-panel-muted text-base ml-2">of agent work</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs font-mono">
          <div className="text-panel-muted uppercase tracking-[0.14em]">Active days</div>
          <div className="text-right text-panel-text">{total.activeDays}</div>
          <div className="text-panel-muted uppercase tracking-[0.14em]">Busiest</div>
          <div className="text-right text-panel-text">{formatDuration(total.bestDay.busy_ms)}</div>
        </div>
      </header>

      <div ref={scrollRef} className="overflow-x-auto -mx-2 px-2">
        <div className="relative inline-block min-w-full">
          {/* Month label row */}
          <div className="grid grid-flow-col auto-cols-[14px] gap-[3px] mb-1 ml-7">
            {Array.from({ length: weeks.length }).map((_, col) => {
              const lbl = monthLabels.find((m) => m.col === col)?.label;
              return (
                <div key={col} className="h-3 text-[10px] font-mono text-panel-muted">
                  {lbl}
                </div>
              );
            })}
          </div>
          <div className="flex">
            {/* Weekday labels */}
            <div className="grid grid-rows-7 gap-[3px] mr-2 text-[10px] font-mono text-panel-muted leading-none">
              {WEEKDAY_LABELS.map((l, i) => (
                <div key={i} className="h-3 flex items-center">{l}</div>
              ))}
            </div>
            {/* Grid */}
            <div className="grid grid-flow-col auto-cols-[14px] gap-[3px]">
              {weeks.map((col, ci) => (
                <div key={ci} className="grid grid-rows-7 gap-[3px]">
                  {col.map((d, ri) => {
                    if (!d) return <div key={ri} className="w-3 h-3 rounded-[3px] bg-transparent" />;
                    const intensity = bucketIntensity(d.busy_ms, p75, p95);
                    const cliVar = d.top_cli ? `var(--cli-${d.top_cli})` : '120 120 130';
                    const opacities = [0.08, 0.25, 0.5, 0.75, 1];
                    return (
                      <button
                        key={ri}
                        type="button"
                        onMouseEnter={() => setHover(d)}
                        onMouseLeave={() => setHover((h) => (h === d ? null : h))}
                        onFocus={() => setHover(d)}
                        onBlur={() => setHover((h) => (h === d ? null : h))}
                        className="w-3 h-3 rounded-[3px] border border-panel-border/40 hover:ring-1 hover:ring-panel-accent transition-shadow"
                        style={{
                          backgroundColor: intensity === 0
                            ? 'rgb(var(--panel-border) / 0.45)'
                            : `rgb(${cliVar} / ${opacities[intensity]})`,
                        }}
                        aria-label={`${d.date} · ${formatDuration(d.busy_ms)}`}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <footer className="flex items-center justify-between mt-3 text-[10px] font-mono text-panel-muted">
        <div className="min-h-[16px]">
          {hover ? (
            <span className="flex items-center gap-2 text-panel-text">
              {hover.top_cli && <CliLogo cli={hover.top_cli} className="w-3 h-3" />}
              <span>{hover.date}</span>
              <span className="text-panel-muted">·</span>
              <span>{hover.busy_ms ? formatDuration(hover.busy_ms) : 'no activity'}</span>
              {hover.count > 0 && (
                <>
                  <span className="text-panel-muted">·</span>
                  <span className="text-panel-muted">{hover.count} events</span>
                </>
              )}
            </span>
          ) : (
            <span>Hover a cell for detail</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="uppercase tracking-[0.14em]">Less</span>
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className="w-3 h-3 rounded-[3px]"
              style={{
                backgroundColor: i === 0
                  ? 'rgb(var(--panel-border) / 0.45)'
                  : `rgb(var(--cli-claude) / ${[0, 0.25, 0.5, 0.75, 1][i]})`,
              }}
            />
          ))}
          <span className="uppercase tracking-[0.14em]">More</span>
        </div>
      </footer>
    </motion.section>
  );
}
