function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isSlug(value) {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+){0,127}$/.test(value);
}

function clampNumber(value, { min, max, fallback }) {
  if (value === null || value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function parseReviewQueueFilters(url) {
  const status = url.searchParams.get("status");
  const maxConfidence = url.searchParams.get("max_confidence");
  const marketplace = url.searchParams.get("marketplace");

  return {
    status:
      status && ["unmatched", "matched", "needs_review", "verified"].includes(status) ? status : "needs_review",
    maxConfidence: clampNumber(maxConfidence, { min: 0, max: 1, fallback: null }),
    marketplace: marketplace && /^[a-z0-9_]{2,32}$/.test(marketplace) ? marketplace : null,
  };
}

export async function listReviewQueue(pool, { limit, offset, filters }) {
  const where = [];
  const params = [];

  const pushParam = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  where.push(`l.match_status = ${pushParam(filters.status)}`);
  if (filters.maxConfidence !== null) where.push(`l.match_confidence <= ${pushParam(filters.maxConfidence)}`);
  if (filters.marketplace) where.push(`l.marketplace_code = ${pushParam(filters.marketplace)}`);

  params.push(limit);
  const limitParam = `$${params.length}`;
  params.push(offset);
  const offsetParam = `$${params.length}`;

  const whereSql = `WHERE ${where.join(" AND ")}`;

  const res = await pool.query(
    `
    SELECT
      l.listing_id,
      l.marketplace_code,
      l.source_item_id,
      l.url,
      l.title,
      l.match_status,
      l.match_confidence::float8 AS match_confidence,
      l.match_method,
      l.camera_id,
      cm.slug AS camera_slug,
      l.lens_id,
      lm.slug AS lens_slug,
      l.price_amount::float8 AS price_amount,
      l.price_currency,
      l.seller_id,
      l.last_seen_at,
      l.extracted_attributes,
      l.created_at,
      l.updated_at
    FROM listings l
    LEFT JOIN camera_models cm ON cm.camera_id = l.camera_id
    LEFT JOIN lens_models lm ON lm.lens_id = l.lens_id
    ${whereSql}
    ORDER BY l.last_seen_at DESC
    LIMIT ${limitParam} OFFSET ${offsetParam}
    `,
    params,
  );

  return res.rows;
}

export async function listDedupeEdges(pool, { limit, offset }) {
  const res = await pool.query(
    `
    SELECT
      e.edge_id,
      e.canonical_listing_id,
      e.duplicate_listing_id,
      e.method,
      e.confidence::float8 AS confidence,
      e.reason,
      e.created_at,
      cl.marketplace_code AS canonical_marketplace,
      cl.source_item_id AS canonical_source_item_id,
      cl.title AS canonical_title,
      dl.marketplace_code AS duplicate_marketplace,
      dl.source_item_id AS duplicate_source_item_id,
      dl.title AS duplicate_title
    FROM listing_dedupe_edges e
    JOIN listings cl ON cl.listing_id = e.canonical_listing_id
    JOIN listings dl ON dl.listing_id = e.duplicate_listing_id
    ORDER BY e.created_at DESC
    LIMIT $1 OFFSET $2
    `,
    [limit, offset],
  );
  return res.rows;
}

export async function applyListingMatchOverride(pool, { listingId, cameraSlug, lensSlug, actorId, reason, dryRun }) {
  if (!isUuid(listingId)) return { ok: false, error: "invalid_listing_id" };
  if (cameraSlug !== null && !isSlug(cameraSlug)) return { ok: false, error: "invalid_camera_slug" };
  if (lensSlug !== null && !isSlug(lensSlug)) return { ok: false, error: "invalid_lens_slug" };
  if (!actorId || typeof actorId !== "string" || actorId.trim().length > 64) return { ok: false, error: "invalid_actor_id" };
  if (reason !== null && reason !== undefined && (typeof reason !== "string" || reason.length > 256))
    return { ok: false, error: "invalid_reason" };
  if (dryRun !== undefined && typeof dryRun !== "boolean") return { ok: false, error: "invalid_dry_run" };

  const isDryRun = dryRun !== false;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const beforeRes = await client.query(
      `
      SELECT listing_id, camera_id, lens_id, match_status, match_confidence::float8 AS match_confidence, match_method
      FROM listings
      WHERE listing_id = $1
      LIMIT 1
      `,
      [listingId],
    );
    const before = beforeRes.rows[0];
    if (!before) {
      await client.query("ROLLBACK");
      return { ok: false, error: "not_found" };
    }

    let nextCameraId = null;
    let nextLensId = null;
    let nextStatus = "unmatched";
    let nextConfidence = 0.0;
    let nextMethod = "manual_clear";

    if (cameraSlug || lensSlug) {
      nextStatus = "verified";
      nextConfidence = 1.0;
      nextMethod = "manual_override";

      if (cameraSlug) {
        const camRes = await client.query(`SELECT camera_id FROM camera_models WHERE slug = $1 LIMIT 1`, [cameraSlug]);
        const cam = camRes.rows[0];
        if (!cam) {
          await client.query("ROLLBACK");
          return { ok: false, error: "camera_not_found" };
        }
        nextCameraId = cam.camera_id;
      }

      if (lensSlug) {
        const lensRes = await client.query(`SELECT lens_id FROM lens_models WHERE slug = $1 LIMIT 1`, [lensSlug]);
        const lens = lensRes.rows[0];
        if (!lens) {
          await client.query("ROLLBACK");
          return { ok: false, error: "lens_not_found" };
        }
        nextLensId = lens.lens_id;
      }
    }

    const afterPreview = {
      listing_id: before.listing_id,
      camera_id: nextCameraId,
      lens_id: nextLensId,
      match_status: nextStatus,
      match_confidence: nextConfidence,
      match_method: nextMethod,
    };

    const diff = {
      before: {
        camera_id: before.camera_id,
        lens_id: before.lens_id,
        match_status: before.match_status,
        match_confidence: before.match_confidence,
        match_method: before.match_method,
      },
      after: {
        camera_id: afterPreview.camera_id,
        lens_id: afterPreview.lens_id,
        match_status: afterPreview.match_status,
        match_confidence: afterPreview.match_confidence,
        match_method: afterPreview.match_method,
      },
      reason: reason || null,
    };

    if (isDryRun) {
      await client.query("ROLLBACK");
      return { ok: true, dry_run: true, listing: afterPreview, diff };
    }

    const afterRes = await client.query(
      `
      UPDATE listings
      SET
        camera_id = $2,
        lens_id = $3,
        match_status = $4,
        match_confidence = $5,
        match_method = $6
      WHERE listing_id = $1
      RETURNING listing_id, camera_id, lens_id, match_status, match_confidence::float8 AS match_confidence, match_method
      `,
      [listingId, nextCameraId, nextLensId, nextStatus, nextConfidence, nextMethod],
    );
    const after = afterRes.rows[0];

    await client.query(
      `
      INSERT INTO audit_log (actor_type, actor_id, action, entity_type, entity_id, diff)
      VALUES ('human', $1, 'listing_match_override', 'listing', $2, $3::jsonb)
      `,
      [actorId.trim(), listingId, JSON.stringify(diff)],
    );

    await client.query("COMMIT");

    return { ok: true, dry_run: false, listing: after, diff };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function createDedupeEdge(pool, { canonicalListingId, duplicateListingId, actorId, confidence, reason, dryRun }) {
  if (!isUuid(canonicalListingId) || !isUuid(duplicateListingId)) return { ok: false, error: "invalid_listing_id" };
  if (!actorId || typeof actorId !== "string" || actorId.trim().length > 64) return { ok: false, error: "invalid_actor_id" };
  if (dryRun !== undefined && typeof dryRun !== "boolean") return { ok: false, error: "invalid_dry_run" };

  const isDryRun = dryRun !== false;

  const conf = clampNumber(confidence, { min: 0, max: 1, fallback: 0.9 });
  const reasonText = reason && typeof reason === "string" ? reason.slice(0, 256) : null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const beforeRes = await client.query(
      `
      SELECT
        edge_id,
        canonical_listing_id,
        duplicate_listing_id,
        method,
        confidence::float8 AS confidence,
        reason,
        created_at
      FROM listing_dedupe_edges
      WHERE duplicate_listing_id = $1
      LIMIT 1
      `,
      [duplicateListingId],
    );
    const before = beforeRes.rows[0] || null;

    const edgeRes = await client.query(
      `
      INSERT INTO listing_dedupe_edges (canonical_listing_id, duplicate_listing_id, method, confidence, reason)
      VALUES ($1,$2,'manual', $3, $4)
      ON CONFLICT (duplicate_listing_id) DO UPDATE SET
        canonical_listing_id = EXCLUDED.canonical_listing_id,
        method = EXCLUDED.method,
        confidence = EXCLUDED.confidence,
        reason = EXCLUDED.reason
      RETURNING edge_id, canonical_listing_id, duplicate_listing_id, method, confidence::float8 AS confidence, reason, created_at
      `,
      [canonicalListingId, duplicateListingId, conf, reasonText],
    );
    const after = edgeRes.rows[0];

    const diff = {
      before,
      after,
      reason: reasonText,
    };

    if (isDryRun) {
      await client.query("ROLLBACK");
      return { ok: true, dry_run: true, edge: after, diff };
    }

    await client.query(
      `
      INSERT INTO audit_log (actor_type, actor_id, action, entity_type, entity_id, diff)
      VALUES ('human', $1, 'listing_dedupe_edge_upsert', 'listing', $2, $3::jsonb)
      `,
      [actorId.trim(), duplicateListingId, JSON.stringify(diff)],
    );

    await client.query("COMMIT");

    return { ok: true, dry_run: false, edge: after, diff };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
