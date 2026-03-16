import pg from "pg";

const { Client } = pg;

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("Missing DATABASE_URL.");
    process.exitCode = 2;
    return;
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const now = new Date().toISOString();

    const brand = await client.query(
      `
      INSERT INTO brands (slug, name)
      VALUES ('sony', 'Sony')
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
      RETURNING brand_id, slug, name
      `
    );

    await client.query(
      `
      INSERT INTO marketplaces (marketplace_code, display_name, affiliate_supported)
      VALUES ('demo', 'Demo Source', FALSE)
      ON CONFLICT (marketplace_code) DO UPDATE SET display_name = EXCLUDED.display_name
      `,
    );

    const camera = await client.query(
      `
      INSERT INTO camera_models (
        slug,
        brand_id,
        display_name,
        capture_medium,
        camera_category,
        lens_system_type,
        mount_code,
        release_year,
        announce_date
      )
      VALUES (
        'sony-a7-iv',
        $1,
        'Sony A7 IV',
        'digital',
        'mirrorless',
        'interchangeable',
        'sony_e',
        2021,
        '2021-10-21'
      )
      ON CONFLICT (slug) DO UPDATE SET
        brand_id = EXCLUDED.brand_id,
        display_name = EXCLUDED.display_name,
        capture_medium = EXCLUDED.capture_medium,
        camera_category = EXCLUDED.camera_category,
        lens_system_type = EXCLUDED.lens_system_type,
        mount_code = EXCLUDED.mount_code,
        release_year = EXCLUDED.release_year,
        announce_date = EXCLUDED.announce_date
      RETURNING camera_id, slug, display_name
      `,
      [brand.rows[0].brand_id],
    );

    const lens = await client.query(
      `
      INSERT INTO lens_models (
        slug,
        brand_id,
        display_name,
        mount_code,
        lens_category,
        focal_length_min_mm,
        focal_length_max_mm,
        max_aperture_wide_f,
        max_aperture_tele_f,
        has_is,
        release_year
      )
      VALUES (
        'sony-fe-24-70mm-f2-8-gm-ii',
        $1,
        'Sony FE 24-70mm f/2.8 GM II',
        'sony_e',
        'zoom',
        24,
        70,
        2.8,
        2.8,
        FALSE,
        NULL
      )
      ON CONFLICT (slug) DO UPDATE SET
        brand_id = EXCLUDED.brand_id,
        display_name = EXCLUDED.display_name,
        mount_code = EXCLUDED.mount_code,
        lens_category = EXCLUDED.lens_category,
        focal_length_min_mm = EXCLUDED.focal_length_min_mm,
        focal_length_max_mm = EXCLUDED.focal_length_max_mm,
        max_aperture_wide_f = EXCLUDED.max_aperture_wide_f,
        max_aperture_tele_f = EXCLUDED.max_aperture_tele_f,
        has_is = EXCLUDED.has_is,
        release_year = EXCLUDED.release_year
      RETURNING lens_id, slug, display_name
      `,
      [brand.rows[0].brand_id],
    );

    await client.query(
      `
      INSERT INTO listings (
        marketplace_code,
        source_item_id,
        url,
        title,
        last_retrieved_at,
        is_active,
        camera_id,
        match_status,
        match_confidence,
        match_method,
        price_amount,
        price_currency,
        shipping_amount,
        shipping_currency,
        fees_included,
        condition_raw,
        condition_physical_tier,
        functional_status,
        seller_type,
        seller_id,
        seller_rating,
        country,
        region,
        city,
        pickup_possible,
        included_items,
        extracted_attributes,
        media,
        raw_ref,
        first_seen_at,
        last_seen_at
      )
      VALUES (
        'demo',
        'demo-001',
        'https://example.invalid/listing/demo-001',
        'Sony A7 IV body - good condition',
        $1,
        TRUE,
        $2,
        'matched',
        0.90,
        'seed_demo',
        1499.00,
        'EUR',
        NULL,
        NULL,
        TRUE,
        'good',
        'used_good',
        'working',
        'private',
        'demo_seller',
        4.8,
        'BE',
        'Flanders',
        'Antwerp',
        TRUE,
        '[]'::jsonb,
        '[]'::jsonb,
        '[]'::jsonb,
        '{}'::jsonb,
        $1,
        $1
      )
      ON CONFLICT (marketplace_code, source_item_id) DO UPDATE SET
        last_retrieved_at = EXCLUDED.last_retrieved_at,
        is_active = EXCLUDED.is_active,
        camera_id = EXCLUDED.camera_id,
        match_status = EXCLUDED.match_status,
        match_confidence = EXCLUDED.match_confidence,
        match_method = EXCLUDED.match_method,
        price_amount = EXCLUDED.price_amount,
        price_currency = EXCLUDED.price_currency,
        condition_raw = EXCLUDED.condition_raw,
        condition_physical_tier = EXCLUDED.condition_physical_tier,
        functional_status = EXCLUDED.functional_status,
        seller_type = EXCLUDED.seller_type,
        seller_id = EXCLUDED.seller_id,
        seller_rating = EXCLUDED.seller_rating,
        country = EXCLUDED.country,
        region = EXCLUDED.region,
        city = EXCLUDED.city,
        pickup_possible = EXCLUDED.pickup_possible,
        last_seen_at = EXCLUDED.last_seen_at
      `,
      [now, camera.rows[0].camera_id],
    );

    await client.query(
      `
      INSERT INTO listings (
        marketplace_code,
        source_item_id,
        url,
        title,
        last_retrieved_at,
        is_active,
        camera_id,
        lens_id,
        match_status,
        match_confidence,
        match_method,
        price_amount,
        price_currency,
        shipping_amount,
        shipping_currency,
        fees_included,
        condition_raw,
        condition_physical_tier,
        functional_status,
        seller_type,
        seller_id,
        seller_rating,
        country,
        region,
        city,
        pickup_possible,
        included_items,
        extracted_attributes,
        media,
        raw_ref,
        first_seen_at,
        last_seen_at
      )
      VALUES (
        'demo',
        'demo-002',
        'https://example.invalid/listing/demo-002',
        'Sony FE 24-70mm f/2.8 GM II lens',
        $1,
        TRUE,
        NULL,
        $2,
        'matched',
        0.88,
        'seed_demo',
        1499.00,
        'EUR',
        NULL,
        NULL,
        TRUE,
        'good',
        'used_good',
        'working',
        'private',
        'demo_seller_lens',
        4.9,
        'BE',
        'Flanders',
        'Antwerp',
        TRUE,
        '[]'::jsonb,
        '[]'::jsonb,
        '[]'::jsonb,
        '{}'::jsonb,
        $1,
        $1
      )
      ON CONFLICT (marketplace_code, source_item_id) DO UPDATE SET
        last_retrieved_at = EXCLUDED.last_retrieved_at,
        is_active = EXCLUDED.is_active,
        camera_id = EXCLUDED.camera_id,
        lens_id = EXCLUDED.lens_id,
        match_status = EXCLUDED.match_status,
        match_confidence = EXCLUDED.match_confidence,
        match_method = EXCLUDED.match_method,
        price_amount = EXCLUDED.price_amount,
        price_currency = EXCLUDED.price_currency,
        condition_raw = EXCLUDED.condition_raw,
        condition_physical_tier = EXCLUDED.condition_physical_tier,
        functional_status = EXCLUDED.functional_status,
        seller_type = EXCLUDED.seller_type,
        seller_id = EXCLUDED.seller_id,
        seller_rating = EXCLUDED.seller_rating,
        country = EXCLUDED.country,
        region = EXCLUDED.region,
        city = EXCLUDED.city,
        pickup_possible = EXCLUDED.pickup_possible,
        last_seen_at = EXCLUDED.last_seen_at
      `,
      [now, lens.rows[0].lens_id],
    );

    console.log("Seeded demo data OK:");
    console.log("- brand:", brand.rows[0].slug);
    console.log("- camera:", camera.rows[0].slug);
    console.log("- lens:", lens.rows[0].slug);
    console.log("- listings:", "demo/demo-001, demo/demo-002");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
