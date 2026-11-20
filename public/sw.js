// Only the public offline page is cached. Never cache portfolio, auth or API responses.
const CACHE = 'financial-offline-v1';
const offlineUrl = new URL('offline.html', self.registration.scope).href;

self.addEventListener('install', event => {
  // Activate immediately: a worker still waiting keeps the previous script
  // (and therefore the previous click handling) until every window is closed.
  event.waitUntil((async () => {
    await self.skipWaiting();
    const cache = await caches.open(CACHE);
    await cache.add(new Request(offlineUrl, { cache: 'reload' }));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith('financial-offline-') && name !== CACHE).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || request.mode !== 'navigate' || !url.href.startsWith(self.registration.scope)) return;
  event.respondWith((async () => {
    try { return await fetch(request); }
    catch {
      const cache = await caches.open(CACHE);
      return await cache.match(offlineUrl) || Response.error();
    }
  })());
});

// The worker receives a Push on every hourly sync. Only the first one of the
// day may alert: later ones silently refresh the same notification.
const NOTIFY_CACHE = 'financial-notify-v1';
const shownDayUrl = new URL('last-notification-day', self.registration.scope).href;

function parisDay() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

async function alreadyNotifiedToday() {
  try {
    const cache = await caches.open(NOTIFY_CACHE);
    const response = await cache.match(shownDayUrl);
    return (await response?.text()) === parisDay();
  } catch { return false; }
}

async function rememberNotification() {
  try {
    const cache = await caches.open(NOTIFY_CACHE);
    await cache.put(shownDayUrl, new Response(parisDay()));
  } catch { /* The notification stays visible even if local storage is unavailable. */ }
}

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let payload = {};
    try { payload = event.data?.json() || {}; } catch { /* Always show a visible notification. */ }
    const repeat = await alreadyNotifiedToday();
    await self.registration.showNotification('FinancIAl · Rendement global', {
      body: typeof payload.body === 'string' ? payload.body.slice(0, 500) : 'Ton rendement global a été actualisé.',
      icon: new URL('icons/icon-192.png', self.registration.scope).href,
      tag: 'financial-sync-impact',
      silent: repeat,
      renotify: !repeat,
      data: { url: self.registration.scope },
    });
    if (!repeat) await rememberNotification();
  })());
});

function inScope(value) {
  return typeof value === 'string' && value.startsWith(self.registration.scope);
}

// The notification is shown for the app root, so a click must bring the app
// forward. Opening a window is the only safe fallback: some Android builds
// reject focus() on a background PWA, and a rejection used to leave the click
// without any visible effect.
async function openApp(notification) {
  const url = inScope(notification?.data?.url) ? notification.data.url : self.registration.scope;
  let windows = [];
  try { windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true }); }
  catch { /* Continue: a new window is still worth trying. */ }
  const existing = windows.find(client => inScope(client.url));
  if (existing) {
    try { await existing.focus(); return; }
    catch { /* Fall back to opening the app. */ }
  }
  try { await self.clients.openWindow(url); }
  catch { /* No other way to bring the app forward. */ }
}

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(openApp(event.notification));
});
