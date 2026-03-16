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

async function insertAuditLog(client, { actorType = "human", actorId, action, entityType, entityId, diff }) {
  await client.query(
    `
    INSERT INTO audit_log (actor_type, actor_id, action, entity_type, entity_id, diff)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    `,
    [actorType, actorId, action, entityType, entityId, JSON.stringify(diff || {})],
  );
}

export async function createPremiumSubscription(pool, { email, plan_code = "pro" } = {}) {
  const normalized = normalizeEmail(email);
  if (!normalized) return { ok: false, error: "invalid_email" };

  const plan = String(plan_code || "pro").trim().toLowerCase();
  if (plan !== "pro") return { ok: false, error: "invalid_plan_code" };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const activeRes = await client.query(
      `
      SELECT
        premium_subscription_id,
        email,
        email_norm,
        plan_code,
        status,
        confirmed_at,
        confirm_token,
        access_token,
        canceled_at,
        cancel_token,
        created_at
      FROM premium_subscriptions
      WHERE email_norm = $1 AND status IN ('pending','active')
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [normalized.email_norm],
    );

    const existing = activeRes.rows[0] || null;
    if (existing) {
      if (existing.email !== normalized.email) {
        await client.query(
          `
          UPDATE premium_subscriptions
          SET email = $2
          WHERE premium_subscription_id = $1
          `,
          [existing.premium_subscription_id, normalized.email],
        );
        existing.email = normalized.email;
      }

      await client.query("COMMIT");
      return {
        ok: true,
        status: existing.status === "active" ? "already_active" : "confirmation_required",
        premium_subscription: existing,
        reused: true,
      };
    }

    const confirmToken = token(24);
    const cancelToken = token(24);
    const accessToken = token(24);

    const ins = await client.query(
      `
      INSERT INTO premium_subscriptions (
        email,
        email_norm,
        plan_code,
        status,
        confirm_token,
        access_token,
        cancel_token
      )
      VALUES ($1,$2,$3,'pending',$4,$5,$6)
      RETURNING
        premium_subscription_id,
        email,
        email_norm,
        plan_code,
        status,
        confirmed_at,
        confirm_token,
        access_token,
        canceled_at,
        cancel_token,
        created_at
      `,
      [normalized.email, normalized.email_norm, plan, confirmToken, accessToken, cancelToken],
    );

    const row = ins.rows[0];

    await insertAuditLog(client, {
      actorId: "premium_self_serve",
      action: "premium_subscription_requested",
      entityType: "premium_subscription",
      entityId: row.premium_subscription_id,
      diff: {
        plan_code: row.plan_code,
        status: row.status,
        email_norm: row.email_norm,
      },
    });

    await client.query("COMMIT");

    return { ok: true, status: "confirmation_required", premium_subscription: row, reused: false };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function confirmPremiumSubscriptionByToken(pool, { token: t } = {}) {
  const tokenText = clampText(t, { max: 96 });
  if (!tokenText) return { ok: false, error: "not_found" };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existedRes = await client.query(
      `
      SELECT
        premium_subscription_id,
        status,
        confirmed_at,
        canceled_at
      FROM premium_subscriptions
      WHERE confirm_token = $1
      LIMIT 1
      `,
      [tokenText],
    );
    const existed = existedRes.rows[0] || null;
    if (!existed) {
      await client.query("ROLLBACK");
      return { ok: false, error: "not_found" };
    }

    if (existed.canceled_at) {
      await client.query("ROLLBACK");
      return { ok: false, error: "canceled" };
    }

    const alreadyConfirmed = Boolean(existed.confirmed_at) && existed.status === "active";

    const res = await client.query(
      `
      UPDATE premium_subscriptions
      SET
        confirmed_at = COALESCE(confirmed_at, NOW()),
        status = 'active'
      WHERE confirm_token = $1 AND canceled_at IS NULL
      RETURNING premium_subscription_id, email_norm, confirmed_at, status, access_token
      `,
      [tokenText],
    );

    const row = res.rows[0] || null;
    if (!row) {
      await client.query("ROLLBACK");
      return { ok: false, error: "not_found" };
    }

    await insertAuditLog(client, {
      actorId: "premium_self_serve",
      action: "premium_subscription_confirmed",
      entityType: "premium_subscription",
      entityId: row.premium_subscription_id,
      diff: {
        already_confirmed: alreadyConfirmed,
        status: row.status,
        email_norm: row.email_norm,
      },
    });

    await client.query("COMMIT");

    return { ok: true, already_confirmed: alreadyConfirmed, premium_subscription: row };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function cancelPremiumSubscriptionByToken(pool, { token: t } = {}) {
  const tokenText = clampText(t, { max: 96 });
  if (!tokenText) return { ok: false, error: "not_found" };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existedRes = await client.query(
      `
      SELECT
        premium_subscription_id,
        status,
        confirmed_at,
        canceled_at,
        email_norm
      FROM premium_subscriptions
      WHERE cancel_token = $1
      LIMIT 1
      `,
      [tokenText],
    );
    const existed = existedRes.rows[0] || null;
    if (!existed) {
      await client.query("ROLLBACK");
      return { ok: false, error: "not_found" };
    }

    const alreadyCanceled = Boolean(existed.canceled_at) || existed.status === "canceled";

    const res = await client.query(
      `
      UPDATE premium_subscriptions
      SET
        canceled_at = COALESCE(canceled_at, NOW()),
        status = 'canceled'
      WHERE cancel_token = $1
      RETURNING premium_subscription_id, email_norm, confirmed_at, canceled_at, status
      `,
      [tokenText],
    );

    const row = res.rows[0] || null;
    if (!row) {
      await client.query("ROLLBACK");
      return { ok: false, error: "not_found" };
    }

    await insertAuditLog(client, {
      actorId: "premium_self_serve",
      action: "premium_subscription_canceled",
      entityType: "premium_subscription",
      entityId: row.premium_subscription_id,
      diff: {
        already_canceled: alreadyCanceled,
        status: row.status,
        email_norm: row.email_norm,
      },
    });

    await client.query("COMMIT");

    return { ok: true, already_canceled: alreadyCanceled, premium_subscription: row };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getActivePremiumSubscriptionByAccessToken(pool, { accessToken } = {}) {
  const tokenText = clampText(accessToken, { max: 128 });
  if (!tokenText) return null;

  const res = await pool.query(
    `
    SELECT
      premium_subscription_id,
      email,
      email_norm,
      plan_code,
      status,
      confirmed_at,
      canceled_at,
      created_at
    FROM premium_subscriptions
    WHERE access_token = $1 AND status = 'active' AND confirmed_at IS NOT NULL AND canceled_at IS NULL
    LIMIT 1
    `,
    [tokenText],
  );
  return res.rows[0] || null;
}

export async function isPremiumEmail(pool, { email } = {}) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;

  const res = await pool.query(
    `
    SELECT 1
    FROM premium_subscriptions
    WHERE email_norm = $1 AND status = 'active' AND confirmed_at IS NOT NULL AND canceled_at IS NULL
    LIMIT 1
    `,
    [normalized.email_norm],
  );

  return Boolean(res.rows[0]);
}

