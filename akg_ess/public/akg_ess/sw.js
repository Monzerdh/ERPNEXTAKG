// AKG ESS — service worker
// Strategy: stale-while-revalidate for app shell; runtime cache for assets.
// Bump CACHE_VERSION whenever you ship a new build.

const CACHE_VERSION = 'akg-ess-v30';
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `runtime-${CACHE_VERSION}`;

const APP_SHELL = [
  '/ess',
  '/assets/akg_ess/styles.css?v=30',
  '/assets/akg_ess/data.js?v=30',
  '/assets/akg_ess/api.js?v=30',
  '/assets/akg_ess/ui.jsx?v=30',
  '/assets/akg_ess/attendance.jsx?v=30',
  '/assets/akg_ess/monthly-report.jsx?v=30',
  '/assets/akg_ess/leaves.jsx?v=30',
  '/assets/akg_ess/petty.jsx?v=30',
  '/assets/akg_ess/profile.jsx?v=30',
  '/assets/akg_ess/notifications.jsx?v=30',
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
      // Cache opportunistically — don't fail install if a single asset is missing
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

// Stale-while-revalidate for static GETs only. We DO NOT cache /api/...
// — those need to hit the live Frappe site every time so auth, CSRF, and
// fresh data behave correctly.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;     // skip cross-origin (CDNs handle their own caching)
  if (url.pathname.startsWith('/api/')) return;   // never cache API
  if (url.pathname.startsWith('/private/files/')) return; // private uploads

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
