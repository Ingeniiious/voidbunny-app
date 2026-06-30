import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { insertTokenUsage, getScanState, saveScanState } from './db.js';

// Token-usage scanner.
//
// Each supported CLI writes a per-session JSONL with one message per line.
// We bookmark the byte offset we've consumed in each file (scan_state table)
// and on each scan tail-read only the new bytes. INSERT OR IGNORE on
// message_uuid de-dupes across re-scans of the same file.
//
// Sources and shapes:
//
// 1. Claude Code   ~/.claude/projects/<encoded-cwd>/<session>.jsonl
//      Each `type: "assistant"` line has:
//        message.usage.{input_tokens, output_tokens,
//                       cache_creation_input_tokens,
//                       cache_read_input_tokens}
//        message.model, uuid, cwd, timestamp
//
// 2. Codex         ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
//      First line: type=session_meta, payload.cwd, payload.id
//      Later lines: type=event_msg with payload.type=token_count
//        carry payload.info.last_token_usage = the delta for the just-
//        finished turn. We accumulate `last_token_usage` rows.
//
// 3. Gemini        ~/.gemini/tmp/<project>/chats/session-*.jsonl
//      First line: sessionId, startTime, projectHash
//      Each `type: "gemini"` line has tokens.{input, output, cached, ...},
//        model, id, timestamp. cwd resolved via ~/.gemini/projects.json
//        (the `tmp/<project>` segment is the human-readable map key).

const CLAUDE_DIR = path.join(os.homedir(), '.claude', 'projects');
const CODEX_DIR  = path.join(os.homedir(), '.codex',  'sessions');
const GEMINI_DIR = path.join(os.homedir(), '.gemini', 'tmp');
const GEMINI_PROJECTS_FILE = path.join(os.homedir(), '.gemini', 'projects.json');

// Reverse the encoding Claude Code uses for the project dir name. It just
// replaces `/` with `-`, so the leading "-home-void-Claude-Server" maps
// straight back to "/home/void/Claude-Server". The first char becomes "/".
function decodeClaudeCwd(dirName) {
  if (!dirName) return null;
  return dirName.replace(/^-/, '/').replace(/-/g, '/');
}

// Load Gemini's projects.json to get tmp-dir-name → cwd. Lower-cased keys
// are the convention (`projects.json` stores them already lowercased), so
// we lookup by basename.toLowerCase().
async function loadGeminiProjectMap() {
  try {
    const raw = await fs.readFile(GEMINI_PROJECTS_FILE, 'utf8');
    const j = JSON.parse(raw);
    // j.projects is { "/abs/cwd": "humanName" }. Invert.
    const inv = new Map();
    for (const [cwd, name] of Object.entries(j.projects || {})) {
      inv.set(String(name).toLowerCase(), cwd);
    }
    return inv;
  } catch {
    return new Map();
  }
}

// Generic line-by-line tail consumer. Reads from `state.last_offset` to the
// current EOF and yields parsed JSON per line. Lines that fail to parse are
// skipped silently (a partial-write at the tail is the usual cause and the
// next scan will read it whole).
async function* tailLines(filePath, state) {
  const stat = await fs.stat(filePath);
  if (stat.size <= state.last_offset && state.last_mtime === Math.floor(stat.mtimeMs)) {
    return;
  }
  // Detect a truncation / log rotation: file got smaller than our cursor.
  // Reset and re-read everything from byte 0.
  if (stat.size < state.last_offset) state.last_offset = 0;

  const fd = await fs.open(filePath, 'r');
  try {
    const start = state.last_offset;
    const len = Math.max(0, stat.size - start);
    if (len === 0) {
      state.last_mtime = Math.floor(stat.mtimeMs);
      return;
    }
    const buf = Buffer.alloc(len);
    await fd.read(buf, 0, len, start);
    const text = buf.toString('utf8');
    // If the last line is incomplete (no trailing \n), leave it un-consumed
    // so a future scan can re-read the full line once it's flushed.
    let consumed = 0;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isLast = i === lines.length - 1;
      if (isLast && !text.endsWith('\n')) {
        // Don't advance past this partial.
        break;
      }
      consumed += line.length + 1;
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        yield JSON.parse(trimmed);
      } catch {
        // Bad line — could be a truncated write. Skip but keep advancing
        // so we don't get stuck on it forever.
      }
    }
    state.last_offset = start + consumed;
    state.last_mtime = Math.floor(stat.mtimeMs);
  } finally {
    await fd.close();
  }
}

// Walk a directory tree and yield .jsonl paths.
async function* walkJsonl(root) {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const p = path.join(root, ent.name);
    if (ent.isDirectory()) {
      yield* walkJsonl(p);
    } else if (ent.isFile() && ent.name.endsWith('.jsonl')) {
      yield p;
    }
  }
}

function tsFromIso(s) {
  if (!s || typeof s !== 'string') return Date.now();
  const n = Date.parse(s);
  return Number.isFinite(n) ? n : Date.now();
}

async function scanClaudeFile(filePath) {
  const state = getScanState(filePath) || { last_offset: 0, last_mtime: 0 };
  const projectDir = path.basename(path.dirname(filePath));
  const cwd = decodeClaudeCwd(projectDir);
  let inserted = 0;
  for await (const obj of tailLines(filePath, state)) {
    if (obj.type !== 'assistant') continue;
    const msg = obj.message;
    if (!msg || typeof msg !== 'object') continue;
    const usage = msg.usage;
    if (!usage) continue;
    const ok = insertTokenUsage({
      cli: 'claude',
      ts: tsFromIso(obj.timestamp),
      cwd: obj.cwd || cwd,
      model: msg.model || null,
      input_tokens: usage.input_tokens || 0,
      output_tokens: usage.output_tokens || 0,
      cache_creation_tokens: usage.cache_creation_input_tokens || 0,
      cache_read_tokens: usage.cache_read_input_tokens || 0,
      reasoning_tokens: 0,
      message_uuid: obj.uuid || msg.id || null,
    });
    if (ok) inserted++;
  }
  saveScanState(filePath, state.last_offset, state.last_mtime);
  return inserted;
}

async function scanCodexFile(filePath) {
  const state = getScanState(filePath) || { last_offset: 0, last_mtime: 0 };
  // Per-file cwd + sessionId come from the session_meta line. If we've
  // already past it (re-scan), the meta won't reappear — we cache it on the
  // scan_state? Simpler: re-read the first line via a side fd to grab cwd.
  let cwd = null;
  let sessionId = null;
  try {
    const first = await fs.open(filePath, 'r');
    try {
      const buf = Buffer.alloc(4096);
      const { bytesRead } = await first.read(buf, 0, 4096, 0);
      const head = buf.subarray(0, bytesRead).toString('utf8');
      const firstLine = head.split('\n', 1)[0];
      const meta = JSON.parse(firstLine);
      if (meta?.type === 'session_meta') {
        cwd = meta.payload?.cwd || null;
        sessionId = meta.payload?.id || null;
      }
    } finally {
      await first.close();
    }
  } catch { /* not a session file we recognize */ }

  let turnIdx = 0;
  let inserted = 0;
  for await (const obj of tailLines(filePath, state)) {
    if (obj?.type !== 'event_msg') continue;
    const payload = obj.payload;
    if (!payload || payload.type !== 'token_count') continue;
    const last = payload.info?.last_token_usage;
    if (!last) continue;
    turnIdx++;
    const uuid = sessionId ? `codex:${sessionId}:${turnIdx}` : null;
    const ok = insertTokenUsage({
      cli: 'codex',
      ts: tsFromIso(obj.timestamp),
      cwd,
      model: payload.info?.model || null,
      input_tokens: last.input_tokens || 0,
      output_tokens: last.output_tokens || 0,
      // Codex reports `cached_input_tokens` — count it as cache_read since
      // it's tokens served from cache (the prompt-cache equivalent).
      cache_read_tokens: last.cached_input_tokens || 0,
      cache_creation_tokens: 0,
      reasoning_tokens: last.reasoning_output_tokens || 0,
      message_uuid: uuid,
    });
    if (ok) inserted++;
  }
  saveScanState(filePath, state.last_offset, state.last_mtime);
  return inserted;
}

async function scanGeminiFile(filePath, projectMap) {
  const state = getScanState(filePath) || { last_offset: 0, last_mtime: 0 };
  const projectKey = path.basename(path.dirname(path.dirname(filePath))).toLowerCase();
  const cwd = projectMap.get(projectKey) || null;
  let inserted = 0;
  for await (const obj of tailLines(filePath, state)) {
    if (obj?.type !== 'gemini') continue;
    const t = obj.tokens;
    if (!t) continue;
    const ok = insertTokenUsage({
      cli: 'gemini',
      ts: tsFromIso(obj.timestamp),
      cwd,
      model: obj.model || null,
      input_tokens: t.input || 0,
      output_tokens: t.output || 0,
      cache_read_tokens: t.cached || 0,
      cache_creation_tokens: 0,
      reasoning_tokens: t.thoughts || 0,
      message_uuid: obj.id ? `gemini:${obj.id}` : null,
    });
    if (ok) inserted++;
  }
  saveScanState(filePath, state.last_offset, state.last_mtime);
  return inserted;
}

let scanning = false;

export async function scanOnce() {
  if (scanning) return;
  scanning = true;
  let total = 0;
  try {
    for await (const p of walkJsonl(CLAUDE_DIR)) {
      try { total += await scanClaudeFile(p); } catch (e) { /* per-file failure shouldn't block others */ }
    }
    for await (const p of walkJsonl(CODEX_DIR)) {
      try { total += await scanCodexFile(p); } catch (e) { /* skip */ }
    }
    if (fsSync.existsSync(GEMINI_DIR)) {
      const projectMap = await loadGeminiProjectMap();
      for await (const p of walkJsonl(GEMINI_DIR)) {
        try { total += await scanGeminiFile(p, projectMap); } catch (e) { /* skip */ }
      }
    }
  } finally {
    scanning = false;
  }
  if (total > 0) console.log(`[tokenScan] inserted ${total} usage row(s)`);
  return total;
}

let timer = null;
const SCAN_INTERVAL_MS = 5 * 60 * 1000;

export function startTokenScanner() {
  if (timer) return;
  // First pass shortly after boot so the dashboard has data on the first
  // dashboard click. Subsequent passes every 5 min.
  setTimeout(() => { scanOnce().catch(() => {}); }, 5_000);
  timer = setInterval(() => { scanOnce().catch(() => {}); }, SCAN_INTERVAL_MS);
  timer.unref?.();
}
