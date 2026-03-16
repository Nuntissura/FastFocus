import test from "node:test";
import assert from "node:assert/strict";

import { getEbayAccessToken } from "../src/ingest/providers/ebay_oauth.js";
import { normalizeEbayItemSummaryToListing, searchEbayBrowseApi } from "../src/ingest/providers/ebay_browse_api.js";

function makeFetch({ status = 200, json = null, text = "" } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? "OK" : "ERR",
      json: async () => json,
      text: async () => text,
    };
  };
  return { fetchImpl, calls };
}

test("eBay OAuth client-credentials token request (mocked)", async () => {
  const { fetchImpl, calls } = makeFetch({ json: { access_token: "tok_123", expires_in: 3600 } });

  const token = await getEbayAccessToken({
    env: "sandbox",
    clientId: "client_id",
    clientSecret: "client_secret",
    fetchImpl,
  });

  assert.equal(token, "tok_123");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.sandbox.ebay.com/identity/v1/oauth2/token");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["content-type"], "application/x-www-form-urlencoded");
  assert.ok(String(calls[0].init.headers.authorization).startsWith("Basic "));
  assert.match(String(calls[0].init.body), /grant_type=client_credentials/);
  assert.match(String(calls[0].init.body), /scope=/);
});

test("eBay Browse API search request (mocked)", async () => {
  const { fetchImpl, calls } = makeFetch({
    json: {
      href: "https://api.ebay.com/buy/browse/v1/item_summary/search?q=test",
      total: 1,
      itemSummaries: [{ itemId: "v1|123|0", title: "Test", itemWebUrl: "https://www.ebay.com/itm/123", price: { value: "10.00", currency: "USD" } }],
    },
  });

  const res = await searchEbayBrowseApi({
    env: "production",
    accessToken: "tok",
    marketplaceId: "EBAY_US",
    q: "test",
    limit: 25,
    offset: 0,
    fetchImpl,
  });

  assert.equal(res.total, 1);
  assert.equal(res.items.length, 1);
  assert.equal(calls.length, 1);
  assert.match(String(calls[0].url), /^https:\/\/api\.ebay\.com\/buy\/browse\/v1\/item_summary\/search\?/);
  assert.equal(calls[0].init.headers.authorization, "Bearer tok");
  assert.equal(calls[0].init.headers["x-ebay-c-marketplace-id"], "EBAY_US");
});

test("Normalize eBay item summary to listing (basic mapping)", async () => {
  const item = {
    itemId: "v1|123|0",
    title: "Sony A7 IV body",
    itemWebUrl: "https://www.ebay.com/itm/123",
    price: { value: "1499.00", currency: "EUR" },
    condition: "Used",
    seller: { username: "sellerA", feedbackPercentage: 99.6 },
    itemLocation: { country: "BE", stateOrProvince: "VLG", city: "Antwerp" },
    image: { imageUrl: "https://i.ebayimg.com/images/g/abc/s-l1600.jpg" },
    shippingOptions: [{ shippingCost: { value: "10.00", currency: "EUR" } }],
  };

  const listing = normalizeEbayItemSummaryToListing(item, { marketplaceCode: "ebay", retrievedAt: "2026-02-15T00:00:00.000Z", env: "production", query: "Sony A7 IV body" });

  assert.ok(listing);
  assert.equal(listing.marketplace_code, "ebay");
  assert.equal(listing.source_item_id, "v1|123|0");
  assert.equal(listing.price_currency, "EUR");
  assert.equal(listing.price_amount, 1499);
  assert.equal(listing.shipping_amount, 10);
  assert.equal(listing.condition_physical_tier, "used_good");
  assert.equal(listing.seller_id, "sellerA");
  assert.equal(listing.country, "BE");
  assert.ok(Array.isArray(listing.media));
  assert.ok(listing.snapshot && listing.snapshot.provider === "ebay_browse_api");
});

