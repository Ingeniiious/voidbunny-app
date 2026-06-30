import { getWsTicket } from './api';

// Singleton WebSocket client for /files-watch. Components subscribe by path
// and get a callback fired whenever the backend emits a (debounced/coalesced)
// change for that directory. Hot directories auto-throttle on the server side;
// the client passes the 'paused' hint through so the UI can render a quieter
// state if it wants.

export type FileWatchEvent =
  | { type: 'change'; path: string }
  | { type: 'paused'; path: string; untilMs: number }
  | { type: 'error'; path: string; message: string };

// Non-path events that ride the same WS.
//   - panel-open: a CLI inside a tmux session called $BROWSER / xdg-open on a
//     URL; the backend opened it in the in-app Brave and tells us which
//     instance so we can focus its tab.
//   - panel-callback: the in-app Brave navigated to an http://localhost:PORT/
//     URL that looks like an OAuth callback (carries code / token / state).
//     Lets the UI confirm to the user that the handshake actually came back
//     — without this they're staring at a "Sign in" page wondering whether
//     the CLI ever heard back, which is exactly the CodeRabbit-style failure
//     mode this whole shim chain exists to make legible.
export type PanelEvent =
  | { type: 'panel-open'; sid: string; browserId: string; mode: 'desktop' | 'mobile'; url: string }
  | { type: 'panel-callback'; browserId: string; host: string; url: string };

type Listener = (e: FileWatchEvent) => void;
type PanelListener = (e: PanelEvent) => void;

class FileWatchClient {
  private ws: WebSocket | null = null;
  private connecting: Promise<void> | null = null;
  private listeners = new Map<string, Set<Listener>>();
  // Listeners that receive every panel-level event (no path key). Kept
  // separate so reconnect logic can treat "global subscriber but no path
  // subscribers" as still-wanted.
  private panelListeners = new Set<PanelListener>();
  // Paths the *server* knows we want — sent again after a reconnect.
  private serverSubs = new Set<string>();
  private reconnectAttempt = 0;

  subscribe(path: string, cb: Listener): () => void {
    let set = this.listeners.get(path);
    if (!set) {
      set = new Set();
      this.listeners.set(path, set);
    }
    set.add(cb);
    void this.ensureSub(path);
    return () => {
      const cur = this.listeners.get(path);
      if (!cur) return;
      cur.delete(cb);
      if (cur.size === 0) {
        this.listeners.delete(path);
        this.sendUnsub(path);
      }
    };
  }

  subscribePanel(cb: PanelListener): () => void {
    this.panelListeners.add(cb);
    void this.ensureOpen().catch(() => { /* reconnect loop handles retry */ });
    return () => { this.panelListeners.delete(cb); };
  }

  private hasAnyWanted(): boolean {
    return this.listeners.size > 0 || this.panelListeners.size > 0;
  }

  private async ensureSub(path: string): Promise<void> {
    await this.ensureOpen();
    this.sendSub(path);
  }

  private sendSub(path: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'sub', path }));
    this.serverSubs.add(path);
  }

  private sendUnsub(path: string) {
    this.serverSubs.delete(path);
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'unsub', path }));
  }

  private ensureOpen(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      try {
        const ticket = await getWsTicket();
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = `${proto}//${window.location.host}/files-watch?ticket=${encodeURIComponent(ticket)}`;
        await new Promise<void>((resolve, reject) => {
          const ws = new WebSocket(url);
          this.ws = ws;
          ws.onopen = () => {
            this.reconnectAttempt = 0;
            // Re-sub any paths we still care about after a reconnect.
            for (const p of this.listeners.keys()) this.sendSub(p);
            resolve();
          };
          ws.onerror = () => reject(new Error('files-watch ws error'));
          ws.onclose = () => {
            this.ws = null;
            this.serverSubs.clear();
            this.scheduleReconnect();
          };
          ws.onmessage = (ev) => {
            // The server multiplexes path-keyed file events and global panel
            // events (no path) over the same WS. Discriminate on `path`'s
            // presence rather than on `type` so future panel-event variants
            // ride this channel without touching the dispatcher.
            let parsed: unknown = null;
            try { parsed = JSON.parse(typeof ev.data === 'string' ? ev.data : ''); } catch { /* ignore */ }
            if (!parsed || typeof parsed !== 'object') return;
            const msg = parsed as { path?: unknown };
            if (typeof msg.path === 'string') {
              const set = this.listeners.get(msg.path);
              if (set) {
                for (const cb of set) {
                  try { cb(parsed as FileWatchEvent); } catch { /* ignore listener errors */ }
                }
              }
              return;
            }
            // Non-path message — fan out to panel-event listeners.
            for (const cb of this.panelListeners) {
              try { cb(parsed as PanelEvent); } catch { /* ignore listener errors */ }
            }
          };
        });
      } finally {
        this.connecting = null;
      }
    })();

    return this.connecting;
  }

  private scheduleReconnect() {
    if (!this.hasAnyWanted()) return;
    const delay = Math.min(15_000, 500 * 2 ** this.reconnectAttempt++);
    setTimeout(() => {
      if (this.hasAnyWanted()) void this.ensureOpen().catch(() => { /* retry again on close */ });
    }, delay);
  }
}

let singleton: FileWatchClient | null = null;

const IS_MOCK = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get('mock') === '1';

export function watchDir(path: string, cb: Listener): () => void {
  if (IS_MOCK) return () => {};
  if (!singleton) singleton = new FileWatchClient();
  return singleton.subscribe(path, cb);
}

// Subscribe to non-path panel events (e.g., panel-open from CLI shims).
// Returns an unsubscribe function. In mock mode this is a no-op so the
// MockApp doesn't try to open a real WS.
export function subscribePanelEvents(cb: (event: PanelEvent) => void): () => void {
  if (IS_MOCK) return () => {};
  if (!singleton) singleton = new FileWatchClient();
  return singleton.subscribePanel(cb);
}
