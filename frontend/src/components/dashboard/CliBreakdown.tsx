import { motion } from 'motion/react';
import type { ActivityCliSummary, TokenCliSummary } from '../../lib/activity';
import { formatDuration, formatTokens } from '../../lib/activity';
import CliLogo from '../CliLogo';

interface Props {
  byCli: ActivityCliSummary[];
  tokensByCli: TokenCliSummary[];
}

const CLI_NAMES: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  cursor: 'Cursor',
  grok: 'Grok',
};

export default function CliBreakdown({ byCli, tokensByCli }: Props) {
  const totalBusy = byCli.reduce((sum, r) => sum + (r.busy_ms || 0), 0) || 1;
  // Merge time + token rows on cli key for a single row per CLI.
  const tokenMap = new Map(tokensByCli.map((t) => [t.cli, t]));

  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.05, ease: 'easeOut' }}
      className="rounded-2xl border border-panel-border bg-panel-surface/70 backdrop-blur-xl p-4 sm:p-5"
    >
      <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-panel-muted mb-3">
        CLI breakdown · last 12 months
      </div>

      {/* Stacked bar — proportional time spent per CLI. */}
      <div className="flex h-2 rounded-full overflow-hidden bg-panel-border/40 mb-4">
        {byCli.map((r) => {
          const pct = (r.busy_ms / totalBusy) * 100;
          if (pct < 0.5) return null;
          return (
            <div
              key={r.cli}
              style={{
                width: `${pct}%`,
                backgroundColor: `rgb(var(--cli-${r.cli}))`,
              }}
              title={`${CLI_NAMES[r.cli] || r.cli}: ${pct.toFixed(1)}%`}
            />
          );
        })}
      </div>

      <ul className="space-y-3">
        {byCli.map((r) => {
          const pct = (r.busy_ms / totalBusy) * 100;
          const tokens = tokenMap.get(r.cli);
          const totalTok = tokens ? (tokens.input_tokens + tokens.output_tokens + tokens.cache_read_tokens + tokens.cache_creation_tokens) : 0;
          return (
            <li key={r.cli} className="flex items-center gap-3">
              <CliLogo cli={r.cli} className="w-4 h-4 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-sans text-sm text-panel-text capitalize">
                    {CLI_NAMES[r.cli] || r.cli}
                  </span>
                  <span className="font-mono text-[11px] text-panel-muted">
                    {pct.toFixed(1)}%
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-panel-muted mt-0.5">
                  <span>{formatDuration(r.busy_ms)} · {r.turns} turns</span>
                  {totalTok > 0 && <span title="input + output + cache">{formatTokens(totalTok)} tok</span>}
                </div>
              </div>
            </li>
          );
        })}
        {byCli.length === 0 && (
          <li className="text-sm font-mono text-panel-muted text-center py-6">
            No CLI activity yet. Start an agent in a terminal to populate this.
          </li>
        )}
      </ul>
    </motion.section>
  );
}
