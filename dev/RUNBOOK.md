# Local test environment — restore production + live-edit AKG ESS

Run a full local copy of the `akgv2beta.k.frappe.cloud` site in Docker,
with **akg_ess bind-mounted from this repo** so your edits show up
locally in seconds — no Frappe Cloud deploy.

Stack pinned to match production:

| App     | Version  |
|---------|----------|
| frappe  | 15.72.3  |
| erpnext | 15.66.1  |
| hrms    | 15.47.4  |
| akg_ess | this repo (live-mounted) |

> The production site also lists a tiny `akg` (v0.0.1) scaffold app. We
> drop it from the restored site (`remove-from-installed-apps akg`) — no
> source needed. If `akg` actually holds data you care about, provide its
> source and add it to `apps.json` instead.

All paths assume the repo is at `…/AKG ESS/erpnextAKG` and the backup at
`…/AKG ESS/DB`. Run commands in **WSL** or **Git Bash** (not PowerShell)
so the bash scripts work.

---

## 0. Prerequisites (one time)

1. Install **Docker Desktop** and enable the **WSL2 backend**
   (Settings → General → "Use the WSL 2 based engine").
2. Give Docker enough resources (Settings → Resources): ≥ 4 CPU, ≥ 8 GB RAM.
3. Confirm it works: `docker run --rm hello-world`.

## 1. Build the custom image (one time, ~10–15 min)

The image bakes frappe + erpnext + hrms + akg_ess. `apps.json` (in this
folder) pins the versions.

```bash
# from anywhere
git clone https://github.com/frappe/frappe_docker
cd frappe_docker

# apps.json is passed as a BUILD SECRET (this Containerfile mounts it at
# /opt/frappe/apps.json). Do NOT use APPS_JSON_BASE64 with this file.
DOCKER_BUILDKIT=1 docker build \
  --build-arg=FRAPPE_PATH=https://github.com/frappe/frappe \
  --build-arg=FRAPPE_BRANCH=v15.72.3 \
  --build-arg=CACHE_BUST=akg-1 \
  --secret id=apps_json,src="/c/Users/Munzer/Desktop/AKG ESS/erpnextAKG/dev/apps.json" \
  --tag=akg-erpnext:local \
  --file=images/layered/Containerfile .
```

> **Correct base/Python is automatic.** This Containerfile builds FROM
> `frappe/build:v15.72.3` / `frappe/base:v15.72.3`, which already ship the
> right Python (3.11) and Node (18/20) for v15. Don't use the bleeding-edge
> `.devcontainer` image (Python 3.14 / Node 24) — it cannot run v15.

> **akg_ess is NOT baked into the image** (the repo is private, so the
> build can't clone it). The image has frappe + erpnext + hrms only;
> akg_ess is added at restore time from the bind-mounted host repo
> (`restore.sh` pip-installs it). This also means your edits are truly
> live — the running app *is* your host repo.
>
> **Verify the build worked** before starting the stack:
> ```bash
> docker run --rm --entrypoint bash akg-erpnext:local -lc 'cat sites/apps.txt'
> # must list: frappe erpnext hrms   (akg_ess is added during restore)
> ```

> **Repo access:** `Monzerdh/ERPNEXTAKG` is public, so the build clones
> akg_ess fine. If you ever make it private, pass a token or build with
> only erpnext+hrms and install akg_ess from the bind-mount.

## 2. Start the stack + create a blank site

```bash
cd "/mnt/c/Users/Munzer/Desktop/AKG ESS/erpnextAKG/dev"

# tell compose where the live akg_ess source is (repo root = parent of dev/)
export AKG_ESS_SRC="/mnt/c/Users/Munzer/Desktop/AKG ESS/erpnextAKG"

docker compose up -d
# wait ~1 min; watch the one-off site creation finish:
docker compose logs -f create-site     # Ctrl-C when it prints the site is ready
```

## 3. Restore the production backup over it

```bash
bash restore.sh
```

This copies the DB + public + private files into the container, restores,
carries the encryption key, drops the `akg` app, resets the admin
password, and migrates up to the latest akg_ess code.

Open **http://localhost:8080** → log in **Administrator / admin**.
PWA: **http://localhost:8080/ess**.

---

## The fast edit loop

**Frontend** (`.jsx`, `.css`, `data.js`, `www/ess/index.html`)
The repo is mounted into the bench and the PWA uses in-browser Babel
(no build). Just edit and refresh:

```bash
# usually nothing needed — hard-refresh the browser.
# if a change doesn't show, the service worker is serving cache:
#   DevTools → Application → Service Workers → "Update on reload" (tick once)
#   or bump the ?v=NN in www/ess/index.html
docker compose exec backend bench --site dev.localhost clear-cache   # if assets seem stale
```

**Backend** (`api.py`, `attendance.py`, hooks — pure Python)

```bash
docker compose restart backend scheduler queue-short queue-long      # ~3s
```

**Schema** (DocType JSON, fixtures, custom fields)

```bash
docker compose exec backend bench --site dev.localhost migrate
```

**Reset a test day** (so you can check in/out again)

```bash
docker compose exec backend bench --site dev.localhost execute \
  akg_ess.attendance.reset_day \
  --kwargs "{'employee':'HR-EMP-00015','date':'2026-06-17'}"
```

**Run a scheduler job on demand** (e.g. absentees / missed-checkout scan)

```bash
docker compose exec backend bench --site dev.localhost execute akg_ess.attendance.mark_absentees
docker compose exec backend bench --site dev.localhost execute akg_ess.api.scan_missed_checkouts
```

---

## Stop / start / reset

```bash
docker compose stop                 # pause (keeps data)
docker compose up -d                # resume
docker compose down                 # remove containers (keeps named volumes)
docker compose down -v              # wipe EVERYTHING (db + sites) — start clean
```

## Notes / gotchas

- **GPS / geofence**: the browser only gives real GPS over HTTPS or on
  `localhost`. `http://localhost:8080` counts as a secure context, so
  check-in works. On a phone hitting your PC's LAN IP it won't — test the
  geofence on the desktop browser (DevTools → Sensors to fake a location).
- The restored `site_config` originally pointed `host_name` at the prod
  URL; `restore.sh` resets it to `http://localhost:8080`.
- This is a clone of real data — keep it on your machine; don't expose
  port 8080 to the internet.
- First build is the only slow step. After that the edit loop is seconds.
