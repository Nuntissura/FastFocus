import fs from "node:fs/promises";
import path from "node:path";

import pg from "pg";
import { resolveGovContractsRoot } from "../paths.js";

const { Client } = pg;

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+){0,127}$/;
const MOUNT_RE = /^[a-z0-9_]{2,40}$/;

const CAPTURE_MEDIUM = new Set(["digital", "film"]);
const CAMERA_CATEGORY = new Set([
  "mirrorless",
  "dslr",
  "compact",
  "rangefinder",
  "slr_film",
  "tlr_film",
  "medium_format",
  "instant",
  "other",
]);
const LENS_SYSTEM_TYPE = new Set(["interchangeable", "fixed"]);
const SENSOR_FORMAT = new Set([
  "full_frame",
  "aps_c",
  "aps_h",
  "micro_four_thirds",
  "one_inch",
  "one_over_1_6_inch",
  "one_over_1_7_inch",
  "one_over_1_8_inch",
  "one_over_2_0_inch",
  "one_over_2_3_inch",
  "one_over_2_5_inch",
  "one_over_2_7_inch",
  "one_over_3_0_inch",
  "medium_format_44x33",
  "medium_format_645",
  "other",
]);
const LENS_CATEGORY = new Set(["prime", "zoom", "teleconverter", "other"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function ensureUnique(items, keyFn, label) {
  const seen = new Set();
  for (const item of items) {
    const key = keyFn(item);
    assert(!seen.has(key), `${label} must be unique; duplicate: ${key}`);
    seen.add(key);
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateSeed(seed) {
  assert(isObject(seed), "Seed file must be an object.");
  assert(typeof seed.seed_id === "string" && seed.seed_id.trim(), "seed.seed_id is required.");
  assert(typeof seed.seed_date === "string" && seed.seed_date.trim(), "seed.seed_date is required.");
  assert(Array.isArray(seed.brands), "seed.brands must be an array.");
  assert(Array.isArray(seed.camera_models), "seed.camera_models must be an array.");
  assert(Array.isArray(seed.lens_models), "seed.lens_models must be an array.");

  ensureUnique(seed.brands, (b) => b.slug, "Brand slug");
  ensureUnique(seed.camera_models, (m) => m.slug, "Camera slug");
  ensureUnique(seed.lens_models, (m) => m.slug, "Lens slug");

  const brandSlugs = new Set(seed.brands.map((b) => b.slug));

  for (const b of seed.brands) {
    assert(typeof b.slug === "string" && SLUG_RE.test(b.slug), `Invalid brand.slug: ${b.slug}`);
    assert(typeof b.name === "string" && b.name.trim().length >= 1, `Invalid brand.name for ${b.slug}`);
  }

  for (const m of seed.camera_models) {
    assert(typeof m.slug === "string" && SLUG_RE.test(m.slug), `Invalid camera.slug: ${m.slug}`);
    assert(brandSlugs.has(m.brand_slug), `Camera ${m.slug} references unknown brand_slug: ${m.brand_slug}`);
    assert(typeof m.display_name === "string" && m.display_name.trim(), `Invalid camera.display_name: ${m.slug}`);
    assert(CAPTURE_MEDIUM.has(m.capture_medium), `Invalid camera.capture_medium for ${m.slug}`);
    assert(CAMERA_CATEGORY.has(m.camera_category), `Invalid camera.camera_category for ${m.slug}`);
    assert(LENS_SYSTEM_TYPE.has(m.lens_system_type), `Invalid camera.lens_system_type for ${m.slug}`);
    assert(
      m.lens_system_type === "interchangeable",
      `Unsupported camera.lens_system_type for ${m.slug}: ${m.lens_system_type} (fixed-lens support not implemented in seed script yet)`,
    );
    assert(typeof m.mount_code === "string" && MOUNT_RE.test(m.mount_code), `Invalid camera.mount_code for ${m.slug}`);
    assert(
      m.release_year === null || (typeof m.release_year === "number" && Number.isInteger(m.release_year)),
      `Invalid camera.release_year for ${m.slug}`,
    );
    assert(m.sensor_format === null || SENSOR_FORMAT.has(m.sensor_format), `Invalid camera.sensor_format for ${m.slug}`);
    assert(m.resolution_mp === null || typeof m.resolution_mp === "number", `Invalid camera.resolution_mp for ${m.slug}`);
    assert(m.ibis === null || typeof m.ibis === "boolean", `Invalid camera.ibis for ${m.slug}`);
  }

  for (const m of seed.lens_models) {
    assert(typeof m.slug === "string" && SLUG_RE.test(m.slug), `Invalid lens.slug: ${m.slug}`);
    assert(brandSlugs.has(m.brand_slug), `Lens ${m.slug} references unknown brand_slug: ${m.brand_slug}`);
    assert(typeof m.display_name === "string" && m.display_name.trim(), `Invalid lens.display_name: ${m.slug}`);
    assert(typeof m.mount_code === "string" && MOUNT_RE.test(m.mount_code), `Invalid lens.mount_code for ${m.slug}`);
    assert(m.coverage_format === null || SENSOR_FORMAT.has(m.coverage_format), `Invalid lens.coverage_format for ${m.slug}`);
    assert(LENS_CATEGORY.has(m.lens_category), `Invalid lens.lens_category for ${m.slug}`);
    assert(typeof m.focal_length_min_mm === "number" && Number.isInteger(m.focal_length_min_mm), `Invalid lens.focal_length_min_mm for ${m.slug}`);
    assert(typeof m.focal_length_max_mm === "number" && Number.isInteger(m.focal_length_max_mm), `Invalid lens.focal_length_max_mm for ${m.slug}`);
    assert(m.focal_length_min_mm <= m.focal_length_max_mm, `Lens focal range invalid for ${m.slug}`);
    assert(typeof m.max_aperture_wide_f === "number", `Invalid lens.max_aperture_wide_f for ${m.slug}`);
    assert(typeof m.max_aperture_tele_f === "number", `Invalid lens.max_aperture_tele_f for ${m.slug}`);
    assert(m.max_aperture_wide_f <= m.max_aperture_tele_f, `Lens aperture range invalid for ${m.slug}`);
    assert(m.has_is === null || typeof m.has_is === "boolean", `Invalid lens.has_is for ${m.slug}`);
    assert(m.release_year === null || (typeof m.release_year === "number" && Number.isInteger(m.release_year)), `Invalid lens.release_year for ${m.slug}`);
  }
}

async function upsertEvidence(client, { entityType, entityId, claimPath, sourceUrl, retrievedAt, value, notes }) {
  const valueJson = JSON.stringify(value);
  await client.query(
    `
    INSERT INTO source_evidence (
      entity_type,
      entity_id,
      claim_path,
      source_type,
      source_url,
      retrieved_at,
      license,
      confidence,
      value_json,
      notes
    )
    VALUES ($1, $2, $3, 'manual', $4, $5, 'internal_seed', 0.50, $6::jsonb, $7)
    ON CONFLICT (entity_type, entity_id, claim_path, source_url) DO UPDATE SET
      retrieved_at = EXCLUDED.retrieved_at,
      license = EXCLUDED.license,
      confidence = EXCLUDED.confidence,
      value_json = EXCLUDED.value_json,
      notes = EXCLUDED.notes
    `,
    [entityType, entityId, claimPath, sourceUrl, retrievedAt, valueJson, notes],
  );
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("Missing DATABASE_URL.");
    console.error("Example:");
    console.error("  DATABASE_URL=postgres://fastfocus:fastfocus@127.0.0.1:55432/fastfocus");
    process.exitCode = 2;
    return;
  }

  const allowSeedRaw = process.env.FF_ALLOW_CATALOG_SEED;
  const allowSeed = allowSeedRaw ? allowSeedRaw.trim().toLowerCase() : "";
  if (!["1", "true", "yes"].includes(allowSeed)) {
    console.error("Catalog seeding is disabled by default.");
    console.error("This project is moving to a datasheet-first workflow under `FF - gov/catalog/data_sheets/`.");
    console.error("");
    console.error("To run this legacy seed script anyway, set:");
    console.error("  FF_ALLOW_CATALOG_SEED=1");
    process.exitCode = 2;
    return;
  }

  const contractsRoot = resolveGovContractsRoot();
  const defaultSeedPaths = [
    path.resolve(contractsRoot, "seeds", "phase1_catalog_v1.json"),
    path.resolve(contractsRoot, "seeds", "canon_eos_digital_v1.json"),
  ];

  const envPaths = process.env.FF_CATALOG_SEED_PATHS;
  const envPath = process.env.FF_CATALOG_SEED_PATH;

  const seedPaths = envPaths
    ? envPaths
        .split(/[;,]/g)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((p) => path.resolve(p))
    : envPath
      ? [path.resolve(envPath)]
      : defaultSeedPaths;

  const seeds = [];
  for (const p of seedPaths) {
    const seedRaw = await fs.readFile(p, "utf-8");
    const seed = JSON.parse(seedRaw);
    validateSeed(seed);
    seeds.push({ seedPath: p, seed });
  }

  const brandNameBySlug = new Map();
  const cameraSlugToSeedId = new Map();
  const lensSlugToSeedId = new Map();

  for (const { seed } of seeds) {
    for (const b of seed.brands) {
      const prev = brandNameBySlug.get(b.slug);
      if (prev !== undefined && prev !== b.name) {
        throw new Error(`Brand slug appears in multiple seeds with different names: ${b.slug} (${prev} vs ${b.name})`);
      }
      brandNameBySlug.set(b.slug, b.name);
    }

    for (const m of seed.camera_models) {
      const prev = cameraSlugToSeedId.get(m.slug);
      if (prev !== undefined) throw new Error(`Camera slug appears in multiple seeds: ${m.slug} (${prev} vs ${seed.seed_id})`);
      cameraSlugToSeedId.set(m.slug, seed.seed_id);
    }

    for (const m of seed.lens_models) {
      const prev = lensSlugToSeedId.get(m.slug);
      if (prev !== undefined) throw new Error(`Lens slug appears in multiple seeds: ${m.slug} (${prev} vs ${seed.seed_id})`);
      lensSlugToSeedId.set(m.slug, seed.seed_id);
    }
  }

  const retrievedAt = new Date().toISOString();

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");

    for (const [slug, name] of brandNameBySlug.entries()) {
      await client.query(
        `
        INSERT INTO brands (slug, name)
        VALUES ($1, $2)
        ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
        `,
        [slug, name],
      );
    }

    const brandSlugs = [...brandNameBySlug.keys()];
    const brandMapRes = await client.query(
      `
      SELECT brand_id, slug
      FROM brands
      WHERE slug = ANY($1::text[])
      `,
      [brandSlugs],
    );
    const brandIdBySlug = new Map(brandMapRes.rows.map((r) => [r.slug, r.brand_id]));

    for (const { seed } of seeds) {
      const seedId = seed.seed_id;

      for (const m of seed.camera_models) {
        const brandId = brandIdBySlug.get(m.brand_slug);
        if (!brandId) throw new Error(`Missing brand_id for camera ${m.slug} (${m.brand_slug})`);

        const cameraRes = await client.query(
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
            announce_date,
            sensor_format,
            resolution_mp,
            ibis
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,$9,$10,$11)
          ON CONFLICT (slug) DO UPDATE SET
            brand_id = EXCLUDED.brand_id,
            display_name = EXCLUDED.display_name,
            capture_medium = EXCLUDED.capture_medium,
            camera_category = EXCLUDED.camera_category,
            lens_system_type = EXCLUDED.lens_system_type,
            mount_code = EXCLUDED.mount_code,
            release_year = EXCLUDED.release_year,
            announce_date = EXCLUDED.announce_date,
            sensor_format = EXCLUDED.sensor_format,
            resolution_mp = EXCLUDED.resolution_mp,
            ibis = EXCLUDED.ibis
          RETURNING camera_id
          `,
          [
            m.slug,
            brandId,
            m.display_name,
            m.capture_medium,
            m.camera_category,
            m.lens_system_type,
            m.mount_code,
            m.release_year ?? null,
            m.sensor_format ?? null,
            m.resolution_mp ?? null,
            m.ibis ?? null,
          ],
        );

        const cameraId = cameraRes.rows[0].camera_id;
        const sourceUrl = `seed:${seedId}#camera_model/${m.slug}`;
        const notes = `Seeded from ${seedId}`;

        await upsertEvidence(client, {
          entityType: "camera_model",
          entityId: cameraId,
          claimPath: "mount_code",
          sourceUrl,
          retrievedAt,
          value: m.mount_code,
          notes,
        });

        for (const [claimPath, value] of [
          ["release_year", m.release_year],
          ["sensor_format", m.sensor_format],
          ["resolution_mp", m.resolution_mp],
          ["ibis", m.ibis],
        ]) {
          if (value === null || value === undefined) continue;
          await upsertEvidence(client, { entityType: "camera_model", entityId: cameraId, claimPath, sourceUrl, retrievedAt, value, notes });
        }
      }

      for (const m of seed.lens_models) {
        const brandId = brandIdBySlug.get(m.brand_slug);
        if (!brandId) throw new Error(`Missing brand_id for lens ${m.slug} (${m.brand_slug})`);

        const lensRes = await client.query(
          `
          INSERT INTO lens_models (
            slug,
            brand_id,
            display_name,
            mount_code,
            coverage_format,
            lens_category,
            focal_length_min_mm,
            focal_length_max_mm,
            max_aperture_wide_f,
            max_aperture_tele_f,
            has_is,
            release_year,
            announce_date
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NULL)
          ON CONFLICT (slug) DO UPDATE SET
            brand_id = EXCLUDED.brand_id,
            display_name = EXCLUDED.display_name,
            mount_code = EXCLUDED.mount_code,
            coverage_format = EXCLUDED.coverage_format,
            lens_category = EXCLUDED.lens_category,
            focal_length_min_mm = EXCLUDED.focal_length_min_mm,
            focal_length_max_mm = EXCLUDED.focal_length_max_mm,
            max_aperture_wide_f = EXCLUDED.max_aperture_wide_f,
            max_aperture_tele_f = EXCLUDED.max_aperture_tele_f,
            has_is = EXCLUDED.has_is,
            release_year = EXCLUDED.release_year,
            announce_date = EXCLUDED.announce_date
          RETURNING lens_id
          `,
          [
            m.slug,
            brandId,
            m.display_name,
            m.mount_code,
            m.coverage_format,
            m.lens_category,
            m.focal_length_min_mm,
            m.focal_length_max_mm,
            m.max_aperture_wide_f,
            m.max_aperture_tele_f,
            m.has_is,
            m.release_year,
          ],
        );

        const lensId = lensRes.rows[0].lens_id;
        const sourceUrl = `seed:${seedId}#lens_model/${m.slug}`;
        const notes = `Seeded from ${seedId}`;

        await upsertEvidence(client, {
          entityType: "lens_model",
          entityId: lensId,
          claimPath: "mount_code",
          sourceUrl,
          retrievedAt,
          value: m.mount_code,
          notes,
        });
        await upsertEvidence(client, {
          entityType: "lens_model",
          entityId: lensId,
          claimPath: "coverage_format",
          sourceUrl,
          retrievedAt,
          value: m.coverage_format,
          notes,
        });
        await upsertEvidence(client, {
          entityType: "lens_model",
          entityId: lensId,
          claimPath: "focal_length_min_mm",
          sourceUrl,
          retrievedAt,
          value: m.focal_length_min_mm,
          notes,
        });
        await upsertEvidence(client, {
          entityType: "lens_model",
          entityId: lensId,
          claimPath: "focal_length_max_mm",
          sourceUrl,
          retrievedAt,
          value: m.focal_length_max_mm,
          notes,
        });
        await upsertEvidence(client, {
          entityType: "lens_model",
          entityId: lensId,
          claimPath: "max_aperture_wide_f",
          sourceUrl,
          retrievedAt,
          value: m.max_aperture_wide_f,
          notes,
        });
        await upsertEvidence(client, {
          entityType: "lens_model",
          entityId: lensId,
          claimPath: "max_aperture_tele_f",
          sourceUrl,
          retrievedAt,
          value: m.max_aperture_tele_f,
          notes,
        });
        await upsertEvidence(client, {
          entityType: "lens_model",
          entityId: lensId,
          claimPath: "has_is",
          sourceUrl,
          retrievedAt,
          value: m.has_is,
          notes,
        });
        if (m.release_year !== null) {
          await upsertEvidence(client, {
            entityType: "lens_model",
            entityId: lensId,
            claimPath: "release_year",
            sourceUrl,
            retrievedAt,
            value: m.release_year,
            notes,
          });
        }
      }
    }

    await client.query("COMMIT");

    console.log("Seeded catalog OK:");
    console.log("- seed files:", seeds.length);
    for (const { seedPath, seed } of seeds) {
      const rel = path.relative(process.cwd(), seedPath).replaceAll("\\", "/");
      console.log(`  - ${seed.seed_id} (${seed.seed_date}) -> ${rel}`);
      console.log(`    - brands: ${seed.brands.length}`);
      console.log(`    - camera_models: ${seed.camera_models.length}`);
      console.log(`    - lens_models: ${seed.lens_models.length}`);
    }
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
