import { spawn } from "node:child_process";
import { resolveRepoRoot } from "../paths.js";

import pg from "pg";

const { Client } = pg;

function envString(name, fallback) {
  const raw = process.env[name];
  return raw && raw.trim() ? raw.trim() : fallback;
}

function envBool(name, fallback = false) {
  const raw = envString(name, "");
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

function hasEnv(name) {
  const raw = process.env[name];
  return Boolean(raw && raw.trim());
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

function truncateText(value, max = 500) {
  const s = value === null || value === undefined ? "" : String(value);
  return s.length > max ? `${s.slice(0, max)}…` : s;
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

function parseArgs(argv) {
  const out = { confirm: false, help: false };
  for (const arg of argv) {
    if (arg === "--confirm") out.confirm = true;
    if (arg === "--help" || arg === "-h") out.help = true;
  }
  return out;
}

function printUsage() {
  // eslint-disable-next-line no-console
  console.log(
    [
      "Run the daily batch refresh pipeline (ingest -> match -> price bands -> deal scores -> retention).",
      "",
      "Usage:",
      "  node apps/api/src/db/run_daily_refresh.js [--confirm]",
      "",
      "Notes:",
      "- Default is dry-run (no commands executed).",
      "- Requires DATABASE_URL.",
      "- Set FF_PRICE_BANDS_DATE to override the observed date (default: UTC today).",
      "- Optional ingest toggles:",
      "  - FF_SCHEDULER_USE_DEMO=1 to run demo ingest instead of eBay Browse API ingest.",
      "  - FF_SCHEDULER_RUN_EBAY=0 to skip eBay ingest.",
      "  - FF_SCHEDULER_RUN_RETAILER_FEED_1=0 to skip retailer feed ingest.",
      "- Optional comms jobs:",
      "  - FF_SCHEDULER_RUN_ALERTS=1 to run saved-search alerts and premium tracker alerts (uses FF_EMAIL_TRANSPORT).",
      "  - FF_SCHEDULER_RUN_NEWSLETTER=1 to run weekly deals newsletter (uses FF_EMAIL_TRANSPORT).",
    ].join("\n"),
  );
}

async function insertAuditLog(client, { action, diff }) {
  const safeDiff = diff && typeof diff === "object" && !Array.isArray(diff) ? diff : {};
  await client.query(
    `
    INSERT INTO audit_log (actor_type, actor_id, action, entity_type, entity_id, diff)
    VALUES ('ai', $1, $2, $3, NULL, $4::jsonb)
    `,
    ["scheduler", String(action || "unknown").slice(0, 64), "system_job", JSON.stringify(safeDiff)],
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const repoRoot = resolveRepoRoot();

  const observedDate = envString("FF_PRICE_BANDS_DATE", utcTodayDate());
  const useDemo = envBool("FF_SCHEDULER_USE_DEMO", false);

  const runEbay = envBool("FF_SCHEDULER_RUN_EBAY", true) && hasEnv("EBAY_CLIENT_ID") && hasEnv("EBAY_CLIENT_SECRET") && !useDemo;
  const runRetailerFeed1 = envBool("FF_SCHEDULER_RUN_RETAILER_FEED_1", true) && hasEnv("FF_RETAILER_FEED_PATH");

  const runAlerts = envBool("FF_SCHEDULER_RUN_ALERTS", false);
  const runNewsletter = envBool("FF_SCHEDULER_RUN_NEWSLETTER", false);

  const steps = [];

  if (useDemo) {
    steps.push({ name: "ingest:demo-ebay", cmd: "node", args: ["apps/api/src/db/ingest_demo_ebay.js"] });
  } else if (runEbay) {
    steps.push({ name: "ingest:ebay", cmd: "node", args: ["apps/api/src/db/ingest_ebay_browse_api.js"] });
  } else {
    // eslint-disable-next-line no-console
    console.log("skip ingest:ebay (missing credentials or disabled)");
  }

  if (runRetailerFeed1) {
    steps.push({ name: "ingest:retailer-feed-1", cmd: "node", args: ["apps/api/src/db/ingest_retailer_feed_1.js"] });
  } else {
    // eslint-disable-next-line no-console
    console.log("skip ingest:retailer-feed-1 (missing FF_RETAILER_FEED_PATH or disabled)");
  }

  steps.push({ name: "db:match:listings", cmd: "node", args: ["apps/api/src/db/match_listings.js"] });
  steps.push({ name: "db:compute:price-bands", cmd: "node", args: ["apps/api/src/db/compute_price_bands.js"] });
  steps.push({ name: "db:compute:deal-scores", cmd: "node", args: ["apps/api/src/db/compute_deal_scores.js", "--confirm"] });
  steps.push({ name: "db:prune:retention", cmd: "node", args: ["apps/api/src/db/prune_retention.js", "--confirm"] });

  if (runAlerts) {
    steps.push({ name: "alerts:run", cmd: "node", args: ["apps/api/src/alerts/run_saved_search_alerts.js", "--confirm"] });
    steps.push({ name: "premium:tracker-alerts", cmd: "node", args: ["apps/api/src/premium/run_tracker_alerts.js", "--confirm"] });
  }
  if (runNewsletter) steps.push({ name: "newsletter:weekly", cmd: "node", args: ["apps/api/src/newsletter/run_weekly_deals_newsletter.js", "--confirm"] });

  if (!args.confirm) {
    // eslint-disable-next-line no-console
    console.log("\nDRY RUN (no commands executed). Planned steps:");
    for (const s of steps) {
      // eslint-disable-next-line no-console
      console.log("-", s.name);
    }
    // eslint-disable-next-line no-console
    console.log("\nRe-run with --confirm to execute.");
    return;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || !databaseUrl.trim()) {
    // eslint-disable-next-line no-console
    console.error("Missing DATABASE_URL.");
    printUsage();
    process.exitCode = 2;
    return;
  }

  const jobEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    FF_PRICE_BANDS_DATE: observedDate,
  };

  const audit = new Client({ connectionString: databaseUrl });
  await audit.connect();
  try {
    await insertAuditLog(audit, {
      action: "batch_refresh_start",
      diff: {
        observed_date_utc: observedDate,
        use_demo: useDemo,
        steps: steps.map((s) => s.name),
      },
    });

    for (const s of steps) {
      const startedMs = Date.now();
      logStep(s.name);
      try {
        await run(s.cmd, s.args, { cwd: repoRoot, env: jobEnv, label: s.name });
        await insertAuditLog(audit, {
          action: "batch_refresh_step_ok",
          diff: { step: s.name, duration_ms: Date.now() - startedMs },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await insertAuditLog(audit, {
          action: "batch_refresh_step_fail",
          diff: { step: s.name, error: truncateText(msg, 800) },
        });
        throw err;
      }
    }

    await insertAuditLog(audit, { action: "batch_refresh_end", diff: { ok: true } });

    // eslint-disable-next-line no-console
    console.log("\nDAILY REFRESH OK");
    // eslint-disable-next-line no-console
    console.log("- observed_date_utc:", observedDate);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      await insertAuditLog(audit, { action: "batch_refresh_end", diff: { ok: false, error: truncateText(msg, 800) } });
    } catch {
      // ignore audit failures here
    }
    throw err;
  } finally {
    await audit.end();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("\nDAILY REFRESH FAILED:");
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
