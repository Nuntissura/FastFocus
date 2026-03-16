function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function cameraCanonicalPath({ slug }) {
  return `/cameras/${encodeURIComponent(slug)}`;
}

function lensCanonicalPath({ slug }) {
  return `/lenses/${encodeURIComponent(slug)}`;
}

function formatMaybeIso(ts) {
  if (!isNonEmptyString(ts)) return "—";
  try {
    return new Date(ts).toISOString();
  } catch {
    return escapeHtml(ts);
  }
}

function formatBool(value) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "—";
}

function formatMoney(amount, currency) {
  if (amount === null || amount === undefined) return "—";
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  if (isNonEmptyString(currency)) {
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
    } catch {
      // ignore
    }
  }
  return currency ? `${n.toFixed(0)} ${currency}` : n.toFixed(0);
}

function safeJsonObject(value) {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch {
      // ignore
    }
  }
  return null;
}

function getPath(obj, dotPath) {
  if (!obj || typeof obj !== "object") return undefined;
  const parts = String(dotPath || "")
    .split(".")
    .map((p) => p.trim())
    .filter(Boolean);
  let cur = obj;
  for (const part of parts) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = cur[part];
  }
  return cur;
}

function humanLabel(value) {
  if (!isNonEmptyString(value)) return null;
  return value
    .replaceAll("_", " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

const SENSOR_FORMAT_LABELS = {
  full_frame: "Full-frame",
  aps_c: "APS-C",
  aps_h: "APS-H",
  micro_four_thirds: "Micro Four Thirds",
  one_inch: "1-inch",
  one_over_1_6_inch: "1/1.6-inch",
  one_over_1_7_inch: "1/1.7-inch",
  one_over_1_8_inch: "1/1.8-inch",
  one_over_2_0_inch: "1/2-inch",
  one_over_2_3_inch: "1/2.3-inch",
  one_over_2_5_inch: "1/2.5-inch",
  one_over_2_7_inch: "1/2.7-inch",
  one_over_3_0_inch: "1/3-inch",
  medium_format_44x33: "Medium format (44×33)",
  medium_format_645: "Medium format (645)",
  other: "Other",
};

const CAMERA_CATEGORY_LABELS = {
  mirrorless: "Mirrorless",
  dslr: "DSLR",
  compact: "Compact",
  rangefinder: "Rangefinder",
  other: "Other",
};

const LENS_SYSTEM_TYPE_LABELS = {
  interchangeable: "Interchangeable lens",
  fixed: "Fixed lens",
};

const VIEWFINDER_TYPE_LABELS = {
  evf: "EVF",
  ovf: "OVF",
  none: "None",
};

const MOUNT_LABELS = {
  sony_e: "Sony E",
  canon_rf: "Canon RF",
  canon_ef: "Canon EF",
  canon_ef_m: "Canon EF-M",
  nikon_z: "Nikon Z",
  nikon_f: "Nikon F",
  fujifilm_x: "Fujifilm X",
  micro_four_thirds: "Micro Four Thirds",
  leica_m: "Leica M",
};

function enumLabel(value, labels = null) {
  if (!isNonEmptyString(value)) return null;
  if (labels && labels[value]) return labels[value];
  return humanLabel(value);
}

function buildQuery(params) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined) continue;
    const s = String(v);
    if (!s.trim()) continue;
    sp.set(k, s);
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

function navHtml() {
  return `
    <nav aria-label="Primary">
      <a href="/cameras">Cameras</a>
      <a href="/lenses">Lenses</a>
      <a href="/brands">Brands</a>
      <a href="/compare">Compare</a>
      <a href="/guides">Guides</a>
      <a href="/newsletter">Newsletter</a>
      <a href="/premium">Premium</a>
    </nav>
  `;
}

function documentHtml({ title, description, canonicalUrl = null, robots = null, bodyHtml }) {
  const safeTitle = escapeHtml(title);
  const safeDesc = description ? escapeHtml(description) : null;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    ${safeDesc ? `<meta name="description" content="${safeDesc}" />` : ""}
    ${canonicalUrl ? `<link rel="canonical" href="${escapeHtml(canonicalUrl)}" />` : ""}
    ${robots ? `<meta name="robots" content="${escapeHtml(robots)}" />` : ""}
    <style>
      :root { color-scheme: light dark; }
      body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 0; line-height: 1.5; }
      header { border-bottom: 1px solid rgba(127,127,127,0.25); }
      header .wrap { max-width: 1040px; margin: 0 auto; padding: 16px 20px; display: flex; gap: 16px; align-items: baseline; justify-content: space-between; flex-wrap: wrap; }
      header a { color: inherit; text-decoration: none; }
      header nav { display: flex; gap: 14px; flex-wrap: wrap; }
      header nav a { text-decoration: underline; text-underline-offset: 3px; opacity: 0.9; }
      main { max-width: 1040px; margin: 0 auto; padding: 20px; }
      h1 { margin: 0 0 8px; font-size: 30px; }
      h2 { margin-top: 28px; }
      .subtle { opacity: 0.8; }
      .grid { display: grid; grid-template-columns: 1fr; gap: 16px; }
      @media (min-width: 900px) { .grid { grid-template-columns: 1fr 1fr; } }
      .card { border: 1px solid rgba(127,127,127,0.35); border-radius: 12px; padding: 14px 14px; }
      .card h3 { margin: 0 0 8px; font-size: 16px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid rgba(127,127,127,0.35); padding: 8px 10px; vertical-align: top; }
      th { text-align: left; }
      label { display: block; font-size: 13px; opacity: 0.85; margin: 10px 0 4px; }
      input, select { width: 100%; max-width: 520px; padding: 8px 10px; border-radius: 10px; border: 1px solid rgba(127,127,127,0.35); background: transparent; color: inherit; }
      button { padding: 8px 12px; border-radius: 10px; border: 1px solid rgba(127,127,127,0.35); background: transparent; color: inherit; cursor: pointer; }
      .row { display: flex; gap: 10px; align-items: end; flex-wrap: wrap; }
      .row > * { flex: 1 1 220px; }
      .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; border: 1px solid rgba(127,127,127,0.35); font-size: 12px; opacity: 0.9; }
      footer { max-width: 1040px; margin: 0 auto; padding: 20px; opacity: 0.75; }
      footer a { color: inherit; text-decoration: underline; text-underline-offset: 3px; }
      ul.clean { list-style: none; padding: 0; margin: 0; }
      ul.clean li { padding: 8px 0; border-bottom: 1px solid rgba(127,127,127,0.12); }
      ul.clean li:last-child { border-bottom: none; }
      .warn { border: 1px solid rgba(255,165,0,0.4); background: rgba(255,165,0,0.08); padding: 10px 12px; border-radius: 12px; }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.95em; }
    </style>
  </head>
  <body>
    <header>
      <div class="wrap">
        <div>
          <strong><a href="/">Fast Focus</a></strong>
          <span class="subtle">Used gear discovery</span>
        </div>
        ${navHtml()}
      </div>
    </header>
    <main>
      ${bodyHtml}
    </main>
    <footer>
      <div>
        Fast Focus MVP • Generated ${escapeHtml(new Date().toISOString())} • <a href="/about">About</a> • <a href="/privacy">Privacy</a> •
        <a href="/sitemap.xml">Sitemap</a> • <a href="/llms.txt">LLMs</a>
      </div>
    </footer>
  </body>
</html>
`;
}

export function renderHomePageHtml({ canonicalUrl, dbEnabled, dbHint, marketplaces = [], featuredCameras = [], featuredLenses = [] }) {
  const marketRows = marketplaces
    .map((m) => {
      const name = escapeHtml(m.display_name || m.marketplace_code);
      const code = escapeHtml(m.marketplace_code);
      const active = typeof m.active_listing_count === "number" ? String(m.active_listing_count) : "—";
      const last = formatMaybeIso(m.last_listing_retrieved_at);
      const status = escapeHtml(m.last_run_status || "—");
      return `<tr><th scope="row">${name} <span class="pill">${code}</span></th><td>${active}</td><td>${last}</td><td>${status}</td></tr>`;
    })
    .join("");

  const cameraItems = featuredCameras
    .map((c) => {
      const href = cameraCanonicalPath(c);
      const label = escapeHtml(c.display_name || c.slug);
      const meta = [c.brand_name || c.brand_slug, c.release_year, c.sensor_format, c.mount_code]
        .filter((v) => v !== null && v !== undefined && String(v).trim())
        .map((v) => escapeHtml(String(v)))
        .join(" • ");
      return `<li><a href="${href}">${label}</a><div class="subtle">${meta}</div></li>`;
    })
    .join("");

  const lensItems = featuredLenses
    .map((l) => {
      const href = lensCanonicalPath(l);
      const label = escapeHtml(l.display_name || l.slug);
      const meta = [l.brand_name || l.brand_slug, l.release_year, l.mount_code, l.lens_category]
        .filter((v) => v !== null && v !== undefined && String(v).trim())
        .map((v) => escapeHtml(String(v)))
        .join(" • ");
      return `<li><a href="${href}">${label}</a><div class="subtle">${meta}</div></li>`;
    })
    .join("");

  const dbBlock = dbEnabled
    ? ""
    : `<div class="warn" role="note">
        <strong>Database not configured</strong>
        <div class="subtle">${escapeHtml(dbHint || "Set DATABASE_URL to enable DB-backed pages.")}</div>
      </div>`;

  const bodyHtml = `
    <h1>Fast Focus</h1>
    <p class="subtle">Find typical used prices, compare models, and click out to live listings (affiliate-supported).</p>

    ${dbBlock}

    <section class="card" aria-label="Search">
      <h2>Search</h2>
      <form action="/search" method="get" aria-label="Search form">
        <div class="row">
          <div>
            <label for="q">Query</label>
            <input id="q" name="q" placeholder="e.g., a7 iv, z6 ii, rf 24-70" />
          </div>
          <div>
            <label for="type">Search in</label>
            <select id="type" name="type" aria-label="Search scope">
              <option value="cameras">Cameras</option>
              <option value="lenses">Lenses</option>
            </select>
          </div>
          <div style="flex:0 0 auto">
            <label>&nbsp;</label>
            <button type="submit">Search</button>
          </div>
        </div>
      </form>
      <p class="subtle">Or browse: <a href="/cameras">cameras</a>, <a href="/lenses">lenses</a>, <a href="/brands">brands</a>.</p>
    </section>

    <div class="grid" style="margin-top:16px">
      <section class="card" aria-label="Live market">
        <h2>Live market (freshness)</h2>
        ${
          marketRows
            ? `<table aria-label="Marketplace freshness">
                <thead><tr><th scope="col">Marketplace</th><th scope="col">Active listings</th><th scope="col">Last retrieved</th><th scope="col">Last run</th></tr></thead>
                <tbody>${marketRows}</tbody>
              </table>`
            : `<p class="subtle">No marketplace data yet.</p>`
        }
      </section>

      <section class="card" aria-label="Start here">
        <h2>Start here</h2>
        <ul>
          <li><a href="/cameras">Browse cameras</a> (model pages include price bands + listings)</li>
          <li><a href="/lenses">Browse lenses</a></li>
          <li><a href="/compare">Compare two models</a></li>
          <li><a href="/guides">Read guides</a> (coming soon)</li>
        </ul>
      </section>
    </div>

    <div class="grid" style="margin-top:16px">
      <section class="card" aria-label="Featured cameras">
        <h2>Featured cameras</h2>
        ${cameraItems ? `<ul class="clean">${cameraItems}</ul>` : `<p class="subtle">No cameras yet.</p>`}
      </section>
      <section class="card" aria-label="Featured lenses">
        <h2>Featured lenses</h2>
        ${lensItems ? `<ul class="clean">${lensItems}</ul>` : `<p class="subtle">No lenses yet.</p>`}
      </section>
    </div>
  `;

  return documentHtml({
    title: "Fast Focus",
    description: "Used camera and lens discovery: typical used price bands, comparisons, and live listings.",
    canonicalUrl,
    bodyHtml,
  });
}

export function renderCameraIndexHtml({ canonicalUrl, robots, filters, brands = [], cameras = [], page }) {
  const optionsBrands = [`<option value="">All brands</option>`]
    .concat(
      brands.map((b) => {
        const selected = filters.brand && b.slug === filters.brand ? " selected" : "";
        return `<option value="${escapeHtml(b.slug)}"${selected}>${escapeHtml(b.name)}</option>`;
      }),
    )
    .join("");

  const items = cameras
    .map((c) => {
      const href = cameraCanonicalPath(c);
      const title = escapeHtml(c.display_name || c.slug);
      const meta = [
        c.brand_name || c.brand_slug,
        c.release_year ? String(c.release_year) : null,
        c.sensor_format,
        c.mount_code,
        c.capture_medium,
      ]
        .filter(Boolean)
        .map((v) => escapeHtml(String(v)))
        .join(" • ");
      return `<li><a href="${href}">${title}</a><div class="subtle">${meta}</div></li>`;
    })
    .join("");

  const prevOffset = page.offset > 0 ? Math.max(0, page.offset - page.limit) : null;
  const nextOffset = cameras.length === page.limit ? page.offset + page.limit : null;

  const baseParams = {
    q: filters.q || null,
    brand: filters.brand || null,
    capture_medium: filters.captureMedium || null,
    mount: filters.mount || null,
    limit: page.limit !== 50 ? page.limit : null,
  };

  const prevHref = prevOffset === null ? null : `/cameras${buildQuery({ ...baseParams, offset: prevOffset })}`;
  const nextHref = nextOffset === null ? null : `/cameras${buildQuery({ ...baseParams, offset: nextOffset })}`;

  const bodyHtml = `
    <h1>Cameras</h1>
    <p class="subtle">Canonical model pages use <code>/cameras/{slug}</code>.</p>

    <section class="card" aria-label="Filters">
      <h2>Filter</h2>
      <form action="/cameras" method="get" aria-label="Camera filters">
        <div class="row">
          <div>
            <label for="q">Search</label>
            <input id="q" name="q" value="${escapeHtml(filters.q || "")}" placeholder="Search cameras..." />
          </div>
          <div>
            <label for="brand">Brand</label>
            <select id="brand" name="brand">${optionsBrands}</select>
          </div>
          <div>
            <label for="capture_medium">Capture medium</label>
            <select id="capture_medium" name="capture_medium">
              <option value="">All</option>
              <option value="digital"${filters.captureMedium === "digital" ? " selected" : ""}>Digital</option>
              <option value="film"${filters.captureMedium === "film" ? " selected" : ""}>Film</option>
            </select>
          </div>
          <div>
            <label for="mount">Mount code</label>
            <input id="mount" name="mount" value="${escapeHtml(filters.mount || "")}" placeholder="e.g. e, rf, z" />
          </div>
          <div style="flex:0 0 auto">
            <label>&nbsp;</label>
            <button type="submit">Apply</button>
          </div>
        </div>
      </form>
    </section>

    <section class="card" aria-label="Results" style="margin-top:16px">
      <h2>Results</h2>
      ${items ? `<ul class="clean">${items}</ul>` : `<p class="subtle">No results.</p>`}
      <div class="row" style="margin-top:10px;align-items:center">
        <div>
          <span class="subtle">Showing ${escapeHtml(String(cameras.length))} items • offset ${escapeHtml(String(page.offset))}</span>
        </div>
        <div style="flex:0 0 auto;display:flex;gap:10px">
          ${prevHref ? `<a href="${prevHref}">Prev</a>` : `<span class="subtle">Prev</span>`}
          ${nextHref ? `<a href="${nextHref}">Next</a>` : `<span class="subtle">Next</span>`}
        </div>
      </div>
    </section>
  `;

  return documentHtml({
    title: "Cameras • Fast Focus",
    description: "Browse camera models with canonical brand/model URLs.",
    canonicalUrl,
    robots,
    bodyHtml,
  });
}

export function renderLensIndexHtml({ canonicalUrl, robots, filters, brands = [], lenses = [], page }) {
  const optionsBrands = [`<option value="">All brands</option>`]
    .concat(
      brands.map((b) => {
        const selected = filters.brand && b.slug === filters.brand ? " selected" : "";
        return `<option value="${escapeHtml(b.slug)}"${selected}>${escapeHtml(b.name)}</option>`;
      }),
    )
    .join("");

  const items = lenses
    .map((l) => {
      const href = lensCanonicalPath(l);
      const title = escapeHtml(l.display_name || l.slug);
      const meta = [l.brand_name || l.brand_slug, l.release_year ? String(l.release_year) : null, l.mount_code, l.lens_category]
        .filter(Boolean)
        .map((v) => escapeHtml(String(v)))
        .join(" • ");
      return `<li><a href="${href}">${title}</a><div class="subtle">${meta}</div></li>`;
    })
    .join("");

  const prevOffset = page.offset > 0 ? Math.max(0, page.offset - page.limit) : null;
  const nextOffset = lenses.length === page.limit ? page.offset + page.limit : null;

  const baseParams = {
    q: filters.q || null,
    brand: filters.brand || null,
    mount: filters.mount || null,
    category: filters.category || null,
    limit: page.limit !== 50 ? page.limit : null,
  };

  const prevHref = prevOffset === null ? null : `/lenses${buildQuery({ ...baseParams, offset: prevOffset })}`;
  const nextHref = nextOffset === null ? null : `/lenses${buildQuery({ ...baseParams, offset: nextOffset })}`;

  const bodyHtml = `
    <h1>Lenses</h1>
    <p class="subtle">Canonical model pages use <code>/lenses/{slug}</code>.</p>

    <section class="card" aria-label="Filters">
      <h2>Filter</h2>
      <form action="/lenses" method="get" aria-label="Lens filters">
        <div class="row">
          <div>
            <label for="q">Search</label>
            <input id="q" name="q" value="${escapeHtml(filters.q || "")}" placeholder="Search lenses..." />
          </div>
          <div>
            <label for="brand">Brand</label>
            <select id="brand" name="brand">${optionsBrands}</select>
          </div>
          <div>
            <label for="category">Category</label>
            <select id="category" name="category">
              <option value="">All</option>
              <option value="prime"${filters.category === "prime" ? " selected" : ""}>Prime</option>
              <option value="zoom"${filters.category === "zoom" ? " selected" : ""}>Zoom</option>
              <option value="teleconverter"${filters.category === "teleconverter" ? " selected" : ""}>Teleconverter</option>
              <option value="other"${filters.category === "other" ? " selected" : ""}>Other</option>
            </select>
          </div>
          <div>
            <label for="mount">Mount code</label>
            <input id="mount" name="mount" value="${escapeHtml(filters.mount || "")}" placeholder="e.g. e, rf, z" />
          </div>
          <div style="flex:0 0 auto">
            <label>&nbsp;</label>
            <button type="submit">Apply</button>
          </div>
        </div>
      </form>
    </section>

    <section class="card" aria-label="Results" style="margin-top:16px">
      <h2>Results</h2>
      ${items ? `<ul class="clean">${items}</ul>` : `<p class="subtle">No results.</p>`}
      <div class="row" style="margin-top:10px;align-items:center">
        <div>
          <span class="subtle">Showing ${escapeHtml(String(lenses.length))} items • offset ${escapeHtml(String(page.offset))}</span>
        </div>
        <div style="flex:0 0 auto;display:flex;gap:10px">
          ${prevHref ? `<a href="${prevHref}">Prev</a>` : `<span class="subtle">Prev</span>`}
          ${nextHref ? `<a href="${nextHref}">Next</a>` : `<span class="subtle">Next</span>`}
        </div>
      </div>
    </section>
  `;

  return documentHtml({
    title: "Lenses • Fast Focus",
    description: "Browse lens models with canonical brand/model URLs.",
    canonicalUrl,
    robots,
    bodyHtml,
  });
}

export function renderBrandsIndexHtml({ canonicalUrl, brands = [] }) {
  const items = brands
    .map((b) => `<li><a href="/brands/${encodeURIComponent(b.slug)}">${escapeHtml(b.name)}</a> <span class="subtle">${escapeHtml(b.slug)}</span></li>`)
    .join("");

  const bodyHtml = `
    <h1>Brands</h1>
    <p class="subtle">Brand hubs: <code>/brands/{brand}</code>.</p>
    <section class="card" aria-label="Brand list">
      <h2>All brands</h2>
      ${items ? `<ul class="clean">${items}</ul>` : `<p class="subtle">No brands yet.</p>`}
    </section>
  `;

  return documentHtml({
    title: "Brands • Fast Focus",
    description: "Browse brands and jump to brand hubs.",
    canonicalUrl,
    bodyHtml,
  });
}

export function renderBrandHubHtml({ canonicalUrl, robots = null, brand, cameras = [], lenses = [], q = "" }) {
  const query = isNonEmptyString(q) ? q.trim() : "";

  const cameraItems = cameras
    .map((c) => {
      const href = cameraCanonicalPath(c);
      const title = escapeHtml(c.display_name || c.slug);
      const meta = [c.release_year ? String(c.release_year) : null, c.sensor_format, c.mount_code]
        .filter(Boolean)
        .map((v) => escapeHtml(String(v)))
        .join(" • ");
      return `<li><a href="${href}">${title}</a>${meta ? `<div class="subtle">${meta}</div>` : ""}</li>`;
    })
    .join("");

  const lensItems = lenses
    .map((l) => {
      const href = lensCanonicalPath(l);
      const title = escapeHtml(l.display_name || l.slug);
      const meta = [l.release_year ? String(l.release_year) : null, l.mount_code, l.lens_category]
        .filter(Boolean)
        .map((v) => escapeHtml(String(v)))
        .join(" • ");
      return `<li><a href="${href}">${title}</a>${meta ? `<div class="subtle">${meta}</div>` : ""}</li>`;
    })
    .join("");

  const bodyHtml = `
    <h1>${escapeHtml(brand.name)}</h1>
    <p class="subtle">Brand hub: <code>/brands/${escapeHtml(brand.slug)}</code></p>

    <section class="card" aria-label="Search within brand">
      <h2>Search within ${escapeHtml(brand.name)}</h2>
      <form action="/brands/${encodeURIComponent(brand.slug)}" method="get" aria-label="Brand search">
        <div class="row">
          <div>
            <label for="q">Search</label>
            <input id="q" name="q" value="${escapeHtml(query)}" placeholder="e.g., a7, 24-70, 50mm" />
          </div>
          <div style="flex:0 0 auto">
            <label>&nbsp;</label>
            <button type="submit">Search</button>
          </div>
          ${
            query
              ? `<div style="flex:0 0 auto">
                  <label>&nbsp;</label>
                  <a href="/brands/${encodeURIComponent(brand.slug)}">Clear</a>
                </div>`
              : ""
          }
        </div>
      </form>
      <p class="subtle">Tip: for broader filters, use <a href="/cameras">/cameras</a> and <a href="/lenses">/lenses</a>.</p>
    </section>

    <div class="grid">
      <section class="card" aria-label="Cameras">
        <h2>Cameras (${escapeHtml(String(cameras.length))})</h2>
        ${cameraItems ? `<ul class="clean">${cameraItems}</ul>` : `<p class="subtle">No cameras found.</p>`}
      </section>
      <section class="card" aria-label="Lenses">
        <h2>Lenses (${escapeHtml(String(lenses.length))})</h2>
        ${lensItems ? `<ul class="clean">${lensItems}</ul>` : `<p class="subtle">No lenses found.</p>`}
      </section>
    </div>
  `;

  return documentHtml({
    title: `${brand.name} • Fast Focus`,
    description: `Browse ${brand.name} camera and lens models.`,
    canonicalUrl,
    robots,
    bodyHtml,
  });
}

export function renderCompareIndexHtml({ canonicalUrl, cameras = [], currency = "EUR" }) {
  const options =
    cameras && cameras.length
      ? cameras
          .map((c) => `<option value="${escapeHtml(c.slug)}">${escapeHtml(c.display_name || c.slug)}</option>`)
          .join("")
      : "";

  const listId = "camera_slugs";

  const bodyHtml = `
    <h1>Compare</h1>
    <p class="subtle">Canonical comparisons: <code>/compare/{modelA}-vs-{modelB}</code> (camera slugs for now).</p>

    <section class="card" aria-label="Compare form">
      <h2>Build a comparison</h2>
      <form action="/compare" method="get" aria-label="Compare form">
        <div class="row">
          <div>
            <label for="a">Model A slug</label>
            <input id="a" name="a" placeholder="e.g. sony-a7-iv" list="${listId}" />
          </div>
          <div>
            <label for="b">Model B slug</label>
            <input id="b" name="b" placeholder="e.g. nikon-z6-ii" list="${listId}" />
          </div>
          <div>
            <label for="currency">Currency</label>
            <select id="currency" name="currency">
              <option value="EUR"${currency === "EUR" ? " selected" : ""}>EUR</option>
              <option value="USD"${currency === "USD" ? " selected" : ""}>USD</option>
              <option value="GBP"${currency === "GBP" ? " selected" : ""}>GBP</option>
            </select>
          </div>
          <div style="flex:0 0 auto">
            <label>&nbsp;</label>
            <button type="submit">Compare</button>
          </div>
        </div>
      </form>
    </section>

    ${options ? `<datalist id="${listId}">${options}</datalist>` : ""}
    <p class="subtle">Tip: you can copy slugs from <a href="/cameras">/cameras</a>, or start typing to see suggestions.</p>
  `;

  return documentHtml({
    title: "Compare • Fast Focus",
    description: "Compare two camera models.",
    canonicalUrl,
    bodyHtml,
  });
}

export function renderComparePageHtml({
  canonicalUrl,
  robots = null,
  cameraA,
  cameraB,
  priceBandA = null,
  priceBandB = null,
  currency = "EUR",
  comparisonSections = null,
}) {
  const aMedian = priceBandA ? formatMoney(priceBandA.median, priceBandA.currency || currency) : "—";
  const bMedian = priceBandB ? formatMoney(priceBandB.median, priceBandB.currency || currency) : "—";
  const aIqr =
    priceBandA && priceBandA.p25 !== null && priceBandA.p25 !== undefined && priceBandA.p75 !== null && priceBandA.p75 !== undefined
      ? `${formatMoney(priceBandA.p25, priceBandA.currency || currency)}–${formatMoney(priceBandA.p75, priceBandA.currency || currency)}`
      : "—";
  const bIqr =
    priceBandB && priceBandB.p25 !== null && priceBandB.p25 !== undefined && priceBandB.p75 !== null && priceBandB.p75 !== undefined
      ? `${formatMoney(priceBandB.p25, priceBandB.currency || currency)}–${formatMoney(priceBandB.p75, priceBandB.currency || currency)}`
      : "—";

  function isHttpUrl(value) {
    if (!isNonEmptyString(value)) return false;
    const s = value.trim().toLowerCase();
    return s.startsWith("http://") || s.startsWith("https://");
  }

  function urlLinkHtml(url) {
    if (!isHttpUrl(url)) return null;
    const safeUrl = url.trim();
    let label = safeUrl;
    try {
      label = new URL(safeUrl).hostname;
    } catch {
      // ignore
    }
    return `<a href="${escapeHtml(safeUrl)}" rel="nofollow">${escapeHtml(label)}</a>`;
  }

  function formatPxDims(obj) {
    if (!obj || typeof obj !== "object") return null;
    const w = obj.w ?? null;
    const h = obj.h ?? null;
    if (!Number.isFinite(Number(w)) || !Number.isFinite(Number(h))) return null;
    return `${Number(w)}×${Number(h)}`;
  }

  function formatRatio(obj) {
    if (!obj || typeof obj !== "object") return null;
    const w = obj.w ?? null;
    const h = obj.h ?? null;
    if (!Number.isFinite(Number(w)) || !Number.isFinite(Number(h))) return null;
    return `${Number(w)}:${Number(h)}`;
  }

  function formatMmDims(obj) {
    if (!obj || typeof obj !== "object") return null;
    const w = obj.w ?? null;
    const h = obj.h ?? null;
    const d = obj.d ?? null;
    if (!Number.isFinite(Number(w)) || !Number.isFinite(Number(h))) return null;
    if (d === null || d === undefined) return `${Number(w)}×${Number(h)} mm`;
    if (!Number.isFinite(Number(d))) return `${Number(w)}×${Number(h)} mm`;
    return `${Number(w)}×${Number(h)}×${Number(d)} mm`;
  }

  function formatRange(obj, unit = "") {
    if (!obj || typeof obj !== "object") return null;
    const min = obj.min ?? null;
    const max = obj.max ?? null;
    if (!Number.isFinite(Number(min)) || !Number.isFinite(Number(max))) return null;
    const suffix = unit ? ` ${unit}` : "";
    if (Number(min) === Number(max)) return `${Number(min)}${suffix}`;
    return `${Number(min)}–${Number(max)}${suffix}`;
  }

  function formatValue(fieldPath, value) {
    if (value === null || value === undefined) return null;

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return null;

      const link = urlLinkHtml(trimmed);
      if (link) return link;

      if (fieldPath === "classification.mount_code") {
        const pretty = MOUNT_LABELS[trimmed] || humanLabel(trimmed) || trimmed;
        return escapeHtml(pretty);
      }
      if (fieldPath === "classification.camera_category") return escapeHtml(enumLabel(trimmed, CAMERA_CATEGORY_LABELS) || trimmed);
      if (fieldPath === "classification.lens_system_type") return escapeHtml(enumLabel(trimmed, LENS_SYSTEM_TYPE_LABELS) || trimmed);
      if (fieldPath.endsWith(".sensor_format")) return escapeHtml(enumLabel(trimmed, SENSOR_FORMAT_LABELS) || trimmed);
      if (fieldPath.endsWith(".type") && fieldPath.includes("viewfinder")) return escapeHtml(enumLabel(trimmed, VIEWFINDER_TYPE_LABELS) || trimmed);

      const maxLen = 180;
      return escapeHtml(trimmed.length > maxLen ? `${trimmed.slice(0, maxLen - 1)}…` : trimmed);
    }

    if (typeof value === "number") {
      if (!Number.isFinite(value)) return null;
      return escapeHtml(String(value));
    }

    if (typeof value === "boolean") return escapeHtml(value ? "Yes" : "No");

    if (Array.isArray(value)) {
      const items = value
        .map((v) => formatValue(fieldPath, v))
        .filter((v) => v !== null && v !== undefined);
      if (items.length === 0) return null;
      const joined = items.join(", ");
      const maxLen = 220;
      return joined.length > maxLen ? `${joined.slice(0, maxLen - 1)}…` : joined;
    }

    if (typeof value === "object") {
      if (fieldPath === "release.launch_msrp.body_only") {
        const amount = value.amount ?? null;
        const cur = value.currency ?? null;
        const money = formatMoney(amount, cur);
        return money === "—" ? null : escapeHtml(money);
      }

      const ratio = formatRatio(value);
      if (ratio && fieldPath.includes("image_ratio")) return escapeHtml(ratio);

      const px = formatPxDims(value);
      if (px && fieldPath.includes("max_resolution_px")) return escapeHtml(`${px} px`);
      if (px) return escapeHtml(px);

      const mm = formatMmDims(value);
      if (mm && (fieldPath.includes("dimensions_mm") || fieldPath.includes("physical_dimensions_mm"))) return escapeHtml(mm);

      const rangeCm = formatRange(value, "cm");
      if (rangeCm && (fieldPath.includes("focus_range_cm") || fieldPath.includes("focus_range"))) return escapeHtml(rangeCm);

      const safe = safeJsonObject(value);
      if (safe) {
        const keys = Object.keys(safe);
        if (keys.length === 0) return null;
        const text = JSON.stringify(safe);
        const maxLen = 180;
        return escapeHtml(text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text);
      }
    }

    return escapeHtml(String(value));
  }

  function resolveField(camera, fieldPath) {
    if (!camera || typeof camera !== "object") return undefined;
    if (!isNonEmptyString(fieldPath)) return undefined;

    if (fieldPath.startsWith("specs.")) {
      const specs = safeJsonObject(camera.digital_specs) || {};
      const v = getPath(specs, fieldPath.slice("specs.".length));

      // Useful fallbacks from first-class columns.
      if (v === undefined) {
        if (fieldPath === "specs.sensor.sensor_format") return camera.sensor_format ?? null;
        if (fieldPath === "specs.sensor.effective_resolution_mp") return camera.resolution_mp ?? null;
        if (fieldPath === "specs.stabilization.ibis") return camera.ibis ?? null;
        if (fieldPath === "specs.body.weather_sealed") return camera.weather_sealed ?? null;
        if (fieldPath === "specs.body.weight_with_battery_g") return camera.weight_g ?? null;
        if (fieldPath === "specs.video.max_internal.resolution" || fieldPath === "specs.video.max_internal") return camera.video_max ?? null;
        if (fieldPath === "specs.body.dimensions_mm") {
          if (camera.dimensions_w_mm && camera.dimensions_h_mm && camera.dimensions_d_mm) {
            return { w: camera.dimensions_w_mm, h: camera.dimensions_h_mm, d: camera.dimensions_d_mm };
          }
        }
      }

      return v;
    }

    if (fieldPath.startsWith("links.")) {
      const links = safeJsonObject(camera.links) || {};
      return getPath(links, fieldPath.slice("links.".length));
    }

    switch (fieldPath) {
      case "release.announce_date":
        return camera.announce_date || null;
      case "release.release_year":
        return camera.release_year ?? null;
      case "release.launch_msrp.body_only":
        return camera.msrp_amount !== null && camera.msrp_amount !== undefined
          ? { amount: camera.msrp_amount, currency: camera.msrp_currency || null }
          : null;

      case "classification.camera_category":
        return camera.camera_category || null;
      case "classification.lens_system_type":
        return camera.lens_system_type || null;
      case "classification.mount_code":
        return camera.mount_code || null;
      case "classification.fixed_lens.focal_length_basis":
        return camera.fixed_focal_length_basis || null;
      case "classification.fixed_lens.focal_length_min_mm":
        return camera.fixed_focal_length_min_mm ?? null;
      case "classification.fixed_lens.focal_length_max_mm":
        return camera.fixed_focal_length_max_mm ?? null;
      case "classification.fixed_lens.max_aperture_wide_f":
        return camera.fixed_max_aperture_wide_f ?? null;
      case "classification.fixed_lens.max_aperture_tele_f":
        return camera.fixed_max_aperture_tele_f ?? null;

      default:
        return undefined;
    }
  }

  function formatCombined(camera, fieldPaths) {
    const parts = [];
    for (const p of fieldPaths) {
      const raw = resolveField(camera, p);
      const formatted = formatValue(p, raw);
      if (formatted !== null && formatted !== undefined) parts.push(formatted);
    }
    if (parts.length === 0) return "—";

    // Special-case: sensor size often combines a label + mm dims.
    if (fieldPaths.includes("specs.sensor.sensor_format") && fieldPaths.includes("specs.sensor.physical_dimensions_mm")) {
      if (parts.length === 2) return `${parts[0]} (${parts[1]})`;
    }

    return parts.join(" • ");
  }

  function renderCompareTable(sectionLabel, rows) {
    const tableRows = rows
      .map((row) => {
        const aText = row.aHtml ?? "—";
        const bText = row.bHtml ?? "—";
        return `<tr><th scope="row">${escapeHtml(row.label)}</th><td>${aText}</td><td>${bText}</td></tr>`;
      })
      .join("");

    return `
      <section class="card" aria-label="${escapeHtml(sectionLabel)}">
        <h2>${escapeHtml(sectionLabel)}</h2>
        <table aria-label="${escapeHtml(sectionLabel)} comparison">
          <thead>
            <tr>
              <th scope="col">Spec</th>
              <th scope="col">${escapeHtml(cameraA.display_name)}</th>
              <th scope="col">${escapeHtml(cameraB.display_name)}</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </section>
    `;
  }

  const aHref = cameraCanonicalPath(cameraA);
  const bHref = cameraCanonicalPath(cameraB);

  const usedMarketSection = renderCompareTable("Used market (Fast Focus)", [
    { label: "Typical used price (median)", aHtml: escapeHtml(aMedian), bHtml: escapeHtml(bMedian) },
    { label: "Typical used price (P25–P75)", aHtml: escapeHtml(aIqr), bHtml: escapeHtml(bIqr) },
  ]);

  const sectionDefs = Array.isArray(comparisonSections) ? comparisonSections : [];
  const dpreviewTables =
    sectionDefs.length > 0
      ? sectionDefs
          .map((sec) => {
            const rows = (sec.rows || []).map((r) => ({
              label: r.label,
              aHtml: formatCombined(cameraA, r.field_paths || []),
              bHtml: formatCombined(cameraB, r.field_paths || []),
            }));
            return renderCompareTable(sec.label, rows);
          })
          .join("")
      : renderCompareTable("Key specs", [
          { label: "Brand", aHtml: escapeHtml(cameraA.brand_name || cameraA.brand_slug), bHtml: escapeHtml(cameraB.brand_name || cameraB.brand_slug) },
          { label: "Release year", aHtml: escapeHtml(String(cameraA.release_year ?? "—")), bHtml: escapeHtml(String(cameraB.release_year ?? "—")) },
          { label: "Sensor format", aHtml: escapeHtml(enumLabel(cameraA.sensor_format, SENSOR_FORMAT_LABELS) || "—"), bHtml: escapeHtml(enumLabel(cameraB.sensor_format, SENSOR_FORMAT_LABELS) || "—") },
          { label: "Resolution (MP)", aHtml: escapeHtml(String(cameraA.resolution_mp ?? "—")), bHtml: escapeHtml(String(cameraB.resolution_mp ?? "—")) },
          { label: "Mount", aHtml: escapeHtml(cameraA.mount_code || "—"), bHtml: escapeHtml(cameraB.mount_code || "—") },
        ]);

  const bodyHtml = `
    <h1>${escapeHtml(cameraA.display_name)} vs ${escapeHtml(cameraB.display_name)}</h1>
    <p class="subtle">
      Model pages:
      <a href="${aHref}">${escapeHtml(cameraA.slug)}</a> •
      <a href="${bHref}">${escapeHtml(cameraB.slug)}</a>
    </p>
    <p class="subtle">Price bands are computed from matched active listings and may lag the live market.</p>

    ${usedMarketSection}
    ${dpreviewTables}
  `;

  return documentHtml({
    title: `${cameraA.display_name} vs ${cameraB.display_name} • Fast Focus`,
    description: `Compare ${cameraA.display_name} vs ${cameraB.display_name}.`,
    canonicalUrl,
    robots,
    bodyHtml,
  });
}

export function renderAboutPageHtml({ canonicalUrl }) {
  const bodyHtml = `
    <h1>About Fast Focus</h1>
    <p class="subtle">
      Fast Focus is a Phase 1 MVP for used camera and lens discovery: browse models, see typical used price bands, and click out to live listings.
    </p>

    <section class="card" aria-label="How it works">
      <h2>How it works (today)</h2>
      <ol>
        <li>Ingest live marketplace listings (starting with eBay in Phase 1).</li>
        <li>Normalize listings into a consistent schema (price, shipping, condition, location, etc.).</li>
        <li>Match listings to canonical camera/lens models in the catalog.</li>
        <li>Compute typical asking-price bands from matched active listings.</li>
      </ol>
      <p class="subtle">Methodology endpoint: <a href="/api/v1/price-bands/methodology">/api/v1/price-bands/methodology</a>.</p>
    </section>

    <section class="card" aria-label="How to use">
      <h2>How to use the site</h2>
      <ul>
        <li><a href="/">Homepage</a> shows marketplace freshness and featured models.</li>
        <li><a href="/cameras">Cameras</a> and <a href="/lenses">Lenses</a> provide search + filters.</li>
        <li>Model pages show specs, a used-buyer checklist, and matched listings.</li>
        <li><a href="/compare">Compare</a> puts two models side-by-side.</li>
        <li><a href="/guides">Guides</a> covers inspection and buying tips.</li>
      </ul>
    </section>

    <section class="card" aria-label="Disclosure">
      <h2>Affiliate disclosure</h2>
      <p class="subtle">
        Outbound links to marketplaces may be affiliate links. If you buy through a link, Fast Focus may earn a commission at no extra cost to you.
      </p>
    </section>
  `;

  return documentHtml({
    title: "About • Fast Focus",
    description: "About the Fast Focus used camera and lens discovery MVP.",
    canonicalUrl,
    bodyHtml,
  });
}

export function renderPrivacyPageHtml({ canonicalUrl }) {
  const bodyHtml = `
    <h1>Privacy</h1>
    <p class="subtle">This page describes what the Phase 1 MVP stores when you browse and click out to listings.</p>

    <section class="card" aria-label="Data we store">
      <h2>Data we store (application database)</h2>
      <ul>
        <li>A random session id cookie (<code>ff_sid</code>) to associate click-out events (only when consent is enabled; see below).</li>
        <li>Click-out events: listing id, page type, timestamp, and destination marketplace code.</li>
        <li>Technical context for debugging and attribution: user agent, referrer, and UTM parameters (if present).</li>
      </ul>
      <p class="subtle">The application does not store IP addresses in its database. Your hosting provider may keep standard server logs.</p>
    </section>

    <section class="card" aria-label="Cookies">
      <h2>Cookies</h2>
      <p class="subtle">
        The <code>ff_sid</code> cookie is set only when you click an outbound listing link <em>and</em> you have enabled attribution tracking below.
        It is <code>HttpOnly</code>, <code>SameSite=Lax</code>, and configured for a 30-day max age.
      </p>
      <p class="subtle">
        The <code>ff_pro</code> cookie is set when you confirm Premium. It is <code>HttpOnly</code>, <code>SameSite=Lax</code>, and configured for a
        365-day max age. It is cleared if you cancel Premium.
      </p>
      <div class="subtle">
        <p><strong>Attribution tracking preference</strong></p>
        <ul>
          <li><a href="/consent?analytics=true&amp;return_to=/privacy">Enable</a> click-out attribution tracking</li>
          <li><a href="/consent?analytics=false&amp;return_to=/privacy">Disable</a> click-out attribution tracking</li>
        </ul>
        <p>
          If your browser sends a global opt-out signal (GPC or Do Not Track), Fast Focus will not record click-out events even if enabled here.
        </p>
      </div>
    </section>

    <section class="card" aria-label="Retention">
      <h2>Retention</h2>
      <p class="subtle">
        Default retention targets (production): click-out events are deleted after 90 days; operational logs (ingestion runs) after 180 days; and audit
        logs after 365 days. These windows are designed to keep data minimization explicit (governance WP-0020).
      </p>
    </section>

    <section class="card" aria-label="Email alerts">
      <h2>Email alerts</h2>
      <p class="subtle">
        If you create a saved search for email alerts, Fast Focus stores your email address, your saved search filters, and a record of alert emails sent.
        Saved search confirmation is double opt-in (you must click the confirmation link).
      </p>
      <p class="subtle">
        Default retention targets (production): unconfirmed saved searches are deleted after 14 days; unsubscribed saved searches after 30 days; and email
        message logs after 30 days.
      </p>
    </section>

    <section class="card" aria-label="Newsletter">
      <h2>Newsletter</h2>
      <p class="subtle">
        If you subscribe to the weekly deals newsletter, Fast Focus stores your email address and a record of newsletter emails sent. Newsletter
        confirmation is double opt-in (you must click the confirmation link).
      </p>
      <p class="subtle">
        Default retention targets (production): unconfirmed newsletter subscriptions are deleted after 14 days; unsubscribed newsletter subscriptions
        after 30 days; and email message logs after 30 days.
      </p>
    </section>

    <section class="card" aria-label="Premium">
      <h2>Premium</h2>
      <p class="subtle">
        If you request Premium, Fast Focus stores your email address and a subscription record including confirmation/cancel tokens. Premium confirmation is
        double opt-in (you must click the confirmation link).
      </p>
      <p class="subtle">
        Default retention targets (production): unconfirmed premium requests are deleted after 14 days; canceled premium subscriptions after 30 days; and
        email message logs after 30 days.
      </p>
    </section>
  `;

  return documentHtml({
    title: "Privacy • Fast Focus",
    description: "Privacy information for the Fast Focus Phase 1 MVP.",
    canonicalUrl,
    bodyHtml,
  });
}

export function renderAlertConfirmResultHtml({ canonicalUrl, alreadyConfirmed = false } = {}) {
  const bodyHtml = `
    <h1>Alerts confirmed</h1>
    <p class="subtle">${alreadyConfirmed ? "This alert was already confirmed." : "Thanks — alerts are now enabled."}</p>

    <section class="card" aria-label="Next steps">
      <h2>Next steps</h2>
      <ul>
        <li>You’ll receive an email when new matching listings are found (batch/scheduled).</li>
        <li>Unsubscribe links are included in every email.</li>
      </ul>
      <p class="subtle"><a href="/privacy">Privacy</a></p>
    </section>
  `;

  return documentHtml({
    title: "Alerts confirmed â€¢ Fast Focus",
    description: "Your Fast Focus alert is confirmed.",
    canonicalUrl,
    bodyHtml,
  });
}

export function renderAlertUnsubscribeResultHtml({ canonicalUrl } = {}) {
  const bodyHtml = `
    <h1>Unsubscribed</h1>
    <p class="subtle">You’ll no longer receive alerts for this saved search.</p>
    <p class="subtle"><a href="/privacy">Privacy</a></p>
  `;

  return documentHtml({
    title: "Unsubscribed â€¢ Fast Focus",
    description: "You have unsubscribed from a Fast Focus alert.",
    canonicalUrl,
    bodyHtml,
  });
}

export function renderNewsletterSignupPageHtml({ canonicalUrl, status = null, error = null } = {}) {
  const msg = error
    ? `<p class="subtle"><strong>Error:</strong> ${escapeHtml(String(error))}</p>`
    : status
      ? `<p class="subtle">${escapeHtml(String(status))}</p>`
      : `<p class="subtle">Weekly deals newsletter. Double opt-in. Unsubscribe in one click.</p>`;

  const bodyHtml = `
    <h1>Newsletter</h1>
    ${msg}

    <section class="card" aria-label="Newsletter signup">
      <h2>Subscribe</h2>
      <form method="POST" action="/newsletter">
        <label>Email<br /><input type="email" name="email" required autocomplete="email" style="max-width: 28rem; width: 100%;" /></label>

        <fieldset style="margin-top: 1rem;">
          <legend><strong>Segment</strong></legend>
          <label><input type="radio" name="segment" value="all" checked /> All deals</label><br />
          <label><input type="radio" name="segment" value="street" /> Street (compact/carry-friendly)</label><br />
          <label><input type="radio" name="segment" value="hybrid" /> Hybrid (stills + video bodies)</label><br />
          <label><input type="radio" name="segment" value="video" /> Video (video-first bodies)</label><br />
          <label><input type="radio" name="segment" value="retro" /> Retro (film and older classics)</label>
        </fieldset>

        <p style="margin-top: 1rem;"><button type="submit">Subscribe</button></p>
      </form>
      <p class="subtle">Unsubscribe links are included in every email.</p>
      <p class="subtle"><a href="/privacy">Privacy</a></p>
    </section>
  `;

  return documentHtml({
    title: "Newsletter • Fast Focus",
    description: "Subscribe to the Fast Focus weekly deals newsletter.",
    canonicalUrl,
    bodyHtml,
  });
}

export function renderNewsletterConfirmResultHtml({ canonicalUrl, alreadyConfirmed = false } = {}) {
  const bodyHtml = `
    <h1>Newsletter confirmed</h1>
    <p class="subtle">${alreadyConfirmed ? "This subscription was already confirmed." : "Thanks — you are subscribed."}</p>
    <p class="subtle"><a href="/privacy">Privacy</a></p>
  `;

  return documentHtml({
    title: "Newsletter confirmed • Fast Focus",
    description: "Your Fast Focus newsletter subscription is confirmed.",
    canonicalUrl,
    bodyHtml,
  });
}

export function renderNewsletterUnsubscribeResultHtml({ canonicalUrl } = {}) {
  const bodyHtml = `
    <h1>Unsubscribed</h1>
    <p class="subtle">You will no longer receive the Fast Focus newsletter.</p>
    <p class="subtle"><a href="/privacy">Privacy</a></p>
  `;

  return documentHtml({
    title: "Unsubscribed • Fast Focus",
    description: "You have unsubscribed from the Fast Focus newsletter.",
    canonicalUrl,
    bodyHtml,
  });
}

export function renderPremiumSignupPageHtml({ canonicalUrl, status = null, error = null } = {}) {
  const msg = error
    ? `<p class="subtle"><strong>Error:</strong> ${escapeHtml(String(error))}</p>`
    : status
      ? `<p class="subtle">${escapeHtml(String(status))}</p>`
      : `<p class="subtle">Premium (Pro). Double opt-in via email. Cancel any time.</p>`;

  const bodyHtml = `
    <h1>Premium</h1>
    ${msg}

    <section class="card" aria-label="Premium signup">
      <h2>Upgrade</h2>
      <form method="POST" action="/premium">
        <label>Email<br /><input type="email" name="email" required autocomplete="email" style="max-width: 28rem; width: 100%;" /></label>
        <p style="margin-top: 1rem;"><button type="submit">Send confirmation link</button></p>
      </form>
      <p class="subtle">Confirm via the email link to enable premium features on this device.</p>
      <p class="subtle"><a href="/privacy">Privacy</a></p>
    </section>
  `;

  return documentHtml({
    title: "Premium • Fast Focus",
    description: "Upgrade to Fast Focus Premium (Pro).",
    canonicalUrl,
    bodyHtml,
  });
}

export function renderPremiumConfirmResultHtml({ canonicalUrl, alreadyConfirmed = false } = {}) {
  const bodyHtml = `
    <h1>Premium confirmed</h1>
    <p class="subtle">${alreadyConfirmed ? "This subscription was already confirmed." : "Thanks — premium is now enabled on this device."}</p>
    <p class="subtle"><a href="/privacy">Privacy</a></p>
  `;

  return documentHtml({
    title: "Premium confirmed • Fast Focus",
    description: "Your Fast Focus Premium subscription is confirmed.",
    canonicalUrl,
    bodyHtml,
  });
}

export function renderPremiumCancelResultHtml({ canonicalUrl, alreadyCanceled = false } = {}) {
  const bodyHtml = `
    <h1>Premium canceled</h1>
    <p class="subtle">${alreadyCanceled ? "This subscription was already canceled." : "You will no longer have premium access."}</p>
    <p class="subtle"><a href="/privacy">Privacy</a></p>
  `;

  return documentHtml({
    title: "Premium canceled • Fast Focus",
    description: "Your Fast Focus Premium subscription is canceled.",
    canonicalUrl,
    bodyHtml,
  });
}

export function renderPremiumPriceHistoryPageHtml({ canonicalUrl, kind, model, series = [], filters = {} } = {}) {
  const safeKind = kind === "lens" ? "lens" : "camera";
  const name = model?.display_name || model?.slug || "Model";
  const currency = filters.currency || "EUR";

  const rows = Array.isArray(series) ? series : [];
  const body = rows
    .map((r) => {
      const date = r.observed_date || "—";
      const sample = Number(r.sample_size || 0);
      const p25 = formatMoney(r.p25, currency);
      const med = formatMoney(r.median, currency);
      const p75 = formatMoney(r.p75, currency);
      const min = formatMoney(r.min, currency);
      const max = formatMoney(r.max, currency);
      return `<tr>
        <td>${escapeHtml(String(date))}</td>
        <td>${escapeHtml(String(sample))}</td>
        <td>${escapeHtml(String(min))}</td>
        <td>${escapeHtml(String(p25))}</td>
        <td>${escapeHtml(String(med))}</td>
        <td>${escapeHtml(String(p75))}</td>
        <td>${escapeHtml(String(max))}</td>
      </tr>`;
    })
    .join("");

  const table = body
    ? `<table aria-label="Price history">
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Sample</th>
            <th scope="col">Min</th>
            <th scope="col">P25</th>
            <th scope="col">Median</th>
            <th scope="col">P75</th>
            <th scope="col">Max</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>`
    : `<p class="subtle">No observations found for this window.</p>`;

  const jsonHref =
    safeKind === "lens"
      ? `/api/v1/premium/lenses/${encodeURIComponent(model?.slug || "")}/price-history`
      : `/api/v1/premium/cameras/${encodeURIComponent(model?.slug || "")}/price-history`;

  const bodyHtml = `
    <h1>${escapeHtml(String(name))} • Price history</h1>
    <p class="subtle">Premium view. Currency: <code>${escapeHtml(String(currency))}</code></p>
    <p class="subtle"><a href="${escapeHtml(jsonHref)}" rel="nofollow">JSON</a></p>
    ${table}
    <p class="subtle"><a href="/privacy">Privacy</a></p>
  `;

  return documentHtml({
    title: `${name} price history • Fast Focus`,
    description: `Premium price history for ${name}.`,
    canonicalUrl,
    bodyHtml,
  });
}

export function renderGuidesIndexHtml({ canonicalUrl }) {
  const guides = [
    {
      topic: "how-to-buy-used-camera",
      title: "How to buy a used camera",
      description: "A step-by-step checklist: inspection, price-checking, and questions to ask.",
    },
    {
      topic: "how-to-check-lens-condition",
      title: "How to check lens condition",
      description: "How to spot fungus/haze, test mechanics, and verify optical performance.",
    },
  ];

  const items = guides
    .map(
      (g) =>
        `<li><a href="/guides/${encodeURIComponent(g.topic)}">${escapeHtml(g.title)}</a><div class="subtle">${escapeHtml(g.description)}</div></li>`,
    )
    .join("");

  const bodyHtml = `
    <h1>Guides</h1>
    <p class="subtle">Practical help for buying used cameras and lenses. Canonical: <code>/guides/{topic}</code>.</p>
    <section class="card" aria-label="Guides">
      <h2>All guides</h2>
      ${items ? `<ul class="clean">${items}</ul>` : `<p class="subtle">No guides yet.</p>`}
    </section>
  `;

  return documentHtml({
    title: "Guides • Fast Focus",
    description: "Buying guides for used cameras and lenses.",
    canonicalUrl,
    bodyHtml,
  });
}

export function isKnownGuideTopic(topic) {
  return topic === "how-to-buy-used-camera" || topic === "how-to-check-lens-condition";
}

export function renderGuidePageHtml({ canonicalUrl, topic }) {
  const safeTopic = escapeHtml(topic);

  const buyUsedCamera = `
    <h1>How to buy a used camera</h1>
    <p class="subtle">Use this checklist to inspect the listing, validate the price, and reduce risk.</p>

    <section class="card" aria-label="Quick checks">
      <h2>Quick checks (60 seconds)</h2>
      <ol>
        <li>Confirm the exact model name + mount (avoid near-identical variants).</li>
        <li>Scan photos for dents, impact marks, cracked LCD, and missing screws.</li>
        <li>Look for a clear photo of the sensor (digital) or film chamber (film).</li>
        <li>Verify what’s included: battery, charger, body cap, strap, box, paperwork.</li>
      </ol>
    </section>

    <section class="card" aria-label="Price check">
      <h2>Price-check with Fast Focus</h2>
      <ol>
        <li>Open the model page and note the <strong>typical used price</strong> (median + range).</li>
        <li>Scroll to <strong>Listings</strong> to see what matched live listings look like in your currency.</li>
        <li>Adjust for condition: heavy wear, missing accessories, or uncertain functionality should be discounted.</li>
      </ol>
      <p class="subtle">Start here: <a href="/cameras">browse cameras</a>.</p>
    </section>

    <section class="card" aria-label="Questions to ask">
      <h2>Questions to ask the seller</h2>
      <ul>
        <li>Any known issues? Intermittent errors, sticky buttons, EVF/LCD artifacts, overheating?</li>
        <li>Has it been dropped, exposed to water, or stored in high humidity?</li>
        <li>Can you share additional photos: mount, ports, battery compartment, and close-ups of wear points?</li>
        <li>Return policy: who pays shipping, and what condition is required?</li>
      </ul>
    </section>

    <section class="card" aria-label="Red flags">
      <h2>Red flags</h2>
      <ul>
        <li>Stock photos only, or photos that don’t match the model name in the title.</li>
        <li>“Untested” / “as-is” for a modern digital body (unless you’re buying for parts).</li>
        <li>Missing serial/label photos, or seller refuses to provide close-ups.</li>
        <li>Price far below the typical range with vague explanation.</li>
      </ul>
    </section>

    <p class="subtle">This guide is general advice, not a guarantee. Always do a quick functional test as soon as the item arrives.</p>
  `;

  const checkLensCondition = `
    <h1>How to check lens condition</h1>
    <p class="subtle">A practical inspection checklist for lens listings, especially when buying online.</p>

    <section class="card" aria-label="Photos to request">
      <h2>Photos to request</h2>
      <ul>
        <li>Front + rear element at an angle (to reveal haze/scratches).</li>
        <li>Lens mount + contacts (look for gouges, corrosion, bent pins).</li>
        <li>Aperture blades (if visible) and any switches (AF/MF, IS, aperture ring).</li>
        <li>Filters/hood threads and any dents around the rim.</li>
      </ul>
    </section>

    <section class="card" aria-label="What to look for">
      <h2>What to look for</h2>
      <ul>
        <li><strong>Fungus:</strong> web-like patterns inside the lens (avoid unless you can return).</li>
        <li><strong>Haze:</strong> cloudy veil that reduces contrast (common in older lenses).</li>
        <li><strong>Separation:</strong> rainbow-like edges near element boundaries (often not fixable).</li>
        <li><strong>Decentering:</strong> one side of the frame consistently softer than the other.</li>
      </ul>
    </section>

    <section class="card" aria-label="Mechanical checks">
      <h2>Mechanical checks</h2>
      <ul>
        <li>Focus/zoom rings should be smooth (no grit, binding, or wobble).</li>
        <li>Aperture should actuate cleanly (no oil on blades, no sticking).</li>
        <li>AF and stabilization (if present) should not grind, squeal, or hunt excessively.</li>
      </ul>
      <p class="subtle">Start here: <a href="/lenses">browse lenses</a>.</p>
    </section>

    <section class="card" aria-label="On arrival test">
      <h2>When it arrives (10-minute test)</h2>
      <ol>
        <li>Shoot a brick wall / bookshelf at wide open and at f/5.6 (check sharpness symmetry).</li>
        <li>Test AF at near and far distances; listen for unusual noise.</li>
        <li>Check for dust/fungus/haze with a flashlight through the lens.</li>
      </ol>
    </section>

    <p class="subtle">If anything feels off, document it immediately with photos/video and use the return window.</p>
  `;

  const bodyHtml = topic === "how-to-buy-used-camera" ? buyUsedCamera : topic === "how-to-check-lens-condition" ? checkLensCondition : null;
  if (!bodyHtml) {
    return documentHtml({
      title: "Guide not found • Fast Focus",
      description: "Unknown guide topic.",
      canonicalUrl,
      bodyHtml: `<h1>Guide not found</h1><p class="subtle">Unknown guide topic: <code>${safeTopic}</code>.</p><p><a href=\"/guides\">Back to guides</a></p>`,
    });
  }

  const metaTitle = topic === "how-to-buy-used-camera" ? "How to buy a used camera" : "How to check lens condition";
  const metaDescription =
    topic === "how-to-buy-used-camera"
      ? "A step-by-step checklist for buying a used camera: inspection, price-checking, and questions to ask."
      : "A practical checklist for evaluating lens condition: glass inspection, mechanics, and quick tests.";

  return documentHtml({
    title: `${metaTitle} • Fast Focus`,
    description: metaDescription,
    canonicalUrl,
    bodyHtml,
  });
}
