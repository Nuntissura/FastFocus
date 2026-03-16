function clampInt(value, { min, max, fallback }) {
  if (value === null || value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function isMarketplaceCode(value) {
  return typeof value === "string" && /^[a-z0-9_]{2,32}$/.test(value);
}

export function parseWindowDays(url, fallback = 30) {
  return clampInt(url.searchParams.get("window_days"), { min: 1, max: 365, fallback });
}

export async function listPartners(pool) {
  const res = await pool.query(
    `
    SELECT
      m.marketplace_code,
      m.display_name,
      m.affiliate_supported,

      m.partner_status,
      m.partner_kind,
      m.affiliate_params_template,

      m.is_sponsored,
      m.sponsored_rank,
      m.sponsored_label,

      COALESCE(ls.active_listing_count, 0)::int AS active_listing_count,
      ls.last_retrieved_at AS last_listing_retrieved_at,

      ir.run_id AS last_run_id,
      ir.job_name AS last_run_job_name,
      ir.started_at AS last_run_started_at,
      ir.ended_at AS last_run_ended_at,
      ir.status AS last_run_status,
      ir.stats AS last_run_stats,
      ir.error AS last_run_error
    FROM marketplaces m
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) FILTER (WHERE l.is_active = TRUE)::int AS active_listing_count,
        MAX(l.last_retrieved_at) AS last_retrieved_at
      FROM listings l
      WHERE l.marketplace_code = m.marketplace_code
    ) ls ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        run_id,
        job_name,
        started_at,
        ended_at,
        status,
        stats,
        error
      FROM ingestion_runs r
      WHERE r.marketplace_code = m.marketplace_code
      ORDER BY started_at DESC
      LIMIT 1
    ) ir ON TRUE
    WHERE m.partner_status <> 'none'
    ORDER BY m.is_sponsored DESC, m.sponsored_rank DESC, m.marketplace_code ASC
    `,
  );

  return res.rows.map((r) => ({
    marketplace_code: r.marketplace_code,
    display_name: r.display_name,
    affiliate_supported: Boolean(r.affiliate_supported),

    partner_status: r.partner_status,
    partner_kind: r.partner_kind,
    affiliate_params_template: r.affiliate_params_template,

    is_sponsored: Boolean(r.is_sponsored),
    sponsored_rank: Number(r.sponsored_rank || 0),
    sponsored_label: r.sponsored_label,

    active_listing_count: Number(r.active_listing_count || 0),
    last_listing_retrieved_at: r.last_listing_retrieved_at ? new Date(r.last_listing_retrieved_at).toISOString() : null,

    last_run: r.last_run_id
      ? {
          run_id: Number(r.last_run_id),
          job_name: r.last_run_job_name,
          started_at: r.last_run_started_at ? new Date(r.last_run_started_at).toISOString() : null,
          ended_at: r.last_run_ended_at ? new Date(r.last_run_ended_at).toISOString() : null,
          status: r.last_run_status,
          stats: r.last_run_stats || {},
          error: r.last_run_error || null,
        }
      : null,
  }));
}

export async function getPartnerReport(pool, { marketplaceCode, windowDays }) {
  if (!isMarketplaceCode(marketplaceCode)) return { ok: false, error: "invalid_marketplace_code" };

  const safeWindowDays = clampInt(windowDays, { min: 1, max: 365, fallback: 30 });
  const untilIso = new Date().toISOString();
  const sinceIso = new Date(Date.now() - safeWindowDays * 24 * 60 * 60 * 1000).toISOString();

  const partnerRes = await pool.query(
    `
    SELECT
      marketplace_code,
      display_name,
      affiliate_supported,
      partner_status,
      partner_kind,
      affiliate_params_template,
      is_sponsored,
      sponsored_rank,
      sponsored_label
    FROM marketplaces
    WHERE marketplace_code = $1
    LIMIT 1
    `,
    [marketplaceCode],
  );

  const partner = partnerRes.rows[0] || null;
  if (!partner || partner.partner_status === "none") return { ok: false, error: "not_found" };

  const redirectTotalsRes = await pool.query(
    `
    SELECT
      COUNT(*) FILTER (WHERE hr.status_code BETWEEN 300 AND 399 AND hr.is_bot = FALSE)::int AS redirect_clickouts,
      COUNT(*) FILTER (WHERE hr.status_code BETWEEN 300 AND 399 AND hr.is_bot = TRUE)::int AS redirect_clickouts_bots,
      COUNT(*) FILTER (WHERE hr.status_code = 404)::int AS not_found_responses
    FROM http_request_logs hr
    JOIN listings l ON l.listing_id = hr.listing_id
    WHERE
      hr.occurred_at >= $1
      AND hr.occurred_at < $2
      AND hr.listing_id IS NOT NULL
      AND hr.path LIKE '/go/listings/%'
      AND l.marketplace_code = $3
    `,
    [sinceIso, untilIso, marketplaceCode],
  );

  const redirectUtmRes = await pool.query(
    `
    SELECT
      COALESCE(hr.utm->>'utm_source', '(none)') AS utm_source,
      COUNT(*) FILTER (WHERE hr.status_code BETWEEN 300 AND 399 AND hr.is_bot = FALSE)::int AS clickouts
    FROM http_request_logs hr
    JOIN listings l ON l.listing_id = hr.listing_id
    WHERE
      hr.occurred_at >= $1
      AND hr.occurred_at < $2
      AND hr.listing_id IS NOT NULL
      AND hr.path LIKE '/go/listings/%'
      AND l.marketplace_code = $3
    GROUP BY COALESCE(hr.utm->>'utm_source', '(none)')
    HAVING COUNT(*) FILTER (WHERE hr.status_code BETWEEN 300 AND 399 AND hr.is_bot = FALSE) > 0
    ORDER BY clickouts DESC
    LIMIT 50
    `,
    [sinceIso, untilIso, marketplaceCode],
  );

  const redirectRefRes = await pool.query(
    `
    SELECT
      COALESCE(hr.referrer, '(none)') AS referrer,
      COUNT(*) FILTER (WHERE hr.status_code BETWEEN 300 AND 399 AND hr.is_bot = FALSE)::int AS clickouts
    FROM http_request_logs hr
    JOIN listings l ON l.listing_id = hr.listing_id
    WHERE
      hr.occurred_at >= $1
      AND hr.occurred_at < $2
      AND hr.listing_id IS NOT NULL
      AND hr.path LIKE '/go/listings/%'
      AND l.marketplace_code = $3
    GROUP BY COALESCE(hr.referrer, '(none)')
    HAVING COUNT(*) FILTER (WHERE hr.status_code BETWEEN 300 AND 399 AND hr.is_bot = FALSE) > 0
    ORDER BY clickouts DESC
    LIMIT 50
    `,
    [sinceIso, untilIso, marketplaceCode],
  );

  const consentedTotalsRes = await pool.query(
    `
    SELECT
      COUNT(*) FILTER (WHERE e.is_bot = FALSE)::int AS consented_clickouts,
      COUNT(DISTINCT e.session_id) FILTER (WHERE e.is_bot = FALSE)::int AS unique_sessions
    FROM events e
    JOIN listings l ON l.listing_id = e.listing_id
    WHERE
      e.occurred_at >= $1
      AND e.occurred_at < $2
      AND e.event_name = 'listing_clickout'
      AND l.marketplace_code = $3
    `,
    [sinceIso, untilIso, marketplaceCode],
  );

  const consentedUtmRes = await pool.query(
    `
    SELECT
      COALESCE(e.utm->>'utm_source', '(none)') AS utm_source,
      COUNT(*) FILTER (WHERE e.is_bot = FALSE)::int AS clickouts
    FROM events e
    JOIN listings l ON l.listing_id = e.listing_id
    WHERE
      e.occurred_at >= $1
      AND e.occurred_at < $2
      AND e.event_name = 'listing_clickout'
      AND l.marketplace_code = $3
    GROUP BY COALESCE(e.utm->>'utm_source', '(none)')
    HAVING COUNT(*) FILTER (WHERE e.is_bot = FALSE) > 0
    ORDER BY clickouts DESC
    LIMIT 50
    `,
    [sinceIso, untilIso, marketplaceCode],
  );

  const redirectTotals = redirectTotalsRes.rows[0] || null;
  const consentedTotals = consentedTotalsRes.rows[0] || null;

  return {
    ok: true,
    marketplace: {
      marketplace_code: partner.marketplace_code,
      display_name: partner.display_name,
      affiliate_supported: Boolean(partner.affiliate_supported),

      partner_status: partner.partner_status,
      partner_kind: partner.partner_kind,
      affiliate_params_template: partner.affiliate_params_template,

      is_sponsored: Boolean(partner.is_sponsored),
      sponsored_rank: Number(partner.sponsored_rank || 0),
      sponsored_label: partner.sponsored_label,
    },
    window: {
      window_days: safeWindowDays,
      since_utc: sinceIso,
      until_utc: untilIso,
    },
    clickouts: {
      redirects_total: redirectTotals ? Number(redirectTotals.redirect_clickouts || 0) : 0,
      redirects_bots: redirectTotals ? Number(redirectTotals.redirect_clickouts_bots || 0) : 0,
      redirects_not_found: redirectTotals ? Number(redirectTotals.not_found_responses || 0) : 0,
      redirects_by_utm_source: redirectUtmRes.rows.map((r) => ({ utm_source: r.utm_source, clickouts: Number(r.clickouts || 0) })),
      redirects_by_referrer: redirectRefRes.rows.map((r) => ({ referrer: r.referrer, clickouts: Number(r.clickouts || 0) })),

      consented_total: consentedTotals ? Number(consentedTotals.consented_clickouts || 0) : 0,
      consented_unique_sessions: consentedTotals ? Number(consentedTotals.unique_sessions || 0) : 0,
      consented_by_utm_source: consentedUtmRes.rows.map((r) => ({ utm_source: r.utm_source, clickouts: Number(r.clickouts || 0) })),
    },
  };
}

