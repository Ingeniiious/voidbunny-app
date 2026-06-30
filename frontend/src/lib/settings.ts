import type { CliKind } from './api';

// Pub/sub-ish settings store backed by localStorage. Components that read
// settings subscribe to a `storage`-like custom event so changes in the
// SettingsDialog propagate to KeyBar / MicButton without prop drilling.

const LAUNCHERS_KEY = 'panel.settings.launchers';
const MIC_KEY = 'panel.settings.micDeviceId';
const EVENT = 'panel:settings-changed';

export const ALL_CLIS: readonly CliKind[] = ['claude', 'codex', 'gemini', 'cursor', 'grok'];

// Sentinel for "let the browser/OS pick" — i.e. don't pass deviceId at all.
// localStorage can't store null distinctly from "missing", so we use a string.
export const MIC_AUTOMATIC = 'automatic';

export interface PanelSettings {
  launchers: CliKind[];
  micDeviceId: string; // 'automatic' or a deviceId string
}

const DEFAULT_LAUNCHERS: CliKind[] = ['claude'];

function isCli(value: unknown): value is CliKind {
  return typeof value === 'string' && (ALL_CLIS as readonly string[]).includes(value);
}

function readLaunchers(): CliKind[] {
  try {
    const raw = localStorage.getItem(LAUNCHERS_KEY);
    if (!raw) return [...DEFAULT_LAUNCHERS];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_LAUNCHERS];
    const cleaned = parsed.filter(isCli);
    // De-dupe while preserving the user's order.
    return Array.from(new Set(cleaned));
  } catch {
    return [...DEFAULT_LAUNCHERS];
  }
}

function readMic(): string {
  try {
    const raw = localStorage.getItem(MIC_KEY);
    if (!raw) return MIC_AUTOMATIC;
    return raw;
  } catch {
    return MIC_AUTOMATIC;
  }
}

export function getSettings(): PanelSettings {
  return { launchers: readLaunchers(), micDeviceId: readMic() };
}

export function setLaunchers(launchers: CliKind[]): void {
  const cleaned = Array.from(new Set(launchers.filter(isCli)));
  try { localStorage.setItem(LAUNCHERS_KEY, JSON.stringify(cleaned)); } catch { /* ignore */ }
  emitChange();
}

export function setMicDeviceId(deviceId: string): void {
  try { localStorage.setItem(MIC_KEY, deviceId); } catch { /* ignore */ }
  emitChange();
}

function emitChange(): void {
  try { window.dispatchEvent(new CustomEvent(EVENT)); } catch { /* ignore (SSR) */ }
}

// Subscribe to settings changes. Returns an unsubscribe function. Listens to
// both our in-tab CustomEvent and the cross-tab `storage` event so two open
// panel tabs stay in sync.
export function onSettingsChange(handler: () => void): () => void {
  const wrapped = () => handler();
  window.addEventListener(EVENT, wrapped);
  window.addEventListener('storage', wrapped);
  return () => {
    window.removeEventListener(EVENT, wrapped);
    window.removeEventListener('storage', wrapped);
  };
}
