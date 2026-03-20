import { createPoolFromEnv } from "../db/pool.js";
import { insertEmailMessage } from "../db/alerts.js";
import {
  getPremiumTrackerCurrentSnapshot,
  hasPremiumTrackerNotificationForObservedDate,
  listRunnablePremiumTrackerWatches,
  recordPremiumTrackerNotification,
  updatePremiumTrackerWatchState,
} from "../db/premium_tracker.js";
import { getEmailFrom, sendEmail } from "../alerts/email.js";
import { buildPremiumTrackerAlertEmail } from "./email.js";

function envString(name, fallback) {
  const raw = process.env[name];
  return raw && raw.trim() ? raw.trim() : fallback;
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
  return (Date.now() - then) / (1000 * 60 * 60);
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

  const watches = await listRunnablePremiumTrackerWatches(pool, { limit });
  console.log(`premium_tracker_watches: ${watches.length}`);

  let emailsAttempted = 0;
  let emailsSent = 0;

  for (const watch of watches) {
    const nowIso = new Date().toISOString();
    const snapshot = await getPremiumTrackerCurrentSnapshot(pool, { watch });

    if (confirm) {
      await updatePremiumTrackerWatchState(pool, {
        watchId: watch.premium_tracker_watch_id,
        checkedAt: nowIso,
      });
    }

    if (!snapshot || !snapshot.threshold_met) continue;

    const hours = hoursSince(watch.last_alerted_at);
    if (hours !== null && hours < Number(watch.min_interval_hours || 24)) {
      console.log(
        `skip rate_limit premium_tracker_watch_id=${watch.premium_tracker_watch_id} hours_since_last_alert=${hours.toFixed(2)}`,
      );
      continue;
    }

    const alreadySent = await hasPremiumTrackerNotificationForObservedDate(pool, {
      watchId: watch.premium_tracker_watch_id,
      observedDate: snapshot.observed_date_utc,
    });
    if (alreadySent) {
      console.log(
        `skip already_sent premium_tracker_watch_id=${watch.premium_tracker_watch_id} observed_date=${snapshot.observed_date_utc}`,
      );
      continue;
    }

    const email = buildPremiumTrackerAlertEmail({
      baseUrl,
      watch,
      snapshot,
    });

    emailsAttempted += 1;

    if (!confirm) {
      console.log(
        `dry_run premium_tracker_watch_id=${watch.premium_tracker_watch_id} to=${watch.email_norm} subject=${JSON.stringify(email.subject)}`,
      );
      continue;
    }

    const send = sendEmail({ to: watch.email, subject: email.subject, bodyText: email.bodyText });
    const status = send.ok ? send.status : "failed";
    const provider = send.ok ? send.provider : send.provider || "unknown";
    const error = send.ok ? null : send.error || "send_failed";

    const messageRow = await insertEmailMessage(pool, {
      message_type: "premium_tracker_alert",
      premium_subscription_id: watch.premium_subscription_id,
      to_email: watch.email,
      from_email: fromEmail,
      subject: email.subject,
      body_text: email.bodyText,
      status,
      provider,
      provider_message_id: send.ok ? send.provider_message_id : null,
      error,
      sent_at: send.ok ? nowIso : null,
    });

    if (!send.ok) continue;

    emailsSent += 1;

    await recordPremiumTrackerNotification(pool, {
      watchId: watch.premium_tracker_watch_id,
      observedDate: snapshot.observed_date_utc,
      triggerMetric: watch.trigger_metric,
      triggerValue: snapshot.trigger_value,
      targetPriceAmount: watch.target_price_amount,
      sampleSize: snapshot.sample_size,
      emailMessageId: messageRow.email_message_id,
      sentAt: nowIso,
    });

    await updatePremiumTrackerWatchState(pool, {
      watchId: watch.premium_tracker_watch_id,
      alertedAt: nowIso,
    });
  }

  console.log(`emails_attempted: ${emailsAttempted}`);
  console.log(`emails_sent: ${emailsSent}`);

  await pool.end();
}

if (process.argv[1] && process.argv[1].endsWith("run_tracker_alerts.js")) {
  const args = parseArgs(process.argv.slice(2));
  run(args).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
