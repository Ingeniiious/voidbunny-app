import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  RiCloseLine,
  RiSearchLine,
  RiExternalLinkLine,
  RiArrowDownSLine,
} from '@remixicon/react';
import {
  fetchCliHelp,
  type CliHelpCategory,
  type CliHelpDetail,
  type CliHelpEntry,
  type CliHelpKind,
} from '../../lib/activity';
import type { CliKind } from '../../lib/api';
import CliLogo from '../CliLogo';

interface Props {
  cli: CliKind;
  onClose: () => void;
}

const TAB_LABELS: Record<CliHelpKind, string> = {
  subcommand: 'Subcommands',
  flag: 'Flags',
  slash: 'Slash commands',
};

export default function CliHelpDrawer({ cli, onClose }: Props) {
  const [detail, setDetail] = useState<CliHelpDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<CliHelpKind>('subcommand');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    fetchCliHelp(cli)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
        // Default to the first non-empty tab.
        if (d.subcommands.length === 0 && d.flags.length > 0) setTab('flag');
        else if (d.subcommands.length === 0 && d.flags.length === 0 && d.slash.length > 0) setTab('slash');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => { cancelled = true; };
  }, [cli]);

  // Escape closes the drawer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const entries: CliHelpEntry[] = useMemo(() => {
    if (!detail) return [];
    if (tab === 'subcommand') return detail.subcommands;
    if (tab === 'flag') return detail.flags;
    return detail.slash;
  }, [detail, tab]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) =>
      e.name.toLowerCase().includes(q) ||
      (e.summary || '').toLowerCase().includes(q) ||
      (e.description || '').toLowerCase().includes(q),
    );
  }, [entries, search]);

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const availableTabs: CliHelpKind[] = detail
    ? (['subcommand', 'flag', 'slash'] as CliHelpKind[]).filter((k) => {
        if (k === 'subcommand') return detail.subcommands.length > 0;
        if (k === 'flag') return detail.flags.length > 0;
        return detail.slash.length > 0;
      })
    : [];

  return (
    <AnimatePresence>
      <motion.div
        key="backdrop"
        className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-[3px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        key="panel"
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="fixed inset-0 z-[10000] flex items-start sm:items-center justify-center p-3 sm:p-6 pointer-events-none"
      >
        <div
          className="pointer-events-auto w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl border border-panel-border bg-panel-surface shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start gap-3 p-5 border-b border-panel-border">
            <CliLogo cli={cli} className="w-8 h-8 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <h2 className="font-sans text-xl text-panel-text">
                  {detail?.display_name || cli}
                </h2>
                {detail?.version && (
                  <span className="font-mono text-[11px] text-panel-muted">
                    {detail.version}
                  </span>
                )}
              </div>
              {detail?.homepage && (
                <a
                  href={detail.homepage}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-mono text-panel-muted hover:text-panel-text mt-1"
                >
                  {detail.homepage.replace(/^https?:\/\//, '')}
                  <RiExternalLinkLine className="w-3 h-3" />
                </a>
              )}
              {detail?.bin_path && (
                <div className="text-[10px] font-mono text-panel-muted mt-0.5 truncate">
                  {detail.bin_path}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md text-panel-muted hover:text-panel-text hover:bg-panel-bg/60"
              aria-label="Close"
            >
              <RiCloseLine className="w-5 h-5" />
            </button>
          </div>

          {/* Tabs + search */}
          {!detail && !error && (
            <div className="p-8 text-center text-sm font-mono text-panel-muted">
              loading…
            </div>
          )}
          {error && (
            <div className="p-6 text-sm font-mono text-panel-danger text-center">
              {error}
            </div>
          )}
          {detail && availableTabs.length === 0 && (
            <div className="p-8 text-center text-sm font-mono text-panel-muted">
              No help entries captured for this CLI yet.
              {detail.scan_error && (
                <div className="mt-2 text-panel-danger text-[11px]">
                  Scanner: {detail.scan_error}
                </div>
              )}
            </div>
          )}
          {detail && availableTabs.length > 0 && (
            <>
              <div className="flex items-center gap-1 px-3 sm:px-5 border-b border-panel-border bg-panel-bg/30">
                {availableTabs.map((k) => {
                  const active = tab === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => { setTab(k); setExpanded(new Set()); }}
                      className={`px-3 py-2.5 text-[11px] font-mono uppercase tracking-[0.14em] transition-colors border-b-2 ${
                        active
                          ? 'text-panel-text border-panel-text/70'
                          : 'text-panel-muted border-transparent hover:text-panel-text'
                      }`}
                    >
                      {TAB_LABELS[k]}
                    </button>
                  );
                })}
                <div className="flex-1" />
                <div className="hidden sm:flex items-center gap-1.5 text-panel-muted">
                  <RiSearchLine className="w-3.5 h-3.5" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Filter…"
                    className="bg-transparent text-[12px] font-mono text-panel-text placeholder:text-panel-muted/70 outline-none py-1 w-32"
                  />
                </div>
              </div>
              {/* Mobile search */}
              <div className="sm:hidden px-3 pt-2 pb-1">
                <div className="flex items-center gap-1.5 rounded-md border border-panel-border bg-panel-bg/40 px-2 py-1.5">
                  <RiSearchLine className="w-3.5 h-3.5 text-panel-muted" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Filter…"
                    className="flex-1 bg-transparent text-[12px] font-mono text-panel-text placeholder:text-panel-muted/70 outline-none"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-3 sm:px-5 py-3">
                {filtered.length === 0 ? (
                  <div className="py-10 text-center text-sm font-mono text-panel-muted">
                    No matches.
                  </div>
                ) : (
                  <CategoryGroups
                    entries={filtered}
                    categories={detail.categories}
                    tab={tab}
                    expanded={expanded}
                    onToggle={toggleExpand}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

interface CategoryGroupsProps {
  entries: CliHelpEntry[];
  categories: CliHelpCategory[];
  tab: CliHelpKind;
  expanded: Set<string>;
  onToggle: (key: string) => void;
}

function CategoryGroups({ entries, categories, tab, expanded, onToggle }: CategoryGroupsProps) {
  // Group entries by category, keeping the server's category ordering.
  const byCat = new Map<string, CliHelpEntry[]>();
  for (const e of entries) {
    const k = e.category || 'other';
    const arr = byCat.get(k) || [];
    arr.push(e);
    byCat.set(k, arr);
  }
  const order = categories.length > 0
    ? categories.map((c) => c.key)
    : Array.from(byCat.keys());
  const labelFor = (key: string) =>
    categories.find((c) => c.key === key)?.label || key;

  return (
    <div className="space-y-5">
      {order.map((catKey) => {
        const items = byCat.get(catKey);
        if (!items || items.length === 0) return null;
        return (
          <section key={catKey}>
            <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-panel-muted mb-2 px-1">
              {labelFor(catKey)}
              <span className="ml-2 text-panel-muted/70 normal-case tracking-normal">
                {items.length}
              </span>
            </div>
            <ul className="space-y-1">
              {items.map((e) => {
                const key = `${tab}:${e.name}`;
                const isOpen = expanded.has(key);
                const hasMore = !!(e.description || e.usage);
                return (
                  <li
                    key={key}
                    className="rounded-lg border border-transparent hover:border-panel-border/60"
                  >
                    <button
                      type="button"
                      onClick={() => hasMore && onToggle(key)}
                      className={`w-full flex items-start gap-3 px-3 py-2 text-left ${
                        hasMore ? 'cursor-pointer' : 'cursor-default'
                      }`}
                    >
                      <span className="font-mono text-[12px] text-panel-text whitespace-nowrap min-w-0">
                        {e.name}
                      </span>
                      <span className="flex-1 text-[12px] text-panel-muted leading-snug">
                        {e.summary || (hasMore ? '' : '—')}
                      </span>
                      {hasMore && (
                        <RiArrowDownSLine
                          className={`w-4 h-4 text-panel-muted flex-shrink-0 transition-transform ${
                            isOpen ? 'rotate-180' : ''
                          }`}
                        />
                      )}
                    </button>
                    {isOpen && hasMore && (
                      <div className="px-3 pb-3 -mt-1 text-[12px] font-mono text-panel-muted space-y-1">
                        {e.usage && (
                          <div className="text-panel-text/80">{e.usage}</div>
                        )}
                        {e.description && (
                          <div className="whitespace-pre-wrap leading-relaxed">
                            {e.description}
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
