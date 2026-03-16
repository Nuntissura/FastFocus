import { createPoolFromEnv } from "../db/pool.js";
import { insertEmailMessage } from "../db/alerts.js";
import { listRunnableNewsletterSubscriptions, updateNewsletterSendState } from "../db/newsletter.js";
import { getEmailFrom, sendEmail } from "../alerts/email.js";
import { buildWeeklyDealsNewsletterEmail } from "./email.js";

function envString(name, fallback) {
  const raw = process.env[name];
  return raw && raw.trim() ? raw.trim() : fallback;
}

function envNumber(name, fallback) {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function envInt(name, fallback) {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) ? n : fallback;
}

function parseArgs(argv) {
  const out = { confirm: false, limit: 200 };
  for (const arg of argv) {
    if (arg === "--confirm") out.confirm = true;
    if (arg.startsWith("--limit=")) out.limit = Number(arg.slice("--limit=".length));
  }
  return out;
}

function cleanBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
}

function hoursSince(iso) {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const diffMs = Date.now() - then;
  return diffMs / (1000 * 60 * 60);
}

function listingSegments(listing) {
  const segs = new Set();
  const medium = listing.camera_capture_medium ? String(listing.camera_capture_medium) : "";
  const category = listing.camera_category ? String(listing.camera_category) : "";
  const weight = listing.camera_weight_g === null || listing.camera_weight_g === undefined ? null : Number(listing.camera_weight_g);
  const videoMax = listing.camera_video_max ? String(listing.camera_video_max) : "";

  if (medium === "film") segs.add("retro");

  if (category === "compact" || category === "rangefinder") segs.add("street");
  if (category === "mirrorless" && weight !== null && Number.isFinite(weight) && weight <= 700) segs.add("street");

  if (videoMax) segs.add("video");
  if (videoMax && (category === "mirrorless" || category === "dslr")) segs.add("hybrid");

  return Array.from(segs);
}

function intersects(a, b) {
  const aa = Array.isArray(a) ? a : [];
  const bb = Array.isArray(b) ? b : [];
  if (aa.length === 0 || bb.length === 0) return false;
  const set = new Set(aa.map((s) => String(s)));
  for (const item of bb) {
    if (set.has(String(item))) return true;
  }
  return false;
}

async function listTopDeals(pool, { minConfidence, minScore, maxAgeDays, limit }) {
  const res = await pool.query(
    `
    SELECT
      l.listing_id,
      l.marketplace_code,
      m.display_name AS marketplace_display_name,
      l.title,
      l.price_amount::float8 AS price_amount,
      l.price_currency,
      l.shipping_amount::float8 AS shipping_amount,
      l.shipping_currency,
      l.deal_score::float8 AS deal_score,
      l.deal_score_confidence::float8 AS deal_score_confidence,
      l.last_seen_at,
      l.camera_id,
      l.lens_id,
      cm.capture_medium AS camera_capture_medium,
      cm.camera_category AS camera_category,
      cm.weight_g AS camera_weight_g,
      cm.video_max AS camera_video_max
    FROM listings l
    JOIN marketplaces m ON m.marketplace_code = l.marketplace_code
    LEFT JOIN camera_models cm ON cm.camera_id = l.camera_id
    WHERE l.is_active = TRUE
      AND l.match_status IN ('matched','verified')
      AND l.deal_score IS NOT NULL
      AND COALESCE(l.deal_score_confidence, 0) >= $1
      AND l.deal_score >= $2
      AND l.last_seen_at >= NOW() - ($3::int * INTERVAL '1 day')
    ORDER BY l.deal_score DESC, l.last_seen_at DESC
    LIMIT $4
    `,
    [minConfidence, minScore, maxAgeDays, limit],
  );
  return res.rows;
}

export async function run({ confirm = false, limit = 200 } = {}) {
  const pool = createPoolFromEnv();
  if (!pool) {
    console.error("Missing DATABASE_URL.");
    process.exitCode = 2;
    return;
  }

  const baseUrl = cleanBaseUrl(envString("FF_PUBLIC_BASE_URL", "http://127.0.0.1:8787")) || "http://127.0.0.1:8787";
  const fromEmail = getEmailFrom();

  const minIntervalHours = envNumber("FF_NEWSLETTER_MIN_INTERVAL_HOURS", 168);
  const minConfidence = envNumber("FF_NEWSLETTER_MIN_DEAL_CONFIDENCE", 0.5);
  const minScore = envNumber("FF_NEWSLETTER_MIN_DEAL_SCORE", 70);
  const maxAgeDays = envInt("FF_NEWSLETTER_MAX_DEAL_AGE_DAYS", 14);
  const maxItems = envInt("FF_NEWSLETTER_MAX_ITEMS", 12);
  const dealPoolSize = envInt("FF_NEWSLETTER_DEAL_POOL_SIZE", 300);

  const sponsorText = envString("FF_NEWSLETTER_SPONSOR_TEXT", "");
  const sponsorUrl = envString("FF_NEWSLETTER_SPONSOR_URL", "");
  const sponsor = sponsorText && sponsorUrl ? { text: sponsorText, url: sponsorUrl } : null;

  const subs = await listRunnableNewsletterSubscriptions(pool, { limit });
  // eslint-disable-next-line no-console
  console.log(`newsletter_subscriptions: ${subs.length}`);

  const deals = await listTopDeals(pool, { minConfidence, minScore, maxAgeDays, limit: dealPoolSize });
  const issueDateIso = new Date().toISOString();

  let emailsAttempted = 0;
  let emailsSent = 0;

  for (const s of subs) {
    const subId = s.newsletter_subscription_id;
    const hours = hoursSince(s.last_issue_sent_at);
    if (hours !== null && hours < minIntervalHours) {
      // eslint-disable-next-line no-console
      console.log(`skip rate_limit newsletter_subscription_id=${subId} hours_since_last_issue=${hours.toFixed(2)}`);
      continue;
    }

    const segments = Array.isArray(s.segments) ? s.segments.map((x) => String(x)) : [];
    const segmentTag = segments.length > 0 ? segments.join(",") : null;

    const chosen = [];
    const seen = new Set();
    let matchCount = 0;

    for (const row of deals) {
      const id = row.listing_id;
      if (!id || seen.has(id)) continue;

      const segs = listingSegments(row);
      const isLens = Boolean(row.lens_id);

      const matches = segments.length === 0 ? true : isLens || intersects(segs, segments);
      if (!matches) continue;

      matchCount += 1;

      if (chosen.length < maxItems) {
        chosen.push(row);
        seen.add(id);
      }
    }

    if (chosen.length === 0) continue;

    const moreCount = Math.max(0, matchCount - chosen.length);
    const email = buildWeeklyDealsNewsletterEmail({
      baseUrl,
      unsubscribeToken: s.unsubscribe_token,
      segment: segmentTag,
      items: chosen,
      sponsor,
      issueDateIso,
      moreCount,
    });

    emailsAttempted += 1;

    if (!confirm) {
      // eslint-disable-next-line no-console
      console.log(`dry_run newsletter_subscription_id=${subId} to=${s.email_norm} subject=${JSON.stringify(email.subject)}`);
      continue;
    }

    const nowIso = new Date().toISOString();
    const send = sendEmail({ to: s.email, subject: email.subject, bodyText: email.bodyText });
    const status = send.ok ? send.status : "failed";
    const provider = send.ok ? send.provider : send.provider || "unknown";
    const error = send.ok ? null : send.error || "send_failed";

    await insertEmailMessage(pool, {
      message_type: "newsletter_weekly",
      newsletter_subscription_id: subId,
      to_email: s.email,
      from_email: fromEmail,
      subject: email.subject,
      body_text: email.bodyText,
      status,
      provider,
      provider_message_id: send.ok ? send.provider_message_id : null,
      error,
      sent_at: send.ok ? nowIso : null,
    });

    if (send.ok) {
      emailsSent += 1;
      await updateNewsletterSendState(pool, { newsletterSubscriptionId: subId, emailedAt: nowIso });
    }
  }

  // eslint-disable-next-line no-console
  console.log(`emails_attempted: ${emailsAttempted}`);
  // eslint-disable-next-line no-console
  console.log(`emails_sent: ${emailsSent}`);

  await pool.end();
}

if (process.argv[1] && process.argv[1].endsWith("run_weekly_deals_newsletter.js")) {
  const args = parseArgs(process.argv.slice(2));
  run(args).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  });
}
