import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { RiRefreshLine, RiArrowRightSLine, RiErrorWarningLine } from '@remixicon/react';
import {
  fetchCliHelpCatalog,
  refreshCliHelp,
  type CliHelpCatalogRow,
} from '../../lib/activity';
import type { CliKind } from '../../lib/api';
import CliLogo from '../CliLogo';
import CliHelpDrawer from './CliHelpDrawer';

// Dashboard card that lists every installed CLI on the server. Click a row
// to open the drawer with the full --help + slash-command catalog. Data is
// served from SQLite (populated by backend/cliHelpScan.js).
export default function CliHelpCenter() {
  const [catalog, setCatalog] = useState<CliHelpCatalogRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<CliKind | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchCliHelpCatalog()
      .then((res) => {
        if (cancelled) return;
        setCatalog(res.clis);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => { cancelled = true; };
  }, [tick]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refreshCliHelp();
      // The scanner runs async on the server; give it a few seconds before
      // re-fetching the catalog so the new counts are in.
      setTimeout(() => { setTick((t) => t + 1); setRefreshing(false); }, 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRefreshing(false);
    }
  };

  const installed = (catalog || []).filter((c) => c.installed);

  return (
    <>
      <motion.section
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.1, ease: 'easeOut' }}
        className="rounded-2xl border border-panel-border bg-panel-surface/70 backdrop-blur-xl p-4 sm:p-5"
      >
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-panel-muted">
            CLI Help Center
          </div>
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-[0.14em] text-panel-muted hover:text-panel-text disabled:opacity-50"
            aria-label="Rescan installed CLIs"
            title="Rescan installed CLIs"
          >
            <RiRefreshLine className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
            Rescan
          </button>
        </div>

        {error && (
          <div className="text-[11px] font-mono text-panel-danger mb-3 flex items-center gap-1.5">
            <RiErrorWarningLine className="w-3.5 h-3.5" />
            {error}
          </div>
        )}

        {!catalog ? (
          <div className="text-sm font-mono text-panel-muted text-center py-6">
            scanning…
          </div>
        ) : installed.length === 0 ? (
          <div className="text-sm font-mono text-panel-muted text-center py-6">
            No CLIs detected on this server yet. They show up here once installed.
          </div>
        ) : (
          <ul className="space-y-2">
            {installed.map((c) => {
              const total = c.counts.subcommand + c.counts.flag + c.counts.slash;
              return (
                <li key={c.cli}>
                  <button
                    type="button"
                    onClick={() => setSelected(c.cli)}
                    className="w-full flex items-center gap-3 rounded-xl border border-panel-border/60 bg-panel-bg/40 hover:bg-panel-bg/70 transition-colors px-3 py-2.5 text-left group"
                  >
                    <CliLogo cli={c.cli} className="w-5 h-5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-sans text-sm text-panel-text truncate">
                          {c.display_name}
                        </span>
                        {c.version && (
                          <span className="font-mono text-[10px] text-panel-muted truncate">
                            {c.version}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] font-mono text-panel-muted mt-0.5 flex items-center gap-1.5">
                        {c.counts.subcommand > 0 && <span>{c.counts.subcommand} cmds</span>}
                        {c.counts.flag > 0 && <span>· {c.counts.flag} flags</span>}
                        {c.counts.slash > 0 && <span>· {c.counts.slash} slash</span>}
                        {total === 0 && <span className="text-panel-danger">help not parsed</span>}
                      </div>
                    </div>
                    <RiArrowRightSLine className="w-4 h-4 text-panel-muted group-hover:text-panel-text flex-shrink-0" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </motion.section>

      {selected && (
        <CliHelpDrawer cli={selected} onClose={() => setSelected(null)} />
      )}
    </>
  );
}
