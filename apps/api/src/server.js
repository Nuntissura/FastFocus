import http from "node:http";
import { createHmac } from "node:crypto";
import { handleRequest } from "./router.js";
import { classifyUserAgent } from "./bots/user_agent.js";
import { createPoolFromEnv } from "./db/pool.js";
import { insertHttpRequestLog } from "./db/http_request_logs.js";
import {
  assertPathsExist,
  resolveGovContractsRoot,
  resolveGovSpecCurrentPath,
  resolveRepoRoot,
} from "./paths.js";

function envNumber(name, fallback) {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function envString(name, fallback) {
  const raw = process.env[name];
  return raw && raw.trim() ? raw.trim() : fallback;
}

function envBool(name, fallback = false) {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return fallback;
  return raw.trim() === "1" || raw.trim().toLowerCase() === "true";
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

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseListingIdFromPath(pathname) {
  if (typeof pathname !== "string" || !pathname.startsWith("/go/listings/")) return null;
  const rest = pathname.slice("/go/listings/".length);
  const parts = rest.split("/").filter(Boolean);
  if (parts.length !== 1) return null;
  return isUuid(parts[0]) ? parts[0] : null;
}

function referrerOrigin(referrer) {
  if (!referrer || typeof referrer !== "string") return null;
  try {
    const u = new URL(referrer);
    return u.origin;
  } catch {
    return null;
  }
}

function getClientIp(req) {
  const trustProxy = envBool("FF_TRUST_PROXY", false);
  if (trustProxy) {
    const xff = req.headers["x-forwarded-for"];
    if (typeof xff === "string" && xff.trim()) {
      const first = xff.split(",")[0].trim();
      if (first) return first;
    }
  }
  const ra = req.socket && typeof req.socket.remoteAddress === "string" ? req.socket.remoteAddress : null;
  return ra && ra.trim() ? ra.trim() : null;
}

function hashIp(ip) {
  const salt = process.env.FF_IP_HASH_SALT;
  if (!salt || !salt.trim()) return null;
  if (!ip) return null;
  return createHmac("sha256", salt.trim()).update(ip).digest("hex").slice(0, 32);
}

function parseCsvSet(value) {
  const raw = value && typeof value === "string" ? value : "";
  const out = new Set();
  for (const part of raw.split(",")) {
    const v = part.trim();
    if (!v) continue;
    out.add(v);
  }
  return out;
}

function shouldBlockTrainingBots({ botKind }) {
  if (botKind !== "training") return false;
  return envBool("FF_BLOCK_TRAINING_BOTS", false);
}

function createFixedWindowLimiter({ windowMs }) {
  const buckets = new Map();
  return function allow(key, { nowMs, max }) {
    if (!key) return true;
    const now = nowMs;
    const current = buckets.get(key);
    if (!current || now >= current.reset_at_ms) {
      buckets.set(key, { count: 1, reset_at_ms: now + windowMs });
      return true;
    }
    if (current.count >= max) return false;
    current.count += 1;
    return true;
  };
}

export function createApiServer({ contractsRoot, specCurrentPath } = {}) {
  const resolvedContractsRoot = contractsRoot || resolveGovContractsRoot();
  const resolvedSpecCurrentPath = specCurrentPath || resolveGovSpecCurrentPath();

  assertPathsExist([
    { label: "contractsRoot", targetPath: resolvedContractsRoot },
    { label: "specCurrentPath", targetPath: resolvedSpecCurrentPath },
  ]);

  const dbPool = createPoolFromEnv();
  const adminToken = process.env.FF_ADMIN_TOKEN && process.env.FF_ADMIN_TOKEN.trim() ? process.env.FF_ADMIN_TOKEN.trim() : null;

  const ctx = {
    contractsRoot: resolvedContractsRoot,
    contractsRootHint: "FF - gov/data_contracts",
    specCurrentPath: resolvedSpecCurrentPath,
    specCurrentPathHint: "FF - gov/SPEC_CURRENT.md",
    dbPool,
    dbEnabled: Boolean(dbPool),
    dbHint: "Set DATABASE_URL=postgres://fastfocus:fastfocus@127.0.0.1:55432/fastfocus",
    adminToken,
    adminHint: "Set FF_ADMIN_TOKEN and send x-admin-token header for /api/v1/admin/* endpoints",
  };

  const allowlist = parseCsvSet(envString("FF_BOT_ALLOWLIST", "Googlebot,Bingbot,OAI-SearchBot,ChatGPT-User"));
  const rateLimitEnabled = envBool("FF_RATE_LIMIT_ENABLED", false);
  const rateLimitWindowMs = envNumber("FF_RATE_LIMIT_WINDOW_MS", 60_000);
  const rateLimitBotMax = envNumber("FF_RATE_LIMIT_BOT_MAX_PER_WINDOW", 600);
  const rateLimitHumanMax = envNumber("FF_RATE_LIMIT_HUMAN_MAX_PER_WINDOW", 2_000);
  const allow = createFixedWindowLimiter({ windowMs: rateLimitWindowMs });

  const server = http.createServer(async (req, res) => {
    const startedAt = new Date();
    const startedAtIso = startedAt.toISOString();
    const startNs = process.hrtime.bigint();

    const method = req.method || "GET";
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname || "/";
    const listingId = parseListingIdFromPath(pathname);
    const userAgent = typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null;
    const ua = classifyUserAgent(userAgent);

    const clientIp = getClientIp(req);
    const ipHash = hashIp(clientIp);

    res.on("finish", () => {
      if (!ctx.dbPool) return;
      if (!envBool("FF_HTTP_REQUEST_LOGS_ENABLED", true)) return;

      const elapsedMs = Number(process.hrtime.bigint() - startNs) / 1e6;
      void insertHttpRequestLog(ctx.dbPool, {
        occurredAt: startedAtIso,
        method,
        path: pathname,
        listingId,
        statusCode: res.statusCode,
        responseMs: elapsedMs,
        referrer: referrerOrigin(typeof req.headers.referer === "string" ? req.headers.referer : null),
        utm: parseUtm(url),
        userAgent,
        isBot: ua.is_bot,
        botName: ua.bot_name,
        ipHash,
        cacheHit: false,
        properties: {
          bot_kind: ua.bot_kind,
        },
      }).catch(() => {
        // ignore logging failures
      });
    });

    if (shouldBlockTrainingBots({ botKind: ua.bot_kind })) {
      res.statusCode = 403;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.end("Forbidden\n");
      return;
    }

    if (rateLimitEnabled) {
      const key = ipHash || clientIp;
      const max = ua.is_bot ? (allowlist.has(ua.bot_name || "") ? null : rateLimitBotMax) : rateLimitHumanMax;
      if (max !== null && !allow(key, { nowMs: Date.now(), max })) {
        res.statusCode = 429;
        res.setHeader("content-type", "text/plain; charset=utf-8");
        res.setHeader("retry-after", String(Math.max(1, Math.round(rateLimitWindowMs / 1000))));
        res.end("Too Many Requests\n");
        return;
      }
    }

    await handleRequest(req, res, ctx);
  });
  return { server, ctx };
}

export async function start() {
  const host = envString("HOST", "127.0.0.1");
  const port = envNumber("PORT", 8787);

  const { server } = createApiServer();

  await new Promise((resolve) => server.listen(port, host, resolve));

  // logs can be absolute; do not commit absolute paths in docs/config.
  const repoRoot = resolveRepoRoot();
  // eslint-disable-next-line no-console
  console.log(`fastfocus api listening on http://${host}:${port}`);
  // eslint-disable-next-line no-console
  console.log(`repo_root=${repoRoot}`);
}

if (process.argv[1] && process.argv[1].endsWith("server.js")) {
  start().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  });
}
