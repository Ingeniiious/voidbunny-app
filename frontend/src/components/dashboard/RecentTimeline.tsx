import { useState } from 'react';
import { motion } from 'motion/react';
import { RiFolderLine, RiArrowDownSLine } from '@remixicon/react';
import type { TimelineRun } from '../../lib/activity';
import { formatDuration, formatRelative } from '../../lib/activity';
import CliLogo from '../CliLogo';

interface Props {
  runs: TimelineRun[];
}

// Collapsed: 5 rows, no scroll. Expanded: rows scroll inside a fixed
// max-height container so the dashboard page itself doesn't grow when the
// user opens it. The full set of rows lives in the DOM either way (no
// extra fetch needed — DashboardView already requests up to 50).
const COLLAPSED_COUNT = 5;
const EXPANDED_MAX_HEIGHT = 'max-h-80'; // ~20rem ≈ 5–6 visible rows + scroll

export default function RecentTimeline({ runs }: Props) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? runs : runs.slice(0, COLLAPSED_COUNT);
  const canExpand = runs.length > COLLAPSED_COUNT;

  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.1, ease: 'easeOut' }}
      className="rounded-2xl border border-panel-border bg-panel-surface/70 backdrop-blur-xl p-4 sm:p-5"
    >
      <header className="flex items-baseline justify-between mb-3">
        <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-panel-muted">
          Recent sessions
        </div>
        {runs.length > 0 && (
          <div className="text-[10px] font-mono text-panel-muted">
            {expanded ? runs.length : Math.min(COLLAPSED_COUNT, runs.length)} of {runs.length}
          </div>
        )}
      </header>

      <ol
        className={`divide-y divide-panel-border/60 ${expanded ? `${EXPANDED_MAX_HEIGHT} overflow-y-auto scrollbar-thin pr-1 -mr-1` : ''}`}
      >
        {visible.map((r) => (
          <li key={r.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0 min-w-0">
            {r.avatar_url ? (
              <img
                src={r.avatar_url}
                alt=""
                width={24}
                height={24}
                className="w-6 h-6 rounded-md border border-panel-border flex-shrink-0"
                loading="lazy"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-6 h-6 rounded-md border border-panel-border bg-panel-bg flex items-center justify-center flex-shrink-0">
                <RiFolderLine className="w-3 h-3 text-panel-muted" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="font-sans text-sm text-panel-text truncate" title={r.cwd}>
                  {r.name}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] font-mono text-panel-muted">
                <CliLogo cli={r.cli} className="w-3 h-3" />
                <span>{formatDuration(r.busy_ms)}</span>
                <span>·</span>
                <span>{r.turns} turns</span>
              </div>
            </div>
            <span className="font-mono text-[11px] text-panel-muted whitespace-nowrap">
              {formatRelative(r.started_at)}
            </span>
          </li>
        ))}
        {runs.length === 0 && (
          <li className="text-sm font-mono text-panel-muted text-center py-8">
            No sessions recorded yet.
          </li>
        )}
      </ol>

      {canExpand && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 w-full flex items-center justify-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.14em] text-panel-muted hover:text-panel-text py-2 border-t border-panel-border/60"
        >
          <span>{expanded ? 'Show less' : `View all (${runs.length})`}</span>
          <RiArrowDownSLine
            className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </button>
      )}
    </motion.section>
  );
}
