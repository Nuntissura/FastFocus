function clampInt(value, { min, max, fallback }) {
  if (value === null || value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function parseHistoryWindowDays(url, fallback = 180) {
  return clampInt(url.searchParams.get("window_days"), { min: 7, max: 365, fallback });
}

function isoDateUtc(d) {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function listCameraPriceHistory(pool, { cameraId, currency, country = null, condition_physical_tier = null, windowDays = 180 } = {}) {
  const safeWindowDays = clampInt(windowDays, { min: 7, max: 365, fallback: 180 });
  const sinceDate = isoDateUtc(new Date(Date.now() - safeWindowDays * 24 * 60 * 60 * 1000));

  const res = await pool.query(
    `
    SELECT
      observed_date,
      sample_size::int AS sample_size,
      min::float8 AS min,
      p25::float8 AS p25,
      median::float8 AS median,
      p75::float8 AS p75,
      max::float8 AS max,
      computed_at,
      method,
      country,
      condition_physical_tier
    FROM price_observations
    WHERE
      camera_id = $1
      AND currency = $2
      AND region IS NULL
      AND ((country IS NULL AND $3::char(2) IS NULL) OR country = $3::char(2))
      AND (
        (condition_physical_tier IS NULL AND $4::condition_physical_tier_enum IS NULL)
        OR condition_physical_tier = $4::condition_physical_tier_enum
      )
      AND observed_date >= $5::date
    ORDER BY observed_date DESC
    LIMIT 365
    `,
    [cameraId, currency, country, condition_physical_tier, sinceDate],
  );

  return { window_days: safeWindowDays, since_date_utc: sinceDate, rows: res.rows };
}

export async function listLensPriceHistory(pool, { lensId, currency, country = null, condition_physical_tier = null, windowDays = 180 } = {}) {
  const safeWindowDays = clampInt(windowDays, { min: 7, max: 365, fallback: 180 });
  const sinceDate = isoDateUtc(new Date(Date.now() - safeWindowDays * 24 * 60 * 60 * 1000));

  const res = await pool.query(
    `
    SELECT
      observed_date,
      sample_size::int AS sample_size,
      min::float8 AS min,
      p25::float8 AS p25,
      median::float8 AS median,
      p75::float8 AS p75,
      max::float8 AS max,
      computed_at,
      method,
      country,
      condition_physical_tier
    FROM lens_price_observations
    WHERE
      lens_id = $1
      AND currency = $2
      AND region IS NULL
      AND ((country IS NULL AND $3::char(2) IS NULL) OR country = $3::char(2))
      AND (
        (condition_physical_tier IS NULL AND $4::condition_physical_tier_enum IS NULL)
        OR condition_physical_tier = $4::condition_physical_tier_enum
      )
      AND observed_date >= $5::date
    ORDER BY observed_date DESC
    LIMIT 365
    `,
    [lensId, currency, country, condition_physical_tier, sinceDate],
  );

  return { window_days: safeWindowDays, since_date_utc: sinceDate, rows: res.rows };
}

