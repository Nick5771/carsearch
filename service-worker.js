/* FindAI marketplace notifications */
const FINDAI_APP_URL = 'https://findai.ai/findai-app.html';

function normalizeFindAIUrl(rawUrl) {
  try {
    const target = new URL(rawUrl || FINDAI_APP_URL, self.location.origin);
    if (target.origin === self.location.origin &&
        (target.pathname === '/' || target.pathname === '/index.html')) {
      target.pathname = '/findai-app.html';
    }
    const conversationId = target.searchParams.get('conversation');
    if (conversationId) {
      target.pathname = '/findai-app.html';
      target.search = '?conversation=' + encodeURIComponent(conversationId);
    }
    return target.href;
  } catch (_) {
    return FINDAI_APP_URL;
  }
}

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    try { data = { body: event.data ? event.data.text() : '' }; } catch (_) {}
  }

  const title = data.title || 'FindAI';
  const options = {
    body: data.body || 'You have a new marketplace update.',
    icon: '/findai-icon-192.png?v=12',
    badge: '/findai-favicon-32.png?v=12',
    tag: data.tag || 'findai-marketplace',
    renotify: true,
    data: { url: normalizeFindAIUrl(data.url) }
  };

  event.waitUntil((async () => {
    try {
      if (self.navigator &&
          typeof self.navigator.setAppBadge === 'function' &&
          Number(data.badgeCount) > 0) {
        await self.navigator.setAppBadge(Number(data.badgeCount));
      }
    } catch (_) {}
    await self.registration.showNotification(title, options);
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = normalizeFindAIUrl(
    event.notification &&
    event.notification.data &&
    event.notification.data.url
  );

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    });

    // Prefer the installed/new FindAI app window over an older root-site tab.
    const ordered = [...windows].sort((a, b) => {
      const aIsApp = String(a.url || '').includes('/findai-app.html') ? 1 : 0;
      const bIsApp = String(b.url || '').includes('/findai-app.html') ? 1 : 0;
      return bIsApp - aIsApp;
    });

    for (const client of ordered) {
      try {
        const current = new URL(client.url);
        const wanted = new URL(target);
        if (current.origin === wanted.origin) {
          if ('navigate' in client) await client.navigate(wanted.href);
          await client.focus();
          return;
        }
      } catch (_) {}
    }

    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
