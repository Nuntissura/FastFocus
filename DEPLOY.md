# Deploy notes (staging + production)

This repo expects governance artifacts from `FF - gov/` at runtime (contracts, datasheets, template). The `Dockerfile` bundles the minimal required `FF - gov/` paths into the image and sets `FF_GOV_ROOT`.

## Build container image (from workspace root)

Run from the workspace root (the folder that contains both `FF - gov/` and `FF - worktrees/`):

```powershell
docker build -f "FF - worktrees/fastfocus_platform/Dockerfile" -t fastfocus-platform:latest .
```

## Required environment variables

- `DATABASE_URL` (staging/prod; separate DBs)
- `FF_ADMIN_TOKEN` (staging/prod; separate tokens)
- `FF_PUBLIC_BASE_URL` (staging/prod; correct canonical host + email links)
- `FF_TRUST_PROXY=1` (recommended when behind a reverse proxy that sets `X-Forwarded-Proto/Host`)

Optional:
- `FF_ROBOTS_DISALLOW_USER_AGENTS` (comma-separated) to add bot-specific disallow blocks to `robots.txt`
- `FF_BLOCK_TRAINING_BOTS=1` to actively block “training” bots at the HTTP layer (in addition to robots)

## Migrate schema (one-time per environment / per release)

```powershell
docker run --rm `
  -e DATABASE_URL="postgres://..." `
  fastfocus-platform:latest `
  node apps/api/src/db/migrate.js
```

## Import datasheets (one-time bootstrap, repeat as needed)

Example: active Sony launch wave

```powershell
docker run --rm `
  -e DATABASE_URL="postgres://..." `
  fastfocus-platform:latest `
  node apps/api/src/db/import_camera_datasheets.js --brand-slug sony --confirm
```

## Start the web service

```powershell
docker run --rm -p 8787:8787 `
  -e DATABASE_URL="postgres://..." `
  -e FF_ADMIN_TOKEN="..." `
  -e FF_PUBLIC_BASE_URL="https://example.com" `
  -e FF_TRUST_PROXY="1" `
  fastfocus-platform:latest
```

Verify:
- `GET /health` (expects HTTP 200 and `db_ok=true`)
- `GET /api/v1/status/freshness` (public batch-refresh freshness summary for external monitors)
- `GET /`
- `GET /cameras/sony-a7-iv` (after import)
- `GET /compare/sony-a7-iv-vs-sony-a7-c-ii` (after import)

## Clever Cloud Node runtime (lowest-cost current path)

For Clever Cloud, use the Node runtime rather than the Docker runtime.

Why:
- the current Dockerfile expects the workspace root as build context so it can see `FF - gov/`,
- Clever Cloud cron is available for Node apps, but not for Docker apps,
- the low-cost production path is one Node app + one managed Postgres add-on.

Prep the deployable repo snapshot locally:

```powershell
npm.cmd run gov:snapshot
```

This creates `gov-snapshot/` inside the product repo so the deployed app can set:

```powershell
$env:FF_GOV_ROOT = "./gov-snapshot"
```

Recommended Clever Cloud settings:
- `CC_RUN_COMMAND=$ROOT/bin/start.sh`
- `CC_PRE_RUN_HOOK=$ROOT/bin/pre-run.sh`
- `CC_HEALTH_CHECK_PATH=/health`
- `CC_NODE_VERSION=24`
- `CC_NODE_BUILD_TOOL=npm-ci`

Recommended app env:
- `FF_PUBLIC_BASE_URL=https://fastfocus.camera`
- `FF_TRUST_PROXY=1`
- `FF_COOKIE_SECURE=1`
- `FF_GOV_ROOT=./gov-snapshot`
- `FF_ACTIVE_CAMERA_BRANDS=sony`
- `FF_SYNC_ACTIVE_CAMERA_BRANDS=1`
- `HOST=0.0.0.0`

Why `FF_SYNC_ACTIVE_CAMERA_BRANDS=1` matters:
- deploy/startup should converge the DB to the current active camera wave
- without it, old camera brands can linger in Postgres even after governance resets the live catalog
- that drift makes production surfaces look stale or misleading even when the in-repo catalog has moved on

Scheduler:
- `clevercloud/cron.json` runs `$ROOT/bin/daily-refresh.sh` once per day.
- Keep third-party ingest toggles off until the corresponding credentials are set in production.
