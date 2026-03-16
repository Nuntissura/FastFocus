function clampInt(value, { min, max, fallback }) {
  if (value === null || value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function envInt(name, fallback) {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) ? n : fallback;
}

export function parseWindowMinutes(url, fallback = 60) {
  return clampInt(url.searchParams.get("window_minutes"), { min: 1, max: 1440, fallback });
}

export async function getBotTrafficSummary(pool, { windowMinutes }) {
  const safeWindowMinutes = clampInt(windowMinutes, { min: 1, max: 1440, fallback: 60 });
  const sinceIso = new Date(Date.now() - safeWindowMinutes * 60 * 1000).toISOString();

  const totalsRes = await pool.query(
    `
    SELECT
      COUNT(*)::int AS total_requests,
      COUNT(*) FILTER (WHERE is_bot = TRUE)::int AS bot_requests,
      COUNT(*) FILTER (WHERE is_bot = FALSE)::int AS human_requests,
      COUNT(DISTINCT path)::int AS unique_paths
    FROM http_request_logs
    WHERE occurred_at >= $1
    `,
    [sinceIso],
  );

  const botsRes = await pool.query(
    `
    SELECT
      COALESCE(bot_name, 'Unknown') AS bot_name,
      COUNT(*)::int AS requests,
      COUNT(DISTINCT path)::int AS unique_paths,
      COUNT(*) FILTER (WHERE status_code >= 400)::int AS error_responses
    FROM http_request_logs
    WHERE occurred_at >= $1 AND is_bot = TRUE
    GROUP BY COALESCE(bot_name, 'Unknown')
    ORDER BY requests DESC
    LIMIT 50
    `,
    [sinceIso],
  );

  const pathsRes = await pool.query(
    `
    SELECT
      path,
      COUNT(*)::int AS requests
    FROM http_request_logs
    WHERE occurred_at >= $1 AND is_bot = TRUE
    GROUP BY path
    ORDER BY requests DESC
    LIMIT 50
    `,
    [sinceIso],
  );

  const aiRefRes = await pool.query(
    `
    SELECT
      utm->>'utm_source' AS utm_source,
      COUNT(*)::int AS requests
    FROM http_request_logs
    WHERE occurred_at >= $1 AND (utm->>'utm_source') IS NOT NULL
    GROUP BY utm->>'utm_source'
    ORDER BY requests DESC
    LIMIT 50
    `,
    [sinceIso],
  );

  const ipsRes = await pool.query(
    `
    SELECT
      ip_hash,
      COUNT(*)::int AS requests,
      COUNT(DISTINCT path)::int AS unique_paths,
      COUNT(*) FILTER (WHERE status_code >= 400)::int AS error_responses
    FROM http_request_logs
    WHERE occurred_at >= $1 AND ip_hash IS NOT NULL
    GROUP BY ip_hash
    ORDER BY requests DESC
    LIMIT 50
    `,
    [sinceIso],
  );

  const totals = totalsRes.rows[0] || null;

  const alerts = [];
  const spikeRequests = envInt("FF_BOT_ALERT_SPIKE_REQUESTS", 600);
  const spikeUniquePaths = envInt("FF_BOT_ALERT_SPIKE_UNIQUE_PATHS", 200);

  for (const row of ipsRes.rows) {
    const requests = Number(row.requests || 0);
    const uniquePaths = Number(row.unique_paths || 0);
    if (requests >= spikeRequests) {
      alerts.push({
        type: "high_request_rate",
        severity: "warn",
        ip_hash: row.ip_hash,
        requests,
        window_minutes: safeWindowMinutes,
      });
    }
    if (uniquePaths >= spikeUniquePaths) {
      alerts.push({
        type: "high_unique_path_rate",
        severity: "warn",
        ip_hash: row.ip_hash,
        unique_paths: uniquePaths,
        window_minutes: safeWindowMinutes,
      });
    }
  }

  for (const row of botsRes.rows) {
    const requests = Number(row.requests || 0);
    const uniquePaths = Number(row.unique_paths || 0);
    if (requests >= spikeRequests) {
      alerts.push({
        type: "bot_spike",
        severity: "warn",
        bot_name: row.bot_name,
        requests,
        window_minutes: safeWindowMinutes,
      });
    }
    if (uniquePaths >= spikeUniquePaths) {
      alerts.push({
        type: "bot_unique_path_spike",
        severity: "warn",
        bot_name: row.bot_name,
        unique_paths: uniquePaths,
        window_minutes: safeWindowMinutes,
      });
    }
  }

  return {
    window_minutes: safeWindowMinutes,
    since_utc: sinceIso,
    totals: totals
      ? {
          total_requests: Number(totals.total_requests || 0),
          bot_requests: Number(totals.bot_requests || 0),
          human_requests: Number(totals.human_requests || 0),
          unique_paths: Number(totals.unique_paths || 0),
        }
      : { total_requests: 0, bot_requests: 0, human_requests: 0, unique_paths: 0 },
    bots: botsRes.rows.map((r) => ({
      bot_name: r.bot_name,
      requests: Number(r.requests || 0),
      unique_paths: Number(r.unique_paths || 0),
      error_responses: Number(r.error_responses || 0),
    })),
    bot_top_paths: pathsRes.rows.map((r) => ({ path: r.path, requests: Number(r.requests || 0) })),
    utm_sources: aiRefRes.rows
      .filter((r) => r.utm_source)
      .map((r) => ({ utm_source: r.utm_source, requests: Number(r.requests || 0) })),
    top_ip_hashes: ipsRes.rows.map((r) => ({
      ip_hash: r.ip_hash,
      requests: Number(r.requests || 0),
      unique_paths: Number(r.unique_paths || 0),
      error_responses: Number(r.error_responses || 0),
    })),
    alerts,
  };
}
