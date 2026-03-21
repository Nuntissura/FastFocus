import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEbaySearchQueriesForCamera,
  normalizeEbayItemSummaryToListing,
  normalizeEbaySearchSort,
  searchEbayBrowseApi,
} from "../src/ingest/providers/ebay_browse_api.js";

test("normalizeEbaySearchSort maps supported aliases", () => {
  assert.equal(normalizeEbaySearchSort("best"), null);
  assert.equal(normalizeEbaySearchSort("bestMatch"), null);
  assert.equal(normalizeEbaySearchSort("newlyListed"), "newlyListed");
  assert.equal(normalizeEbaySearchSort("endingSoonest"), "endingSoonest");
  assert.equal(normalizeEbaySearchSort("distance"), "distance");
  assert.equal(normalizeEbaySearchSort("unknown"), null);
});

test("searchEbayBrowseApi includes sort and filter parameters when provided", async () => {
  let requestedUrl = null;

  const fetchImpl = async (url) => {
    requestedUrl = url;
    return {
      ok: true,
      json: async () => ({ itemSummaries: [], total: 0, href: url }),
    };
  };

  await searchEbayBrowseApi({
    env: "production",
    accessToken: "token",
    marketplaceId: "EBAY_US",
    q: "sony a7 iv body",
    sort: "newlyListed",
    filter: "price:[500..2500]",
    fetchImpl,
  });

  assert.ok(requestedUrl);
  assert.match(requestedUrl, /sort=newlyListed/);
  assert.match(requestedUrl, /filter=price%3A%5B500\.\.2500%5D/);
});

test("buildEbaySearchQueriesForCamera widens interchangeable-body queries with aliases and compact model forms", () => {
  const queries = buildEbaySearchQueriesForCamera({
    display_name: "Sony A7C II",
    model_name: "A7C II",
    aliases: ["Sony Alpha A7C II"],
    lens_system_type: "interchangeable",
  });

  assert.deepEqual(
    queries.map((entry) => entry.query),
    ["Sony A7C II body", "A7C II body", "Sony Alpha A7C II body", "A7CII body"],
  );
});

test("buildEbaySearchQueriesForCamera does not append body for fixed-lens cameras", () => {
  const queries = buildEbaySearchQueriesForCamera({
    display_name: "Fujifilm X100V",
    model_name: "X100V",
    aliases: [],
    lens_system_type: "fixed",
  });

  assert.deepEqual(
    queries.map((entry) => entry.query),
    ["Fujifilm X100V", "X100V"],
  );
});

test("normalizeEbayItemSummaryToListing preserves item origin timestamps for freshness", () => {
  const listing = normalizeEbayItemSummaryToListing(
    {
      itemId: "v1|123|0",
      itemWebUrl: "https://www.ebay.com/itm/123",
      title: "Canon EOS R5 body only",
      price: { value: "2399", currency: "USD" },
      shippingOptions: [{ shippingCost: { value: "25", currency: "USD" } }],
      condition: "Used",
      seller: { username: "camera-seller", feedbackPercentage: "99.5" },
      itemLocation: { country: "US" },
      itemCreationDate: "2026-03-18T12:00:00.000Z",
      itemOriginDate: "2026-03-17T09:30:00.000Z",
    },
    {
      marketplaceCode: "ebay",
      retrievedAt: "2026-03-21T10:00:00.000Z",
      env: "production",
      query: "Canon EOS R5 body",
      queryLabel: "display_name",
      sort: "newlyListed",
    },
  );

  assert.equal(listing.first_seen_at, "2026-03-17T09:30:00.000Z");
  assert.equal(listing.last_seen_at, "2026-03-21T10:00:00.000Z");
  assert.equal(listing.raw_ref.query_label, "display_name");
  assert.equal(listing.raw_ref.item_creation_date, "2026-03-18T12:00:00.000Z");
  assert.equal(listing.snapshot.item_origin_date, "2026-03-17T09:30:00.000Z");
});
