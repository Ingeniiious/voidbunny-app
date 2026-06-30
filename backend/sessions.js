import { Router } from 'express';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { registerSessionToken, clearSessionToken } from './panel-open.js';
import { PANEL_HOME } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execFileP = promisify(execFile);

// Absolute path to the panel-open shim. Each session gets a private dir under
// /tmp with `panel-open` and `xdg-open` symlinks pointing here, plus a PATH
// prefix that makes them win over the system xdg-open. See setupSessionShim().
const PANEL_OPEN_BIN = path.resolve(__dirname, 'scripts/panel-open.sh');
const SHIM_ROOT = '/tmp/panel-shim';
const PANEL_PORT = String(process.env.PORT || 4000);

export const TMUX_BIN = '/usr/bin/tmux';
export const TMUX_SOCK = 'panel';
export const TMUX_CONF = path.resolve(__dirname, '../deploy/panel.tmux.conf');
export const SESSION_PREFIX = 'panel-';
const SID_RE = /^panel-[a-f0-9]{12}$/;

export function isValidSid(sid) {
  return typeof sid === 'string' && SID_RE.test(sid);
}

// In-memory mirror of sids we've seen alive. Lets the WS upgrade path skip
// the ~30–100 ms `tmux has-session` fork on the hot path of "POST /sessions
// then open WS for it." Populated by POST/GET, drained by DELETE. Survives
// a server restart via the GET handler re-priming it on first call.
const knownSids = new Set();
export function sessionKnownLocally(sid) {
  return typeof sid === 'string' && knownSids.has(sid);
}

// Sessions we've already wired the per-session shim env into during this
// process's lifetime. Re-priming the same session is harmless (tmux
// set-environment is idempotent and the fs ops are force-recreate) but
// pointless work, so we skip it once setup has run.
const shimReady = new Set();

export function tmux(args) {
  return execFileP(TMUX_BIN, ['-L', TMUX_SOCK, '-f', TMUX_CONF, ...args], { timeout: 5000 });
}

// Which agent CLIs we know how to label. The values are the process `comm`
// names exposed by /proc/<pid>/comm — both `claude` and `gemini` ship as
// Node scripts but they exec'd themselves with argv[0] set to the bin name,
// and `codex` is a Rust binary the npm wrapper spawns as a child. `grok` is
// the xAI CLI (curl install from x.ai/cli) and `cursor-agent` is the binary
// name the Cursor CLI installer drops in ~/.local/bin — Linux comm is capped
// at 15 chars so the full name fits as-is.
const CLI_PROCS = new Set(['claude', 'codex', 'gemini', 'grok', 'cursor-agent']);

// Map raw /proc comm names to the frontend CliKind enum. Most are 1:1 but
// `cursor-agent` collapses to `cursor` so the frontend doesn't need to know
// about the binary's actual name.
const CLI_COMM_TO_KIND = {
  'cursor-agent': 'cursor',
};
function commToKind(comm) {
  return CLI_COMM_TO_KIND[comm] ?? comm;
}

// One scan of /proc → { pid: {ppid, comm} }. Cheap (a few hundred reads on a
// typical box) and gives us a snapshot to walk descendants for each pane.
export async function readProcs() {
  let entries;
  try {
    entries = await fs.readdir('/proc');
  } catch {
    return null;
  }
  const map = new Map();
  await Promise.all(entries.map(async (name) => {
    if (!/^\d+$/.test(name)) return;
    const pid = Number(name);
    try {
      const [comm, statusRaw] = await Promise.all([
        fs.readFile(`/proc/${pid}/comm`, 'utf8'),
        fs.readFile(`/proc/${pid}/status`, 'utf8'),
      ]);
      const m = statusRaw.match(/^PPid:\s+(\d+)/m);
      if (!m) return;
      map.set(pid, { comm: comm.trim(), ppid: Number(m[1]) });
    } catch { /* process died mid-scan, skip */ }
  }));
  return map;
}

// Walk descendants of `rootPid` breadth-first, returning the first one whose
// `comm` matches a known agent CLI. Bounded by visit count so a runaway proc
// tree can't make this loop forever.
export function findCliInTree(procs, rootPid) {
  if (!procs) return null;
  const children = new Map();
  for (const [pid, info] of procs) {
    if (!children.has(info.ppid)) children.set(info.ppid, []);
    children.get(info.ppid).push(pid);
  }
  const queue = [rootPid];
  const seen = new Set();
  let visits = 0;
  while (queue.length && visits++ < 200) {
    const pid = queue.shift();
    if (seen.has(pid)) continue;
    seen.add(pid);
    const info = procs.get(pid);
    if (info && CLI_PROCS.has(info.comm)) return commToKind(info.comm);
    const kids = children.get(pid);
    if (kids) for (const k of kids) queue.push(k);
  }
  return null;
}

export async function sessionExists(sid) {
  if (!isValidSid(sid)) return false;
  try {
    await tmux(['has-session', '-t', sid]);
    return true;
  } catch {
    return false;
  }
}

const router = Router();

router.get('/sessions', async (_req, res) => {
  try {
    // We also pull `pane_pid` per session — root of the pane's process tree.
    // The frontend uses the resulting `cli` field to colour/icon the tab the
    // moment a session is fetched, no buffer-scan wait.
    const { stdout } = await tmux([
      'list-sessions',
      '-F',
      '#{session_name}|#{session_created}|#{session_attached}|#{session_windows}|#{pane_pid}|#{pane_current_path}',
    ]);
    const rows = stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        // Path could in theory contain '|', so consume the first 5 fields and
        // re-join the rest as the cwd.
        const parts = line.split('|');
        const [id, created, attached, windows, panePid] = parts;
        const cwd = parts.slice(5).join('|') || null;
        return {
          id,
          created: Number(created) * 1000,
          attached: Number(attached) > 0,
          windows: Number(windows),
          panePid: Number(panePid) || 0,
          cwd,
        };
      })
      .filter((s) => s.id.startsWith(SESSION_PREFIX));
    // Re-prime the fast-path cache from authoritative tmux state. Cheap —
    // the list already exists in memory by this point.
    for (const s of rows) knownSids.add(s.id);
    // Lazy shim setup: covers sessions created before this panel restart (or
    // before this feature shipped). Fires once per session — `tokens` Map in
    // panel-open.js acts as the sentinel inside setupSessionShim's caller,
    // so re-priming here just checks the local mirror.
    for (const s of rows) {
      if (!shimReady.has(s.id)) {
        shimReady.add(s.id);
        void setupSessionShim(s.id).catch(() => {});
      }
    }
    const procs = await readProcs();
    const sessions = rows.map(({ panePid, ...s }) => ({
      ...s,
      cli: panePid ? findCliInTree(procs, panePid) : null,
    }));
    res.json(sessions);
  } catch (err) {
    const stderr = err.stderr ?? '';
    if (stderr.includes('no server running') || stderr.includes('No such file')) {
      return res.json([]);
    }
    res.status(500).json({ error: stderr || err.message });
  }
});

// Always start new sessions in $HOME, independent of panel.service's WorkingDirectory.
const SESSION_CWD = PANEL_HOME;

// Names the shim presents itself as. xdg-open is the canonical Linux opener;
// the others cover CLIs that exec a specific browser binary directly (gh's
// `cmd/browser` package, Node's `open` package, Python's `webbrowser` fallback
// chain) or distros that ship sensible-browser / www-browser as the system
// default. All of them are symlinked to PANEL_OPEN_BIN — the shim doesn't care
// about its argv[0], it just takes URL as $1.
const SHIM_NAMES = [
  'panel-open', 'xdg-open',
  'chrome', 'google-chrome', 'google-chrome-stable',
  'chromium', 'chromium-browser',
  'firefox', 'firefox-esr',
  'brave', 'brave-browser',
  'open',                      // macOS-style, also npm `open-cli` binary
  'www-browser', 'x-www-browser', 'sensible-browser',
  'gnome-open', 'kde-open',
];

// Materialise the per-session shim dir on disk. Returns the env vars CLIs will
// need (BROWSER / PANEL_* / PATH) — caller decides whether to inject them at
// session-create time (-e on new-session, which the first pane sees) or via
// set-environment afterwards (only inherited by future panes). Best-effort: if
// any fs op fails we return null and the session works minus browser routing.
async function prepareSessionShim(sid) {
  const shimDir = path.join(SHIM_ROOT, sid);
  const token = crypto.randomBytes(16).toString('hex');
  const panelOpenPath = path.join(shimDir, 'panel-open');
  try {
    await fs.mkdir(shimDir, { recursive: true, mode: 0o700 });
    // Write the token to a 0600 file so the shim can recover it even when the
    // pane's env is stale (e.g. an old shell that pre-dated this session's
    // shim provisioning across a panel restart). PrivateTmp on panel.service
    // keeps this file invisible to anything outside the panel cgroup.
    await fs.writeFile(path.join(shimDir, 'token'), token, { mode: 0o600 });
    for (const name of SHIM_NAMES) {
      const link = path.join(shimDir, name);
      await fs.rm(link, { force: true });
      await fs.symlink(PANEL_OPEN_BIN, link);
    }
    return {
      shimDir,
      token,
      env: {
        BROWSER: panelOpenPath,
        PANEL_SESSION_ID: sid,
        PANEL_OPEN_TOKEN: token,
        PANEL_PORT: PANEL_PORT,
        // Prepend so our xdg-open wins over /usr/bin/xdg-open. The user's
        // bashrc may extend PATH but rarely overwrites it whole, so our prefix
        // survives shell init in practice.
        PATH: `${shimDir}:${process.env.PATH || ''}`,
      },
    };
  } catch (err) {
    console.warn(`[sessions] shim prepare failed for ${sid}:`, err.message);
    return null;
  }
}

// Lazy re-prime path used by GET /sessions for sessions that existed before
// this panel boot. We only get to set the session env (set-environment) — the
// first pane's already-running shell missed its chance. Newly opened panes in
// that session will get the right env, and the token-file fallback in
// panel-open.sh covers the existing pane via $TMUX_PANE lookup.
async function setupSessionShim(sid) {
  const shim = await prepareSessionShim(sid);
  if (!shim) return;
  try {
    for (const [name, value] of Object.entries(shim.env)) {
      await tmux(['set-environment', '-t', sid, name, value]);
    }
    registerSessionToken(sid, shim.token);
  } catch (err) {
    console.warn(`[sessions] shim env-set failed for ${sid}:`, err.message);
  }
}

async function teardownSessionShim(sid) {
  clearSessionToken(sid);
  shimReady.delete(sid);
  const shimDir = path.join(SHIM_ROOT, sid);
  try {
    await fs.rm(shimDir, { recursive: true, force: true });
  } catch { /* /tmp lifecycle handles the rest */ }
}

router.post('/sessions', async (_req, res) => {
  const id = SESSION_PREFIX + crypto.randomBytes(6).toString('hex');
  // Provision the shim BEFORE creating the tmux session so we can pass its env
  // vars via `new-session -e KEY=VALUE`. Without this the first pane misses
  // them — tmux's set-environment only reaches subsequent panes, so the user's
  // very first shell would bypass the browser router and the CLI would launch
  // a doomed system browser on the headless box.
  const shim = await prepareSessionShim(id);
  const envArgs = [];
  if (shim) {
    for (const [k, v] of Object.entries(shim.env)) envArgs.push('-e', `${k}=${v}`);
  }
  try {
    await tmux(['new-session', '-d', '-s', id, '-c', SESSION_CWD, ...envArgs]);
    knownSids.add(id);
    shimReady.add(id);
    if (shim) {
      // Also mirror the env onto the session for any future window/pane
      // created later (split, new-window). set-environment is idempotent.
      for (const [k, v] of Object.entries(shim.env)) {
        await tmux(['set-environment', '-t', id, k, v]).catch(() => {});
      }
      registerSessionToken(id, shim.token);
    }
    res.json({ id, created: Date.now(), attached: false, windows: 1, cwd: SESSION_CWD, cli: null });
  } catch (err) {
    // tmux failed — undo the shim files so we don't leak /tmp dirs.
    await teardownSessionShim(id).catch(() => {});
    res.status(500).json({ error: err.stderr || err.message });
  }
});

router.delete('/sessions/:id', async (req, res) => {
  if (!isValidSid(req.params.id)) {
    return res.status(400).json({ error: 'invalid session id' });
  }
  try {
    await tmux(['kill-session', '-t', req.params.id]);
    knownSids.delete(req.params.id);
    await teardownSessionShim(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    const stderr = err.stderr ?? '';
    if (stderr.includes("can't find session") || stderr.includes('no server running')) {
      knownSids.delete(req.params.id);
      await teardownSessionShim(req.params.id);
      return res.json({ ok: true, alreadyGone: true });
    }
    res.status(500).json({ error: stderr || err.message });
  }
});

export default router;
