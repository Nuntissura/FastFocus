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

export HOST="${HOST:-0.0.0.0}"
export PORT="${PORT:-8080}"
export FF_GOV_ROOT="${FF_GOV_ROOT:-./gov-snapshot}"

exec node apps/api/src/server.js
