import { api } from './api';

// State exposed to the UI so it can pick the right copy + action. `supported`
// is the only hard gate; the rest decide which step the user is on
// (install-to-home-screen / grant-permission / already-on).
export interface PushState {
  supported: boolean;
  permission: NotificationPermission;
  subscribed: boolean;
  isStandalone: boolean;
  isIOS: boolean;
}

export function isStandalonePWA(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  // iOS Safari (pre-display-mode support) still surfaces this on the
  // standalone home-screen launch — keep the fallback or iOS PWAs read as
  // browser tabs.
  const nav = window.navigator as unknown as { standalone?: boolean };
  return nav.standalone === true;
}

export function isIOS(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent || '';
  // iPad on iOS 13+ reports as Mac with maxTouchPoints > 1.
  return /iPad|iPhone|iPod/.test(ua) ||
    (ua.includes('Mac') && (navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints! > 1);
}

function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export async function getPushState(): Promise<PushState> {
  const supported = pushSupported();
  const ios = isIOS();
  const standalone = isStandalonePWA();
  if (!supported) {
    return {
      supported: false,
      permission: 'default',
      subscribed: false,
      isStandalone: standalone,
      isIOS: ios,
    };
  }
  let subscribed = false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    subscribed = !!sub;
  } catch { /* SW may still be installing — fine */ }
  return {
    supported: true,
    permission: Notification.permission,
    subscribed,
    isStandalone: standalone,
    isIOS: ios,
  };
}

let cachedPublicKey: string | null = null;
async function getVapidPublicKey(): Promise<string> {
  if (cachedPublicKey) return cachedPublicKey;
  const { publicKey } = await api<{ publicKey: string }>('/api/push/config');
  if (!publicKey) throw new Error('Server has no VAPID public key configured');
  cachedPublicKey = publicKey;
  return publicKey;
}

// Standard base64url → Uint8Array conversion used by every Web Push tutorial.
// PushManager.subscribe expects the raw bytes of the VAPID public key.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export type SubscribeResult =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'denied' | 'failed'; message?: string };

export async function subscribeToPush(): Promise<SubscribeResult> {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };
  let permission: NotificationPermission;
  try {
    permission = await Notification.requestPermission();
  } catch (err) {
    return { ok: false, reason: 'failed', message: (err as Error)?.message };
  }
  if (permission !== 'granted') return { ok: false, reason: 'denied' };

  try {
    const publicKey = await getVapidPublicKey();
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      // Some TS DOM lib versions type `applicationServerKey` as accepting
      // only `ArrayBuffer` (not `Uint8Array<ArrayBufferLike>`), so feed the
      // underlying buffer slice directly to keep both runtime + types happy.
      const bytes = urlBase64ToUint8Array(publicKey);
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: buf,
      });
    }
    const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
    await api('/api/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      }),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: 'failed', message: (err as Error)?.message };
  }
}

export async function unsubscribeFromPush(): Promise<{ ok: boolean }> {
  if (!pushSupported()) return { ok: false };
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      try { await sub.unsubscribe(); } catch { /* still tell the server */ }
      try {
        await api('/api/push/unsubscribe', {
          method: 'POST',
          body: JSON.stringify({ endpoint }),
        });
      } catch { /* server cleanup is best-effort */ }
    }
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export async function sendTestPush(): Promise<void> {
  await api('/api/push/test', { method: 'POST', body: '{}' });
}
