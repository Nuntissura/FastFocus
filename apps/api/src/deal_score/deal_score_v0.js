export const DEAL_SCORE_VERSION = "v0";

export const DEAL_SCORE_WEIGHTS = Object.freeze({
  price_vs_baseline: 0.5,
  condition: 0.2,
  seller: 0.15,
  completeness: 0.1,
  freshness: 0.05,
});

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function safeNumber(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeIso(value) {
  if (!value) return null;
  try {
    return new Date(value).toISOString();
  } catch {
    return null;
  }
}

function jsonArrayLength(value) {
  if (Array.isArray(value)) return value.length;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
  }
  return 0;
}

function listingTotalPrice(listing) {
  const price = safeNumber(listing.price_amount, null);
  if (price === null) return null;
  const ship = safeNumber(listing.shipping_amount, 0) || 0;
  return price + ship;
}

function computePriceFactor({ totalPrice, baseline }) {
  if (totalPrice === null) {
    return {
      key: "price_vs_baseline",
      weight: DEAL_SCORE_WEIGHTS.price_vs_baseline,
      value: 0.5,
      confidence: 0.2,
      details: { note: "missing_total_price" },
    };
  }

  const median = safeNumber(baseline?.median, null);
  const p25Raw = safeNumber(baseline?.p25, null);
  const p75Raw = safeNumber(baseline?.p75, null);
  const sampleSize = safeNumber(baseline?.sample_size, null);

  if (median === null) {
    return {
      key: "price_vs_baseline",
      weight: DEAL_SCORE_WEIGHTS.price_vs_baseline,
      value: 0.5,
      confidence: 0.2,
      details: { note: "no_baseline" },
    };
  }

  let p25 = p25Raw;
  let p75 = p75Raw;

  if (p25 === null) p25 = median;
  if (p75 === null) p75 = median;

  if (!(p25 < p75)) {
    const width = Math.max(1, median * 0.25);
    p25 = median - width;
    p75 = median + width;
  }

  const value = totalPrice <= p25 ? 1 : totalPrice >= p75 ? 0 : 1 - (totalPrice - p25) / (p75 - p25);

  let confidence = 0.7;
  if (typeof sampleSize === "number") {
    if (sampleSize >= 25) confidence = 1.0;
    else if (sampleSize >= 10) confidence = 0.9;
    else if (sampleSize >= 5) confidence = 0.75;
    else if (sampleSize >= 2) confidence = 0.6;
    else confidence = 0.45;
  }

  return {
    key: "price_vs_baseline",
    weight: DEAL_SCORE_WEIGHTS.price_vs_baseline,
    value: clamp01(value),
    confidence: clamp01(confidence),
    details: {
      total_price_amount: Number(totalPrice),
      baseline: {
        p25,
        median,
        p75,
        sample_size: sampleSize,
        observed_date: baseline?.observed_date || null,
        method: baseline?.method || null,
        country: baseline?.country || null,
        condition_physical_tier: baseline?.condition_physical_tier || null,
      },
    },
  };
}

function computeConditionFactor(listing) {
  const tier = String(listing.condition_physical_tier || "");
  const functional = String(listing.functional_status || "");

  const TIER_SCORE = {
    new: 1.0,
    like_new: 0.92,
    used_excellent: 0.82,
    used_good: 0.72,
    used_fair: 0.52,
    for_parts: 0.08,
  };

  const FUNC_SCORE = {
    working: 1.0,
    unknown: 0.6,
    untested: 0.4,
    not_working: 0.08,
  };

  const tierScore = Object.prototype.hasOwnProperty.call(TIER_SCORE, tier) ? TIER_SCORE[tier] : 0.6;
  const funcScore = Object.prototype.hasOwnProperty.call(FUNC_SCORE, functional) ? FUNC_SCORE[functional] : 0.6;

  const value = clamp01(tierScore * 0.65 + funcScore * 0.35);

  const confidence = clamp01((Object.prototype.hasOwnProperty.call(TIER_SCORE, tier) ? 1 : 0.7) * (functional ? 1 : 0.7));

  return {
    key: "condition",
    weight: DEAL_SCORE_WEIGHTS.condition,
    value,
    confidence,
    details: { condition_physical_tier: tier || null, functional_status: functional || null },
  };
}

function computeSellerFactor(listing) {
  const rating = safeNumber(listing.seller_rating, null);
  const sellerType = String(listing.seller_type || "") || null;

  let value = 0.6;
  let confidence = 0.4;

  if (rating !== null) {
    value = clamp01(rating / 5);
    confidence = 1.0;
  }

  if (sellerType === "business") value = clamp01(value + 0.05);
  if (sellerType === "unknown") value = clamp01(value - 0.03);

  return {
    key: "seller",
    weight: DEAL_SCORE_WEIGHTS.seller,
    value,
    confidence,
    details: { seller_rating: rating, seller_type: sellerType },
  };
}

function computeCompletenessFactor(listing) {
  const photoCount = jsonArrayLength(listing.media);
  const includedCount = jsonArrayLength(listing.included_items);

  const photoScore = clamp01(photoCount / 8);
  const includedScore = clamp01(includedCount / 6);

  const value = clamp01(photoScore * 0.85 + includedScore * 0.15);
  const confidence = clamp01(photoCount > 0 ? 1.0 : 0.65);

  return {
    key: "completeness",
    weight: DEAL_SCORE_WEIGHTS.completeness,
    value,
    confidence,
    details: { photo_count: photoCount, included_items_count: includedCount },
  };
}

function computeFreshnessFactor(listing, { now }) {
  const lastSeenIso = safeIso(listing.last_seen_at) || safeIso(listing.last_retrieved_at) || safeIso(listing.first_seen_at);
  if (!lastSeenIso) {
    return {
      key: "freshness",
      weight: DEAL_SCORE_WEIGHTS.freshness,
      value: 0.6,
      confidence: 0.5,
      details: { note: "missing_seen_timestamps" },
    };
  }

  const then = new Date(lastSeenIso).getTime();
  const ageDays = (now.getTime() - then) / (1000 * 60 * 60 * 24);

  let value;
  if (ageDays <= 1) value = 1.0;
  else if (ageDays <= 3) value = 0.9;
  else if (ageDays <= 7) value = 0.8;
  else if (ageDays <= 14) value = 0.6;
  else if (ageDays <= 30) value = 0.4;
  else value = 0.2;

  return {
    key: "freshness",
    weight: DEAL_SCORE_WEIGHTS.freshness,
    value,
    confidence: 1.0,
    details: { last_seen_at: lastSeenIso, age_days: Number(ageDays.toFixed(2)) },
  };
}

function computeWeightedAverage(items, { field }) {
  let wSum = 0;
  let vSum = 0;
  for (const item of items) {
    const w = safeNumber(item.weight, 0) || 0;
    const v = safeNumber(item[field], null);
    if (w <= 0 || v === null) continue;
    wSum += w;
    vSum += w * v;
  }
  return wSum > 0 ? vSum / wSum : 0.5;
}

export function computeDealScoreV0({ listing, baseline = null, now = new Date() } = {}) {
  const totalPrice = listingTotalPrice(listing);

  const factors = [
    computePriceFactor({ totalPrice, baseline }),
    computeConditionFactor(listing),
    computeSellerFactor(listing),
    computeCompletenessFactor(listing),
    computeFreshnessFactor(listing, { now }),
  ];

  const baseScore01 = computeWeightedAverage(factors, { field: "value" });
  const baseConfidence = computeWeightedAverage(factors, { field: "confidence" });

  const matchStatus = String(listing.match_status || "");
  const matchConfidence = safeNumber(listing.match_confidence, null);

  let confidence = baseConfidence;
  if (matchStatus && matchStatus !== "verified") {
    if (matchConfidence !== null) confidence = clamp01(confidence * clamp01(matchConfidence));
    else confidence = clamp01(confidence * 0.75);
  }

  const score = Math.round(baseScore01 * 10000) / 100;
  const confidenceRounded = Math.round(confidence * 100) / 100;

  const breakdown = {
    version: DEAL_SCORE_VERSION,
    computed_at: now.toISOString(),
    currency: listing.price_currency || null,
    total_price_amount: totalPrice === null ? null : Math.round(totalPrice * 100) / 100,
    inputs: {
      condition_physical_tier: listing.condition_physical_tier || null,
      functional_status: listing.functional_status || null,
      seller_rating: safeNumber(listing.seller_rating, null),
      media_count: jsonArrayLength(listing.media),
      included_items_count: jsonArrayLength(listing.included_items),
      last_seen_at: safeIso(listing.last_seen_at),
      match_status: matchStatus || null,
      match_confidence: matchConfidence,
    },
    factors: factors.map((f) => ({
      key: f.key,
      weight: f.weight,
      value: Math.round(clamp01(f.value) * 1000) / 1000,
      confidence: Math.round(clamp01(f.confidence) * 1000) / 1000,
      details: f.details || {},
    })),
    score: {
      value: score,
      confidence: confidenceRounded,
      scale: "0-100",
      note: "Deterministic v0 score; not a guarantee of value or condition.",
    },
  };

  return { score, confidence: confidenceRounded, breakdown };
}

