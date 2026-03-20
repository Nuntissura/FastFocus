import test from "node:test";
import assert from "node:assert/strict";

import { renderHomePageHtml } from "../src/html/site_pages.js";
import { renderCameraModelPageHtml } from "../src/html/model_pages.js";

test("renderHomePageHtml shows eBay highlights and live coverage cards", () => {
  const html = renderHomePageHtml({
    canonicalUrl: "https://fastfocus.camera/",
    dbEnabled: true,
    marketplaces: [
      {
        marketplace_code: "ebay",
        display_name: "eBay",
        active_listing_count: 24,
        last_listing_retrieved_at: "2026-03-20T20:00:00.000Z",
        last_run_status: "succeeded",
      },
    ],
    featuredCameras: [
      {
        slug: "canon-eos-r6",
        display_name: "Canon EOS R6",
        brand_name: "Canon",
        active_listing_count: 12,
        recent_listing_count_7d: 4,
        best_deal_score: 83,
        last_retrieved_at: "2026-03-20T20:00:00.000Z",
      },
    ],
    featuredCameraSourceLabel: "eBay",
    liveDeals: [
      {
        listing_id: "11111111-1111-4111-8111-111111111111",
        marketplace_code: "ebay",
        marketplace_display_name: "eBay",
        camera_slug: "canon-eos-r6",
        camera_display_name: "Canon EOS R6",
        brand_name: "Canon",
        title: "Canon EOS R6 body",
        price_amount: 1499,
        price_currency: "EUR",
        shipping_amount: 25,
        shipping_currency: "EUR",
        condition_physical_tier: "used_good",
        deal_score: 83,
        last_retrieved_at: "2026-03-20T20:00:00.000Z",
        first_visible_at: "2026-03-20T19:30:00.000Z",
      },
    ],
    recentArrivals: [
      {
        listing_id: "22222222-2222-4222-8222-222222222222",
        marketplace_code: "ebay",
        marketplace_display_name: "eBay",
        camera_slug: "nikon-z6-ii",
        camera_display_name: "Nikon Z6 II",
        brand_name: "Nikon",
        title: "Nikon Z6 II body only",
        price_amount: 1199,
        price_currency: "EUR",
        shipping_amount: null,
        shipping_currency: null,
        condition_physical_tier: "used_excellent",
        deal_score: 77,
        last_retrieved_at: "2026-03-20T20:05:00.000Z",
        first_visible_at: "2026-03-20T20:01:00.000Z",
      },
    ],
  });

  assert.match(html, /Best current eBay deals/);
  assert.match(html, /Fresh eBay arrivals/);
  assert.match(html, /Camera pages with live eBay coverage/);
  assert.match(html, /Canon EOS R6 body/);
  assert.match(html, /Open camera page/);
});

test("renderHomePageHtml warns when live coverage is thin", () => {
  const html = renderHomePageHtml({
    canonicalUrl: "https://fastfocus.camera/",
    dbEnabled: true,
    marketplaces: [
      {
        marketplace_code: "ebay",
        display_name: "eBay",
        active_listing_count: 0,
        last_listing_retrieved_at: null,
        last_run_status: "succeeded",
      },
    ],
    featuredCameras: [],
    featuredCameraSourceLabel: "eBay",
    liveDeals: [],
    recentArrivals: [],
  });

  assert.match(html, /Live listing coverage is thin right now/i);
});

test("renderCameraModelPageHtml shows bio and market read", () => {
  const html = renderCameraModelPageHtml(
    {
      camera: {
        slug: "canon-eos-r6",
        display_name: "Canon EOS R6",
        brand_name: "Canon",
        brand_slug: "canon",
        capture_medium: "digital",
        camera_category: "mirrorless",
        lens_system_type: "interchangeable",
        mount_code: "canon_rf",
        release_year: 2020,
        announce_date: "2020-07-09",
        resolution_mp: 20,
        sensor_format: "full_frame",
        ibis: true,
        content_modules: {
          bio: "A balanced full-frame mirrorless body with strong autofocus and stabilization for mixed stills and video use.",
        },
      },
      market_summary: {
        active_listing_count: 12,
        recent_listing_count_7d: 4,
        strongest_source: {
          marketplace_code: "ebay",
          listing_count: 9,
          last_retrieved_at: "2026-03-20T20:00:00.000Z",
        },
        best_deal: {
          listing_id: "11111111-1111-4111-8111-111111111111",
          marketplace_code: "ebay",
          marketplace_display_name: "eBay",
          title: "Canon EOS R6 body",
          price_amount: 1499,
          price_currency: "EUR",
          shipping_amount: 25,
          shipping_currency: "EUR",
          deal_score: 83,
        },
        last_updated_at: "2026-03-20T20:00:00.000Z",
      },
      listing_counts_by_source: [
        {
          marketplace_code: "ebay",
          listing_count: 9,
          last_retrieved_at: "2026-03-20T20:00:00.000Z",
        },
      ],
      last_updated_at: "2026-03-20T20:00:00.000Z",
      price_band: {
        currency: "EUR",
        sample_size: 9,
        min: 1200,
        p25: 1350,
        median: 1499,
        p75: 1650,
        max: 1799,
        observed_date: "2026-03-20",
        as_of: "2026-03-20T20:00:00.000Z",
        method: "live_listings_percentiles_v0",
      },
      listings: [
        {
          listing_id: "11111111-1111-4111-8111-111111111111",
          marketplace_code: "ebay",
          marketplace_display_name: "eBay",
          marketplace_is_sponsored: false,
          marketplace_sponsored_label: null,
          title: "Canon EOS R6 body",
          price_amount: 1499,
          price_currency: "EUR",
          shipping_amount: 25,
          shipping_currency: "EUR",
          condition_physical_tier: "used_good",
          country: "BE",
          region: null,
          city: null,
          last_retrieved_at: "2026-03-20T20:00:00.000Z",
          deal_score: 83,
        },
      ],
    },
    { canonicalUrl: "https://fastfocus.camera/cameras/canon-eos-r6" },
  );

  assert.match(html, /At a glance/);
  assert.match(html, /balanced full-frame mirrorless body/i);
  assert.match(html, /Market read/);
  assert.match(html, /active matched listings right now/i);
  assert.match(html, /Best current scored listing/i);
});

test("renderCameraModelPageHtml calls out stale and thin market coverage", () => {
  const html = renderCameraModelPageHtml(
    {
      camera: {
        slug: "sony-a7-iv",
        display_name: "Sony A7 IV",
        brand_name: "Sony",
        brand_slug: "sony",
        capture_medium: "digital",
        camera_category: "mirrorless",
        lens_system_type: "interchangeable",
        mount_code: "sony_e",
        release_year: 2021,
        announce_date: "2021-10-21",
        resolution_mp: 33,
        sensor_format: "full_frame",
        ibis: true,
      },
      market_summary: {
        active_listing_count: 2,
        recent_listing_count_7d: 0,
        strongest_source: {
          marketplace_code: "ebay",
          listing_count: 2,
          last_retrieved_at: "2020-01-01T00:00:00.000Z",
        },
        best_deal: {
          listing_id: "33333333-3333-4333-8333-333333333333",
          marketplace_code: "ebay",
          marketplace_display_name: "eBay",
          title: "Sony A7 IV body",
          price_amount: 1799,
          price_currency: "EUR",
          shipping_amount: 25,
          shipping_currency: "EUR",
          deal_score: 71,
        },
        last_updated_at: "2020-01-01T00:00:00.000Z",
      },
      listing_counts_by_source: [
        {
          marketplace_code: "ebay",
          listing_count: 2,
          last_retrieved_at: "2020-01-01T00:00:00.000Z",
        },
      ],
      last_updated_at: "2020-01-01T00:00:00.000Z",
      price_band: null,
      listings: [],
    },
    { canonicalUrl: "https://fastfocus.camera/cameras/sony-a7-iv" },
  );

  assert.match(html, /Coverage is still thin/i);
  assert.match(html, /Coverage looks stale/i);
});
