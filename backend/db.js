import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Embedded SQLite (better-sqlite3) holds the activity log: which CLI ran in
// which cwd, when, for how long. File lives next to the other JSON state at
// backend/data/activity.db. WAL mode lets reads from the activity API run
// without blocking the busy.js writer thread.
//
// If the native module fails to load (e.g. ABI mismatch after a node bump),
// we fall back to a no-op shim so the rest of the panel keeps working — the
// dashboard just shows empty state until the rebuild lands.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'activity.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

let db = null;
let loadError = null;
try {
  const { default: Database } = await import('better-sqlite3');
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
} catch (err) {
  loadError = err;
  console.warn('[db] activity DB unavailable, tracking disabled:', err?.message);
}

if (db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id          TEXT PRIMARY KEY,
      first_seen  INTEGER NOT NULL,
      last_seen   INTEGER NOT NULL,
      last_cwd    TEXT,
      last_cli    TEXT,
      last_name   TEXT
    );

    CREATE TABLE IF NOT EXISTS cli_runs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id  TEXT NOT NULL,
      cli         TEXT NOT NULL,
      cwd         TEXT NOT NULL,
      started_at  INTEGER NOT NULL,
      ended_at    INTEGER,
      busy_ms     INTEGER NOT NULL DEFAULT 0,
      turn_count  INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_cli_runs_started ON cli_runs(started_at);
    CREATE INDEX IF NOT EXISTS idx_cli_runs_cwd     ON cli_runs(cwd);
    CREATE INDEX IF NOT EXISTS idx_cli_runs_session ON cli_runs(session_id);

    CREATE TABLE IF NOT EXISTS events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ts          INTEGER NOT NULL,
      kind        TEXT NOT NULL,
      session_id  TEXT NOT NULL,
      cli         TEXT,
      cwd         TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);

    CREATE TABLE IF NOT EXISTS repos (
      cwd            TEXT PRIMARY KEY,
      owner          TEXT,
      repo           TEXT,
      host           TEXT,
      remote_url     TEXT,
      avatar_url     TEXT,
      last_enriched  INTEGER
    );

    -- One row per assistant message (Claude Code) or per turn (Codex). The
    -- token-scanner walks the per-CLI history JSONLs and inserts here.
    -- message_uuid is UNIQUE so a re-scan of an old file is a cheap no-op.
    CREATE TABLE IF NOT EXISTS token_usage (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      cli                    TEXT NOT NULL,
      ts                     INTEGER NOT NULL,
      cwd                    TEXT,
      model                  TEXT,
      input_tokens           INTEGER NOT NULL DEFAULT 0,
      output_tokens          INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens  INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens      INTEGER NOT NULL DEFAULT 0,
      reasoning_tokens       INTEGER NOT NULL DEFAULT 0,
      message_uuid           TEXT UNIQUE
    );
    CREATE INDEX IF NOT EXISTS idx_token_usage_ts  ON token_usage(ts);
    CREATE INDEX IF NOT EXISTS idx_token_usage_cli ON token_usage(cli);
    CREATE INDEX IF NOT EXISTS idx_token_usage_cwd ON token_usage(cwd);

    -- Bookmark for the token scanner. Stores the byte offset we read up to
    -- in each JSONL so the next scan reads only new tail bytes. mtime gates
    -- whether we even bother opening the file.
    CREATE TABLE IF NOT EXISTS scan_state (
      path         TEXT PRIMARY KEY,
      last_offset  INTEGER NOT NULL DEFAULT 0,
      last_mtime   INTEGER NOT NULL DEFAULT 0
    );

    -- CLI Help Center: one row per supported CLI, populated by cliHelpScan.js.
    -- Holds installation state, version, and the raw --help we captured (for
    -- debugging when the parser misses a section).
    CREATE TABLE IF NOT EXISTS cli_catalog (
      cli              TEXT PRIMARY KEY,
      bin_path         TEXT,
      version          TEXT,
      installed        INTEGER NOT NULL DEFAULT 0,
      homepage         TEXT,
      display_name     TEXT,
      raw_help         TEXT,
      scan_error       TEXT,
      last_scanned_at  INTEGER
    );

    -- Per-CLI subscription usage snapshot — currently only Claude Code has
    -- a /usage panel we can drive, but the table is keyed by cli so future
    -- providers slot in without a migration. Refreshed by claudeUsageFetch.js.
    CREATE TABLE IF NOT EXISTS cli_usage (
      cli              TEXT PRIMARY KEY,
      plan             TEXT,
      session_pct      INTEGER,
      session_reset    TEXT,
      week_pct_all     INTEGER,
      week_pct_sonnet  INTEGER,
      week_reset       TEXT,
      credits          TEXT,
      raw_lines        TEXT,
      error            TEXT,
      fetched_at       INTEGER NOT NULL
    );

    -- Parsed subcommands/flags + curated slash commands. Replaced wholesale
    -- per (cli, kind) on each scan so renamed entries don't linger.
    CREATE TABLE IF NOT EXISTS cli_help_commands (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      cli          TEXT NOT NULL,
      kind         TEXT NOT NULL,
      name         TEXT NOT NULL,
      summary      TEXT,
      description  TEXT,
      usage        TEXT,
      source       TEXT NOT NULL,
      category     TEXT,
      sort_order   INTEGER DEFAULT 0,
      UNIQUE(cli, kind, name)
    );
    CREATE INDEX IF NOT EXISTS idx_cli_help_lookup
      ON cli_help_commands(cli, kind, sort_order);
  `);

  // Light migration for DBs created before `category` existed. SQLite has
  // no `ADD COLUMN IF NOT EXISTS`, so check the schema and add only when
  // missing. Safe to run on every boot.
  const cols = db.prepare("PRAGMA table_info(cli_help_commands)").all();
  if (!cols.some((c) => c.name === 'category')) {
    db.exec('ALTER TABLE cli_help_commands ADD COLUMN category TEXT');
  }
}

// Prepared statements — lazily created the first time they're used so a DB
// load failure doesn't blow up at import time.
const stmtCache = new Map();
function prep(key, sql) {
  if (!db) return null;
  let s = stmtCache.get(key);
  if (!s) {
    s = db.prepare(sql);
    stmtCache.set(key, s);
  }
  return s;
}

// All helpers are safe to call when db is null — they silently no-op so the
// caller (busy.js) doesn't have to gate every line.

export function isReady() {
  return !!db;
}

export function getDb() {
  return db;
}

export function upsertSession(sid, cwd, cli, name, now) {
  if (!db) return;
  prep(
    'upsertSession',
    `INSERT INTO sessions(id, first_seen, last_seen, last_cwd, last_cli, last_name)
       VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       last_seen = excluded.last_seen,
       last_cwd  = excluded.last_cwd,
       last_cli  = excluded.last_cli,
       last_name = excluded.last_name`,
  ).run(sid, now, now, cwd ?? null, cli ?? null, name ?? null);
}

export function getOpenRun(sid) {
  if (!db) return null;
  return prep(
    'getOpenRun',
    'SELECT * FROM cli_runs WHERE session_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1',
  ).get(sid) || null;
}

export function openRun(sid, cli, cwd, now) {
  if (!db) return null;
  const info = prep(
    'openRun',
    `INSERT INTO cli_runs(session_id, cli, cwd, started_at) VALUES (?, ?, ?, ?)`,
  ).run(sid, cli, cwd ?? '', now);
  return Number(info.lastInsertRowid);
}

export function closeRun(runId, endTs) {
  if (!db || !runId) return;
  prep(
    'closeRun',
    'UPDATE cli_runs SET ended_at = ? WHERE id = ? AND ended_at IS NULL',
  ).run(endTs, runId);
}

export function addBusyMs(runId, ms) {
  if (!db || !runId || !ms) return;
  prep(
    'addBusyMs',
    'UPDATE cli_runs SET busy_ms = busy_ms + ? WHERE id = ?',
  ).run(ms, runId);
}

export function bumpTurns(runId) {
  if (!db || !runId) return;
  prep(
    'bumpTurns',
    'UPDATE cli_runs SET turn_count = turn_count + 1 WHERE id = ?',
  ).run(runId);
}

export function logEvent(ts, kind, sid, cli, cwd) {
  if (!db) return;
  prep(
    'logEvent',
    'INSERT INTO events(ts, kind, session_id, cli, cwd) VALUES (?, ?, ?, ?, ?)',
  ).run(ts, kind, sid, cli ?? null, cwd ?? null);
}

export function getRepo(cwd) {
  if (!db) return null;
  return prep('getRepo', 'SELECT * FROM repos WHERE cwd = ?').get(cwd) || null;
}

export function upsertRepo({ cwd, owner, repo, host, remoteUrl, avatarUrl, now }) {
  if (!db) return;
  prep(
    'upsertRepo',
    `INSERT INTO repos(cwd, owner, repo, host, remote_url, avatar_url, last_enriched)
       VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(cwd) DO UPDATE SET
       owner = excluded.owner,
       repo = excluded.repo,
       host = excluded.host,
       remote_url = excluded.remote_url,
       avatar_url = excluded.avatar_url,
       last_enriched = excluded.last_enriched`,
  ).run(cwd, owner ?? null, repo ?? null, host ?? null, remoteUrl ?? null, avatarUrl ?? null, now);
}

export function insertTokenUsage(row) {
  if (!db) return false;
  try {
    const info = prep(
      'insertTokenUsage',
      `INSERT OR IGNORE INTO token_usage
         (cli, ts, cwd, model,
          input_tokens, output_tokens,
          cache_creation_tokens, cache_read_tokens,
          reasoning_tokens, message_uuid)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.cli,
      row.ts,
      row.cwd ?? null,
      row.model ?? null,
      row.input_tokens ?? 0,
      row.output_tokens ?? 0,
      row.cache_creation_tokens ?? 0,
      row.cache_read_tokens ?? 0,
      row.reasoning_tokens ?? 0,
      row.message_uuid ?? null,
    );
    return info.changes > 0;
  } catch {
    return false;
  }
}

export function getScanState(p) {
  if (!db) return null;
  return prep('getScanState', 'SELECT * FROM scan_state WHERE path = ?').get(p) || null;
}

export function saveScanState(p, offset, mtime) {
  if (!db) return;
  prep(
    'saveScanState',
    `INSERT INTO scan_state(path, last_offset, last_mtime) VALUES (?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET
       last_offset = excluded.last_offset,
       last_mtime  = excluded.last_mtime`,
  ).run(p, offset, mtime);
}

// --- CLI Help Center -------------------------------------------------------

export function upsertCliCatalog(row) {
  if (!db) return;
  prep(
    'upsertCliCatalog',
    `INSERT INTO cli_catalog
       (cli, bin_path, version, installed, homepage, display_name,
        raw_help, scan_error, last_scanned_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(cli) DO UPDATE SET
       bin_path        = excluded.bin_path,
       version         = excluded.version,
       installed       = excluded.installed,
       homepage        = excluded.homepage,
       display_name    = excluded.display_name,
       raw_help        = excluded.raw_help,
       scan_error      = excluded.scan_error,
       last_scanned_at = excluded.last_scanned_at`,
  ).run(
    row.cli,
    row.bin_path ?? null,
    row.version ?? null,
    row.installed ? 1 : 0,
    row.homepage ?? null,
    row.display_name ?? null,
    row.raw_help ?? null,
    row.scan_error ?? null,
    row.last_scanned_at ?? Date.now(),
  );
}

// Wipe then re-insert all rows for a (cli, kind) in one transaction so the
// catalog never half-updates if the process dies mid-write.
export function replaceCliHelpCommands(cli, kind, rows) {
  if (!db) return;
  const del = prep(
    'deleteCliHelpCommands',
    'DELETE FROM cli_help_commands WHERE cli = ? AND kind = ?',
  );
  const ins = prep(
    'insertCliHelpCommand',
    `INSERT INTO cli_help_commands
       (cli, kind, name, summary, description, usage, source, category, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const tx = db.transaction((items) => {
    del.run(cli, kind);
    items.forEach((r, idx) => {
      ins.run(
        cli,
        kind,
        r.name,
        r.summary ?? null,
        r.description ?? null,
        r.usage ?? null,
        r.source ?? 'parsed',
        r.category ?? null,
        r.sort_order ?? idx,
      );
    });
  });
  tx(rows || []);
}

export function listCliCatalog() {
  if (!db) return [];
  return prep(
    'listCliCatalog',
    'SELECT * FROM cli_catalog ORDER BY installed DESC, display_name, cli',
  ).all();
}

export function getCliCatalogRow(cli) {
  if (!db) return null;
  return prep(
    'getCliCatalogRow',
    'SELECT * FROM cli_catalog WHERE cli = ?',
  ).get(cli) || null;
}

export function listCliHelpCommands(cli, kind) {
  if (!db) return [];
  if (kind) {
    return prep(
      'listCliHelpCommandsByKind',
      `SELECT * FROM cli_help_commands
         WHERE cli = ? AND kind = ?
         ORDER BY sort_order, name`,
    ).all(cli, kind);
  }
  return prep(
    'listCliHelpCommandsAll',
    `SELECT * FROM cli_help_commands
       WHERE cli = ?
       ORDER BY kind, sort_order, name`,
  ).all(cli);
}

export function upsertCliUsage(row) {
  if (!db) return;
  prep(
    'upsertCliUsage',
    `INSERT INTO cli_usage
       (cli, plan, session_pct, session_reset, week_pct_all, week_pct_sonnet,
        week_reset, credits, raw_lines, error, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(cli) DO UPDATE SET
       plan            = excluded.plan,
       session_pct     = excluded.session_pct,
       session_reset   = excluded.session_reset,
       week_pct_all    = excluded.week_pct_all,
       week_pct_sonnet = excluded.week_pct_sonnet,
       week_reset      = excluded.week_reset,
       credits         = excluded.credits,
       raw_lines       = excluded.raw_lines,
       error           = excluded.error,
       fetched_at      = excluded.fetched_at`,
  ).run(
    row.cli,
    row.plan ?? null,
    row.session_pct ?? null,
    row.session_reset ?? null,
    row.week_pct_all ?? null,
    row.week_pct_sonnet ?? null,
    row.week_reset ?? null,
    row.credits ?? null,
    row.raw_lines ?? null,
    row.error ?? null,
    row.fetched_at ?? Date.now(),
  );
}

export function listCliUsage() {
  if (!db) return [];
  return prep('listCliUsage', 'SELECT * FROM cli_usage').all();
}

export function countCliHelpCommands() {
  if (!db) return [];
  return prep(
    'countCliHelpCommands',
    `SELECT cli, kind, COUNT(*) AS n
       FROM cli_help_commands
       GROUP BY cli, kind`,
  ).all();
}

// Close any cli_runs left open across a panel restart. Without this, a row
// from before the crash stays "active" forever and the open-run lookup in
// busy.js would attach new busy_ms to a stale interval. Called once on boot.
export function closeStaleRuns(now) {
  if (!db) return;
  prep(
    'closeStaleRuns',
    'UPDATE cli_runs SET ended_at = ? WHERE ended_at IS NULL',
  ).run(now);
}

if (loadError) {
  // Surface the underlying cause once at startup. Helpful when the user
  // upgrades node and forgets to rebuild the native binding.
  console.warn('[db] hint: try `cd backend && npm rebuild better-sqlite3`');
}
