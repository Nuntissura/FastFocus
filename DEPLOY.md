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

Example: Canon only

```powershell
docker run --rm `
  -e DATABASE_URL="postgres://..." `
  fastfocus-platform:latest `
  node apps/api/src/db/import_camera_datasheets.js --brand-slug canon --confirm
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
- `GET /`
- `GET /cameras/canon-eos-r5` (after import)
- `GET /compare/canon-eos-r5-vs-canon-eos-r6` (after import)

