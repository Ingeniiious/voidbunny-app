import { WebSocketServer } from 'ws';
import fs from 'node:fs';
import path from 'node:path';
import { consumeTicket } from './tickets.js';
import { PANEL_HOME } from './config.js';

// Real-time file tree updates. Each opened directory in the frontend's file
// tree subscribes here over a single WebSocket; we register a non-recursive
// fs.watch() per unique path (ref-counted across subscribers) and push
// coalesced change events back. Hot directories (lots of writes from agent
// CLIs, build artifacts, etc.) auto-throttle so they don't drown the UI.

const ROOT = PANEL_HOME;
const DEBOUNCE_MS = 250;
const HOT_WINDOW_MS = 2000;
const HOT_THRESHOLD = 15;        // events within HOT_WINDOW_MS to trigger throttle
const HOT_THROTTLE_MS = 30_000;  // emit at most once per this many ms while hot
const MAX_SUBS_PER_CLIENT = 200;

// path -> { watcher, subs:Set<ws>, timer, events:number[], throttledUntil:number, lastEmit:number }
const watchers = new Map();

// Lifted to module scope so other backends (e.g., panel-open) can broadcast
// non-path events to every connected /files-watch client. Initialised the
// moment attachWatch() runs.
let wss = null;

// Broadcast an arbitrary JSON message to every connected client. Used for
// out-of-band signals like {type:'panel-open', url, browserId} — the frontend
// fileWatch singleton routes these through its global-listener channel rather
// than the path-keyed one used by file change events.
export function broadcastToWatchClients(msg) {
  if (!wss) return;
  const data = JSON.stringify(msg);
  for (const ws of wss.clients) {
    if (ws.readyState === 1) {
      try { ws.send(data); } catch { /* dropped client */ }
    }
  }
}

function resolveSafe(input) {
  if (typeof input !== 'string' || !input) return null;
  const resolved = path.resolve(input);
  if (resolved !== ROOT && !resolved.startsWith(ROOT + path.sep)) return null;
  return resolved;
}

function rejectUpgrade(socket, code, reason) {
  socket.write(`HTTP/1.1 ${code} ${reason}\r\n\r\n`);
  socket.destroy();
}

function send(ws, payload) {
  if (ws.readyState !== ws.OPEN) return;
  try { ws.send(JSON.stringify(payload)); } catch { /* dropped client */ }
}

function emitChange(entry, dirPath) {
  const now = Date.now();
  entry.lastEmit = now;
  for (const ws of entry.subs) send(ws, { type: 'change', path: dirPath });
}

function scheduleEmit(entry, dirPath) {
  const now = Date.now();

  // Slide the event window forward and record this hit.
  entry.events.push(now);
  while (entry.events.length && entry.events[0] < now - HOT_WINDOW_MS) {
    entry.events.shift();
  }

  if (now < entry.throttledUntil) {
    // Already in cooldown — fire once per HOT_THROTTLE_MS, drop the rest.
    if (now - entry.lastEmit >= HOT_THROTTLE_MS) emitChange(entry, dirPath);
    return;
  }

  if (entry.events.length >= HOT_THRESHOLD) {
    // Tip into "hot" mode. Tell the client so it can stop expecting real-time
    // refreshes for this path until it settles down again.
    entry.throttledUntil = now + HOT_THROTTLE_MS;
    for (const ws of entry.subs) {
      send(ws, { type: 'paused', path: dirPath, untilMs: entry.throttledUntil });
    }
    emitChange(entry, dirPath);
    return;
  }

  if (entry.timer) return;
  entry.timer = setTimeout(() => {
    entry.timer = null;
    emitChange(entry, dirPath);
  }, DEBOUNCE_MS);
}

function ensureWatcher(dirPath) {
  let entry = watchers.get(dirPath);
  if (entry) return entry;

  let watcher;
  try {
    watcher = fs.watch(dirPath, { persistent: false });
  } catch (err) {
    return { error: err.code ?? 'watch failed' };
  }

  entry = {
    watcher,
    subs: new Set(),
    timer: null,
    events: [],
    throttledUntil: 0,
    lastEmit: 0,
  };
  watchers.set(dirPath, entry);

  watcher.on('change', () => scheduleEmit(entry, dirPath));
  watcher.on('error', (err) => {
    for (const ws of entry.subs) {
      send(ws, { type: 'error', path: dirPath, message: err.code ?? 'watch error' });
    }
    cleanupWatcher(dirPath);
  });

  return entry;
}

function cleanupWatcher(dirPath) {
  const entry = watchers.get(dirPath);
  if (!entry) return;
  if (entry.timer) clearTimeout(entry.timer);
  try { entry.watcher.close(); } catch { /* already closed */ }
  watchers.delete(dirPath);
}

function unsubscribe(ws, dirPath) {
  const entry = watchers.get(dirPath);
  if (!entry) return;
  entry.subs.delete(ws);
  if (entry.subs.size === 0) cleanupWatcher(dirPath);
}

export function attachWatch(server) {
  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/files-watch') return;

    const ticket = url.searchParams.get('ticket');
    if (!consumeTicket(ticket)) return rejectUpgrade(socket, 401, 'Unauthorized');

    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
  });

  wss.on('connection', (ws) => {
    const clientSubs = new Set();

    ws.on('message', (data) => {
      let msg;
      try { msg = JSON.parse(data.toString('utf8')); } catch { return; }
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'sub') {
        const dir = resolveSafe(msg.path);
        if (!dir) return send(ws, { type: 'error', path: msg.path, message: 'invalid path' });
        if (clientSubs.has(dir)) return;
        if (clientSubs.size >= MAX_SUBS_PER_CLIENT) {
          return send(ws, { type: 'error', path: dir, message: 'too many subscriptions' });
        }
        const entry = ensureWatcher(dir);
        if (entry.error) return send(ws, { type: 'error', path: dir, message: entry.error });
        entry.subs.add(ws);
        clientSubs.add(dir);
      } else if (msg.type === 'unsub') {
        const dir = resolveSafe(msg.path);
        if (!dir || !clientSubs.has(dir)) return;
        clientSubs.delete(dir);
        unsubscribe(ws, dir);
      }
    });

    ws.on('close', () => {
      for (const dir of clientSubs) unsubscribe(ws, dir);
      clientSubs.clear();
    });
  });
}
