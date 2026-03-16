import pg from "pg";

import { buildCameraMatcher, buildLensMatcher } from "../matching/title_match.js";

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

function round2(n) {
  return Math.round(n * 100) / 100;
}

function normalizeExtractedAttributes(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function upsertAttr(attrs, attr) {
  const key = attr.key;
  const next = attrs.filter((a) => a && a.key !== key);
  next.push(attr);
  return next;
}

function attrString({ key, value, confidence, evidenceText = null }) {
  const out = { key, type: "string", confidence };
  if (evidenceText !== null) out.evidence_text = evidenceText;
  out.value_string = String(value);
  return out;
}

function attrEnum({ key, value, confidence, evidenceText = null }) {
  const out = { key, type: "enum", confidence };
  if (evidenceText !== null) out.evidence_text = evidenceText;
  out.value_enum = String(value);
  return out;
}

function isUnambiguous(top, delta = 0.05) {
  if (!top || top.length === 0) return false;
  if (top.length === 1) return true;
  return top[0].confidence - top[1].confidence >= delta;
}

function chooseStatus({ bestConfidence, bestUnambiguous, highThreshold, reviewThreshold }) {
  if (bestConfidence >= highThreshold && bestUnambiguous) return "matched";
  if (bestConfidence >= reviewThreshold) return "needs_review";
  return "unmatched";
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("Missing DATABASE_URL.");
    process.exitCode = 2;
    return;
  }

  const limit = envNumber("FF_MATCH_LIMIT", 500);
  const dryRun = envBool("FF_MATCH_DRY_RUN", false);
  const highThreshold = envNumber("FF_MATCH_HIGH_THRESHOLD", 0.95);
  const reviewThreshold = envNumber("FF_MATCH_REVIEW_THRESHOLD", 0.6);

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const brandsRes = await client.query(`SELECT slug, name FROM brands ORDER BY name ASC`);

    const camerasRes = await client.query(
      `
      SELECT
        cm.camera_id,
        cm.slug,
        cm.display_name,
        cm.aliases,
        b.slug AS brand_slug,
        b.name AS brand_name
      FROM camera_models cm
      JOIN brands b ON b.brand_id = cm.brand_id
      `,
    );

    const lensesRes = await client.query(
      `
      SELECT
        lm.lens_id,
        lm.slug,
        lm.display_name,
        lm.focal_length_min_mm,
        lm.focal_length_max_mm,
        lm.max_aperture_wide_f::float8 AS max_aperture_wide_f,
        lm.max_aperture_tele_f::float8 AS max_aperture_tele_f,
        b.slug AS brand_slug,
        b.name AS brand_name
      FROM lens_models lm
      JOIN brands b ON b.brand_id = lm.brand_id
      `,
    );

    const cameraMatcher = buildCameraMatcher(camerasRes.rows);
    const lensMatcher = buildLensMatcher(lensesRes.rows, brandsRes.rows);

    const listingsRes = await client.query(
      `
      SELECT
        listing_id,
        title,
        match_status,
        match_confidence::float8 AS match_confidence,
        match_method,
        camera_id,
        lens_id,
        extracted_attributes
      FROM listings
      WHERE match_status <> 'verified'
      ORDER BY last_seen_at DESC
      LIMIT $1
      `,
      [limit],
    );

    let updated = 0;
    let wouldUpdate = 0;
    let needsReview = 0;

    if (!dryRun) await client.query("BEGIN");

    for (const row of listingsRes.rows) {
      const title = row.title;
      const camera = cameraMatcher.match(title);
      const lens = lensMatcher.match(title);

      const cameraBest = camera.best;
      const lensBest = lens.best;

      const cameraTop = camera.top || [];
      const lensTop = lens.top || [];

      const cameraUnambiguous = isUnambiguous(cameraTop);
      const lensUnambiguous = isUnambiguous(lensTop);

      const best = (() => {
        if (cameraBest && lensBest) return cameraBest.confidence >= lensBest.confidence ? cameraBest : lensBest;
        return cameraBest || lensBest || null;
      })();

      const bestConfidence = best ? best.confidence : 0;
      const bestType = best ? (best.entity_type === "camera_model" ? "camera" : "lens") : "none";
      const bestUnambiguous = bestType === "camera" ? cameraUnambiguous : bestType === "lens" ? lensUnambiguous : false;

      const nextStatus = chooseStatus({ bestConfidence, bestUnambiguous, highThreshold, reviewThreshold });
      if (nextStatus === "needs_review") needsReview += 1;

      const nextConfidence = nextStatus === "unmatched" ? 0 : round2(bestConfidence);
      const nextMethod = nextStatus === "unmatched" ? null : best?.method || "auto_match_v0";

      let nextCameraId = null;
      let nextLensId = null;

      if (nextStatus === "matched") {
        if (cameraBest && cameraBest.confidence >= highThreshold && cameraUnambiguous) nextCameraId = cameraBest.entity_id;
        if (lensBest && lensBest.confidence >= highThreshold && lensUnambiguous) nextLensId = lensBest.entity_id;
      }

      let nextAttrs = normalizeExtractedAttributes(row.extracted_attributes);

      if (nextStatus === "needs_review") {
        nextAttrs = upsertAttr(
          nextAttrs,
          attrEnum({ key: "suggested_match_kind", value: bestType, confidence: round2(bestConfidence), evidenceText: "auto_match_v0" }),
        );

        for (let i = 0; i < Math.min(3, cameraTop.length); i += 1) {
          nextAttrs = upsertAttr(
            nextAttrs,
            attrString({
              key: `suggested_camera_slug_${i + 1}`,
              value: cameraTop[i].slug,
              confidence: round2(cameraTop[i].confidence),
              evidenceText: cameraTop[i].method,
            }),
          );
        }

        for (let i = 0; i < Math.min(3, lensTop.length); i += 1) {
          nextAttrs = upsertAttr(
            nextAttrs,
            attrString({
              key: `suggested_lens_slug_${i + 1}`,
              value: lensTop[i].slug,
              confidence: round2(lensTop[i].confidence),
              evidenceText: lensTop[i].method,
            }),
          );
        }
      }

      const changed =
        String(row.match_status) !== nextStatus ||
        Number(row.match_confidence) !== nextConfidence ||
        (row.match_method || null) !== nextMethod ||
        (row.camera_id || null) !== nextCameraId ||
        (row.lens_id || null) !== nextLensId;

      if (!changed) continue;

      wouldUpdate += 1;
      if (dryRun) continue;

      await client.query(
        `
        UPDATE listings
        SET
          camera_id = $2,
          lens_id = $3,
          match_status = $4,
          match_confidence = $5,
          match_method = $6,
          extracted_attributes = $7::jsonb
        WHERE listing_id = $1
        `,
        [row.listing_id, nextCameraId, nextLensId, nextStatus, nextConfidence, nextMethod, JSON.stringify(nextAttrs)],
      );
      updated += 1;
    }

    if (!dryRun) await client.query("COMMIT");

    console.log("Matched listings OK:");
    console.log("- listings_considered:", listingsRes.rows.length);
    console.log("- would_update:", wouldUpdate);
    console.log("- updated:", updated);
    console.log("- needs_review:", needsReview);
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

