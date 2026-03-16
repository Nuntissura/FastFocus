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

    await client.query(
      `
      INSERT INTO marketplaces (marketplace_code, display_name, affiliate_supported)
      VALUES ('demo_samples', 'Demo Samples', FALSE)
      ON CONFLICT (marketplace_code) DO UPDATE SET display_name = EXCLUDED.display_name
      `,
    );

    const samples = [
      {
        source_item_id: "sample-001",
        title: "Sony A7 body only - good condition",
        seller_id: "seller_1",
        price_amount: 899.0,
        currency: "EUR",
      },
      {
        source_item_id: "sample-002",
        title: "Canon R6 body only - excellent",
        seller_id: "seller_2",
        price_amount: 1299.0,
        currency: "EUR",
      },
      {
        source_item_id: "sample-003",
        title: "Nikon Z6 II body - low shutter count",
        seller_id: "seller_3",
        price_amount: 1399.0,
        currency: "EUR",
      },
      {
        source_item_id: "sample-004",
        title: "Sony FE 24-70mm f/2.8 GM II lens",
        seller_id: "seller_4",
        price_amount: 1699.0,
        currency: "EUR",
      },
      {
        source_item_id: "sample-005",
        title: "Fujifilm XT30 body - used",
        seller_id: "seller_5",
        price_amount: 699.0,
        currency: "EUR",
      },
      {
        source_item_id: "sample-006",
        title: "Olympus 12-40mm f/2.8 PRO lens",
        seller_id: "seller_6",
        price_amount: 449.0,
        currency: "EUR",
      },
      {
        source_item_id: "sample-100",
        title: "Sony A7 IV body - boxed",
        seller_id: "dup_seller",
        price_amount: 1499.0,
        currency: "EUR",
      },
      {
        source_item_id: "sample-101",
        title: "Sony A7 IV body - boxed",
        seller_id: "dup_seller",
        price_amount: 1499.0,
        currency: "EUR",
      },
    ];

    for (const s of samples) {
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
          'demo_samples',
          $1,
          $2,
          $3,
          $4,
          TRUE,
          NULL,
          NULL,
          'unmatched',
          0.00,
          NULL,
          $5,
          $6,
          NULL,
          NULL,
          TRUE,
          NULL,
          'used_good',
          'unknown',
          'unknown',
          $7,
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          '[]'::jsonb,
          '[]'::jsonb,
          '[]'::jsonb,
          '{}'::jsonb,
          $4,
          $4
        )
        ON CONFLICT (marketplace_code, source_item_id) DO UPDATE SET
          title = EXCLUDED.title,
          last_retrieved_at = EXCLUDED.last_retrieved_at,
          is_active = EXCLUDED.is_active,
          price_amount = EXCLUDED.price_amount,
          price_currency = EXCLUDED.price_currency,
          seller_id = EXCLUDED.seller_id,
          last_seen_at = EXCLUDED.last_seen_at
        `,
        [
          s.source_item_id,
          `https://example.invalid/listing/${encodeURIComponent(s.source_item_id)}`,
          s.title,
          now,
          s.price_amount,
          s.currency,
          s.seller_id,
        ],
      );
    }

    console.log("Seeded matching samples OK:", samples.length);
    console.log("Marketplace:", "demo_samples");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
