export function buildPremiumConfirmEmail({ baseUrl, confirmToken, cancelToken } = {}) {
  const confirmUrl = `${baseUrl}/premium/confirm?token=${encodeURIComponent(confirmToken)}`;
  const cancelUrl = `${baseUrl}/premium/cancel?token=${encodeURIComponent(cancelToken)}`;

  return {
    subject: "Confirm your Fast Focus Premium",
    bodyText: [
      "You requested Fast Focus Premium (Pro).",
      "",
      "Confirm subscription:",
      confirmUrl,
      "",
      "Cancel any time:",
      cancelUrl,
      "",
      "Affiliate disclosure: some outbound marketplace links may be affiliate links. If you buy through a link, Fast Focus may earn a commission at no extra cost to you.",
    ].join("\n"),
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

function humanizeCondition(value) {
  if (!value) return "all conditions";
  return String(value).replaceAll("_", " ");
}

export function buildPremiumTrackerAlertEmail({ baseUrl, watch, snapshot } = {}) {
  const entityKind = watch?.camera_slug ? "camera" : "lens";
  const slug = watch?.camera_slug || watch?.lens_slug || "";
  const modelUrl = entityKind === "camera" ? `${baseUrl}/cameras/${encodeURIComponent(slug)}` : `${baseUrl}/lenses/${encodeURIComponent(slug)}`;
  const historyUrl =
    entityKind === "camera"
      ? `${baseUrl}/premium/price-history/cameras/${encodeURIComponent(slug)}?currency=${encodeURIComponent(watch.currency)}`
      : `${baseUrl}/premium/price-history/lenses/${encodeURIComponent(slug)}?currency=${encodeURIComponent(watch.currency)}`;
  const metricLabel = watch?.trigger_metric === "min" ? "lowest asking price" : "median asking price";
  const metricValue = formatMoney(snapshot?.trigger_value, watch?.currency);
  const targetValue = formatMoney(watch?.target_price_amount, watch?.currency);

  return {
    subject: `Tracker alert: ${watch?.display_name || slug} | Fast Focus`,
    bodyText: [
      `Tracker alert for ${watch?.display_name || slug}.`,
      "",
      `${watch?.marketplace_display_name || watch?.marketplace_code || "Source"} ${metricLabel} is now ${metricValue || "available"} (target ${targetValue || "set"}).`,
      "",
      `Current source snapshot (${watch?.marketplace_display_name || watch?.marketplace_code || "source"}):`,
      `- observed date: ${snapshot?.observed_date_utc || "unknown"}`,
      `- sample size: ${Number(snapshot?.sample_size || 0)}`,
      `- min: ${formatMoney(snapshot?.min, watch?.currency) || "n/a"}`,
      `- median: ${formatMoney(snapshot?.median, watch?.currency) || "n/a"}`,
      `- p75: ${formatMoney(snapshot?.p75, watch?.currency) || "n/a"}`,
      `- country filter: ${watch?.country || "all"}`,
      `- condition filter: ${humanizeCondition(watch?.condition_physical_tier)}`,
      "",
      "Links:",
      modelUrl,
      `Premium price history (works if premium is enabled on this device): ${historyUrl}`,
      "",
      "Affiliate disclosure: some outbound marketplace links may be affiliate links. If you buy through a link, Fast Focus may earn a commission at no extra cost to you.",
    ].join("\n"),
  };
}
