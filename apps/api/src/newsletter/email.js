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

function segmentLabel(segment) {
  if (!segment) return "All";
  const s = String(segment);
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

export function buildNewsletterConfirmEmail({ baseUrl, confirmToken, unsubscribeToken, segment = null } = {}) {
  const confirmUrl = `${baseUrl}/newsletter/confirm?token=${encodeURIComponent(confirmToken)}`;
  const unsubscribeUrl = `${baseUrl}/newsletter/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`;
  const seg = segmentLabel(segment);

  return {
    subject: "Confirm your Fast Focus newsletter",
    bodyText: [
      "You requested the Fast Focus weekly deals newsletter.",
      "",
      `Segment: ${seg}`,
      "",
      "Confirm subscription:",
      confirmUrl,
      "",
      "Unsubscribe any time:",
      unsubscribeUrl,
      "",
      "Affiliate disclosure: some outbound marketplace links may be affiliate links. If you buy through a link, Fast Focus may earn a commission at no extra cost to you.",
    ].join("\n"),
  };
}

export function buildWeeklyDealsNewsletterEmail({
  baseUrl,
  unsubscribeToken,
  segment = null,
  items = [],
  sponsor = null,
  issueDateIso = null,
  moreCount = 0,
} = {}) {
  const unsubscribeUrl = `${baseUrl}/newsletter/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`;
  const seg = segmentLabel(segment);

  const lines = [];
  lines.push(`Fast Focus weekly deals (${seg})`);
  if (issueDateIso) lines.push(`As of: ${issueDateIso}`);
  lines.push("");

  if (sponsor && sponsor.text && sponsor.url) {
    lines.push("Sponsor (paid):");
    lines.push(String(sponsor.text).trim());
    lines.push(String(sponsor.url).trim());
    lines.push("Disclosure: This is a paid sponsorship slot and does not affect deal scoring.");
    lines.push("");
  }

  lines.push("Deals:");
  lines.push("");

  for (const item of items) {
    const title = item.title || "(untitled)";
    const money = formatListingMoney(item);
    const score = item.deal_score !== null && item.deal_score !== undefined ? Number(item.deal_score) : null;
    const scoreText = score !== null && Number.isFinite(score) ? `deal ${Math.round(score)}/100` : null;
    const source = item.marketplace_display_name || item.marketplace_code || "source";
    const seen = item.last_seen_at ? new Date(item.last_seen_at).toISOString() : null;

    const url = `${baseUrl}/go/listings/${encodeURIComponent(item.listing_id)}?page_type=other&utm_source=ff_newsletter&utm_medium=email&utm_campaign=weekly_deals&utm_content=${encodeURIComponent(
      segment || "all",
    )}`;

    const parts = [];
    if (money) parts.push(money);
    if (scoreText) parts.push(scoreText);
    if (source) parts.push(String(source));
    if (seen) parts.push(`last seen ${seen}`);

    lines.push(`- ${title}${parts.length ? ` — ${parts.join(" — ")}` : ""}`);
    lines.push(`  ${url}`);
  }

  if (moreCount > 0) {
    lines.push("");
    lines.push(`(+ ${moreCount} more deal${moreCount === 1 ? "" : "s"} not shown)`);
  }

  lines.push("");
  lines.push("Unsubscribe:");
  lines.push(unsubscribeUrl);
  lines.push("");
  lines.push(
    "Affiliate disclosure: some outbound marketplace links may be affiliate links. If you buy through a link, Fast Focus may earn a commission at no extra cost to you.",
  );

  return {
    subject: `Weekly deals • Fast Focus`,
    bodyText: lines.join("\n"),
  };
}

