// /api/panel-open — receives URL-open requests from the per-tmux-session
// `panel-open` shim (which CLIs invoke as $BROWSER, xdg-open, chrome, etc.).
// Routes the URL to the in-app Brave and notifies the frontend so it can
// focus the browser tab.
//
// Auth: per-session token written into the tmux session env at create time
// AND mirrored to /tmp/panel-shim/<sid>/token. Endpoint is mounted without
// requireAuth because the shim is a local process inside a tmux session we
// already trust — the token is what binds the request to a real session.
// We accept either the in-memory token (fast path) OR the on-disk token
// (recovery path for shells whose env was stale across a panel restart).

import { Router } from 'express';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { openUrlInPanelBrowser } from './browser.js';
import { broadcastToWatchClients } from './watch.js';

const SHIM_ROOT = '/tmp/panel-shim';
const SID_RE = /^panel-[a-f0-9]{12}$/;

// sid -> token, populated from sessions.js on POST /api/sessions and cleared
// on DELETE. Lives in memory only; tokens regenerate on every panel restart.
const tokens = new Map();

export function registerSessionToken(sid, token) {
  tokens.set(sid, token);
}

export function clearSessionToken(sid) {
  tokens.delete(sid);
}

// Constant-time string compare so a token-mismatch reply doesn't leak length
// or matching-prefix info via timing. The shim has full filesystem access to
// the token anyway, so this is belt-and-suspenders rather than core defence.
function constantTimeEq(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

async function readTokenFile(sid) {
  if (!SID_RE.test(sid)) return null;
  try {
    const raw = await fs.readFile(path.join(SHIM_ROOT, sid, 'token'), 'utf8');
    return raw.trim() || null;
  } catch {
    return null;
  }
}

const router = Router();

router.post('/panel-open', async (req, res) => {
  const sid = typeof req.body?.sid === 'string' ? req.body.sid : '';
  const token = typeof req.body?.token === 'string' ? req.body.token : '';
  const url = typeof req.body?.url === 'string' ? req.body.url : '';
  if (!sid || !token || !url) {
    return res.status(400).json({ error: 'bad request' });
  }
  if (!SID_RE.test(sid)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const expected = tokens.get(sid);
  let authorised = expected ? constantTimeEq(expected, token) : false;
  if (!authorised) {
    // Slow path: the in-memory token map missed (panel restarted after the
    // session was created and the GET /sessions re-prime hasn't run yet, or
    // the session was created via something other than POST /sessions). Fall
    // back to the on-disk token. If that also fails the request is rejected.
    const fileToken = await readTokenFile(sid);
    authorised = fileToken ? constantTimeEq(fileToken, token) : false;
    if (authorised) registerSessionToken(sid, fileToken);
  }
  if (!authorised) {
    console.warn(`[panel-open] auth rejected for sid=${sid}`);
    return res.status(403).json({ error: 'forbidden' });
  }
  try {
    const { id: browserId, mode } = await openUrlInPanelBrowser(url);
    broadcastToWatchClients({ type: 'panel-open', sid, browserId, mode, url });
    // Truncate the URL for the log so an OAuth state= blob doesn't fill
    // journald with one line per character.
    const short = url.length > 120 ? url.slice(0, 117) + '…' : url;
    console.log(`[panel-open] sid=${sid} → browser=${browserId} mode=${mode} url=${short}`);
    res.json({ ok: true, browserId });
  } catch (err) {
    console.warn(`[panel-open] open failed for sid=${sid}:`, err.message);
    res.status(err.status ?? 502).json({ error: err.message });
  }
});

export default router;
