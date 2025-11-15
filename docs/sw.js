// docs/sw.js
const PRECACHE = 'mytani-precache-v2';
const RUNTIME  = 'mytani-runtime-v1';

const PRECACHE_URLS = [
  './',                 // fallback for navigation
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './sw.js'
];

// small helper: keep cache size small
async function trimCache(cacheName, maxItems){
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if(keys.length > maxItems){
    await cache.delete(keys[0]);
    return trimCache(cacheName, maxItems);
  }
}

// install: precache core assets
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(PRECACHE)
      .then(cache => cache.addAll(PRECACHE_URLS))
  );
});

// activate: cleanup old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => {
        if(k !== PRECACHE && k !== RUNTIME) return caches.delete(k);
      }));
      await self.clients.claim();
    })()
  );
});

// fetch handler: navigation, api, images/fonts, other
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;

  // 1) Navigation requests (HTML) -> network-first then fallback to precached index.html
  if (req.mode === 'navigate' || (req.method === 'GET' && req.headers.get('accept') && req.headers.get('accept').includes('text/html'))) {
    event.respondWith(
      fetch(req)
        .then(networkResponse => {
          // update runtime cache for navigation (so offline works)
          const copy = networkResponse.clone();
          caches.open(RUNTIME).then(cache => cache.put('./', copy));
          return networkResponse;
        })
        .catch(() => caches.match('./') /* fallback to precached index.html */)
    );
    return;
  }

  // 2) API requests -> network-first then cache (useful for dynamic data)
  if (isSameOrigin && url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(req)
        .then(networkResponse => {
          // optionally cache the API response
          const copy = networkResponse.clone();
          caches.open(RUNTIME).then(cache => cache.put(req, copy));
          return networkResponse;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // 3) Images / media / icons -> cache-first with limit
  if (req.destination === 'image' || /\.(png|jpg|jpeg|svg|gif|webp|ico)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached;
        return fetch(req).then(networkResponse => {
          const copy = networkResponse.clone();
          caches.open(RUNTIME).then(cache => {
            cache.put(req, copy);
            // keep images small
            trimCache(RUNTIME, 60);
          });
          return networkResponse;
        }).catch(() => {
          // optional fallback image (if you add fallback.png to precache)
          return caches.match('./icon-192.png');
        });
      })
    );
    return;
  }

  // 4) Fonts & styles -> stale-while-revalidate
  if (req.destination === 'style' || req.destination === 'font' || /\.css$/.test(url.pathname) || /\.woff2?$/.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then(cached => {
        const network = fetch(req).then(networkResponse => {
          caches.open(RUNTIME).then(cache => cache.put(req, networkResponse.clone()));
          return networkResponse;
        }).catch(()=>null);
        return cached || network;
      })
    );
    return;
  }

  // 5) Fallback: try cache, else network
  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req).catch(()=>caches.match('./')))
  );
});

// allow web page to trigger skipWaiting via postMessage
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
