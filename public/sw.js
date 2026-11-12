// Only the public offline page is cached. Never cache portfolio, auth or API responses.
const CACHE = 'financial-offline-v1';
const offlineUrl = new URL('offline.html', self.registration.scope).href;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add(new Request(offlineUrl, { cache: 'reload' }))));
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
