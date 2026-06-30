import { spawn } from 'node-pty';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { isReady, upsertCliUsage } from './db.js';

// Spawns a fresh Claude Code interactive session in a throwaway dir, sends
// `/usage`, captures the rendered TUI, parses out the session/week percent +
// reset times + credits, and tears it down. There is no CLI subcommand for
// this — /usage is interactive-only — so we have to drive the REPL.
//
// The output is heavy TUI (box drawing + cursor positioning). We render it
// to a 2D grid first so that "Current session" / percent / "Resets X" land
// on consecutive lines we can regex against. Stripping ANSI naively
// concatenates words ("Sonet nly" instead of "Sonnet only").

const PROBE_DIR = path.join(os.tmpdir(), 'claude-usage-probe');
const COLS = 140;
const ROWS = 80;
const CAPTURE_MS = 12000;

function ensureProbeDir() {
  fs.mkdirSync(PROBE_DIR, { recursive: true });
  // Drop a .claude/settings.local.json that pre-trusts this folder so the
  // probe doesn't have to dismiss the safety prompt every time. Best-effort
  // — if it fails we fall back to sending Enter at boot to accept manually.
  try {
    const sd = path.join(PROBE_DIR, '.claude');
    fs.mkdirSync(sd, { recursive: true });
    const sp = path.join(sd, 'settings.local.json');
    if (!fs.existsSync(sp)) {
      fs.writeFileSync(sp, JSON.stringify({ trustDialogAccepted: true }, null, 2));
    }
  } catch { /* non-fatal */ }
}

// 2D-grid terminal emulator. Handles enough escape sequences for Claude
// Code's /usage panel (CUP, CUF, CUB, HPA, CR/LF/BS, OSC-skip). Other
// sequences are ignored, which is fine — we only care about the text laid
// out at its final cursor positions.
function renderToLines(rawBuf, cols = COLS, rows = ROWS) {
  const grid = Array.from({ length: rows }, () => Array(cols).fill(' '));
  let r = 0, c = 0;
  let i = 0;
  while (i < rawBuf.length) {
    const ch = rawBuf[i];
    // OSC (ESC ] ... BEL)
    if (ch === '\x1b' && rawBuf[i + 1] === ']') {
      const end = rawBuf.indexOf('\x07', i);
      i = end === -1 ? rawBuf.length : end + 1;
      continue;
    }
    // CSI (ESC [ params final)
    if (ch === '\x1b' && rawBuf[i + 1] === '[') {
      let j = i + 2;
      let params = '';
      while (j < rawBuf.length && /[0-9;?]/.test(rawBuf[j])) { params += rawBuf[j]; j++; }
      const final = rawBuf[j] || '';
      const n = parseInt(params, 10) || 1;
      switch (final) {
        case 'G': c = Math.max(0, n - 1); break;
        case 'C': c = Math.min(cols - 1, c + n); break;
        case 'D': c = Math.max(0, c - n); break;
        case 'A': r = Math.max(0, r - n); break;
        case 'B': r = Math.min(rows - 1, r + n); break;
        case 'H': case 'f': {
          const [rr, cc] = params.split(';').map((x) => parseInt(x, 10) || 1);
          r = Math.max(0, (rr || 1) - 1);
          c = Math.max(0, (cc || 1) - 1);
          break;
        }
        default: /* SGR, erase, etc. — skip */ break;
      }
      i = j + 1;
      continue;
    }
    if (ch === '\x1b') { i += 2; continue; }
    if (ch === '\r') { c = 0; i++; continue; }
    if (ch === '\n') { r++; c = 0; if (r >= rows) r = rows - 1; i++; continue; }
    if (ch === '\b') { c = Math.max(0, c - 1); i++; continue; }
    if (ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127) { i++; continue; }
    if (r >= 0 && r < rows && c >= 0 && c < cols) grid[r][c] = ch;
    c++;
    if (c >= cols) { c = 0; r++; }
    i++;
  }
  return grid.map((row) => row.join('').replace(/\s+$/, ''));
}

// Walk the rendered lines, looking for the three usage rows. Each section
// has the header on one line, a bar+percent line below, and a "Resets …"
// line after. Headers can drift to nearby lines if the TUI rerenders, so
// scan within a small window after each header match.
function parseUsageLines(lines) {
  const findSection = (headerRegex) => {
    for (let i = 0; i < lines.length; i++) {
      if (headerRegex.test(lines[i])) {
        // Look up to 4 lines below the header for percent + reset
        let pct = null;
        let reset = null;
        for (let j = 1; j <= 4 && i + j < lines.length; j++) {
          const l = lines[i + j];
          if (pct === null) {
            const m = l.match(/(\d+)%\s*used/);
            if (m) pct = parseInt(m[1], 10);
          }
          if (reset === null) {
            const m = l.match(/Resets\s+(.+?)(?:\s{2,}|$)/);
            if (m) reset = m[1].trim();
          }
          if (pct !== null && reset !== null) break;
        }
        return { pct, reset };
      }
    }
    return { pct: null, reset: null };
  };

  const session = findSection(/^\s*Current session\s*$/);
  const weekAll = findSection(/^\s*Current week \(all models\)/);
  const weekSon = findSection(/^\s*Current week \(Sonnet only\)/);

  // Credits line is somewhere in the panel — match anywhere.
  let credits = null;
  for (const l of lines) {
    const m = l.match(/Usage credits\s*[:\s]\s*(Unlimited|\d[\d,]*)/i);
    if (m) { credits = m[1]; break; }
  }

  // Account / plan line ("Opus 4.7 (1M context) · Claude Max ·")
  let plan = null;
  for (const l of lines) {
    const m = l.match(/Claude\s+(Max|Pro|Team|Enterprise)/i);
    if (m) { plan = m[0].trim(); break; }
  }

  return {
    session_pct: session.pct,
    session_reset: session.reset,
    week_pct_all: weekAll.pct,
    week_reset: weekAll.reset || weekSon.reset,
    week_pct_sonnet: weekSon.pct,
    credits,
    plan,
  };
}

// Spawn claude, send /usage, wait, parse. Returns { ok, data, error }.
export async function fetchClaudeUsage({ logger = console } = {}) {
  ensureProbeDir();
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn('claude', [], {
        name: 'xterm-256color', cols: COLS, rows: ROWS,
        cwd: PROBE_DIR,
        env: { ...process.env, NO_COLOR: '1', TERM: 'xterm-256color', CI: '1' },
      });
    } catch (err) {
      return resolve({ ok: false, error: `spawn failed: ${err?.message || err}` });
    }

    let buf = '';
    const onData = (d) => { buf += d; };
    proc.onData(onData);

    // Press Enter once to dismiss any "trust folder" or onboarding prompt
    // that lands before we can type. Harmless if there's nothing to dismiss.
    const t1 = setTimeout(() => { try { proc.write('\r'); } catch {} }, 2500);
    const t2 = setTimeout(() => { try { proc.write('/usage\r'); } catch {} }, 4500);

    const finish = () => {
      clearTimeout(t1); clearTimeout(t2);
      try { proc.kill(); } catch {}
      const lines = renderToLines(buf, COLS, ROWS);
      const data = parseUsageLines(lines);
      const haveAny = data.session_pct !== null || data.week_pct_all !== null;
      if (!haveAny) {
        logger?.warn?.('[claudeUsage] no fields parsed; first 600 chars of render:\n' + lines.slice(0, 30).join('\n'));
        return resolve({ ok: false, error: 'could not parse usage panel', raw_lines: lines });
      }
      resolve({ ok: true, data, raw_lines: lines });
    };

    setTimeout(finish, CAPTURE_MS);
  });
}

// Convenience wrapper: fetch and persist into cli_usage. Used by the boot
// scheduler and the /refresh endpoint. Always writes a row (with an `error`
// field on failure) so the UI can show staleness.
export async function refreshClaudeUsage({ logger = console } = {}) {
  if (!isReady()) {
    logger?.warn?.('[claudeUsage] db not ready');
    return { ok: false, error: 'db not ready' };
  }
  const res = await fetchClaudeUsage({ logger });
  const now = Date.now();
  if (res.ok) {
    upsertCliUsage({
      cli: 'claude',
      ...res.data,
      raw_lines: null,
      error: null,
      fetched_at: now,
    });
    logger?.log?.(`[claudeUsage] refreshed: session=${res.data.session_pct}% week=${res.data.week_pct_all}%`);
  } else {
    upsertCliUsage({
      cli: 'claude',
      plan: null, session_pct: null, session_reset: null,
      week_pct_all: null, week_pct_sonnet: null, week_reset: null,
      credits: null, raw_lines: null,
      error: res.error || 'unknown',
      fetched_at: now,
    });
    logger?.warn?.(`[claudeUsage] refresh failed: ${res.error}`);
  }
  return res;
}
