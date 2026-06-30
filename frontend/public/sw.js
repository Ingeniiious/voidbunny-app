// Voidbunny PWA service worker.
// SW_VERSION is read by the page on registration to detect a new worker and
// force-activate it; bump this string whenever push handling changes or iOS
// will keep serving the previous SW for days even after the file ships.
const SW_VERSION = '2026-05-18-cachebust';
self.SW_VERSION = SW_VERSION;
//
// Owns three things:
//   1) Web Push delivery — show a notification when the backend posts a push.
//   2) Click handling — focus the existing PWA window if open, otherwise
//      open a fresh one at the URL embedded in the push payload.
//   3) Lifecycle — claim clients on activate so the first install starts
//      delivering pushes immediately (no second-load required).
//
// Deliberately not caching app shell here — the panel is online-only by
// design (no offline tmux), and a stale shell would block deploys.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: 'Voidbunny', body: event.data.text() };
  }
  const { title = 'Voidbunny', body = '', url = '/', tag, requireInteraction } = data;
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/logo-192.png',
      badge: '/logo-192.png',
      tag: tag || 'voidbunny',
      data: { url },
      vibrate: [200, 100, 200],
      requireInteraction: !!requireInteraction,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.includes(self.location.origin) && 'focus' in c) {
        try { await c.navigate(target); } catch { /* cross-origin or unsupported — ignore */ }
        return c.focus();
      }
    }
    return self.clients.openWindow(target);
  })());
});
