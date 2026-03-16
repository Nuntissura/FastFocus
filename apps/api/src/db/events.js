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
  if (!sessionId || typeof sessionId !== "string" || sessionId.length < 8 || sessionId.length > 64) throw new Error("invalid_session_id");
  if (!isUuid(listingId)) throw new Error("invalid_listing_id");
  if (cameraId !== null && !isUuid(cameraId)) throw new Error("invalid_camera_id");
  if (lensId !== null && !isUuid(lensId)) throw new Error("invalid_lens_id");

  const occurredAt = new Date().toISOString();
  const safePageType = parsePageType(pageType, "other");
  const safePath = clampText(path, { max: 512, fallback: "/go/listings" }) || "/go/listings";

  const props = { ...(properties && typeof properties === "object" ? properties : {}) };
  if (lensId) props.lens_id = lensId;

  const res = await pool.query(
    `
    INSERT INTO events (
      occurred_at,
      event_name,
      session_id,
      page_type,
      path,
      camera_id,
      listing_id,
      referrer,
      utm,
      user_agent,
      is_bot,
      bot_name,
      properties
    )
    VALUES ($1, 'listing_clickout', $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12::jsonb)
    RETURNING event_id, event_uuid
    `,
    [
      occurredAt,
      sessionId,
      safePageType,
      safePath,
      cameraId,
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
