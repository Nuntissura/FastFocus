function isSlug(value) {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+){0,127}$/.test(value);
}

function isCurrency(value) {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value);
}

function isCountryCode(value) {
  return typeof value === "string" && /^[A-Z]{2}$/.test(value);
}

function isConditionTier(value) {
  return (
    typeof value === "string" &&
    ["new", "like_new", "used_excellent", "used_good", "used_fair", "for_parts"].includes(value)
  );
}

export function parseModelPageParams(url) {
  const currency = url.searchParams.get("currency");
  const country = url.searchParams.get("country");
  const condition = url.searchParams.get("condition");
  return {
    currency: currency && isCurrency(currency) ? currency : "EUR",
    country: country && isCountryCode(country) ? country : null,
    condition_physical_tier: condition && isConditionTier(condition) ? condition : null,
  };
}

function observationAttempts({ country, condition_physical_tier }) {
  const attempts = [];
  const seen = new Set();

  const push = (c, t) => {
    const key = `${c || ""}|${t || ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    attempts.push({ country: c, condition_physical_tier: t });
  };

  push(country, condition_physical_tier);
  if (condition_physical_tier !== null) push(country, null);
  if (country !== null) push(null, condition_physical_tier);
  if (country !== null || condition_physical_tier !== null) push(null, null);

  return attempts;
}

async function getLatestCameraObservation(pool, { cameraId, currency, country, condition_physical_tier }) {
  for (const attempt of observationAttempts({ country, condition_physical_tier })) {
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
      ORDER BY observed_date DESC, computed_at DESC
      LIMIT 1
      `,
      [cameraId, currency, attempt.country, attempt.condition_physical_tier],
    );
    const row = res.rows[0] || null;
    if (row) return row;
  }
  return null;
}

async function getLatestLensObservation(pool, { lensId, currency, country, condition_physical_tier }) {
  for (const attempt of observationAttempts({ country, condition_physical_tier })) {
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
      ORDER BY observed_date DESC, computed_at DESC
      LIMIT 1
      `,
      [lensId, currency, attempt.country, attempt.condition_physical_tier],
    );
    const row = res.rows[0] || null;
    if (row) return row;
  }
  return null;
}

export async function getCameraModelPage(pool, { slug, currency, country = null, condition_physical_tier = null }) {
  if (!isSlug(slug)) return null;
  const safeCountry = country && isCountryCode(country) ? country : null;
  const safeCondition = condition_physical_tier && isConditionTier(condition_physical_tier) ? condition_physical_tier : null;

  const cameraRes = await pool.query(
    `
    SELECT
      cm.*,
      b.slug AS brand_slug,
      b.name AS brand_name
    FROM camera_models cm
    JOIN brands b ON b.brand_id = cm.brand_id
    WHERE cm.slug = $1
    LIMIT 1
    `,
    [slug],
  );
  const camera = cameraRes.rows[0] || null;
  if (!camera) return null;

  const listingCountsRes = await pool.query(
    `
    SELECT
      marketplace_code,
      COUNT(*)::int AS listing_count,
      MAX(last_retrieved_at) AS last_retrieved_at
    FROM listings
    WHERE
      camera_id = $1
      AND is_active = TRUE
      AND match_status IN ('matched','verified')
    GROUP BY marketplace_code
    ORDER BY listing_count DESC
    `,
    [camera.camera_id],
  );

  const lastUpdatedAt = listingCountsRes.rows.reduce((max, row) => {
    const ts = row.last_retrieved_at ? new Date(row.last_retrieved_at).toISOString() : null;
    if (!ts) return max;
    if (!max) return ts;
    return ts > max ? ts : max;
  }, null);

  const obs = await getLatestCameraObservation(pool, {
    cameraId: camera.camera_id,
    currency,
    country: safeCountry,
    condition_physical_tier: safeCondition,
  });

  const priceBandRes = await pool.query(
    `
    SELECT
      COUNT(*)::int AS sample_size,
      MIN(price_amount)::float8 AS min,
      percentile_cont(0.25) WITHIN GROUP (ORDER BY price_amount)::float8 AS p25,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY price_amount)::float8 AS median,
      percentile_cont(0.75) WITHIN GROUP (ORDER BY price_amount)::float8 AS p75,
      MAX(price_amount)::float8 AS max,
      MAX(last_retrieved_at) AS as_of
    FROM listings
    WHERE
      camera_id = $1
      AND is_active = TRUE
      AND match_status IN ('matched','verified')
      AND price_currency = $2
      AND ($3::char(2) IS NULL OR country = $3::char(2))
      AND ($4::condition_physical_tier_enum IS NULL OR condition_physical_tier = $4::condition_physical_tier_enum)
    `,
    [camera.camera_id, currency, safeCountry, safeCondition],
  );

  const pb = priceBandRes.rows[0] || null;
  const priceBand =
    obs && obs.sample_size > 0
      ? {
          currency,
          sample_size: obs.sample_size,
          min: obs.min,
          p25: obs.p25,
          median: obs.median,
          p75: obs.p75,
          max: obs.max,
          observed_date: obs.observed_date ? String(obs.observed_date) : null,
          as_of: obs.computed_at ? new Date(obs.computed_at).toISOString() : null,
          method: obs.method || null,
          country: obs.country || null,
          condition_physical_tier: obs.condition_physical_tier || null,
        }
      : pb && pb.sample_size > 0
        ? {
            currency,
            sample_size: pb.sample_size,
            min: pb.min,
            p25: pb.p25,
            median: pb.median,
            p75: pb.p75,
            max: pb.max,
            as_of: pb.as_of ? new Date(pb.as_of).toISOString() : null,
            method: "live_listings_percentiles_v0",
            country: safeCountry,
            condition_physical_tier: safeCondition,
          }
      : null;

  const listingsRes = await pool.query(
    `
    SELECT
      l.listing_id,
      l.marketplace_code,
      m.display_name AS marketplace_display_name,
      m.is_sponsored AS marketplace_is_sponsored,
      m.sponsored_label AS marketplace_sponsored_label,
      m.sponsored_rank AS marketplace_sponsored_rank,
      l.source_item_id,
      l.url,
      l.title,
      l.last_retrieved_at,
      l.price_amount::float8 AS price_amount,
      l.price_currency,
      l.shipping_amount::float8 AS shipping_amount,
      l.shipping_currency,
      l.fees_included,
      l.condition_physical_tier,
      l.functional_status,
      l.seller_type,
      l.seller_rating::float8 AS seller_rating,
      l.country,
      l.region,
      l.city,
      l.pickup_possible,
      l.match_status,
      l.deal_score::float8 AS deal_score,
      l.deal_score_version,
      l.deal_score_confidence::float8 AS deal_score_confidence
    FROM listings l
    JOIN marketplaces m ON m.marketplace_code = l.marketplace_code
    WHERE
      l.camera_id = $1
      AND l.is_active = TRUE
      AND l.match_status IN ('matched','verified')
    ORDER BY
      m.is_sponsored DESC,
      m.sponsored_rank DESC,
      l.deal_score DESC NULLS LAST,
      l.last_retrieved_at DESC
    LIMIT 25
    `,
    [camera.camera_id],
  );

  return {
    camera,
    listing_counts_by_source: listingCountsRes.rows.map((r) => ({
      marketplace_code: r.marketplace_code,
      listing_count: r.listing_count,
      last_retrieved_at: r.last_retrieved_at ? new Date(r.last_retrieved_at).toISOString() : null,
    })),
    last_updated_at: lastUpdatedAt,
    price_band: priceBand,
    listings: listingsRes.rows.map((r) => ({
      listing_id: r.listing_id,
      marketplace_code: r.marketplace_code,
      marketplace_display_name: r.marketplace_display_name,
      marketplace_is_sponsored: Boolean(r.marketplace_is_sponsored),
      marketplace_sponsored_label: r.marketplace_sponsored_label,
      marketplace_sponsored_rank: Number(r.marketplace_sponsored_rank || 0),
      source_item_id: r.source_item_id,
      url: r.url,
      title: r.title,
      last_retrieved_at: r.last_retrieved_at ? new Date(r.last_retrieved_at).toISOString() : null,
      price_amount: r.price_amount,
      price_currency: r.price_currency,
      shipping_amount: r.shipping_amount,
      shipping_currency: r.shipping_currency,
      fees_included: r.fees_included,
      condition_physical_tier: r.condition_physical_tier,
      functional_status: r.functional_status,
      seller_type: r.seller_type,
      seller_rating: r.seller_rating,
      country: r.country,
      region: r.region,
      city: r.city,
      pickup_possible: r.pickup_possible,
      match_status: r.match_status,
      deal_score: r.deal_score,
      deal_score_version: r.deal_score_version,
      deal_score_confidence: r.deal_score_confidence,
    })),
  };
}

export async function getLensModelPage(pool, { slug, currency, country = null, condition_physical_tier = null }) {
  if (!isSlug(slug)) return null;
  const safeCountry = country && isCountryCode(country) ? country : null;
  const safeCondition = condition_physical_tier && isConditionTier(condition_physical_tier) ? condition_physical_tier : null;

  const lensRes = await pool.query(
    `
    SELECT
      lm.*,
      b.slug AS brand_slug,
      b.name AS brand_name
    FROM lens_models lm
    JOIN brands b ON b.brand_id = lm.brand_id
    WHERE lm.slug = $1
    LIMIT 1
    `,
    [slug],
  );
  const lens = lensRes.rows[0] || null;
  if (!lens) return null;

  const listingCountsRes = await pool.query(
    `
    SELECT
      marketplace_code,
      COUNT(*)::int AS listing_count,
      MAX(last_retrieved_at) AS last_retrieved_at
    FROM listings
    WHERE
      lens_id = $1
      AND is_active = TRUE
      AND match_status IN ('matched','verified')
    GROUP BY marketplace_code
    ORDER BY listing_count DESC
    `,
    [lens.lens_id],
  );

  const lastUpdatedAt = listingCountsRes.rows.reduce((max, row) => {
    const ts = row.last_retrieved_at ? new Date(row.last_retrieved_at).toISOString() : null;
    if (!ts) return max;
    if (!max) return ts;
    return ts > max ? ts : max;
  }, null);

  const obs = await getLatestLensObservation(pool, {
    lensId: lens.lens_id,
    currency,
    country: safeCountry,
    condition_physical_tier: safeCondition,
  });

  const priceBandRes = await pool.query(
    `
    SELECT
      COUNT(*)::int AS sample_size,
      MIN(price_amount)::float8 AS min,
      percentile_cont(0.25) WITHIN GROUP (ORDER BY price_amount)::float8 AS p25,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY price_amount)::float8 AS median,
      percentile_cont(0.75) WITHIN GROUP (ORDER BY price_amount)::float8 AS p75,
      MAX(price_amount)::float8 AS max,
      MAX(last_retrieved_at) AS as_of
    FROM listings
    WHERE
      lens_id = $1
      AND is_active = TRUE
      AND match_status IN ('matched','verified')
      AND price_currency = $2
      AND ($3::char(2) IS NULL OR country = $3::char(2))
      AND ($4::condition_physical_tier_enum IS NULL OR condition_physical_tier = $4::condition_physical_tier_enum)
    `,
    [lens.lens_id, currency, safeCountry, safeCondition],
  );

  const pb = priceBandRes.rows[0] || null;
  const priceBand =
    obs && obs.sample_size > 0
      ? {
          currency,
          sample_size: obs.sample_size,
          min: obs.min,
          p25: obs.p25,
          median: obs.median,
          p75: obs.p75,
          max: obs.max,
          observed_date: obs.observed_date ? String(obs.observed_date) : null,
          as_of: obs.computed_at ? new Date(obs.computed_at).toISOString() : null,
          method: obs.method || null,
          country: obs.country || null,
          condition_physical_tier: obs.condition_physical_tier || null,
        }
      : pb && pb.sample_size > 0
        ? {
            currency,
            sample_size: pb.sample_size,
            min: pb.min,
            p25: pb.p25,
            median: pb.median,
            p75: pb.p75,
            max: pb.max,
            as_of: pb.as_of ? new Date(pb.as_of).toISOString() : null,
            method: "live_listings_percentiles_v0",
            country: safeCountry,
            condition_physical_tier: safeCondition,
          }
      : null;

  const listingsRes = await pool.query(
    `
    SELECT
      l.listing_id,
      l.marketplace_code,
      m.display_name AS marketplace_display_name,
      m.is_sponsored AS marketplace_is_sponsored,
      m.sponsored_label AS marketplace_sponsored_label,
      m.sponsored_rank AS marketplace_sponsored_rank,
      l.source_item_id,
      l.url,
      l.title,
      l.last_retrieved_at,
      l.price_amount::float8 AS price_amount,
      l.price_currency,
      l.shipping_amount::float8 AS shipping_amount,
      l.shipping_currency,
      l.fees_included,
      l.condition_physical_tier,
      l.functional_status,
      l.seller_type,
      l.seller_rating::float8 AS seller_rating,
      l.country,
      l.region,
      l.city,
      l.pickup_possible,
      l.match_status,
      l.deal_score::float8 AS deal_score,
      l.deal_score_version,
      l.deal_score_confidence::float8 AS deal_score_confidence
    FROM listings l
    JOIN marketplaces m ON m.marketplace_code = l.marketplace_code
    WHERE
      l.lens_id = $1
      AND l.is_active = TRUE
      AND l.match_status IN ('matched','verified')
    ORDER BY
      m.is_sponsored DESC,
      m.sponsored_rank DESC,
      l.deal_score DESC NULLS LAST,
      l.last_retrieved_at DESC
    LIMIT 25
    `,
    [lens.lens_id],
  );

  return {
    lens,
    listing_counts_by_source: listingCountsRes.rows.map((r) => ({
      marketplace_code: r.marketplace_code,
      listing_count: r.listing_count,
      last_retrieved_at: r.last_retrieved_at ? new Date(r.last_retrieved_at).toISOString() : null,
    })),
    last_updated_at: lastUpdatedAt,
    price_band: priceBand,
    listings: listingsRes.rows.map((r) => ({
      listing_id: r.listing_id,
      marketplace_code: r.marketplace_code,
      marketplace_display_name: r.marketplace_display_name,
      marketplace_is_sponsored: Boolean(r.marketplace_is_sponsored),
      marketplace_sponsored_label: r.marketplace_sponsored_label,
      marketplace_sponsored_rank: Number(r.marketplace_sponsored_rank || 0),
      source_item_id: r.source_item_id,
      url: r.url,
      title: r.title,
      last_retrieved_at: r.last_retrieved_at ? new Date(r.last_retrieved_at).toISOString() : null,
      price_amount: r.price_amount,
      price_currency: r.price_currency,
      shipping_amount: r.shipping_amount,
      shipping_currency: r.shipping_currency,
      fees_included: r.fees_included,
      condition_physical_tier: r.condition_physical_tier,
      functional_status: r.functional_status,
      seller_type: r.seller_type,
      seller_rating: r.seller_rating,
      country: r.country,
      region: r.region,
      city: r.city,
      pickup_possible: r.pickup_possible,
      match_status: r.match_status,
      deal_score: r.deal_score,
      deal_score_version: r.deal_score_version,
      deal_score_confidence: r.deal_score_confidence,
    })),
  };
}
