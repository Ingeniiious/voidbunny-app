import express from 'express';
import {
  getDb,
  isReady,
  listCliCatalog,
  getCliCatalogRow,
  listCliHelpCommands,
  countCliHelpCommands,
  listCliUsage,
} from './db.js';
import { scanAndPersistCliHelp, SUPPORTED_CLIS } from './cliHelpScan.js';
import { CATEGORIES } from './cliHelpCategorize.js';
import { refreshClaudeUsage } from './claudeUsageFetch.js';

// Read-only views over the activity DB. Every route returns plain JSON; the
// frontend's dashboard component composes them. Auth is applied where this
// router is mounted (backend/index.js → requireAuth).

const router = express.Router();

function ensureReady(res) {
  if (!isReady()) {
    res.status(503).json({ error: 'activity DB unavailable' });
    return false;
  }
  return true;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function nowMs() { return Date.now(); }

function basename(p) {
  if (!p || typeof p !== 'string') return null;
  const trimmed = p.replace(/\/+$/, '');
  const i = trimmed.lastIndexOf('/');
  return i === -1 ? trimmed : (trimmed.slice(i + 1) || null);
}

// Pull events / interval totals for "the last N days". Used by /summary.
function eventsSince(ms) {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) AS n FROM events WHERE ts >= ?').get(ms);
  return row?.n || 0;
}

router.get('/summary', (_req, res) => {
  if (!ensureReady(res)) return;
  const db = getDb();
  const now = nowMs();
  const since7 = now - 7 * DAY_MS;
  const since30 = now - 30 * DAY_MS;
  const since365 = now - 365 * DAY_MS;

  const byCli = db.prepare(`
    SELECT cli,
           COALESCE(SUM(busy_ms), 0)  AS busy_ms,
           COALESCE(SUM(turn_count), 0) AS turns,
           COUNT(*)                  AS runs
      FROM cli_runs
     WHERE started_at >= ?
     GROUP BY cli
     ORDER BY busy_ms DESC
  `).all(since365);

  const topRepos = db.prepare(`
    SELECT r.cwd,
           r.owner,
           r.repo,
           r.host,
           r.avatar_url,
           COALESCE(agg.last_active, 0) AS last_active,
           COALESCE(agg.busy_ms, 0)     AS busy_ms,
           COALESCE(agg.turns, 0)       AS turns,
           tc.top_cli                   AS top_cli
      FROM (
        SELECT cwd,
               MAX(COALESCE(ended_at, started_at)) AS last_active,
               SUM(busy_ms)                        AS busy_ms,
               SUM(turn_count)                     AS turns
          FROM cli_runs
         GROUP BY cwd
      ) agg
      LEFT JOIN repos r ON r.cwd = agg.cwd
      -- Re-attach the highest-busy CLI per cwd. Subquery on the inner agg
      -- to avoid a window function (better-sqlite3 ships with the option
      -- enabled but the inline scalar subquery is cleaner here).
      LEFT JOIN (
        SELECT cwd, cli AS top_cli
          FROM cli_runs cr
         WHERE busy_ms = (SELECT MAX(busy_ms) FROM cli_runs WHERE cwd = cr.cwd)
         GROUP BY cwd
      ) tc ON tc.cwd = agg.cwd
     ORDER BY agg.busy_ms DESC
     LIMIT 12
  `).all();

  // Carry the cwd through verbatim and synthesize a `name` (basename or
  // `repo` when known) for frontend display fallback. We do this in JS so
  // the SQL stays portable.
  const repos = topRepos.map((r) => ({
    cwd: r.cwd,
    name: r.repo || basename(r.cwd) || r.cwd,
    owner: r.owner,
    host: r.host,
    avatar_url: r.avatar_url,
    last_active: r.last_active,
    busy_ms: r.busy_ms,
    turns: r.turns,
    top_cli: r.top_cli,
  }));

  const tokensByCli = db.prepare(`
    SELECT cli,
           COALESCE(SUM(input_tokens), 0)          AS input_tokens,
           COALESCE(SUM(output_tokens), 0)         AS output_tokens,
           COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens,
           COALESCE(SUM(cache_read_tokens), 0)     AS cache_read_tokens,
           COALESCE(SUM(reasoning_tokens), 0)      AS reasoning_tokens,
           COUNT(*)                                AS messages
      FROM token_usage
     WHERE ts >= ?
     GROUP BY cli
     ORDER BY (input_tokens + output_tokens) DESC
  `).all(since365);

  const tokensTotals = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN ts >= ? THEN input_tokens   END), 0) AS input_7d,
      COALESCE(SUM(CASE WHEN ts >= ? THEN output_tokens  END), 0) AS output_7d,
      COALESCE(SUM(CASE WHEN ts >= ? THEN input_tokens   END), 0) AS input_30d,
      COALESCE(SUM(CASE WHEN ts >= ? THEN output_tokens  END), 0) AS output_30d,
      COALESCE(SUM(input_tokens),  0)                              AS input_all,
      COALESCE(SUM(output_tokens), 0)                              AS output_all
      FROM token_usage
  `).get(since7, since7, since30, since30);

  res.json({
    totals: {
      events_7d:  eventsSince(since7),
      events_30d: eventsSince(since30),
      events_365d: eventsSince(since365),
      tokens: tokensTotals,
    },
    by_cli: byCli,
    tokens_by_cli: tokensByCli,
    top_repos: repos,
    generated_at: now,
  });
});

router.get('/tokens', (req, res) => {
  if (!ensureReady(res)) return;
  const db = getDb();
  const range = String(req.query.range || '30d');
  const now = Date.now();
  const since =
    range === '7d'  ? now - 7  * DAY_MS :
    range === '90d' ? now - 90 * DAY_MS :
    range === '365d' ? now - 365 * DAY_MS :
    /* default */     now - 30 * DAY_MS;

  const byDay = db.prepare(`
    SELECT strftime('%Y-%m-%d', ts/1000, 'unixepoch', 'localtime') AS day,
           cli,
           SUM(input_tokens)          AS input_tokens,
           SUM(output_tokens)         AS output_tokens,
           SUM(cache_creation_tokens) AS cache_creation_tokens,
           SUM(cache_read_tokens)     AS cache_read_tokens
      FROM token_usage
     WHERE ts >= ?
     GROUP BY day, cli
     ORDER BY day ASC
  `).all(since);

  const byRepo = db.prepare(`
    SELECT t.cwd,
           r.repo, r.owner, r.avatar_url, r.host,
           SUM(t.input_tokens)          AS input_tokens,
           SUM(t.output_tokens)         AS output_tokens,
           SUM(t.cache_creation_tokens) AS cache_creation_tokens,
           SUM(t.cache_read_tokens)     AS cache_read_tokens,
           COUNT(*)                     AS messages
      FROM token_usage t
      LEFT JOIN repos r ON r.cwd = t.cwd
     WHERE t.ts >= ? AND t.cwd IS NOT NULL
     GROUP BY t.cwd
     ORDER BY (input_tokens + output_tokens) DESC
     LIMIT 12
  `).all(since);

  const byModel = db.prepare(`
    SELECT model,
           cli,
           SUM(input_tokens)  AS input_tokens,
           SUM(output_tokens) AS output_tokens,
           COUNT(*)           AS messages
      FROM token_usage
     WHERE ts >= ? AND model IS NOT NULL
     GROUP BY model, cli
     ORDER BY (input_tokens + output_tokens) DESC
  `).all(since);

  res.json({
    range,
    since,
    by_day: byDay,
    by_repo: byRepo.map((r) => ({
      cwd: r.cwd,
      name: r.repo || basename(r.cwd) || r.cwd,
      owner: r.owner,
      avatar_url: r.avatar_url,
      host: r.host,
      input_tokens: r.input_tokens,
      output_tokens: r.output_tokens,
      cache_creation_tokens: r.cache_creation_tokens,
      cache_read_tokens: r.cache_read_tokens,
      messages: r.messages,
    })),
    by_model: byModel,
  });
});

router.get('/heatmap', (req, res) => {
  if (!ensureReady(res)) return;
  const db = getDb();
  // Default: trailing 365 days (so the rendered grid matches GitHub's).
  const to = req.query.to ? Date.parse(req.query.to) : Date.now();
  const from = req.query.from ? Date.parse(req.query.from) : (to - 365 * DAY_MS);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
    return res.status(400).json({ error: 'invalid from/to' });
  }

  // strftime against ts/1000 converts ms-epoch to localtime YYYY-MM-DD. The
  // `events` table is the per-day count source (one row per phase change);
  // busy_ms comes from `cli_runs` because intervals can span days but the
  // grid only needs a coarse "how much work happened" gradient.
  const dayCounts = db.prepare(`
    SELECT strftime('%Y-%m-%d', ts/1000, 'unixepoch', 'localtime') AS day,
           COUNT(*) AS count
      FROM events
     WHERE ts >= ? AND ts <= ?
       AND kind IN ('busy_start', 'busy_end', 'cli_start')
     GROUP BY day
  `).all(from, to);

  const dayBusy = db.prepare(`
    SELECT strftime('%Y-%m-%d', started_at/1000, 'unixepoch', 'localtime') AS day,
           SUM(busy_ms) AS busy_ms
      FROM cli_runs
     WHERE started_at >= ? AND started_at <= ?
     GROUP BY day
  `).all(from, to);

  const dayTopCli = db.prepare(`
    SELECT day, cli FROM (
      SELECT strftime('%Y-%m-%d', started_at/1000, 'unixepoch', 'localtime') AS day,
             cli,
             SUM(busy_ms) AS s,
             ROW_NUMBER() OVER (
               PARTITION BY strftime('%Y-%m-%d', started_at/1000, 'unixepoch', 'localtime')
               ORDER BY SUM(busy_ms) DESC
             ) AS rn
        FROM cli_runs
       WHERE started_at >= ? AND started_at <= ?
       GROUP BY day, cli
    ) WHERE rn = 1
  `).all(from, to);

  const byDay = new Map();
  for (const r of dayCounts) byDay.set(r.day, { date: r.day, count: r.count, busy_ms: 0, top_cli: null });
  for (const r of dayBusy) {
    const v = byDay.get(r.day) || { date: r.day, count: 0, busy_ms: 0, top_cli: null };
    v.busy_ms = r.busy_ms || 0;
    byDay.set(r.day, v);
  }
  for (const r of dayTopCli) {
    const v = byDay.get(r.day);
    if (v) v.top_cli = r.cli;
  }

  // Fill every calendar day in [from, to] so the frontend doesn't have to
  // know what "missing" means. Iterate by local-noon to dodge DST jumps.
  const start = new Date(from); start.setHours(12, 0, 0, 0);
  const end = new Date(to); end.setHours(12, 0, 0, 0);
  const rows = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    rows.push(byDay.get(key) || { date: key, count: 0, busy_ms: 0, top_cli: null });
  }

  res.json({ from, to, days: rows });
});

router.get('/repos', (_req, res) => {
  if (!ensureReady(res)) return;
  const db = getDb();
  const rows = db.prepare(`
    SELECT r.cwd, r.owner, r.repo, r.host, r.avatar_url, r.remote_url,
           COALESCE(agg.busy_ms, 0)    AS busy_ms,
           COALESCE(agg.turns, 0)      AS turns,
           COALESCE(agg.last_active, 0) AS last_active,
           agg.runs                    AS runs
      FROM (
        SELECT cwd,
               SUM(busy_ms)    AS busy_ms,
               SUM(turn_count) AS turns,
               COUNT(*)        AS runs,
               MAX(COALESCE(ended_at, started_at)) AS last_active
          FROM cli_runs
         GROUP BY cwd
      ) agg
      LEFT JOIN repos r ON r.cwd = agg.cwd
     ORDER BY agg.last_active DESC
  `).all();
  res.json({
    repos: rows.map((r) => ({
      cwd: r.cwd,
      name: r.repo || basename(r.cwd) || r.cwd,
      owner: r.owner,
      host: r.host,
      avatar_url: r.avatar_url,
      remote_url: r.remote_url,
      busy_ms: r.busy_ms,
      turns: r.turns,
      runs: r.runs,
      last_active: r.last_active,
    })),
  });
});

router.get('/timeline', (req, res) => {
  if (!ensureReady(res)) return;
  const db = getDb();
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const rows = db.prepare(`
    SELECT cr.id, cr.session_id, cr.cli, cr.cwd, cr.started_at, cr.ended_at,
           cr.busy_ms, cr.turn_count,
           r.owner, r.repo, r.host, r.avatar_url
      FROM cli_runs cr
      LEFT JOIN repos r ON r.cwd = cr.cwd
     ORDER BY cr.started_at DESC
     LIMIT ?
  `).all(limit);
  res.json({
    runs: rows.map((r) => ({
      id: r.id,
      session_id: r.session_id,
      cli: r.cli,
      cwd: r.cwd,
      name: r.repo || basename(r.cwd) || r.cwd,
      owner: r.owner,
      host: r.host,
      avatar_url: r.avatar_url,
      started_at: r.started_at,
      ended_at: r.ended_at,
      busy_ms: r.busy_ms,
      turns: r.turn_count,
    })),
  });
});

// --- CLI Help Center -------------------------------------------------------

router.get('/help/catalog', (_req, res) => {
  if (!ensureReady(res)) return;
  const rows = listCliCatalog();
  const counts = countCliHelpCommands();
  const countMap = new Map();
  for (const c of counts) {
    const k = c.cli;
    const cur = countMap.get(k) || { subcommand: 0, flag: 0, slash: 0 };
    cur[c.kind] = c.n;
    countMap.set(k, cur);
  }
  res.json({
    clis: rows.map((r) => ({
      cli: r.cli,
      display_name: r.display_name || r.cli,
      version: r.version,
      installed: !!r.installed,
      homepage: r.homepage,
      bin_path: r.bin_path,
      last_scanned_at: r.last_scanned_at,
      scan_error: r.scan_error,
      counts: countMap.get(r.cli) || { subcommand: 0, flag: 0, slash: 0 },
    })),
  });
});

router.get('/help/:cli', (req, res) => {
  if (!ensureReady(res)) return;
  const cli = String(req.params.cli || '');
  if (!SUPPORTED_CLIS.includes(cli)) {
    return res.status(404).json({ error: 'unknown cli' });
  }
  const meta = getCliCatalogRow(cli);
  const rows = listCliHelpCommands(cli);
  const buckets = { subcommand: [], flag: [], slash: [] };
  for (const r of rows) {
    if (!buckets[r.kind]) continue;
    buckets[r.kind].push({
      name: r.name,
      summary: r.summary,
      description: r.description,
      usage: r.usage,
      source: r.source,
      category: r.category || 'other',
    });
  }
  res.json({
    cli,
    display_name: meta?.display_name || cli,
    version: meta?.version || null,
    installed: !!meta?.installed,
    homepage: meta?.homepage || null,
    bin_path: meta?.bin_path || null,
    last_scanned_at: meta?.last_scanned_at || null,
    scan_error: meta?.scan_error || null,
    categories: CATEGORIES,
    subcommands: buckets.subcommand,
    flags: buckets.flag,
    slash: buckets.slash,
  });
});

// --- CLI subscription usage (Claude /usage) -------------------------------

router.get('/usage', (_req, res) => {
  if (!ensureReady(res)) return;
  const rows = listCliUsage();
  res.json({
    clis: rows.map((r) => ({
      cli: r.cli,
      plan: r.plan,
      session_pct: r.session_pct,
      session_reset: r.session_reset,
      week_pct_all: r.week_pct_all,
      week_pct_sonnet: r.week_pct_sonnet,
      week_reset: r.week_reset,
      credits: r.credits,
      error: r.error,
      fetched_at: r.fetched_at,
    })),
  });
});

router.post('/usage/refresh', (_req, res) => {
  if (!ensureReady(res)) return;
  // Fire-and-forget — the PTY round-trip is ~10s, far longer than we want
  // to hold the HTTP request open. The UI polls /usage to pick up the new
  // row when it lands.
  setImmediate(() => {
    refreshClaudeUsage({ logger: console }).catch((err) =>
      console.warn('[claudeUsage] refresh threw:', err?.message));
  });
  res.json({ ok: true });
});

router.post('/help/refresh', (_req, res) => {
  if (!ensureReady(res)) return;
  // Fire-and-forget so the request returns quickly. The scanner is sync per
  // CLI (spawnSync) but takes a few seconds across all five; defer to the
  // next tick so the HTTP response flushes first.
  setImmediate(() => {
    try { scanAndPersistCliHelp({ logger: console }); }
    catch (err) { console.warn('[cliHelpScan] refresh failed:', err?.message); }
  });
  res.json({ ok: true });
});

export default router;
