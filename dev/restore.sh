#!/usr/bin/env bash
# Restore the Frappe Cloud backup into the local Docker site, then bring it
# up to the latest akg_ess code. Run from the repo's dev/ folder AFTER the
# compose stack is up (see RUNBOOK.md). Re-runnable.
#
# Usage:  bash restore.sh
set -euo pipefail

# Git Bash on Windows rewrites in-container paths like /tmp/db.sql.gz into
# C:/Users/.../Temp/... before they reach docker. Disable that conversion.
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

SITE="${SITE:-dev.localhost}"
BACKEND="${BACKEND:-backend}"            # backend service name in docker-compose.yml
# Backup files live in ../../DB relative to this script (AKG ESS/DB).
DB_DIR="${DB_DIR:-$(cd "$(dirname "$0")/../../DB" && pwd)}"

DB_GZ="$(ls "$DB_DIR"/*-database.sql.gz | head -1)"
PUB="$(ls "$DB_DIR"/*-files.tar | grep -v private | head -1)"
PRIV="$(ls "$DB_DIR"/*-private-files.tar | head -1)"
CFG="$(ls "$DB_DIR"/*-site_config_backup.json | head -1)"

# Pull the production encryption key out of the backup config so restored
# encrypted fields (passwords, API keys) decrypt. The key stays on your
# machine — it is never committed.
ENC_KEY="$(grep -oE '"encryption_key"[^,]*' "$CFG" | sed -E 's/.*:\s*"([^"]+)".*/\1/')"

echo "Site:    $SITE"
echo "DB:      $DB_GZ"
echo "Public:  $PUB"
echo "Private: $PRIV"

# 1. Copy the backups into the backend container.
docker compose cp "$DB_GZ" "$BACKEND:/tmp/db.sql.gz"
docker compose cp "$PUB"   "$BACKEND:/tmp/files.tar"
docker compose cp "$PRIV"  "$BACKEND:/tmp/private-files.tar"

# 2. Restore (force overwrites the freshly-created blank site).
docker compose exec "$BACKEND" bench --site "$SITE" --force restore \
  /tmp/db.sql.gz \
  --with-public-files /tmp/files.tar \
  --with-private-files /tmp/private-files.tar \
  --db-root-password admin

# 3. Carry the encryption key + point host_name at localhost.
if [ -n "$ENC_KEY" ]; then
  docker compose exec "$BACKEND" bench --site "$SITE" set-config encryption_key "$ENC_KEY"
fi
docker compose exec "$BACKEND" bench --site "$SITE" set-config host_name "http://localhost:8080"

# 4. The production 'akg' (v0.0.1) scaffold app isn't in this bench — drop
#    its installed-apps row so migrate/build don't choke on it.
docker compose exec "$BACKEND" bench --site "$SITE" remove-from-installed-apps akg || true

# 5. Reset the Administrator password for local login.
docker compose exec "$BACKEND" bench --site "$SITE" set-admin-password admin

# 5b. akg_ess is NOT baked into the image (private repo) — it's bind-mounted
#     from your host at apps/akg_ess. Register + pip-install it so its hooks
#     load and migrations run. The restored DB already lists it as installed.
docker compose exec "$BACKEND" bash -lc '
  cd /home/frappe/frappe-bench;
  # Rebuild apps.txt safely (no trailing-newline mishaps), then pip-install.
  { grep -vxF akg_ess sites/apps.txt; echo akg_ess; } | sed "/^$/d" > sites/apps.txt.new && mv sites/apps.txt.new sites/apps.txt;
  ./env/bin/pip install -e apps/akg_ess -q;
'

# 6. Migrate the restored DB up to the bench's (latest) akg_ess code,
#    then publish the PWA assets.
docker compose exec "$BACKEND" bench --site "$SITE" migrate
docker compose exec "$BACKEND" bench build --app akg_ess || true

# 7. Local dev niceties.
docker compose exec "$BACKEND" bench --site "$SITE" set-config developer_mode 1
docker compose exec "$BACKEND" bench --site "$SITE" clear-cache

echo
echo "Done. Open http://localhost:8080   (Administrator / admin)"
echo "PWA:  http://localhost:8080/ess"
