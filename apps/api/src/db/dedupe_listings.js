import pg from "pg";

const { Client } = pg;

function envNumber(name, fallback) {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function envBool(name, fallback = false) {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return fallback;
  return raw.trim().toLowerCase() === "true";
}

function normalizeTitle(title) {
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function keyForListing(l) {
  const seller = l.seller_id || "";
  if (!seller) return null;
  const titleNorm = normalizeTitle(l.title);
  return [l.marketplace_code, seller, l.price_currency, String(l.price_amount), titleNorm].join("|");
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("Missing DATABASE_URL.");
    process.exitCode = 2;
    return;
  }

  const limit = envNumber("FF_DEDUPE_LIMIT", 2000);
  const dryRun = envBool("FF_DEDUPE_DRY_RUN", false);

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const res = await client.query(
      `
      SELECT
        listing_id,
        marketplace_code,
        seller_id,
        title,
        price_amount::float8 AS price_amount,
        price_currency,
        last_seen_at
      FROM listings
      WHERE is_active = TRUE
      ORDER BY last_seen_at DESC
      LIMIT $1
      `,
      [limit],
    );

    const groups = new Map();
    for (const l of res.rows) {
      const key = keyForListing(l);
      if (!key) continue;
      const arr = groups.get(key) || [];
      arr.push(l);
      groups.set(key, arr);
    }

    const edges = [];
    for (const [, listings] of groups.entries()) {
      if (listings.length < 2) continue;
      listings.sort((a, b) => new Date(b.last_seen_at).getTime() - new Date(a.last_seen_at).getTime());
      const canonical = listings[0];
      for (const dup of listings.slice(1)) {
        edges.push({
          canonical_listing_id: canonical.listing_id,
          duplicate_listing_id: dup.listing_id,
          reason: `same seller + price + normalized title (method=exact_key_v0)`,
        });
      }
    }

    if (!dryRun) await client.query("BEGIN");

    let upserted = 0;
    for (const e of edges) {
      if (dryRun) continue;
      await client.query(
        `
        INSERT INTO listing_dedupe_edges (
          canonical_listing_id,
          duplicate_listing_id,
          method,
          confidence,
          reason
        )
        VALUES ($1,$2,'exact_key_v0',0.90,$3)
        ON CONFLICT (duplicate_listing_id) DO UPDATE SET
          canonical_listing_id = EXCLUDED.canonical_listing_id,
          method = EXCLUDED.method,
          confidence = EXCLUDED.confidence,
          reason = EXCLUDED.reason
        `,
        [e.canonical_listing_id, e.duplicate_listing_id, e.reason],
      );
      upserted += 1;
    }

    if (!dryRun) await client.query("COMMIT");

    console.log("Dedupe edges OK:");
    console.log("- listings_considered:", res.rows.length);
    console.log("- edges_found:", edges.length);
    console.log("- upserted:", upserted);
    console.log("- dry_run:", dryRun);
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore
    }
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

