#!/bin/bash -l
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_HOME="${APP_HOME:-$(cd "$SCRIPT_DIR/.." && pwd)}"

cd "$APP_HOME"

if [[ -z "${DATABASE_URL:-}" && -n "${POSTGRESQL_ADDON_URI:-}" ]]; then
  export DATABASE_URL="$POSTGRESQL_ADDON_URI"
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "Missing DATABASE_URL or POSTGRESQL_ADDON_URI." >&2
  exit 1
fi

export FF_GOV_ROOT="${FF_GOV_ROOT:-./gov-snapshot}"
export FF_ACTIVE_CAMERA_BRANDS="${FF_ACTIVE_CAMERA_BRANDS:-sony,nikon}"
export FF_SYNC_ACTIVE_CAMERA_BRANDS="${FF_SYNC_ACTIVE_CAMERA_BRANDS:-1}"

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Running database migrations..."
node apps/api/src/db/migrate.js

if [[ "${FF_SYNC_ACTIVE_CAMERA_BRANDS,,}" == "1" || "${FF_SYNC_ACTIVE_CAMERA_BRANDS,,}" == "true" || "${FF_SYNC_ACTIVE_CAMERA_BRANDS,,}" == "yes" ]]; then
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Syncing active camera brands (${FF_ACTIVE_CAMERA_BRANDS})..."
  node apps/api/src/db/purge_camera_models.js --exclude-brands "$FF_ACTIVE_CAMERA_BRANDS" --confirm
fi

IFS=',' read -r -a FF_BRAND_LIST <<< "$FF_ACTIVE_CAMERA_BRANDS"
for raw_brand in "${FF_BRAND_LIST[@]}"; do
  brand="$(echo "$raw_brand" | xargs)"
  if [[ -z "$brand" ]]; then
    continue
  fi
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Importing ${brand} datasheets..."
  node apps/api/src/db/import_camera_datasheets.js --brand-slug "$brand" --confirm
done

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Pre-run complete."
