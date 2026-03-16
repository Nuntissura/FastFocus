import { randomBytes } from "node:crypto";

function clampText(value, { max }) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function normalizeEmail(emailRaw) {
  const email = clampText(emailRaw, { max: 254 });
  if (!email) return null;
  const norm = email.toLowerCase();
  if (norm.length < 6) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(norm)) return null;
  return { email, email_norm: norm };
}

function token(bytes = 24) {
  return randomBytes(bytes).toString("base64url");
}

const ALLOWED_SEGMENTS = new Set(["street", "hybrid", "video", "retro"]);

function normalizeSegments(input) {
  const raw = (() => {
    if (input === null || input === undefined) return [];
    if (Array.isArray(input)) return input;
    return [input];
  })();

  const out = [];
  const seen = new Set();

  for (const item of raw) {
    const s = String(item || "").trim().toLowerCase();
    if (!s) continue;
    if (s === "all") continue;
    if (!ALLOWED_SEGMENTS.has(s)) return null;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }

  return out;
}

function arraysEqual(a, b) {
  const aa = Array.isArray(a) ? a : [];
  const bb = Array.isArray(b) ? b : [];
  if (aa.length !== bb.length) return false;
  for (let i = 0; i < aa.length; i += 1) {
    if (String(aa[i]) !== String(bb[i])) return false;
  }
  return true;
}

export function allowedNewsletterSegments() {
  return Array.from(ALLOWED_SEGMENTS);
}

export async function createNewsletterSubscription(
  pool,
  { email, segment = null, segments = null, max_subscriptions_per_email = 3 } = {},
) {
  const normalized = normalizeEmail(email);
  if (!normalized) return { ok: false, error: "invalid_email" };

  const nextSegments = normalizeSegments(segments !== null ? segments : segment);
  if (nextSegments === null) return { ok: false, error: "invalid_segments" };

  const activeRes = await pool.query(
    `
    SELECT
      newsletter_subscription_id,
      email,
      email_norm,
      segments::text[] AS segments,
      confirmed_at,
      confirm_token,
      unsubscribe_token,
      unsubscribed_at,
      enabled,
      last_issue_sent_at,
      created_at
    FROM newsletter_subscriptions
    WHERE email_norm = $1 AND enabled = TRUE AND unsubscribed_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [normalized.email_norm],
  );

  const active = activeRes.rows[0] || null;
  if (active) {
    if (!arraysEqual(active.segments, nextSegments) || active.email !== normalized.email) {
      const upd = await pool.query(
        `
        UPDATE newsletter_subscriptions
        SET email = $2, segments = $3::newsletter_segment_enum[]
        WHERE newsletter_subscription_id = $1
        RETURNING
          newsletter_subscription_id,
          email,
          email_norm,
          segments::text[] AS segments,
          confirmed_at,
          confirm_token,
          unsubscribe_token,
          unsubscribed_at,
          enabled,
          last_issue_sent_at,
          created_at
        `,
        [active.newsletter_subscription_id, normalized.email, nextSegments],
      );
      const row = upd.rows[0] || active;
      return {
        ok: true,
        status: row.confirmed_at ? "already_confirmed" : "confirmation_required",
        newsletter_subscription: row,
        reused: true,
      };
    }

    return {
      ok: true,
      status: active.confirmed_at ? "already_confirmed" : "confirmation_required",
      newsletter_subscription: active,
      reused: true,
    };
  }

  const countRes = await pool.query(
    `
    SELECT COUNT(*)::int AS c
    FROM newsletter_subscriptions
    WHERE email_norm = $1 AND enabled = TRUE AND unsubscribed_at IS NULL
    `,
    [normalized.email_norm],
  );
  const activeCount = countRes.rows[0] ? Number(countRes.rows[0].c) : 0;
  if (activeCount >= Number(max_subscriptions_per_email || 3)) return { ok: false, error: "limit_reached" };

  const confirmToken = token(24);
  const unsubscribeToken = token(24);

  const ins = await pool.query(
    `
    INSERT INTO newsletter_subscriptions (
      email,
      email_norm,
      segments,
      confirm_token,
      unsubscribe_token
    )
    VALUES ($1,$2,$3::newsletter_segment_enum[],$4,$5)
    RETURNING
      newsletter_subscription_id,
      email,
      email_norm,
      segments::text[] AS segments,
      confirmed_at,
      confirm_token,
      unsubscribe_token,
      unsubscribed_at,
      enabled,
      last_issue_sent_at,
      created_at
    `,
    [normalized.email, normalized.email_norm, nextSegments, confirmToken, unsubscribeToken],
  );

  return { ok: true, status: "confirmation_required", newsletter_subscription: ins.rows[0], reused: false };
}

export async function confirmNewsletterSubscriptionByToken(pool, { token: t } = {}) {
  const tokenText = clampText(t, { max: 96 });
  if (!tokenText) return { ok: false, error: "not_found" };

  const existedRes = await pool.query(
    `
    SELECT confirmed_at
    FROM newsletter_subscriptions
    WHERE confirm_token = $1
    LIMIT 1
    `,
    [tokenText],
  );
  const existed = existedRes.rows[0] || null;
  if (!existed) return { ok: false, error: "not_found" };

  const alreadyConfirmed = Boolean(existed.confirmed_at);

  const res = await pool.query(
    `
    UPDATE newsletter_subscriptions
    SET confirmed_at = COALESCE(confirmed_at, NOW())
    WHERE confirm_token = $1 AND enabled = TRUE AND unsubscribed_at IS NULL
    RETURNING newsletter_subscription_id, confirmed_at, unsubscribed_at, email_norm
    `,
    [tokenText],
  );

  const row = res.rows[0] || null;
  if (!row) return { ok: false, error: "not_found" };
  return { ok: true, already_confirmed: alreadyConfirmed, newsletter_subscription: row };
}

export async function unsubscribeNewsletterSubscriptionByToken(pool, { token: t } = {}) {
  const tokenText = clampText(t, { max: 96 });
  if (!tokenText) return { ok: false, error: "not_found" };

  const res = await pool.query(
    `
    UPDATE newsletter_subscriptions
    SET unsubscribed_at = COALESCE(unsubscribed_at, NOW()), enabled = FALSE
    WHERE unsubscribe_token = $1
    RETURNING newsletter_subscription_id, confirmed_at, unsubscribed_at, email_norm
    `,
    [tokenText],
  );
  const row = res.rows[0] || null;
  if (!row) return { ok: false, error: "not_found" };
  return { ok: true, newsletter_subscription: row };
}

export async function listRunnableNewsletterSubscriptions(pool, { limit = 200 } = {}) {
  const res = await pool.query(
    `
    SELECT
      newsletter_subscription_id,
      email,
      email_norm,
      segments::text[] AS segments,
      confirmed_at,
      unsubscribe_token,
      unsubscribed_at,
      enabled,
      last_issue_sent_at,
      created_at
    FROM newsletter_subscriptions
    WHERE enabled = TRUE
      AND unsubscribed_at IS NULL
      AND confirmed_at IS NOT NULL
    ORDER BY created_at ASC
    LIMIT $1
    `,
    [limit],
  );
  return res.rows;
}

export async function updateNewsletterSendState(pool, { newsletterSubscriptionId, emailedAt = null } = {}) {
  const res = await pool.query(
    `
    UPDATE newsletter_subscriptions
    SET last_issue_sent_at = COALESCE($2, last_issue_sent_at)
    WHERE newsletter_subscription_id = $1
    RETURNING newsletter_subscription_id
    `,
    [newsletterSubscriptionId, emailedAt],
  );
  return res.rows[0] || null;
}
