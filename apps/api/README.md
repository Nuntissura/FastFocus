# Fast Focus API (Phase 1 skeleton)

Execution behavior and workspace rules are defined in root `AGENTS.md`.
Governance/process references are in `FF - gov/FAST_FOCUS_CODEX.md` and `FF - gov/START_HERE.md`.

This is a minimal backend skeleton that exposes:
- health endpoint
- Phase 1 contract endpoints (schemas + Postgres schema)

No external dependencies are used yet (runs with plain Node.js).

## Run
From `FF - worktrees/fastfocus_platform/`:
```powershell
node apps/api/src/server.js
```

## Key endpoints
- `GET /health`
- `GET /api/v1/contracts`
- `GET /api/v1/contracts/schemas`
- `GET /api/v1/contracts/schemas/<schema-file>`
- `GET /api/v1/contracts/postgres_schema.sql`
- `GET /api/v1/spec/current`
- `GET /api/v1/brands` (requires DB)
- `GET /api/v1/cameras` (requires DB)
- `GET /api/v1/cameras/<slug>` (requires DB)
- `GET /api/v1/listings` (requires DB)

## Configuration (optional)
- `PORT` (default: 8787)
- `HOST` (default: 127.0.0.1)
- `DATABASE_URL` (required for DB endpoints): `postgres://user:pass@host:5432/dbname`
- `FF_ADMIN_TOKEN` (required for admin endpoints): send as `x-admin-token` header
- `FF_WORKSPACE_ROOT` (optional): workspace root folder that contains `FF - gov/` and `FF - worktrees/`
- `FF_GOV_ROOT` (optional): path to `FF - gov/` (overrides `FF_WORKSPACE_ROOT`)

Disk-agnostic note: avoid drive-letter paths in committed config; these env vars exist to support different local folder layouts.

## Local Postgres quickstart (recommended)
From `FF - worktrees/fastfocus_platform/`:
```powershell
docker compose up -d db
$env:DATABASE_URL = \"postgres://fastfocus:fastfocus@127.0.0.1:55432/fastfocus\"
npm.cmd install
npm.cmd run db:migrate
npm.cmd run db:seed:demo
node apps/api/src/server.js
```

Admin endpoints (require `FF_ADMIN_TOKEN`):
- `GET /api/v1/admin/ingestion/runs`
- `GET /api/v1/admin/audit-log`
