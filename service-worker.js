// v2: network-first for the HTML document — this app is useless offline anyway
// (quotes always require a live Wikiquote fetch), so there is no upside to
// risking a stuck/stale cached shell, only downside. Static assets (css/js/
// icons) use stale-while-revalidate: instant load from cache, silently
// refreshed in the background for next time.
const CACHE_NAME = 'wikiquote-shell-v2';

// Note: intentionally NOT including './' or './index.html' here for
// cache-first purposes — the document is always fetched network-first.
const STATIC_SHELL_FILES = [
  './style.css',
  './languages.config.js',
  './script.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // cache each file independently so one bad/missing asset can't fail
      // the whole install step (unlike cache.addAll, which aborts on the
      // first rejection).
      await Promise.all(
        STATIC_SHELL_FILES.map((file) =>
          cache.add(file).catch((err) => {
            console.warn('[sw] failed to precache', file, err);
          })
        )
      );
      // also grab a copy of the document, used only as an offline fallback
      await cache.add('./index.html').catch(() => {});
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Never touch Wikiquote API calls — always live network, never cached.
  if (url.hostname.endsWith('wikiquote.org')) {
    return;
  }

  // Navigation (the HTML document itself, e.g. opening the installed PWA):
  // network-first. Only fall back to the cached copy if the network
  // genuinely fails (actual offline), never because of a stale/corrupt
  // cache entry sitting in front of a perfectly reachable network.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('./index.html'))
    );
    return;
  }

  if (req.method !== 'GET') return;

  // Static assets: stale-while-revalidate.
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(req);
      const networkFetch = fetch(req)
        .then((response) => {
          if (response.ok) cache.put(req, response.clone());
          return response;
        })
        .catch(() => cached); // if network fails, fall back to whatever we had cached

      return cached || networkFetch;
    })
  );
});
