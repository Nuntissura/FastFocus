import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { createApiServer } from "../src/server.js";

function fixturePath(rel) {
  return fileURLToPath(new URL(rel, import.meta.url));
}

async function withServer(fn, { contractsRoot, specCurrentPath, databaseUrl = "", adminToken = "" } = {}) {
  const envBefore = {
    DATABASE_URL: process.env.DATABASE_URL,
    FF_ADMIN_TOKEN: process.env.FF_ADMIN_TOKEN,
  };

  process.env.DATABASE_URL = databaseUrl || "";
  process.env.FF_ADMIN_TOKEN = adminToken || "";

  const { server } = createApiServer({ contractsRoot, specCurrentPath });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  if (!port) throw new Error("failed to bind test port");

  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    return await fn({ baseUrl });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (envBefore.DATABASE_URL === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = envBefore.DATABASE_URL;

    if (envBefore.FF_ADMIN_TOKEN === undefined) delete process.env.FF_ADMIN_TOKEN;
    else process.env.FF_ADMIN_TOKEN = envBefore.FF_ADMIN_TOKEN;
  }
}

test("GET /health", async () => {
  await withServer(
    async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/health`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.ok, true);
      assert.equal(data.service, "fastfocus_api");
      assert.ok(typeof data.time_utc === "string");
      assert.equal(data.db_enabled, false);
    },
    {
      contractsRoot: fixturePath("./fixtures/contracts/"),
      specCurrentPath: fixturePath("./fixtures/spec/SPEC_CURRENT.md"),
    },
  );
});

test("GET /api/v1/contracts + schema + sql", async () => {
  await withServer(
    async ({ baseUrl }) => {
      const listRes = await fetch(`${baseUrl}/api/v1/contracts`);
      assert.equal(listRes.status, 200);
      const list = await listRes.json();
      assert.equal(list.ok, true);
      assert.deepEqual(list.schemas, ["sample.schema.json"]);

      const schemaRes = await fetch(`${baseUrl}/api/v1/contracts/schemas/sample.schema.json`);
      assert.equal(schemaRes.status, 200);
      const schema = await schemaRes.json();
      assert.equal(schema.ok, true);
      assert.equal(schema.schema_file, "sample.schema.json");
      assert.equal(schema.schema.title, "Sample");

      const sqlRes = await fetch(`${baseUrl}/api/v1/contracts/postgres_schema.sql`);
      assert.equal(sqlRes.status, 200);
      const sql = await sqlRes.text();
      assert.match(sql, /fixture schema/);
    },
    {
      contractsRoot: fixturePath("./fixtures/contracts/"),
      specCurrentPath: fixturePath("./fixtures/spec/SPEC_CURRENT.md"),
    },
  );
});

test("GET /api/v1/spec/current", async () => {
  await withServer(
    async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/api/v1/spec/current`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.ok, true);
      assert.match(data.spec_current_md, /SPEC_CURRENT/);
    },
    {
      contractsRoot: fixturePath("./fixtures/contracts/"),
      specCurrentPath: fixturePath("./fixtures/spec/SPEC_CURRENT.md"),
    },
  );
});

test("DB endpoints return 503 when DATABASE_URL missing", async () => {
  await withServer(
    async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/api/v1/brands`);
      assert.equal(res.status, 503);
      const data = await res.json();
      assert.equal(data.ok, false);
      assert.equal(data.error, "db_not_configured");
      assert.ok(typeof data.hint === "string");
    },
    {
      contractsRoot: fixturePath("./fixtures/contracts/"),
      specCurrentPath: fixturePath("./fixtures/spec/SPEC_CURRENT.md"),
    },
  );
});

test("POST /api/v1/saved-searches returns 503 when DATABASE_URL missing", async () => {
  await withServer(
    async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/api/v1/saved-searches`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "test@example.com", camera_slug: "sony-a7-iv" }),
      });
      assert.equal(res.status, 503);
      const data = await res.json();
      assert.equal(data.ok, false);
      assert.equal(data.error, "db_not_configured");
    },
    {
      contractsRoot: fixturePath("./fixtures/contracts/"),
      specCurrentPath: fixturePath("./fixtures/spec/SPEC_CURRENT.md"),
    },
  );
});

test("POST /api/v1/newsletter/subscriptions returns 503 when DATABASE_URL missing", async () => {
  await withServer(
    async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/api/v1/newsletter/subscriptions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "test@example.com", segment: "street" }),
      });
      assert.equal(res.status, 503);
      const data = await res.json();
      assert.equal(data.ok, false);
      assert.equal(data.error, "db_not_configured");
    },
    {
      contractsRoot: fixturePath("./fixtures/contracts/"),
      specCurrentPath: fixturePath("./fixtures/spec/SPEC_CURRENT.md"),
    },
  );
});

test("POST /api/v1/premium/subscriptions returns 503 when DATABASE_URL missing", async () => {
  await withServer(
    async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/api/v1/premium/subscriptions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "test@example.com" }),
      });
      assert.equal(res.status, 503);
      const data = await res.json();
      assert.equal(data.ok, false);
      assert.equal(data.error, "db_not_configured");
    },
    {
      contractsRoot: fixturePath("./fixtures/contracts/"),
      specCurrentPath: fixturePath("./fixtures/spec/SPEC_CURRENT.md"),
    },
  );
});

test("Admin endpoints return 503 when FF_ADMIN_TOKEN missing", async () => {
  await withServer(
    async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/api/v1/admin/ingestion/runs`);
      assert.equal(res.status, 503);
      const data = await res.json();
      assert.equal(data.ok, false);
      assert.equal(data.error, "admin_not_configured");
      assert.ok(typeof data.hint === "string");
    },
    {
      contractsRoot: fixturePath("./fixtures/contracts/"),
      specCurrentPath: fixturePath("./fixtures/spec/SPEC_CURRENT.md"),
    },
  );
});

test("GET /api/v1/admin/openapi.internal.yml returns OpenAPI yaml when authorized", async () => {
  await withServer(
    async ({ baseUrl }) => {
      const unauth = await fetch(`${baseUrl}/api/v1/admin/openapi.internal.yml`);
      assert.equal(unauth.status, 401);

      const auth = await fetch(`${baseUrl}/api/v1/admin/openapi.internal.yml`, {
        headers: { "x-admin-token": "test_admin" },
      });
      assert.equal(auth.status, 200);
      const yaml = await auth.text();
      assert.match(yaml, /openapi:\s*3\.1\.0/);
    },
    {
      contractsRoot: fixturePath("./fixtures/contracts/"),
      specCurrentPath: fixturePath("./fixtures/spec/SPEC_CURRENT.md"),
      adminToken: "test_admin",
    },
  );
});

test("GET / returns homepage HTML when DB missing", async () => {
  await withServer(
    async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type") || "", /text\/html/i);
      const html = await res.text();
      assert.match(html, /Fast Focus/);
      assert.match(html, /Camera-body-first used market intelligence/i);
      assert.doesNotMatch(html, />Lenses</);
      assert.doesNotMatch(html, />Guides</);
      assert.doesNotMatch(html, />Newsletter</);
      assert.doesNotMatch(html, />Premium</);
      assert.match(html, /data-testid="home-search-form"/);
    },
    {
      contractsRoot: fixturePath("./fixtures/contracts/"),
      specCurrentPath: fixturePath("./fixtures/spec/SPEC_CURRENT.md"),
    },
  );
});

test("GET /search redirects to scoped list page", async () => {
  await withServer(
    async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/search?type=lenses&q=sony`, { redirect: "manual" });
      assert.equal(res.status, 302);
      assert.equal(res.headers.get("location"), "/lenses?q=sony");
    },
    {
      contractsRoot: fixturePath("./fixtures/contracts/"),
      specCurrentPath: fixturePath("./fixtures/spec/SPEC_CURRENT.md"),
    },
  );
});

test("GET /sitemap.xml returns 503 when DB missing", async () => {
  await withServer(
    async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/sitemap.xml`);
      assert.equal(res.status, 503);
      const text = await res.text();
      assert.match(text, /Database not configured/i);
    },
    {
      contractsRoot: fixturePath("./fixtures/contracts/"),
      specCurrentPath: fixturePath("./fixtures/spec/SPEC_CURRENT.md"),
    },
  );
});

test("GET /robots.txt returns sitemap directive", async () => {
  await withServer(
    async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/robots.txt`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type") || "", /text\/plain/i);
      const text = await res.text();
      assert.match(text, /Sitemap:/i);
      assert.match(text, /Disallow:\s*\/api\//i);
    },
    {
      contractsRoot: fixturePath("./fixtures/contracts/"),
      specCurrentPath: fixturePath("./fixtures/spec/SPEC_CURRENT.md"),
    },
  );
});

test("GET /llms.txt returns guidance text", async () => {
  await withServer(
    async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/llms.txt`);
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.match(text, /Fast Focus/i);
      assert.match(text, /sitemap\.xml/i);
      assert.match(text, /camera-body-first/i);
      assert.doesNotMatch(text, /guides\/\{topic\}/i);
      assert.doesNotMatch(text, /lenses\/\{slug\}/i);
    },
    {
      contractsRoot: fixturePath("./fixtures/contracts/"),
      specCurrentPath: fixturePath("./fixtures/spec/SPEC_CURRENT.md"),
    },
  );
});

test("GET /about + /privacy return HTML pages", async () => {
  await withServer(
    async ({ baseUrl }) => {
      const about = await fetch(`${baseUrl}/about`);
      assert.equal(about.status, 200);
      assert.match(about.headers.get("content-type") || "", /text\/html/i);

      const privacy = await fetch(`${baseUrl}/privacy`);
      assert.equal(privacy.status, 200);
      assert.match(privacy.headers.get("content-type") || "", /text\/html/i);
    },
    {
      contractsRoot: fixturePath("./fixtures/contracts/"),
      specCurrentPath: fixturePath("./fixtures/spec/SPEC_CURRENT.md"),
    },
  );
});

test("GET /consent sets consent cookie and redirects", async () => {
  await withServer(
    async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/consent?analytics=true&return_to=/privacy`, { redirect: "manual" });
      assert.equal(res.status, 302);
      assert.equal(res.headers.get("location"), "/privacy");
      const setCookie = res.headers.get("set-cookie") || "";
      assert.match(setCookie, /ff_consent=1/i);
    },
    {
      contractsRoot: fixturePath("./fixtures/contracts/"),
      specCurrentPath: fixturePath("./fixtures/spec/SPEC_CURRENT.md"),
    },
  );
});

test("GET /guides/unknown-topic returns 404", async () => {
  await withServer(
    async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/guides/unknown-topic`);
      assert.equal(res.status, 404);
      const html = await res.text();
      assert.match(html, /Guide not found/i);
    },
    {
      contractsRoot: fixturePath("./fixtures/contracts/"),
      specCurrentPath: fixturePath("./fixtures/spec/SPEC_CURRENT.md"),
    },
  );
});

test("GET /guides returns parked noindex header", async () => {
  await withServer(
    async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/guides`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("x-robots-tag"), "noindex,follow");
    },
    {
      contractsRoot: fixturePath("./fixtures/contracts/"),
      specCurrentPath: fixturePath("./fixtures/spec/SPEC_CURRENT.md"),
    },
  );
});

test("GET /favicon.svg returns SVG", async () => {
  await withServer(
    async ({ baseUrl }) => {
      const res = await fetch(`${baseUrl}/favicon.svg`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type") || "", /image\/svg\+xml/i);
      const svg = await res.text();
      assert.match(svg, /<svg/i);
    },
    {
      contractsRoot: fixturePath("./fixtures/contracts/"),
      specCurrentPath: fixturePath("./fixtures/spec/SPEC_CURRENT.md"),
    },
  );
});
