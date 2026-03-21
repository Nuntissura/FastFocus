import pg from "pg";

const { Client } = pg;

function parseArgs(argv) {
  const result = {
    brandSlug: null,
    excludeBrands: [],
    confirm: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      result.help = true;
      continue;
    }
    if (arg === "--confirm") {
      result.confirm = true;
      continue;
    }
    if (arg === "--brand" || arg === "--brand-slug") {
      const value = argv[i + 1];
      if (!value) throw new Error(`${arg} requires a value`);
      result.brandSlug = value;
      i++;
      continue;
    }
    if (arg === "--exclude-brands") {
      const value = argv[i + 1];
      if (!value) throw new Error("--exclude-brands requires a comma-separated value");
      result.excludeBrands = value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      i++;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (result.brandSlug && result.excludeBrands.length > 0) {
    throw new Error("Use either --brand-slug or --exclude-brands, not both.");
  }

  return result;
}

function printUsage() {
  // eslint-disable-next-line no-console
  console.log(
    [
      "Purge camera models (and dependent rows) from Postgres.",
      "",
      "Usage:",
      "  node apps/api/src/db/purge_camera_models.js [--brand-slug canon] [--exclude-brands sony,nikon] [--confirm]",
      "",
      "Notes:",
      "- Default is dry-run (no changes).",
      "- Pass --confirm to apply deletes.",
      "- --exclude-brands keeps the listed brands and purges every other camera brand.",
      "- Requires DATABASE_URL.",
    ].join("\n"),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    // eslint-disable-next-line no-console
    console.error("Missing DATABASE_URL.");
    printUsage();
    process.exitCode = 2;
    return;
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");

    const cameraRes = await client.query(
      `
      SELECT cm.camera_id, cm.slug
      FROM camera_models cm
      JOIN brands b ON b.brand_id = cm.brand_id
      WHERE
        ($1::text IS NULL OR b.slug = $1)
        AND (
          COALESCE(array_length($2::text[], 1), 0) = 0
          OR NOT (b.slug = ANY($2::text[]))
        )
      ORDER BY b.slug, cm.slug
      `,
      [args.brandSlug, args.excludeBrands],
    );

    const cameraIds = cameraRes.rows.map((r) => r.camera_id);
    const cameraSlugs = cameraRes.rows.map((r) => r.slug);

    // eslint-disable-next-line no-console
    console.log("Camera models matched:", cameraIds.length);
    if (args.brandSlug) {
      // eslint-disable-next-line no-console
      console.log("- brand_slug:", args.brandSlug);
    }
    if (args.excludeBrands.length > 0) {
      // eslint-disable-next-line no-console
      console.log("- keeping brands:", args.excludeBrands.join(", "));
    }
    if (cameraSlugs.length > 0) {
      const preview = cameraSlugs.slice(0, 20);
      // eslint-disable-next-line no-console
      console.log("- first slugs:", preview.join(", "));
      if (cameraSlugs.length > preview.length) {
        // eslint-disable-next-line no-console
        console.log(`- ... and ${cameraSlugs.length - preview.length} more`);
      }
    }

    if (cameraIds.length === 0) {
      await client.query("ROLLBACK");
      // eslint-disable-next-line no-console
      console.log("Nothing to purge.");
      return;
    }

    const listingRes = await client.query(
      `
      SELECT listing_id
      FROM listings
      WHERE camera_id = ANY($1::uuid[])
      `,
      [cameraIds],
    );
    const listingIds = listingRes.rows.map((r) => r.listing_id);

    const savedSearchRes = await client.query(
      `
      SELECT saved_search_id
      FROM saved_searches
      WHERE camera_id = ANY($1::uuid[])
      `,
      [cameraIds],
    );
    const savedSearchIds = savedSearchRes.rows.map((r) => r.saved_search_id);

    const trackerWatchRes = await client.query(
      `
      SELECT premium_tracker_watch_id
      FROM premium_tracker_watches
      WHERE camera_id = ANY($1::uuid[])
      `,
      [cameraIds],
    );
    const trackerWatchIds = trackerWatchRes.rows.map((r) => r.premium_tracker_watch_id);

    const eventRes = await client.query(
      `
      SELECT event_id
      FROM events
      WHERE
        camera_id = ANY($1::uuid[])
        OR compare_camera_id = ANY($1::uuid[])
        OR listing_id = ANY($2::uuid[])
      `,
      [cameraIds, listingIds],
    );
    const eventIds = eventRes.rows.map((r) => r.event_id);

    // eslint-disable-next-line no-console
    console.log("Dependent listings matched:", listingIds.length);
    // eslint-disable-next-line no-console
    console.log("Dependent saved searches matched:", savedSearchIds.length);
    // eslint-disable-next-line no-console
    console.log("Dependent premium tracker watches matched:", trackerWatchIds.length);
    // eslint-disable-next-line no-console
    console.log("Dependent analytics events matched:", eventIds.length);

    if (!args.confirm) {
      await client.query("ROLLBACK");
      // eslint-disable-next-line no-console
      console.log("Dry run complete (no changes). Re-run with --confirm to apply deletes.");
      return;
    }

    if (eventIds.length > 0) {
      await client.query(`DELETE FROM events WHERE event_id = ANY($1::bigint[])`, [eventIds]);
    }

    if (listingIds.length > 0) {
      await client.query(`DELETE FROM listing_snapshots WHERE listing_id = ANY($1::uuid[])`, [listingIds]);
      await client.query(`DELETE FROM listings WHERE listing_id = ANY($1::uuid[])`, [listingIds]);
    }

    if (savedSearchIds.length > 0) {
      await client.query(`DELETE FROM saved_searches WHERE saved_search_id = ANY($1::uuid[])`, [savedSearchIds]);
    }

    if (trackerWatchIds.length > 0) {
      await client.query(`DELETE FROM premium_tracker_watches WHERE premium_tracker_watch_id = ANY($1::uuid[])`, [trackerWatchIds]);
    }

    await client.query(`DELETE FROM price_observations WHERE camera_id = ANY($1::uuid[])`, [cameraIds]);
    await client.query(`DELETE FROM source_evidence WHERE entity_type = 'camera_model' AND entity_id = ANY($1::uuid[])`, [cameraIds]);
    await client.query(`DELETE FROM camera_models WHERE camera_id = ANY($1::uuid[])`, [cameraIds]);

    await client.query("COMMIT");
    // eslint-disable-next-line no-console
    console.log("Purge complete.");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
