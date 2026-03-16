import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { sendHtml, sendInternalError, sendJson, sendMethodNotAllowed, sendNotFound, sendText } from "./http.js";
import { buildAffiliateUrl } from "./affiliate.js";
import { classifyUserAgent } from "./bots/user_agent.js";
import { listContractFiles, readPostgresSchemaSql, readSchemaJson } from "./contracts.js";
import {
  getCameraBySlug,
  getBrandBySlug,
  getLensBySlug,
  listAuditLog,
  listBrands,
  listCameras,
  listLenses,
  listIngestionRuns,
  listMarketplaces,
  listListings,
  getListingById,
  parseCameraListFilters,
  parseLensListFilters,
  parseLimitOffset,
  parseListingsFilters,
} from "./db/read.js";
import {
  applyListingMatchOverride,
  createDedupeEdge,
  listDedupeEdges,
  listReviewQueue,
  parseReviewQueueFilters,
} from "./db/admin.js";
import { getBotTrafficSummary, parseWindowMinutes } from "./db/bot_monitoring.js";
import { getOpsStatus } from "./db/ops_status.js";
import { getPartnerReport, listPartners, parseWindowDays } from "./db/partners.js";
import { parsePageType, trackListingClickout } from "./db/events.js";
import { confirmSavedSearchByToken, createSavedSearch, insertEmailMessage, unsubscribeSavedSearchByToken } from "./db/alerts.js";
import { listCameraPriceHistory, listLensPriceHistory, parseHistoryWindowDays } from "./db/price_history.js";
import {
  confirmNewsletterSubscriptionByToken,
  createNewsletterSubscription,
  unsubscribeNewsletterSubscriptionByToken,
} from "./db/newsletter.js";
import {
  cancelPremiumSubscriptionByToken,
  confirmPremiumSubscriptionByToken,
  createPremiumSubscription,
  getActivePremiumSubscriptionByAccessToken,
  isPremiumEmail,
} from "./db/premium.js";
import { buildSavedSearchConfirmEmail, getEmailFrom, sendEmail } from "./alerts/email.js";
import { buildNewsletterConfirmEmail } from "./newsletter/email.js";
import { buildPremiumConfirmEmail } from "./premium/email.js";
import { getCameraModelPage, getLensModelPage, parseModelPageParams } from "./db/model_pages.js";
import { renderCameraModelPageHtml, renderErrorPageHtml, renderLensModelPageHtml, renderListingDetailPageHtml } from "./html/model_pages.js";
import { loadDigitalCameraCompareSections } from "./compare/digital_camera_compare_sections.js";
import {
  isKnownGuideTopic,
  renderAboutPageHtml,
  renderAlertConfirmResultHtml,
  renderAlertUnsubscribeResultHtml,
  renderBrandHubHtml,
  renderBrandsIndexHtml,
  renderCameraIndexHtml,
  renderCompareIndexHtml,
  renderComparePageHtml,
  renderGuidePageHtml,
  renderGuidesIndexHtml,
  renderHomePageHtml,
  renderLensIndexHtml,
  renderNewsletterConfirmResultHtml,
  renderNewsletterSignupPageHtml,
  renderNewsletterUnsubscribeResultHtml,
  renderPremiumCancelResultHtml,
  renderPremiumConfirmResultHtml,
  renderPremiumPriceHistoryPageHtml,
  renderPremiumSignupPageHtml,
  renderPrivacyPageHtml,
} from "./html/site_pages.js";

async function readJsonBody(req, { maxBytes = 256_000 } = {}) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new Error("request_body_too_large");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf-8");
  if (!text.trim()) return null;
  return JSON.parse(text);
}

async function readFormBody(req, { maxBytes = 16_000 } = {}) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw new Error("request_body_too_large");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf-8");
  const sp = new URLSearchParams(text);
  const out = {};
  for (const [k, v] of sp.entries()) out[k] = v;
  return out;
}

function parseBoolQuery(url, name, fallback) {
  const raw = url.searchParams.get(name);
  if (raw === null) return { ok: true, value: fallback };
  if (raw === "true") return { ok: true, value: true };
  if (raw === "false") return { ok: true, value: false };
  return { ok: false, value: fallback, error: `invalid_${name}` };
}

function requireAdmin(req, res, ctx) {
  if (!ctx.adminToken) {
    sendJson(res, 503, { ok: false, error: "admin_not_configured", hint: ctx.adminHint });
    return false;
  }
  const provided = req.headers["x-admin-token"];
  if (!provided || provided !== ctx.adminToken) {
    sendJson(res, 401, { ok: false, error: "unauthorized" });
    return false;
  }
  return true;
}

function requireDb(res, ctx) {
  if (ctx.dbPool) return ctx.dbPool;
  sendJson(res, 503, { ok: false, error: "db_not_configured", hint: ctx.dbHint });
  return null;
}

function requireDbHtml(res, ctx) {
  if (ctx.dbPool) return ctx.dbPool;
  sendHtml(
    res,
    503,
    renderErrorPageHtml({
      statusCode: 503,
      title: "Database not configured",
      message: ctx.dbHint,
    }),
  );
  return null;
}

function parseSingleSlug(pathname, prefix) {
  if (!pathname.startsWith(prefix)) return null;
  const parts = pathname.slice(prefix.length).split("/").filter(Boolean);
  if (parts.length !== 1) return null;
  return parts[0];
}

function parseTwoSlugs(pathname, prefix) {
  if (!pathname.startsWith(prefix)) return null;
  const parts = pathname.slice(prefix.length).split("/").filter(Boolean);
  if (parts.length !== 2) return null;
  return { first: parts[0], second: parts[1] };
}

function cameraCanonicalPath({ slug }) {
  return `/cameras/${encodeURIComponent(slug)}`;
}

function lensCanonicalPath({ slug }) {
  return `/lenses/${encodeURIComponent(slug)}`;
}

function shouldNoindexListPage({ filters, limit, offset }) {
  if (offset > 0) return true;
  if (limit !== 50) return true;
  for (const v of Object.values(filters || {})) {
    if (v !== null && v !== undefined && String(v).trim()) return true;
  }
  return false;
}

function sendRedirect(res, location, statusCode = 301) {
  res.statusCode = statusCode;
  res.setHeader("location", location);
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.end(`Redirecting to ${location}\n`);
}

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader || typeof cookieHeader !== "string") return out;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = value;
  }
  return out;
}

function appendSetCookie(res, cookie) {
  const existing = res.getHeader("set-cookie");
  if (!existing) {
    res.setHeader("set-cookie", cookie);
    return;
  }
  if (Array.isArray(existing)) {
    res.setHeader("set-cookie", [...existing, cookie]);
    return;
  }
  res.setHeader("set-cookie", [existing, cookie]);
}

function isSessionId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(value);
}

function isPremiumToken(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(value);
}

function cookieBool(value) {
  if (!value) return null;
  const v = String(value).trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "no") return false;
  return null;
}

function shouldAllowAttributionTracking(req) {
  const gpc = req.headers["sec-gpc"];
  if (gpc === "1") return { allowed: false, source: "gpc" };

  const dnt = req.headers.dnt;
  if (dnt === "1") return { allowed: false, source: "dnt" };

  const cookies = parseCookies(req.headers.cookie);
  const consent = cookieBool(cookies.ff_consent);
  if (consent === null) return { allowed: false, source: "none" };
  return { allowed: consent, source: "cookie" };
}

function getOrSetSessionId(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  const existing = cookies.ff_sid;
  if (isSessionId(existing)) return existing;

  const sid = randomBytes(16).toString("base64url");
  const maxAge = 60 * 60 * 24 * 30;
  const secure = process.env.FF_COOKIE_SECURE === "1" ? "; Secure" : "";
  appendSetCookie(res, `ff_sid=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
  return sid;
}

function getPremiumToken(req) {
  const cookies = parseCookies(req.headers.cookie);
  const existing = cookies.ff_pro;
  return isPremiumToken(existing) ? existing : null;
}

function setPremiumCookie(res, { token }) {
  if (!isPremiumToken(token)) return;
  const maxAge = 60 * 60 * 24 * 365;
  const secure = process.env.FF_COOKIE_SECURE === "1" ? "; Secure" : "";
  appendSetCookie(res, `ff_pro=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}

function clearPremiumCookie(res) {
  const secure = process.env.FF_COOKIE_SECURE === "1" ? "; Secure" : "";
  appendSetCookie(res, `ff_pro=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

async function getPremiumSubscriptionFromReq(pool, req) {
  if (!pool) return null;
  const token = getPremiumToken(req);
  if (!token) return null;
  try {
    return await getActivePremiumSubscriptionByAccessToken(pool, { accessToken: token });
  } catch {
    return null;
  }
}

function setConsentCookie(res, { analytics }) {
  const value = analytics ? "1" : "0";
  const maxAge = 60 * 60 * 24 * 180;
  const secure = process.env.FF_COOKIE_SECURE === "1" ? "; Secure" : "";
  appendSetCookie(res, `ff_consent=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}

function parseUtm(url) {
  const out = {};
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
    const v = url.searchParams.get(key);
    if (!v) continue;
    const trimmed = v.trim();
    if (!trimmed) continue;
    out[key] = trimmed.slice(0, 120);
  }
  return out;
}

function envBool(name, fallback = false) {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return fallback;
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
}

function cleanBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  return raw.endsWith("/") ? raw.replace(/\/+$/, "") : raw;
}

function parseOriginOrNull(value) {
  const cleaned = cleanBaseUrl(value);
  if (!cleaned) return null;
  try {
    return new URL(cleaned).origin;
  } catch {
    return null;
  }
}

function firstHeaderValue(value) {
  if (Array.isArray(value)) return value.length > 0 ? String(value[0] || "").trim() : "";
  if (typeof value === "string") return value.split(",")[0].trim();
  return "";
}

function resolveForwardedOriginOrNull(req) {
  if (!envBool("FF_TRUST_PROXY", false)) return null;
  const proto = firstHeaderValue(req.headers["x-forwarded-proto"]);
  const host = firstHeaderValue(req.headers["x-forwarded-host"]) || firstHeaderValue(req.headers.host);
  if (!proto || !host) return null;
  if (!/^[a-z][a-z0-9+.-]*$/i.test(proto)) return null;
  if (host.includes(" ") || host.includes("\t") || host.includes("\n") || host.includes("\r")) return null;
  return `${proto}://${host}`;
}

function resolvePublicOrigin({ req, url }) {
  const envOrigin = parseOriginOrNull(process.env.FF_PUBLIC_BASE_URL);
  if (envOrigin) return envOrigin;
  return resolveForwardedOriginOrNull(req) || url.origin;
}

export async function handleRequest(req, res, ctx) {
  try {
    const method = req.method || "GET";
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;
    const origin = resolvePublicOrigin({ req, url });

    if (method !== "GET" && method !== "POST") return sendMethodNotAllowed(res);

    if (pathname === "/consent") {
      if (method !== "GET") return sendMethodNotAllowed(res);
      const analyticsRaw = url.searchParams.get("analytics");
      const analytics = analyticsRaw === "true" || analyticsRaw === "1" || analyticsRaw === "yes";
      const deny = analyticsRaw === "false" || analyticsRaw === "0" || analyticsRaw === "no";
      if (!analyticsRaw || (!analytics && !deny)) {
        return sendJson(res, 400, {
          ok: false,
          error: "bad_request",
          message: "Expected analytics=true|false",
        });
      }

      setConsentCookie(res, { analytics });

      const returnToRaw = url.searchParams.get("return_to") || "/privacy";
      const returnTo = typeof returnToRaw === "string" && returnToRaw.startsWith("/") && !returnToRaw.startsWith("//") ? returnToRaw : "/privacy";
      return sendRedirect(res, returnTo, 302);
    }

    if (pathname === "/health") {
      if (method !== "GET") return sendMethodNotAllowed(res);
      const timeUtc = new Date().toISOString();

      if (!ctx.dbPool) {
        return sendJson(res, 200, {
          ok: true,
          service: "fastfocus_api",
          time_utc: timeUtc,
          db_enabled: false,
          db_ok: false,
        });
      }

      const startedMs = Date.now();
      try {
        await ctx.dbPool.query("SELECT 1 AS ok");
        return sendJson(res, 200, {
          ok: true,
          service: "fastfocus_api",
          time_utc: timeUtc,
          db_enabled: true,
          db_ok: true,
          db_ping_ms: Date.now() - startedMs,
        });
      } catch {
        return sendJson(res, 503, {
          ok: false,
          error: "db_unreachable",
          service: "fastfocus_api",
          time_utc: timeUtc,
          db_enabled: true,
          db_ok: false,
          db_ping_ms: Date.now() - startedMs,
        });
      }
    }

    if (pathname === "/") {
      if (method !== "GET") return sendMethodNotAllowed(res);

      const canonicalUrl = `${origin}/`;

      if (!ctx.dbPool) {
        return sendHtml(res, 200, renderHomePageHtml({ canonicalUrl, dbEnabled: false, dbHint: ctx.dbHint }));
      }

      const pool = ctx.dbPool;
      const marketplaces = await listMarketplaces(pool);
      const featuredCameras = await listCameras(pool, {
        limit: 6,
        offset: 0,
        filters: { brand: null, captureMedium: null, mount: null, q: null },
      });
      const featuredLenses = await listLenses(pool, {
        limit: 6,
        offset: 0,
        filters: { brand: null, mount: null, category: null, q: null },
      });

      return sendHtml(
        res,
        200,
        renderHomePageHtml({
          canonicalUrl,
          dbEnabled: true,
          dbHint: ctx.dbHint,
          marketplaces,
          featuredCameras,
          featuredLenses,
        }),
      );
    }

    if (pathname === "/search" || pathname === "/search/") {
      if (method !== "GET") return sendMethodNotAllowed(res);
      const type = url.searchParams.get("type");
      const q = url.searchParams.get("q");

      const scope = type === "lenses" ? "lenses" : "cameras";
      const trimmed = q && typeof q === "string" ? q.trim() : "";
      const dest = trimmed ? `/${scope}?q=${encodeURIComponent(trimmed)}` : `/${scope}`;
      return sendRedirect(res, dest, 302);
    }

    if (pathname === "/favicon.svg") {
      if (method !== "GET") return sendMethodNotAllowed(res);
      const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">\n  <rect x="8" y="8" width="112" height="112" rx="28" fill="#111827"/>\n  <path d="M36 44h56v12H48v12h36v12H48v24H36V44z" fill="#F9FAFB"/>\n</svg>\n`;
      return sendText(res, 200, svg, "image/svg+xml; charset=utf-8");
    }

    if (pathname === "/robots.txt") {
      if (method !== "GET") return sendMethodNotAllowed(res);
      const disallowAgents = String(process.env.FF_ROBOTS_DISALLOW_USER_AGENTS || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const blocks = [];
      for (const ua of disallowAgents) {
        blocks.push(`User-agent: ${ua}\nDisallow: /\n`);
      }

      blocks.push(`User-agent: *\nDisallow: /api/\nDisallow: /go/\nDisallow: /models/\n\nSitemap: ${origin}/sitemap.xml\n`);

      const robots = blocks.join("\n");
      return sendText(res, 200, robots, "text/plain; charset=utf-8");
    }

    if (pathname === "/llms.txt") {
      if (method !== "GET") return sendMethodNotAllowed(res);
      const llms = `# Fast Focus (MVP)\n\nFast Focus helps people research used cameras and lenses.\n\n## Discoverability\n- Prefer canonical URLs (no query params).\n- Use /sitemap.xml to discover indexable pages.\n\n## Canonical pages\n- /cameras/{slug}\n- /lenses/{slug}\n- /brands/{brand}\n- /compare/{modelA}-vs-{modelB}\n- /guides/{topic}\n\n## Notes\n- /go/* is an outbound tracking redirect and should not be indexed.\n- /api/v1/* provides JSON for the same entities.\n`;
      return sendText(res, 200, llms, "text/plain; charset=utf-8");
    }

    if (pathname === "/about" || pathname === "/about/") {
      if (method !== "GET") return sendMethodNotAllowed(res);
      if (pathname === "/about/") return sendRedirect(res, "/about", 301);
      const canonicalUrl = `${origin}/about`;
      return sendHtml(res, 200, renderAboutPageHtml({ canonicalUrl }));
    }

    if (pathname === "/privacy" || pathname === "/privacy/") {
      if (method !== "GET") return sendMethodNotAllowed(res);
      if (pathname === "/privacy/") return sendRedirect(res, "/privacy", 301);
      const canonicalUrl = `${origin}/privacy`;
      return sendHtml(res, 200, renderPrivacyPageHtml({ canonicalUrl }));
    }

    {
      const listingId = parseSingleSlug(pathname, "/listings/");
      if (listingId) {
        if (method !== "GET") return sendMethodNotAllowed(res);
        const pool = requireDbHtml(res, ctx);
        if (!pool) return;

        const listing = await getListingById(pool, { listingId });
        if (!listing) {
          return sendHtml(res, 404, renderErrorPageHtml({ statusCode: 404, title: "Listing not found", message: "Unknown listing id." }));
        }

        const premium = await getPremiumSubscriptionFromReq(pool, req);
        const isPremium = Boolean(premium);
        if (!isPremium && listing.deal_score_breakdown) {
          listing.deal_score_breakdown = null;
          listing.deal_score_breakdown_hidden = true;
        }

        const canonicalPath = `/listings/${encodeURIComponent(listingId)}`;
        const canonicalUrl = `${origin}${canonicalPath}`;
        const robots = url.searchParams.size > 0 ? "noindex,follow" : null;

        if (pathname !== canonicalPath && pathname !== `${canonicalPath}/`) {
          return sendRedirect(res, `${canonicalPath}${url.search}`, 301);
        }

        return sendHtml(res, 200, renderListingDetailPageHtml(listing, { canonicalUrl, robots, isPremium }));
      }
    }

    if (pathname === "/alerts/confirm" || pathname === "/alerts/confirm/") {
      if (method !== "GET") return sendMethodNotAllowed(res);
      if (pathname === "/alerts/confirm/") return sendRedirect(res, "/alerts/confirm", 301);

      const token = url.searchParams.get("token");
      if (!token) {
        return sendHtml(res, 400, renderErrorPageHtml({ statusCode: 400, title: "Missing token", message: "Expected ?token=..." }));
      }

      const pool = requireDbHtml(res, ctx);
      if (!pool) return;

      const result = await confirmSavedSearchByToken(pool, { token });
      if (!result.ok) {
        const status = result.error === "not_found" ? 404 : 400;
        const title = result.error === "unsubscribed" ? "Unsubscribed" : "Invalid token";
        return sendHtml(res, status, renderErrorPageHtml({ statusCode: status, title, message: result.error }));
      }

      const canonicalUrl = `${origin}/alerts/confirm`;
      return sendHtml(res, 200, renderAlertConfirmResultHtml({ canonicalUrl, alreadyConfirmed: result.already_confirmed }));
    }

    if (pathname === "/alerts/unsubscribe" || pathname === "/alerts/unsubscribe/") {
      if (method !== "GET") return sendMethodNotAllowed(res);
      if (pathname === "/alerts/unsubscribe/") return sendRedirect(res, "/alerts/unsubscribe", 301);

      const token = url.searchParams.get("token");
      if (!token) {
        return sendHtml(res, 400, renderErrorPageHtml({ statusCode: 400, title: "Missing token", message: "Expected ?token=..." }));
      }

      const pool = requireDbHtml(res, ctx);
      if (!pool) return;

      const result = await unsubscribeSavedSearchByToken(pool, { token });
      if (!result.ok) {
        const status = result.error === "not_found" ? 404 : 400;
        return sendHtml(res, status, renderErrorPageHtml({ statusCode: status, title: "Invalid token", message: result.error }));
      }

      const canonicalUrl = `${origin}/alerts/unsubscribe`;
      return sendHtml(res, 200, renderAlertUnsubscribeResultHtml({ canonicalUrl }));
    }

    if (pathname === "/newsletter" || pathname === "/newsletter/") {
      if (pathname === "/newsletter/") return sendRedirect(res, "/newsletter", 301);

      const canonicalUrl = `${origin}/newsletter`;

      if (method === "GET") {
        return sendHtml(res, 200, renderNewsletterSignupPageHtml({ canonicalUrl }));
      }

      if (method !== "POST") return sendMethodNotAllowed(res);
      const pool = requireDbHtml(res, ctx);
      if (!pool) return;

      let form;
      try {
        form = await readFormBody(req);
      } catch (err) {
        return sendHtml(
          res,
          400,
          renderNewsletterSignupPageHtml({ canonicalUrl, error: err instanceof Error ? err.message : "bad_request" }),
        );
      }

      const email = form.email || "";
      const segment = form.segment || "all";

      const result = await createNewsletterSubscription(pool, { email, segment });
      if (!result.ok) {
        return sendHtml(res, 400, renderNewsletterSignupPageHtml({ canonicalUrl, error: result.error }));
      }

      const sub = result.newsletter_subscription;
      const seg = Array.isArray(sub.segments) && sub.segments.length > 0 ? String(sub.segments[0]) : null;

      if (result.status !== "already_confirmed") {
        const baseUrl = origin;

        const emailMsg = buildNewsletterConfirmEmail({
          baseUrl,
          confirmToken: sub.confirm_token,
          unsubscribeToken: sub.unsubscribe_token,
          segment: seg,
        });

        const send = sendEmail({ to: sub.email, subject: emailMsg.subject, bodyText: emailMsg.bodyText });
        const fromEmail = getEmailFrom();

        await insertEmailMessage(pool, {
          message_type: "newsletter_confirm",
          newsletter_subscription_id: sub.newsletter_subscription_id,
          to_email: sub.email,
          from_email: fromEmail,
          subject: emailMsg.subject,
          body_text: emailMsg.bodyText,
          status: send.ok ? send.status : "failed",
          provider: send.ok ? send.provider : send.provider || "unknown",
          provider_message_id: send.ok ? send.provider_message_id : null,
          error: send.ok ? null : send.error || "send_failed",
          sent_at: send.ok ? new Date().toISOString() : null,
        });
      }

      const status =
        result.status === "already_confirmed"
          ? "You are already subscribed."
          : "Check your email to confirm your subscription.";

      return sendHtml(res, 200, renderNewsletterSignupPageHtml({ canonicalUrl, status }));
    }

    if (pathname === "/newsletter/confirm" || pathname === "/newsletter/confirm/") {
      if (method !== "GET") return sendMethodNotAllowed(res);
      if (pathname === "/newsletter/confirm/") return sendRedirect(res, "/newsletter/confirm", 301);

      const token = url.searchParams.get("token");
      if (!token) {
        return sendHtml(res, 400, renderErrorPageHtml({ statusCode: 400, title: "Missing token", message: "Expected ?token=..." }));
      }

      const pool = requireDbHtml(res, ctx);
      if (!pool) return;

      const result = await confirmNewsletterSubscriptionByToken(pool, { token });
      if (!result.ok) {
        const status = result.error === "not_found" ? 404 : 400;
        return sendHtml(res, status, renderErrorPageHtml({ statusCode: status, title: "Invalid token", message: result.error }));
      }

      const canonicalUrl = `${origin}/newsletter/confirm`;
      return sendHtml(res, 200, renderNewsletterConfirmResultHtml({ canonicalUrl, alreadyConfirmed: result.already_confirmed }));
    }

    if (pathname === "/newsletter/unsubscribe" || pathname === "/newsletter/unsubscribe/") {
      if (method !== "GET") return sendMethodNotAllowed(res);
      if (pathname === "/newsletter/unsubscribe/") return sendRedirect(res, "/newsletter/unsubscribe", 301);

      const token = url.searchParams.get("token");
      if (!token) {
        return sendHtml(res, 400, renderErrorPageHtml({ statusCode: 400, title: "Missing token", message: "Expected ?token=..." }));
      }

      const pool = requireDbHtml(res, ctx);
      if (!pool) return;

      const result = await unsubscribeNewsletterSubscriptionByToken(pool, { token });
      if (!result.ok) {
        const status = result.error === "not_found" ? 404 : 400;
        return sendHtml(res, status, renderErrorPageHtml({ statusCode: status, title: "Invalid token", message: result.error }));
      }

      const canonicalUrl = `${origin}/newsletter/unsubscribe`;
      return sendHtml(res, 200, renderNewsletterUnsubscribeResultHtml({ canonicalUrl }));
    }

    if (pathname === "/premium" || pathname === "/premium/") {
      if (pathname === "/premium/") return sendRedirect(res, "/premium", 301);

      const canonicalUrl = `${origin}/premium`;

      if (method === "GET") {
        return sendHtml(res, 200, renderPremiumSignupPageHtml({ canonicalUrl }));
      }

      if (method !== "POST") return sendMethodNotAllowed(res);
      const pool = requireDbHtml(res, ctx);
      if (!pool) return;

      let form;
      try {
        form = await readFormBody(req);
      } catch (err) {
        return sendHtml(
          res,
          400,
          renderPremiumSignupPageHtml({ canonicalUrl, error: err instanceof Error ? err.message : "bad_request" }),
        );
      }

      const email = form.email || "";

      const result = await createPremiumSubscription(pool, { email, plan_code: "pro" });
      if (!result.ok) return sendHtml(res, 400, renderPremiumSignupPageHtml({ canonicalUrl, error: result.error }));

      const sub = result.premium_subscription;

      if (result.status !== "already_active") {
        const baseUrl = origin;

        const emailMsg = buildPremiumConfirmEmail({
          baseUrl,
          confirmToken: sub.confirm_token,
          cancelToken: sub.cancel_token,
        });

        const send = sendEmail({ to: sub.email, subject: emailMsg.subject, bodyText: emailMsg.bodyText });
        const fromEmail = getEmailFrom();

        await insertEmailMessage(pool, {
          message_type: "premium_confirm",
          premium_subscription_id: sub.premium_subscription_id,
          to_email: sub.email,
          from_email: fromEmail,
          subject: emailMsg.subject,
          body_text: emailMsg.bodyText,
          status: send.ok ? send.status : "failed",
          provider: send.ok ? send.provider : send.provider || "unknown",
          provider_message_id: send.ok ? send.provider_message_id : null,
          error: send.ok ? null : send.error || "send_failed",
          sent_at: send.ok ? new Date().toISOString() : null,
        });
      }

      const status =
        result.status === "already_active"
          ? "Premium is already active for this email."
          : "Check your email to confirm premium.";

      return sendHtml(res, 200, renderPremiumSignupPageHtml({ canonicalUrl, status }));
    }

    if (pathname === "/premium/confirm" || pathname === "/premium/confirm/") {
      if (method !== "GET") return sendMethodNotAllowed(res);
      if (pathname === "/premium/confirm/") return sendRedirect(res, "/premium/confirm", 301);

      const token = url.searchParams.get("token");
      if (!token) {
        return sendHtml(res, 400, renderErrorPageHtml({ statusCode: 400, title: "Missing token", message: "Expected ?token=..." }));
      }

      const pool = requireDbHtml(res, ctx);
      if (!pool) return;

      const result = await confirmPremiumSubscriptionByToken(pool, { token });
      if (!result.ok) {
        const status = result.error === "not_found" ? 404 : 400;
        const title = result.error === "canceled" ? "Canceled" : "Invalid token";
        return sendHtml(res, status, renderErrorPageHtml({ statusCode: status, title, message: result.error }));
      }

      setPremiumCookie(res, { token: result.premium_subscription.access_token });

      const canonicalUrl = `${origin}/premium/confirm`;
      return sendHtml(res, 200, renderPremiumConfirmResultHtml({ canonicalUrl, alreadyConfirmed: result.already_confirmed }));
    }

    if (pathname === "/premium/cancel" || pathname === "/premium/cancel/") {
      if (method !== "GET") return sendMethodNotAllowed(res);
      if (pathname === "/premium/cancel/") return sendRedirect(res, "/premium/cancel", 301);

      const token = url.searchParams.get("token");
      if (!token) {
        return sendHtml(res, 400, renderErrorPageHtml({ statusCode: 400, title: "Missing token", message: "Expected ?token=..." }));
      }

      const pool = requireDbHtml(res, ctx);
      if (!pool) return;

      const result = await cancelPremiumSubscriptionByToken(pool, { token });
      if (!result.ok) {
        const status = result.error === "not_found" ? 404 : 400;
        return sendHtml(res, status, renderErrorPageHtml({ statusCode: status, title: "Invalid token", message: result.error }));
      }

      clearPremiumCookie(res);

      const canonicalUrl = `${origin}/premium/cancel`;
      return sendHtml(res, 200, renderPremiumCancelResultHtml({ canonicalUrl, alreadyCanceled: result.already_canceled }));
    }

    {
      const slug = parseSingleSlug(pathname, "/premium/price-history/cameras/");
      if (slug) {
        if (method !== "GET") return sendMethodNotAllowed(res);
        const pool = requireDbHtml(res, ctx);
        if (!pool) return;

        const premium = await getPremiumSubscriptionFromReq(pool, req);
        if (!premium) {
          const canonicalUrl = `${origin}/premium`;
          return sendHtml(res, 403, renderPremiumSignupPageHtml({ canonicalUrl, status: "Premium is required for price history." }));
        }

        const camera = await getCameraBySlug(pool, { slug });
        if (!camera) return sendNotFound(res);

        const params = parseModelPageParams(url);
        const windowDays = parseHistoryWindowDays(url, 180);
        const hist = await listCameraPriceHistory(pool, {
          cameraId: camera.camera_id,
          currency: params.currency,
          country: params.country,
          condition_physical_tier: params.condition_physical_tier,
          windowDays,
        });

        const canonicalUrl = `${origin}/premium/price-history/cameras/${encodeURIComponent(slug)}`;
        return sendHtml(res, 200, renderPremiumPriceHistoryPageHtml({ canonicalUrl, kind: "camera", model: camera, series: hist.rows, filters: params }));
      }
    }

    {
      const slug = parseSingleSlug(pathname, "/premium/price-history/lenses/");
      if (slug) {
        if (method !== "GET") return sendMethodNotAllowed(res);
        const pool = requireDbHtml(res, ctx);
        if (!pool) return;

        const premium = await getPremiumSubscriptionFromReq(pool, req);
        if (!premium) {
          const canonicalUrl = `${origin}/premium`;
          return sendHtml(res, 403, renderPremiumSignupPageHtml({ canonicalUrl, status: "Premium is required for price history." }));
        }

        const lens = await getLensBySlug(pool, { slug });
        if (!lens) return sendNotFound(res);

        const params = parseModelPageParams(url);
        const windowDays = parseHistoryWindowDays(url, 180);
        const hist = await listLensPriceHistory(pool, {
          lensId: lens.lens_id,
          currency: params.currency,
          country: params.country,
          condition_physical_tier: params.condition_physical_tier,
          windowDays,
        });

        const canonicalUrl = `${origin}/premium/price-history/lenses/${encodeURIComponent(slug)}`;
        return sendHtml(res, 200, renderPremiumPriceHistoryPageHtml({ canonicalUrl, kind: "lens", model: lens, series: hist.rows, filters: params }));
      }
    }

    {
      const listingId = parseSingleSlug(pathname, "/go/listings/");
      if (listingId) {
        if (method !== "GET") return sendMethodNotAllowed(res);
        const pool = requireDbHtml(res, ctx);
        if (!pool) return;

        const listing = await getListingById(pool, { listingId });
        if (!listing) {
          return sendHtml(res, 404, renderErrorPageHtml({ statusCode: 404, title: "Listing not found", message: "Unknown listing id." }));
        }

        const tracking = shouldAllowAttributionTracking(req);
        const sessionId = tracking.allowed ? getOrSetSessionId(req, res) : null;
        const pageType = parsePageType(url.searchParams.get("page_type"), "other");
        const userAgent = typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null;
        const referrer = typeof req.headers.referer === "string" ? req.headers.referer : null;
        const ua = classifyUserAgent(userAgent);

        const affiliate = buildAffiliateUrl({
          marketplaceCode: listing.marketplace_code,
          originalUrl: listing.url,
          listingId,
          sessionId,
          paramsString: listing.marketplace_affiliate_params_template,
        });

        let destHost = null;
        let destProtocol = null;
        try {
          const u = new URL(affiliate.url);
          destHost = u.host;
          destProtocol = u.protocol;
        } catch {
          // ignore
        }

        if (destProtocol && !["http:", "https:"].includes(destProtocol)) {
          return sendHtml(res, 400, renderErrorPageHtml({ statusCode: 400, title: "Bad destination", message: "Unsupported redirect protocol." }));
        }

        if (tracking.allowed && sessionId) {
          try {
            await trackListingClickout(pool, {
              sessionId,
              pageType,
              path: pathname,
              listingId,
              cameraId: listing.camera_id || null,
              lensId: listing.lens_id || null,
              referrer,
              userAgent,
              isBot: ua.is_bot,
              botName: ua.bot_name,
              utm: parseUtm(url),
              properties: {
                marketplace_code: listing.marketplace_code,
                destination_host: destHost,
                affiliate_applied: affiliate.applied,
                affiliate_params: affiliate.applied_params,
                consent: tracking.source,
                bot_kind: ua.bot_kind,
              },
            });
          } catch {
            // do not block redirect on analytics failure
          }
        }

        return sendRedirect(res, affiliate.url, 302);
      }
    }

    {
      const slug = parseSingleSlug(pathname, "/models/cameras/");
      if (slug) return sendRedirect(res, `/cameras/${encodeURIComponent(slug)}`);
    }

    {
      const slug = parseSingleSlug(pathname, "/models/lenses/");
      if (slug) return sendRedirect(res, `/lenses/${encodeURIComponent(slug)}`);
    }

    {
      if (pathname === "/sitemap.xml") {
        if (method !== "GET") return sendMethodNotAllowed(res);
        if (!ctx.dbPool) return sendText(res, 503, "Database not configured.\n");

        const pool = ctx.dbPool;

        const escapeXml = (value) =>
          String(value)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&apos;");

        const cameraRows = await pool.query(
          `
          SELECT cm.slug, b.slug AS brand_slug
          FROM camera_models cm
          JOIN brands b ON b.brand_id = cm.brand_id
          ORDER BY cm.slug ASC
          `,
        );
        const lensRows = await pool.query(
          `
          SELECT lm.slug, b.slug AS brand_slug
          FROM lens_models lm
          JOIN brands b ON b.brand_id = lm.brand_id
          ORDER BY lm.slug ASC
          `,
        );

        const staticPaths = ["/", "/cameras", "/lenses", "/brands", "/compare", "/guides", "/about", "/privacy"];
        const guidePaths = ["/guides/how-to-buy-used-camera", "/guides/how-to-check-lens-condition"];

        const brandRows = await pool.query(
          `
          SELECT slug
          FROM brands
          ORDER BY slug ASC
          `,
        );
        const brandPaths = brandRows.rows.map((r) => `/brands/${encodeURIComponent(r.slug)}`);

        const cameraPaths = cameraRows.rows.map((r) => cameraCanonicalPath({ slug: r.slug }));
        const lensPaths = lensRows.rows.map((r) => lensCanonicalPath({ slug: r.slug }));

        const urls = [...staticPaths, ...guidePaths, ...brandPaths, ...cameraPaths, ...lensPaths]
          .map((p) => `<url><loc>${escapeXml(`${origin}${p}`)}</loc></url>`)
          .join("");

        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>\n`;
        return sendText(res, 200, xml, "application/xml; charset=utf-8");
      }
    }

    if (pathname === "/cameras" || pathname === "/cameras/") {
      if (method !== "GET") return sendMethodNotAllowed(res);
      const pool = requireDbHtml(res, ctx);
      if (!pool) return;

      const { limit, offset } = parseLimitOffset(url);
      const filters = parseCameraListFilters(url);
      const brands = await listBrands(pool, { limit: 200, offset: 0 });
      const cameras = await listCameras(pool, { limit, offset, filters });

      const canonicalUrl = `${origin}/cameras`;
      const robots = shouldNoindexListPage({ filters, limit, offset }) ? "noindex,follow" : null;

      return sendHtml(res, 200, renderCameraIndexHtml({ canonicalUrl, robots, filters, brands, cameras, page: { limit, offset } }));
    }

    if (pathname === "/lenses" || pathname === "/lenses/") {
      if (method !== "GET") return sendMethodNotAllowed(res);
      const pool = requireDbHtml(res, ctx);
      if (!pool) return;

      const { limit, offset } = parseLimitOffset(url);
      const filters = parseLensListFilters(url);
      const brands = await listBrands(pool, { limit: 200, offset: 0 });
      const lenses = await listLenses(pool, { limit, offset, filters });

      const canonicalUrl = `${origin}/lenses`;
      const robots = shouldNoindexListPage({ filters, limit, offset }) ? "noindex,follow" : null;

      return sendHtml(res, 200, renderLensIndexHtml({ canonicalUrl, robots, filters, brands, lenses, page: { limit, offset } }));
    }

    if (pathname === "/brands" || pathname === "/brands/") {
      if (method !== "GET") return sendMethodNotAllowed(res);
      const pool = requireDbHtml(res, ctx);
      if (!pool) return;

      const brands = await listBrands(pool, { limit: 200, offset: 0 });
      const canonicalUrl = `${origin}/brands`;
      return sendHtml(res, 200, renderBrandsIndexHtml({ canonicalUrl, brands }));
    }

    {
      const brandSlug = parseSingleSlug(pathname, "/brands/");
      if (brandSlug) {
        if (method !== "GET") return sendMethodNotAllowed(res);
        const pool = requireDbHtml(res, ctx);
        if (!pool) return;

        const decodedSlug = decodeURIComponent(brandSlug);
        const brand = await getBrandBySlug(pool, { slug: decodedSlug });
        if (!brand) return sendHtml(res, 404, renderErrorPageHtml({ statusCode: 404, title: "Brand not found", message: "Unknown brand slug." }));

        const qRaw = url.searchParams.get("q");
        const q = qRaw && typeof qRaw === "string" && qRaw.trim().length <= 80 ? qRaw.trim() : "";

        const cameras = await listCameras(pool, {
          limit: 200,
          offset: 0,
          filters: { brand: brand.slug, captureMedium: null, mount: null, q: q || null },
        });
        const lenses = await listLenses(pool, {
          limit: 200,
          offset: 0,
          filters: { brand: brand.slug, mount: null, category: null, q: q || null },
        });

        const canonicalPath = `/brands/${encodeURIComponent(brand.slug)}`;
        if (pathname !== canonicalPath && pathname !== `${canonicalPath}/`) {
          return sendRedirect(res, `${canonicalPath}${url.search}`, 301);
        }

        const canonicalUrl = `${origin}${canonicalPath}`;
        const robots = url.searchParams.size > 0 ? "noindex,follow" : null;
        return sendHtml(res, 200, renderBrandHubHtml({ canonicalUrl, robots, brand, cameras, lenses, q }));
      }
    }

    if (pathname === "/compare" || pathname === "/compare/") {
      if (method !== "GET") return sendMethodNotAllowed(res);
      const a = url.searchParams.get("a");
      const b = url.searchParams.get("b");
      if (a && b && a.trim() && b.trim()) {
        const rawCurrency = url.searchParams.get("currency");
        const safeCurrency = rawCurrency && /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : null;
        const qs = safeCurrency && safeCurrency !== "EUR" ? `?currency=${encodeURIComponent(safeCurrency)}` : "";
        return sendRedirect(res, `/compare/${encodeURIComponent(a.trim())}-vs-${encodeURIComponent(b.trim())}${qs}`, 302);
      }
      const canonicalUrl = `${origin}/compare`;
      const rawCurrency = url.searchParams.get("currency");
      const safeCurrency = rawCurrency && /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : "EUR";

      let cameras = [];
      if (ctx.dbPool) {
        cameras = await listCameras(ctx.dbPool, {
          limit: 200,
          offset: 0,
          filters: { brand: null, captureMedium: null, mount: null, q: null },
        });
      }

      return sendHtml(res, 200, renderCompareIndexHtml({ canonicalUrl, cameras, currency: safeCurrency }));
    }

    {
      const compare = parseSingleSlug(pathname, "/compare/");
      if (compare) {
        if (method !== "GET") return sendMethodNotAllowed(res);
        const decoded = decodeURIComponent(compare);
        const parts = decoded.split("-vs-");
        if (parts.length !== 2) {
          return sendHtml(res, 404, renderErrorPageHtml({ statusCode: 404, title: "Bad compare URL", message: "Expected {modelA}-vs-{modelB}." }));
        }
        const [slugA, slugB] = parts;

        const pool = requireDbHtml(res, ctx);
        if (!pool) return;

        const params = parseModelPageParams(url);

        const cameraA = await getCameraBySlug(pool, { slug: slugA });
        const cameraB = await getCameraBySlug(pool, { slug: slugB });
        if (!cameraA || !cameraB) {
          return sendHtml(res, 404, renderErrorPageHtml({ statusCode: 404, title: "Model not found", message: "Unknown camera slug in compare URL." }));
        }

        const canonicalPath = `/compare/${encodeURIComponent(cameraA.slug)}-vs-${encodeURIComponent(cameraB.slug)}`;
        if (pathname !== canonicalPath && pathname !== `${canonicalPath}/`) {
          return sendRedirect(res, `${canonicalPath}${url.search}`, 301);
        }

        const canonicalUrl = `${origin}${canonicalPath}`;
        const robots = url.searchParams.size > 0 ? "noindex,follow" : null;

        const pageA = await getCameraModelPage(pool, { slug: cameraA.slug, ...params });
        const pageB = await getCameraModelPage(pool, { slug: cameraB.slug, ...params });

        const comparisonSections = await loadDigitalCameraCompareSections();

        return sendHtml(
          res,
          200,
          renderComparePageHtml({
            canonicalUrl,
            robots,
            cameraA,
            cameraB,
            priceBandA: pageA?.price_band || null,
            priceBandB: pageB?.price_band || null,
            currency: params.currency,
            comparisonSections,
          }),
        );
      }
    }

    if (pathname === "/guides" || pathname === "/guides/") {
      if (method !== "GET") return sendMethodNotAllowed(res);
      const canonicalUrl = `${origin}/guides`;
      return sendHtml(res, 200, renderGuidesIndexHtml({ canonicalUrl }));
    }

    {
      const topic = parseSingleSlug(pathname, "/guides/");
      if (topic) {
        if (method !== "GET") return sendMethodNotAllowed(res);
        const decoded = decodeURIComponent(topic);
        if (!isKnownGuideTopic(decoded)) {
          return sendHtml(res, 404, renderErrorPageHtml({ statusCode: 404, title: "Guide not found", message: "Unknown guide topic." }));
        }
        const canonicalPath = `/guides/${encodeURIComponent(decoded)}`;
        if (pathname !== canonicalPath && pathname !== `${canonicalPath}/`) {
          return sendRedirect(res, `${canonicalPath}${url.search}`, 301);
        }
        const canonicalUrl = `${origin}${canonicalPath}`;
        return sendHtml(res, 200, renderGuidePageHtml({ canonicalUrl, topic: decoded }));
      }
    }

    {
      const parsed = parseTwoSlugs(pathname, "/cameras/");
      if (parsed) {
        if (method !== "GET") return sendMethodNotAllowed(res);
        const pool = requireDbHtml(res, ctx);
        if (!pool) return;

        const brandSlug = decodeURIComponent(parsed.first);
        const modelSeg = decodeURIComponent(parsed.second);

        const params = parseModelPageParams(url);
        const candidate1 = modelSeg.startsWith(`${brandSlug}-`) ? modelSeg : `${brandSlug}-${modelSeg}`;

        let page = await getCameraModelPage(pool, {
          slug: candidate1,
          currency: params.currency,
          country: params.country,
          condition_physical_tier: params.condition_physical_tier,
        });
        if (!page && candidate1 !== modelSeg) {
          page = await getCameraModelPage(pool, {
            slug: modelSeg,
            currency: params.currency,
            country: params.country,
            condition_physical_tier: params.condition_physical_tier,
          });
        }
        if (!page) {
          return sendHtml(res, 404, renderErrorPageHtml({ statusCode: 404, title: "Camera not found", message: "Unknown camera model slug." }));
        }

        const canonicalPath = cameraCanonicalPath({ slug: page.camera.slug });
        const canonicalUrl = `${origin}${canonicalPath}`;
        const robots = url.searchParams.size > 0 ? "noindex,follow" : null;

        if (pathname !== canonicalPath && pathname !== `${canonicalPath}/`) {
          return sendRedirect(res, `${canonicalPath}${url.search}`, 301);
        }

        return sendHtml(res, 200, renderCameraModelPageHtml(page, { currency: params.currency, canonicalUrl, robots }));
      }
    }

    {
      const slug = parseSingleSlug(pathname, "/cameras/");
      if (slug) {
        if (method !== "GET") return sendMethodNotAllowed(res);
        const pool = requireDbHtml(res, ctx);
        if (!pool) return;

        const decodedSlug = decodeURIComponent(slug);
        const params = parseModelPageParams(url);
        const page = await getCameraModelPage(pool, {
          slug: decodedSlug,
          currency: params.currency,
          country: params.country,
          condition_physical_tier: params.condition_physical_tier,
        });
        if (!page) {
          return sendHtml(res, 404, renderErrorPageHtml({ statusCode: 404, title: "Camera not found", message: "Unknown camera model slug." }));
        }

        const canonicalPath = cameraCanonicalPath({ slug: page.camera.slug });
        const canonicalUrl = `${origin}${canonicalPath}`;
        const robots = url.searchParams.size > 0 ? "noindex,follow" : null;

        if (pathname !== canonicalPath && pathname !== `${canonicalPath}/`) {
          return sendRedirect(res, `${canonicalPath}${url.search}`, 301);
        }

        return sendHtml(res, 200, renderCameraModelPageHtml(page, { currency: params.currency, canonicalUrl, robots }));
      }
    }

    {
      const parsed = parseTwoSlugs(pathname, "/lenses/");
      if (parsed) {
        if (method !== "GET") return sendMethodNotAllowed(res);
        const pool = requireDbHtml(res, ctx);
        if (!pool) return;

        const brandSlug = decodeURIComponent(parsed.first);
        const modelSeg = decodeURIComponent(parsed.second);

        const params = parseModelPageParams(url);
        const candidate1 = modelSeg.startsWith(`${brandSlug}-`) ? modelSeg : `${brandSlug}-${modelSeg}`;

        let page = await getLensModelPage(pool, {
          slug: candidate1,
          currency: params.currency,
          country: params.country,
          condition_physical_tier: params.condition_physical_tier,
        });
        if (!page && candidate1 !== modelSeg) {
          page = await getLensModelPage(pool, {
            slug: modelSeg,
            currency: params.currency,
            country: params.country,
            condition_physical_tier: params.condition_physical_tier,
          });
        }
        if (!page) {
          return sendHtml(res, 404, renderErrorPageHtml({ statusCode: 404, title: "Lens not found", message: "Unknown lens model slug." }));
        }

        const canonicalPath = lensCanonicalPath({ slug: page.lens.slug });
        const canonicalUrl = `${origin}${canonicalPath}`;
        const robots = url.searchParams.size > 0 ? "noindex,follow" : null;

        if (pathname !== canonicalPath && pathname !== `${canonicalPath}/`) {
          return sendRedirect(res, `${canonicalPath}${url.search}`, 301);
        }

        return sendHtml(res, 200, renderLensModelPageHtml(page, { currency: params.currency, canonicalUrl, robots }));
      }
    }

    {
      const slug = parseSingleSlug(pathname, "/lenses/");
      if (slug) {
        if (method !== "GET") return sendMethodNotAllowed(res);
        const pool = requireDbHtml(res, ctx);
        if (!pool) return;

        const decodedSlug = decodeURIComponent(slug);
        const params = parseModelPageParams(url);
        const page = await getLensModelPage(pool, {
          slug: decodedSlug,
          currency: params.currency,
          country: params.country,
          condition_physical_tier: params.condition_physical_tier,
        });
        if (!page) {
          return sendHtml(res, 404, renderErrorPageHtml({ statusCode: 404, title: "Lens not found", message: "Unknown lens model slug." }));
        }

        const canonicalPath = lensCanonicalPath({ slug: page.lens.slug });
        const canonicalUrl = `${origin}${canonicalPath}`;
        const robots = url.searchParams.size > 0 ? "noindex,follow" : null;

        if (pathname !== canonicalPath && pathname !== `${canonicalPath}/`) {
          return sendRedirect(res, `${canonicalPath}${url.search}`, 301);
        }

        return sendHtml(res, 200, renderLensModelPageHtml(page, { currency: params.currency, canonicalUrl, robots }));
      }
    }

    if (pathname === "/api/v1/contracts" || pathname === "/api/v1/contracts/") {
      if (method !== "GET") return sendMethodNotAllowed(res);
      const { schemaFiles } = await listContractFiles(ctx.contractsRoot);
      return sendJson(res, 200, {
        ok: true,
        contracts_root: ctx.contractsRootHint,
        schemas: schemaFiles,
        endpoints: {
          schemas: "/api/v1/contracts/schemas",
          postgres_schema_sql: "/api/v1/contracts/postgres_schema.sql",
        },
      });
    }

    if (pathname === "/api/v1/contracts/schemas" || pathname === "/api/v1/contracts/schemas/") {
      if (method !== "GET") return sendMethodNotAllowed(res);
      const { schemaFiles } = await listContractFiles(ctx.contractsRoot);
      return sendJson(res, 200, { ok: true, schemas: schemaFiles });
    }

    if (pathname.startsWith("/api/v1/contracts/schemas/")) {
      if (method !== "GET") return sendMethodNotAllowed(res);
      const schemaFile = pathname.slice("/api/v1/contracts/schemas/".length);
      const schema = await readSchemaJson(ctx.contractsRoot, schemaFile);
      if (!schema) return sendNotFound(res);
      return sendJson(res, 200, { ok: true, schema_file: schemaFile, schema });
    }

    if (pathname === "/api/v1/contracts/postgres_schema.sql") {
      if (method !== "GET") return sendMethodNotAllowed(res);
      const sql = await readPostgresSchemaSql(ctx.contractsRoot);
      if (!sql) return sendNotFound(res);
      return sendText(res, 200, sql, "text/plain; charset=utf-8");
    }

    if (pathname === "/api/v1/spec/current") {
      if (method !== "GET") return sendMethodNotAllowed(res);
      const md = await readFile(ctx.specCurrentPath, "utf-8");
      return sendJson(res, 200, {
        ok: true,
        spec_current_path: ctx.specCurrentPathHint,
        spec_current_md: md,
      });
    }

    if (pathname === "/api/v1/saved-searches" || pathname === "/api/v1/saved-searches/") {
      if (method !== "POST") return sendMethodNotAllowed(res);
      const pool = requireDb(res, ctx);
      if (!pool) return;

      let body;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        return sendJson(res, 400, {
          ok: false,
          error: "bad_request",
          message: err instanceof Error ? err.message : String(err),
        });
      }

      if (!body || typeof body !== "object") return sendJson(res, 400, { ok: false, error: "bad_request" });

      const emailRaw = body.email;
      const premium = await isPremiumEmail(pool, { email: emailRaw });

      const freeLimits = { maxSavedSearches: 5, minIntervalHours: 24, maxResultsPerEmail: 10 };
      const proLimits = { maxSavedSearches: 50, minIntervalHours: 1, maxResultsPerEmail: 50 };
      const limits = premium ? proLimits : freeLimits;

      if (!premium) {
        const requestedMinInterval = body.min_interval_hours;
        const requestedMaxResults = body.max_results_per_email;

        if (requestedMinInterval !== undefined && requestedMinInterval !== null) {
          const n = Number(requestedMinInterval);
          if (Number.isFinite(n) && n < freeLimits.minIntervalHours) {
            return sendJson(res, 403, {
              ok: false,
              error: "premium_required",
              message: `min_interval_hours < ${freeLimits.minIntervalHours} requires Premium.`,
            });
          }
        }

        if (requestedMaxResults !== undefined && requestedMaxResults !== null) {
          const n = Number(requestedMaxResults);
          if (Number.isFinite(n) && n > freeLimits.maxResultsPerEmail) {
            return sendJson(res, 403, {
              ok: false,
              error: "premium_required",
              message: `max_results_per_email > ${freeLimits.maxResultsPerEmail} requires Premium.`,
            });
          }
        }
      }

      const safeBody = {
        email: emailRaw,
        camera_slug: body.camera_slug ?? null,
        lens_slug: body.lens_slug ?? null,
        marketplace: body.marketplace ?? null,
        country: body.country ?? null,
        currency: body.currency ?? null,
        max_total_price_amount: body.max_total_price_amount ?? null,
        max_total_price_currency: body.max_total_price_currency ?? null,
        min_interval_hours: body.min_interval_hours ?? limits.minIntervalHours,
        max_results_per_email: body.max_results_per_email ?? limits.maxResultsPerEmail,
        max_saved_searches_per_email: limits.maxSavedSearches,
      };

      const result = await createSavedSearch(pool, safeBody);
      if (!result.ok) return sendJson(res, 400, { ok: false, error: result.error });

      const savedSearch = result.saved_search;

      const baseUrl = origin;

      const email = buildSavedSearchConfirmEmail({
        baseUrl,
        confirmToken: savedSearch.confirm_token,
        unsubscribeToken: savedSearch.unsubscribe_token,
      });

      const send = sendEmail({ to: savedSearch.email, subject: email.subject, bodyText: email.bodyText });
      const fromEmail = getEmailFrom();

      await insertEmailMessage(pool, {
        message_type: "saved_search_confirm",
        saved_search_id: savedSearch.saved_search_id,
        to_email: savedSearch.email,
        from_email: fromEmail,
        subject: email.subject,
        body_text: email.bodyText,
        status: send.ok ? send.status : "failed",
        provider: send.ok ? send.provider : send.provider || "unknown",
        provider_message_id: send.ok ? send.provider_message_id : null,
        error: send.ok ? null : send.error || "send_failed",
        sent_at: send.ok ? new Date().toISOString() : null,
      });

      return sendJson(res, 201, {
        ok: true,
        saved_search_id: savedSearch.saved_search_id,
        status: "confirmation_required",
        message: "Check your email to confirm alerts.",
      });
    }

    if (pathname === "/api/v1/newsletter/subscriptions" || pathname === "/api/v1/newsletter/subscriptions/") {
      if (method !== "POST") return sendMethodNotAllowed(res);
      const pool = requireDb(res, ctx);
      if (!pool) return;

      let body;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        return sendJson(res, 400, {
          ok: false,
          error: "bad_request",
          message: err instanceof Error ? err.message : String(err),
        });
      }

      if (!body || typeof body !== "object") return sendJson(res, 400, { ok: false, error: "bad_request" });

      const result = await createNewsletterSubscription(pool, body);
      if (!result.ok) return sendJson(res, 400, { ok: false, error: result.error });

      const sub = result.newsletter_subscription;
      const seg = Array.isArray(sub.segments) && sub.segments.length > 0 ? String(sub.segments[0]) : null;

      if (result.status !== "already_confirmed") {
        const baseUrl = origin;

        const emailMsg = buildNewsletterConfirmEmail({
          baseUrl,
          confirmToken: sub.confirm_token,
          unsubscribeToken: sub.unsubscribe_token,
          segment: seg,
        });

        const send = sendEmail({ to: sub.email, subject: emailMsg.subject, bodyText: emailMsg.bodyText });
        const fromEmail = getEmailFrom();

        await insertEmailMessage(pool, {
          message_type: "newsletter_confirm",
          newsletter_subscription_id: sub.newsletter_subscription_id,
          to_email: sub.email,
          from_email: fromEmail,
          subject: emailMsg.subject,
          body_text: emailMsg.bodyText,
          status: send.ok ? send.status : "failed",
          provider: send.ok ? send.provider : send.provider || "unknown",
          provider_message_id: send.ok ? send.provider_message_id : null,
          error: send.ok ? null : send.error || "send_failed",
          sent_at: send.ok ? new Date().toISOString() : null,
        });

        return sendJson(res, 201, {
          ok: true,
          newsletter_subscription_id: sub.newsletter_subscription_id,
          status: "confirmation_required",
          message: "Check your email to confirm your subscription.",
        });
      }

      return sendJson(res, 200, {
        ok: true,
        newsletter_subscription_id: sub.newsletter_subscription_id,
        status: "already_confirmed",
        message: "Already subscribed.",
      });
    }

    if (pathname === "/api/v1/premium/subscriptions" || pathname === "/api/v1/premium/subscriptions/") {
      if (method !== "POST") return sendMethodNotAllowed(res);
      const pool = requireDb(res, ctx);
      if (!pool) return;

      let body;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        return sendJson(res, 400, {
          ok: false,
          error: "bad_request",
          message: err instanceof Error ? err.message : String(err),
        });
      }

      if (!body || typeof body !== "object") return sendJson(res, 400, { ok: false, error: "bad_request" });

      const result = await createPremiumSubscription(pool, { email: body.email, plan_code: "pro" });
      if (!result.ok) return sendJson(res, 400, { ok: false, error: result.error });

      const sub = result.premium_subscription;

      if (result.status !== "already_active") {
        const baseUrl = origin;

        const emailMsg = buildPremiumConfirmEmail({
          baseUrl,
          confirmToken: sub.confirm_token,
          cancelToken: sub.cancel_token,
        });

        const send = sendEmail({ to: sub.email, subject: emailMsg.subject, bodyText: emailMsg.bodyText });
        const fromEmail = getEmailFrom();

        await insertEmailMessage(pool, {
          message_type: "premium_confirm",
          premium_subscription_id: sub.premium_subscription_id,
          to_email: sub.email,
          from_email: fromEmail,
          subject: emailMsg.subject,
          body_text: emailMsg.bodyText,
          status: send.ok ? send.status : "failed",
          provider: send.ok ? send.provider : send.provider || "unknown",
          provider_message_id: send.ok ? send.provider_message_id : null,
          error: send.ok ? null : send.error || "send_failed",
          sent_at: send.ok ? new Date().toISOString() : null,
        });

        return sendJson(res, 201, {
          ok: true,
          premium_subscription_id: sub.premium_subscription_id,
          status: "confirmation_required",
          message: "Check your email to confirm premium.",
        });
      }

      return sendJson(res, 200, {
        ok: true,
        premium_subscription_id: sub.premium_subscription_id,
        status: "already_active",
        message: "Premium already active for this email.",
      });
    }

    if (pathname === "/api/v1/premium/status" || pathname === "/api/v1/premium/status/") {
      if (method !== "GET") return sendMethodNotAllowed(res);
      const pool = requireDb(res, ctx);
      if (!pool) return;

      const sub = await getPremiumSubscriptionFromReq(pool, req);
      return sendJson(res, 200, {
        ok: true,
        premium: Boolean(sub),
        plan_code: sub ? sub.plan_code : null,
      });
    }

    if (pathname.startsWith("/api/v1/premium/cameras/") && (pathname.endsWith("/price-history") || pathname.endsWith("/price-history/"))) {
      if (method !== "GET") return sendMethodNotAllowed(res);
      const pool = requireDb(res, ctx);
      if (!pool) return;

      const premium = await getPremiumSubscriptionFromReq(pool, req);
      if (!premium) return sendJson(res, 403, { ok: false, error: "premium_required" });

      const rest = pathname.slice("/api/v1/premium/cameras/".length);
      const parts = rest.split("/").filter(Boolean);
      if (parts.length !== 2 || parts[1] !== "price-history") return sendNotFound(res);
      const slug = parts[0];

      const camera = await getCameraBySlug(pool, { slug });
      if (!camera) return sendNotFound(res);

      const params = parseModelPageParams(url);
      const windowDays = parseHistoryWindowDays(url, 180);
      const hist = await listCameraPriceHistory(pool, {
        cameraId: camera.camera_id,
        currency: params.currency,
        country: params.country,
        condition_physical_tier: params.condition_physical_tier,
        windowDays,
      });

      return sendJson(res, 200, {
        ok: true,
        camera_slug: slug,
        window: { window_days: hist.window_days, since_date_utc: hist.since_date_utc },
        filters: params,
        series: hist.rows,
      });
    }

    if (pathname.startsWith("/api/v1/premium/lenses/") && (pathname.endsWith("/price-history") || pathname.endsWith("/price-history/"))) {
      if (method !== "GET") return sendMethodNotAllowed(res);
      const pool = requireDb(res, ctx);
      if (!pool) return;

      const premium = await getPremiumSubscriptionFromReq(pool, req);
      if (!premium) return sendJson(res, 403, { ok: false, error: "premium_required" });

      const rest = pathname.slice("/api/v1/premium/lenses/".length);
      const parts = rest.split("/").filter(Boolean);
      if (parts.length !== 2 || parts[1] !== "price-history") return sendNotFound(res);
      const slug = parts[0];

      const lens = await getLensBySlug(pool, { slug });
      if (!lens) return sendNotFound(res);

      const params = parseModelPageParams(url);
      const windowDays = parseHistoryWindowDays(url, 180);
      const hist = await listLensPriceHistory(pool, {
        lensId: lens.lens_id,
        currency: params.currency,
        country: params.country,
        condition_physical_tier: params.condition_physical_tier,
        windowDays,
      });

      return sendJson(res, 200, {
        ok: true,
        lens_slug: slug,
        window: { window_days: hist.window_days, since_date_utc: hist.since_date_utc },
        filters: params,
        series: hist.rows,
      });
    }

    if (pathname === "/api/v1/price-bands/methodology" || pathname === "/api/v1/price-bands/methodology/") {
      if (method !== "GET") return sendMethodNotAllowed(res);
      return sendJson(res, 200, {
        ok: true,
        version: "v0",
        method_default: "trim_p05_p95_p25_p50_p75_v1",
        computed_from: {
          table: "listing_snapshots",
          join: "listings (to use current match_status + camera_id/lens_id)",
          include_match_status: ["matched", "verified"],
          include_active: true,
        },
        outlier_handling: {
          min: "p05 (5th percentile)",
          max: "p95 (95th percentile)",
          note: "p25/median/p75 are computed on the full sample; min/max are trimmed to reduce outliers.",
        },
        groupings: {
          currency: "price_currency",
          country: "listing country when present; also computes an overall band (country=null).",
          condition_physical_tier: "per-tier and an overall band (condition_physical_tier=null).",
          region: "v0 stores region=null (reserved for later).",
        },
        as_of: {
          observed_date: "UTC date of snapshot retrieval used for the aggregate",
          computed_at: "timestamp when the aggregate was computed",
        },
        how_to_compute: {
          command: "npm.cmd run db:compute:price-bands",
          env_vars: ["FF_PRICE_BANDS_DATE=YYYY-MM-DD (optional)", "FF_PRICE_BANDS_METHOD (optional)"],
        },
        model_page_params: {
          currency: "ISO-4217 (default EUR)",
          country: "ISO-3166-1 alpha-2 (optional, e.g. US)",
          condition: "new|like_new|used_excellent|used_good|used_fair|for_parts (optional)",
        },
      });
    }

    if (pathname === "/api/v1/brands" || pathname === "/api/v1/brands/") {
      if (method !== "GET") return sendMethodNotAllowed(res);
      const pool = requireDb(res, ctx);
      if (!pool) return;

      const { limit, offset } = parseLimitOffset(url);
      const brands = await listBrands(pool, { limit, offset });
      return sendJson(res, 200, { ok: true, brands, page: { limit, offset } });
    }

    if (pathname === "/api/v1/marketplaces" || pathname === "/api/v1/marketplaces/") {
      if (method !== "GET") return sendMethodNotAllowed(res);
      const pool = requireDb(res, ctx);
      if (!pool) return;

      const marketplaces = await listMarketplaces(pool);
      return sendJson(res, 200, { ok: true, marketplaces });
    }

    if (pathname === "/api/v1/cameras" || pathname === "/api/v1/cameras/") {
      if (method !== "GET") return sendMethodNotAllowed(res);
      const pool = requireDb(res, ctx);
      if (!pool) return;

      const { limit, offset } = parseLimitOffset(url);
      const filters = parseCameraListFilters(url);
      const cameras = await listCameras(pool, { limit, offset, filters });
      return sendJson(res, 200, { ok: true, cameras, page: { limit, offset }, filters });
    }

    if (pathname.startsWith("/api/v1/cameras/") && (pathname.endsWith("/price-band") || pathname.endsWith("/price-band/"))) {
      if (method !== "GET") return sendMethodNotAllowed(res);
      const pool = requireDb(res, ctx);
      if (!pool) return;

      const rest = pathname.slice("/api/v1/cameras/".length);
      const parts = rest.split("/").filter(Boolean);
      if (parts.length !== 2 || parts[1] !== "price-band") return sendNotFound(res);
      const slug = parts[0];

      const params = parseModelPageParams(url);
      const page = await getCameraModelPage(pool, {
        slug,
        currency: params.currency,
        country: params.country,
        condition_physical_tier: params.condition_physical_tier,
      });
      if (!page) return sendNotFound(res);
      return sendJson(res, 200, {
        ok: true,
        camera_slug: slug,
        price_band: page.price_band,
      });
    }

    if (pathname.startsWith("/api/v1/cameras/")) {
      if (method !== "GET") return sendMethodNotAllowed(res);
      const pool = requireDb(res, ctx);
      if (!pool) return;

      const slug = pathname.slice("/api/v1/cameras/".length);
      const camera = await getCameraBySlug(pool, { slug });
      if (!camera) return sendNotFound(res);
      return sendJson(res, 200, { ok: true, camera });
    }

    if (pathname === "/api/v1/lenses" || pathname === "/api/v1/lenses/") {
      if (method !== "GET") return sendMethodNotAllowed(res);
      const pool = requireDb(res, ctx);
      if (!pool) return;

      const { limit, offset } = parseLimitOffset(url);
      const filters = parseLensListFilters(url);
      const lenses = await listLenses(pool, { limit, offset, filters });
      return sendJson(res, 200, { ok: true, lenses, page: { limit, offset }, filters });
    }

    if (pathname.startsWith("/api/v1/lenses/") && (pathname.endsWith("/price-band") || pathname.endsWith("/price-band/"))) {
      if (method !== "GET") return sendMethodNotAllowed(res);
      const pool = requireDb(res, ctx);
      if (!pool) return;

      const rest = pathname.slice("/api/v1/lenses/".length);
      const parts = rest.split("/").filter(Boolean);
      if (parts.length !== 2 || parts[1] !== "price-band") return sendNotFound(res);
      const slug = parts[0];

      const params = parseModelPageParams(url);
      const page = await getLensModelPage(pool, {
        slug,
        currency: params.currency,
        country: params.country,
        condition_physical_tier: params.condition_physical_tier,
      });
      if (!page) return sendNotFound(res);
      return sendJson(res, 200, {
        ok: true,
        lens_slug: slug,
        price_band: page.price_band,
      });
    }

    if (pathname.startsWith("/api/v1/lenses/")) {
      if (method !== "GET") return sendMethodNotAllowed(res);
      const pool = requireDb(res, ctx);
      if (!pool) return;

      const slug = pathname.slice("/api/v1/lenses/".length);
      const lens = await getLensBySlug(pool, { slug });
      if (!lens) return sendNotFound(res);
      return sendJson(res, 200, { ok: true, lens });
    }

    if (pathname === "/api/v1/listings" || pathname === "/api/v1/listings/") {
      if (method !== "GET") return sendMethodNotAllowed(res);
      const pool = requireDb(res, ctx);
      if (!pool) return;

      const { limit, offset } = parseLimitOffset(url);
      const filters = parseListingsFilters(url);
      const listings = await listListings(pool, { limit, offset, filters });
      return sendJson(res, 200, { ok: true, listings, page: { limit, offset }, filters });
    }

    if (pathname.startsWith("/api/v1/listings/")) {
      if (method !== "GET") return sendMethodNotAllowed(res);
      const pool = requireDb(res, ctx);
      if (!pool) return;

      const rest = pathname.slice("/api/v1/listings/".length);
      const parts = rest.split("/").filter(Boolean);
      if (parts.length !== 1) return sendNotFound(res);
      const listingId = parts[0];

      const listing = await getListingById(pool, { listingId });
      if (!listing) return sendNotFound(res);

      const premium = await getPremiumSubscriptionFromReq(pool, req);
      const isPremium = Boolean(premium);
      if (!isPremium && listing.deal_score_breakdown) {
        listing.deal_score_breakdown = null;
        listing.deal_score_breakdown_hidden = true;
      }
      return sendJson(res, 200, { ok: true, listing });
    }

    if (pathname === "/api/v1/admin/matching/review-queue" || pathname === "/api/v1/admin/matching/review-queue/") {
      if (method !== "GET") return sendMethodNotAllowed(res);
      if (!requireAdmin(req, res, ctx)) return;
      const pool = requireDb(res, ctx);
      if (!pool) return;

      const { limit, offset } = parseLimitOffset(url);
      const filters = parseReviewQueueFilters(url);
      const listings = await listReviewQueue(pool, { limit, offset, filters });
      return sendJson(res, 200, { ok: true, listings, page: { limit, offset }, filters });
    }

    if (pathname === "/api/v1/admin/matching/override" || pathname === "/api/v1/admin/matching/override/") {
      if (method !== "POST") return sendMethodNotAllowed(res);
      if (!requireAdmin(req, res, ctx)) return;
      const pool = requireDb(res, ctx);
      if (!pool) return;

      const dryRunParsed = parseBoolQuery(url, "dry_run", true);
      if (!dryRunParsed.ok) return sendJson(res, 400, { ok: false, error: "bad_request", message: dryRunParsed.error });
      const confirmParsed = parseBoolQuery(url, "confirm", false);
      if (!confirmParsed.ok) return sendJson(res, 400, { ok: false, error: "bad_request", message: confirmParsed.error });

      const dryRun = dryRunParsed.value;
      const confirm = confirmParsed.value;
      if (!dryRun && !confirm) {
        return sendJson(res, 400, {
          ok: false,
          error: "confirm_required",
          hint: "Preview: POST ?dry_run=true (default). Apply: POST ?dry_run=false&confirm=true",
        });
      }

      let body;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        return sendJson(res, 400, {
          ok: false,
          error: "bad_request",
          message: err instanceof Error ? err.message : String(err),
        });
      }

      if (!body || typeof body !== "object") return sendJson(res, 400, { ok: false, error: "bad_request" });

      const listingId = body.listing_id;
      const cameraSlug = body.camera_slug === undefined ? null : body.camera_slug;
      const lensSlug = body.lens_slug === undefined ? null : body.lens_slug;
      const reason = body.reason === undefined ? null : body.reason;

      const actorIdHeader = req.headers["x-actor-id"];
      const actorId = typeof actorIdHeader === "string" && actorIdHeader.trim() ? actorIdHeader.trim() : "admin";

      const result = await applyListingMatchOverride(pool, { listingId, cameraSlug, lensSlug, actorId, reason, dryRun });
      if (!result.ok) {
        const status = result.error === "not_found" ? 404 : 400;
        return sendJson(res, status, { ok: false, error: result.error });
      }

      const payload = { ok: true, dry_run: result.dry_run, listing: result.listing, diff: result.diff };
      if (result.dry_run) payload.hint = "To apply, repeat the same request with ?dry_run=false&confirm=true";
      return sendJson(res, 200, payload);
    }

    if (pathname === "/api/v1/admin/dedupe/edges" || pathname === "/api/v1/admin/dedupe/edges/") {
      if (!requireAdmin(req, res, ctx)) return;
      const pool = requireDb(res, ctx);
      if (!pool) return;

      if (method === "GET") {
        const { limit, offset } = parseLimitOffset(url);
        const edges = await listDedupeEdges(pool, { limit, offset });
        return sendJson(res, 200, { ok: true, edges, page: { limit, offset } });
      }

      if (method === "POST") {
        const dryRunParsed = parseBoolQuery(url, "dry_run", true);
        if (!dryRunParsed.ok) return sendJson(res, 400, { ok: false, error: "bad_request", message: dryRunParsed.error });
        const confirmParsed = parseBoolQuery(url, "confirm", false);
        if (!confirmParsed.ok) return sendJson(res, 400, { ok: false, error: "bad_request", message: confirmParsed.error });

        const dryRun = dryRunParsed.value;
        const confirm = confirmParsed.value;
        if (!dryRun && !confirm) {
          return sendJson(res, 400, {
            ok: false,
            error: "confirm_required",
            hint: "Preview: POST ?dry_run=true (default). Apply: POST ?dry_run=false&confirm=true",
          });
        }

        let body;
        try {
          body = await readJsonBody(req);
        } catch (err) {
          return sendJson(res, 400, {
            ok: false,
            error: "bad_request",
            message: err instanceof Error ? err.message : String(err),
          });
        }

        if (!body || typeof body !== "object") return sendJson(res, 400, { ok: false, error: "bad_request" });

        const canonicalListingId = body.canonical_listing_id;
        const duplicateListingId = body.duplicate_listing_id;
        const confidence = body.confidence;
        const reason = body.reason;

        const actorIdHeader = req.headers["x-actor-id"];
        const actorId = typeof actorIdHeader === "string" && actorIdHeader.trim() ? actorIdHeader.trim() : "admin";

        const result = await createDedupeEdge(pool, { canonicalListingId, duplicateListingId, actorId, confidence, reason, dryRun });
        if (!result.ok) return sendJson(res, 400, { ok: false, error: result.error });

        const payload = { ok: true, dry_run: result.dry_run, edge: result.edge, diff: result.diff };
        if (result.dry_run) payload.hint = "To apply, repeat the same request with ?dry_run=false&confirm=true";
        return sendJson(res, 200, payload);
      }

      return sendMethodNotAllowed(res);
    }

    if (pathname === "/api/v1/admin/openapi.internal.yml") {
      if (method !== "GET") return sendMethodNotAllowed(res);
      if (!requireAdmin(req, res, ctx)) return;

      const fileUrl = new URL("../openapi.internal.yml", import.meta.url);
      const yaml = await readFile(fileUrl, "utf-8");
      return sendText(res, 200, yaml, "application/yaml; charset=utf-8");
    }

    if (pathname === "/api/v1/admin/ingestion/runs" || pathname === "/api/v1/admin/ingestion/runs/") {
      if (method !== "GET") return sendMethodNotAllowed(res);
      if (!requireAdmin(req, res, ctx)) return;
      const pool = requireDb(res, ctx);
      if (!pool) return;

      const { limit, offset } = parseLimitOffset(url);
      const runs = await listIngestionRuns(pool, { limit, offset });
      return sendJson(res, 200, { ok: true, runs, page: { limit, offset } });
    }

    if (pathname === "/api/v1/admin/ops/status" || pathname === "/api/v1/admin/ops/status/") {
      if (method !== "GET") return sendMethodNotAllowed(res);
      if (!requireAdmin(req, res, ctx)) return;
      const pool = requireDb(res, ctx);
      if (!pool) return;

      const status = await getOpsStatus(pool);
      return sendJson(res, 200, { ok: true, status });
    }

    if (pathname === "/api/v1/admin/partners" || pathname === "/api/v1/admin/partners/") {
      if (method !== "GET") return sendMethodNotAllowed(res);
      if (!requireAdmin(req, res, ctx)) return;
      const pool = requireDb(res, ctx);
      if (!pool) return;

      const partners = await listPartners(pool);
      return sendJson(res, 200, { ok: true, partners });
    }

    if (pathname.startsWith("/api/v1/admin/partners/") && (pathname.endsWith("/report") || pathname.endsWith("/report/"))) {
      if (method !== "GET") return sendMethodNotAllowed(res);
      if (!requireAdmin(req, res, ctx)) return;
      const pool = requireDb(res, ctx);
      if (!pool) return;

      const rest = pathname.slice("/api/v1/admin/partners/".length);
      const parts = rest.split("/").filter(Boolean);
      if (parts.length !== 2 || parts[1] !== "report") return sendNotFound(res);

      const marketplaceCode = parts[0];
      const windowDays = parseWindowDays(url, 30);

      const result = await getPartnerReport(pool, { marketplaceCode, windowDays });
      if (!result.ok) {
        const status = result.error === "not_found" ? 404 : 400;
        return sendJson(res, status, { ok: false, error: result.error });
      }

      return sendJson(res, 200, result);
    }

    if (pathname === "/api/v1/admin/bots/summary" || pathname === "/api/v1/admin/bots/summary/") {
      if (method !== "GET") return sendMethodNotAllowed(res);
      if (!requireAdmin(req, res, ctx)) return;
      const pool = requireDb(res, ctx);
      if (!pool) return;

      const windowMinutes = parseWindowMinutes(url, 60);
      const summary = await getBotTrafficSummary(pool, { windowMinutes });
      return sendJson(res, 200, { ok: true, summary });
    }

    if (pathname === "/api/v1/admin/audit-log" || pathname === "/api/v1/admin/audit-log/") {
      if (method !== "GET") return sendMethodNotAllowed(res);
      if (!requireAdmin(req, res, ctx)) return;
      const pool = requireDb(res, ctx);
      if (!pool) return;

      const { limit, offset } = parseLimitOffset(url);
      const entries = await listAuditLog(pool, { limit, offset });
      return sendJson(res, 200, { ok: true, entries, page: { limit, offset } });
    }

    return sendNotFound(res);
  } catch (err) {
    return sendInternalError(res, err);
  }
}
