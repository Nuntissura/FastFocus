#!/bin/bash -l
set -euo pipefail

if [[ -n "${INSTANCE_NUMBER:-}" && "${INSTANCE_NUMBER}" != "0" ]]; then
  echo "Instance number is ${INSTANCE_NUMBER}. Skipping cron."
  exit 0
fi

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

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Starting daily refresh..."
node apps/api/src/db/run_daily_refresh.js --confirm
echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Daily refresh complete."
