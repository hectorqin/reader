/* Build placeholders are replaced after all assets have been emitted. */
const scope = self.registration.scope;
const prefix = `reader-shell:${scope}:`;
const cacheName = `${prefix}__VERSION__`;
const files = __PRECACHE__;
const urls = files.map((file) => new URL(file, scope).href);
const shell = new URL('index.html', scope).href;

self.addEventListener('install', (event) => {
  // Reload bypasses HTTP caches for the fixed-name Android-compatible bundle.
  // Do not skipWaiting: an open reader must keep its current bundle until closed.
  event.waitUntil(caches.open(cacheName).then((cache) =>
    cache.addAll(urls.map((url) => new Request(url, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(prefix) && key !== cacheName) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== new URL(scope).origin) return;
  // Only the application shell belongs here. Account data and book bodies use
  // the existing account-scoped stores, never a shared HTTP response cache.
  const home = new URL(scope).pathname;
  const isHome = request.mode === 'navigate' && (url.pathname === home || url.pathname === new URL(shell).pathname);
  const key = isHome ? shell : url.href;
  if (!isHome && !urls.includes(key)) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    return (await cache.match(key)) ?? fetch(request);
  })());
});
