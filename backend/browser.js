import { Router } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { spawn } from 'node:child_process';
import { connect as netConnect } from 'node:net';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { consumeTicket } from './tickets.js';
import { broadcastToWatchClients } from './watch.js';
import { PANEL_UPLOADS_ROOT } from './config.js';

// Uploads root used by files.js — re-declared here (not imported) to keep
// the modules independent. If this ever drifts from files.js the screenshot
// route 500s loud at write time, which we'd notice immediately.
const UPLOADS_ROOT = PANEL_UPLOADS_ROOT;
const SCREENSHOTS_BUCKET = 'voidbunny-screenshots';

// Defaults — overridable via env. Each slot gets its own display + ports so
// instances never collide. Bumping MAX is cheap; each instance is ~250 MB.
const MAX_INSTANCES = Number(process.env.PANEL_BROWSER_MAX_INSTANCES) || 3;
const BASE_DISPLAY = 100;
const BASE_VNC_PORT = 5900;
const BASE_CDP_PORT = 9222;
const SCREEN_GEOMETRY = process.env.PANEL_BROWSER_GEOMETRY || '1280x800x24';
const MOBILE_GEOMETRY = process.env.PANEL_BROWSER_MOBILE_GEOMETRY || '412x915x24';
// Bounds for client-supplied geometries. Below these and the Brave UI breaks;
// above and we waste a lot of RAM/CPU on a framebuffer no one can see. Cap is
// generous so retina laptops (DPR=2) at native panel size — e.g. an MBA M4
// 15" content area around 1200×800 CSS → 2400×1600 physical — fit without
// being clipped.
const MIN_DIM = 280;
const MAX_DIM = 3840;
// Mobile UA — current Pixel-class device so sites serve their mobile layout.
const MOBILE_UA = process.env.PANEL_BROWSER_MOBILE_UA
  || 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const BROWSER_BIN = process.env.PANEL_BROWSER_BIN || '/usr/bin/brave-browser';
const USER_DATA_ROOT = '/tmp/panel-browser';
// Frame-pacing for x11vnc. Defaults pick a smooth ~60-100 fps ceiling, which
// is comfortably reachable on the Hetzner box; bandwidth isn't the bottleneck.
// Bump these via env if the host is CPU-constrained or on a slow uplink.
const VNC_DEFER_MS = Number(process.env.PANEL_BROWSER_VNC_DEFER) || 10;
const VNC_WAIT_MS  = Number(process.env.PANEL_BROWSER_VNC_WAIT)  || 10;

const ID_RE = /^browser-[a-f0-9]{12}$/;

function isValidBrowserId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

/** @type {Map<string, BrowserInstance>} */
const instances = new Map();
/** @type {Set<number>} */
const usedSlots = new Set();

function allocateSlot() {
  for (let i = 0; i < MAX_INSTANCES; i++) {
    if (!usedSlots.has(i)) {
      usedSlots.add(i);
      return i;
    }
  }
  return null;
}

function releaseSlot(slot) {
  usedSlots.delete(slot);
}

// Resolves once Xvfb's socket file appears, or rejects on timeout. Avoids the
// race where Brave tries to connect before Xvfb has bound the display.
async function waitForX11Socket(displayNum, timeoutMs = 5000) {
  const socketPath = `/tmp/.X11-unix/X${displayNum}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(socketPath)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Xvfb :${displayNum} did not start within ${timeoutMs}ms`);
}

// Resolves once x11vnc accepts TCP, or rejects on timeout. We connect, write
// nothing, and immediately close — just probing reachability.
async function waitForTcp(port, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise((resolve) => {
      const s = netConnect({ host: '127.0.0.1', port });
      s.once('connect', () => { s.end(); resolve(true); });
      s.once('error', () => { resolve(false); });
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 75));
  }
  throw new Error(`x11vnc on :${port} did not accept within ${timeoutMs}ms`);
}

function killSafe(child, signal) {
  if (!child) return;
  try { child.kill(signal); } catch { /* already dead */ }
}

// Clamp/round a client-supplied dimension. Returns null for non-positive
// numbers so the caller can fall back to defaults.
function sanitizeDim(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(MIN_DIM, Math.min(MAX_DIM, Math.round(n)));
}

// http(s) only, 2048-char cap. Returns the canonical href string or null. We
// never trust the caller's exact byte sequence — `URL` rebuilds it, dropping
// fragments-with-newlines and similar shenanigans.
function sanitizeUrl(v) {
  if (typeof v !== 'string' || v.length === 0 || v.length > 2048) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  } catch {
    return null;
  }
}

// Clamp the device-scale-factor we send to Brave. The mobile mode needs to
// go higher than retina-2 because we render the full container framebuffer
// while keeping the CSS viewport at ~412 px (phone width) — that ratio can
// reach ~5 on a 15" retina panel. Above 5 the renderer starts to choke.
function sanitizeDsf(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(1, Math.min(5, Math.round(n * 100) / 100));
}

async function createInstance(mode = 'desktop', viewport = null, opts = {}) {
  if (instances.size >= MAX_INSTANCES) {
    const err = new Error(`max ${MAX_INSTANCES} concurrent browser instances`);
    err.status = 429;
    throw err;
  }
  const slot = allocateSlot();
  if (slot == null) {
    const err = new Error('no free browser slot');
    err.status = 429;
    throw err;
  }

  const id = 'browser-' + crypto.randomBytes(6).toString('hex');
  const displayNum = BASE_DISPLAY + slot;
  const vncPort = BASE_VNC_PORT + slot;
  const cdpPort = BASE_CDP_PORT + slot;
  const userDataDir = `${USER_DATA_ROOT}-${id}`;
  // If the client gave us viewport dimensions, render the Xvfb framebuffer at
  // exactly that size so noVNC has nothing to scale on the receiving end. The
  // result is pixel-crisp on whatever device opened the tab. Falls back to the
  // mode-default geometry when no dims are passed (e.g. older clients).
  const w = viewport ? sanitizeDim(viewport.width) : null;
  const h = viewport ? sanitizeDim(viewport.height) : null;
  const geometry = w && h
    ? `${w}x${h}x24`
    : (mode === 'mobile' ? MOBILE_GEOMETRY : SCREEN_GEOMETRY);

  await fs.mkdir(userDataDir, { recursive: true });

  const xvfb = spawn(
    'Xvfb',
    [`:${displayNum}`, '-screen', '0', geometry, '-nolisten', 'tcp'],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  xvfb.on('error', (e) => console.error(`[browser ${id}] xvfb spawn error:`, e.message));

  try {
    await waitForX11Socket(displayNum);
  } catch (err) {
    killSafe(xvfb, 'SIGKILL');
    releaseSlot(slot);
    throw err;
  }

  const theme = opts.theme === 'light' ? 'light' : 'dark';
  const startUrl = sanitizeUrl(opts.url) || 'about:blank';
  // For mobile, default DSF to 2 if the client didn't send one — without it
  // the renderer treats framebuffer pixels as CSS pixels, so the CSS viewport
  // ends up at e.g. 824 px wide and pages render as a narrow desktop instead
  // of a phone. With DSF=2 the CSS viewport is half the framebuffer (e.g.
  // 412 px), matching what real phones report and triggering mobile layouts.
  const requestedDsf = sanitizeDsf(opts.deviceScaleFactor);
  const dsf = requestedDsf ?? (mode === 'mobile' ? 2 : null);

  // Window-size matches the framebuffer exactly. Without a window manager
  // inside Xvfb, --start-maximized is unreliable — Brave can land at its
  // default 1024×768 and clip on portrait framebuffers — so we set the size
  // explicitly. --window-position keeps it pinned to the origin so we don't
  // get a centered window with empty borders.
  const fbW = w || (mode === 'mobile' ? 412 : 1280);
  const fbH = h || (mode === 'mobile' ? 915 : 800);

  const braveArgs = [
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate',
    `--remote-debugging-port=${cdpPort}`,
    '--remote-debugging-address=127.0.0.1',
    `--window-size=${fbW},${fbH}`,
    '--window-position=0,0',
  ];
  if (dsf != null) braveArgs.push(`--force-device-scale-factor=${dsf}`);
  // Force the renderer to honor the chosen color scheme. `--force-dark-mode`
  // flips `prefers-color-scheme: dark` for web content; `WebContentsForceDark`
  // applies Chromium's auto-dark to pages that don't ship a dark CSS path.
  if (theme === 'dark') {
    braveArgs.push('--force-dark-mode', '--enable-features=WebContentsForceDark');
  }
  if (mode === 'mobile') {
    braveArgs.push(
      `--user-agent=${MOBILE_UA}`,
      '--touch-events=enabled',
      // Phones don't show scrollbars; mobile sites tend to handle their own
      // overscroll/scroll affordances and a desktop scrollbar looks out of
      // place in a phone-shaped viewport.
      '--hide-scrollbars',
    );
  }
  braveArgs.push(startUrl);

  // GTK_THEME nudges Brave's own chrome (tab strip / menu / address bar). On
  // headless Xvfb there's no desktop session telling Brave which GTK theme to
  // pick, so without this it defaults to the light Adwaita variant regardless.
  const braveEnv = { ...process.env, DISPLAY: `:${displayNum}` };
  if (theme === 'dark') braveEnv.GTK_THEME = 'Adwaita:dark';
  else delete braveEnv.GTK_THEME;

  const brave = spawn(
    BROWSER_BIN,
    braveArgs,
    {
      env: braveEnv,
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
  brave.on('error', (e) => console.error(`[browser ${id}] brave spawn error:`, e.message));

  const x11vnc = spawn(
    'x11vnc',
    [
      '-display', `:${displayNum}`,
      '-localhost',
      '-nopw',
      '-forever',
      '-shared',
      '-rfbport', String(vncPort),
      '-quiet',
      '-noxdamage',           // smoother updates on some drivers
      '-defer', String(VNC_DEFER_MS),  // ms to coalesce updates — lower = more fps
      '-wait',  String(VNC_WAIT_MS),   // ms between poll cycles
      '-nonap',               // don't slow polling after idle periods
      '-threads',              // parallel framebuffer encoding
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  x11vnc.on('error', (e) => console.error(`[browser ${id}] x11vnc spawn error:`, e.message));

  try {
    await waitForTcp(vncPort);
  } catch (err) {
    killSafe(x11vnc, 'SIGKILL');
    killSafe(brave, 'SIGKILL');
    killSafe(xvfb, 'SIGKILL');
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    releaseSlot(slot);
    throw err;
  }

  /** @typedef {{id:string,slot:number,mode:string,theme:string,displayNum:number,vncPort:number,cdpPort:number,userDataDir:string,xvfb:any,brave:any,x11vnc:any,createdAt:number}} BrowserInstance */
  const instance = { id, slot, mode, theme, displayNum, vncPort, cdpPort, userDataDir, xvfb, brave, x11vnc, createdAt: Date.now() };
  instances.set(id, instance);

  // If any child dies unexpectedly, tear the rest down so we don't leak slots.
  const onChildExit = (which) => () => {
    if (!instances.has(id)) return;
    console.warn(`[browser ${id}] ${which} exited; tearing down`);
    destroyInstance(id).catch(() => {});
  };
  xvfb.on('exit', onChildExit('xvfb'));
  brave.on('exit', onChildExit('brave'));
  x11vnc.on('exit', onChildExit('x11vnc'));

  return instance;
}

async function destroyInstance(id) {
  const inst = instances.get(id);
  if (!inst) return false;
  instances.delete(id);
  releaseSlot(inst.slot);

  // Reverse order: client (brave) first so the X server doesn't keep
  // restarting it on some configs; then x11vnc; then Xvfb.
  killSafe(inst.brave, 'SIGTERM');
  killSafe(inst.x11vnc, 'SIGTERM');
  // Give them ~500 ms to exit cleanly before SIGKILL.
  await new Promise((r) => setTimeout(r, 500));
  killSafe(inst.brave, 'SIGKILL');
  killSafe(inst.x11vnc, 'SIGKILL');
  killSafe(inst.xvfb, 'SIGTERM');
  await new Promise((r) => setTimeout(r, 200));
  killSafe(inst.xvfb, 'SIGKILL');

  await fs.rm(inst.userDataDir, { recursive: true, force: true }).catch(() => {});
  return true;
}

function publicView(inst) {
  return {
    id: inst.id,
    createdAt: inst.createdAt,
    mode: inst.mode,
    theme: inst.theme,
    cdpPort: inst.cdpPort,
    cdpUrl: `http://127.0.0.1:${inst.cdpPort}`,
  };
}

// Used by /api/panel-open: route a CLI's browser-open attempt to the most
// recent in-app Brave (or spin up a desktop instance if none exist). Returns
// {id, created} so the caller can broadcast a focus event with the right id.
export async function openUrlInPanelBrowser(rawUrl) {
  const url = sanitizeUrl(rawUrl);
  if (!url) {
    const err = new Error('invalid url');
    err.status = 400;
    throw err;
  }
  const existing = Array.from(instances.values()).sort((a, b) => b.createdAt - a.createdAt)[0];
  if (existing) {
    await openUrlInInstance(existing, url);
    return { id: existing.id, mode: existing.mode, created: false };
  }
  // No instance yet — create one with the URL as its first tab. Saves a CDP
  // round-trip and means the user sees the page the moment Brave finishes
  // booting, not blank → URL.
  const fresh = await createInstance('desktop', null, { url });
  return { id: fresh.id, mode: fresh.mode, created: true };
}

// Tell a running instance to open `url` in a NEW tab. Uses the standard
// Chromium DevTools REST endpoint, which is simpler than speaking the full
// devtools-protocol WebSocket: a single PUT and we're done.
async function openUrlInInstance(inst, url) {
  const target = `http://127.0.0.1:${inst.cdpPort}/json/new?${encodeURIComponent(url)}`;
  const res = await fetch(target, { method: 'PUT' });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`CDP /json/new returned ${res.status}: ${body.slice(0, 200)}`);
  }
}

// ---- CDP helpers (used by /resize) ---------------------------------------

let _cdpReqId = 0;
// Open the browser-level CDP WebSocket, send one method, wait for the matching
// response, close the socket. Resize is infrequent so per-call connection is
// fine and keeps state simple.
function cdpCall(wsUrl, method, params = {}, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const id = ++_cdpReqId;
    const ws = new WebSocket(wsUrl);
    const cleanup = () => {
      try { ws.close(); } catch { /* ignore */ }
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`CDP ${method} timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    ws.once('open', () => {
      try { ws.send(JSON.stringify({ id, method, params })); }
      catch (e) { clearTimeout(timer); cleanup(); reject(e); }
    });
    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg.id !== id) return;
      clearTimeout(timer);
      cleanup();
      if (msg.error) reject(new Error(`CDP ${method} error: ${msg.error.message}`));
      else resolve(msg.result);
    });
    ws.once('error', (err) => {
      clearTimeout(timer);
      cleanup();
      reject(err);
    });
  });
}

async function getBrowserWsUrl(cdpPort) {
  const res = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
  if (!res.ok) throw new Error(`CDP /json/version returned ${res.status}`);
  const data = await res.json();
  if (!data.webSocketDebuggerUrl) throw new Error('CDP /json/version missing webSocketDebuggerUrl');
  return data.webSocketDebuggerUrl;
}

// Resize the Xvfb root window (framebuffer) via xrandr. Xvfb advertises the
// RANDR extension by default, so this works without a window manager and
// without pre-declaring screen modes — `--fb WxH` takes any size.
function resizeXvfb(displayNum, w, h) {
  return new Promise((resolve, reject) => {
    const p = spawn('xrandr', ['--fb', `${w}x${h}`], {
      env: { ...process.env, DISPLAY: `:${displayNum}` },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    p.stderr.on('data', (d) => { stderr += d.toString(); });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`xrandr exited ${code}: ${stderr.slice(0, 200).trim()}`));
    });
  });
}

// Resize Brave's window to match the new framebuffer. CDP's Browser domain
// works without a window manager (X server handles the ConfigureRequest
// directly). We grab any active page target just to get a handle on the
// containing window.
async function resizeBraveWindow(inst, w, h) {
  const wsUrl = await getBrowserWsUrl(inst.cdpPort);
  const listRes = await fetch(`http://127.0.0.1:${inst.cdpPort}/json/list`);
  const targets = listRes.ok ? await listRes.json() : [];
  const page = Array.isArray(targets) ? targets.find((t) => t.type === 'page') : null;
  if (!page?.id) throw new Error('no CDP page target available');
  const { windowId } = await cdpCall(wsUrl, 'Browser.getWindowForTarget', { targetId: page.id });
  await cdpCall(wsUrl, 'Browser.setWindowBounds', {
    windowId,
    bounds: { left: 0, top: 0, width: w, height: h, windowState: 'normal' },
  });
}

async function resizeInstance(inst, w, h) {
  // Order matters when shrinking: resize the window FIRST (so it doesn't
  // briefly exceed the framebuffer), then the framebuffer. When growing,
  // do the opposite. Pick by whichever new dim is smaller than current —
  // approximation, but harmless either way. xrandr + setWindowBounds are
  // both idempotent so a re-run with the same numbers is a no-op.
  const growing = w * h > 1; // we don't track current geometry; just go fb-first
  if (growing) {
    await resizeXvfb(inst.displayNum, w, h);
    await resizeBraveWindow(inst, w, h);
  } else {
    await resizeBraveWindow(inst, w, h);
    await resizeXvfb(inst.displayNum, w, h);
  }
}

// ---- HTTP router ---------------------------------------------------------

const router = Router();

// Fetch the active tab's title from a running Brave via CDP's REST endpoint.
// /json/list returns every target (pages + service workers + iframes); we
// pick the first 'page' type as a proxy for "the tab the user sees". CDP
// doesn't expose a stable "focused tab" flag without a websocket session,
// and the cost of that per poll is not worth it for a label.
const titleCache = new Map(); // id -> { title, fetchedAt }
const TITLE_CACHE_MS = 2500;

// Track which loopback-callback URLs we've already announced per instance.
// Without this an OAuth provider's success page (still on localhost:PORT) gets
// re-polled every 2.5s and the user would see a toast on every refresh.
// Bounded to ~16 entries per instance — the typical OAuth flow visits one
// loopback URL, with extras only when the user retries.
/** @type {Map<string, Set<string>>} */
const callbackSeen = new Map();
// Heuristic for "this looks like an OAuth callback landing": loopback host
// with a query/hash AND at least one of the well-known param names. Matches
// authorization-code, implicit, and PKCE flows; trims false positives from
// the user just browsing http://localhost:3000 during dev.
const CALLBACK_PARAM_RE = /[?#&](code|token|access_token|id_token|state)=/i;
function isLikelyOAuthCallback(rawUrl) {
  if (typeof rawUrl !== 'string') return false;
  let u;
  try { u = new URL(rawUrl); } catch { return false; }
  if (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1') return false;
  return CALLBACK_PARAM_RE.test(u.search + u.hash);
}

async function fetchInstanceTitle(inst) {
  const cached = titleCache.get(inst.id);
  if (cached && Date.now() - cached.fetchedAt < TITLE_CACHE_MS) {
    return cached.title;
  }
  let title = '';
  try {
    const res = await fetch(`http://127.0.0.1:${inst.cdpPort}/json/list`, {
      signal: AbortSignal.timeout(750),
    });
    if (res.ok) {
      const arr = await res.json();
      const pages = Array.isArray(arr) ? arr.filter((t) => t?.type === 'page') : [];
      const titled = pages.find((t) => t?.title);
      if (titled) title = String(titled.title).slice(0, 120);

      // Sweep every page target for OAuth callback hits. We look at all of
      // them, not just the titled one, because the OAuth provider often opens
      // the callback in a popup or new tab — the user's "main" tab still says
      // "Sign in" while the redirect lands quietly elsewhere. Without this the
      // user has no visual cue that the handshake actually completed.
      let seen = callbackSeen.get(inst.id);
      for (const p of pages) {
        const u = typeof p?.url === 'string' ? p.url : '';
        if (!isLikelyOAuthCallback(u)) continue;
        // Dedup on origin+path — query strings can vary on retry but the
        // listener is on a fixed port/path, so a repeat call there is the
        // same callback.
        let key;
        try {
          const parsed = new URL(u);
          key = `${parsed.origin}${parsed.pathname}`;
        } catch { continue; }
        if (!seen) { seen = new Set(); callbackSeen.set(inst.id, seen); }
        if (seen.has(key)) continue;
        if (seen.size >= 16) seen.clear(); // simple cap; OAuth is one-shot
        seen.add(key);
        broadcastToWatchClients({
          type: 'panel-callback',
          browserId: inst.id,
          host: new URL(u).host,
          url: u.slice(0, 256),
        });
        console.log(`[browser ${inst.id}] OAuth callback observed: ${key}`);
      }
    }
  } catch {
    // CDP unavailable (Brave still booting / crashed) — silent retry next poll.
  }
  titleCache.set(inst.id, { title, fetchedAt: Date.now() });
  return title;
}

router.get('/browser', async (_req, res) => {
  const ordered = Array.from(instances.values()).sort((a, b) => a.createdAt - b.createdAt);
  const titles = await Promise.all(ordered.map(fetchInstanceTitle));
  const list = ordered.map((inst, i) => ({ ...publicView(inst), title: titles[i] }));
  res.json(list);
});

router.post('/browser', async (req, res) => {
  try {
    const mode = req.body?.mode === 'mobile' ? 'mobile' : 'desktop';
    const viewport = (req.body && (req.body.width || req.body.height))
      ? { width: req.body.width, height: req.body.height }
      : null;
    const theme = req.body?.theme === 'light' ? 'light' : 'dark';
    // Validate the optional starting URL here too so a bad value 400s loudly
    // instead of silently falling back to about:blank.
    let url = null;
    if (req.body && req.body.url != null && req.body.url !== '') {
      url = sanitizeUrl(req.body.url);
      if (!url) return res.status(400).json({ error: 'invalid url' });
    }
    const inst = await createInstance(mode, viewport, { theme, url });
    res.json(publicView(inst));
  } catch (err) {
    res.status(err.status ?? 500).json({ error: err.message });
  }
});

router.post('/browser/:id/resize', async (req, res) => {
  if (!isValidBrowserId(req.params.id)) {
    return res.status(400).json({ error: 'invalid browser id' });
  }
  const inst = instances.get(req.params.id);
  if (!inst) return res.status(404).json({ error: 'not found' });
  const w = sanitizeDim(req.body?.width);
  const h = sanitizeDim(req.body?.height);
  if (!w || !h) return res.status(400).json({ error: 'invalid dimensions' });
  try {
    await resizeInstance(inst, w, h);
    res.json({ ok: true, width: w, height: h });
  } catch (err) {
    console.warn(`[browser ${inst.id}] resize failed:`, err.message);
    res.status(502).json({ error: err.message });
  }
});

router.post('/browser/:id/open', async (req, res) => {
  if (!isValidBrowserId(req.params.id)) {
    return res.status(400).json({ error: 'invalid browser id' });
  }
  const inst = instances.get(req.params.id);
  if (!inst) return res.status(404).json({ error: 'not found' });
  const url = sanitizeUrl(req.body?.url);
  if (!url) return res.status(400).json({ error: 'invalid url' });
  try {
    await openUrlInInstance(inst, url);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Capture a high-quality PNG of the current page via CDP's
// Page.captureScreenshot. Crisper than grabbing the noVNC canvas because it
// bypasses the framebuffer scaling — the screenshot is whatever pixel dims
// Chromium's renderer holds, not the VNC viewport.
//
// Output lands under UPLOADS_ROOT/voidbunny-screenshots/ so the user can
// reference the file from any panel terminal (cd / cat / pass to an agent
// CLI). Filename is `<YYYY-MM-DDTHHMMSS>-<slug>.png`, where slug is derived
// from the page title (or "untitled" if there is none).
async function captureScreenshot(inst) {
  const wsUrl = await getBrowserWsUrl(inst.cdpPort);
  const listRes = await fetch(`http://127.0.0.1:${inst.cdpPort}/json/list`);
  if (!listRes.ok) throw new Error(`CDP /json/list returned ${listRes.status}`);
  const targets = await listRes.json();
  const page = Array.isArray(targets) ? targets.find((t) => t?.type === 'page') : null;
  if (!page?.webSocketDebuggerUrl) throw new Error('no CDP page target available');

  // Use the per-target debugger URL so captureScreenshot runs against the
  // visible tab, not the browser-level WS (which doesn't own Page domain).
  const result = await cdpCall(page.webSocketDebuggerUrl, 'Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  }, 10_000);
  if (!result?.data) throw new Error('CDP returned empty screenshot');

  const buf = Buffer.from(result.data, 'base64');
  const dir = path.join(UPLOADS_ROOT, SCREENSHOTS_BUCKET);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });

  // ISO timestamp with the colons/dots stripped — safe for any filesystem.
  const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const title = typeof page.title === 'string' ? page.title : '';
  const slug = (title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'untitled').slice(0, 40);
  const name = `${ts}-${slug}.png`;
  const target = path.join(dir, name);
  await fs.writeFile(target, buf, { mode: 0o600 });
  return { path: target, bytes: buf.length, title };
}

router.post('/browser/:id/screenshot', async (req, res) => {
  if (!isValidBrowserId(req.params.id)) {
    return res.status(400).json({ error: 'invalid browser id' });
  }
  const inst = instances.get(req.params.id);
  if (!inst) return res.status(404).json({ error: 'not found' });
  try {
    const r = await captureScreenshot(inst);
    res.json({ ok: true, ...r });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.delete('/browser/:id', async (req, res) => {
  if (!isValidBrowserId(req.params.id)) {
    return res.status(400).json({ error: 'invalid browser id' });
  }
  const existed = await destroyInstance(req.params.id);
  titleCache.delete(req.params.id);
  callbackSeen.delete(req.params.id);
  res.json({ ok: true, alreadyGone: !existed });
});

export default router;

// ---- WebSocket bridge ----------------------------------------------------

function rejectUpgrade(socket, code, reason) {
  socket.write(`HTTP/1.1 ${code} ${reason}\r\n\r\n`);
  socket.destroy();
}

export function attachBrowser(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/browser') return; // not ours — let other handlers try

    const ticket = url.searchParams.get('ticket');
    if (!consumeTicket(ticket)) return rejectUpgrade(socket, 401, 'Unauthorized');

    const id = url.searchParams.get('id');
    if (!isValidBrowserId(id)) return rejectUpgrade(socket, 400, 'Bad Request');
    const inst = instances.get(id);
    if (!inst) return rejectUpgrade(socket, 404, 'Not Found');

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, { vncPort: inst.vncPort });
    });
  });

  wss.on('connection', (ws, _req, { vncPort }) => {
    // Pipe WS binary frames <-> raw VNC TCP. Backpressure is event-driven:
    // pause the TCP socket when the WS buffer crosses the high-water mark,
    // resume from inside the ws.send completion callback once it drops back
    // below the low-water mark. No setInterval — the previous 100 ms drain
    // poll added measurable event-loop jitter to other WS upgrades on the
    // same server (notably new terminals).
    const HIGH_WATER = 1024 * 1024;
    const LOW_WATER = 256 * 1024;
    const tcp = netConnect({ host: '127.0.0.1', port: vncPort });

    tcp.on('connect', () => { /* nothing — ready to relay */ });

    tcp.on('data', (chunk) => {
      if (ws.readyState !== ws.OPEN) return;
      ws.send(chunk, { binary: true }, (err) => {
        if (err) {
          try { tcp.destroy(); } catch { /* ignore */ }
          try { ws.close(); } catch { /* ignore */ }
          return;
        }
        if (tcp.isPaused() && ws.bufferedAmount < LOW_WATER) tcp.resume();
      });
      if (ws.bufferedAmount > HIGH_WATER) tcp.pause();
    });

    ws.on('message', (data) => {
      if (tcp.destroyed) return;
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      tcp.write(buf);
    });

    const cleanup = () => {
      try { tcp.destroy(); } catch { /* ignore */ }
      try { ws.close(); } catch { /* ignore */ }
    };

    tcp.on('close', cleanup);
    tcp.on('error', (err) => { console.error('[browser bridge] tcp error:', err.message); cleanup(); });
    ws.on('close', cleanup);
    ws.on('error', () => cleanup());
  });
}

// ---- Process-exit cleanup ------------------------------------------------

let shutdownStarted = false;
async function shutdownAll() {
  if (shutdownStarted) return;
  shutdownStarted = true;
  const ids = Array.from(instances.keys());
  await Promise.all(ids.map((id) => destroyInstance(id)));
}
process.on('SIGINT', () => { shutdownAll().finally(() => process.exit(0)); });
process.on('SIGTERM', () => { shutdownAll().finally(() => process.exit(0)); });

// Boot sweep: stale user-data-dirs from a previous run (e.g. SIGKILL or OOM)
// would never be reaped otherwise. Under systemd PrivateTmp this is usually
// a no-op, but it makes manual `node index.js` use safe too.
(async () => {
  try {
    const tmp = await fs.readdir('/tmp', { withFileTypes: true });
    const stale = tmp.filter((e) => e.isDirectory() && e.name.startsWith('panel-browser-'));
    await Promise.all(stale.map((e) =>
      fs.rm(`/tmp/${e.name}`, { recursive: true, force: true }).catch(() => {})
    ));
    if (stale.length > 0) console.log(`[browser] swept ${stale.length} stale tmp dir(s)`);
  } catch { /* /tmp not readable — skip */ }
})();
