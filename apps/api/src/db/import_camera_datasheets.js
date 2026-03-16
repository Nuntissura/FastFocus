import fs from "node:fs/promises";
import path from "node:path";

import pg from "pg";
import { parse as parseYaml } from "yaml";

import { resolveGovRoot } from "../paths.js";

const { Client } = pg;

function parseArgs(argv) {
  const result = {
    brandSlug: null,
    confirm: false,
    help: false,
    limit: null,
    reportOut: null,
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
      result.brandSlug = value.trim();
      i++;
      continue;
    }
    if (arg === "--limit") {
      const value = argv[i + 1];
      if (!value) throw new Error("--limit requires a value");
      const n = Number.parseInt(value, 10);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid --limit: ${value}`);
      result.limit = n;
      i++;
      continue;
    }
    if (arg === "--report-out") {
      const value = argv[i + 1];
      if (!value) throw new Error("--report-out requires a value");
      result.reportOut = value.trim();
      i++;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return result;
}

function printUsage() {
  // eslint-disable-next-line no-console
  console.log(
    [
      "Import camera datasheets (digital_camera_datasheet.v5; v4/v3 legacy) into Postgres camera_models.",
      "",
      "Usage:",
      "  node apps/api/src/db/import_camera_datasheets.js [--brand-slug canon] [--limit 50] [--confirm] [--report-out path.tsv]",
      "",
      "Notes:",
      "- Default is dry-run (no DB writes).",
      "- Pass --confirm to upsert camera models and evidence rows.",
      "- Reads datasheets from `FF - gov/catalog/data_sheets/` via workspace path resolution.",
      "- Skips datasheets that do not meet template `requirements.must_have` (and fixed-lens requirements when applicable).",
      "- When --brand-slug is provided, a readiness TSV is written to the brand model-lists folder by default.",
    ].join("\n"),
  );
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function getPath(obj, dotPath) {
  const parts = dotPath.split(".");
  let cur = obj;
  for (const part of parts) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = cur[part];
  }
  return cur;
}

function setFromPathMap({ datasheet, mapping }) {
  const result = {};
  for (const [targetKey, sourcePath] of Object.entries(mapping)) {
    result[targetKey] = getPath(datasheet, sourcePath);
  }
  return result;
}

function uniqueStrings(values) {
  const out = [];
  const seen = new Set();
  for (const v of values) {
    if (!isNonEmptyString(v)) continue;
    const s = v.trim();
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function normalizeRetrievedAt(raw) {
  if (!isNonEmptyString(raw)) return null;
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00.000Z`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function assertImportReady(datasheet) {
  if (!datasheet || typeof datasheet !== "object") return { ok: false, reasons: ["datasheet is not an object"] };
  if (datasheet.kind !== "camera_datasheet") return { ok: false, reasons: ["kind is not camera_datasheet"] };
  if (datasheet.capture_medium !== "digital") return { ok: false, reasons: ["capture_medium is not digital"] };
  if (datasheet.schema_version !== "2.0") return { ok: false, reasons: ["schema_version is not 2.0"] };
  if (!isNonEmptyString(datasheet.template_id)) return { ok: false, reasons: ["template_id is missing"] };

  const mustHave = datasheet.requirements?.must_have;
  if (!Array.isArray(mustHave) || mustHave.length === 0) return { ok: false, reasons: ["requirements.must_have missing"] };

  const missing = [];
  for (const dotPath of mustHave) {
    const value = getPath(datasheet, dotPath);
    if (value === null || value === undefined || value === "") missing.push(dotPath);
  }

  const lensSystemType = datasheet.classification?.lens_system_type;
  if (lensSystemType === "interchangeable") {
    const interchangeReqRaw = datasheet.requirements?.must_have_if_interchangeable;
    const interchangeReq =
      Array.isArray(interchangeReqRaw) && interchangeReqRaw.length > 0 ? interchangeReqRaw : ["classification.mount_code"];
    for (const dotPath of interchangeReq) {
      const value = getPath(datasheet, dotPath);
      if (value === null || value === undefined || value === "") missing.push(dotPath);
    }
  }
  if (lensSystemType === "fixed") {
    const fixedReq = datasheet.requirements?.must_have_if_fixed_lens;
    if (!Array.isArray(fixedReq) || fixedReq.length === 0) missing.push("requirements.must_have_if_fixed_lens");
    else {
      for (const dotPath of fixedReq) {
        const value = getPath(datasheet, dotPath);
        if (value === null || value === undefined || value === "") missing.push(dotPath);
      }
    }
  }

  if (missing.length > 0) return { ok: false, reasons: missing.map((p) => `missing ${p}`) };
  return { ok: true, reasons: [] };
}

function buildAliases(datasheet) {
  const displayName = datasheet.identifiers?.display_name;
  const modelName = datasheet.identifiers?.model_name;
  const explicitAliases = Array.isArray(datasheet.identifiers?.aliases) ? datasheet.identifiers.aliases : [];
  const regionVariants = Array.isArray(datasheet.identifiers?.region_variants) ? datasheet.identifiers.region_variants : [];
  const variantNames = regionVariants.map((v) => v?.marketing_name).filter(isNonEmptyString);

  const derived = [];
  if (isNonEmptyString(displayName) && displayName.toLowerCase().startsWith("canon ")) {
    derived.push(displayName.slice("canon ".length));
  }

  return uniqueStrings([modelName, ...explicitAliases, ...variantNames, ...derived]);
}

function deriveVideoMax(specs) {
  const maxInternal = specs?.video?.max_internal;
  if (!maxInternal || typeof maxInternal !== "object") return null;
  const resolution = maxInternal.resolution;
  const fps = maxInternal.frame_rate_fps;
  if (!isNonEmptyString(resolution)) return null;
  if (fps === null || fps === undefined) return resolution.trim();
  if (typeof fps !== "number" || !Number.isFinite(fps)) return resolution.trim();
  return `${resolution.trim()}@${fps}`;
}

function deriveStorageMedia(specs) {
  const slot1 = specs?.storage?.slot_1_type;
  const slot2 = specs?.storage?.slot_2_type;
  return uniqueStrings([slot1, slot2]);
}

function deriveBodyDims(specs) {
  const dims = specs?.body?.dimensions_mm;
  if (!dims || typeof dims !== "object") return { w: null, h: null, d: null };
  const w = dims.w ?? null;
  const h = dims.h ?? null;
  const d = dims.d ?? null;
  return {
    w: typeof w === "number" && Number.isFinite(w) ? Math.round(w) : null,
    h: typeof h === "number" && Number.isFinite(h) ? Math.round(h) : null,
    d: typeof d === "number" && Number.isFinite(d) ? Math.round(d) : null,
  };
}

function mappedClaimPath(datasheetPath) {
  const map = new Map([
    ["release.release_year", "release_year"],
    ["release.announce_date", "announce_date"],
    ["classification.mount_code", "mount_code"],
    ["classification.camera_category", "camera_category"],
    ["classification.lens_system_type", "lens_system_type"],
    ["classification.fixed_lens.focal_length_basis", "fixed_focal_length_basis"],
    ["classification.fixed_lens.focal_length_min_mm", "fixed_focal_length_min_mm"],
    ["classification.fixed_lens.focal_length_max_mm", "fixed_focal_length_max_mm"],
    ["classification.fixed_lens.max_aperture_wide_f", "fixed_max_aperture_wide_f"],
    ["classification.fixed_lens.max_aperture_tele_f", "fixed_max_aperture_tele_f"],
    ["specs.sensor.sensor_format", "sensor_format"],
    ["specs.sensor.sensor_type", "sensor_type"],
    ["specs.sensor.effective_resolution_mp", "resolution_mp"],
    ["specs.stabilization.ibis", "ibis"],
  ]);
  return map.get(datasheetPath) || datasheetPath;
}

const SOURCE_EVIDENCE_SOURCE_TYPES = new Set(["manufacturer", "wikidata", "wikipedia", "retailer", "marketplace", "manual", "other"]);

function inferEvidenceSourceTypeFromUrl(sourceUrl) {
  if (!isNonEmptyString(sourceUrl)) return null;
  const u = sourceUrl.trim().toLowerCase();
  if (u.includes("wikipedia.org")) return "wikipedia";
  if (u.includes("wikidata.org")) return "wikidata";
  return null;
}

function normalizeEvidenceSourceType(rawSourceType, sourceUrl) {
  const st = isNonEmptyString(rawSourceType) ? rawSourceType.trim().toLowerCase() : "";
  if (SOURCE_EVIDENCE_SOURCE_TYPES.has(st)) return st;

  if (st === "reference") {
    return inferEvidenceSourceTypeFromUrl(sourceUrl) || "other";
  }

  return inferEvidenceSourceTypeFromUrl(sourceUrl) || "other";
}

async function upsertEvidence(client, { entityId, claimPath, source, retrievedAt, value, notes }) {
  const sourceUrl = source?.source_url;
  if (!isNonEmptyString(sourceUrl)) return;
  if (sourceUrl.trim().toLowerCase().startsWith("seed://")) return;

  const sourceType = normalizeEvidenceSourceType(source?.source_type, sourceUrl);
  const license = isNonEmptyString(source?.license) ? source.license : "link_only";
  const confidenceRaw = source?.confidence;
  const confidence =
    typeof confidenceRaw === "number" && Number.isFinite(confidenceRaw) && confidenceRaw >= 0 && confidenceRaw <= 1 ? confidenceRaw : 0.5;
  const valueJson = JSON.stringify(value);
  const retrieved = normalizeRetrievedAt(retrievedAt) || new Date().toISOString();

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
    VALUES ('camera_model', $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
    ON CONFLICT (entity_type, entity_id, claim_path, source_url) DO UPDATE SET
      retrieved_at = EXCLUDED.retrieved_at,
      license = EXCLUDED.license,
      confidence = EXCLUDED.confidence,
      value_json = EXCLUDED.value_json,
      notes = EXCLUDED.notes
    `,
    [entityId, claimPath, sourceType, sourceUrl, retrieved, license, confidence, valueJson, notes],
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const connectionString = process.env.DATABASE_URL || null;

  const govRoot = resolveGovRoot();
  const sheetsRoot = path.resolve(govRoot, "catalog", "data_sheets");
  const defaultReportOut = args.brandSlug
    ? path.resolve(sheetsRoot, args.brandSlug, "model-lists", `${args.brandSlug}_datasheet_import_readiness.tsv`)
    : null;
  const reportOutPath = args.reportOut ? path.resolve(args.reportOut) : defaultReportOut;

  const brandDirs = [];
  if (args.brandSlug) {
    brandDirs.push({ brandSlug: args.brandSlug, dirPath: path.resolve(sheetsRoot, args.brandSlug) });
  } else {
    const entries = await fs.readdir(sheetsRoot, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (ent.name.startsWith(".")) continue;
      brandDirs.push({ brandSlug: ent.name, dirPath: path.resolve(sheetsRoot, ent.name) });
    }
  }

  const datasheets = [];

  for (const b of brandDirs) {
    let entries;
    try {
      entries = await fs.readdir(b.dirPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (ent.name === "model-lists") continue;
      if (ent.name.startsWith(".")) continue;

      const datasheetPath = path.resolve(b.dirPath, ent.name, "datasheet.yaml");
      try {
        const raw = await fs.readFile(datasheetPath, "utf-8");
        const parsed = parseYaml(raw);
        datasheets.push({ datasheetPath, datasheet: parsed });
      } catch (err) {
        datasheets.push({ datasheetPath, datasheet: null, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  const limited = typeof args.limit === "number" ? datasheets.slice(0, args.limit) : datasheets;

  const errors = [];
  const skipped = [];
  const ready = [];
  const reportRows = [];

  for (const item of limited) {
    if (item.error) {
      errors.push({ datasheetPath: item.datasheetPath, reason: item.error });
      reportRows.push({
        datasheetPath: item.datasheetPath,
        status: "error",
        slug: null,
        displayName: null,
        lensSystemType: null,
        reasons: [item.error],
      });
      continue;
    }
    const check = assertImportReady(item.datasheet);
    if (!check.ok) {
      skipped.push({ datasheetPath: item.datasheetPath, reasons: check.reasons });
      reportRows.push({
        datasheetPath: item.datasheetPath,
        status: "skipped",
        slug: item.datasheet?.identifiers?.slug ?? null,
        displayName: item.datasheet?.identifiers?.display_name ?? null,
        lensSystemType: item.datasheet?.classification?.lens_system_type ?? null,
        reasons: check.reasons,
      });
      continue;
    }
    ready.push(item);
    reportRows.push({
      datasheetPath: item.datasheetPath,
      status: "ready",
      slug: item.datasheet?.identifiers?.slug ?? null,
      displayName: item.datasheet?.identifiers?.display_name ?? null,
      lensSystemType: item.datasheet?.classification?.lens_system_type ?? null,
      reasons: [],
    });
  }

  // eslint-disable-next-line no-console
  console.log("Datasheets scanned:", limited.length);
  // eslint-disable-next-line no-console
  console.log("- ready:", ready.length);
  // eslint-disable-next-line no-console
  console.log("- skipped (missing requirements):", skipped.length);
  // eslint-disable-next-line no-console
  console.log("- parse/errors:", errors.length);

  if (reportOutPath) {
    const header = ["status", "slug", "lens_system_type", "display_name", "datasheet_path", "reasons"].join("\t");
    const lines = [header];
    for (const row of reportRows.sort((a, b) => String(a.slug || "").localeCompare(String(b.slug || "")))) {
      const rel = path.relative(govRoot, row.datasheetPath).replaceAll("\\", "/");
      lines.push(
        [
          row.status,
          row.slug || "",
          row.lensSystemType || "",
          row.displayName || "",
          rel,
          (row.reasons || []).join(" | "),
        ].join("\t"),
      );
    }
    lines.push("");

    await fs.mkdir(path.dirname(reportOutPath), { recursive: true });
    await fs.writeFile(reportOutPath, lines.join("\n"), "utf-8");
    // eslint-disable-next-line no-console
    console.log("- readiness report:", path.relative(process.cwd(), reportOutPath).replaceAll("\\", "/"));
  }

  if (errors.length > 0) {
    // eslint-disable-next-line no-console
    console.log("\nErrors (first 10):");
    for (const e of errors.slice(0, 10)) {
      // eslint-disable-next-line no-console
      console.log("-", path.relative(process.cwd(), e.datasheetPath).replaceAll("\\", "/"), "->", e.reason);
    }
  }

  if (!args.confirm) {
    // eslint-disable-next-line no-console
    console.log("\nDry run complete (no DB writes). Re-run with --confirm to import.");
    return;
  }

  if (!connectionString) {
    // eslint-disable-next-line no-console
    console.error("Missing DATABASE_URL.");
    printUsage();
    process.exitCode = 2;
    return;
  }

  if (ready.length === 0) {
    // eslint-disable-next-line no-console
    console.log("\nNo import-ready datasheets.");
    return;
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");

    const brandIdBySlug = new Map();

    for (const item of ready) {
      const ds = item.datasheet;
      const brandSlug = ds.identifiers?.brand_slug;
      const brandName = ds.identifiers?.brand_name;
      if (!isNonEmptyString(brandSlug) || !isNonEmptyString(brandName)) {
        throw new Error(`Invalid identifiers.brand_* in ${item.datasheetPath}`);
      }

      if (!brandIdBySlug.has(brandSlug)) {
        await client.query(
          `
          INSERT INTO brands (slug, name)
          VALUES ($1, $2)
          ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
          `,
          [brandSlug, brandName],
        );

        const brandRes = await client.query(`SELECT brand_id FROM brands WHERE slug = $1 LIMIT 1`, [brandSlug]);
        const brandId = brandRes.rows[0]?.brand_id || null;
        if (!brandId) throw new Error(`Failed to resolve brand_id for ${brandSlug}`);
        brandIdBySlug.set(brandSlug, brandId);
      }

      const camera = setFromPathMap({
        datasheet: ds,
        mapping: {
          slug: "identifiers.slug",
          display_name: "identifiers.display_name",
          capture_medium: "capture_medium",
          camera_category: "classification.camera_category",
          lens_system_type: "classification.lens_system_type",
          mount_code: "classification.mount_code",
          announce_date: "release.announce_date",
          release_year: "release.release_year",
          sensor_format: "specs.sensor.sensor_format",
          sensor_type: "specs.sensor.sensor_type",
          resolution_mp: "specs.sensor.effective_resolution_mp",
          ibis: "specs.stabilization.ibis",
        },
      });

      const releaseProd = ds.release?.production || {};
      const productionStartYear = releaseProd.start_year ?? null;
      const productionEndYear = releaseProd.end_year ?? null;
      const isDiscontinued = typeof releaseProd.is_discontinued === "boolean" ? releaseProd.is_discontinued : false;
      const productionConfidence =
        typeof releaseProd.confidence === "number" && Number.isFinite(releaseProd.confidence) ? releaseProd.confidence : 0.5;

      const aliases = buildAliases(ds);
      const videoMax = deriveVideoMax(ds.specs);
      const storageMedia = deriveStorageMedia(ds.specs);
      const batteryModel = ds.specs?.power?.battery_model ?? null;
      const weightG = ds.specs?.body?.weight_with_battery_g ?? null;
      const weatherSealed = ds.specs?.body?.weather_sealed ?? null;
      const dims = deriveBodyDims(ds.specs);

      const lensSystemType = camera.lens_system_type;
      const fixed = ds.classification?.fixed_lens || {};
      const fixedFocalLengthBasis = fixed.focal_length_basis ?? null;
      const fixedFocalLengthMinMm = fixed.focal_length_min_mm ?? null;
      const fixedFocalLengthMaxMm = fixed.focal_length_max_mm ?? null;
      const fixedMaxApertureWideF = fixed.max_aperture_wide_f ?? null;
      const fixedMaxApertureTeleF = fixed.max_aperture_tele_f ?? null;

      const msrpBody = ds.release?.launch_msrp?.body_only || null;
      const msrpKit = ds.release?.launch_msrp?.with_kit_lens || null;
      const msrp = msrpBody?.amount !== null && msrpBody?.amount !== undefined ? msrpBody : msrpKit;
      const msrpAmount = msrp?.amount ?? null;
      const msrpCurrency = msrpAmount !== null ? msrp?.currency ?? null : null;

      const links = ds.links && typeof ds.links === "object" ? ds.links : {};
      const digitalSpecs = ds.specs && typeof ds.specs === "object" ? ds.specs : null;

      const brandId = brandIdBySlug.get(brandSlug);
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
          fixed_focal_length_basis,
          fixed_focal_length_min_mm,
          fixed_focal_length_max_mm,
          fixed_max_aperture_wide_f,
          fixed_max_aperture_tele_f,
          announce_date,
          release_year,
          msrp_amount,
          msrp_currency,
          production_start_year,
          production_end_year,
          is_discontinued,
          production_confidence,
          weight_g,
          weather_sealed,
          dimensions_w_mm,
          dimensions_h_mm,
          dimensions_d_mm,
          sensor_format,
          sensor_type,
          resolution_mp,
          ibis,
          video_max,
          storage_media,
          battery_model,
          digital_specs,
          aliases,
          links
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,
          $8,$9,$10,$11,$12,
          $13,$14,$15,$16,
          $17,$18,$19,$20,
          $21,$22,$23,$24,
          $25,$26,$27,$28,
          $29,$30,$31,$32,
          $33::jsonb,
          $34::text[],
          $35::jsonb
        )
        ON CONFLICT (slug) DO UPDATE SET
          brand_id = EXCLUDED.brand_id,
          display_name = EXCLUDED.display_name,
          capture_medium = EXCLUDED.capture_medium,
          camera_category = EXCLUDED.camera_category,
          lens_system_type = EXCLUDED.lens_system_type,
          mount_code = EXCLUDED.mount_code,
          fixed_focal_length_basis = EXCLUDED.fixed_focal_length_basis,
          fixed_focal_length_min_mm = EXCLUDED.fixed_focal_length_min_mm,
          fixed_focal_length_max_mm = EXCLUDED.fixed_focal_length_max_mm,
          fixed_max_aperture_wide_f = EXCLUDED.fixed_max_aperture_wide_f,
          fixed_max_aperture_tele_f = EXCLUDED.fixed_max_aperture_tele_f,
          announce_date = EXCLUDED.announce_date,
          release_year = EXCLUDED.release_year,
          msrp_amount = EXCLUDED.msrp_amount,
          msrp_currency = EXCLUDED.msrp_currency,
          production_start_year = EXCLUDED.production_start_year,
          production_end_year = EXCLUDED.production_end_year,
          is_discontinued = COALESCE(EXCLUDED.is_discontinued, camera_models.is_discontinued),
          production_confidence = EXCLUDED.production_confidence,
          weight_g = EXCLUDED.weight_g,
          weather_sealed = EXCLUDED.weather_sealed,
          dimensions_w_mm = EXCLUDED.dimensions_w_mm,
          dimensions_h_mm = EXCLUDED.dimensions_h_mm,
          dimensions_d_mm = EXCLUDED.dimensions_d_mm,
          sensor_format = EXCLUDED.sensor_format,
          sensor_type = EXCLUDED.sensor_type,
          resolution_mp = EXCLUDED.resolution_mp,
          ibis = EXCLUDED.ibis,
          video_max = EXCLUDED.video_max,
          storage_media = EXCLUDED.storage_media,
          battery_model = EXCLUDED.battery_model,
          digital_specs = EXCLUDED.digital_specs,
          aliases = EXCLUDED.aliases,
          links = EXCLUDED.links
        RETURNING camera_id
        `,
        [
          camera.slug,
          brandId,
          camera.display_name,
          camera.capture_medium,
          camera.camera_category,
          lensSystemType,
          camera.mount_code,
          lensSystemType === "fixed" ? fixedFocalLengthBasis : null,
          lensSystemType === "fixed" ? fixedFocalLengthMinMm : null,
          lensSystemType === "fixed" ? fixedFocalLengthMaxMm : null,
          lensSystemType === "fixed" ? fixedMaxApertureWideF : null,
          lensSystemType === "fixed" ? fixedMaxApertureTeleF : null,
          camera.announce_date,
          camera.release_year,
          msrpAmount,
          msrpCurrency,
          productionStartYear,
          productionEndYear,
          isDiscontinued,
          productionConfidence,
          weightG,
          weatherSealed,
          dims.w,
          dims.h,
          dims.d,
          camera.sensor_format,
          camera.sensor_type,
          camera.resolution_mp,
          camera.ibis,
          videoMax,
          storageMedia.length > 0 ? storageMedia : null,
          batteryModel,
          digitalSpecs ? JSON.stringify(digitalSpecs) : null,
          aliases,
          JSON.stringify(links),
        ],
      );

      const cameraId = cameraRes.rows[0]?.camera_id || null;
      if (!cameraId) throw new Error(`Failed to upsert camera_model ${camera.slug}`);

      const provenanceSources = Array.isArray(ds.provenance?.sources) ? ds.provenance.sources : [];
      const sourcesById = new Map(provenanceSources.map((s) => [s.source_id, s]));
      const fieldSources = ds.provenance?.field_sources && typeof ds.provenance.field_sources === "object" ? ds.provenance.field_sources : {};

      for (const [datasheetPath, meta] of Object.entries(fieldSources)) {
        const value = getPath(ds, datasheetPath);
        if (value === null || value === undefined) continue;

        const claimPath = mappedClaimPath(datasheetPath);
        const sourceIds = Array.isArray(meta?.source_ids) ? meta.source_ids : [];
        for (const sourceId of sourceIds) {
          const source = sourcesById.get(sourceId);
          if (!source) continue;
          const notes = `datasheet_import (${ds.template_id}); review_state=${meta?.review_state ?? "unknown"}`;
          // eslint-disable-next-line no-await-in-loop
          await upsertEvidence(client, { entityId: cameraId, claimPath, source, retrievedAt: source.retrieved_at, value, notes });
        }
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }

  // eslint-disable-next-line no-console
  console.log("Import complete.");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
