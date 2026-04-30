# AKG ESS — Employee Self-Service

A mobile-first PWA for AKG Contracting field staff: attendance with geofencing, leaves, and petty cash. Packaged as a **Frappe app** so it installs cleanly on any Frappe / ERPNext site (Frappe Cloud or self-hosted) and serves at `/ess` on the host site.

> The app talks to the host site over same-origin REST — no base URL config, no CORS, no env vars. Install on any site and it works.

## What's in the box

```
akg_ess/                           # Python package (Frappe app)
├── __init__.py
├── hooks.py                       # doc_events, fixtures, permission hooks
├── modules.txt                    # module: "AKG ESS"
├── patches.txt
├── api.py                         # /api/method/akg_ess.api.* whitelisted endpoints (OCR proxy)
├── akg_ess/                       # module folder
│   └── doctype/
│       ├── geofence_violation/    # custom DocType + on_update hook (auto-creates Employee Checkin on Approved)
│       ├── ess_notification/      # custom DocType + permission_query_conditions + has_permission
│       └── petty_cash_topup_request/
├── public/akg_ess/                # static PWA assets — served at /assets/akg_ess/...
│   ├── api.js                     # real Frappe REST client (same-origin)
│   ├── data.js                    # i18n strings (EN + AR) + legacy global stubs
│   ├── styles.css
│   ├── sw.js                      # service worker (stale-while-revalidate; never caches /api/)
│   ├── manifest.webmanifest
│   ├── ui.jsx, attendance.jsx, leaves.jsx, petty.jsx, profile.jsx, notifications.jsx, monthly-report.jsx
│   └── assets/                    # icons, logo
├── www/ess/                       # web route — PWA shell at /ess
│   ├── index.html
│   └── index.py
└── fixtures/
    ├── custom_field.json          # Project geofence + Employee Checkin location + local_id idempotency keys
    └── role.json                  # ESS User, ESS Manager
```

## Install on Frappe Cloud

1. **Create the app source.** In your Frappe Cloud bench, *Apps → Add App → Add from GitHub*:
   - Repository: `https://github.com/Monzerdh/erpnextAKG`
   - Branch: `main`
   - App name: `akg_ess`
2. **Add to bench.** Pick the bench you want, click *Add*, wait for the build to finish.
3. **Install on a site.** From the site dashboard, *Apps → Install App → AKG ESS*. Frappe will run migrations and import fixtures (the custom DocTypes and Custom Fields appear automatically).
4. **Configure receipt OCR (optional).** Open `https://your-site/app/akg-ess-settings` as a System Manager and fill in:

   - **Anthropic API Key** — encrypted at rest. Get one at <https://console.anthropic.com/settings/keys>.
   - **Model** — `claude-haiku-4-5-20251001` (default; cheap and fast) or `claude-sonnet-4-6` for tougher receipts.
   - **Monthly call cap** — soft guardrail. Default 5000.

   Without a key the receipt scanner returns empty defaults and the form just stays manual — no errors, no broken UI.

   *(Legacy fallback: if you already have `anthropic_api_key` in `site_config.json`, the app reads that when the settings DocType has no key. Either works.)*
5. **Open the app.** Visit `https://your-site/ess`.

That's it. The PWA reads the user's session cookie set by `/api/method/login`, so as long as someone is logged into the Frappe site they're in the app.

## Install on a self-hosted bench

```bash
cd ~/frappe-bench
bench get-app https://github.com/Monzerdh/erpnextAKG --branch main
bench --site <site-name> install-app akg_ess
bench --site <site-name> migrate
bench build --app akg_ess
```

To enable receipt OCR:

```bash
bench pip install anthropic
```

Then open `https://<site>/app/akg-ess-settings` and paste your Anthropic key into the *Anthropic API Key* field. (Or if you prefer a CLI install, `bench --site <site> set-config anthropic_api_key sk-ant-...` still works as a fallback.)

## How it works

- **Routing.** `akg_ess/www/ess/index.html` is rendered at `/ess` by Frappe's website renderer. The accompanying `index.py` sets `no_cache`, `no_sitemap`, and `no_breadcrumbs` so it serves as a standalone HTML document with no Frappe chrome.
- **Static assets.** Files under `akg_ess/public/akg_ess/` are copied by `bench build` to `sites/assets/akg_ess/...` and served at `/assets/akg_ess/<file>`.
- **API.** Every `window.frappe.*` call in `api.js` is a same-origin `fetch('/api/...')`. The session cookie carries through. CSRF token is read from cookie / `window.csrf_token` and sent as `X-Frappe-CSRF-Token`.
- **Geofence flow.** Outside-zone check-ins are NOT auto-posted to ERPNext. They create a `Geofence Violation` (status=Pending). When a manager flips the status to Approved, `geofence_violation.on_status_change` (registered via `doc_events`) creates the matching `Employee Checkin` so attendance posts only after review.
- **Offline outbox.** When `isOffline` is true, check-ins / leaves / claims are queued in component state with `_localId`. On reconnect, `syncOfflineQueue()` drains them through the regular API. Each insert carries the `local_id` field, which has a unique index — so a duplicate sync after a flaky network is rejected by the database.
- **Receipt OCR.** `petty.jsx` POSTs the receipt image (data URL) to `akg_ess.api.extract_receipt`. The server reads `anthropic_api_key` from `site_config.json`, calls Claude Haiku, and returns the parsed JSON. The API key never ships in the bundle.

## Permissions / roles

The fixtures install two custom roles — assign these to your users:

| Role         | What it does                                                                       |
|--------------|------------------------------------------------------------------------------------|
| ESS User     | Standard field-staff role. Can submit own check-ins, leaves, claims, violations.   |
| ESS Manager  | Can approve / reject leaves, claims, top-up requests, geofence violations on their team. |

If a user doesn't have ESS Manager but has any of HR Manager / Projects Manager / Accounts Manager, the app still surfaces the relevant approval queues.

## Releasing a new version

The PWA caches itself in a service worker. Two things must change for users to pick up an update:

1. Bump `CACHE_VERSION` in `akg_ess/public/akg_ess/sw.js` (e.g. `akg-ess-v30` → `akg-ess-v31`).
2. Bump every `?v=NN` query string in `akg_ess/www/ess/index.html` and `akg_ess/public/akg_ess/sw.js` to match.

Without those bumps, returning users keep loading the old SW and never see the new code.

## See also

- **`CUSTOM_DOCTYPES.md`** — every custom DocType + custom field, listed with field names and types, in case you want to create them by hand on a site where fixtures didn't auto-install.

---

Built April 2026.
