import fs from 'node:fs/promises';
import path from 'node:path';
import { getRepo, upsertRepo } from './db.js';

// For every cwd we see in a tmux session, try to derive a "repository
// identity" from .git/config so the dashboard can render a card with the
// right owner, name, and avatar — same idea as GitHub's contribution graph
// showing the repo favicon. No network calls except for the GitHub avatar,
// which is a public unauthenticated 302 redirect and the browser caches the
// resulting image anyway.

const REENRICH_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Track in-flight enrichments so a busy poll loop that revisits the same
// cwd 50 times in a row doesn't queue 50 .git/config reads.
const inFlight = new Set();

function parseRemoteUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();

  // git@github.com:owner/repo(.git)?
  const ssh = trimmed.match(/^[^@]+@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/);
  if (ssh) {
    return { host: ssh[1].toLowerCase(), owner: ssh[2], repo: ssh[3] };
  }

  // https://github.com/owner/repo(.git)?  |  ssh://git@github.com/owner/repo
  try {
    const u = new URL(trimmed);
    const parts = u.pathname.replace(/^\//, '').replace(/\.git$/, '').split('/');
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return { host: u.hostname.toLowerCase(), owner: parts[0], repo: parts[1] };
    }
  } catch { /* fall through */ }

  return null;
}

async function readGitConfig(cwd) {
  // Walk up the directory tree looking for .git/config — subdirectories of
  // a repo should still resolve to the repo's identity (e.g. running an
  // agent in `repo/packages/foo` is still activity on `repo`).
  let dir = cwd;
  for (let i = 0; i < 8; i++) {
    const p = path.join(dir, '.git', 'config');
    try {
      return await fs.readFile(p, 'utf8');
    } catch { /* keep climbing */ }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function extractOriginUrl(gitConfig) {
  // Look for `[remote "origin"]` then the first `url = ...` underneath it.
  // We don't bother with a full INI parser — git's config grammar is loose
  // and the regex is enough for the canonical form.
  const m = gitConfig.match(/\[remote\s+"origin"\][\s\S]*?\n\s*url\s*=\s*(\S+)/i);
  if (m) return m[1];
  // Fall back to any remote if origin doesn't exist (common when only an
  // `upstream` is configured).
  const any = gitConfig.match(/\[remote\s+"[^"]+"\][\s\S]*?\n\s*url\s*=\s*(\S+)/i);
  return any ? any[1] : null;
}

export async function enrichRepo(cwd) {
  if (!cwd || typeof cwd !== 'string') return;
  if (inFlight.has(cwd)) return;
  const existing = getRepo(cwd);
  const now = Date.now();
  if (existing && existing.last_enriched && now - existing.last_enriched < REENRICH_AFTER_MS) {
    return;
  }
  inFlight.add(cwd);
  try {
    const cfg = await readGitConfig(cwd);
    if (!cfg) {
      // Local-only directory — mark it enriched-with-nothing so we don't
      // keep re-reading the filesystem each tick.
      upsertRepo({ cwd, owner: null, repo: null, host: null, remoteUrl: null, avatarUrl: null, now });
      return;
    }
    const url = extractOriginUrl(cfg);
    const parsed = parseRemoteUrl(url);
    if (!parsed) {
      upsertRepo({ cwd, owner: null, repo: null, host: null, remoteUrl: url, avatarUrl: null, now });
      return;
    }
    // GitHub publishes a public avatar endpoint that 302s to the real CDN
    // URL. No auth, no rate limit (per IP it's fairly generous), and the
    // browser caches the image — so we just persist the URL and let the
    // <img> tag do the fetching.
    let avatarUrl = null;
    if (parsed.host === 'github.com') {
      avatarUrl = `https://github.com/${parsed.owner}.png?size=80`;
    } else if (parsed.host.endsWith('gitlab.com')) {
      avatarUrl = `https://gitlab.com/${parsed.owner}.png`;
    }
    upsertRepo({
      cwd,
      owner: parsed.owner,
      repo: parsed.repo,
      host: parsed.host,
      remoteUrl: url,
      avatarUrl,
      now,
    });
  } catch (err) {
    console.warn('[repoEnrich] failed for', cwd, '-', err?.message);
  } finally {
    inFlight.delete(cwd);
  }
}
