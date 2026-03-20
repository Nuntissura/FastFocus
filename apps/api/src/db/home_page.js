function isMarketplaceCode(value) {
  return typeof value === "string" && /^[a-z0-9_]{2,32}$/.test(value);
}

function toIso(value) {
  return value ? new Date(value).toISOString() : null;
}

function mapListingRow(row) {
  return {
    listing_id: row.listing_id,
    marketplace_code: row.marketplace_code,
    marketplace_display_name: row.marketplace_display_name,
    camera_slug: row.camera_slug,
    camera_display_name: row.camera_display_name,
    brand_name: row.brand_name,
    title: row.title,
    price_amount: row.price_amount,
    price_currency: row.price_currency,
    shipping_amount: row.shipping_amount,
    shipping_currency: row.shipping_currency,
    condition_physical_tier: row.condition_physical_tier,
    deal_score: row.deal_score,
    last_retrieved_at: toIso(row.last_retrieved_at),
    first_visible_at: toIso(row.first_visible_at),
  };
}

export async function getHomepageMarketHighlights(
  pool,
  { marketplaceCode = "ebay", limitDeals = 6, limitRecent = 6, limitCameras = 6 } = {},
) {
  const safeMarketplaceCode = isMarketplaceCode(marketplaceCode) ? marketplaceCode : "ebay";

  const topDealsPromise = pool.query(
    `
    SELECT
      l.listing_id,
      l.marketplace_code,
      m.display_name AS marketplace_display_name,
      cm.slug AS camera_slug,
      cm.display_name AS camera_display_name,
      b.name AS brand_name,
      l.title,
      l.price_amount::float8 AS price_amount,
      l.price_currency,
      l.shipping_amount::float8 AS shipping_amount,
      l.shipping_currency,
      l.condition_physical_tier,
      l.deal_score::float8 AS deal_score,
      l.last_retrieved_at,
      COALESCE(l.first_seen_at, l.last_seen_at, l.last_retrieved_at) AS first_visible_at
    FROM listings l
    JOIN marketplaces m ON m.marketplace_code = l.marketplace_code
    JOIN camera_models cm ON cm.camera_id = l.camera_id
    JOIN brands b ON b.brand_id = cm.brand_id
    WHERE
      l.marketplace_code = $1
      AND l.is_active = TRUE
      AND l.match_status IN ('matched','verified')
      AND l.camera_id IS NOT NULL
    ORDER BY l.deal_score DESC NULLS LAST, l.last_retrieved_at DESC, l.listing_id ASC
    LIMIT $2
    `,
    [safeMarketplaceCode, limitDeals],
  );

  const recentArrivalsPromise = pool.query(
    `
    SELECT
      l.listing_id,
      l.marketplace_code,
      m.display_name AS marketplace_display_name,
      cm.slug AS camera_slug,
      cm.display_name AS camera_display_name,
      b.name AS brand_name,
      l.title,
      l.price_amount::float8 AS price_amount,
      l.price_currency,
      l.shipping_amount::float8 AS shipping_amount,
      l.shipping_currency,
      l.condition_physical_tier,
      l.deal_score::float8 AS deal_score,
      l.last_retrieved_at,
      COALESCE(l.first_seen_at, l.last_seen_at, l.last_retrieved_at) AS first_visible_at
    FROM listings l
    JOIN marketplaces m ON m.marketplace_code = l.marketplace_code
    JOIN camera_models cm ON cm.camera_id = l.camera_id
    JOIN brands b ON b.brand_id = cm.brand_id
    WHERE
      l.marketplace_code = $1
      AND l.is_active = TRUE
      AND l.match_status IN ('matched','verified')
      AND l.camera_id IS NOT NULL
    ORDER BY COALESCE(l.first_seen_at, l.last_seen_at, l.last_retrieved_at) DESC, l.deal_score DESC NULLS LAST, l.listing_id ASC
    LIMIT $2
    `,
    [safeMarketplaceCode, limitRecent],
  );

  const cameraCoveragePromise = pool.query(
    `
    SELECT
      cm.slug AS camera_slug,
      cm.display_name AS camera_display_name,
      b.slug AS brand_slug,
      b.name AS brand_name,
      COUNT(*)::int AS active_listing_count,
      COUNT(*) FILTER (
        WHERE COALESCE(l.first_seen_at, l.last_seen_at, l.last_retrieved_at) >= NOW() - INTERVAL '7 days'
      )::int AS recent_listing_count_7d,
      MAX(l.last_retrieved_at) AS last_retrieved_at,
      MAX(l.deal_score)::float8 AS best_deal_score
    FROM listings l
    JOIN camera_models cm ON cm.camera_id = l.camera_id
    JOIN brands b ON b.brand_id = cm.brand_id
    WHERE
      l.marketplace_code = $1
      AND l.is_active = TRUE
      AND l.match_status IN ('matched','verified')
      AND l.camera_id IS NOT NULL
    GROUP BY cm.camera_id, cm.slug, cm.display_name, b.slug, b.name
    ORDER BY active_listing_count DESC, recent_listing_count_7d DESC, MAX(l.last_retrieved_at) DESC, cm.display_name ASC
    LIMIT $2
    `,
    [safeMarketplaceCode, limitCameras],
  );

  const [topDealsRes, recentArrivalsRes, cameraCoverageRes] = await Promise.all([
    topDealsPromise,
    recentArrivalsPromise,
    cameraCoveragePromise,
  ]);

  return {
    marketplace_code: safeMarketplaceCode,
    top_deals: topDealsRes.rows.map(mapListingRow),
    recent_arrivals: recentArrivalsRes.rows.map(mapListingRow),
    camera_coverage: cameraCoverageRes.rows.map((row) => ({
      slug: row.camera_slug,
      display_name: row.camera_display_name,
      brand_slug: row.brand_slug,
      brand_name: row.brand_name,
      active_listing_count: row.active_listing_count,
      recent_listing_count_7d: row.recent_listing_count_7d,
      best_deal_score: row.best_deal_score,
      last_retrieved_at: toIso(row.last_retrieved_at),
    })),
  };
}
