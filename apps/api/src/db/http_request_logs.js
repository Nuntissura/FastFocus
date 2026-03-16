function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function clampText(value, { max, fallback = null } = {}) {
  if (value === null || value === undefined) return fallback;
  const s = String(value);
  if (!s.trim()) return fallback;
  return s.length > max ? s.slice(0, max) : s;
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

export async function insertHttpRequestLog(
  pool,
  {
    occurredAt,
    method,
    path,
    listingId = null,
    statusCode,
    responseMs = null,
    referrer = null,
    utm = {},
    userAgent = null,
    isBot = false,
    botName = null,
    ipHash = null,
    cacheHit = false,
    properties = {},
  } = {},
) {
  if (!pool) throw new Error("pool_required");

  const occurredAtIso = occurredAt ? new Date(occurredAt).toISOString() : new Date().toISOString();
  const safeMethod = clampText(method, { max: 12, fallback: "GET" }) || "GET";
  const safePath = clampText(path, { max: 512, fallback: "/" }) || "/";
  const safeListingId = isUuid(listingId) ? listingId : null;
  const safeStatus = Number.isInteger(Number(statusCode)) ? Number(statusCode) : 500;
  const safeResponseMs = responseMs === null || responseMs === undefined ? null : Math.max(0, Math.min(600_000, Math.round(Number(responseMs))));

  const props = isPlainObject(properties) ? properties : {};

  await pool.query(
    `
    INSERT INTO http_request_logs (
      occurred_at,
      method,
      path,
      listing_id,
      status_code,
      response_ms,
      referrer,
      utm,
      user_agent,
      is_bot,
      bot_name,
      ip_hash,
      cache_hit,
      properties
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14::jsonb)
    `,
    [
      occurredAtIso,
      safeMethod,
      safePath,
      safeListingId,
      safeStatus,
      safeResponseMs,
      clampText(referrer, { max: 2048, fallback: null }),
      JSON.stringify(normalizeUtm(utm)),
      clampText(userAgent, { max: 512, fallback: null }),
      Boolean(isBot),
      clampText(botName, { max: 64, fallback: null }),
      clampText(ipHash, { max: 64, fallback: null }),
      Boolean(cacheHit),
      JSON.stringify(props),
    ],
  );
}
