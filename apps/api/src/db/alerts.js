import { randomBytes } from "node:crypto";

function clampText(value, { max }) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function isSlug(value) {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+){0,127}$/.test(value);
}

function isMarketplaceCode(value) {
  return typeof value === "string" && /^[a-z0-9_]{2,32}$/.test(value);
}

function isCurrency(value) {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value);
}

function isCountry(value) {
  return typeof value === "string" && /^[A-Z]{2}$/.test(value);
}

function normalizeEmail(emailRaw) {
  const email = clampText(emailRaw, { max: 254 });
  if (!email) return null;
  const norm = email.toLowerCase();
  if (norm.length < 6) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(norm)) return null;
  return { email, email_norm: norm };
}

function token(bytes = 24) {
  return randomBytes(bytes).toString("base64url");
}

async function getCameraIdBySlug(pool, slug) {
  if (!isSlug(slug)) return null;
  const res = await pool.query(`SELECT camera_id FROM camera_models WHERE slug = $1 LIMIT 1`, [slug]);
  return res.rows[0] ? res.rows[0].camera_id : null;
}

async function getLensIdBySlug(pool, slug) {
  if (!isSlug(slug)) return null;
  const res = await pool.query(`SELECT lens_id FROM lens_models WHERE slug = $1 LIMIT 1`, [slug]);
  return res.rows[0] ? res.rows[0].lens_id : null;
}

async function countActiveSavedSearchesForEmail(pool, emailNorm) {
  const res = await pool.query(
    `
    SELECT COUNT(*)::int AS c
    FROM saved_searches
    WHERE email_norm = $1
      AND unsubscribed_at IS NULL
      AND enabled = TRUE
    `,
    [emailNorm],
  );
  return res.rows[0] ? Number(res.rows[0].c) : 0;
}

async function marketplaceExists(pool, marketplaceCode) {
  if (!marketplaceCode) return false;
  const res = await pool.query(`SELECT 1 FROM marketplaces WHERE marketplace_code = $1 LIMIT 1`, [marketplaceCode]);
  return Boolean(res.rows[0]);
}

export async function createSavedSearch(pool, {
  email,
  camera_slug = null,
  lens_slug = null,
  marketplace = null,
  country = null,
  currency = null,
  max_total_price_amount = null,
  max_total_price_currency = null,
  min_interval_hours = 24,
  max_results_per_email = 10,
  max_saved_searches_per_email = 20,
} = {}) {
  const normalized = normalizeEmail(email);
  if (!normalized) return { ok: false, error: "invalid_email" };

  const activeCount = await countActiveSavedSearchesForEmail(pool, normalized.email_norm);
  if (activeCount >= max_saved_searches_per_email) return { ok: false, error: "limit_reached" };

  const cameraSlug = camera_slug === null ? null : clampText(camera_slug, { max: 160 });
  const lensSlug = lens_slug === null ? null : clampText(lens_slug, { max: 160 });
  const marketplaceCode = marketplace === null ? null : clampText(marketplace, { max: 32 });
  const countryCode = country === null ? null : clampText(country, { max: 2 });
  const currencyCode = currency === null ? null : clampText(currency, { max: 3 });
  const maxCurrency = max_total_price_currency === null ? null : clampText(max_total_price_currency, { max: 3 });

  if (marketplaceCode !== null && !isMarketplaceCode(marketplaceCode)) return { ok: false, error: "invalid_marketplace" };
  if (countryCode !== null && !isCountry(countryCode.toUpperCase())) return { ok: false, error: "invalid_country" };
  if (currencyCode !== null && !isCurrency(currencyCode.toUpperCase())) return { ok: false, error: "invalid_currency" };
  if (maxCurrency !== null && !isCurrency(maxCurrency.toUpperCase())) return { ok: false, error: "invalid_max_total_price_currency" };
  if (currencyCode !== null && maxCurrency !== null && currencyCode.toUpperCase() !== maxCurrency.toUpperCase()) {
    return { ok: false, error: "currency_mismatch" };
  }

  const maxTotalPriceAmount = max_total_price_amount === null ? null : Number(max_total_price_amount);
  if (maxTotalPriceAmount !== null && (!Number.isFinite(maxTotalPriceAmount) || maxTotalPriceAmount < 0)) {
    return { ok: false, error: "invalid_max_total_price_amount" };
  }
  if ((maxTotalPriceAmount === null) !== (maxCurrency === null)) return { ok: false, error: "max_total_price_requires_currency" };

  const minIntervalHours = Number(min_interval_hours);
  if (!Number.isInteger(minIntervalHours) || minIntervalHours < 1 || minIntervalHours > 168) return { ok: false, error: "invalid_min_interval_hours" };

  const maxResultsPerEmail = Number(max_results_per_email);
  if (!Number.isInteger(maxResultsPerEmail) || maxResultsPerEmail < 1 || maxResultsPerEmail > 50) return { ok: false, error: "invalid_max_results_per_email" };

  const cameraId = cameraSlug ? await getCameraIdBySlug(pool, cameraSlug) : null;
  if (cameraSlug && !cameraId) return { ok: false, error: "camera_not_found" };

  const lensId = lensSlug ? await getLensIdBySlug(pool, lensSlug) : null;
  if (lensSlug && !lensId) return { ok: false, error: "lens_not_found" };

  if (!cameraId && !lensId) return { ok: false, error: "missing_target" };

  if (marketplaceCode !== null) {
    const exists = await marketplaceExists(pool, marketplaceCode);
    if (!exists) return { ok: false, error: "marketplace_not_found" };
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const confirmToken = token(24);
    const unsubscribeToken = token(24);

    try {
      const res = await pool.query(
        `
        INSERT INTO saved_searches (
          email,
          email_norm,
          camera_id,
          lens_id,
          marketplace_code,
          country,
          currency,
          max_total_price_amount,
          max_total_price_currency,
          confirm_token,
          unsubscribe_token,
          min_interval_hours,
          max_results_per_email
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        RETURNING *
        `,
        [
          normalized.email,
          normalized.email_norm,
          cameraId,
          lensId,
          marketplaceCode,
          countryCode ? countryCode.toUpperCase() : null,
          currencyCode ? currencyCode.toUpperCase() : null,
          maxTotalPriceAmount,
          maxCurrency ? maxCurrency.toUpperCase() : null,
          confirmToken,
          unsubscribeToken,
          minIntervalHours,
          maxResultsPerEmail,
        ],
      );

      return { ok: true, saved_search: res.rows[0] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("confirm_token") || message.includes("unsubscribe_token")) continue;
      throw err;
    }
  }

  return { ok: false, error: "token_collision" };
}

export async function confirmSavedSearchByToken(pool, { token: confirmToken }) {
  const t = clampText(confirmToken, { max: 96 });
  if (!t || t.length < 16) return { ok: false, error: "invalid_token" };

  const existing = await pool.query(
    `
    SELECT saved_search_id, confirmed_at, unsubscribed_at, email_norm, unsubscribe_token
    FROM saved_searches
    WHERE confirm_token = $1
    LIMIT 1
    `,
    [t],
  );
  const row = existing.rows[0] || null;
  if (!row) return { ok: false, error: "not_found" };
  if (row.unsubscribed_at) return { ok: false, error: "unsubscribed" };
  if (row.confirmed_at) return { ok: true, saved_search: row, already_confirmed: true };

  const res = await pool.query(
    `
    UPDATE saved_searches
    SET confirmed_at = NOW()
    WHERE confirm_token = $1 AND confirmed_at IS NULL AND unsubscribed_at IS NULL
    RETURNING saved_search_id, confirmed_at, unsubscribed_at, email_norm, unsubscribe_token
    `,
    [t],
  );
  const updated = res.rows[0] || null;
  if (!updated) return { ok: false, error: "not_found" };
  return { ok: true, saved_search: updated, already_confirmed: false };
}

export async function unsubscribeSavedSearchByToken(pool, { token: unsubscribeToken }) {
  const t = clampText(unsubscribeToken, { max: 96 });
  if (!t || t.length < 16) return { ok: false, error: "invalid_token" };

  const res = await pool.query(
    `
    UPDATE saved_searches
    SET unsubscribed_at = COALESCE(unsubscribed_at, NOW()), enabled = FALSE
    WHERE unsubscribe_token = $1
    RETURNING saved_search_id, confirmed_at, unsubscribed_at, email_norm
    `,
    [t],
  );
  const row = res.rows[0] || null;
  if (!row) return { ok: false, error: "not_found" };
  return { ok: true, saved_search: row };
}

export async function insertEmailMessage(pool, {
  message_type,
  saved_search_id = null,
  newsletter_subscription_id = null,
  premium_subscription_id = null,
  to_email,
  from_email = null,
  subject,
  body_text,
  status,
  provider = "stdout",
  provider_message_id = null,
  error = null,
  sent_at = null,
} = {}) {
  const res = await pool.query(
    `
    INSERT INTO email_messages (
      message_type,
      saved_search_id,
      newsletter_subscription_id,
      premium_subscription_id,
      to_email,
      from_email,
      subject,
      body_text,
      status,
      provider,
      provider_message_id,
      error,
      sent_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    RETURNING email_message_id
    `,
    [
      message_type,
      saved_search_id,
      newsletter_subscription_id,
      premium_subscription_id,
      to_email,
      from_email,
      subject,
      body_text,
      status,
      provider,
      provider_message_id,
      error,
      sent_at,
    ],
  );
  return res.rows[0];
}

function buildSavedSearchListingWhere({ savedSearch, params }) {
  const where = [];
  const pushParam = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (savedSearch.marketplace_code) where.push(`l.marketplace_code = ${pushParam(savedSearch.marketplace_code)}`);
  if (savedSearch.camera_id) where.push(`l.camera_id = ${pushParam(savedSearch.camera_id)}`);
  if (savedSearch.lens_id) where.push(`l.lens_id = ${pushParam(savedSearch.lens_id)}`);
  if (savedSearch.country) where.push(`l.country = ${pushParam(savedSearch.country)}`);
  if (savedSearch.currency) where.push(`l.price_currency = ${pushParam(savedSearch.currency)}`);

  if (savedSearch.max_total_price_amount !== null && savedSearch.max_total_price_currency) {
    where.push(`l.price_currency = ${pushParam(savedSearch.max_total_price_currency)}`);
    // total = item + shipping (shipping can be null)
    where.push(`(l.price_amount + COALESCE(l.shipping_amount, 0)) <= ${pushParam(savedSearch.max_total_price_amount)}`);
  }

  return where;
}

export async function insertPendingDeliveries(pool, { savedSearch, since, limit = 200 } = {}) {
  const params = [savedSearch.saved_search_id, since];
  const where = buildSavedSearchListingWhere({ savedSearch, params });
  params.push(limit);
  const limitParam = `$${params.length}`;

  const whereSql = where.length > 0 ? `AND ${where.join(" AND ")}` : "";

  const res = await pool.query(
    `
    INSERT INTO saved_search_listing_deliveries (saved_search_id, listing_id)
    SELECT
      $1,
      l.listing_id
    FROM listings l
    LEFT JOIN saved_search_listing_deliveries d
      ON d.saved_search_id = $1 AND d.listing_id = l.listing_id
    WHERE d.listing_id IS NULL
      AND l.is_active = TRUE
      AND l.first_seen_at > $2
      ${whereSql}
    ORDER BY l.first_seen_at ASC
    LIMIT ${limitParam}
    ON CONFLICT DO NOTHING
    RETURNING listing_id
    `,
    params,
  );

  return res.rows.map((r) => r.listing_id);
}

export async function listPendingDeliveries(pool, { savedSearchId, limit = 10 } = {}) {
  const res = await pool.query(
    `
    SELECT
      d.listing_id,
      l.marketplace_code,
      l.url,
      l.title,
      l.price_amount::float8 AS price_amount,
      l.price_currency,
      l.shipping_amount::float8 AS shipping_amount,
      l.shipping_currency,
      l.country,
      l.region,
      l.city,
      l.seller_rating::float8 AS seller_rating,
      l.first_seen_at,
      l.last_seen_at,
      cm.slug AS camera_slug,
      lm.slug AS lens_slug
    FROM saved_search_listing_deliveries d
    JOIN listings l ON l.listing_id = d.listing_id
    LEFT JOIN camera_models cm ON cm.camera_id = l.camera_id
    LEFT JOIN lens_models lm ON lm.lens_id = l.lens_id
    WHERE d.saved_search_id = $1 AND d.delivered_at IS NULL
    ORDER BY l.first_seen_at DESC
    LIMIT $2
    `,
    [savedSearchId, limit],
  );
  return res.rows;
}

export async function countPendingDeliveries(pool, { savedSearchId }) {
  const res = await pool.query(
    `
    SELECT COUNT(*)::int AS c
    FROM saved_search_listing_deliveries
    WHERE saved_search_id = $1 AND delivered_at IS NULL
    `,
    [savedSearchId],
  );
  return res.rows[0] ? Number(res.rows[0].c) : 0;
}

export async function markDeliveriesDelivered(pool, { savedSearchId, listingIds, emailMessageId }) {
  if (!Array.isArray(listingIds) || listingIds.length === 0) return 0;
  const res = await pool.query(
    `
    UPDATE saved_search_listing_deliveries
    SET delivered_at = NOW(), email_message_id = $3
    WHERE saved_search_id = $1 AND listing_id = ANY($2::uuid[]) AND delivered_at IS NULL
    `,
    [savedSearchId, listingIds, emailMessageId],
  );
  return res.rowCount || 0;
}

export async function updateSavedSearchCheckState(pool, { savedSearchId, checkedAt = null, emailedAt = null }) {
  const res = await pool.query(
    `
    UPDATE saved_searches
    SET
      last_checked_at = COALESCE($2, last_checked_at),
      last_email_sent_at = COALESCE($3, last_email_sent_at)
    WHERE saved_search_id = $1
    RETURNING saved_search_id
    `,
    [savedSearchId, checkedAt, emailedAt],
  );
  return res.rows[0] || null;
}

export async function listRunnableSavedSearches(pool, { limit = 200 } = {}) {
  const res = await pool.query(
    `
    SELECT
      saved_search_id,
      email,
      email_norm,
      camera_id,
      lens_id,
      marketplace_code,
      country,
      currency,
      max_total_price_amount::float8 AS max_total_price_amount,
      max_total_price_currency,
      min_interval_hours,
      max_results_per_email,
      last_checked_at,
      last_email_sent_at,
      confirm_token,
      unsubscribe_token,
      confirmed_at,
      unsubscribed_at,
      created_at
    FROM saved_searches
    WHERE enabled = TRUE
      AND unsubscribed_at IS NULL
      AND confirmed_at IS NOT NULL
    ORDER BY created_at ASC
    LIMIT $1
    `,
    [limit],
  );
  return res.rows;
}
