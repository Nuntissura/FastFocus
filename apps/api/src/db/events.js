function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function clampText(value, { max, fallback = null } = {}) {
  if (value === null || value === undefined) return fallback;
  const s = String(value);
  if (!s.trim()) return fallback;
  return s.length > max ? s.slice(0, max) : s;
}

const PAGE_TYPES = new Set(["model", "compare", "brand", "guide", "search", "other"]);

export function parsePageType(value, fallback = "other") {
  if (!value) return fallback;
  const v = String(value).trim();
  return PAGE_TYPES.has(v) ? v : fallback;
}

function normalizeUtm(utm) {
  const out = {};
  if (!utm || typeof utm !== "object") return out;
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
    const v = utm[k];
    if (typeof v !== "string") continue;
    const trimmed = v.trim();
    if (!trimmed) continue;
    out[k] = trimmed.slice(0, 120);
  }
  return out;
}

function normalizeProperties(properties) {
  const source = properties && typeof properties === "object" ? properties : {};
  const out = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) continue;
      out[key] = trimmed.slice(0, 256);
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      out[key] = value.slice(0, 16);
      continue;
    }
    if (typeof value === "object") {
      out[key] = value;
    }
  }
  return out;
}

async function trackEvent(pool, {
  eventName,
  sessionId,
  pageType = "other",
  path,
  cameraId = null,
  compareCameraId = null,
  listingId = null,
  referrer = null,
  userAgent = null,
  isBot = false,
  botName = null,
  utm = {},
  properties = {},
}) {
  if (!sessionId || typeof sessionId !== "string" || sessionId.length < 8 || sessionId.length > 64) throw new Error("invalid_session_id");
  if (cameraId !== null && !isUuid(cameraId)) throw new Error("invalid_camera_id");
  if (compareCameraId !== null && !isUuid(compareCameraId)) throw new Error("invalid_compare_camera_id");
  if (listingId !== null && !isUuid(listingId)) throw new Error("invalid_listing_id");

  const occurredAt = new Date().toISOString();
  const safePageType = parsePageType(pageType, "other");
  const safePath = clampText(path, { max: 512, fallback: "/" }) || "/";
  const props = normalizeProperties(properties);

  const res = await pool.query(
    `
    INSERT INTO events (
      occurred_at,
      event_name,
      session_id,
      page_type,
      path,
      camera_id,
      compare_camera_id,
      listing_id,
      referrer,
      utm,
      user_agent,
      is_bot,
      bot_name,
      properties
    )
    VALUES ($1, $2::event_name_enum, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14::jsonb)
    RETURNING event_id, event_uuid
    `,
    [
      occurredAt,
      eventName,
      sessionId,
      safePageType,
      safePath,
      cameraId,
      compareCameraId,
      listingId,
      clampText(referrer, { max: 2048, fallback: null }),
      JSON.stringify(normalizeUtm(utm)),
      clampText(userAgent, { max: 512, fallback: null }),
      Boolean(isBot),
      clampText(botName, { max: 64, fallback: null }),
      JSON.stringify(props),
    ],
  );

  return res.rows[0];
}

export async function trackPageView(pool, payload) {
  return trackEvent(pool, { ...payload, eventName: "page_view" });
}

export async function trackSiteSearch(pool, payload) {
  return trackEvent(pool, { ...payload, eventName: "site_search" });
}

export async function trackCompareView(pool, payload) {
  return trackEvent(pool, { ...payload, eventName: "compare_view", pageType: "compare" });
}

export async function trackListingClickout(pool, {
  sessionId,
  pageType = "other",
  path,
  listingId,
  cameraId = null,
  lensId = null,
  referrer = null,
  userAgent = null,
  isBot = false,
  botName = null,
  utm = {},
  properties = {},
}) {
  if (lensId !== null && !isUuid(lensId)) throw new Error("invalid_lens_id");
  const props = { ...(properties && typeof properties === "object" ? properties : {}) };
  if (lensId) props.lens_id = lensId;

  return trackEvent(pool, {
    eventName: "listing_clickout",
    sessionId,
    pageType,
    path,
    cameraId,
    listingId,
    referrer,
    userAgent,
    isBot,
    botName,
    utm,
    properties: props,
  });
}

export async function getDemandSummary(pool, { windowDays = 30 } = {}) {
  const safeWindowDays = Number.isInteger(Number(windowDays)) ? Math.max(1, Math.min(365, Number(windowDays))) : 30;
  const sinceIso = new Date(Date.now() - safeWindowDays * 24 * 60 * 60 * 1000).toISOString();

  const [bodyLensRes, brandRes, modelRes, compareRes, clickoutRes, botReferralRes] = await Promise.all([
    pool.query(
      `
      SELECT
        COALESCE(NULLIF(properties->>'entity_kind', ''), 'unknown') AS entity_kind,
        COUNT(*)::int AS event_count
      FROM events
      WHERE occurred_at >= $1
        AND event_name IN ('page_view', 'site_search', 'compare_view', 'listing_clickout')
      GROUP BY 1
      ORDER BY event_count DESC, entity_kind ASC
      `,
      [sinceIso],
    ),
    pool.query(
      `
      SELECT
        COALESCE(NULLIF(properties->>'brand_slug', ''), 'unknown') AS brand_slug,
        COUNT(*)::int AS event_count
      FROM events
      WHERE occurred_at >= $1
        AND event_name IN ('page_view', 'site_search')
        AND COALESCE(NULLIF(properties->>'entity_kind', ''), 'camera') = 'camera'
      GROUP BY 1
      ORDER BY event_count DESC, brand_slug ASC
      LIMIT 20
      `,
      [sinceIso],
    ),
    pool.query(
      `
      SELECT
        COALESCE(NULLIF(properties->>'entity_kind', ''), 'unknown') AS entity_kind,
        COALESCE(NULLIF(properties->>'model_slug', ''), 'unknown') AS model_slug,
        COUNT(*)::int AS event_count
      FROM events
      WHERE occurred_at >= $1
        AND event_name IN ('page_view', 'site_search', 'listing_clickout')
        AND properties ? 'model_slug'
      GROUP BY 1, 2
      ORDER BY event_count DESC, model_slug ASC
      LIMIT 30
      `,
      [sinceIso],
    ),
    pool.query(
      `
      SELECT
        COALESCE(NULLIF(properties->>'left_slug', ''), 'unknown') AS left_slug,
        COALESCE(NULLIF(properties->>'right_slug', ''), 'unknown') AS right_slug,
        COUNT(*)::int AS event_count
      FROM events
      WHERE occurred_at >= $1
        AND event_name = 'compare_view'
      GROUP BY 1, 2
      ORDER BY event_count DESC, left_slug ASC, right_slug ASC
      LIMIT 20
      `,
      [sinceIso],
    ),
    pool.query(
      `
      SELECT
        COALESCE(NULLIF(properties->>'marketplace_code', ''), 'unknown') AS marketplace_code,
        COUNT(*)::int AS click_count
      FROM events
      WHERE occurred_at >= $1
        AND event_name = 'listing_clickout'
      GROUP BY 1
      ORDER BY click_count DESC, marketplace_code ASC
      LIMIT 20
      `,
      [sinceIso],
    ),
    pool.query(
      `
      SELECT
        COALESCE(bot_name, 'unknown') AS bot_name,
        COUNT(*)::int AS request_count
      FROM http_request_logs
      WHERE occurred_at >= $1
        AND is_bot = TRUE
      GROUP BY 1
      ORDER BY request_count DESC, bot_name ASC
      LIMIT 20
      `,
      [sinceIso],
    ),
  ]);

  return {
    ok: true,
    window: {
      window_days: safeWindowDays,
      since_utc: sinceIso,
      until_utc: new Date().toISOString(),
    },
    body_vs_lens_demand: bodyLensRes.rows.map((r) => ({
      entity_kind: r.entity_kind,
      event_count: Number(r.event_count || 0),
    })),
    brand_share: brandRes.rows.map((r) => ({
      brand_slug: r.brand_slug,
      event_count: Number(r.event_count || 0),
    })),
    model_demand: modelRes.rows.map((r) => ({
      entity_kind: r.entity_kind,
      model_slug: r.model_slug,
      event_count: Number(r.event_count || 0),
    })),
    compare_pair_demand: compareRes.rows.map((r) => ({
      left_slug: r.left_slug,
      right_slug: r.right_slug,
      event_count: Number(r.event_count || 0),
    })),
    listing_clickouts: clickoutRes.rows.map((r) => ({
      marketplace_code: r.marketplace_code,
      click_count: Number(r.click_count || 0),
    })),
    bot_referrals: botReferralRes.rows.map((r) => ({
      bot_name: r.bot_name,
      request_count: Number(r.request_count || 0),
    })),
  };
}
