# Build from the workspace root (so `FF - gov/` is available in the build context):
#   docker build -f "FF - worktrees/fastfocus_platform/Dockerfile" -t fastfocus-platform:latest .

FROM node:24-alpine AS deps
WORKDIR /opt/ff/app

COPY ["FF - worktrees/fastfocus_platform/package.json", "FF - worktrees/fastfocus_platform/package-lock.json", "./"]
RUN npm ci --omit=dev

FROM node:24-alpine
WORKDIR /opt/ff/app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8787

# Point runtime to the bundled governance snapshot (no drive-letter paths).
ENV FF_GOV_ROOT=/opt/ff/gov

COPY --from=deps /opt/ff/app/node_modules ./node_modules

COPY ["FF - worktrees/fastfocus_platform/package.json", "./"]
COPY ["FF - worktrees/fastfocus_platform/apps", "./apps"]

# Bundle the minimal gov artifacts required at runtime (contracts, template, datasheets, spec pointer).
COPY ["FF - gov/SPEC_CURRENT.md", "/opt/ff/gov/SPEC_CURRENT.md"]
COPY ["FF - gov/data_contracts", "/opt/ff/gov/data_contracts"]
COPY ["FF - gov/workflow/templates", "/opt/ff/gov/workflow/templates"]
COPY ["FF - gov/catalog/data_sheets", "/opt/ff/gov/catalog/data_sheets"]

EXPOSE 8787
CMD ["node", "apps/api/src/server.js"]

