import path from "node:path";
import { readFile } from "node:fs/promises";

import pg from "pg";

import { ingestListingsOnce } from "../ingest/write_listings.js";

const { Client } = pg;

function envString(name, fallback) {
  const raw = process.env[name];
  return raw && raw.trim() ? raw.trim() : fallback;
}

function isMarketplaceCode(value) {
  return typeof value === "string" && /^[a-z0-9_]{2,32}$/.test(value);
}

function clampText(value, { max, fallback = null } = {}) {
  if (value === null || value === undefined) return fallback;
  const s = String(value).trim();
  if (!s) return fallback;
  return s.length > max ? s.slice(0, max) : s;
}

function safeNumber(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseBool(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  const s = String(value).trim().toLowerCase();
  if (!s) return fallback;
  if (["1", "true", "yes", "y"].includes(s)) return true;
  if (["0", "false", "no", "n"].includes(s)) return false;
  return fallback;
}

function csvRows(text) {
  const input = String(text || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const c = input[i];

    if (inQuotes) {
      if (c === '"') {
        const next = input[i + 1];
        if (next === '"') {
          field += '"';
          i += 1;
          continue;
        }
        inQuotes = false;
        continue;
      }
      field += c;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      continue;
    }

    if (c === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (c === "\r") continue;

    if (c === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      continue;
    }

    field += c;
  }

  row.push(field);
  rows.push(row);

  if (rows.length > 1 && rows[rows.length - 1].every((v) => !String(v || "").trim())) {
    rows.pop();
  }

  return rows;
}

function csvObjects(text) {
  const rows = csvRows(text);
  if (!rows.length) throw new Error("empty_csv");

  const headers = rows[0].map((h) => String(h || "").trim());
  if (headers.length === 0 || headers.every((h) => !h)) throw new Error("missing_header_row");

  const normalized = headers.map((h) => h.toLowerCase());

  const out = [];
  for (let i = 1; i < rows.length; i += 1) {
    const r = rows[i];
    if (!r || r.every((v) => !String(v || "").trim())) continue;
    const obj = {};
    for (let j = 0; j < normalized.length; j += 1) {
      const key = normalized[j];
      if (!key) continue;
      obj[key] = r[j] === undefined ? "" : String(r[j]);
    }
    out.push(obj);
  }

  return out;
}

function pick(row, keys) {
  for (const k of keys) {
    const v = row && Object.prototype.hasOwnProperty.call(row, k) ? row[k] : null;
    const s = v === null || v === undefined ? "" : String(v).trim();
    if (s) return s;
  }
  return null;
}

function splitList(value) {
  const s = value === null || value === undefined ? "" : String(value).trim();
  if (!s) return [];
  return s
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 50);
}

function mapConditionTier(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "used_good";
  if (s.includes("for parts") || s.includes("parts")) return "for_parts";
  if (s.includes("like") && s.includes("new")) return "like_new";
  if (s === "like_new") return "like_new";
  if (s === "new" || s.includes("brand new")) return "new";
  if (s.includes("excellent")) return "used_excellent";
  if (s.includes("fair")) return "used_fair";
  if (s.includes("good")) return "used_good";
  return "used_good";
}

function mapFunctionalStatus(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "unknown";
  if (s.includes("not") && s.includes("work")) return "not_working";
  if (s.includes("untest")) return "untested";
  if (s.includes("work") || s === "ok") return "working";
  if (s.includes("unknown")) return "unknown";
  return "unknown";
}

function mapMedia(imageUrls) {
  const urls = splitList(imageUrls);
  const media = [];
  for (const url of urls) {
    media.push({ type: "image", url });
  }
  return media;
}

function buildListing(row, { marketplaceCode, nowIso, defaultCurrency }) {
  const sourceItemId = pick(row, ["source_item_id", "item_id", "id", "sku", "listing_id"]);
  const url = pick(row, ["url", "listing_url", "product_url"]);
  const title = pick(row, ["title", "name"]);
  const priceAmount = safeNumber(pick(row, ["price_amount", "price", "amount"]), null);
  const currencyRaw = pick(row, ["price_currency", "currency"]) || defaultCurrency;
  const currency = currencyRaw ? String(currencyRaw).trim().toUpperCase() : null;

  if (!sourceItemId) return { ok: false, error: "missing_source_item_id" };
  if (!url) return { ok: false, error: "missing_url" };
  if (!title) return { ok: false, error: "missing_title" };
  if (priceAmount === null) return { ok: false, error: "missing_price_amount" };
  if (!currency || !/^[A-Z]{3}$/.test(currency)) return { ok: false, error: "invalid_currency" };

  const shippingAmount = safeNumber(pick(row, ["shipping_amount", "shipping"]), null);
  const shippingCurrencyRaw = pick(row, ["shipping_currency"]) || currency;
  const shippingCurrency = shippingAmount === null ? null : String(shippingCurrencyRaw || "").trim().toUpperCase();

  const isActive = parseBool(pick(row, ["is_active", "active"]), true);
  const feesIncluded = parseBool(pick(row, ["fees_included"]), true);

  const conditionRaw = pick(row, ["condition_raw", "condition"]) || null;
  const conditionTier = mapConditionTier(conditionRaw);
  const functionalStatus = mapFunctionalStatus(pick(row, ["functional_status"]) || null);

  const country = pick(row, ["country"]) ? String(pick(row, ["country"])).trim().toUpperCase() : null;
  const city = pick(row, ["city"]) || null;

  return {
    ok: true,
    listing: {
      marketplace_code: marketplaceCode,
      source_item_id: clampText(sourceItemId, { max: 128, fallback: null }),
      url: clampText(url, { max: 2048, fallback: null }),
      title: clampText(title, { max: 256, fallback: null }),
      last_retrieved_at: nowIso,
      is_active: Boolean(isActive),
      price_amount: priceAmount,
      price_currency: currency,
      shipping_amount: shippingAmount,
      shipping_currency: shippingCurrency && /^[A-Z]{3}$/.test(shippingCurrency) ? shippingCurrency : null,
      fees_included: Boolean(feesIncluded),
      condition_raw: clampText(conditionRaw, { max: 128, fallback: null }),
      condition_physical_tier: conditionTier,
      functional_status: functionalStatus,
      seller_type: "business",
      seller_id: clampText(pick(row, ["seller_id"]), { max: 128, fallback: null }),
      seller_rating: safeNumber(pick(row, ["seller_rating"]), null),
      country: country && /^[A-Z]{2}$/.test(country) ? country : null,
      region: clampText(pick(row, ["region"]), { max: 128, fallback: null }),
      city: clampText(city, { max: 128, fallback: null }),
      pickup_possible: parseBool(pick(row, ["pickup_possible"]), null),
      included_items: splitList(pick(row, ["included_items"])),
      extracted_attributes: [],
      media: mapMedia(pick(row, ["image_urls", "images"])),
      raw_ref: { feed_row: row },
    },
  };
}

async function ensureMarketplace(client, { marketplaceCode, displayName, affiliateSupported }) {
  await client.query(
    `
    INSERT INTO marketplaces (marketplace_code, display_name, affiliate_supported)
    VALUES ($1, $2, $3)
    ON CONFLICT (marketplace_code) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      affiliate_supported = EXCLUDED.affiliate_supported
    `,
    [marketplaceCode, displayName, Boolean(affiliateSupported)],
  );
}

async function startIngestionRun(client, { jobName, marketplaceCode, startedAt }) {
  const res = await client.query(
    `
    INSERT INTO ingestion_runs (job_name, marketplace_code, started_at, status, stats)
    VALUES ($1, $2, $3, 'running', '{}'::jsonb)
    RETURNING run_id
    `,
    [jobName, marketplaceCode, startedAt],
  );
  return res.rows[0].run_id;
}

async function finishIngestionRun(client, { runId, endedAt, status, stats, error }) {
  await client.query(
    `
    UPDATE ingestion_runs
    SET ended_at = $2, status = $3, stats = $4::jsonb, error = $5
    WHERE run_id = $1
    `,
    [runId, endedAt, status, JSON.stringify(stats || {}), error ? String(error).slice(0, 500) : null],
  );
}

async function recordFailure(client, { jobName, marketplaceCode, marketplaceDisplayName, affiliateSupported, statsExtra, error }) {
  const startedAt = new Date().toISOString();
  await ensureMarketplace(client, { marketplaceCode, displayName: marketplaceDisplayName || marketplaceCode, affiliateSupported });
  const runId = await startIngestionRun(client, { jobName, marketplaceCode, startedAt });

  const stats = {
    marketplace_code: marketplaceCode,
    listings_total: 0,
    inserted: 0,
    updated: 0,
    snapshots_inserted: 0,
    ...(statsExtra && typeof statsExtra === "object" && !Array.isArray(statsExtra) ? statsExtra : {}),
  };

  await finishIngestionRun(client, { runId, endedAt: new Date().toISOString(), status: "failed", stats, error });
  return runId;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("Missing DATABASE_URL.");
    process.exitCode = 2;
    return;
  }

  const marketplaceCode = envString("FF_RETAILER_FEED_MARKETPLACE_CODE", "retailer_feed_1");
  if (!isMarketplaceCode(marketplaceCode)) {
    console.error("Invalid FF_RETAILER_FEED_MARKETPLACE_CODE.");
    process.exitCode = 2;
    return;
  }

  const marketplaceName = envString("FF_RETAILER_FEED_MARKETPLACE_NAME", "Retailer Feed #1");
  const jobName = envString("FF_RETAILER_FEED_JOB_NAME", `ingest_${marketplaceCode}_feed`);

  const feedPathRaw = envString("FF_RETAILER_FEED_PATH", "");
  if (!feedPathRaw) {
    console.error("Missing FF_RETAILER_FEED_PATH (CSV file).");
    process.exitCode = 2;
    return;
  }

  const defaultCurrency = envString("FF_RETAILER_FEED_DEFAULT_CURRENCY", "EUR");
  const nowIso = new Date().toISOString();
  const resolvedPath = path.isAbsolute(feedPathRaw) ? feedPathRaw : path.resolve(process.cwd(), feedPathRaw);

  let rows;
  let statsExtra = null;

  try {
    const raw = await readFile(resolvedPath, "utf-8");
    rows = csvObjects(raw);
    statsExtra = { feed_format: "csv", feed_rows_total: rows.length };
  } catch (err) {
    const client = new Client({ connectionString });
    await client.connect();
    try {
      const runId = await recordFailure(client, {
        jobName,
        marketplaceCode,
        marketplaceDisplayName: marketplaceName,
        affiliateSupported: true,
        statsExtra: { feed_format: "csv", feed_rows_total: 0 },
        error: err instanceof Error ? err.message : String(err),
      });
      console.error("Feed read/parse failed. Logged ingestion_run:", runId);
      process.exitCode = 1;
      return;
    } finally {
      await client.end();
    }
  }

  const invalidExamples = [];
  let invalid = 0;

  const listings = [];
  for (let i = 0; i < rows.length; i += 1) {
    const built = buildListing(rows[i], { marketplaceCode, nowIso, defaultCurrency });
    if (!built.ok) {
      invalid += 1;
      if (invalidExamples.length < 5) invalidExamples.push({ row_index: i + 1, error: built.error });
      continue;
    }

    if (!built.listing.source_item_id || !built.listing.url || !built.listing.title) {
      invalid += 1;
      if (invalidExamples.length < 5) invalidExamples.push({ row_index: i + 1, error: "clamped_required_field" });
      continue;
    }

    listings.push(built.listing);
  }

  statsExtra = {
    ...(statsExtra || {}),
    feed_rows_invalid: invalid,
    feed_invalid_examples: invalidExamples,
  };

  const client = new Client({ connectionString });
  await client.connect();
  try {
    if (listings.length === 0) {
      const runId = await recordFailure(client, {
        jobName,
        marketplaceCode,
        marketplaceDisplayName: marketplaceName,
        affiliateSupported: true,
        statsExtra,
        error: "no_valid_rows",
      });
      console.error("No valid listings in feed. Logged ingestion_run:", runId);
      process.exitCode = 1;
      return;
    }

    const result = await ingestListingsOnce(client, {
      jobName,
      marketplaceCode,
      marketplaceDisplayName: marketplaceName,
      affiliateSupported: true,
      listings,
      statsExtra,
    });

    if (!result.ok) {
      console.error("Ingestion failed:", result.error);
      process.exitCode = 1;
      return;
    }

    console.log("Ingested retailer feed listings OK:");
    console.log("- marketplace_code:", marketplaceCode);
    console.log("- run_id:", result.run_id);
    console.log("- stats:", result.stats);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

