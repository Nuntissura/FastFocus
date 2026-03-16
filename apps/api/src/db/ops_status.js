function clampInt(value, { min, max, fallback }) {
  if (value === null || value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function parseIsoOrNull(value) {
  if (!value) return null;
  try {
    return new Date(value).toISOString();
  } catch {
    return null;
  }
}

export async function getOpsStatus(pool, { ingestionRunsLimit = 20 } = {}) {
  const safeLimit = clampInt(ingestionRunsLimit, { min: 1, max: 200, fallback: 20 });
  const nowIso = new Date().toISOString();

  const ingestionRes = await pool.query(
    `
    SELECT
      run_id,
      job_name,
      marketplace_code,
      started_at,
      ended_at,
      status,
      error
    FROM ingestion_runs
    ORDER BY started_at DESC
    LIMIT $1
    `,
    [safeLimit],
  );

  const batchStartRes = await pool.query(
    `
    SELECT created_at, diff
    FROM audit_log
    WHERE actor_type = 'ai' AND actor_id = 'scheduler' AND action = 'batch_refresh_start'
    ORDER BY created_at DESC
    LIMIT 1
    `,
  );

  const batchEndRes = await pool.query(
    `
    SELECT created_at, diff
    FROM audit_log
    WHERE actor_type = 'ai' AND actor_id = 'scheduler' AND action = 'batch_refresh_end'
    ORDER BY created_at DESC
    LIMIT 1
    `,
  );

  const batchFailRes = await pool.query(
    `
    SELECT created_at, diff
    FROM audit_log
    WHERE actor_type = 'ai' AND actor_id = 'scheduler' AND action = 'batch_refresh_step_fail'
    ORDER BY created_at DESC
    LIMIT 1
    `,
  );

  const camBandRes = await pool.query(`SELECT MAX(observed_date)::text AS d FROM price_observations`);
  const lensBandRes = await pool.query(`SELECT MAX(observed_date)::text AS d FROM lens_price_observations`);

  const clickoutsRes = await pool.query(
    `
    SELECT
      COUNT(*)::int AS count_24h,
      MAX(occurred_at) AS last_clickout_at
    FROM events
    WHERE event_name = 'listing_clickout'
      AND occurred_at >= NOW() - INTERVAL '24 hours'
    `,
  );

  const errorsRes = await pool.query(
    `
    SELECT
      COUNT(*)::int AS count_15m,
      MAX(occurred_at) AS last_error_at
    FROM http_request_logs
    WHERE occurred_at >= NOW() - INTERVAL '15 minutes'
      AND status_code >= 500
    `,
  );

  const batchStart = batchStartRes.rows[0] || null;
  const batchEnd = batchEndRes.rows[0] || null;
  const batchFail = batchFailRes.rows[0] || null;

  const clickRow = clickoutsRes.rows[0] || null;
  const errRow = errorsRes.rows[0] || null;

  return {
    time_utc: nowIso,
    ingestion_runs: ingestionRes.rows.map((r) => ({
      run_id: r.run_id,
      job_name: r.job_name,
      marketplace_code: r.marketplace_code,
      started_at: parseIsoOrNull(r.started_at),
      ended_at: parseIsoOrNull(r.ended_at),
      status: r.status,
      error: r.error || null,
    })),
    batch_refresh: {
      last_start_at: batchStart ? parseIsoOrNull(batchStart.created_at) : null,
      last_start_diff: batchStart ? batchStart.diff || {} : {},
      last_end_at: batchEnd ? parseIsoOrNull(batchEnd.created_at) : null,
      last_end_diff: batchEnd ? batchEnd.diff || {} : {},
      last_step_fail_at: batchFail ? parseIsoOrNull(batchFail.created_at) : null,
      last_step_fail_diff: batchFail ? batchFail.diff || {} : {},
    },
    price_bands: {
      cameras_max_observed_date_utc: camBandRes.rows[0]?.d || null,
      lenses_max_observed_date_utc: lensBandRes.rows[0]?.d || null,
    },
    clickouts: {
      count_24h: Number(clickRow?.count_24h || 0),
      last_clickout_at: parseIsoOrNull(clickRow?.last_clickout_at),
    },
    http_5xx: {
      count_15m: Number(errRow?.count_15m || 0),
      last_error_at: parseIsoOrNull(errRow?.last_error_at),
    },
  };
}

