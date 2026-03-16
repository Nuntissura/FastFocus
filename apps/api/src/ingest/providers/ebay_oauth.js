let cached = null;

function nowMs() {
  return Date.now();
}

function baseUrlForEnv(env) {
  return env === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
}

function normalizeEnv(value) {
  const v = String(value || "").trim().toLowerCase();
  return v === "sandbox" ? "sandbox" : "production";
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export async function getEbayAccessToken({
  env,
  clientId,
  clientSecret,
  scope = "https://api.ebay.com/oauth/api_scope",
  fetchImpl = fetch,
} = {}) {
  const normalizedEnv = normalizeEnv(env);

  assert(typeof clientId === "string" && clientId.trim(), "Missing EBAY_CLIENT_ID.");
  assert(typeof clientSecret === "string" && clientSecret.trim(), "Missing EBAY_CLIENT_SECRET.");

  const cacheKey = `${normalizedEnv}:${clientId.trim()}`;
  if (cached && cached.cacheKey === cacheKey && cached.expiresAtMs - nowMs() > 60_000) {
    return cached.accessToken;
  }

  const tokenUrl = `${baseUrlForEnv(normalizedEnv)}/identity/v1/oauth2/token`;

  const auth = Buffer.from(`${clientId.trim()}:${clientSecret.trim()}`).toString("base64");
  const body = new URLSearchParams();
  body.set("grant_type", "client_credentials");
  body.set("scope", scope);

  const res = await fetchImpl(tokenUrl, {
    method: "POST",
    headers: {
      authorization: `Basic ${auth}`,
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`eBay OAuth token request failed (${res.status}): ${text || res.statusText}`);
  }

  const data = await res.json();
  const accessToken = data && typeof data.access_token === "string" ? data.access_token : null;
  const expiresIn = data && Number.isFinite(Number(data.expires_in)) ? Number(data.expires_in) : 3600;

  if (!accessToken) throw new Error("eBay OAuth token response missing access_token.");

  cached = {
    cacheKey,
    accessToken,
    expiresAtMs: nowMs() + Math.max(60, expiresIn) * 1000,
  };

  return accessToken;
}

