import test from "node:test";
import assert from "node:assert/strict";

import { normalizeEbaySearchSort, searchEbayBrowseApi } from "../src/ingest/providers/ebay_browse_api.js";

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
