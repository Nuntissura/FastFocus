import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { waitForComposeDbReady } from "./compose_db.js";

const { Client } = pg;

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

async function main() {
  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = path.dirname(thisFile);
  const repoRoot = path.resolve(thisDir, "..", "..", "..");

  const pgPort = envString("FF_PG_PORT", "55432");
  const defaultDatabaseUrl = `postgres://fastfocus:fastfocus@127.0.0.1:${pgPort}/fastfocus`;
  const databaseUrl = envString("DATABASE_URL", defaultDatabaseUrl);
  const adminToken = envString("FF_ADMIN_TOKEN", "dev-admin");
  const observedDate = envString("FF_PRICE_BANDS_DATE", utcTodayDate());

  const retailerMarketplaceCode = "retailer_feed_1";
  const retailerMarketplaceName = "Retailer Feed #1 (sample)";
  const retailerFeedPath = path.resolve(repoRoot, "apps/api/test/fixtures/feeds/retailer_feed_1.csv");
  const retailerAffiliateEnv = `FF_AFFILIATE_${retailerMarketplaceCode.toUpperCase()}_PARAMS`;
  const retailerAffiliateParams = "aff_id=smoke&lid={listing_id}";

  await ensureDependenciesInstalled(repoRoot);

  logStep("Start Postgres (docker compose up -d db)");
  await run("docker", ["compose", "up", "-d", "db"], { cwd: repoRoot, env: process.env, label: "docker compose" });
  await waitForComposeDbReady({ repoRoot, env: process.env });

  const jobEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    FF_PRICE_BANDS_DATE: observedDate,
    FF_ALLOW_CATALOG_SEED: "1",
    FF_RETAILER_FEED_PATH: retailerFeedPath,
    FF_RETAILER_FEED_MARKETPLACE_CODE: retailerMarketplaceCode,
    FF_RETAILER_FEED_MARKETPLACE_NAME: retailerMarketplaceName,
    FF_RETAILER_FEED_JOB_NAME: "ingest_retailer_feed_1_sample",
    [retailerAffiliateEnv]: retailerAffiliateParams,
  };

  logStep("Apply schema (db:migrate)");
  await run("node", ["apps/api/src/db/migrate.js"], { cwd: repoRoot, env: jobEnv, label: "db:migrate" });

  logStep("Seed catalog (db:seed:catalog)");
  await run("node", ["apps/api/src/db/seed_catalog.js"], { cwd: repoRoot, env: jobEnv, label: "db:seed:catalog" });

  logStep("Ingest demo marketplace listings (ingest:demo-ebay)");
  await run("node", ["apps/api/src/db/ingest_demo_ebay.js"], { cwd: repoRoot, env: jobEnv, label: "ingest:demo-ebay" });

  logStep("Ingest retailer feed #1 (ingest:retailer-feed-1)");
  await run("node", ["apps/api/src/db/ingest_retailer_feed_1.js"], {
    cwd: repoRoot,
    env: jobEnv,
    label: "ingest:retailer-feed-1",
  });

  logStep("Run matching (db:match:listings)");
  await run("node", ["apps/api/src/db/match_listings.js"], { cwd: repoRoot, env: jobEnv, label: "db:match:listings" });

  logStep("Compute price bands (db:compute:price-bands)");
  await run("node", ["apps/api/src/db/compute_price_bands.js"], { cwd: repoRoot, env: jobEnv, label: "db:compute:price-bands" });

  logStep("Compute deal scores (db:compute:deal-scores)");
  await run("node", ["apps/api/src/db/compute_deal_scores.js", "--confirm"], { cwd: repoRoot, env: jobEnv, label: "db:compute:deal-scores" });

  logStep("Start API in-process + smoke requests");
  process.env.DATABASE_URL = databaseUrl;
  process.env.FF_ADMIN_TOKEN = adminToken;
  process.env[retailerAffiliateEnv] = `aff_id=env_smoke&lid={listing_id}`;

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
      const { res, json } = await fetchJson(`${baseUrl}/api/v1/contracts`);
      assert(res.status === 200, `/api/v1/contracts expected 200, got ${res.status}`);
      assert(json.ok === true, "/api/v1/contracts ok=true");
      assert(Array.isArray(json.schemas), "/api/v1/contracts schemas is array");
    }

    {
      const { res, json } = await fetchJson(`${baseUrl}/api/v1/marketplaces`);
      assert(res.status === 200, `/api/v1/marketplaces expected 200, got ${res.status}`);
      assert(json.ok === true, "/api/v1/marketplaces ok=true");
      assert(Array.isArray(json.marketplaces), "/api/v1/marketplaces marketplaces is array");

      const retailer = json.marketplaces.find((m) => m.marketplace_code === retailerMarketplaceCode) || null;
      assert(retailer, `expected marketplace ${retailerMarketplaceCode}`);
      assert(retailer.affiliate_supported === true, "expected retailer affiliate_supported=true");
      assert(Number(retailer.active_listing_count || 0) >= 1, "expected retailer active_listing_count >= 1");
    }

    let retailerListingId;
    let retailerModelPath;
    {
      const { res, json } = await fetchJson(
        `${baseUrl}/api/v1/listings?marketplace=${encodeURIComponent(retailerMarketplaceCode)}&limit=1`,
      );
      assert(res.status === 200, `retailer /api/v1/listings expected 200, got ${res.status}`);
      assert(json.ok === true, "retailer /api/v1/listings ok=true");
      assert(Array.isArray(json.listings), "retailer /api/v1/listings listings is array");
      const l = json.listings[0] || null;
      assert(l && l.listing_id, "expected at least 1 retailer listing to test click-out");
      retailerListingId = l.listing_id;
      assert(l.marketplace_display_name, "expected marketplace_display_name on retailer listing");
      retailerModelPath = l.camera_slug ? `/cameras/${encodeURIComponent(l.camera_slug)}` : l.lens_slug ? `/lenses/${encodeURIComponent(l.lens_slug)}` : null;
      assert(retailerModelPath, "expected retailer listing to be matched to a camera or lens model");
    }

    {
      const client = new Client({ connectionString: databaseUrl });
      await client.connect();
      try {
        await client.query(
          `
          UPDATE marketplaces
          SET
            partner_status = 'active',
            partner_kind = 'retailer',
            affiliate_params_template = $2,
            is_sponsored = TRUE,
            sponsored_rank = 900,
            sponsored_label = 'Sponsor (paid)'
          WHERE marketplace_code = $1
          `,
          [retailerMarketplaceCode, retailerAffiliateParams],
        );
      } finally {
        await client.end();
      }
    }

    {
      const res = await fetch(
        `${baseUrl}/go/listings/${encodeURIComponent(retailerListingId)}?page_type=other&utm_source=smoke&utm_medium=smoke`,
        { redirect: "manual" },
      );
      assert(res.status === 302, `retailer /go/listings redirect expected 302, got ${res.status}`);
      const loc = res.headers.get("location") || "";
      assert(/aff_id=smoke/i.test(loc), "expected affiliate params on retailer redirect");
      assert(!/aff_id=env_smoke/i.test(loc), "expected DB affiliate params to override env");
      assert(/lid=/i.test(loc), "expected listing id interpolation on retailer redirect");
    }

    {
      const res = await fetch(`${baseUrl}${retailerModelPath}`);
      assert(res.status === 200, "expected retailer model page to render");
      const html = await res.text();
      assert(/Sponsor \(paid\)/i.test(html), "expected sponsored label on model listings table");
    }

    {
      const res = await fetch(`${baseUrl}/listings/${encodeURIComponent(retailerListingId)}`);
      assert(res.status === 200, "expected listing detail page to render");
      const html = await res.text();
      assert(/Sponsor \(paid\)/i.test(html), "expected sponsored label on listing detail page");
    }

    let cameraSlug;
    {
      const { res, json } = await fetchJson(`${baseUrl}/api/v1/cameras?limit=1`);
      assert(res.status === 200, `/api/v1/cameras expected 200, got ${res.status}`);
      assert(json.ok === true, "/api/v1/cameras ok=true");
      assert(Array.isArray(json.cameras), "/api/v1/cameras cameras is array");
      cameraSlug = json.cameras[0]?.slug || null;
      assert(cameraSlug, "expected at least 1 camera slug");
    }

    let lensSlug;
    {
      const { res, json } = await fetchJson(`${baseUrl}/api/v1/lenses?limit=1`);
      assert(res.status === 200, `/api/v1/lenses expected 200, got ${res.status}`);
      assert(json.ok === true, "/api/v1/lenses ok=true");
      assert(Array.isArray(json.lenses), "/api/v1/lenses lenses is array");
      lensSlug = json.lenses[0]?.slug || null;
      assert(lensSlug, "expected at least 1 lens slug");
    }

    {
      const { res, json } = await fetchJson(`${baseUrl}/api/v1/cameras/${cameraSlug}/price-band`);
      assert(res.status === 200, `/api/v1/cameras/:slug/price-band expected 200, got ${res.status}`);
      assert(json.ok === true, "/api/v1/cameras/:slug/price-band ok=true");
    }

    {
      const { res, json } = await fetchJson(`${baseUrl}/api/v1/lenses/${lensSlug}/price-band`);
      assert(res.status === 200, `/api/v1/lenses/:slug/price-band expected 200, got ${res.status}`);
      assert(json.ok === true, "/api/v1/lenses/:slug/price-band ok=true");
    }

    const adminHeaders = { "x-admin-token": adminToken, "x-actor-id": "smoke" };

    {
      const res = await fetch(`${baseUrl}/api/v1/admin/openapi.internal.yml`, { headers: adminHeaders });
      const yaml = await res.text();
      assert(res.status === 200, `/api/v1/admin/openapi.internal.yml expected 200, got ${res.status}`);
      assert(yaml.includes("openapi: 3.1.0"), "openapi yaml contains version");
    }

    {
      const res = await fetch(`${baseUrl}/`, {
        headers: { "user-agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" },
      });
      assert(res.status === 200, "googlebot homepage expected 200");
      await res.text();
    }

    {
      let found = null;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        // eslint-disable-next-line no-await-in-loop
        const { res, json } = await fetchJson(`${baseUrl}/api/v1/admin/bots/summary?window_minutes=10`, { headers: adminHeaders });
        assert(res.status === 200, `/api/v1/admin/bots/summary expected 200, got ${res.status}`);
        assert(json.ok === true, "/api/v1/admin/bots/summary ok=true");
        assert(json.summary && json.summary.totals, "bots summary has totals");
        assert(Number(json.summary.totals.total_requests || 0) >= 1, "bots summary has at least 1 request");

        const googlebot = Array.isArray(json.summary.bots)
          ? json.summary.bots.find((b) => b && b.bot_name === "Googlebot") || null
          : null;

        if (googlebot && Number(googlebot.requests || 0) >= 1) {
          found = googlebot;
          break;
        }

        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      assert(found, "bots summary includes Googlebot");
    }

    {
      const { res, json } = await fetchJson(`${baseUrl}/api/v1/admin/ingestion/runs?limit=5`, { headers: adminHeaders });
      assert(res.status === 200, `/api/v1/admin/ingestion/runs expected 200, got ${res.status}`);
      assert(json.ok === true, "/api/v1/admin/ingestion/runs ok=true");
      assert(Array.isArray(json.runs), "/api/v1/admin/ingestion/runs runs is array");

      const retailerRun = json.runs.find((r) => r.marketplace_code === retailerMarketplaceCode && r.status === "success") || null;
      assert(retailerRun, "expected retailer ingestion run");
      assert(retailerRun.stats && typeof retailerRun.stats === "object", "expected retailer ingestion stats object");
      assert(Number(retailerRun.stats.feed_rows_total || 0) >= 2, "expected feed_rows_total in retailer stats");
      assert(Number(retailerRun.stats.feed_rows_invalid || 0) >= 1, "expected feed_rows_invalid in retailer stats");
    }

    {
      const { res, json } = await fetchJson(`${baseUrl}/api/v1/admin/partners`, { headers: adminHeaders });
      assert(res.status === 200, `/api/v1/admin/partners expected 200, got ${res.status}`);
      assert(json.ok === true, "/api/v1/admin/partners ok=true");
      assert(Array.isArray(json.partners), "/api/v1/admin/partners partners is array");

      const partner = json.partners.find((p) => p && p.marketplace_code === retailerMarketplaceCode) || null;
      assert(partner, "expected retailer marketplace to appear in partners list");
      assert(partner.partner_status === "active", "expected partner_status=active");
      assert(partner.is_sponsored === true, "expected partner is_sponsored=true");
    }

    {
      let report = null;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        // eslint-disable-next-line no-await-in-loop
        const { res, json } = await fetchJson(`${baseUrl}/api/v1/admin/partners/${encodeURIComponent(retailerMarketplaceCode)}/report?window_days=1`, {
          headers: adminHeaders,
        });
        assert(res.status === 200, `/api/v1/admin/partners/:code/report expected 200, got ${res.status}`);
        assert(json.ok === true, "/api/v1/admin/partners/:code/report ok=true");

        if (Number(json.clickouts?.redirects_total || 0) >= 1) {
          report = json;
          break;
        }

        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      assert(report, "expected partner report to include at least 1 redirect click-out");
    }

    {
      const { res, json } = await fetchJson(`${baseUrl}/api/v1/admin/audit-log?limit=5`, { headers: adminHeaders });
      assert(res.status === 200, `/api/v1/admin/audit-log expected 200, got ${res.status}`);
      assert(json.ok === true, "/api/v1/admin/audit-log ok=true");
      assert(Array.isArray(json.entries), "/api/v1/admin/audit-log entries is array");
    }

    {
      logStep("Newsletter (WP-0017)");

      const email = `newsletter-smoke+${Date.now()}@example.com`;

      const created = await fetch(`${baseUrl}/api/v1/newsletter/subscriptions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, segment: "street" }),
      });
      assert(created.status === 201, `/api/v1/newsletter/subscriptions expected 201, got ${created.status}`);
      const createdJson = await created.json();
      assert(createdJson.ok === true, "newsletter subscribe ok=true");
      const subId = createdJson.newsletter_subscription_id;
      assert(subId, "newsletter subscribe returns newsletter_subscription_id");

      const client = new Client({ connectionString: databaseUrl });
      await client.connect();
      let confirmToken = null;
      let unsubscribeToken = null;
      try {
        const rowRes = await client.query(
          `SELECT confirm_token, unsubscribe_token FROM newsletter_subscriptions WHERE newsletter_subscription_id = $1 LIMIT 1`,
          [subId],
        );
        const row = rowRes.rows[0] || null;
        assert(row && row.confirm_token && row.unsubscribe_token, "expected newsletter subscription tokens");
        confirmToken = row.confirm_token;
        unsubscribeToken = row.unsubscribe_token;
      } finally {
        await client.end();
      }

      const confirmRes = await fetch(`${baseUrl}/newsletter/confirm?token=${encodeURIComponent(confirmToken)}`);
      assert(confirmRes.status === 200, `/newsletter/confirm expected 200, got ${confirmRes.status}`);

      const baseUrlBefore = process.env.FF_PUBLIC_BASE_URL;
      process.env.FF_PUBLIC_BASE_URL = baseUrl;
      try {
        const weekly = await import("./newsletter/run_weekly_deals_newsletter.js");
        await weekly.run({ confirm: true, limit: 50 });
      } finally {
        if (baseUrlBefore === undefined) delete process.env.FF_PUBLIC_BASE_URL;
        else process.env.FF_PUBLIC_BASE_URL = baseUrlBefore;
      }

      const verify = new Client({ connectionString: databaseUrl });
      await verify.connect();
      try {
        const emailCount = await verify.query(
          `SELECT COUNT(*)::int AS c FROM email_messages WHERE newsletter_subscription_id = $1 AND message_type = 'newsletter_weekly'`,
          [subId],
        );
        assert(Number(emailCount.rows[0]?.c || 0) >= 1, "expected at least 1 newsletter_weekly email_messages row");
      } finally {
        await verify.end();
      }

      const unsubRes = await fetch(`${baseUrl}/newsletter/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`);
      assert(unsubRes.status === 200, `/newsletter/unsubscribe expected 200, got ${unsubRes.status}`);
    }

    let listing;
    {
      const candidates = [
        `${baseUrl}/api/v1/admin/matching/review-queue?status=unmatched&limit=1`,
        `${baseUrl}/api/v1/admin/matching/review-queue?status=needs_review&limit=1`,
      ];

      let found = null;
      for (const candidateUrl of candidates) {
        // eslint-disable-next-line no-await-in-loop
        const { res, json } = await fetchJson(candidateUrl, { headers: adminHeaders });
        assert(res.status === 200, `/api/v1/admin/matching/review-queue expected 200, got ${res.status}`);
        assert(json.ok === true, "/api/v1/admin/matching/review-queue ok=true");
        assert(Array.isArray(json.listings), "/api/v1/admin/matching/review-queue listings is array");
        if (json.listings[0]) {
          found = json.listings[0];
          break;
        }
      }

      if (!found) {
        const { res, json } = await fetchJson(`${baseUrl}/api/v1/listings?limit=1`);
        assert(res.status === 200, `/api/v1/listings expected 200, got ${res.status}`);
        assert(json.ok === true, "/api/v1/listings ok=true");
        assert(Array.isArray(json.listings), "/api/v1/listings listings is array");
        found = json.listings[0] || null;
      }

      listing = found;
      assert(listing && listing.listing_id, "expected at least 1 listing to test dry-run");
    }

    {
      logStep("Premium tier v0 (upgrade, gating, cancel)");

      const premiumEmail = `smoke_premium_${Date.now()}@example.com`;

      {
        const res = await fetch(`${baseUrl}/api/v1/premium/cameras/${encodeURIComponent(cameraSlug)}/price-history`);
        assert(res.status === 403, `/api/v1/premium/* expected 403 without ff_pro cookie, got ${res.status}`);
        const data = await res.json();
        assert(data && data.ok === false && data.error === "premium_required", "premium endpoint returns premium_required");
      }

      {
        const res = await fetch(`${baseUrl}/premium/price-history/cameras/${encodeURIComponent(cameraSlug)}`);
        assert(res.status === 403, `/premium/price-history/* expected 403 without ff_pro cookie, got ${res.status}`);
        const html = await res.text();
        assert(/Premium/i.test(html), "expected Premium signup page for blocked premium HTML");
      }

      const created = await fetch(`${baseUrl}/api/v1/premium/subscriptions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: premiumEmail }),
      });
      assert(created.status === 201, `/api/v1/premium/subscriptions expected 201, got ${created.status}`);
      const createdJson = await created.json();
      assert(createdJson.ok === true, "premium subscription create ok=true");
      assert(createdJson.premium_subscription_id, "premium subscription create returns premium_subscription_id");

      const premiumSubscriptionId = createdJson.premium_subscription_id;

      const client = new Client({ connectionString: databaseUrl });
      await client.connect();
      let confirmToken = null;
      let cancelToken = null;
      let accessToken = null;
      let listingIdWithBreakdown = null;
      try {
        const rowRes = await client.query(
          `SELECT confirm_token, cancel_token, access_token FROM premium_subscriptions WHERE premium_subscription_id = $1 LIMIT 1`,
          [premiumSubscriptionId],
        );
        const row = rowRes.rows[0] || null;
        assert(row && row.confirm_token && row.cancel_token && row.access_token, "expected premium_subscriptions tokens");
        confirmToken = row.confirm_token;
        cancelToken = row.cancel_token;
        accessToken = row.access_token;

        const listingRes = await client.query(`SELECT listing_id FROM listings WHERE deal_score_breakdown IS NOT NULL LIMIT 1`);
        listingIdWithBreakdown = listingRes.rows[0]?.listing_id || null;
        assert(listingIdWithBreakdown, "expected at least 1 listing with deal_score_breakdown");
      } finally {
        await client.end();
      }

      const confirmRes = await fetch(`${baseUrl}/premium/confirm?token=${encodeURIComponent(confirmToken)}`);
      assert(confirmRes.status === 200, `/premium/confirm expected 200, got ${confirmRes.status}`);
      const setCookie = confirmRes.headers.get("set-cookie") || "";
      const cookieMatch = setCookie.match(/ff_pro=([^;]+)/i);
      assert(cookieMatch, "expected ff_pro cookie on premium confirm");
      assert(cookieMatch[1] === accessToken, "expected ff_pro cookie value to match access_token");
      const premiumCookie = `ff_pro=${cookieMatch[1]}`;

      {
        const { res, json } = await fetchJson(`${baseUrl}/api/v1/premium/status`, { headers: { cookie: premiumCookie } });
        assert(res.status === 200, `/api/v1/premium/status expected 200, got ${res.status}`);
        assert(json.ok === true, "/api/v1/premium/status ok=true");
        assert(json.premium === true, "/api/v1/premium/status premium=true");
        assert(json.plan_code === "pro", "/api/v1/premium/status plan_code=pro");
      }

      {
        const { res, json } = await fetchJson(`${baseUrl}/api/v1/premium/cameras/${encodeURIComponent(cameraSlug)}/price-history?window_days=30`, {
          headers: { cookie: premiumCookie },
        });
        assert(res.status === 200, `/api/v1/premium/cameras/:slug/price-history expected 200, got ${res.status}`);
        assert(json.ok === true, "/api/v1/premium/cameras/:slug/price-history ok=true");
        assert(Array.isArray(json.series), "premium price history series is array");
      }

      {
        const res = await fetch(`${baseUrl}/premium/price-history/cameras/${encodeURIComponent(cameraSlug)}`, { headers: { cookie: premiumCookie } });
        assert(res.status === 200, `/premium/price-history/* expected 200 with ff_pro cookie, got ${res.status}`);
        const html = await res.text();
        assert(/Premium view/i.test(html), "expected Premium price history HTML to render");
      }

      {
        const free = await fetchJson(`${baseUrl}/api/v1/listings/${encodeURIComponent(listingIdWithBreakdown)}`);
        assert(free.res.status === 200, `/api/v1/listings/:id expected 200, got ${free.res.status}`);
        assert(free.json.ok === true, "/api/v1/listings/:id ok=true");
        assert(free.json.listing.deal_score_breakdown === null, "expected deal_score_breakdown to be hidden without premium");
        assert(free.json.listing.deal_score_breakdown_hidden === true, "expected deal_score_breakdown_hidden=true");
      }

      {
        const prem = await fetchJson(`${baseUrl}/api/v1/listings/${encodeURIComponent(listingIdWithBreakdown)}`, { headers: { cookie: premiumCookie } });
        assert(prem.res.status === 200, `/api/v1/listings/:id expected 200, got ${prem.res.status}`);
        assert(prem.json.ok === true, "/api/v1/listings/:id ok=true");
        assert(prem.json.listing.deal_score_breakdown, "expected deal_score_breakdown for premium");
        assert(Array.isArray(prem.json.listing.deal_score_breakdown.factors), "expected deal_score_breakdown.factors array");
      }

      {
        const res = await fetch(`${baseUrl}/listings/${encodeURIComponent(listingIdWithBreakdown)}`);
        assert(res.status === 200, "expected listing detail page to render");
        const html = await res.text();
        assert(/Factor breakdown is a Premium feature/i.test(html), "expected premium deal score hint on blocked listing page");
      }

      {
        const res = await fetch(`${baseUrl}/listings/${encodeURIComponent(listingIdWithBreakdown)}`, { headers: { cookie: premiumCookie } });
        assert(res.status === 200, "expected listing detail page to render for premium");
        const html = await res.text();
        assert(!/Factor breakdown is a Premium feature/i.test(html), "expected no premium deal score hint for premium listing page");
      }

      {
        const freeEmail = `smoke_free_${Date.now()}@example.com`;
        const res = await fetch(`${baseUrl}/api/v1/saved-searches`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: freeEmail, camera_slug: cameraSlug, min_interval_hours: 1 }),
        });
        assert(res.status === 403, `free min_interval_hours expected 403, got ${res.status}`);
        const json = await res.json();
        assert(json && json.error === "premium_required", "free saved search premium_required");
      }

      {
        const res = await fetch(`${baseUrl}/api/v1/saved-searches`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: premiumEmail, camera_slug: cameraSlug, min_interval_hours: 1, max_results_per_email: 50 }),
        });
        assert(res.status === 201, `premium saved search expected 201, got ${res.status}`);
        const json = await res.json();
        assert(json && json.ok === true, "premium saved search ok=true");
      }

      {
        const cancelRes = await fetch(`${baseUrl}/premium/cancel?token=${encodeURIComponent(cancelToken)}`);
        assert(cancelRes.status === 200, `/premium/cancel expected 200, got ${cancelRes.status}`);
        const cancelSetCookie = cancelRes.headers.get("set-cookie") || "";
        assert(/ff_pro=/i.test(cancelSetCookie) && /Max-Age=0/i.test(cancelSetCookie), "expected ff_pro cookie to be cleared");
      }

      {
        const { res, json } = await fetchJson(`${baseUrl}/api/v1/premium/status`, { headers: { cookie: premiumCookie } });
        assert(res.status === 200, `/api/v1/premium/status expected 200, got ${res.status}`);
        assert(json.ok === true, "/api/v1/premium/status ok=true");
        assert(json.premium === false, "/api/v1/premium/status premium=false after cancel");
      }

      {
        const res = await fetch(`${baseUrl}/api/v1/premium/cameras/${encodeURIComponent(cameraSlug)}/price-history`, { headers: { cookie: premiumCookie } });
        assert(res.status === 403, `/api/v1/premium/* expected 403 after cancel, got ${res.status}`);
      }

      {
        const verify = new Client({ connectionString: databaseUrl });
        await verify.connect();
        try {
          const audit = await verify.query(
            `SELECT COUNT(*)::int AS c FROM audit_log WHERE entity_type = 'premium_subscription' AND entity_id = $1`,
            [premiumSubscriptionId],
          );
          assert(Number(audit.rows[0]?.c || 0) >= 3, "expected premium subscription audit log entries");
        } finally {
          await verify.end();
        }
      }
    }

    {
      const res = await fetch(`${baseUrl}/go/listings/${listing.listing_id}?page_type=other`, { redirect: "manual" });
      assert(res.status === 302, `/go/listings/:id expected 302, got ${res.status}`);
      const setCookie = res.headers.get("set-cookie") || "";
      assert(!/ff_sid=/i.test(setCookie), "expected no ff_sid cookie when consent is not set");
    }

    {
      const res = await fetch(`${baseUrl}/go/listings/${listing.listing_id}?page_type=other`, {
        redirect: "manual",
        headers: { cookie: "ff_consent=1" },
      });
      assert(res.status === 302, `/go/listings/:id expected 302, got ${res.status}`);
      const setCookie = res.headers.get("set-cookie") || "";
      assert(/ff_sid=/i.test(setCookie), "expected ff_sid cookie when consent is enabled");
    }

    {
      const { res, json } = await fetchJson(`${baseUrl}/api/v1/admin/matching/override?dry_run=true`, {
        headers: { ...adminHeaders, "content-type": "application/json" },
        method: "POST",
        body: JSON.stringify({
          listing_id: listing.listing_id,
          camera_slug: cameraSlug,
          reason: "smoke test (dry-run)",
        }),
      });
      assert(res.status === 200, `dry-run override expected 200, got ${res.status}`);
      assert(json.ok === true && json.dry_run === true, "dry-run override returns dry_run=true");
      assert(json.diff && json.diff.before && json.diff.after, "dry-run override returns diff");
    }

    {
      const res = await fetch(`${baseUrl}/api/v1/admin/matching/override?dry_run=false`, {
        headers: { ...adminHeaders, "content-type": "application/json" },
        method: "POST",
        body: JSON.stringify({
          listing_id: listing.listing_id,
          camera_slug: cameraSlug,
          reason: "smoke test (confirm gate)",
        }),
      });
      const json = await res.json();
      assert(res.status === 400, `commit without confirm expected 400, got ${res.status}`);
      assert(json.error === "confirm_required", "commit without confirm returns confirm_required");
    }

    {
      const { res, json } = await fetchJson(`${baseUrl}/api/v1/admin/dedupe/edges?limit=1`, { headers: adminHeaders });
      assert(res.status === 200, `/api/v1/admin/dedupe/edges expected 200, got ${res.status}`);
      assert(json.ok === true, "/api/v1/admin/dedupe/edges ok=true");
      assert(Array.isArray(json.edges), "/api/v1/admin/dedupe/edges edges is array");
    }

    {
      const { res, json } = await fetchJson(`${baseUrl}/api/v1/listings?limit=2`);
      assert(res.status === 200, `/api/v1/listings expected 200, got ${res.status}`);
      assert(json.ok === true, "/api/v1/listings ok=true");
      assert(Array.isArray(json.listings), "/api/v1/listings listings is array");
      assert(json.listings.length >= 2, "expected at least 2 listings to test dedupe dry-run");

      const canonical = json.listings[0].listing_id;
      const duplicate = json.listings[1].listing_id;
      assert(canonical && duplicate && canonical !== duplicate, "need two distinct listing_ids");

      const dry = await fetchJson(`${baseUrl}/api/v1/admin/dedupe/edges?dry_run=true`, {
        headers: { ...adminHeaders, "content-type": "application/json" },
        method: "POST",
        body: JSON.stringify({
          canonical_listing_id: canonical,
          duplicate_listing_id: duplicate,
          confidence: 0.9,
          reason: "smoke test (dry-run)",
        }),
      });
      assert(dry.res.status === 200, `dedupe dry-run expected 200, got ${dry.res.status}`);
      assert(dry.json.ok === true && dry.json.dry_run === true, "dedupe dry-run returns dry_run=true");
      assert(dry.json.diff, "dedupe dry-run returns diff");

      const gateRes = await fetch(`${baseUrl}/api/v1/admin/dedupe/edges?dry_run=false`, {
        headers: { ...adminHeaders, "content-type": "application/json" },
        method: "POST",
        body: JSON.stringify({
          canonical_listing_id: canonical,
          duplicate_listing_id: duplicate,
          confidence: 0.9,
          reason: "smoke test (confirm gate)",
        }),
      });
      const gateJson = await gateRes.json();
      assert(gateRes.status === 400, `dedupe commit without confirm expected 400, got ${gateRes.status}`);
      assert(gateJson.error === "confirm_required", "dedupe commit without confirm returns confirm_required");
    }

    {
      logStep("Saved searches + email alerts (WP-0011)");

      const email = `alerts-smoke+${Date.now()}@example.com`;
      const created = await fetch(`${baseUrl}/api/v1/saved-searches`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, camera_slug: cameraSlug }),
      });
      assert(created.status === 201, `/api/v1/saved-searches expected 201, got ${created.status}`);
      const createdJson = await created.json();
      assert(createdJson.ok === true, "saved search create ok=true");
      assert(createdJson.saved_search_id, "saved search create returns saved_search_id");

      const savedSearchId = createdJson.saved_search_id;

      const client = new Client({ connectionString: databaseUrl });
      await client.connect();
      let confirmToken = null;
      let unsubscribeToken = null;
      let cameraId = null;
      let listingId = null;
      try {
        const rowRes = await client.query(
          `SELECT confirm_token, unsubscribe_token, camera_id FROM saved_searches WHERE saved_search_id = $1 LIMIT 1`,
          [savedSearchId],
        );
        const row = rowRes.rows[0] || null;
        assert(row && row.confirm_token && row.unsubscribe_token, "expected saved_searches tokens");
        confirmToken = row.confirm_token;
        unsubscribeToken = row.unsubscribe_token;
        cameraId = row.camera_id;

        const confirmRes = await fetch(`${baseUrl}/alerts/confirm?token=${encodeURIComponent(confirmToken)}`);
        assert(confirmRes.status === 200, `/alerts/confirm expected 200, got ${confirmRes.status}`);

        const nowIso = new Date().toISOString();
        const sourceItemId = `smoke_saved_search_${Date.now()}`;
        const insertRes = await client.query(
          `
          INSERT INTO listings (
            marketplace_code,
            source_item_id,
            url,
            title,
            last_retrieved_at,
            price_amount,
            price_currency,
            camera_id,
            first_seen_at,
            last_seen_at
          )
          VALUES ('ebay', $1, $2, $3, $4, $5, 'EUR', $6, $4, $4)
          RETURNING listing_id
          `,
          [sourceItemId, `https://example.com/${sourceItemId}`, "Smoke: saved search match", nowIso, 123.45, cameraId],
        );
        listingId = insertRes.rows[0]?.listing_id || null;
        assert(listingId, "expected inserted listing_id for alerts smoke");
      } finally {
        await client.end();
      }

      const baseUrlBefore = process.env.FF_PUBLIC_BASE_URL;
      process.env.FF_PUBLIC_BASE_URL = baseUrl;
      try {
        const alerts = await import("./alerts/run_saved_search_alerts.js");
        await alerts.run({ confirm: true, limit: 50 });
      } finally {
        if (baseUrlBefore === undefined) delete process.env.FF_PUBLIC_BASE_URL;
        else process.env.FF_PUBLIC_BASE_URL = baseUrlBefore;
      }

      const verify = new Client({ connectionString: databaseUrl });
      await verify.connect();
      try {
        const emailCount = await verify.query(
          `SELECT COUNT(*)::int AS c FROM email_messages WHERE saved_search_id = $1 AND message_type = 'saved_search_alert'`,
          [savedSearchId],
        );
        assert(Number(emailCount.rows[0]?.c || 0) >= 1, "expected at least 1 saved_search_alert email_messages row");

        const delivery = await verify.query(
          `SELECT delivered_at FROM saved_search_listing_deliveries WHERE saved_search_id = $1 AND listing_id = $2 LIMIT 1`,
          [savedSearchId, listingId],
        );
        assert(delivery.rows[0] && delivery.rows[0].delivered_at, "expected delivered_at to be set for saved_search delivery");

        const unsubRes = await fetch(`${baseUrl}/alerts/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`);
        assert(unsubRes.status === 200, `/alerts/unsubscribe expected 200, got ${unsubRes.status}`);
      } finally {
        await verify.end();
      }
    }

    // eslint-disable-next-line no-console
    console.log("\nSMOKE OK");
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
    console.log("- Example model page: http://127.0.0.1:8787/cameras/sony-a7-iv");
    // eslint-disable-next-line no-console
    console.log("- Stop DB later (optional): docker compose down");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("\nSMOKE FAILED:");
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
