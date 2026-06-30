const TOKEN_KEY = 'panel.token';

// `?mock=1` short-circuits the few read-only APIs the Sidebar pulls on mount
// (file tree, search, server stats). Without this, MockApp renders the real
// Sidebar but FileTree's `listFiles` returns the SPA's index.html (no backend
// in mock mode), the HTML payload throws and gets dumped into the tree as a
// red error line. Mock canned responses keep the sidebar visually clean.
export const IS_MOCK = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get('mock') === '1';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401) {
    clearToken();
    window.location.reload();
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface FileEntry {
  name: string;
  type: 'dir' | 'file';
  path: string;
  size: number;
  modified: string;
}

export interface FileContent {
  content: string;
  path: string;
}

export type CliKind = 'claude' | 'codex' | 'gemini' | 'cursor' | 'grok';

export interface ServerSession {
  id: string;
  created: number;
  attached: boolean;
  windows: number;
  cwd?: string | null;
  cli?: CliKind | null;
}

export function listSessions(): Promise<ServerSession[]> {
  return api<ServerSession[]>('/api/sessions');
}

export function createSession(): Promise<ServerSession> {
  return api<ServerSession>('/api/sessions', { method: 'POST', body: '{}' });
}

export function deleteSession(id: string): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export type BrowserMode = 'desktop' | 'mobile';
export type BrowserTheme = 'dark' | 'light';

export interface BrowserInstance {
  id: string;
  createdAt: number;
  mode?: BrowserMode;
  theme?: BrowserTheme;
  cdpPort: number;
  cdpUrl: string;
  // Active page title (best-effort — empty until Brave's first page loads).
  // Backend polls CDP and caches; sent by /api/browser list responses only.
  title?: string;
}

export function listBrowsers(): Promise<BrowserInstance[]> {
  return api<BrowserInstance[]>('/api/browser');
}

export interface CreateBrowserOpts {
  theme?: BrowserTheme;
  url?: string;
  deviceScaleFactor?: number;
}

export function createBrowser(
  mode: BrowserMode = 'desktop',
  viewport?: { width: number; height: number },
  opts: CreateBrowserOpts = {},
): Promise<BrowserInstance> {
  const body: Record<string, unknown> = { mode };
  if (viewport) Object.assign(body, viewport);
  if (opts.theme) body.theme = opts.theme;
  if (opts.url) body.url = opts.url;
  if (opts.deviceScaleFactor) body.deviceScaleFactor = opts.deviceScaleFactor;
  return api<BrowserInstance>('/api/browser', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function deleteBrowser(id: string): Promise<{ ok: boolean }> {
  return api<{ ok: boolean }>(`/api/browser/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function openBrowserUrl(id: string, url: string): Promise<{ ok: true }> {
  return api<{ ok: true }>(`/api/browser/${encodeURIComponent(id)}/open`, {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
}

export function resizeBrowser(
  id: string,
  width: number,
  height: number,
): Promise<{ ok: true; width: number; height: number }> {
  return api(`/api/browser/${encodeURIComponent(id)}/resize`, {
    method: 'POST',
    body: JSON.stringify({ width, height }),
  });
}

export interface ScreenshotResult {
  ok: true;
  path: string;
  bytes: number;
  title: string;
}
// Backend uses CDP to capture a full-quality PNG of the active page, then
// writes it under UPLOADS_ROOT/voidbunny-screenshots/. The returned `path`
// is the absolute on-server path the user can reference from any terminal.
export function screenshotBrowser(id: string): Promise<ScreenshotResult> {
  return api<ScreenshotResult>(`/api/browser/${encodeURIComponent(id)}/screenshot`, {
    method: 'POST',
    body: '{}',
  });
}

export interface PanelConfig {
  home: string;
  uploadsRoot: string;
}

export function fetchConfig(): Promise<PanelConfig> {
  if (IS_MOCK) return Promise.resolve({ home: '/home/void', uploadsRoot: '/home/void/voidbunny-uploads' });
  return api<PanelConfig>('/api/config');
}

export interface ServerStats {
  mem: { total: number; used: number; available: number };
  cpu: { count: number; load1: number; load5: number; load15: number };
  disk: { total: number; used: number } | null;
  uptime: number;
  ts: number;
  version?: string;
}

export function fetchStats(): Promise<ServerStats> {
  if (IS_MOCK) {
    return Promise.resolve({
      mem: { total: 16384, used: 6225, available: 10159 },
      cpu: { count: 8, load1: 1.4, load5: 1.2, load15: 1.0 },
      disk: { total: 400000, used: 162000 },
      uptime: 432000,
      ts: Date.now(),
      version: 'mock',
    });
  }
  return api<ServerStats>('/api/stats');
}

// Error thrown when /api/transcribe returns a non-OK status. Carries the
// backend's diagnostic echo (content-type sent, byte count, ext) so the
// caller can build a meaningful toast description without re-deriving it.
export class TranscribeError extends Error {
  status: number;
  openaiBody: string;
  diagnostics?: { rawContentType: string; baseContentType: string; ext: string; bytes: number };
  constructor(status: number, openaiBody: string, diagnostics?: TranscribeError['diagnostics']) {
    super(openaiBody || `HTTP ${status}`);
    this.name = 'TranscribeError';
    this.status = status;
    this.openaiBody = openaiBody;
    this.diagnostics = diagnostics;
  }
}

export async function transcribe(blob: Blob): Promise<string> {
  const token = getToken();
  const res = await fetch('/api/transcribe', {
    method: 'POST',
    headers: {
      'Content-Type': blob.type || 'audio/webm',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: blob,
  });
  if (res.status === 401) {
    clearToken();
    window.location.reload();
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    // Server returns JSON `{ error, diagnostics }` on failure. Fall back to
    // raw text if the body wasn't JSON (e.g. proxy 502 with HTML).
    const raw = await res.text();
    let parsed: { error?: string; diagnostics?: TranscribeError['diagnostics'] } | null = null;
    try { parsed = JSON.parse(raw); } catch { /* not JSON */ }
    throw new TranscribeError(
      res.status,
      parsed?.error || raw || `HTTP ${res.status}`,
      parsed?.diagnostics,
    );
  }
  const data = (await res.json()) as { text: string };
  return data.text;
}

const MOCK_FILES: Record<string, FileEntry[]> = {
  '/home/void': [
    { name: 'voidbunny-app', type: 'dir', path: '/home/void/voidbunny-app', size: 0, modified: '2026-05-16T10:00:00Z' },
    { name: 'deploy-scripts', type: 'dir', path: '/home/void/deploy-scripts', size: 0, modified: '2026-05-16T09:30:00Z' },
    { name: 'notes', type: 'dir', path: '/home/void/notes', size: 0, modified: '2026-05-14T18:00:00Z' },
    { name: 'README.md', type: 'file', path: '/home/void/README.md', size: 1024, modified: '2026-05-15T11:20:00Z' },
  ],
  '/home/void/voidbunny-app': [
    { name: 'backend', type: 'dir', path: '/home/void/voidbunny-app/backend', size: 0, modified: '2026-05-16T10:00:00Z' },
    { name: 'frontend', type: 'dir', path: '/home/void/voidbunny-app/frontend', size: 0, modified: '2026-05-16T10:00:00Z' },
    { name: 'deploy', type: 'dir', path: '/home/void/voidbunny-app/deploy', size: 0, modified: '2026-05-15T22:10:00Z' },
    { name: 'scripts', type: 'dir', path: '/home/void/voidbunny-app/scripts', size: 0, modified: '2026-05-15T22:10:00Z' },
    { name: 'site', type: 'dir', path: '/home/void/voidbunny-app/site', size: 0, modified: '2026-05-16T09:00:00Z' },
    { name: 'install.sh', type: 'file', path: '/home/void/voidbunny-app/install.sh', size: 4096, modified: '2026-05-16T10:00:00Z' },
    { name: 'README.md', type: 'file', path: '/home/void/voidbunny-app/README.md', size: 5865, modified: '2026-05-15T06:58:00Z' },
  ],
};

export function listFiles(path: string): Promise<FileEntry[]> {
  if (IS_MOCK) return Promise.resolve(MOCK_FILES[path] ?? []);
  return api<FileEntry[]>(`/api/files?path=${encodeURIComponent(path)}`);
}

export type SearchMode = 'name' | 'content';

export interface SearchHit {
  kind: SearchMode;
  path: string;
  name: string;
  // content mode only
  line?: number;
  preview?: string;
}

export interface SearchResponse {
  results: SearchHit[];
  truncated: boolean;
  mode: SearchMode;
}

export function searchFiles(
  q: string,
  opts: { mode?: SearchMode; path?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<SearchResponse> {
  if (IS_MOCK) {
    return Promise.resolve({ results: [], truncated: false, mode: opts.mode ?? 'name' });
  }
  const qs = new URLSearchParams({ q });
  if (opts.mode) qs.set('mode', opts.mode);
  if (opts.path) qs.set('path', opts.path);
  if (opts.limit) qs.set('limit', String(opts.limit));
  return api<SearchResponse>(`/api/files/search?${qs.toString()}`, { signal: opts.signal });
}

export function readFile(path: string): Promise<FileContent> {
  return api<FileContent>(`/api/file?path=${encodeURIComponent(path)}`);
}

export async function fetchRawFile(path: string): Promise<Blob> {
  const token = getToken();
  const res = await fetch(`/api/file/raw?path=${encodeURIComponent(path)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (res.status === 401) {
    clearToken();
    window.location.reload();
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `HTTP ${res.status}`);
  }
  return res.blob();
}

export interface UploadResult {
  ok: true;
  path: string;
  size: number;
}

export class UploadError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function uploadFile(
  dirPath: string,
  name: string,
  content: Blob | string,
  options: { force?: boolean } = {},
): Promise<UploadResult> {
  const token = getToken();
  const qs = new URLSearchParams({ path: dirPath, name });
  if (options.force) qs.set('force', '1');
  const body = typeof content === 'string'
    ? new Blob([content], { type: 'text/plain' })
    : content;
  const res = await fetch(`/api/upload?${qs.toString()}`, {
    method: 'POST',
    headers: {
      'Content-Type': body.type || 'application/octet-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body,
  });
  if (res.status === 401) {
    clearToken();
    window.location.reload();
    throw new UploadError('Unauthorized', 401);
  }
  if (!res.ok) {
    const text = await res.text();
    let parsedErr: string | undefined;
    try { parsedErr = (JSON.parse(text) as { error?: string }).error; } catch { /* ignore */ }
    throw new UploadError(parsedErr || `HTTP ${res.status}`, res.status);
  }
  return res.json();
}

export async function uploadAttachment(
  project: string,
  name: string,
  content: Blob,
): Promise<UploadResult> {
  const token = getToken();
  const qs = new URLSearchParams({ project, name });
  const res = await fetch(`/api/upload-attachment?${qs.toString()}`, {
    method: 'POST',
    headers: {
      'Content-Type': content.type || 'application/octet-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: content,
  });
  if (res.status === 401) {
    clearToken();
    window.location.reload();
    throw new UploadError('Unauthorized', 401);
  }
  if (!res.ok) {
    const text = await res.text();
    let parsedErr: string | undefined;
    try { parsedErr = (JSON.parse(text) as { error?: string }).error; } catch { /* ignore */ }
    throw new UploadError(parsedErr || `HTTP ${res.status}`, res.status);
  }
  return res.json();
}

export async function getWsTicket(): Promise<string> {
  const { ticket } = await api<{ ticket: string }>('/api/ws-ticket');
  return ticket;
}

export async function login(username: string, password: string): Promise<string> {
  const res = await fetch('/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  const data = await res.json() as { token: string };
  return data.token;
}
