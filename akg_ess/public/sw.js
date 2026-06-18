// AKG ESS — service worker
// Strategies:
//   - Same-origin shell  : stale-while-revalidate
//   - OSM map tiles      : cache-first (long-lived; tiles change rarely)
//   - /api/, /private/   : never cached (always live)
//   - Other cross-origin : passthrough (CDN handles its own caching)
// Bump CACHE_VERSION whenever you ship a new build.

const CACHE_VERSION = 'akg-ess-v70';
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `runtime-${CACHE_VERSION}`;
const TILE_CACHE = `osm-tiles-${CACHE_VERSION}`;
const TILE_MAX_ENTRIES = 600; // ~roughly Dubai metro at zoom 14–17

const APP_SHELL = [
  '/ess',
  '/assets/akg_ess/styles.css?v=70',
  '/assets/akg_ess/data.js?v=70',
  '/assets/akg_ess/api.js?v=70',
  '/assets/akg_ess/ui.jsx?v=70',
  '/assets/akg_ess/attendance.jsx?v=70',
  '/assets/akg_ess/monthly-report.jsx?v=70',
  '/assets/akg_ess/leaves.jsx?v=70',
  '/assets/akg_ess/petty.jsx?v=70',
  '/assets/akg_ess/profile.jsx?v=70',
  '/assets/akg_ess/notifications.jsx?v=70',
  '/assets/akg_ess/missed-checkout.jsx?v=70',
  '/assets/akg_ess/manifest.webmanifest',
  '/assets/akg_ess/assets/akg-logo.png',
  '/assets/akg_ess/assets/icon-192.png',
  '/assets/akg_ess/assets/icon-512.png',
  '/assets/akg_ess/assets/icon-maskable-192.png',
  '/assets/akg_ess/assets/icon-maskable-512.png',
  '/assets/akg_ess/assets/apple-touch-icon.png',
  '/assets/akg_ess/assets/favicon-64.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      Promise.all(
        APP_SHELL.map((url) =>
          cache.add(url).catch((err) => console.warn('[sw] skip', url, err))
        )
      )
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !k.endsWith(CACHE_VERSION))
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// LRU-ish trim: drop oldest entries when the tile cache grows past the cap.
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  const excess = keys.length - maxEntries;
  for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // ─── OSM tiles (cross-origin) — cache-first ────────────────────────
  // tile.openstreetmap.org has subdomains a/b/c. Once cached, tiles are
  // good for ~weeks; we only re-fetch when the cache has nothing.
  if (/(^|\.)tile\.openstreetmap\.org$/.test(url.hostname)) {
    event.respondWith(
      caches.open(TILE_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const res = await fetch(req, { mode: 'cors', credentials: 'omit' });
          if (res && res.ok) {
            cache.put(req, res.clone()).then(() => trimCache(TILE_CACHE, TILE_MAX_ENTRIES));
          }
          return res;
        } catch (e) {
          return cached || Response.error();
        }
      })
    );
    return;
  }

  if (url.origin !== location.origin) return;     // other CDNs handle their own caching
  if (url.pathname.startsWith('/api/')) return;   // never cache API
  if (url.pathname.startsWith('/private/files/')) return;

  event.respondWith(
    caches.open(RUNTIME_CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: false });
      const networkPromise = fetch(req)
        .then((res) => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || networkPromise;
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
