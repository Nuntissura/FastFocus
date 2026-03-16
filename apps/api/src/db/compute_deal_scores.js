import pg from "pg";

import { computeDealScoreV0, DEAL_SCORE_VERSION } from "../deal_score/deal_score_v0.js";

const { Client } = pg;

function envString(name, fallback) {
  const raw = process.env[name];
  return raw && raw.trim() ? raw.trim() : fallback;
}

function envInt(name, fallback) {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) ? n : fallback;
}

function parseArgs(argv) {
  const out = {
    confirm: false,
    batchSize: envInt("FF_DEAL_SCORE_BATCH_SIZE", 200),
    maxListings: envInt("FF_DEAL_SCORE_MAX_LISTINGS", 50_000),
    observedDate: envString("FF_DEAL_SCORE_OBSERVED_DATE", envString("FF_PRICE_BANDS_DATE", "")) || null,
  };
  for (const arg of argv) {
    if (arg === "--confirm") out.confirm = true;
    if (arg.startsWith("--batch-size=")) out.batchSize = Number(arg.slice("--batch-size=".length));
    if (arg.startsWith("--max-listings=")) out.maxListings = Number(arg.slice("--max-listings=".length));
    if (arg.startsWith("--observed-date=")) out.observedDate = arg.slice("--observed-date=".length) || null;
  }
  return out;
}

function bandKey({ entityId, currency, country, condition }) {
  return `${entityId}|${currency}|${country || ""}|${condition || ""}`;
}

function pickBand(map, { entityId, currency, country, condition }) {
  const keys = [
    bandKey({ entityId, currency, country, condition }),
    bandKey({ entityId, currency, country: null, condition }),
    bandKey({ entityId, currency, country, condition: null }),
    bandKey({ entityId, currency, country: null, condition: null }),
  ];
  for (const k of keys) {
    const found = map.get(k);
    if (found) return found;
  }
  return null;
}

async function resolveObservedDate(client, hint) {
  if (hint) return hint;
  const cam = await client.query(`SELECT MAX(observed_date) AS d FROM price_observations`);
  const lens = await client.query(`SELECT MAX(observed_date) AS d FROM lens_price_observations`);
  const a = cam.rows[0]?.d || null;
  const b = lens.rows[0]?.d || null;
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

async function loadPriceBands(client, { observedDate }) {
  const cameraMap = new Map();
  const lensMap = new Map();

  if (!observedDate) return { cameraMap, lensMap };

  {
    const res = await client.query(
      `
      SELECT
        camera_id,
        currency,
        country,
        condition_physical_tier,
        sample_size,
        p25::float8 AS p25,
        median::float8 AS median,
        p75::float8 AS p75,
        min::float8 AS min,
        max::float8 AS max,
        method
      FROM price_observations
      WHERE observed_date = $1 AND region IS NULL
      `,
      [observedDate],
    );
    for (const row of res.rows) {
      const key = bandKey({
        entityId: row.camera_id,
        currency: row.currency,
        country: row.country,
        condition: row.condition_physical_tier,
      });
      cameraMap.set(key, { ...row, observed_date: observedDate });
    }
  }

  {
    const res = await client.query(
      `
      SELECT
        lens_id,
        currency,
        country,
        condition_physical_tier,
        sample_size,
        p25::float8 AS p25,
        median::float8 AS median,
        p75::float8 AS p75,
        min::float8 AS min,
        max::float8 AS max,
        method
      FROM lens_price_observations
      WHERE observed_date = $1 AND region IS NULL
      `,
      [observedDate],
    );
    for (const row of res.rows) {
      const key = bandKey({
        entityId: row.lens_id,
        currency: row.currency,
        country: row.country,
        condition: row.condition_physical_tier,
      });
      lensMap.set(key, { ...row, observed_date: observedDate });
    }
  }

  return { cameraMap, lensMap };
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("Missing DATABASE_URL.");
    console.error("Example:");
    console.error("  DATABASE_URL=postgres://fastfocus:fastfocus@127.0.0.1:55432/fastfocus");
    process.exitCode = 2;
    return;
  }

  const args = parseArgs(process.argv.slice(2));

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const observedDate = await resolveObservedDate(client, args.observedDate);
    const { cameraMap, lensMap } = await loadPriceBands(client, { observedDate });

    console.log("Deal score compute (dry-run by default)");
    console.log("confirm:", args.confirm);
    console.log("observed_date:", observedDate || "(none)");
    console.log("batch_size:", args.batchSize);
    console.log("max_listings:", args.maxListings);
    console.log("price_bands_loaded:", { camera: cameraMap.size, lens: lensMap.size });

    const now = new Date();

    let processed = 0;
    let updated = 0;
    let offset = 0;

    while (processed < args.maxListings) {
      const remaining = args.maxListings - processed;
      const limit = Math.max(1, Math.min(args.batchSize, remaining));

      const res = await client.query(
        `
        SELECT
          listing_id,
          marketplace_code,
          source_item_id,
          url,
          title,
          last_retrieved_at,
          is_active,
          camera_id,
          lens_id,
          match_status,
          match_confidence::float8 AS match_confidence,
          price_amount::float8 AS price_amount,
          price_currency,
          shipping_amount::float8 AS shipping_amount,
          shipping_currency,
          fees_included,
          condition_physical_tier,
          functional_status,
          seller_type,
          seller_rating::float8 AS seller_rating,
          country,
          region,
          city,
          pickup_possible,
          included_items,
          extracted_attributes,
          media,
          first_seen_at,
          last_seen_at
        FROM listings
        WHERE is_active = TRUE
          AND (camera_id IS NOT NULL OR lens_id IS NOT NULL)
        ORDER BY last_seen_at DESC, listing_id ASC
        LIMIT $1 OFFSET $2
        `,
        [limit, offset],
      );

      const rows = res.rows;
      if (rows.length === 0) break;

      for (const row of rows) {
        let baseline = null;
        if (observedDate && row.camera_id) {
          baseline = pickBand(cameraMap, {
            entityId: row.camera_id,
            currency: row.price_currency,
            country: row.country,
            condition: row.condition_physical_tier,
          });
        } else if (observedDate && row.lens_id) {
          baseline = pickBand(lensMap, {
            entityId: row.lens_id,
            currency: row.price_currency,
            country: row.country,
            condition: row.condition_physical_tier,
          });
        }

        const computed = computeDealScoreV0({ listing: row, baseline, now });

        if (args.confirm) {
          await client.query(
            `
            UPDATE listings
            SET
              deal_score = $2,
              deal_score_version = $3,
              deal_score_confidence = $4,
              deal_score_breakdown = $5::jsonb,
              deal_score_computed_at = $6
            WHERE listing_id = $1
            `,
            [
              row.listing_id,
              computed.score,
              DEAL_SCORE_VERSION,
              computed.confidence,
              JSON.stringify(computed.breakdown),
              now.toISOString(),
            ],
          );
          updated += 1;
        }

        processed += 1;
        if (processed >= args.maxListings) break;
      }

      offset += rows.length;

      if (processed % 1000 === 0 || rows.length < limit) {
        console.log("progress:", { processed, updated });
      }

      if (rows.length < limit) break;
    }

    console.log("done:", { processed, updated, version: DEAL_SCORE_VERSION });
    if (!args.confirm) console.log("hint: re-run with --confirm to persist scores.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

