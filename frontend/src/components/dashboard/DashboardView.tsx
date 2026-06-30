import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { RiRefreshLine } from '@remixicon/react';
import ActivityHeatmap from './ActivityHeatmap';
import CliBreakdown from './CliBreakdown';
import CliHelpCenter from './CliHelpCenter';
import CliUsageRow from './CliUsageRow';
import RepoCard from './RepoCard';
import RecentTimeline from './RecentTimeline';
import {
  fetchSummary, fetchHeatmap, fetchTimeline,
  formatDuration, formatTokens,
  type SummaryResponse, type HeatmapResponse, type TimelineRun,
} from '../../lib/activity';

interface Props {
  onCdFolder?: (cwd: string) => void;
}

interface StatChipProps {
  label: string;
  value: string;
  sub?: string;
}
function StatChip({ label, value, sub }: StatChipProps) {
  return (
    <div className="rounded-2xl border border-panel-border bg-panel-surface/70 backdrop-blur-xl p-4">
      <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-panel-muted">{label}</div>
      <div className="font-sans text-2xl sm:text-3xl text-panel-text mt-1">{value}</div>
      {sub && <div className="text-[11px] font-mono text-panel-muted mt-0.5">{sub}</div>}
    </div>
  );
}

export default function DashboardView({ onCdFolder }: Props) {
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [heatmap, setHeatmap] = useState<HeatmapResponse | null>(null);
  const [timeline, setTimeline] = useState<TimelineRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([fetchSummary(), fetchHeatmap(), fetchTimeline(50)])
      .then(([s, h, t]) => {
        if (cancelled) return;
        setSummary(s);
        setHeatmap(h);
        setTimeline(t.runs);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshTick]);

  // Refresh every 60s while the view is open. Cheap — the queries are
  // indexed and the JSON is small (<10 KB).
  useEffect(() => {
    const id = window.setInterval(() => setRefreshTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  if (loading && !summary) {
    return (
      <div className="h-full flex items-center justify-center text-sm font-mono text-panel-muted">
        loading dashboard…
      </div>
    );
  }
  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-sm font-mono text-panel-danger px-4 text-center">
        {error}
      </div>
    );
  }
  if (!summary || !heatmap) return null;

  const tk = summary.totals.tokens;
  const totalTokens30 = tk.input_30d + tk.output_30d;
  const totalTokensAll = tk.input_all + tk.output_all;
  const busy30 = summary.by_cli.reduce((sum, r) => sum + r.busy_ms, 0);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        <header className="flex items-end justify-between gap-2 flex-wrap">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-panel-muted">
              Activity
            </div>
            <h1 className="font-sans text-3xl sm:text-4xl text-panel-text mt-1">
              Dashboard
            </h1>
          </div>
          <button
            type="button"
            onClick={() => setRefreshTick((t) => t + 1)}
            className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-[0.14em] text-panel-muted hover:text-panel-text"
            aria-label="Refresh"
          >
            <RiRefreshLine className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </header>

        <CliUsageRow />

        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4"
        >
          <StatChip label="Agent time" value={formatDuration(busy30)} sub="last 12 months" />
          <StatChip label="Events 30d" value={summary.totals.events_30d.toLocaleString()} sub={`${summary.totals.events_7d} in last 7d`} />
          <StatChip label="Tokens 30d" value={formatTokens(totalTokens30)} sub={`${formatTokens(totalTokensAll)} all-time`} />
          <StatChip label="Repositories" value={String(summary.top_repos.length)} sub="with activity" />
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <ActivityHeatmap days={heatmap.days} />
          </div>
          <div className="lg:col-span-1 space-y-4">
            <CliBreakdown byCli={summary.by_cli} tokensByCli={summary.tokens_by_cli} />
            <CliHelpCenter />
          </div>
        </div>

        <section>
          <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-panel-muted mb-3">
            Top repositories
          </div>
          {summary.top_repos.length === 0 ? (
            <div className="rounded-2xl border border-panel-border bg-panel-surface/70 backdrop-blur-xl p-8 text-center text-sm font-mono text-panel-muted">
              No repository activity yet. Open a terminal, cd into a repo, run an agent — this fills in automatically.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              {summary.top_repos.map((r) => (
                <RepoCard key={r.cwd} repo={r} onCdFolder={onCdFolder} />
              ))}
            </div>
          )}
        </section>

        <RecentTimeline runs={timeline} />
      </div>
    </div>
  );
}
