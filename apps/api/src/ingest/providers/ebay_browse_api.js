function baseUrlForEnv(env) {
  return env === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
}

function normalizeEnv(value) {
  const v = String(value || "").trim().toLowerCase();
  return v === "sandbox" ? "sandbox" : "production";
}

export function normalizeEbaySearchSort(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized || normalized === "best" || normalized === "bestmatch" || normalized === "default") return null;
  if (normalized === "newlylisted") return "newlyListed";
  if (normalized === "endingsoonest") return "endingSoonest";
  if (normalized === "price") return "price";
  if (normalized === "distance") return "distance";
  return null;
}

function clampText(value, max) {
  if (value === null || value === undefined) return null;
  const s = String(value);
  if (!s.trim()) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapConditionTier(conditionText) {
  const c = String(conditionText || "").trim().toLowerCase();
  if (!c) return "used_good";
  if (c.includes("new")) return "new";
  if (c.includes("open box")) return "like_new";
  if (c.includes("refurb")) return "used_excellent";
  if (c.includes("for parts") || c.includes("not working")) return "for_parts";
  if (c.includes("used")) return "used_good";
  return "used_good";
}

function feedbackPercentToRating(value) {
  const pct = safeNumber(value);
  if (pct === null) return null;
  if (pct < 0 || pct > 100) return null;
  return Math.round((pct / 20) * 100) / 100;
}

function normalizeMedia(item) {
  const out = [];
  const img = item && item.image && item.image.imageUrl ? String(item.image.imageUrl) : null;
  if (img) {
    out.push({ type: "image", url: img, width: null, height: null });
  }
  return out;
}

export function normalizeEbayItemSummaryToListing(item, { marketplaceCode = "ebay", retrievedAt, env, query, sort = null, filter = null } = {}) {
  const now = retrievedAt || new Date().toISOString();

  const itemId = item && item.itemId ? String(item.itemId) : null;
  const itemUrl = item && item.itemWebUrl ? String(item.itemWebUrl) : null;
  const title = item && item.title ? String(item.title) : null;

  const price = item && item.price ? item.price : null;
  const priceAmount = price ? safeNumber(price.value) : null;
  const priceCurrency = price && price.currency ? String(price.currency) : null;

  const shipOpt = item && Array.isArray(item.shippingOptions) && item.shippingOptions.length ? item.shippingOptions[0] : null;
  const shipCost = shipOpt && shipOpt.shippingCost ? shipOpt.shippingCost : null;
  const shippingAmount = shipCost ? safeNumber(shipCost.value) : null;
  const shippingCurrency = shipCost && shipCost.currency ? String(shipCost.currency) : null;

  const conditionRaw = item && item.condition ? String(item.condition) : null;

  const seller = item && item.seller ? item.seller : null;
  const sellerId = seller && seller.username ? String(seller.username) : null;
  const sellerRating = seller ? feedbackPercentToRating(seller.feedbackPercentage) : null;

  const itemLocation = item && item.itemLocation ? item.itemLocation : null;
  const country = itemLocation && itemLocation.country ? String(itemLocation.country) : null;
  const region = itemLocation && itemLocation.stateOrProvince ? String(itemLocation.stateOrProvince) : null;
  const city = itemLocation && itemLocation.city ? String(itemLocation.city) : null;

  if (!itemId || !itemUrl || !title || priceAmount === null || !priceCurrency) {
    return null;
  }

  return {
    marketplace_code: marketplaceCode,
    source_item_id: clampText(itemId, 128),
    url: clampText(itemUrl, 2048),
    title: clampText(title, 256),
    last_retrieved_at: now,
    is_active: true,

    price_amount: priceAmount,
    price_currency: clampText(priceCurrency, 3),
    shipping_amount: shippingAmount,
    shipping_currency: shippingCurrency ? clampText(shippingCurrency, 3) : null,
    fees_included: true,

    condition_raw: conditionRaw ? clampText(conditionRaw, 128) : null,
    condition_physical_tier: mapConditionTier(conditionRaw),
    functional_status: "unknown",

    seller_type: "unknown",
    seller_id: sellerId ? clampText(sellerId, 128) : null,
    seller_rating: sellerRating,

    country: country ? clampText(country, 2) : null,
    region: region ? clampText(region, 128) : null,
    city: city ? clampText(city, 128) : null,
    pickup_possible: null,

    included_items: [],
    extracted_attributes: [],
    media: normalizeMedia(item),
    raw_ref: {
      provider: "ebay_browse_api",
      env,
      query,
      sort,
      filter,
    },

    first_seen_at: now,
    last_seen_at: now,

    snapshot: {
      provider: "ebay_browse_api",
      env,
      query,
      sort,
      filter,
      item_summary: item,
      retrieved_at: now,
    },
  };
}

export async function searchEbayBrowseApi({
  env,
  accessToken,
  marketplaceId,
  q,
  limit = 25,
  offset = 0,
  categoryIds = null,
  sort = null,
  filter = null,
  fetchImpl = fetch,
} = {}) {
  const normalizedEnv = normalizeEnv(env);
  if (!accessToken) throw new Error("Missing eBay access token.");
  if (!marketplaceId) throw new Error("Missing EBAY_MARKETPLACE_ID (e.g., EBAY_US).");
  if (!q || typeof q !== "string" || !q.trim()) throw new Error("Missing search query.");

  const url = new URL(`${baseUrlForEnv(normalizedEnv)}/buy/browse/v1/item_summary/search`);
  url.searchParams.set("q", q.trim());
  url.searchParams.set("limit", String(Math.max(1, Math.min(200, Number(limit) || 25))));
  url.searchParams.set("offset", String(Math.max(0, Number(offset) || 0)));

  if (categoryIds && Array.isArray(categoryIds) && categoryIds.length) {
    url.searchParams.set("category_ids", categoryIds.map(String).join(","));
  }
  const normalizedSort = normalizeEbaySearchSort(sort);
  if (normalizedSort) {
    url.searchParams.set("sort", normalizedSort);
  }
  if (typeof filter === "string" && filter.trim()) {
    url.searchParams.set("filter", filter.trim());
  }

  const res = await fetchImpl(url.toString(), {
    method: "GET",
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
      "x-ebay-c-marketplace-id": String(marketplaceId),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`eBay Browse API search failed (${res.status}): ${text || res.statusText}`);
  }

  const data = await res.json();
  const items = Array.isArray(data.itemSummaries) ? data.itemSummaries : [];
  const total = Number.isFinite(Number(data.total)) ? Number(data.total) : null;

  return { items, total, href: data.href || null };
}
