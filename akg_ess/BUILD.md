# Building the /ess PWA front-end

The Employee Self-Service app at `/ess` is a React app written as plain
(non-module) JSX files in `public/`. They are **pre-compiled** into a single
bundle so the browser never has to download Babel or transpile on the fly, and
the libraries are **self-hosted** (no third-party CDN).

## When do I need to build?

Run the build whenever you edit any `.jsx` file in `public/`:

```
public/ui.jsx
public/attendance.jsx
public/monthly-report.jsx
public/leaves.jsx
public/petty.jsx
public/profile.jsx
public/notifications.jsx
public/missed-checkout.jsx
public/app.jsx          <- application entry (was the inline <script> in index.html)
```

Editing `data.js` or `api.js` does **not** require a build — they are plain JS,
loaded as their own `<script>` before the bundle. Just bump the `?v=` query.

## How to build

From this directory (`akg_ess/`):

```bash
npm install      # first time only — installs esbuild (a devDependency)
npm run build    # -> writes public/ess.bundle.js
```

`build.mjs` transpiles the JSX with esbuild, concatenates the sources in the
order above, and writes `public/ess.bundle.js` (committed to the repo). Node 18+
is required; `node_modules/` is git-ignored.

## Shipping a change

1. Edit a `.jsx` source.
2. `npm run build`.
3. Bump the `?v=NN` version in **two** places so browsers/the service worker
   fetch the new files:
   - `www/ess/index.html` (the `?v=` on every asset)
   - `public/sw.js` (`CACHE_VERSION` **and** the `?v=` in `APP_SHELL`)
4. Commit `public/ess.bundle.js` together with your source change.

## Vendored libraries

`public/vendor/` holds self-hosted copies (no CDN at runtime):

| File | Version |
|------|---------|
| `react.production.min.js` | react@18.3.1 (UMD, production) |
| `react-dom.production.min.js` | react-dom@18.3.1 (UMD, production) |
| `leaflet.js` / `leaflet.css` | leaflet@1.9.4 |

To upgrade a library, replace the file in `vendor/`, bump `?v=`, and re-test.
React/ReactDOM are exposed as the globals `React` / `ReactDOM`; Leaflet as `L`.

> Note: Google Fonts and OpenStreetMap map tiles are still loaded from their
> own services by design (fonts are cosmetic; tiles are the map data itself).
> The app's *code* no longer depends on any third-party CDN being reachable.
