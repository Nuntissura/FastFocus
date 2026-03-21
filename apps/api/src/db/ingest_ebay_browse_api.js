import pg from "pg";

import { getEbayAccessToken } from "../ingest/providers/ebay_oauth.js";
import {
  buildEbaySearchQueriesForCamera,
  normalizeEbayItemSummaryToListing,
  normalizeEbaySearchSort,
  searchEbayBrowseApi,
} from "../ingest/providers/ebay_browse_api.js";
import { ingestListingsOnce } from "../ingest/write_listings.js";

const { Client } = pg;
const DEFAULT_CAMERA_SLUGS = [
  "sony-a7-iv",
  "sony-a6700",
  "nikon-z6-iii",
  "nikon-z8",
  "fujifilm-x-s20",
  "fujifilm-x-t5",
  "panasonic-lumix-s5-ii",
  "olympus-om-d-e-m1-mark-iii",
  "om-system-om-1-mark-ii",
  "canon-eos-r6-ii",
  "canon-eos-r5",
].join(",");

function envString(name, fallback) {
  const raw = process.env[name];
  return raw && raw.trim() ? raw.trim() : fallback;
}

function envInt(name, fallback, { min, max } = {}) {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n)) return fallback;
  const lo = min === undefined ? n : Math.max(min, n);
  const hi = max === undefined ? lo : Math.min(max, lo);
  return hi;
}

function parseCsv(value) {
  if (!value || typeof value !== "string") return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseSearchSorts(value) {
  const rawSorts = parseCsv(value);
  const out = [];
  const seen = new Set();

  for (const raw of rawSorts.length ? rawSorts : ["best"]) {
    const normalized = normalizeEbaySearchSort(raw);
    const key = normalized || "best";
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }

  return out;
}

async function loadCameraQueries(client, slugs, { maxQueriesPerModel = 4 } = {}) {
  if (!slugs.length) return [];
  const res = await client.query(
    `
    SELECT cm.slug, cm.display_name, b.name AS brand_name, cm.aliases, cm.lens_system_type
    FROM camera_models cm
    JOIN brands b ON b.brand_id = cm.brand_id
    WHERE cm.slug = ANY($1::text[])
    `,
    [slugs],
  );

  const bySlug = new Map(res.rows.map((r) => [r.slug, r]));
  return slugs
    .map((slug) => bySlug.get(slug))
    .filter(Boolean)
    .flatMap((r) =>
      buildEbaySearchQueriesForCamera(
        {
          display_name: r.display_name,
          model_name: Array.isArray(r.aliases) && r.aliases.length ? r.aliases[0] : null,
          aliases: Array.isArray(r.aliases) ? r.aliases : [],
          lens_system_type: r.lens_system_type,
        },
        { maxQueries: maxQueriesPerModel },
      ).map((queryDef) => ({
        kind: "camera",
        slug: r.slug,
        query: queryDef.query,
        query_label: queryDef.label,
      })),
    );
}

async function loadLensQueries(client, slugs) {
  if (!slugs.length) return [];
  const res = await client.query(
    `
    SELECT lm.slug, lm.display_name, b.name AS brand_name
    FROM lens_models lm
    JOIN brands b ON b.brand_id = lm.brand_id
    WHERE lm.slug = ANY($1::text[])
    `,
    [slugs],
  );

  const bySlug = new Map(res.rows.map((r) => [r.slug, r]));
  return slugs
    .map((slug) => bySlug.get(slug))
    .filter(Boolean)
    .map((r) => ({
      kind: "lens",
      slug: r.slug,
      query: `${r.display_name} lens`,
    }));
}

function dedupeListings(listings) {
  const byKey = new Map();
  for (const l of listings) {
    if (!l) continue;
    const key = `${l.marketplace_code}:${l.source_item_id}`;
    byKey.set(key, l);
  }
  return Array.from(byKey.values());
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("Missing DATABASE_URL.");
    process.exitCode = 2;
    return;
  }

  const env = envString("EBAY_ENV", "sandbox");
  const clientId = envString("EBAY_CLIENT_ID", "");
  const clientSecret = envString("EBAY_CLIENT_SECRET", "");
  const marketplaceId = envString("EBAY_MARKETPLACE_ID", "EBAY_US");

  const cameraSlugs = parseCsv(envString("FF_EBAY_CAMERA_SLUGS", DEFAULT_CAMERA_SLUGS));
  const lensSlugs = parseCsv(envString("FF_EBAY_LENS_SLUGS", ""));

  const extraQueries = parseCsv(envString("FF_EBAY_EXTRA_QUERIES", ""));

  const limitPerQuery = envInt("FF_EBAY_LIMIT_PER_QUERY", 25, { min: 1, max: 200 });
  const pagesPerQuery = envInt("FF_EBAY_PAGES_PER_QUERY", 1, { min: 1, max: 20 });
  const queryVariantsPerModel = envInt("FF_EBAY_QUERY_VARIANTS_PER_MODEL", 4, { min: 1, max: 6 });
  const searchSorts = parseSearchSorts(envString("FF_EBAY_SORTS", "best,newlyListed"));
  const searchFilter = envString("FF_EBAY_FILTER", "");

  const categoryIds = parseCsv(envString("EBAY_CATEGORY_IDS", ""));

  const marketplaceCode = envString("FF_INGEST_MARKETPLACE_CODE", "ebay");
  const jobName = envString("FF_INGEST_JOB_NAME", `ingest_${marketplaceCode}_browse_${env}`).slice(0, 64);

  const db = new Client({ connectionString });
  await db.connect();

  try {
    const modelQueries = [
      ...(await loadCameraQueries(db, cameraSlugs, { maxQueriesPerModel: queryVariantsPerModel })),
      ...(await loadLensQueries(db, lensSlugs)),
      ...extraQueries.map((q) => ({ kind: "custom", slug: null, query: q })),
    ];

    if (modelQueries.length === 0) {
      console.error("No queries configured. Set FF_EBAY_CAMERA_SLUGS / FF_EBAY_LENS_SLUGS and/or FF_EBAY_EXTRA_QUERIES.");
      process.exitCode = 2;
      return;
    }

    const accessToken = await getEbayAccessToken({ env, clientId, clientSecret });

    const allListings = [];
    const startedAt = new Date().toISOString();

    for (const q of modelQueries) {
      for (const searchSort of searchSorts) {
        for (let page = 0; page < pagesPerQuery; page += 1) {
          const offset = page * limitPerQuery;
          const resp = await searchEbayBrowseApi({
            env,
            accessToken,
            marketplaceId,
            q: q.query,
            limit: limitPerQuery,
            offset,
            categoryIds: categoryIds.length ? categoryIds : null,
            sort: searchSort,
            filter: searchFilter || null,
          });

          const retrievedAt = new Date().toISOString();
          for (const item of resp.items) {
            const listing = normalizeEbayItemSummaryToListing(item, {
              marketplaceCode,
              retrievedAt,
              env,
              query: q.query,
              queryLabel: q.query_label || null,
              sort: searchSort,
              filter: searchFilter || null,
            });
            if (listing) allListings.push(listing);
          }

          if (resp.items.length < limitPerQuery) break;
        }
      }
    }

    const listings = dedupeListings(allListings);

    const result = await ingestListingsOnce(db, {
      jobName,
      marketplaceCode,
      marketplaceDisplayName: env === "sandbox" ? "eBay (sandbox)" : "eBay",
      affiliateSupported: true,
      listings,
    });

    if (!result.ok) {
      console.error("Ingestion failed:", result.error);
      process.exitCode = 1;
      return;
    }

    console.log("Ingested eBay Browse API listings OK:");
    console.log("- env:", env);
    console.log("- marketplace_id:", marketplaceId);
    console.log("- job_name:", jobName);
    console.log("- started_at:", startedAt);
    console.log("- queries:", modelQueries.length);
    console.log("- sorts:", searchSorts.join(", "));
    if (searchFilter) console.log("- filter:", searchFilter);
    console.log("- listings_deduped:", listings.length);
    console.log("- run_id:", result.run_id);
    console.log("- stats:", result.stats);
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
