import { RiFolderLine, RiGithubFill, RiGitlabFill } from '@remixicon/react';
import { motion } from 'motion/react';
import type { ActivityRepoSummary } from '../../lib/activity';
import { formatDuration, formatRelative } from '../../lib/activity';
import CliLogo from '../CliLogo';

interface Props {
  repo: ActivityRepoSummary;
  onCdFolder?: (cwd: string) => void;
}

export default function RepoCard({ repo, onCdFolder }: Props) {
  const isGitHub = repo.host === 'github.com';
  const isGitLab = repo.host?.endsWith('gitlab.com');
  const HostIcon = isGitHub ? RiGithubFill : isGitLab ? RiGitlabFill : null;
  const remoteHref = isGitHub && repo.owner
    ? `https://github.com/${repo.owner}/${repo.name}`
    : null;

  return (
    <motion.article
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="group rounded-xl border border-panel-border bg-panel-surface/90 backdrop-blur-xl p-4 hover:border-panel-accent/40 transition-colors"
    >
      <div className="flex items-start gap-3">
        {repo.avatar_url ? (
          <img
            src={repo.avatar_url}
            alt=""
            width={36}
            height={36}
            className="w-9 h-9 rounded-lg border border-panel-border flex-shrink-0 bg-panel-bg"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-9 h-9 rounded-lg border border-panel-border bg-panel-bg flex items-center justify-center flex-shrink-0">
            <RiFolderLine className="w-4 h-4 text-panel-muted" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <h3 className="font-sans text-sm text-panel-text truncate" title={repo.name}>
              {repo.name}
            </h3>
            {HostIcon && (
              <HostIcon className="w-3 h-3 text-panel-muted flex-shrink-0" />
            )}
          </div>
          {repo.owner && (
            <div className="text-[11px] font-mono text-panel-muted truncate">
              {repo.owner}
            </div>
          )}
        </div>
        {repo.top_cli && (
          <CliLogo cli={repo.top_cli} className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 mt-4 text-[11px] font-mono">
        <dt className="text-panel-muted uppercase tracking-[0.14em]">Time</dt>
        <dd className="text-right text-panel-text">{formatDuration(repo.busy_ms)}</dd>
        <dt className="text-panel-muted uppercase tracking-[0.14em]">Turns</dt>
        <dd className="text-right text-panel-text">{repo.turns}</dd>
        <dt className="text-panel-muted uppercase tracking-[0.14em]">Last</dt>
        <dd className="text-right text-panel-text">{formatRelative(repo.last_active)}</dd>
      </dl>

      <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-panel-border/60">
        {onCdFolder ? (
          <button
            type="button"
            onClick={() => onCdFolder(repo.cwd)}
            className="text-[10px] font-mono uppercase tracking-[0.14em] text-panel-muted hover:text-panel-text"
          >
            cd here
          </button>
        ) : <span />}
        {remoteHref && (
          <a
            href={remoteHref}
            target="_blank"
            rel="noreferrer"
            className="text-[10px] font-mono uppercase tracking-[0.14em] text-panel-muted hover:text-panel-text"
          >
            view repo →
          </a>
        )}
      </div>
    </motion.article>
  );
}
