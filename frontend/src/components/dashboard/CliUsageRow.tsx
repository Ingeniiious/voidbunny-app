import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { RiRefreshLine, RiErrorWarningLine } from '@remixicon/react';
import {
  fetchCliUsage,
  refreshCliUsage,
  type CliUsageRow as CliUsageData,
} from '../../lib/activity';
import type { CliKind } from '../../lib/api';
import CliLogo from '../CliLogo';

// Top-of-dashboard row showing live subscription usage per CLI. Driven by
// the cli_usage SQLite snapshot the backend refreshes every 30 min via the
// PTY-based fetcher in claudeUsageFetch.js. Only Claude Code has an
// equivalent /usage panel today — Codex and Gemini show a "no quota API"
// placeholder until/unless they grow one.

const SUPPORTED_USAGE: CliKind[] = ['claude'];
const NO_API_CLIS: { cli: CliKind; reason: string }[] = [
  { cli: 'codex', reason: 'No /usage in Codex CLI' },
  { cli: 'gemini', reason: 'No /usage in Gemini CLI' },
];

function formatRelative(ms: number | null): string {
  if (!ms) return '—';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

interface BarProps { pct: number | null; cli: CliKind; }
function UsageBar({ pct, cli }: BarProps) {
  const p = Math.max(0, Math.min(100, pct ?? 0));
  return (
    <div className="h-1.5 rounded-full bg-panel-border/40 overflow-hidden">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${p}%` }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="h-full rounded-full"
        style={{ backgroundColor: `rgb(var(--cli-${cli}))` }}
      />
    </div>
  );
}

interface CardProps {
  cli: CliKind;
  data: CliUsageData | null;
  refreshing: boolean;
  onRefresh: () => void;
}
function ClaudeCard({ cli, data, refreshing, onRefresh }: CardProps) {
  const hasData = !!(data && data.session_pct !== null);
  const stale = data && Date.now() - data.fetched_at > 45 * 60 * 1000;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="rounded-2xl border border-panel-border bg-panel-surface/70 backdrop-blur-xl p-4 sm:p-5"
    >
      <div className="flex items-center gap-2 mb-3">
        <CliLogo cli={cli} className="w-5 h-5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-sans text-sm text-panel-text">
              {data?.plan || 'Claude Code'}
            </span>
            {data?.credits && (
              <span className="font-mono text-[10px] text-panel-muted">
                {data.credits}
              </span>
            )}
          </div>
          <div className="text-[10px] font-mono text-panel-muted">
            {data?.fetched_at ? formatRelative(data.fetched_at) : 'never fetched'}
            {stale && ' · stale'}
          </div>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="p-1 rounded-md text-panel-muted hover:text-panel-text hover:bg-panel-bg/60 disabled:opacity-50"
          aria-label="Refresh usage"
          title="Re-fetch /usage from claude (~10s)"
        >
          <RiRefreshLine className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {data?.error ? (
        <div className="text-[11px] font-mono text-panel-danger flex items-center gap-1.5 py-3">
          <RiErrorWarningLine className="w-3.5 h-3.5" />
          {data.error}
        </div>
      ) : !hasData ? (
        <div className="text-[11px] font-mono text-panel-muted text-center py-4">
          Fetching from <span className="text-panel-text">claude --print /usage</span>…
        </div>
      ) : (
        <div className="space-y-3">
          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-panel-muted">
                5-hour session
              </span>
              <span className="font-mono text-[11px] text-panel-text">
                {data.session_pct}% used
              </span>
            </div>
            <UsageBar pct={data.session_pct} cli={cli} />
            {data.session_reset && (
              <div className="text-[10px] font-mono text-panel-muted mt-1">
                resets {data.session_reset}
              </div>
            )}
          </div>

          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-panel-muted">
                Week · all models
              </span>
              <span className="font-mono text-[11px] text-panel-text">
                {data.week_pct_all}% used
              </span>
            </div>
            <UsageBar pct={data.week_pct_all} cli={cli} />
            {data.week_reset && (
              <div className="text-[10px] font-mono text-panel-muted mt-1">
                resets {data.week_reset}
              </div>
            )}
          </div>

          {typeof data.week_pct_sonnet === 'number' && data.week_pct_sonnet > 0 && (
            <div>
              <div className="flex items-baseline justify-between mb-1.5">
                <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-panel-muted">
                  Week · Sonnet only
                </span>
                <span className="font-mono text-[11px] text-panel-text">
                  {data.week_pct_sonnet}% used
                </span>
              </div>
              <UsageBar pct={data.week_pct_sonnet} cli={cli} />
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}

function PlaceholderCard({ cli, reason }: { cli: CliKind; reason: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="rounded-2xl border border-panel-border bg-panel-surface/40 backdrop-blur-xl p-4 sm:p-5 opacity-70"
    >
      <div className="flex items-center gap-2 mb-2">
        <CliLogo cli={cli} className="w-5 h-5" />
        <span className="font-sans text-sm text-panel-text capitalize">
          {cli}
        </span>
      </div>
      <div className="text-[11px] font-mono text-panel-muted leading-snug">
        {reason}.
        <br />
        <span className="text-panel-muted/70">No quota panel to scrape.</span>
      </div>
    </motion.div>
  );
}

export default function CliUsageRow() {
  const [data, setData] = useState<Map<string, CliUsageData> | null>(null);
  const [refreshing, setRefreshing] = useState<Record<string, boolean>>({});
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchCliUsage()
      .then((res) => {
        if (cancelled) return;
        const map = new Map<string, CliUsageData>();
        for (const row of res.clis) map.set(row.cli, row);
        setData(map);
      })
      .catch(() => { if (!cancelled) setData(new Map()); });
    return () => { cancelled = true; };
  }, [tick]);

  // Re-poll after triggering a refresh — backend writes the new row when
  // the PTY round-trip lands (~10s).
  useEffect(() => {
    if (Object.values(refreshing).every((v) => !v)) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 3000);
    return () => clearInterval(id);
  }, [refreshing]);

  const triggerRefresh = async (cli: CliKind) => {
    setRefreshing((s) => ({ ...s, [cli]: true }));
    try {
      await refreshCliUsage();
      // Give the PTY round-trip ~12s; stop the spinner then.
      setTimeout(() => {
        setRefreshing((s) => ({ ...s, [cli]: false }));
        setTick((t) => t + 1);
      }, 13000);
    } catch {
      setRefreshing((s) => ({ ...s, [cli]: false }));
    }
  };

  if (!data) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
      {SUPPORTED_USAGE.map((cli) => (
        <ClaudeCard
          key={cli}
          cli={cli}
          data={data.get(cli) || null}
          refreshing={!!refreshing[cli]}
          onRefresh={() => triggerRefresh(cli)}
        />
      ))}
      {NO_API_CLIS.map((p) => (
        <PlaceholderCard key={p.cli} cli={p.cli} reason={p.reason} />
      ))}
    </div>
  );
}
