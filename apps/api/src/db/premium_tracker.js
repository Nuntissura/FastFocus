function clampText(value, { max, fallback = null } = {}) {
  if (value === null || value === undefined) return fallback;
  const s = String(value).trim();
  if (!s) return fallback;
  return s.length > max ? s.slice(0, max) : s;
}

function clampInt(value, { min, max, fallback }) {
  if (value === null || value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function safeNumber(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function isUuid(value) {
  return (
    typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
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

function isCountryCode(value) {
  return typeof value === "string" && /^[A-Z]{2}$/.test(value);
}

function isConditionTier(value) {
  return (
    typeof value === "string" &&
    ["new", "like_new", "used_excellent", "used_good", "used_fair", "for_parts"].includes(value)
  );
}

function isTriggerMetric(value) {
  return typeof value === "string" && ["median", "min"].includes(value);
}

function isoDateUtc(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function isoOrNull(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString();
}

const TRACKER_MARKETPLACES = {
  ebay: { display_name: "eBay", affiliate_supported: true },
};

async function insertAuditLog(client, { actorId, action, entityType, entityId, diff }) {
  await client.query(
    `
    INSERT INTO audit_log (actor_type, actor_id, action, entity_type, entity_id, diff)
    VALUES ('human', $1, $2, $3, $4, $5::jsonb)
    `,
    [String(actorId || "premium_user").slice(0, 64), String(action || "unknown").slice(0, 64), entityType, entityId, JSON.stringify(diff || {})],
  );
}

async function getCameraTarget(pool, slug) {
  if (!isSlug(slug)) return null;
  const res = await pool.query(
    `
    SELECT
      cm.camera_id,
      cm.slug,
      cm.display_name,
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

async function getLensTarget(pool, slug) {
  if (!isSlug(slug)) return null;
  const res = await pool.query(
    `
    SELECT
      lm.lens_id,
      lm.slug,
      lm.display_name,
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

async function countActiveWatches(pool, premiumSubscriptionId) {
  const res = await pool.query(
    `
    SELECT COUNT(*)::int AS c
    FROM premium_tracker_watches
    WHERE premium_subscription_id = $1
      AND disabled_at IS NULL
    `,
    [premiumSubscriptionId],
  );
  return Number(res.rows[0]?.c || 0);
}

async function ensureSupportedMarketplace(client, marketplaceCode) {
  const code = clampText(marketplaceCode, { max: 32 });
  if (!code || !isMarketplaceCode(code)) return { ok: false, error: "invalid_marketplace" };
  if (!Object.prototype.hasOwnProperty.call(TRACKER_MARKETPLACES, code)) return { ok: false, error: "marketplace_not_supported" };

  const def = TRACKER_MARKETPLACES[code];
  await client.query(
    `
    INSERT INTO marketplaces (marketplace_code, display_name, affiliate_supported)
    VALUES ($1, $2, $3)
    ON CONFLICT (marketplace_code) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      affiliate_supported = EXCLUDED.affiliate_supported
    `,
    [code, def.display_name, Boolean(def.affiliate_supported)],
  );
  return { ok: true, marketplace_code: code };
}

function shapeWatchRow(row, currentSnapshot = undefined) {
  const entityKind = row.camera_id ? "camera" : row.lens_id ? "lens" : null;
  const displayName = row.camera_display_name || row.lens_display_name || null;
  return {
    premium_tracker_watch_id: row.premium_tracker_watch_id,
    premium_subscription_id: row.premium_subscription_id,
    entity_kind: entityKind,
    camera_id: row.camera_id || null,
    camera_slug: row.camera_slug || null,
    lens_id: row.lens_id || null,
    lens_slug: row.lens_slug || null,
    display_name: displayName,
    marketplace_code: row.marketplace_code,
    marketplace_display_name: row.marketplace_display_name || null,
    currency: row.currency,
    country: row.country || null,
    condition_physical_tier: row.condition_physical_tier || null,
    trigger_metric: row.trigger_metric,
    target_price_amount: safeNumber(row.target_price_amount, null),
    min_interval_hours: Number(row.min_interval_hours || 24),
    last_checked_at: isoOrNull(row.last_checked_at),
    last_alerted_at: isoOrNull(row.last_alerted_at),
    disabled_at: isoOrNull(row.disabled_at),
    created_at: isoOrNull(row.created_at),
    updated_at: isoOrNull(row.updated_at),
    current_snapshot: currentSnapshot,
  };
}

export function metricValueForSnapshot({ triggerMetric, snapshot }) {
  if (!snapshot) return null;
  if (triggerMetric === "min") return safeNumber(snapshot.min, null);
  return safeNumber(snapshot.median, null);
}

export async function getPremiumTrackerCurrentSnapshot(pool, { watch } = {}) {
  if (!watch || (!watch.camera_id && !watch.lens_id)) return null;

  const targetColumn = watch.camera_id ? "camera_id" : "lens_id";
  const targetId = watch.camera_id || watch.lens_id;

  const res = await pool.query(
    `
    SELECT
      COUNT(*)::int AS sample_size,
      MIN(l.price_amount)::float8 AS min,
      percentile_cont(0.25) WITHIN GROUP (ORDER BY l.price_amount)::float8 AS p25,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY l.price_amount)::float8 AS median,
      percentile_cont(0.75) WITHIN GROUP (ORDER BY l.price_amount)::float8 AS p75,
      MAX(l.price_amount)::float8 AS max,
      MAX(l.last_retrieved_at) AS last_retrieved_at
    FROM listings l
    WHERE
      l.${targetColumn} = $1
      AND l.marketplace_code = $2
      AND l.is_active = TRUE
      AND l.match_status IN ('matched','verified')
      AND l.price_currency = $3
      AND ($4::char(2) IS NULL OR l.country = $4::char(2))
      AND ($5::condition_physical_tier_enum IS NULL OR l.condition_physical_tier = $5::condition_physical_tier_enum)
    `,
    [targetId, watch.marketplace_code, watch.currency, watch.country || null, watch.condition_physical_tier || null],
  );

  const row = res.rows[0] || null;
  const sampleSize = Number(row?.sample_size || 0);
  if (!row || sampleSize <= 0) return null;

  const current = {
    observed_date_utc: isoDateUtc(row.last_retrieved_at),
    last_retrieved_at: isoOrNull(row.last_retrieved_at),
    sample_size: sampleSize,
    min: safeNumber(row.min, null),
    p25: safeNumber(row.p25, null),
    median: safeNumber(row.median, null),
    p75: safeNumber(row.p75, null),
    max: safeNumber(row.max, null),
  };

  current.trigger_metric = watch.trigger_metric;
  current.trigger_value = metricValueForSnapshot({ triggerMetric: watch.trigger_metric, snapshot: current });
  current.threshold_met = current.trigger_value !== null && current.trigger_value <= safeNumber(watch.target_price_amount, -1);

  return current;
}

export function mapPremiumTrackerErrorToStatus(error) {
  if (["camera_not_found", "lens_not_found", "not_found"].includes(error)) return 404;
  return 400;
}

export async function createPremiumTrackerWatch(
  pool,
  {
    premiumSubscriptionId,
    camera_slug = null,
    lens_slug = null,
    marketplace = "ebay",
    currency = "EUR",
    country = null,
    condition_physical_tier = null,
    target_price_amount,
    trigger_metric = "median",
    min_interval_hours = 24,
    max_watches_per_subscription = 25,
  } = {},
) {
  if (!isUuid(premiumSubscriptionId)) return { ok: false, error: "invalid_premium_subscription" };

  const cameraSlug = camera_slug === null ? null : clampText(camera_slug, { max: 160 });
  const lensSlug = lens_slug === null ? null : clampText(lens_slug, { max: 160 });
  if (cameraSlug && lensSlug) return { ok: false, error: "multiple_targets" };
  if (!cameraSlug && !lensSlug) return { ok: false, error: "missing_target" };

  const marketplaceCode = clampText(String(marketplace || "ebay").toLowerCase(), { max: 32 });
  const currencyCode = clampText(String(currency || "EUR").toUpperCase(), { max: 3 });
  const countryCode = country === null ? null : clampText(String(country).toUpperCase(), { max: 2 });
  const conditionTier = condition_physical_tier === null ? null : clampText(condition_physical_tier, { max: 32 });
  const triggerMetric = clampText(String(trigger_metric || "median").toLowerCase(), { max: 16 });
  const targetPriceAmount = safeNumber(target_price_amount, null);
  const minIntervalHours = clampInt(min_interval_hours, { min: 1, max: 168, fallback: null });

  if (!marketplaceCode || !isMarketplaceCode(marketplaceCode)) return { ok: false, error: "invalid_marketplace" };
  if (!currencyCode || !isCurrency(currencyCode)) return { ok: false, error: "invalid_currency" };
  if (countryCode !== null && !isCountryCode(countryCode)) return { ok: false, error: "invalid_country" };
  if (conditionTier !== null && !isConditionTier(conditionTier)) return { ok: false, error: "invalid_condition_physical_tier" };
  if (!triggerMetric || !isTriggerMetric(triggerMetric)) return { ok: false, error: "invalid_trigger_metric" };
  if (targetPriceAmount === null || targetPriceAmount < 0) return { ok: false, error: "invalid_target_price_amount" };
  if (minIntervalHours === null) return { ok: false, error: "invalid_min_interval_hours" };

  const target = cameraSlug ? await getCameraTarget(pool, cameraSlug) : await getLensTarget(pool, lensSlug);
  if (!target) return { ok: false, error: cameraSlug ? "camera_not_found" : "lens_not_found" };

  const activeCount = await countActiveWatches(pool, premiumSubscriptionId);
  if (activeCount >= Number(max_watches_per_subscription || 25)) return { ok: false, error: "limit_reached" };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const ensuredMarketplace = await ensureSupportedMarketplace(client, marketplaceCode);
    if (!ensuredMarketplace.ok) {
      await client.query("ROLLBACK");
      return { ok: false, error: ensuredMarketplace.error };
    }

    const existingRes = await client.query(
      `
      SELECT
        w.*,
        m.display_name AS marketplace_display_name,
        cm.slug AS camera_slug,
        cm.display_name AS camera_display_name,
        lm.slug AS lens_slug,
        lm.display_name AS lens_display_name
      FROM premium_tracker_watches w
      JOIN marketplaces m ON m.marketplace_code = w.marketplace_code
      LEFT JOIN camera_models cm ON cm.camera_id = w.camera_id
      LEFT JOIN lens_models lm ON lm.lens_id = w.lens_id
      WHERE
        w.premium_subscription_id = $1
        AND w.marketplace_code = $2
        AND w.currency = $3
        AND w.country IS NOT DISTINCT FROM $4::char(2)
        AND w.condition_physical_tier IS NOT DISTINCT FROM $5::condition_physical_tier_enum
        AND w.trigger_metric = $6
        AND w.target_price_amount = $7
        AND w.camera_id IS NOT DISTINCT FROM $8::uuid
        AND w.lens_id IS NOT DISTINCT FROM $9::uuid
        AND w.disabled_at IS NULL
      LIMIT 1
      `,
      [
        premiumSubscriptionId,
        marketplaceCode,
        currencyCode,
        countryCode,
        conditionTier,
        triggerMetric,
        targetPriceAmount,
        target.camera_id || null,
        target.lens_id || null,
      ],
    );

    const existing = existingRes.rows[0] || null;
    if (existing) {
      await client.query("COMMIT");
      const currentSnapshot = await getPremiumTrackerCurrentSnapshot(pool, { watch: existing });
      return { ok: true, reused: true, watch: shapeWatchRow(existing, currentSnapshot) };
    }

    const insertRes = await client.query(
      `
      INSERT INTO premium_tracker_watches (
        premium_subscription_id,
        camera_id,
        lens_id,
        marketplace_code,
        currency,
        country,
        condition_physical_tier,
        trigger_metric,
        target_price_amount,
        min_interval_hours
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *
      `,
      [
        premiumSubscriptionId,
        target.camera_id || null,
        target.lens_id || null,
        marketplaceCode,
        currencyCode,
        countryCode,
        conditionTier,
        triggerMetric,
        targetPriceAmount,
        minIntervalHours,
      ],
    );

    const inserted = insertRes.rows[0];

    await insertAuditLog(client, {
      actorId: premiumSubscriptionId,
      action: "premium_tracker_watch_created",
      entityType: "premium_tracker_watch",
      entityId: inserted.premium_tracker_watch_id,
      diff: {
        marketplace_code: marketplaceCode,
        currency: currencyCode,
        country: countryCode,
        condition_physical_tier: conditionTier,
        trigger_metric: triggerMetric,
        target_price_amount: targetPriceAmount,
        camera_slug: target.slug && target.camera_id ? target.slug : null,
        lens_slug: target.slug && target.lens_id ? target.slug : null,
      },
    });

    await client.query("COMMIT");

    const hydratedRes = await pool.query(
      `
      SELECT
        w.*,
        m.display_name AS marketplace_display_name,
        cm.slug AS camera_slug,
        cm.display_name AS camera_display_name,
        lm.slug AS lens_slug,
        lm.display_name AS lens_display_name
      FROM premium_tracker_watches w
      JOIN marketplaces m ON m.marketplace_code = w.marketplace_code
      LEFT JOIN camera_models cm ON cm.camera_id = w.camera_id
      LEFT JOIN lens_models lm ON lm.lens_id = w.lens_id
      WHERE w.premium_tracker_watch_id = $1
      LIMIT 1
      `,
      [inserted.premium_tracker_watch_id],
    );
    const hydrated = hydratedRes.rows[0] || inserted;
    const currentSnapshot = await getPremiumTrackerCurrentSnapshot(pool, { watch: hydrated });
    return { ok: true, reused: false, watch: shapeWatchRow(hydrated, currentSnapshot) };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listPremiumTrackerWatches(pool, { premiumSubscriptionId, limit = 50, offset = 0 } = {}) {
  if (!isUuid(premiumSubscriptionId)) return [];
  const safeLimit = clampInt(limit, { min: 1, max: 200, fallback: 50 });
  const safeOffset = clampInt(offset, { min: 0, max: 1_000_000, fallback: 0 });

  const res = await pool.query(
    `
    SELECT
      w.*,
      m.display_name AS marketplace_display_name,
      cm.slug AS camera_slug,
      cm.display_name AS camera_display_name,
      lm.slug AS lens_slug,
      lm.display_name AS lens_display_name
    FROM premium_tracker_watches w
    JOIN marketplaces m ON m.marketplace_code = w.marketplace_code
    LEFT JOIN camera_models cm ON cm.camera_id = w.camera_id
    LEFT JOIN lens_models lm ON lm.lens_id = w.lens_id
    WHERE
      w.premium_subscription_id = $1
      AND w.disabled_at IS NULL
    ORDER BY w.created_at DESC
    LIMIT $2 OFFSET $3
    `,
    [premiumSubscriptionId, safeLimit, safeOffset],
  );

  const out = [];
  for (const row of res.rows) {
    const currentSnapshot = await getPremiumTrackerCurrentSnapshot(pool, { watch: row });
    out.push(shapeWatchRow(row, currentSnapshot));
  }
  return out;
}

export async function disablePremiumTrackerWatch(pool, { premiumSubscriptionId, watchId } = {}) {
  if (!isUuid(premiumSubscriptionId)) return { ok: false, error: "invalid_premium_subscription" };
  if (!isUuid(watchId)) return { ok: false, error: "not_found" };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existingRes = await client.query(
      `
      SELECT *
      FROM premium_tracker_watches
      WHERE premium_tracker_watch_id = $1 AND premium_subscription_id = $2
      LIMIT 1
      `,
      [watchId, premiumSubscriptionId],
    );
    const existing = existingRes.rows[0] || null;
    if (!existing) {
      await client.query("ROLLBACK");
      return { ok: false, error: "not_found" };
    }

    const alreadyDisabled = Boolean(existing.disabled_at);

    const updateRes = await client.query(
      `
      UPDATE premium_tracker_watches
      SET disabled_at = COALESCE(disabled_at, NOW())
      WHERE premium_tracker_watch_id = $1
      RETURNING *
      `,
      [watchId],
    );

    const updated = updateRes.rows[0] || existing;

    await insertAuditLog(client, {
      actorId: premiumSubscriptionId,
      action: "premium_tracker_watch_disabled",
      entityType: "premium_tracker_watch",
      entityId: watchId,
      diff: {
        already_disabled: alreadyDisabled,
      },
    });

    await client.query("COMMIT");
    return { ok: true, already_disabled: alreadyDisabled, watch: updated };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listRunnablePremiumTrackerWatches(pool, { limit = 200 } = {}) {
  const safeLimit = clampInt(limit, { min: 1, max: 500, fallback: 200 });
  const res = await pool.query(
    `
    SELECT
      w.*,
      ps.email,
      ps.email_norm,
      ps.plan_code,
      m.display_name AS marketplace_display_name,
      cm.slug AS camera_slug,
      cm.display_name AS camera_display_name,
      lm.slug AS lens_slug,
      lm.display_name AS lens_display_name
    FROM premium_tracker_watches w
    JOIN premium_subscriptions ps
      ON ps.premium_subscription_id = w.premium_subscription_id
    JOIN marketplaces m
      ON m.marketplace_code = w.marketplace_code
    LEFT JOIN camera_models cm
      ON cm.camera_id = w.camera_id
    LEFT JOIN lens_models lm
      ON lm.lens_id = w.lens_id
    WHERE
      w.disabled_at IS NULL
      AND ps.status = 'active'
      AND ps.confirmed_at IS NOT NULL
      AND ps.canceled_at IS NULL
    ORDER BY w.created_at ASC
    LIMIT $1
    `,
    [safeLimit],
  );
  return res.rows;
}

export async function hasPremiumTrackerNotificationForObservedDate(pool, { watchId, observedDate } = {}) {
  if (!isUuid(watchId)) return false;
  const observed = clampText(observedDate, { max: 10 });
  if (!observed || !/^\d{4}-\d{2}-\d{2}$/.test(observed)) return false;
  const res = await pool.query(
    `
    SELECT 1
    FROM premium_tracker_notifications
    WHERE premium_tracker_watch_id = $1 AND observed_date = $2::date
    LIMIT 1
    `,
    [watchId, observed],
  );
  return Boolean(res.rows[0]);
}

export async function recordPremiumTrackerNotification(
  pool,
  {
    watchId,
    observedDate,
    triggerMetric,
    triggerValue,
    targetPriceAmount,
    sampleSize,
    emailMessageId = null,
    sentAt = null,
  } = {},
) {
  if (!isUuid(watchId)) return null;
  const observed = clampText(observedDate, { max: 10 });
  if (!observed || !/^\d{4}-\d{2}-\d{2}$/.test(observed)) return null;
  if (!isTriggerMetric(triggerMetric)) return null;

  const res = await pool.query(
    `
    INSERT INTO premium_tracker_notifications (
      premium_tracker_watch_id,
      observed_date,
      trigger_metric,
      trigger_value,
      target_price_amount,
      sample_size,
      email_message_id,
      sent_at
    )
    VALUES ($1,$2::date,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (premium_tracker_watch_id, observed_date) DO NOTHING
    RETURNING premium_tracker_notification_id
    `,
    [
      watchId,
      observed,
      triggerMetric,
      safeNumber(triggerValue, 0),
      safeNumber(targetPriceAmount, 0),
      clampInt(sampleSize, { min: 0, max: 1_000_000, fallback: 0 }),
      emailMessageId,
      sentAt,
    ],
  );
  return res.rows[0] || null;
}

export async function updatePremiumTrackerWatchState(pool, { watchId, checkedAt = null, alertedAt = null } = {}) {
  if (!isUuid(watchId)) return null;
  const res = await pool.query(
    `
    UPDATE premium_tracker_watches
    SET
      last_checked_at = COALESCE($2, last_checked_at),
      last_alerted_at = COALESCE($3, last_alerted_at)
    WHERE premium_tracker_watch_id = $1
    RETURNING premium_tracker_watch_id
    `,
    [watchId, checkedAt, alertedAt],
  );
  return res.rows[0] || null;
}
