function interpolate(value, vars) {
  return String(value).replaceAll(/\{([a-z0-9_]+)\}/gi, (match, key) => {
    const k = String(key).toLowerCase();
    const v = vars && Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : undefined;
    return v === undefined || v === null ? match : String(v);
  });
}

function hasUnresolvedPlaceholders(value) {
  return /\{[a-z0-9_]+\}/i.test(String(value));
}

function applyParams(originalUrl, paramsString, vars) {
  if (!paramsString || !paramsString.trim()) return { url: originalUrl, applied: false, applied_params: {} };

  let u;
  try {
    u = new URL(originalUrl);
  } catch {
    return { url: originalUrl, applied: false, applied_params: {} };
  }

  const params = new URLSearchParams(paramsString);
  const appliedParams = {};

  for (const [k, v] of params.entries()) {
    const next = interpolate(v, vars);
    if (hasUnresolvedPlaceholders(next)) continue;
    u.searchParams.set(k, next);
    appliedParams[k] = next;
  }

  return { url: u.toString(), applied: true, applied_params: appliedParams };
}

export function buildAffiliateUrl({ marketplaceCode, originalUrl, listingId = null, sessionId = null, paramsString = null } = {}) {
  const code = String(marketplaceCode || "").toLowerCase();

  const vars = {
    listing_id: listingId,
    session_id: sessionId,
    marketplace_code: code,
  };

  if (paramsString && String(paramsString).trim()) {
    return applyParams(originalUrl, String(paramsString), vars);
  }

  if (code === "ebay") {
    return applyParams(originalUrl, process.env.FF_AFFILIATE_EBAY_PARAMS || "", vars);
  }

  const envKey = `FF_AFFILIATE_${code.replace(/[^a-z0-9]+/gi, "_").toUpperCase()}_PARAMS`;
  const params = process.env[envKey] || "";
  if (params && params.trim()) {
    return applyParams(originalUrl, params, vars);
  }

  return { url: originalUrl, applied: false, applied_params: {} };
}
