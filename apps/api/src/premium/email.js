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

