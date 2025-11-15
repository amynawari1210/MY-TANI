// sw.js - simple cache-first service worker
const CACHE_NAME = 'mytani-cache-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './sw.js'
];

self.addEventListener('install', event=>{
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache=>{
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event=>{
  event.waitUntil(
    caches.keys().then(keys=>{
      return Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', event=>{
  // skip chrome-extension and data: requests
  if (event.request.url.startsWith('chrome-extension:') || event.request.url.startsWith('data:')) return;

  event.respondWith(
    caches.match(event.request).then(response=>{
      return response || fetch(event.request).then(fetchRes=>{
        // optional: put new requests into cache
        return caches.open(CACHE_NAME).then(cache=>{
          try {
            cache.put(event.request, fetchRes.clone());
          } catch(e){}
          return fetchRes;
        });
      }).catch(()=> {
        // fallback to cache root if offline
        return caches.match('./');
      });
    })
  );
});
