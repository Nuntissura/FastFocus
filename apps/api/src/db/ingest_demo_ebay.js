import pg from "pg";

import { fetchDemoEbayListings } from "../ingest/providers/demo_ebay.js";
import { ingestListingsOnce } from "../ingest/write_listings.js";

const { Client } = pg;

function envString(name, fallback) {
  const raw = process.env[name];
  return raw && raw.trim() ? raw.trim() : fallback;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("Missing DATABASE_URL.");
    process.exitCode = 2;
    return;
  }

  const marketplaceCode = envString("FF_INGEST_MARKETPLACE_CODE", "ebay");
  const marketplaceName = envString("FF_INGEST_MARKETPLACE_NAME", "eBay (demo)");
  const jobName = envString("FF_INGEST_JOB_NAME", `ingest_${marketplaceCode}_demo`);

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const listings = fetchDemoEbayListings().map((l) => ({ ...l, marketplace_code: marketplaceCode }));

    const result = await ingestListingsOnce(client, {
      jobName,
      marketplaceCode,
      marketplaceDisplayName: marketplaceName,
      affiliateSupported: true,
      listings,
    });

    if (!result.ok) {
      console.error("Ingestion failed:", result.error);
      process.exitCode = 1;
      return;
    }

    console.log("Ingested listings OK:");
    console.log("- marketplace_code:", marketplaceCode);
    console.log("- run_id:", result.run_id);
    console.log("- stats:", result.stats);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

