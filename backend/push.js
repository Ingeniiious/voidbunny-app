import { Router } from 'express';
import webpush from 'web-push';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, 'data');
const VAPID_FILE = path.join(DATA_DIR, 'vapid.json');
const SUBS_FILE = path.join(DATA_DIR, 'push-subscriptions.json');

// VAPID `sub` claim. Apple's APNs validator (web.push.apple.com) is strict
// here: any reserved TLD (.local / .localhost / .invalid / .test / .example)
// makes it 403 every push with `BadJwtToken`, so iOS PWAs silently get nothing
// despite a healthy-looking subscribe round-trip. Default to a real public
// mailto so iOS works out of the box; the user can override for branding.
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
if (/(\.local|\.localhost|\.invalid|\.test|\.example)(\/|\?|$)/i.test(VAPID_SUBJECT)) {
  console.warn(
    `[push] VAPID_SUBJECT="${VAPID_SUBJECT}" uses a reserved TLD — Apple APNs will reject every push with 403 BadJwtToken. Set VAPID_SUBJECT to a real mailto: or https: URL.`,
  );
}

// endpoint -> { endpoint, keys: { p256dh, auth }, addedAt }
const subs = new Map();
let vapidPublicKey = '';

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
}

async function loadOrGenerateVapid() {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(VAPID_FILE, 'utf8');
    const j = JSON.parse(raw);
    if (j.publicKey && j.privateKey) {
      webpush.setVapidDetails(VAPID_SUBJECT, j.publicKey, j.privateKey);
      vapidPublicKey = j.publicKey;
      return;
    }
  } catch { /* fall through to generation */ }
  const keys = webpush.generateVAPIDKeys();
  await fs.writeFile(
    VAPID_FILE,
    JSON.stringify({ publicKey: keys.publicKey, privateKey: keys.privateKey }, null, 2),
    { mode: 0o600 },
  );
  webpush.setVapidDetails(VAPID_SUBJECT, keys.publicKey, keys.privateKey);
  vapidPublicKey = keys.publicKey;
  console.log('[push] generated new VAPID keys at', VAPID_FILE);
}

async function loadSubs() {
  try {
    const raw = await fs.readFile(SUBS_FILE, 'utf8');
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      for (const s of arr) {
        if (s?.endpoint && s?.keys?.p256dh && s?.keys?.auth) {
          subs.set(s.endpoint, s);
        }
      }
    }
  } catch { /* file missing on first boot — fine */ }
}

let persistTimer = null;
function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(async () => {
    persistTimer = null;
    try {
      await ensureDataDir();
      const tmp = SUBS_FILE + '.tmp';
      await fs.writeFile(tmp, JSON.stringify([...subs.values()], null, 2), { mode: 0o600 });
      await fs.rename(tmp, SUBS_FILE);
    } catch (err) {
      console.warn('[push] persist failed:', err.message);
    }
  }, 500);
  persistTimer.unref?.();
}

// Boot-time init. Calling these here (top-level) instead of from index.js
// keeps the wiring symmetric with the other modules — they each manage
// their own state on import.
await loadOrGenerateVapid();
await loadSubs();

export async function sendPush(payload) {
  if (subs.size === 0) return { sent: 0, removed: 0 };
  const body = JSON.stringify(payload);
  const dead = [];
  await Promise.all([...subs.values()].map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: s.keys },
        body,
        { TTL: 60 * 60 },
      );
    } catch (err) {
      // 404/410 mean the push service has expired this subscription —
      // drop it so we don't keep retrying a dead endpoint.
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        dead.push(s.endpoint);
      } else {
        console.warn('[push] send error', err?.statusCode, err?.body || err?.message);
      }
    }
  }));
  for (const e of dead) subs.delete(e);
  if (dead.length) schedulePersist();
  return { sent: subs.size, removed: dead.length };
}

const router = Router();

router.get('/config', (_req, res) => {
  res.json({ publicKey: vapidPublicKey });
});

router.post('/subscribe', (req, res) => {
  const { endpoint, keys } = req.body ?? {};
  if (typeof endpoint !== 'string' || !endpoint.startsWith('https://')) {
    return res.status(400).json({ error: 'invalid endpoint' });
  }
  if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') {
    return res.status(400).json({ error: 'invalid keys' });
  }
  subs.set(endpoint, { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth }, addedAt: Date.now() });
  schedulePersist();
  res.json({ ok: true });
});

router.post('/unsubscribe', (req, res) => {
  const { endpoint } = req.body ?? {};
  if (typeof endpoint !== 'string') {
    return res.status(400).json({ error: 'invalid endpoint' });
  }
  const had = subs.delete(endpoint);
  if (had) schedulePersist();
  res.json({ ok: true, removed: had });
});

router.post('/test', async (_req, res) => {
  // The OS already prefixes every PWA notification with the app name from
  // manifest.webmanifest, so the title is purely the event subject.
  const r = await sendPush({
    title: 'Notifications on ✓',
    body: 'Test ping from your panel',
    url: '/',
    tag: 'test',
  });
  res.json(r);
});

export default router;
