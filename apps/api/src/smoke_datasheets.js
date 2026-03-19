import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { waitForComposeDbReady } from "./compose_db.js";

function envString(name, fallback) {
  const raw = process.env[name];
  return raw && raw.trim() ? raw.trim() : fallback;
}

function utcTodayDate() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function binNpm() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function logStep(label) {
  // eslint-disable-next-line no-console
  console.log(`\n=== ${label} ===`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
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
    // Merge stderr into stdout so PowerShell doesn't render native stderr as "errors".
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

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON from ${url} but got: ${text.slice(0, 200)}`);
  }
  return { res, json };
}

async function fetchHtml(url, options = {}) {
  const res = await fetch(url, options);
  const html = await res.text();
  return { res, html };
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

  logStep("Purge Canon cameras (db:purge:cameras --confirm)");
  await run("node", ["apps/api/src/db/purge_camera_models.js", "--brand-slug", "canon", "--confirm"], {
    cwd: repoRoot,
    env: jobEnv,
    label: "db:purge:cameras",
  });

  logStep("Import Canon datasheets (db:import:datasheets --confirm)");
  await run("node", ["apps/api/src/db/import_camera_datasheets.js", "--brand-slug", "canon", "--confirm"], {
    cwd: repoRoot,
    env: jobEnv,
    label: "db:import:datasheets",
  });

  logStep("Ingest demo marketplace listings (ingest:demo-ebay)");
  await run("node", ["apps/api/src/db/ingest_demo_ebay.js"], { cwd: repoRoot, env: jobEnv, label: "ingest:demo-ebay" });

  logStep("Run matching (db:match:listings)");
  await run("node", ["apps/api/src/db/match_listings.js"], { cwd: repoRoot, env: jobEnv, label: "db:match:listings" });

  logStep("Compute price bands (db:compute:price-bands)");
  await run("node", ["apps/api/src/db/compute_price_bands.js"], { cwd: repoRoot, env: jobEnv, label: "db:compute:price-bands" });

  logStep("Compute deal scores (db:compute:deal-scores)");
  await run("node", ["apps/api/src/db/compute_deal_scores.js", "--confirm"], {
    cwd: repoRoot,
    env: jobEnv,
    label: "db:compute:deal-scores",
  });

  logStep("Start API in-process + smoke requests");
  process.env.DATABASE_URL = databaseUrl;
  process.env.FF_ADMIN_TOKEN = adminToken;

  const { createApiServer } = await import("./server.js");
  const { server } = createApiServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  assert(port, "failed to bind test port");
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    {
      const { res, json } = await fetchJson(`${baseUrl}/health`);
      assert(res.status === 200, `/health expected 200, got ${res.status}`);
      assert(json.ok === true, "/health ok=true");
      assert(json.db_enabled === true, "/health db_enabled=true");
    }

    {
      const { res, json } = await fetchJson(`${baseUrl}/api/v1/status/freshness`);
      assert(res.status === 200, `/api/v1/status/freshness expected 200, got ${res.status}`);
      assert(json.ok === true, "/api/v1/status/freshness ok=true");
      assert(typeof json.status === "object" && json.status !== null, "expected freshness status object");
      assert(typeof json.status.batch_refresh === "object" && json.status.batch_refresh !== null, "expected batch_refresh object");
      assert(typeof json.status.batch_refresh.max_age_hours === "number", "expected max_age_hours number");
    }

    {
      const { res, json } = await fetchJson(`${baseUrl}/api/v1/cameras?brand=canon&limit=3`);
      assert(res.status === 200, `/api/v1/cameras?brand=canon expected 200, got ${res.status}`);
      assert(json.ok === true, "/api/v1/cameras ok=true");
      assert(Array.isArray(json.cameras), "/api/v1/cameras cameras is array");
      assert(json.cameras.length >= 1, "expected at least 1 canon camera");
    }

    {
      const { res, html } = await fetchHtml(`${baseUrl}/cameras/canon-eos-r5`);
      assert(res.status === 200, `/cameras/canon-eos-r5 expected 200, got ${res.status}`);
      assert(/Canon EOS R5/i.test(html), "expected camera page to contain Canon EOS R5");
      assert(/<h2>Specs<\/h2>/i.test(html), "expected camera page to render Specs section");
      assert(/Typical used price/i.test(html), "expected camera page to render price band card");
      assert(/<h2>Listings<\/h2>/i.test(html), "expected camera page to render Listings section");
    }

    {
      const { res, html } = await fetchHtml(`${baseUrl}/compare/canon-eos-r5-vs-canon-eos-r6`);
      assert(res.status === 200, `/compare/canon-eos-r5-vs-canon-eos-r6 expected 200, got ${res.status}`);
      assert(/Canon EOS R5/i.test(html), "expected compare page to contain Canon EOS R5");
      assert(/Canon EOS R6/i.test(html), "expected compare page to contain Canon EOS R6");
    }

    let listingId;
    {
      const { res, json } = await fetchJson(`${baseUrl}/api/v1/listings?camera_slug=canon-eos-r5&limit=1`);
      assert(res.status === 200, `/api/v1/listings?camera_slug=canon-eos-r5 expected 200, got ${res.status}`);
      assert(json.ok === true, "/api/v1/listings ok=true");
      assert(Array.isArray(json.listings), "/api/v1/listings listings is array");
      const l = json.listings[0] || null;
      assert(l && l.listing_id, "expected at least 1 matched listing for canon-eos-r5");
      listingId = l.listing_id;
    }

    {
      const res = await fetch(`${baseUrl}/go/listings/${encodeURIComponent(listingId)}`, { redirect: "manual" });
      assert(res.status === 302, `/go/listings redirect expected 302, got ${res.status}`);
      const loc = res.headers.get("location") || "";
      assert(/^https?:\/\//i.test(loc), "expected redirect Location to be an absolute URL");
    }

    // eslint-disable-next-line no-console
    console.log("\nSMOKE DATASHEETS OK");
    // eslint-disable-next-line no-console
    console.log("- database_url:", databaseUrl);
    // eslint-disable-next-line no-console
    console.log("- price_bands_date_utc:", observedDate);
    // eslint-disable-next-line no-console
    console.log("\nNext (optional):");
    // eslint-disable-next-line no-console
    console.log("- Browse the site: npm.cmd run dev:api");
    // eslint-disable-next-line no-console
    console.log("- Open homepage: http://127.0.0.1:8787/");
    // eslint-disable-next-line no-console
    console.log("- Example model page: http://127.0.0.1:8787/cameras/canon-eos-r5");
    // eslint-disable-next-line no-console
    console.log("- Stop DB later (optional): docker compose down");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("\nSMOKE DATASHEETS FAILED:");
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
