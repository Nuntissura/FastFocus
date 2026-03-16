function clampInt(value, { min, max, fallback }) {
  if (value === null || value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function parseLimitOffset(url) {
  const limit = clampInt(url.searchParams.get("limit"), { min: 1, max: 200, fallback: 50 });
  const offset = clampInt(url.searchParams.get("offset"), { min: 0, max: 1_000_000, fallback: 0 });
  return { limit, offset };
}

function isSlug(value) {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+){0,127}$/.test(value);
}

function isUuid(value) {
  return (
    typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function isMountCode(value) {
  return typeof value === "string" && /^[a-z0-9_]{2,40}$/.test(value);
}

function isMarketplaceCode(value) {
  return typeof value === "string" && /^[a-z0-9_]{2,32}$/.test(value);
}

function isCurrency(value) {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value);
}

export async function listBrands(pool, { limit, offset }) {
  const res = await pool.query(
    `
    SELECT brand_id, slug, name, created_at, updated_at
    FROM brands
    ORDER BY name ASC
    LIMIT $1 OFFSET $2
    `,
    [limit, offset],
  );
  return res.rows;
}

export async function getBrandBySlug(pool, { slug }) {
  if (!isSlug(slug)) return null;
  const res = await pool.query(
    `
    SELECT brand_id, slug, name, created_at, updated_at
    FROM brands
    WHERE slug = $1
    LIMIT 1
    `,
    [slug],
  );
  return res.rows[0] || null;
}

export async function listMarketplaces(pool) {
  const res = await pool.query(
    `
    SELECT
      m.marketplace_code,
      m.display_name,
      m.affiliate_supported,
      COALESCE(ls.active_listing_count, 0)::int AS active_listing_count,
      ls.last_retrieved_at AS last_listing_retrieved_at,
      ir.started_at AS last_run_started_at,
      ir.ended_at AS last_run_ended_at,
      ir.status AS last_run_status
    FROM marketplaces m
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) FILTER (WHERE l.is_active = TRUE)::int AS active_listing_count,
        MAX(l.last_retrieved_at) AS last_retrieved_at
      FROM listings l
      WHERE l.marketplace_code = m.marketplace_code
    ) ls ON TRUE
    LEFT JOIN LATERAL (
      SELECT started_at, ended_at, status
      FROM ingestion_runs r
      WHERE r.marketplace_code = m.marketplace_code
      ORDER BY started_at DESC
      LIMIT 1
    ) ir ON TRUE
    ORDER BY m.marketplace_code ASC
    `,
  );
  return res.rows;
}

export function parseCameraListFilters(url) {
  const brand = url.searchParams.get("brand");
  const captureMedium = url.searchParams.get("capture_medium");
  const mount = url.searchParams.get("mount");
  const q = url.searchParams.get("q");

  return {
    brand: brand && isSlug(brand) ? brand : null,
    captureMedium: captureMedium === "digital" || captureMedium === "film" ? captureMedium : null,
    mount: mount && isMountCode(mount) ? mount : null,
    q: q && typeof q === "string" && q.trim().length <= 80 ? q.trim() : null,
  };
}

export async function listCameras(pool, { limit, offset, filters }) {
  const where = [];
  const params = [];

  const pushParam = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (filters.brand) where.push(`b.slug = ${pushParam(filters.brand)}`);
  if (filters.captureMedium) where.push(`cm.capture_medium = ${pushParam(filters.captureMedium)}`);
  if (filters.mount) where.push(`cm.mount_code = ${pushParam(filters.mount)}`);
  if (filters.q) where.push(`cm.display_name ILIKE ${pushParam(`%${filters.q}%`)}`);

  params.push(limit);
  const limitParam = `$${params.length}`;
  params.push(offset);
  const offsetParam = `$${params.length}`;

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  const res = await pool.query(
    `
    SELECT
      cm.camera_id,
      cm.slug,
      cm.display_name,
      b.brand_id,
      b.slug AS brand_slug,
      b.name AS brand_name,
      cm.capture_medium,
      cm.camera_category,
      cm.lens_system_type,
      cm.mount_code,
      cm.announce_date,
      cm.release_year,
      cm.msrp_amount::float8 AS msrp_amount,
      cm.msrp_currency,
      cm.sensor_format,
      cm.resolution_mp::float8 AS resolution_mp,
      cm.ibis,
      cm.video_max,
      cm.weight_g,
      cm.weather_sealed,
      cm.created_at,
      cm.updated_at
    FROM camera_models cm
    JOIN brands b ON b.brand_id = cm.brand_id
    ${whereSql}
    ORDER BY cm.release_year DESC NULLS LAST, cm.display_name ASC
    LIMIT ${limitParam} OFFSET ${offsetParam}
    `,
    params,
  );

  return res.rows;
}

export async function getCameraBySlug(pool, { slug }) {
  if (!isSlug(slug)) return null;
  const res = await pool.query(
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
  return res.rows[0] || null;
}

export function parseLensListFilters(url) {
  const brand = url.searchParams.get("brand");
  const mount = url.searchParams.get("mount");
  const category = url.searchParams.get("category");
  const q = url.searchParams.get("q");

  return {
    brand: brand && isSlug(brand) ? brand : null,
    mount: mount && isMountCode(mount) ? mount : null,
    category: category && ["prime", "zoom", "teleconverter", "other"].includes(category) ? category : null,
    q: q && typeof q === "string" && q.trim().length <= 80 ? q.trim() : null,
  };
}

export async function listLenses(pool, { limit, offset, filters }) {
  const where = [];
  const params = [];

  const pushParam = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (filters.brand) where.push(`b.slug = ${pushParam(filters.brand)}`);
  if (filters.mount) where.push(`lm.mount_code = ${pushParam(filters.mount)}`);
  if (filters.category) where.push(`lm.lens_category = ${pushParam(filters.category)}`);
  if (filters.q) where.push(`lm.display_name ILIKE ${pushParam(`%${filters.q}%`)}`);

  params.push(limit);
  const limitParam = `$${params.length}`;
  params.push(offset);
  const offsetParam = `$${params.length}`;

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  const res = await pool.query(
    `
    SELECT
      lm.lens_id,
      lm.slug,
      lm.display_name,
      b.brand_id,
      b.slug AS brand_slug,
      b.name AS brand_name,
      lm.mount_code,
      lm.coverage_format,
      lm.lens_category,
      lm.focal_length_min_mm,
      lm.focal_length_max_mm,
      lm.max_aperture_wide_f::float8 AS max_aperture_wide_f,
      lm.max_aperture_tele_f::float8 AS max_aperture_tele_f,
      lm.has_is,
      lm.release_year,
      lm.announce_date,
      lm.weight_g,
      lm.weather_sealed,
      lm.created_at,
      lm.updated_at
    FROM lens_models lm
    JOIN brands b ON b.brand_id = lm.brand_id
    ${whereSql}
    ORDER BY lm.release_year DESC NULLS LAST, lm.display_name ASC
    LIMIT ${limitParam} OFFSET ${offsetParam}
    `,
    params,
  );

  return res.rows;
}

export async function getLensBySlug(pool, { slug }) {
  if (!isSlug(slug)) return null;
  const res = await pool.query(
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
  return res.rows[0] || null;
}

export async function getListingById(pool, { listingId }) {
  if (!isUuid(listingId)) return null;
  const res = await pool.query(
    `
    SELECT
      l.listing_id,
      l.marketplace_code,
      m.display_name AS marketplace_display_name,
      m.affiliate_supported,
      m.affiliate_params_template AS marketplace_affiliate_params_template,
      m.is_sponsored AS marketplace_is_sponsored,
      m.sponsored_label AS marketplace_sponsored_label,
      l.source_item_id,
      l.url,
      l.title,
      l.last_retrieved_at,
      l.is_active,
      l.camera_id,
      cm.slug AS camera_slug,
      l.lens_id,
      lm.slug AS lens_slug,
      l.match_status,
      l.match_confidence::float8 AS match_confidence,
      l.match_method,
      l.price_amount::float8 AS price_amount,
      l.price_currency,
      l.shipping_amount::float8 AS shipping_amount,
      l.shipping_currency,
      l.fees_included,
      l.condition_raw,
      l.condition_physical_tier,
      l.functional_status,
      l.seller_type,
      l.seller_id,
      l.seller_rating::float8 AS seller_rating,
      l.country,
      l.region,
      l.city,
      l.pickup_possible,
      l.included_items,
      l.extracted_attributes,
      l.media,
      l.deal_score::float8 AS deal_score,
      l.deal_score_version,
      l.deal_score_confidence::float8 AS deal_score_confidence,
      l.deal_score_breakdown,
      l.deal_score_computed_at,
      l.raw_ref,
      l.first_seen_at,
      l.last_seen_at,
      l.created_at,
      l.updated_at
    FROM listings l
    JOIN marketplaces m ON m.marketplace_code = l.marketplace_code
    LEFT JOIN camera_models cm ON cm.camera_id = l.camera_id
    LEFT JOIN lens_models lm ON lm.lens_id = l.lens_id
    WHERE l.listing_id = $1
    LIMIT 1
    `,
    [listingId],
  );
  return res.rows[0] || null;
}

export function parseListingsFilters(url) {
  const activeRaw = url.searchParams.get("active");
  const cameraSlug = url.searchParams.get("camera_slug");
  const lensSlug = url.searchParams.get("lens_slug");
  const marketplace = url.searchParams.get("marketplace");
  const currency = url.searchParams.get("currency");

  return {
    active: activeRaw === null ? true : activeRaw === "true",
    cameraSlug: cameraSlug && isSlug(cameraSlug) ? cameraSlug : null,
    lensSlug: lensSlug && isSlug(lensSlug) ? lensSlug : null,
    marketplace: marketplace && isMarketplaceCode(marketplace) ? marketplace : null,
    currency: currency && isCurrency(currency) ? currency : null,
  };
}

export async function listListings(pool, { limit, offset, filters }) {
  const where = [];
  const params = [];

  const pushParam = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (filters.active) where.push("l.is_active = TRUE");
  if (filters.marketplace) where.push(`l.marketplace_code = ${pushParam(filters.marketplace)}`);
  if (filters.currency) where.push(`l.price_currency = ${pushParam(filters.currency)}`);
  if (filters.cameraSlug) where.push(`cm.slug = ${pushParam(filters.cameraSlug)}`);
  if (filters.lensSlug) where.push(`lm.slug = ${pushParam(filters.lensSlug)}`);

  params.push(limit);
  const limitParam = `$${params.length}`;
  params.push(offset);
  const offsetParam = `$${params.length}`;

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  const res = await pool.query(
    `
    SELECT
      l.listing_id,
      l.marketplace_code,
      m.display_name AS marketplace_display_name,
      m.affiliate_supported,
      l.source_item_id,
      l.url,
      l.title,
      l.last_retrieved_at,
      l.is_active,
      l.camera_id,
      cm.slug AS camera_slug,
      b.slug AS brand_slug,
      l.lens_id,
      lm.slug AS lens_slug,
      lb.slug AS lens_brand_slug,
      l.match_status,
      l.match_confidence::float8 AS match_confidence,
      l.match_method,
      l.price_amount::float8 AS price_amount,
      l.price_currency,
      l.shipping_amount::float8 AS shipping_amount,
      l.shipping_currency,
      l.fees_included,
      l.condition_raw,
      l.condition_physical_tier,
      l.functional_status,
      l.seller_type,
      l.seller_id,
      l.seller_rating::float8 AS seller_rating,
      l.country,
      l.region,
      l.city,
      l.pickup_possible,
      l.media,
      l.deal_score::float8 AS deal_score,
      l.deal_score_version,
      l.deal_score_confidence::float8 AS deal_score_confidence,
      l.deal_score_computed_at,
      l.first_seen_at,
      l.last_seen_at,
      l.created_at,
      l.updated_at
    FROM listings l
    JOIN marketplaces m ON m.marketplace_code = l.marketplace_code
    LEFT JOIN camera_models cm ON cm.camera_id = l.camera_id
    LEFT JOIN brands b ON b.brand_id = cm.brand_id
    LEFT JOIN lens_models lm ON lm.lens_id = l.lens_id
    LEFT JOIN brands lb ON lb.brand_id = lm.brand_id
    ${whereSql}
    ORDER BY l.last_seen_at DESC
    LIMIT ${limitParam} OFFSET ${offsetParam}
    `,
    params,
  );

  return res.rows;
}

export async function listIngestionRuns(pool, { limit, offset }) {
  const res = await pool.query(
    `
    SELECT
      run_id,
      job_name,
      marketplace_code,
      started_at,
      ended_at,
      status,
      stats,
      error,
      created_at
    FROM ingestion_runs
    ORDER BY started_at DESC
    LIMIT $1 OFFSET $2
    `,
    [limit, offset],
  );
  return res.rows;
}

export async function listAuditLog(pool, { limit, offset }) {
  const res = await pool.query(
    `
    SELECT
      audit_id,
      actor_type,
      actor_id,
      action,
      entity_type,
      entity_id,
      diff,
      created_at
    FROM audit_log
    ORDER BY created_at DESC
    LIMIT $1 OFFSET $2
    `,
    [limit, offset],
  );
  return res.rows;
}
