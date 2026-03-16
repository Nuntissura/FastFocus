function envString(name, fallback) {
  const raw = process.env[name];
  return raw && raw.trim() ? raw.trim() : fallback;
}

export function getEmailFrom() {
  return envString("FF_EMAIL_FROM", "Fast Focus <noreply@fastfocus.example>");
}

export function sendEmail({ to, subject, bodyText, transport = "" } = {}) {
  const mode = transport || envString("FF_EMAIL_TRANSPORT", "stdout");

  if (mode === "stdout") {
    // eslint-disable-next-line no-console
    console.log("\n=== EMAIL (stdout transport) ===");
    // eslint-disable-next-line no-console
    console.log("to:", to);
    // eslint-disable-next-line no-console
    console.log("subject:", subject);
    // eslint-disable-next-line no-console
    console.log("");
    // eslint-disable-next-line no-console
    console.log(bodyText);
    return { ok: true, provider: "stdout", provider_message_id: null, status: "simulated" };
  }

  return { ok: false, error: "unsupported_transport", provider: mode };
}

export function buildSavedSearchConfirmEmail({ baseUrl, confirmToken, unsubscribeToken } = {}) {
  const confirmUrl = `${baseUrl}/alerts/confirm?token=${encodeURIComponent(confirmToken)}`;
  const unsubscribeUrl = `${baseUrl}/alerts/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`;

  return {
    subject: "Confirm your Fast Focus alert",
    bodyText: [
      "You requested a Fast Focus email alert.",
      "",
      "Confirm alerts:",
      confirmUrl,
      "",
      "You can unsubscribe any time:",
      unsubscribeUrl,
      "",
      "Affiliate disclosure: some outbound marketplace links may be affiliate links. If you buy through a link, Fast Focus may earn a commission at no extra cost to you.",
    ].join("\n"),
  };
}

export function buildSavedSearchAlertEmail({ baseUrl, unsubscribeToken, items = [], moreCount = 0 } = {}) {
  const unsubscribeUrl = `${baseUrl}/alerts/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`;

  const lines = [];
  lines.push("New matching listings:");
  lines.push("");
  for (const item of items) {
    const title = item.title || "(untitled)";
    const money = formatListingMoney(item);
    const when = item.first_seen_at ? new Date(item.first_seen_at).toISOString() : "";
    const url = `${baseUrl}/go/listings/${encodeURIComponent(item.listing_id)}?page_type=search&utm_source=ff_email&utm_medium=email`;
    lines.push(`- ${title}${money ? ` — ${money}` : ""}${when ? ` — first seen ${when}` : ""}`);
    lines.push(`  ${url}`);
  }

  if (moreCount > 0) {
    lines.push("");
    lines.push(`(+ ${moreCount} more matching listing${moreCount === 1 ? "" : "s"} not shown)`);
  }

  lines.push("");
  lines.push("Unsubscribe:");
  lines.push(unsubscribeUrl);
  lines.push("");
  lines.push(
    "Affiliate disclosure: some outbound marketplace links may be affiliate links. If you buy through a link, Fast Focus may earn a commission at no extra cost to you.",
  );

  return {
    subject: `New used listings • Fast Focus`,
    bodyText: lines.join("\n"),
  };
}

function formatMoney(amount, currency) {
  if (amount === null || amount === undefined) return null;
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  if (currency && typeof currency === "string" && /^[A-Z]{3}$/.test(currency)) {
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
    } catch {
      // ignore
    }
  }
  return currency ? `${n.toFixed(0)} ${currency}` : n.toFixed(0);
}

function formatListingMoney(item) {
  const base = formatMoney(item.price_amount, item.price_currency);
  const shipping = formatMoney(item.shipping_amount, item.shipping_currency);
  if (!base) return null;
  if (shipping) return `${base} (+ ${shipping} shipping)`;
  return base;
}

