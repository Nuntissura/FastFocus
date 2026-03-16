import pg from "pg";

const { Client } = pg;

function envString(name, fallback) {
  const raw = process.env[name];
  return raw && raw.trim() ? raw.trim() : fallback;
}

function isIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function utcTodayDate() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("Missing DATABASE_URL.");
    process.exitCode = 2;
    return;
  }

  const observedDate = envString("FF_PRICE_BANDS_DATE", utcTodayDate());
  if (!isIsoDate(observedDate)) {
    console.error("Invalid FF_PRICE_BANDS_DATE (expected YYYY-MM-DD):", observedDate);
    process.exitCode = 2;
    return;
  }

  const method = envString("FF_PRICE_BANDS_METHOD", "trim_p05_p95_p25_p50_p75_v1").slice(0, 120);

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");

    const cameraRes = await client.query(
      `
      WITH base AS (
        SELECT
          l.camera_id,
          s.price_currency AS currency,
          l.country AS country,
          s.condition_physical_tier AS condition_physical_tier,
          s.price_amount::numeric AS price_amount
        FROM listing_snapshots s
        JOIN listings l ON l.listing_id = s.listing_id
        WHERE
          (s.retrieved_at AT TIME ZONE 'UTC')::date = $1::date
          AND s.is_active = TRUE
          AND l.is_active = TRUE
          AND l.camera_id IS NOT NULL
          AND l.match_status IN ('matched','verified')
      ),
      agg AS (
        SELECT
          camera_id,
          $1::date AS observed_date,
          currency,
          country,
          NULL::text AS region,
          condition_physical_tier,
          COUNT(*)::int AS sample_size,
          percentile_cont(0.05) WITHIN GROUP (ORDER BY price_amount) AS p05,
          percentile_cont(0.25) WITHIN GROUP (ORDER BY price_amount) AS p25,
          percentile_cont(0.50) WITHIN GROUP (ORDER BY price_amount) AS median,
          percentile_cont(0.75) WITHIN GROUP (ORDER BY price_amount) AS p75,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY price_amount) AS p95
        FROM base
        GROUP BY GROUPING SETS (
          (camera_id, currency, country, condition_physical_tier),
          (camera_id, currency, country),
          (camera_id, currency, condition_physical_tier),
          (camera_id, currency)
        )
      )
      INSERT INTO price_observations (
        camera_id,
        observed_date,
        currency,
        country,
        region,
        condition_physical_tier,
        sample_size,
        p25,
        median,
        p75,
        min,
        max,
        computed_at,
        method
      )
      SELECT
        camera_id,
        observed_date,
        currency,
        country,
        region,
        condition_physical_tier,
        sample_size,
        ROUND(p25::numeric, 2) AS p25,
        ROUND(median::numeric, 2) AS median,
        ROUND(p75::numeric, 2) AS p75,
        ROUND(p05::numeric, 2) AS min,
        ROUND(p95::numeric, 2) AS max,
        NOW() AS computed_at,
        $2 AS method
      FROM agg
      WHERE sample_size > 0
      ON CONFLICT (camera_id, observed_date, currency, country, region, condition_physical_tier)
      DO UPDATE SET
        sample_size = EXCLUDED.sample_size,
        p25 = EXCLUDED.p25,
        median = EXCLUDED.median,
        p75 = EXCLUDED.p75,
        min = EXCLUDED.min,
        max = EXCLUDED.max,
        computed_at = EXCLUDED.computed_at,
        method = EXCLUDED.method
      `,
      [observedDate, method],
    );

    const lensRes = await client.query(
      `
      WITH base AS (
        SELECT
          l.lens_id,
          s.price_currency AS currency,
          l.country AS country,
          s.condition_physical_tier AS condition_physical_tier,
          s.price_amount::numeric AS price_amount
        FROM listing_snapshots s
        JOIN listings l ON l.listing_id = s.listing_id
        WHERE
          (s.retrieved_at AT TIME ZONE 'UTC')::date = $1::date
          AND s.is_active = TRUE
          AND l.is_active = TRUE
          AND l.lens_id IS NOT NULL
          AND l.match_status IN ('matched','verified')
      ),
      agg AS (
        SELECT
          lens_id,
          $1::date AS observed_date,
          currency,
          country,
          NULL::text AS region,
          condition_physical_tier,
          COUNT(*)::int AS sample_size,
          percentile_cont(0.05) WITHIN GROUP (ORDER BY price_amount) AS p05,
          percentile_cont(0.25) WITHIN GROUP (ORDER BY price_amount) AS p25,
          percentile_cont(0.50) WITHIN GROUP (ORDER BY price_amount) AS median,
          percentile_cont(0.75) WITHIN GROUP (ORDER BY price_amount) AS p75,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY price_amount) AS p95
        FROM base
        GROUP BY GROUPING SETS (
          (lens_id, currency, country, condition_physical_tier),
          (lens_id, currency, country),
          (lens_id, currency, condition_physical_tier),
          (lens_id, currency)
        )
      )
      INSERT INTO lens_price_observations (
        lens_id,
        observed_date,
        currency,
        country,
        region,
        condition_physical_tier,
        sample_size,
        p25,
        median,
        p75,
        min,
        max,
        computed_at,
        method
      )
      SELECT
        lens_id,
        observed_date,
        currency,
        country,
        region,
        condition_physical_tier,
        sample_size,
        ROUND(p25::numeric, 2) AS p25,
        ROUND(median::numeric, 2) AS median,
        ROUND(p75::numeric, 2) AS p75,
        ROUND(p05::numeric, 2) AS min,
        ROUND(p95::numeric, 2) AS max,
        NOW() AS computed_at,
        $2 AS method
      FROM agg
      WHERE sample_size > 0
      ON CONFLICT (lens_id, observed_date, currency, country, region, condition_physical_tier)
      DO UPDATE SET
        sample_size = EXCLUDED.sample_size,
        p25 = EXCLUDED.p25,
        median = EXCLUDED.median,
        p75 = EXCLUDED.p75,
        min = EXCLUDED.min,
        max = EXCLUDED.max,
        computed_at = EXCLUDED.computed_at,
        method = EXCLUDED.method
      `,
      [observedDate, method],
    );

    await client.query("COMMIT");

    console.log("Computed price bands OK:");
    console.log("- observed_date_utc:", observedDate);
    console.log("- method:", method);
    console.log("- camera_rows_upserted:", cameraRes.rowCount);
    console.log("- lens_rows_upserted:", lensRes.rowCount);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

