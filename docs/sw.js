// sw.js - aggressive precache + runtime caching
const CACHE_VERSION = 'v3'; // increment this when you change assets
const PRECACHE = `mytani-precache-${CACHE_VERSION}`;
const RUNTIME = `mytani-runtime-${CACHE_VERSION}`;

// list here the core files you want guaranteed available offline
const PRECACHE_URLS = [
'./', // navigation root (index.html)
'./index.html',
'./manifest.json',
'./icon-192.png',
'./icon-512.png',
// add any other static files you want precached
];

// Utility: keep runtime cache size under a limit
async function trimCache(cacheName, maxItems) {
const cache = await caches.open(cacheName);
const keys = await cache.keys();
if (keys.length <= maxItems) return;
// delete oldest entries until size <= maxItems
for (let i = 0; i < keys.length - maxItems; i++) {
await cache.delete(keys[i]);
}
}

// install -> precache
self.addEventListener('install', event => {
self.skipWaiting();
event.waitUntil(
caches.open(PRECACHE)
.then(cache => cache.addAll(PRECACHE_URLS))
);
});

// activate -> cleanup old caches
self.addEventListener('activate', event => {
clients.claim();
event.waitUntil(
caches.keys().then(keys => Promise.all(
keys.filter(k => k !== PRECACHE && k !== RUNTIME)
.map(k => caches.delete(k))
))
);
});

// fetch handler with strategies:
// - navigation requests -> network-first (so we get newest index.html), fallback to cache
// - requests to /api/ -> network-first with cache fallback
// - images/static (png,jpg,svg,css,js) -> cache-first (fast) with stale-while-revalidate
// - others -> stale-while-revalidate via runtime
self.addEventListener('fetch', event => {
const req = event.request;
const url = new URL(req.url);

// only handle same-origin requests (avoid interfering with other domains)
const isSameOrigin = url.origin === location.origin;

// 1) navigation (SPA) - network first
if (req.mode === 'navigate' || (isSameOrigin && req.method === 'GET' && req.headers.get('accept') && req.headers.get('accept').includes('text/html'))) {
event.respondWith(
fetch(req)
.then(response => {
// update precache/index in runtime cache too
const copy = response.clone();
caches.open(RUNTIME).then(cache => cache.put('./', copy));
return response;
})
.catch(() => caches.match('./') /* fallback to precached index.html */)
);
return;
}

// 2) API requests - network-first then cache
if (isSameOrigin && url.pathname.startsWith('/api/')) {
event.respondWith(
fetch(req).then(networkResponse => {
// cache API response (optional)
const clone = networkResponse.clone();
caches.open(RUNTIME).then(cache => cache.put(req, clone));
return networkResponse;
}).catch(() => caches.match(req))
);
return;
}

// 3) Images & fonts & media -> cache-first with limit
if (req.destination === 'image' || /\.(png|jpg|jpeg|svg|gif|webp|ico)$/.test(url.pathname)) {
event.respondWith(
caches.match(req).then(cached => {
if (cached) return cached;
return fetch(req).then(networkResponse => {
// put in runtime cache and trim
const copy = networkResponse.clone();
caches.open(RUNTIME).then(async cache => {
await cache.put(req, copy);
trimCache(RUNTIME, 60); // keep last 60 entries
});
return networkResponse;
}).catch(() => {
// optional placeholder - return nothing if not present
return caches.match('./icon-192.png') || Response.error();
});
})
);
return;
}

// 4) CSS/JS -> stale-while-revalidate
if (/\.(css|js)$/.test(url.pathname) || req.destination === 'script' || req.destination === 'style') {
event.respondWith(
caches.open(RUNTIME).then(cache =>
cache.match(req).then(cachedResp => {
const networkFetch = fetch(req).then(networkResp => {
cache.put(req, networkResp.clone());
return networkResp;
}).catch(()=>undefined);
// return cached if available immediately, otherwise wait for network
return cachedResp || networkFetch;
})
)
);
return;
}

// 5) default: try cache, else network (stale-while-revalidate)
event.respondWith(
caches.match(req).then(cached => {
const network = fetch(req).then(networkResp => {
// update runtime cache for GET only
if (req.method === 'GET' && isSameOrigin) {
caches.open(RUNTIME).then(cache => cache.put(req, networkResp.clone()));
}
return networkResp;
}).catch(()=>undefined);
return cached || network;
})
);
});

// message handler (optional) - allow client to ask SW to skipWaiting
self.addEventListener('message', event => {
if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
