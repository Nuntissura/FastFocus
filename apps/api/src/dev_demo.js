import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { waitForComposeDbReady } from "./compose_db.js";

function envString(name, fallback) {
  const raw = process.env[name];
  return raw && raw.trim() ? raw.trim() : fallback;
}

function envBool(name, fallback = false) {
  const raw = envString(name, "");
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

function utcTodayDate() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function logStep(label) {
  // eslint-disable-next-line no-console
  console.log(`\n=== ${label} ===`);
}

function binNpm() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function run(cmd, args, { cwd, env, label } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    child.stdout.on("data", (chunk) => process.stdout.write(chunk));
    child.stderr.on("data", (chunk) => process.stdout.write(chunk));
    child.on("error", (err) => reject(err));
    child.on("exit", (code) => {
      if (code === 0) return resolve();
      const what = label ? `${label} (${cmd} ${args.join(" ")})` : `${cmd} ${args.join(" ")}`;
      reject(new Error(`${what} failed with exit code ${code}`));
    });
  });
}

async function ensureDependenciesInstalled(repoRoot) {
  const pgPkg = path.resolve(repoRoot, "node_modules", "pg", "package.json");
  try {
    await fs.access(pgPkg);
    return;
  } catch {
    // fall through
  }

  logStep("Install dependencies (npm install)");
  await run(binNpm(), ["install"], { cwd: repoRoot, env: process.env, label: "npm install" });
}

async function main() {
  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = path.dirname(thisFile);
  const repoRoot = path.resolve(thisDir, "..", "..", "..");

  const pgPort = envString("FF_PG_PORT", "55432");
  const defaultDatabaseUrl = `postgres://fastfocus:fastfocus@127.0.0.1:${pgPort}/fastfocus`;
  const databaseUrl = envString("DATABASE_URL", defaultDatabaseUrl);
  const adminToken = envString("FF_ADMIN_TOKEN", "dev-admin");
  const observedDate = envString("FF_PRICE_BANDS_DATE", utcTodayDate());
  const seedCatalog = envBool("FF_DEMO_SEED_CATALOG", false);

  await ensureDependenciesInstalled(repoRoot);

  logStep("Start Postgres (docker compose up -d db)");
  await run("docker", ["compose", "up", "-d", "db"], { cwd: repoRoot, env: process.env, label: "docker compose" });
  await waitForComposeDbReady({ repoRoot, env: process.env });

  const jobEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    FF_PRICE_BANDS_DATE: observedDate,
  };

  logStep("Apply schema (db:migrate)");
  await run("node", ["apps/api/src/db/migrate.js"], { cwd: repoRoot, env: jobEnv, label: "db:migrate" });

  if (seedCatalog) {
    logStep("Seed catalog (legacy; db:seed:catalog)");
    await run("node", ["apps/api/src/db/seed_catalog.js"], {
      cwd: repoRoot,
      env: { ...jobEnv, FF_ALLOW_CATALOG_SEED: "1" },
      label: "db:seed:catalog",
    });
  } else {
    logStep("Skip catalog seed (datasheet-first)");
    // eslint-disable-next-line no-console
    console.log("- Set FF_DEMO_SEED_CATALOG=1 to run legacy seeds.");
  }

  logStep("Ingest demo marketplace listings (ingest:demo-ebay)");
  await run("node", ["apps/api/src/db/ingest_demo_ebay.js"], { cwd: repoRoot, env: jobEnv, label: "ingest:demo-ebay" });

  logStep("Run matching (db:match:listings)");
  await run("node", ["apps/api/src/db/match_listings.js"], { cwd: repoRoot, env: jobEnv, label: "db:match:listings" });

  logStep("Compute price bands (db:compute:price-bands)");
  await run("node", ["apps/api/src/db/compute_price_bands.js"], { cwd: repoRoot, env: jobEnv, label: "db:compute:price-bands" });

  logStep("Compute deal scores (db:compute:deal-scores)");
  await run("node", ["apps/api/src/db/compute_deal_scores.js", "--confirm"], { cwd: repoRoot, env: jobEnv, label: "db:compute:deal-scores" });

  logStep("Start API (dev:api)");
  // eslint-disable-next-line no-console
  console.log("- Open homepage: http://127.0.0.1:8787/");
  if (seedCatalog) {
    // eslint-disable-next-line no-console
    console.log("- Example model page: http://127.0.0.1:8787/cameras/sony-a7-iv");
  } else {
    // eslint-disable-next-line no-console
    console.log("- No camera catalog loaded yet (datasheet-first). Enable seeds with FF_DEMO_SEED_CATALOG=1.");
  }
  // eslint-disable-next-line no-console
  console.log("- Stop later: Ctrl+C (API) then `docker compose down` (DB)");

  const apiEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    FF_ADMIN_TOKEN: adminToken,
  };

  const child = spawn("node", ["apps/api/src/server.js"], { cwd: repoRoot, env: apiEnv, stdio: "inherit", shell: false });
  child.on("exit", (code) => {
    process.exitCode = typeof code === "number" ? code : 0;
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("\nDEMO START FAILED:");
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
