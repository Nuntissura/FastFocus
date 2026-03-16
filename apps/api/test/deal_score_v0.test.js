import test from "node:test";
import assert from "node:assert/strict";

import { DEAL_SCORE_VERSION, computeDealScoreV0 } from "../src/deal_score/deal_score_v0.js";

function baseListing(overrides = {}) {
  return {
    price_amount: 1000,
    shipping_amount: 0,
    price_currency: "EUR",
    condition_physical_tier: "used_good",
    functional_status: "working",
    seller_type: "unknown",
    seller_rating: 4.5,
    media: Array.from({ length: 8 }).map((_, idx) => ({ type: "image", url: `https://example.com/${idx}.jpg` })),
    included_items: ["cap", "battery"],
    last_seen_at: "2026-02-18T00:00:00.000Z",
    match_status: "verified",
    match_confidence: 1,
    ...overrides,
  };
}

function baseline(overrides = {}) {
  return {
    p25: 900,
    median: 1000,
    p75: 1100,
    sample_size: 25,
    observed_date: "2026-02-19",
    method: "test",
    country: "BE",
    condition_physical_tier: "used_good",
    ...overrides,
  };
}

test("Deal score v0 increases when cheaper vs baseline", () => {
  const now = new Date("2026-02-19T00:00:00.000Z");

  const cheap = computeDealScoreV0({
    listing: baseListing({ price_amount: 900 }),
    baseline: baseline(),
    now,
  });
  const expensive = computeDealScoreV0({
    listing: baseListing({ price_amount: 1100 }),
    baseline: baseline(),
    now,
  });

  assert.ok(cheap.score > expensive.score, `expected cheap (${cheap.score}) > expensive (${expensive.score})`);
  assert.equal(cheap.breakdown.version, DEAL_SCORE_VERSION);

  const price = cheap.breakdown.factors.find((f) => f.key === "price_vs_baseline");
  assert.ok(price, "expected price_vs_baseline factor");
  assert.equal(price.weight, 0.5);
  assert.ok(typeof price.value === "number");
});

test("Deal score v0 confidence drops when baseline missing", () => {
  const now = new Date("2026-02-19T00:00:00.000Z");
  const listing = baseListing({ price_amount: 1000 });

  const withBaseline = computeDealScoreV0({ listing, baseline: baseline(), now });
  const withoutBaseline = computeDealScoreV0({ listing, baseline: null, now });

  assert.ok(withBaseline.confidence > withoutBaseline.confidence);
});

test("Deal score v0 reflects condition tier", () => {
  const now = new Date("2026-02-19T00:00:00.000Z");

  const newer = computeDealScoreV0({
    listing: baseListing({ condition_physical_tier: "new", functional_status: "working" }),
    baseline: baseline(),
    now,
  });
  const parts = computeDealScoreV0({
    listing: baseListing({ condition_physical_tier: "for_parts", functional_status: "not_working" }),
    baseline: baseline(),
    now,
  });

  assert.ok(newer.score > parts.score, `expected new (${newer.score}) > for_parts (${parts.score})`);
});

