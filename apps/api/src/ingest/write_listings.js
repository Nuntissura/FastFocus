function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonb(value, label) {
  if (value === null || value === undefined) return "{}";
  if (typeof value === "string") return value;
  if (Array.isArray(value) || isPlainObject(value)) return JSON.stringify(value);
  throw new Error(`Invalid JSON value for ${label}`);
}

function clampText(value, { max, fallback = null } = {}) {
  if (value === null || value === undefined) return fallback;
  const s = String(value);
  if (!s.trim()) return fallback;
  return s.length > max ? s.slice(0, max) : s;
}

function safeNumber(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function validateListing(l) {
  assert(l && typeof l === "object", "Listing must be an object.");
  assert(typeof l.marketplace_code === "string" && /^[a-z0-9_]{2,32}$/.test(l.marketplace_code), "Invalid marketplace_code.");
  assert(typeof l.source_item_id === "string" && l.source_item_id.length >= 1 && l.source_item_id.length <= 128, "Invalid source_item_id.");
  assert(typeof l.url === "string" && l.url.length <= 2048, "Invalid url.");
  assert(typeof l.title === "string" && l.title.length >= 1 && l.title.length <= 256, "Invalid title.");
  assert(typeof l.last_retrieved_at === "string" && l.last_retrieved_at.includes("T"), "Invalid last_retrieved_at.");
  assert(typeof l.is_active === "boolean", "Invalid is_active.");
  assert(Number.isFinite(Number(l.price_amount)), "Invalid price_amount.");
  assert(typeof l.price_currency === "string" && /^[A-Z]{3}$/.test(l.price_currency), "Invalid price_currency.");
  assert(typeof l.fees_included === "boolean", "Invalid fees_included.");
  assert(typeof l.condition_physical_tier === "string", "Invalid condition_physical_tier.");
  assert(typeof l.functional_status === "string", "Invalid functional_status.");
  assert(typeof l.seller_type === "string", "Invalid seller_type.");
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

async function upsertListing(client, listing) {
  validateListing(listing);

  const res = await client.query(
    `
    INSERT INTO listings (
      marketplace_code,
      source_item_id,
      url,
      title,
      last_retrieved_at,
      is_active,
      camera_id,
      lens_id,
      match_status,
      match_confidence,
      match_method,
      price_amount,
      price_currency,
      shipping_amount,
      shipping_currency,
      fees_included,
      condition_raw,
      condition_physical_tier,
      functional_status,
      seller_type,
      seller_id,
      seller_rating,
      country,
      region,
      city,
      pickup_possible,
      included_items,
      extracted_attributes,
      media,
      raw_ref,
      first_seen_at,
      last_seen_at
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,
      NULL,NULL,'unmatched',0.00,NULL,
      $7,$8,$9,$10,$11,
      $12,$13,$14,$15,$16,$17,
      $18,$19,$20,$21,
      $22::jsonb,$23::jsonb,$24::jsonb,$25::jsonb,
      $26,$27
    )
    ON CONFLICT (marketplace_code, source_item_id) DO UPDATE SET
      url = EXCLUDED.url,
      title = EXCLUDED.title,
      last_retrieved_at = EXCLUDED.last_retrieved_at,
      is_active = EXCLUDED.is_active,
      price_amount = EXCLUDED.price_amount,
      price_currency = EXCLUDED.price_currency,
      shipping_amount = EXCLUDED.shipping_amount,
      shipping_currency = EXCLUDED.shipping_currency,
      fees_included = EXCLUDED.fees_included,
      condition_raw = EXCLUDED.condition_raw,
      condition_physical_tier = EXCLUDED.condition_physical_tier,
      functional_status = EXCLUDED.functional_status,
      seller_type = EXCLUDED.seller_type,
      seller_id = EXCLUDED.seller_id,
      seller_rating = EXCLUDED.seller_rating,
      country = EXCLUDED.country,
      region = EXCLUDED.region,
      city = EXCLUDED.city,
      pickup_possible = EXCLUDED.pickup_possible,
      included_items = EXCLUDED.included_items,
      extracted_attributes = EXCLUDED.extracted_attributes,
      media = EXCLUDED.media,
      raw_ref = EXCLUDED.raw_ref,
      last_seen_at = EXCLUDED.last_seen_at
    RETURNING
      listing_id,
      marketplace_code,
      source_item_id,
      camera_id,
      lens_id,
      match_status,
      match_confidence::float8 AS match_confidence,
      (xmax = 0) AS inserted
    `,
    [
      listing.marketplace_code,
      listing.source_item_id,
      listing.url,
      listing.title,
      listing.last_retrieved_at,
      listing.is_active,
      listing.price_amount,
      listing.price_currency,
      safeNumber(listing.shipping_amount, null),
      clampText(listing.shipping_currency, { max: 3, fallback: null }),
      listing.fees_included,
      clampText(listing.condition_raw, { max: 128, fallback: null }),
      listing.condition_physical_tier,
      listing.functional_status,
      listing.seller_type,
      clampText(listing.seller_id, { max: 128, fallback: null }),
      safeNumber(listing.seller_rating, null),
      clampText(listing.country, { max: 2, fallback: null }),
      clampText(listing.region, { max: 128, fallback: null }),
      clampText(listing.city, { max: 128, fallback: null }),
      listing.pickup_possible === undefined ? null : listing.pickup_possible,
      jsonb(listing.included_items || [], "included_items"),
      jsonb(listing.extracted_attributes || [], "extracted_attributes"),
      jsonb(listing.media || [], "media"),
      jsonb(listing.raw_ref || {}, "raw_ref"),
      listing.first_seen_at || listing.last_retrieved_at,
      listing.last_seen_at || listing.last_retrieved_at,
    ],
  );

  return res.rows[0];
}

async function insertSnapshot(client, { listingRow, retrievedAt, listing, snapshot }) {
  await client.query(
    `
    INSERT INTO listing_snapshots (
      listing_id,
      marketplace_code,
      source_item_id,
      retrieved_at,
      is_active,
      camera_id,
      lens_id,
      price_amount,
      price_currency,
      condition_physical_tier,
      functional_status,
      snapshot
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
    `,
    [
      listingRow.listing_id,
      listingRow.marketplace_code,
      listingRow.source_item_id,
      retrievedAt,
      listing.is_active,
      listingRow.camera_id,
      listingRow.lens_id,
      listing.price_amount,
      listing.price_currency,
      listing.condition_physical_tier,
      listing.functional_status,
      jsonb(snapshot || listing.snapshot || {}, "snapshot"),
    ],
  );
}

export async function ingestListingsOnce(
  client,
  { jobName, marketplaceCode, marketplaceDisplayName, affiliateSupported, listings, statsExtra = null } = {},
) {
  assert(typeof jobName === "string" && jobName.trim(), "jobName is required.");
  assert(typeof marketplaceCode === "string" && marketplaceCode.trim(), "marketplaceCode is required.");
  assert(Array.isArray(listings), "listings must be an array.");

  const startedAt = new Date().toISOString();

  await ensureMarketplace(client, {
    marketplaceCode,
    displayName: marketplaceDisplayName || marketplaceCode,
    affiliateSupported: Boolean(affiliateSupported),
  });

  const runId = await startIngestionRun(client, { jobName, marketplaceCode, startedAt });

  const stats = {
    marketplace_code: marketplaceCode,
    listings_total: listings.length,
    inserted: 0,
    updated: 0,
    snapshots_inserted: 0,
  };

  if (statsExtra && typeof statsExtra === "object" && !Array.isArray(statsExtra)) {
    for (const [k, v] of Object.entries(statsExtra)) {
      if (Object.prototype.hasOwnProperty.call(stats, k)) continue;
      stats[k] = v;
    }
  }

  try {
    await client.query("BEGIN");

    for (const l of listings) {
      const row = await upsertListing(client, l);
      if (row.inserted) stats.inserted += 1;
      else stats.updated += 1;

      await insertSnapshot(client, { listingRow: row, retrievedAt: l.last_retrieved_at, listing: l });
      stats.snapshots_inserted += 1;
    }

    await client.query("COMMIT");

    await finishIngestionRun(client, { runId, endedAt: new Date().toISOString(), status: "success", stats, error: null });

    return { ok: true, run_id: runId, stats };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore
    }

    await finishIngestionRun(client, {
      runId,
      endedAt: new Date().toISOString(),
      status: "failed",
      stats,
      error: err instanceof Error ? err.message : String(err),
    });

    return { ok: false, run_id: runId, stats, error: err instanceof Error ? err.message : String(err) };
  }
}
