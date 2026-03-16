import { createPoolFromEnv } from "../db/pool.js";
import {
  countPendingDeliveries,
  insertEmailMessage,
  insertPendingDeliveries,
  listPendingDeliveries,
  listRunnableSavedSearches,
  markDeliveriesDelivered,
  updateSavedSearchCheckState,
} from "../db/alerts.js";
import { buildSavedSearchAlertEmail, getEmailFrom, sendEmail } from "./email.js";

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
  const diffMs = Date.now() - then;
  return diffMs / (1000 * 60 * 60);
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

  const searches = await listRunnableSavedSearches(pool, { limit });
  // eslint-disable-next-line no-console
  console.log(`saved_searches: ${searches.length}`);

  let emailsAttempted = 0;
  let emailsSent = 0;

  for (const s of searches) {
    const savedSearchId = s.saved_search_id;
    const since = s.last_checked_at || s.created_at;
    const nowIso = new Date().toISOString();

    if (confirm) {
      await insertPendingDeliveries(pool, { savedSearch: s, since, limit: 1000 });
      await updateSavedSearchCheckState(pool, { savedSearchId, checkedAt: nowIso });
    }

    const pendingCount = await countPendingDeliveries(pool, { savedSearchId });
    if (pendingCount === 0) continue;

    const hours = hoursSince(s.last_email_sent_at);
    if (hours !== null && hours < Number(s.min_interval_hours || 24)) {
      // eslint-disable-next-line no-console
      console.log(`skip rate_limit saved_search_id=${savedSearchId} pending=${pendingCount} hours_since_last_email=${hours.toFixed(2)}`);
      continue;
    }

    const items = await listPendingDeliveries(pool, { savedSearchId, limit: Number(s.max_results_per_email || 10) });
    const moreCount = Math.max(0, pendingCount - items.length);
    const email = buildSavedSearchAlertEmail({ baseUrl, unsubscribeToken: s.unsubscribe_token, items, moreCount });

    emailsAttempted += 1;

    if (!confirm) {
      // eslint-disable-next-line no-console
      console.log(`dry_run saved_search_id=${savedSearchId} to=${s.email_norm} pending=${pendingCount} subject=${JSON.stringify(email.subject)}`);
      continue;
    }

    const send = sendEmail({ to: s.email, subject: email.subject, bodyText: email.bodyText });
    const status = send.ok ? send.status : "failed";
    const provider = send.ok ? send.provider : send.provider || "unknown";
    const error = send.ok ? null : send.error || "send_failed";

    const messageRow = await insertEmailMessage(pool, {
      message_type: "saved_search_alert",
      saved_search_id: savedSearchId,
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
      const listingIds = items.map((i) => i.listing_id);
      await markDeliveriesDelivered(pool, { savedSearchId, listingIds, emailMessageId: messageRow.email_message_id });
      await updateSavedSearchCheckState(pool, { savedSearchId, emailedAt: nowIso });
    }
  }

  // eslint-disable-next-line no-console
  console.log(`emails_attempted: ${emailsAttempted}`);
  // eslint-disable-next-line no-console
  console.log(`emails_sent: ${emailsSent}`);

  await pool.end();
}

if (process.argv[1] && process.argv[1].endsWith("run_saved_search_alerts.js")) {
  const args = parseArgs(process.argv.slice(2));
  run(args).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  });
}

