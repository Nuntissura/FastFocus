# Fast Focus Platform (Product Code)

This folder contains the product/website/backend code for Fast Focus (Phase 1+).

## Canonical governance (do not duplicate)
- Execution instructions come from root `AGENTS.md`; this file is the product-implementation guide only.
- Spec pointer: `FF - gov/SPEC_CURRENT.md`
- Master plan `.docx`: `FF - gov/spec/`
- Phase 1 data contract (schemas + Postgres schema): `FF - gov/data_contracts/`
- Workflow + invariants: `FF - gov/FAST_FOCUS_CODEX.md`
- Task tracking: `FF - gov/workflow/task_board.md`
- Content templates: `FF - gov/workflow/templates/`
- Data sheet content tree: `FF - gov/catalog/data_sheets/`

## Disk-agnostic rule (HARD)
Do not commit drive-letter paths (like `C:\` / `P:\`) into code, configs, or docs.
Use repo-relative paths and environment variables.

## What exists right now
- `apps/api/` - Node.js SSR + API app with Postgres wiring, marketplace ingest/matching scripts, price-band + deal-score jobs, consent-aware analytics, admin endpoints, and smoke tests

## Current launch surface
- Public launch pages: `/`, `/cameras`, `/brands`, `/compare`, `/cameras/{slug}`, `/compare/{slugA}-vs-{slugB}`
- Parked but still implemented: `/lenses`, `/guides`, `/newsletter`, `/premium`
- Parked surfaces are not part of the launch nav/`llms.txt`/sitemap contract and send `noindex,follow`

## Beginner-first deploy/env guide
- If you are new to web hosting or environment variables, read `FF - gov/runbooks/EU_PAAS_DEPLOYMENT_AND_ENV.md` before touching staging/production settings.

## Content workflow for new models
- Start from `FF - gov/workflow/templates/digital_camera_datasheet.v5.yaml`
- Add each camera model under `FF - gov/catalog/data_sheets/<brand_slug>/<model_slug>/datasheet.yaml`
- Add model media under the corresponding `images/` folder
- Run `FF - gov/catalog/scripts/validate_datasheet_templates.ps1` before handoff
- Keep this tree aligned with `FF - gov/FAST_FOCUS_CODEX.md` so every model page follows the same schema and structure

## Quickstart (recommended)
One command to start Postgres, apply schema, ingest demo listings, and run the site:

```powershell
npm.cmd run dev:demo
```

If port `55432` is already in use on your machine:
```powershell
$env:FF_PG_PORT = "55434"
npm.cmd run dev:demo
```

Remember this:
- `55432` is the default local Postgres port for Fast Focus.
- If that port is busy, reuse `55434` as the fallback local port.
- If you set `FF_PG_PORT`, use that same port everywhere else in the same shell session, especially in `DATABASE_URL`, smoke runs, and manual `docker compose` checks.

Deployment notes: `DEPLOY.md`

### Clever Cloud (low-cost production path)

For the current cheapest sensible production setup on Clever Cloud:
- use one Node app in Paris,
- use one paid PostgreSQL add-on,
- defer staging until production is verified.

Before deploying from this repo, refresh the in-repo governance runtime snapshot:

```powershell
npm.cmd run gov:snapshot
```

This populates `gov-snapshot/`, which production can reference with:

```powershell
$env:FF_GOV_ROOT = "./gov-snapshot"
$env:HOST = "0.0.0.0"
$env:PORT = "8080"
```

The Clever-specific wrappers live in:
- `bin/start.sh`
- `bin/pre-run.sh`
- `bin/daily-refresh.sh`
- `clevercloud/cron.json`

Optional (legacy): also seed the catalog with JSON seed files:
```powershell
$env:FF_DEMO_SEED_CATALOG = "1"
npm.cmd run dev:demo
```

Then open:
- http://127.0.0.1:8787/

## Run the API (no dependencies)
From this folder:
```powershell
node apps/api/src/server.js
```

Health check:
```powershell
irm http://127.0.0.1:8787/health
```

Public ops freshness summary:
```powershell
irm http://127.0.0.1:8787/api/v1/status/freshness
```

## Local Postgres (Phase 1)
Start DB:
```powershell
docker compose up -d db
```

Set `DATABASE_URL` for your shell session:
```powershell
$env:DATABASE_URL = \"postgres://fastfocus:fastfocus@127.0.0.1:55432/fastfocus\"
```

If you changed `FF_PG_PORT`, use that same port in `DATABASE_URL`.

Install deps + apply schema + seed catalog:
```powershell
npm.cmd install
npm.cmd run db:migrate
$env:FF_ALLOW_CATALOG_SEED = "1"  # legacy seed runner is opt-in
npm.cmd run db:seed:catalog
```

Delete existing camera models (start fresh):
```powershell
# dry-run:
npm.cmd run db:purge:cameras -- --brand-slug canon

# apply:
npm.cmd run db:purge:cameras -- --confirm
```

Import camera datasheets into Postgres (datasheet-first workflow):
```powershell
# dry-run (scans datasheets, reports readiness):
npm.cmd run db:import:datasheets -- --brand-slug canon

# apply (upserts import-ready datasheets):
npm.cmd run db:import:datasheets -- --brand-slug canon --confirm
```

Seed selection (optional):
- Default seed files:
  - `FF - gov/data_contracts/seeds/phase1_catalog_v1.json`
  - `FF - gov/data_contracts/seeds/canon_eos_digital_v1.json`
- Override with:
  - `FF_CATALOG_SEED_PATH` (single JSON seed file), or
  - `FF_CATALOG_SEED_PATHS` (multiple seed files, separated by `,` or `;`)

Ingest demo marketplace listings + run matching (so model pages can show listings):
```powershell
npm.cmd run ingest:demo-ebay
npm.cmd run db:match:listings
```

Try DB-backed endpoints:
```powershell
irm http://127.0.0.1:8787/api/v1/brands
irm http://127.0.0.1:8787/api/v1/cameras
irm http://127.0.0.1:8787/api/v1/listings
irm http://127.0.0.1:8787/api/v1/marketplaces
```

Model pages (HTML, server-rendered):
```powershell
# open in a browser, or fetch via iwr/irm
irm http://127.0.0.1:8787/cameras/sony-a7-iv
# parked surface (still implemented, not launch-critical)
irm http://127.0.0.1:8787/lenses/sony-fe-24-70mm-f2-8-gm-ii
``` 

Affiliate params for outbound eBay click-outs (optional):
```powershell
$env:FF_AFFILIATE_EBAY_PARAMS = \"campid=YOUR_ID&customid=ff_{listing_id}\"
```

Admin endpoints (requires admin token):
```powershell
$env:FF_ADMIN_TOKEN = \"dev-admin\"
irm -Headers @{\"x-admin-token\"=$env:FF_ADMIN_TOKEN} http://127.0.0.1:8787/api/v1/admin/ingestion/runs
irm -Headers @{\"x-admin-token\"=$env:FF_ADMIN_TOKEN} http://127.0.0.1:8787/api/v1/admin/audit-log
irm -Headers @{\"x-admin-token\"=$env:FF_ADMIN_TOKEN} http://127.0.0.1:8787/api/v1/admin/analytics/demand
```

## Staging/production config (URLs, proxies, robots)
Set these env vars in staging/prod:

```powershell
# used for canonical URLs, sitemap/robots host, and confirmation links in emails
$env:FF_PUBLIC_BASE_URL = "https://fastfocus.camera"

# default staging host convention
# $env:FF_PUBLIC_BASE_URL = "https://staging.fastfocus.camera"

# if you run behind a reverse proxy that sets X-Forwarded-Proto/Host
$env:FF_TRUST_PROXY = "1"

# if the deployed repo contains an in-repo governance snapshot
# (used by the current Clever Cloud path)
$env:FF_GOV_ROOT = "./gov-snapshot"

# Clever Cloud Node apps must listen on all interfaces.
$env:HOST = "0.0.0.0"

# optional: add per-bot disallow blocks in robots.txt (comma-separated)
$env:FF_ROBOTS_DISALLOW_USER_AGENTS = "GPTBot,Google-Extended"
```

## One-command smoke test (local)
Runs: docker db up -> migrate -> seed -> demo ingest -> match -> compute price bands -> API smoke requests.

```powershell
npm.cmd run smoke
```

## One-command smoke test (datasheet-first)
Runs: docker db up -> migrate -> import Canon datasheets -> demo ingest -> match -> compute price bands -> compute deal scores -> API/SSR smoke requests.

```powershell
npm.cmd run smoke:datasheets
```

## Daily refresh job (batch-first)
Dry-run (prints planned steps only):
```powershell
npm.cmd run jobs:daily-refresh
```

Execute:
```powershell
npm.cmd run jobs:daily-refresh -- --confirm
```
