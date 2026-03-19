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

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Running database migrations..."
node apps/api/src/db/migrate.js

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Importing Canon datasheets..."
node apps/api/src/db/import_camera_datasheets.js --brand-slug canon --confirm

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Pre-run complete."
