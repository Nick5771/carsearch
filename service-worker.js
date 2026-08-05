/* FindAI marketplace notifications */
self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {
    try { data = { body: event.data ? event.data.text() : '' }; } catch (_) {}
  }
  const title = data.title || 'FindAI';
  const options = {
    body: data.body || 'You have a new marketplace update.',
    icon: '/findai-icon-192.png?v=12',
    badge: '/findai-favicon-32.png?v=12',
    tag: data.tag || 'findai-marketplace',
    renotify: true,
    data: { url: data.url || 'https://findai.ai/' }
  };
  event.waitUntil((async () => {
    try {
      if (self.navigator && typeof self.navigator.setAppBadge === 'function' && Number(data.badgeCount) > 0) {
        await self.navigator.setAppBadge(Number(data.badgeCount));
      }
    } catch (_) {}
    await self.registration.showNotification(title, options);
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = event.notification && event.notification.data && event.notification.data.url
    ? event.notification.data.url
    : 'https://findai.ai/';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      try {
        const current = new URL(client.url);
        const wanted = new URL(target, self.location.origin);
        if (current.origin === wanted.origin) {
          await client.focus();
          if ('navigate' in client) await client.navigate(wanted.href);
          return;
        }
      } catch (_) {}
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
