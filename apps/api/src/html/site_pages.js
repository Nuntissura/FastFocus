import { PRIMARY_NAV_LINKS, SITE_TAGLINE } from "../launch_contract.js";

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
  if (!isNonEmptyString(ts)) return "â€”";
  try {
    return new Date(ts).toISOString();
  } catch {
    return escapeHtml(ts);
  }
}

function ageHoursFromNow(ts) {
  if (!isNonEmptyString(ts)) return null;
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return null;
  const diffHours = (Date.now() - ms) / (1000 * 60 * 60);
  return Number.isFinite(diffHours) && diffHours >= 0 ? diffHours : null;
}

function formatBool(value) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "â€”";
}

function formatMoney(amount, currency) {
  if (amount === null || amount === undefined) return "â€”";
  const n = Number(amount);
  if (!Number.isFinite(n)) return "â€”";
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
  medium_format_44x33: "Medium format (44Ã—33)",
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
  const links = PRIMARY_NAV_LINKS.map(
    (link) => `<a href="${escapeHtml(link.href)}" data-testid="${escapeHtml(link.testId)}">${escapeHtml(link.label)}</a>`,
  ).join("");
  return `
    <nav aria-label="Primary" data-testid="site-primary-nav">
      ${links}
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
      :root { color-scheme: light dark; --accent: #a14c1d; --line: rgba(127,127,127,0.35); }
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
      .tri-grid { display: grid; grid-template-columns: 1fr; gap: 16px; }
      @media (min-width: 900px) { .grid { grid-template-columns: 1fr 1fr; } }
      @media (min-width: 900px) { .tri-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
      .card { border: 1px solid rgba(127,127,127,0.35); border-radius: 12px; padding: 14px 14px; }
      .card h3 { margin: 0 0 8px; font-size: 16px; }
      .hero { border: 1px solid rgba(127,127,127,0.3); border-radius: 20px; padding: 20px; background: linear-gradient(135deg, rgba(161,76,29,0.12), rgba(127,127,127,0.04)); }
      .stack { display: grid; gap: 12px; }
      .eyebrow { font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent); }
      .section-lead { max-width: 58rem; font-size: 1.02rem; }
      .card-link { display: block; border: 1px solid rgba(127,127,127,0.2); border-radius: 12px; padding: 12px; text-decoration: none; }
      .card-link:hover, .card-link:focus-visible { border-color: rgba(127,127,127,0.45); outline: none; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid rgba(127,127,127,0.35); padding: 8px 10px; vertical-align: top; }
      th { text-align: left; }
      label { display: block; font-size: 13px; opacity: 0.85; margin: 10px 0 4px; }
      input, select { width: 100%; max-width: 520px; padding: 8px 10px; border-radius: 10px; border: 1px solid rgba(127,127,127,0.35); background: transparent; color: inherit; }
      button { padding: 8px 12px; border-radius: 10px; border: 1px solid rgba(127,127,127,0.35); background: transparent; color: inherit; cursor: pointer; }
      .row { display: flex; gap: 10px; align-items: end; flex-wrap: wrap; }
      .row > * { flex: 1 1 220px; }
      .cta-row { display: flex; gap: 10px; flex-wrap: wrap; }
      .cta-row a { display: inline-flex; text-decoration: none; border: 1px solid rgba(127,127,127,0.35); border-radius: 999px; padding: 8px 12px; }
      .meta-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
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
    <header data-testid="site-header">
      <div class="wrap">
        <div>
          <strong><a href="/" data-testid="site-logo-link">Fast Focus</a></strong>
          <span class="subtle">${escapeHtml(SITE_TAGLINE)}</span>
        </div>
        ${navHtml()}
      </div>
    </header>
    <main>
      ${bodyHtml}
    </main>
    <footer data-testid="site-footer">
      <div>
        Fast Focus MVP â€¢ Generated ${escapeHtml(new Date().toISOString())} â€¢ <a href="/about">About</a> â€¢ <a href="/privacy">Privacy</a> â€¢
        <a href="/sitemap.xml">Sitemap</a> â€¢ <a href="/llms.txt">LLMs</a>
      </div>
    </footer>
  </body>
</html>
`;
}

export function renderHomePageHtml({
  canonicalUrl,
  dbEnabled,
  dbHint,
  marketplaces = [],
  featuredCameras = [],
  featuredLenses = [],
  featuredCameraSourceLabel = null,
  liveDeals = [],
  recentArrivals = [],
}) {
  const activeListingTotal = marketplaces.reduce((sum, m) => sum + Number(m?.active_listing_count || 0), 0);
  const freshestMarketAgeHours = marketplaces.reduce((best, m) => {
    const ageHours = ageHoursFromNow(m?.last_listing_retrieved_at);
    if (ageHours === null) return best;
    if (best === null) return ageHours;
    return ageHours < best ? ageHours : best;
  }, null);
  const liveCoverageWarning =
    activeListingTotal <= 0 && liveDeals.length === 0 && recentArrivals.length === 0
      ? "Live listing coverage is thin right now. Use the specs, compare pages, and buyer checklists first, and treat market conclusions as incomplete until ingest catches up."
      : freshestMarketAgeHours !== null && freshestMarketAgeHours > 48
        ? "The latest marketplace snapshot looks stale. Check the freshness table before trusting thin price-band or listing conclusions."
        : null;

  const marketRows = marketplaces
    .map((m) => {
      const name = escapeHtml(m.display_name || m.marketplace_code);
      const code = escapeHtml(m.marketplace_code);
      const active = typeof m.active_listing_count === "number" ? String(m.active_listing_count) : "â€”";
      const last = formatMaybeIso(m.last_listing_retrieved_at);
      const status = escapeHtml(m.last_run_status || "â€”");
      return `<tr><th scope="row">${name} <span class="pill">${code}</span></th><td>${active}</td><td>${last}</td><td>${status}</td></tr>`;
    })
    .join("");

  const coverageMode = Boolean(featuredCameraSourceLabel) && featuredCameras.some((camera) => typeof camera.active_listing_count === "number");
  const cameraItems = featuredCameras
    .map((c) => {
      const href = cameraCanonicalPath(c);
      const label = escapeHtml(c.display_name || c.slug);

      if (coverageMode) {
        const metrics = [
          `${escapeHtml(String(c.active_listing_count || 0))} live matches`,
          `${escapeHtml(String(c.recent_listing_count_7d || 0))} new this week`,
          c.best_deal_score !== null && c.best_deal_score !== undefined ? `best deal ${escapeHtml(String(Math.round(Number(c.best_deal_score))))}/100` : null,
          c.last_retrieved_at ? `updated ${escapeHtml(formatMaybeIso(c.last_retrieved_at))}` : null,
        ]
          .filter(Boolean)
          .join(" | ");
        return `<article class="card" data-testid="home-live-camera-card-${escapeHtml(c.slug)}"><h3>${label}</h3><div class="subtle">${escapeHtml(
          c.brand_name || c.brand_slug || "",
        )}</div><p class="subtle">${metrics}</p><p><a href="${href}">Open camera page</a></p></article>`;
      }

      const meta = [c.brand_name || c.brand_slug, c.release_year, c.sensor_format, c.mount_code]
        .filter((v) => v !== null && v !== undefined && String(v).trim())
        .map((v) => escapeHtml(String(v)))
        .join(" | ");
      return `<li><a class="card-link" href="${href}" data-testid="home-featured-camera-card-${escapeHtml(c.slug)}"><strong>${label}</strong><div class="subtle">${meta}</div></a></li>`;
    })
    .join("");

  const renderHighlightCards = (items, { testId, emptyMessage, emphasis }) => {
    if (!items.length) return `<p class="subtle">${escapeHtml(emptyMessage)}</p>`;
    const cards = items
      .map((item) => {
        const detailHref = `/listings/${encodeURIComponent(item.listing_id)}`;
        const modelHref = item.camera_slug ? cameraCanonicalPath({ slug: item.camera_slug }) : null;
        const source = item.marketplace_display_name || item.marketplace_code || "Marketplace";
        const model = item.camera_display_name || item.title;
        const price = formatMoney(item.price_amount, item.price_currency);
        const shipping =
          item.shipping_amount !== null && item.shipping_amount !== undefined
            ? formatMoney(item.shipping_amount, item.shipping_currency || item.price_currency)
            : null;
        const priceLine = shipping ? `${price} + ${shipping} ship` : price;
        const condition = isNonEmptyString(item.condition_physical_tier) ? humanLabel(item.condition_physical_tier) : null;
        const leadMetric =
          emphasis === "deal" && item.deal_score !== null && item.deal_score !== undefined
            ? `${Math.round(Number(item.deal_score))}/100 deal`
            : item.first_visible_at
              ? `first seen ${formatMaybeIso(item.first_visible_at)}`
              : null;
        const meta = [priceLine, condition, item.last_retrieved_at ? `retrieved ${formatMaybeIso(item.last_retrieved_at)}` : null]
          .filter(Boolean)
          .map((value) => escapeHtml(String(value)))
          .join(" | ");
        return `<article class="card" data-testid="${escapeHtml(testId)}-${escapeHtml(item.listing_id)}">
          <div class="meta-row">
            <strong>${escapeHtml(model)}</strong>
            ${leadMetric ? `<span class="pill">${escapeHtml(leadMetric)}</span>` : ""}
            <span class="pill">${escapeHtml(source)}</span>
          </div>
          <p>${escapeHtml(item.title)}</p>
          <p class="subtle">${meta}</p>
          <p><a href="${escapeHtml(detailHref)}" rel="nofollow">Listing context</a>${modelHref ? ` | <a href="${escapeHtml(modelHref)}">Camera page</a>` : ""}</p>
        </article>`;
      })
      .join("");
    return `<div class="tri-grid">${cards}</div>`;
  };

  const dbBlock = dbEnabled
    ? ""
    : `<div class="warn" role="note">
        <strong>Database not configured</strong>
        <div class="subtle">${escapeHtml(dbHint || "Set DATABASE_URL to enable DB-backed pages.")}</div>
      </div>`;

  const featuredCameraTitle = coverageMode ? `Camera pages with live ${featuredCameraSourceLabel} coverage` : "Featured cameras";
  const featuredCameraLead = coverageMode
    ? `Start with the camera pages that currently have real ${featuredCameraSourceLabel} coverage instead of empty surface area.`
    : "Browse camera pages with specs, price bands, and live listings.";

  const bodyHtml = `
    <section class="hero stack" data-testid="home-page">
      <div class="eyebrow">Launch Scope</div>
      <div data-testid="home-hero">
        <h1>Used camera bodies with live market context.</h1>
        <p class="section-lead subtle">Fast Focus launches as a camera-body-first discovery surface: compare upgrade candidates, see transparent asking-price bands, and inspect real listings with better context.</p>
      </div>

      ${dbBlock}

      <form action="/search" method="get" aria-label="Search form" data-testid="home-search-form">
        <input type="hidden" name="type" value="cameras" />
        <div class="row">
          <div>
            <label for="q">Search camera models</label>
            <input id="q" name="q" placeholder="e.g., sony a7 iv, nikon z6 ii, canon r6" data-testid="home-search-input" />
          </div>
          <div style="flex:0 0 auto">
            <label>&nbsp;</label>
            <button type="submit" data-testid="home-search-submit">Search cameras</button>
          </div>
        </div>
      </form>

      <div class="cta-row">
        <a href="/cameras">Browse camera pages</a>
        <a href="/compare" data-testid="home-compare-entry">Build a comparison</a>
        <a href="/brands" data-testid="home-brand-hub-entry">Open brand hubs</a>
      </div>
    </section>

    <div class="grid">
      <section class="card" aria-label="Best current deals" data-testid="home-live-deals">
        <h2>Best current eBay deals</h2>
        <p class="section-lead subtle">The strongest scored matched listings visible right now. This is the fastest way to see whether the live market data is useful.</p>
        ${renderHighlightCards(liveDeals, {
          testId: "home-live-deal-card",
          emptyMessage: "No scored eBay listings yet. Keep the freshness table in view until ingest catches up.",
          emphasis: "deal",
        })}
      </section>

      <section class="card" aria-label="Fresh arrivals" data-testid="home-recent-arrivals">
        <h2>Fresh eBay arrivals</h2>
        <p class="section-lead subtle">Newer matched listings surfaced recently, so you can spot movement before the typical price view catches up.</p>
        ${renderHighlightCards(recentArrivals, {
          testId: "home-recent-arrival-card",
          emptyMessage: "No recent eBay arrivals yet.",
          emphasis: "recent",
        })}
      </section>
    </div>

    <div class="grid">
      <section class="card" aria-label="Live market">
        <h2>Live market (freshness)</h2>
        ${
          marketRows
            ? `<table aria-label="Marketplace freshness" data-testid="home-market-freshness">
                <thead><tr><th scope="col">Marketplace</th><th scope="col">Active listings</th><th scope="col">Last retrieved</th><th scope="col">Last run</th></tr></thead>
                <tbody>${marketRows}</tbody>
              </table>`
            : `<p class="subtle">No marketplace data yet.</p>`
        }
      </section>

      <section class="card" aria-label="Useful right now">
        <h2>Useful right now</h2>
        ${liveCoverageWarning ? `<p class="warn">${escapeHtml(liveCoverageWarning)}</p>` : ""}
        <ul>
          <li>Open the best current eBay matches and compare them against the model-level price band.</li>
          <li>Start with camera pages that have real listing coverage, not just a placeholder shell.</li>
          <li>Use the freshness table to see whether a source is active before trusting a thin page.</li>
        </ul>
      </section>
    </div>

    <section class="card" aria-label="Featured cameras" data-testid="home-featured-cameras">
      <h2>${escapeHtml(featuredCameraTitle)}</h2>
      <p class="section-lead subtle">${escapeHtml(featuredCameraLead)}</p>
      ${cameraItems ? (coverageMode ? `<div class="tri-grid">${cameraItems}</div>` : `<ul class="clean tri-grid">${cameraItems}</ul>`) : `<p class="subtle">No cameras yet.</p>`}
    </section>
  `;

  return documentHtml({
    title: "Fast Focus",
    description: "Camera-body-first used market intelligence: transparent price bands, comparisons, and live listings.",
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
        .join(" â€¢ ");
      return `<li><a class="card-link" href="${href}" data-testid="camera-index-card-${escapeHtml(c.slug)}"><strong>${title}</strong><div class="subtle">${meta}</div></a></li>`;
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
    <section class="stack" data-testid="camera-index-page">
      <div data-testid="camera-index-header">
        <div class="eyebrow">Camera Index</div>
        <h1>Cameras</h1>
        <p class="section-lead subtle">Browse canonical camera-body pages with price bands, listing snapshots, and used-buyer checklists.</p>
      </div>

    <section class="card" aria-label="Filters">
      <h2>Filter</h2>
      <form action="/cameras" method="get" aria-label="Camera filters" data-testid="camera-index-filter-form">
        <div class="row">
          <div>
            <label for="q">Search</label>
            <input id="q" name="q" value="${escapeHtml(filters.q || "")}" placeholder="Search cameras..." data-testid="camera-index-search-input" />
          </div>
          <div>
            <label for="brand">Brand</label>
            <select id="brand" name="brand" data-testid="camera-index-brand-filter">${optionsBrands}</select>
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
      <div class="subtle" data-testid="camera-index-results-summary">Showing ${escapeHtml(String(cameras.length))} items â€¢ offset ${escapeHtml(String(page.offset))}</div>
      ${items ? `<ul class="clean tri-grid" data-testid="camera-index-results">${items}</ul>` : `<p class="subtle" data-testid="camera-index-empty-state">No results.</p>`}
      <div class="row" style="margin-top:10px;align-items:center">

        <div style="flex:0 0 auto;display:flex;gap:10px">
          ${prevHref ? `<a href="${prevHref}">Prev</a>` : `<span class="subtle">Prev</span>`}
          ${nextHref ? `<a href="${nextHref}">Next</a>` : `<span class="subtle">Next</span>`}
        </div>
      </div>
    </section>
    </section>
  `;

  return documentHtml({
    title: "Cameras â€¢ Fast Focus",
    description: "Browse camera-body model pages with live market context.",
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
        .join(" â€¢ ");
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
          <span class="subtle">Showing ${escapeHtml(String(lenses.length))} items â€¢ offset ${escapeHtml(String(page.offset))}</span>
        </div>
        <div style="flex:0 0 auto;display:flex;gap:10px">
          ${prevHref ? `<a href="${prevHref}">Prev</a>` : `<span class="subtle">Prev</span>`}
          ${nextHref ? `<a href="${nextHref}">Next</a>` : `<span class="subtle">Next</span>`}
        </div>
      </div>
    </section>
  `;

  return documentHtml({
    title: "Lenses â€¢ Fast Focus",
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
    title: "Brands â€¢ Fast Focus",
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
        .join(" â€¢ ");
      return `<li><a class="card-link" href="${href}" data-testid="brand-hub-camera-card-${escapeHtml(c.slug)}"><strong>${title}</strong>${meta ? `<div class="subtle">${meta}</div>` : ""}</a></li>`;
    })
    .join("");

  const lensItems = lenses
    .map((l) => {
      const href = lensCanonicalPath(l);
      const title = escapeHtml(l.display_name || l.slug);
      const meta = [l.release_year ? String(l.release_year) : null, l.mount_code, l.lens_category]
        .filter(Boolean)
        .map((v) => escapeHtml(String(v)))
        .join(" â€¢ ");
      return `<li><a href="${href}">${title}</a>${meta ? `<div class="subtle">${meta}</div>` : ""}</li>`;
    })
    .join("");

  const bodyHtml = `
    <section class="stack" data-testid="brand-hub-page">
    <div data-testid="brand-hub-header">
      <div class="eyebrow">Brand Hub</div>
      <h1 data-testid="brand-hub-title-${escapeHtml(brand.slug)}">${escapeHtml(brand.name)}</h1>
      <p class="section-lead subtle">Camera-body coverage for ${escapeHtml(brand.name)}. Lens expansion is tracked separately from the launch navigation.</p>
    </div>

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
      <p class="subtle">Tip: for broader filters, use <a href="/cameras">/cameras</a>.</p>
    </section>

    <div class="grid">
      <section class="card" aria-label="Cameras" data-testid="brand-hub-cameras">
        <h2>Cameras (${escapeHtml(String(cameras.length))})</h2>
        <div class="subtle" data-testid="brand-hub-results-summary">Showing ${escapeHtml(String(cameras.length))} camera pages for ${escapeHtml(brand.name)}.</div>
        ${cameraItems ? `<ul class="clean">${cameraItems}</ul>` : `<p class="subtle">No cameras found.</p>`}
      </section>
      ${
        lenses.length
          ? `<section class="card" aria-label="Lenses">
              <h2>Lenses (${escapeHtml(String(lenses.length))})</h2>
              ${lensItems ? `<ul class="clean">${lensItems}</ul>` : `<p class="subtle">No lenses found.</p>`}
            </section>`
          : ""
      }
    </div>
    </section>
  `;

  return documentHtml({
    title: `${brand.name} â€¢ Fast Focus`,
    description: `Browse ${brand.name} camera-body model pages.`,
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
    <section class="stack" data-testid="compare-index-page">
    <div data-testid="compare-index-header">
      <div class="eyebrow">Compare</div>
      <h1>Compare camera bodies</h1>
      <p class="section-lead subtle">Use canonical compare URLs to line up two camera-body pages and their current Fast Focus price context.</p>
    </div>

    <section class="card" aria-label="Compare form">
      <h2>Build a comparison</h2>
      <form action="/compare" method="get" aria-label="Compare form" data-testid="compare-index-form">
        <div class="row">
          <div>
            <label for="a">Model A slug</label>
            <input id="a" name="a" placeholder="e.g. sony-a7-iv" list="${listId}" data-testid="compare-index-camera-a-input" />
          </div>
          <div>
            <label for="b">Model B slug</label>
            <input id="b" name="b" placeholder="e.g. nikon-z6-ii" list="${listId}" data-testid="compare-index-camera-b-input" />
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
            <button type="submit" data-testid="compare-index-submit">Compare</button>
          </div>
        </div>
      </form>
    </section>

    ${options ? `<datalist id="${listId}">${options}</datalist>` : ""}
    <p class="subtle">Tip: you can copy slugs from <a href="/cameras">/cameras</a>, or start typing to see suggestions.</p>
    </section>
  `;

  return documentHtml({
    title: "Compare â€¢ Fast Focus",
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
  const aMedian = priceBandA ? formatMoney(priceBandA.median, priceBandA.currency || currency) : "â€”";
  const bMedian = priceBandB ? formatMoney(priceBandB.median, priceBandB.currency || currency) : "â€”";
  const aIqr =
    priceBandA && priceBandA.p25 !== null && priceBandA.p25 !== undefined && priceBandA.p75 !== null && priceBandA.p75 !== undefined
      ? `${formatMoney(priceBandA.p25, priceBandA.currency || currency)}â€“${formatMoney(priceBandA.p75, priceBandA.currency || currency)}`
      : "â€”";
  const bIqr =
    priceBandB && priceBandB.p25 !== null && priceBandB.p25 !== undefined && priceBandB.p75 !== null && priceBandB.p75 !== undefined
      ? `${formatMoney(priceBandB.p25, priceBandB.currency || currency)}â€“${formatMoney(priceBandB.p75, priceBandB.currency || currency)}`
      : "â€”";

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
    return `${Number(w)}Ã—${Number(h)}`;
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
    if (d === null || d === undefined) return `${Number(w)}Ã—${Number(h)} mm`;
    if (!Number.isFinite(Number(d))) return `${Number(w)}Ã—${Number(h)} mm`;
    return `${Number(w)}Ã—${Number(h)}Ã—${Number(d)} mm`;
  }

  function formatRange(obj, unit = "") {
    if (!obj || typeof obj !== "object") return null;
    const min = obj.min ?? null;
    const max = obj.max ?? null;
    if (!Number.isFinite(Number(min)) || !Number.isFinite(Number(max))) return null;
    const suffix = unit ? ` ${unit}` : "";
    if (Number(min) === Number(max)) return `${Number(min)}${suffix}`;
    return `${Number(min)}â€“${Number(max)}${suffix}`;
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
      return escapeHtml(trimmed.length > maxLen ? `${trimmed.slice(0, maxLen - 1)}â€¦` : trimmed);
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
      return joined.length > maxLen ? `${joined.slice(0, maxLen - 1)}â€¦` : joined;
    }

    if (typeof value === "object") {
      if (fieldPath === "release.launch_msrp.body_only") {
        const amount = value.amount ?? null;
        const cur = value.currency ?? null;
        const money = formatMoney(amount, cur);
        return money === "â€”" ? null : escapeHtml(money);
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
        return escapeHtml(text.length > maxLen ? `${text.slice(0, maxLen - 1)}â€¦` : text);
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
    if (parts.length === 0) return "â€”";

    // Special-case: sensor size often combines a label + mm dims.
    if (fieldPaths.includes("specs.sensor.sensor_format") && fieldPaths.includes("specs.sensor.physical_dimensions_mm")) {
      if (parts.length === 2) return `${parts[0]} (${parts[1]})`;
    }

    return parts.join(" â€¢ ");
  }

  function renderCompareTable(sectionLabel, rows) {
    const tableRows = rows
      .map((row) => {
        const aText = row.aHtml ?? "â€”";
        const bText = row.bHtml ?? "â€”";
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
    { label: "Typical used price (P25â€“P75)", aHtml: escapeHtml(aIqr), bHtml: escapeHtml(bIqr) },
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
          { label: "Release year", aHtml: escapeHtml(String(cameraA.release_year ?? "â€”")), bHtml: escapeHtml(String(cameraB.release_year ?? "â€”")) },
          { label: "Sensor format", aHtml: escapeHtml(enumLabel(cameraA.sensor_format, SENSOR_FORMAT_LABELS) || "â€”"), bHtml: escapeHtml(enumLabel(cameraB.sensor_format, SENSOR_FORMAT_LABELS) || "â€”") },
          { label: "Resolution (MP)", aHtml: escapeHtml(String(cameraA.resolution_mp ?? "â€”")), bHtml: escapeHtml(String(cameraB.resolution_mp ?? "â€”")) },
          { label: "Mount", aHtml: escapeHtml(cameraA.mount_code || "â€”"), bHtml: escapeHtml(cameraB.mount_code || "â€”") },
        ]);

  const bodyHtml = `
    <section class="stack" data-testid="compare-page">
    <div data-testid="compare-page-header">
      <div class="eyebrow">Canonical Compare</div>
      <h1>${escapeHtml(cameraA.display_name)} vs ${escapeHtml(cameraB.display_name)}</h1>
    </div>
    <section class="card" data-testid="compare-page-summary">
    <div class="meta-row">
      <a href="/compare" data-testid="compare-back-link">Back to compare builder</a>
      <span class="pill">Currency ${escapeHtml(currency)}</span>
    </div>
    <p class="subtle">
      Model pages:
      <a href="${aHref}">${escapeHtml(cameraA.slug)}</a> â€¢
      <a href="${bHref}">${escapeHtml(cameraB.slug)}</a>
    </p>
    <p class="subtle">Price bands are computed from matched active listings and may lag the live market.</p>
    </section>

    <div data-testid="compare-price-section">${usedMarketSection}</div>
    <div data-testid="compare-specs-table">${dpreviewTables}</div>
    </section>
  `;

  return documentHtml({
    title: `${cameraA.display_name} vs ${cameraB.display_name} â€¢ Fast Focus`,
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
      Fast Focus launches as a camera-body-first decision surface: browse camera models, see transparent price bands, and click out to live listings with better context.
    </p>

    <section class="card" aria-label="How it works">
      <h2>How it works (today)</h2>
      <ol>
        <li>Ingest live marketplace listings (starting with eBay in Phase 1).</li>
        <li>Normalize listings into a consistent schema (price, shipping, condition, location, etc.).</li>
        <li>Match listings to canonical camera models in the launch catalog.</li>
        <li>Compute typical asking-price bands from matched active listings.</li>
      </ol>
      <p class="subtle">Methodology endpoint: <a href="/api/v1/price-bands/methodology">/api/v1/price-bands/methodology</a>.</p>
    </section>

    <section class="card" aria-label="How to use">
      <h2>How to use the site</h2>
      <ul>
        <li><a href="/">Homepage</a> shows marketplace freshness and featured models.</li>
        <li><a href="/cameras">Cameras</a> provides the launch search + filter surface.</li>
        <li>Model pages show specs, a used-buyer checklist, and matched listings.</li>
        <li><a href="/compare">Compare</a> puts two models side-by-side.</li>
        <li><a href="/brands">Brands</a> gives camera-first hubs with stable URLs.</li>
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
    title: "About â€¢ Fast Focus",
    description: "About the Fast Focus camera-body-first launch surface.",
    canonicalUrl,
    bodyHtml,
  });
}

export function renderPrivacyPageHtml({ canonicalUrl }) {
  const bodyHtml = `
    <h1>Privacy</h1>
    <p class="subtle">This page describes what Fast Focus stores for consented analytics, outbound click attribution, and optional email features.</p>

    <section class="card" aria-label="Data we store">
      <h2>Data we store (application database)</h2>
      <ul>
        <li>A random session id cookie (<code>ff_sid</code>) to associate consented analytics events across pages and click-outs.</li>
        <li>Consented event types such as page views, search/filter actions, compare views, and listing click-outs.</li>
        <li>Technical context for debugging and attribution: page type, path, user agent, referrer, and UTM parameters (if present).</li>
      </ul>
      <p class="subtle">The application does not store IP addresses in its database. Your hosting provider may keep standard server logs.</p>
    </section>

    <section class="card" aria-label="Cookies">
      <h2>Cookies</h2>
      <p class="subtle">
        The <code>ff_sid</code> cookie is set only when Fast Focus records consented analytics or outbound attribution.
        It is <code>HttpOnly</code>, <code>SameSite=Lax</code>, and configured for a 30-day max age.
      </p>
      <p class="subtle">
        The <code>ff_pro</code> cookie is set when you confirm Premium. It is <code>HttpOnly</code>, <code>SameSite=Lax</code>, and configured for a
        365-day max age. It is cleared if you cancel Premium.
      </p>
      <div class="subtle">
        <p><strong>Attribution tracking preference</strong></p>
        <ul>
          <li><a href="/consent?analytics=true&amp;return_to=/privacy">Enable</a> consented product analytics and click-out attribution</li>
          <li><a href="/consent?analytics=false&amp;return_to=/privacy">Disable</a> consented product analytics and click-out attribution</li>
        </ul>
        <p>
          If your browser sends a global opt-out signal (GPC or Do Not Track), Fast Focus will not record consented analytics events even if enabled here.
        </p>
      </div>
    </section>

    <section class="card" aria-label="Why we measure">
      <h2>Why we measure</h2>
      <p class="subtle">
        Fast Focus uses first-party analytics to understand what buyers actually want: camera vs lens demand, brand share, model bias, compare-pair demand,
        click-out behavior, and where coverage should expand next.
      </p>
    </section>

    <section class="card" aria-label="Retention">
      <h2>Retention</h2>
      <p class="subtle">
        Default retention targets (production): consented analytics events are deleted after 90 days; operational logs (ingestion runs) after 180 days; and audit
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
        If you request Premium, Fast Focus stores your email address and a subscription record including confirmation/cancel tokens. If you create Premium
        tracker watches, Fast Focus also stores the tracked model, source, currency, optional country/condition filters, target price, and a record of
        tracker alert emails sent. Premium confirmation is double opt-in (you must click the confirmation link).
      </p>
      <p class="subtle">
        Default retention targets (production): unconfirmed premium requests are deleted after 14 days; canceled premium subscriptions after 30 days; and
        email message logs after 30 days.
      </p>
    </section>
  `;

  return documentHtml({
    title: "Privacy â€¢ Fast Focus",
    description: "Privacy information for the Fast Focus launch surface.",
    canonicalUrl,
    bodyHtml,
  });
}

export function renderAlertConfirmResultHtml({ canonicalUrl, alreadyConfirmed = false } = {}) {
  const bodyHtml = `
    <h1>Alerts confirmed</h1>
    <p class="subtle">${alreadyConfirmed ? "This alert was already confirmed." : "Thanks â€” alerts are now enabled."}</p>

    <section class="card" aria-label="Next steps">
      <h2>Next steps</h2>
      <ul>
        <li>Youâ€™ll receive an email when new matching listings are found (batch/scheduled).</li>
        <li>Unsubscribe links are included in every email.</li>
      </ul>
      <p class="subtle"><a href="/privacy">Privacy</a></p>
    </section>
  `;

  return documentHtml({
    title: "Alerts confirmed Ã¢â‚¬Â¢ Fast Focus",
    description: "Your Fast Focus alert is confirmed.",
    canonicalUrl,
    bodyHtml,
  });
}

export function renderAlertUnsubscribeResultHtml({ canonicalUrl } = {}) {
  const bodyHtml = `
    <h1>Unsubscribed</h1>
    <p class="subtle">Youâ€™ll no longer receive alerts for this saved search.</p>
    <p class="subtle"><a href="/privacy">Privacy</a></p>
  `;

  return documentHtml({
    title: "Unsubscribed Ã¢â‚¬Â¢ Fast Focus",
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
    title: "Newsletter â€¢ Fast Focus",
    description: "Subscribe to the Fast Focus weekly deals newsletter.",
    canonicalUrl,
    bodyHtml,
  });
}

export function renderNewsletterConfirmResultHtml({ canonicalUrl, alreadyConfirmed = false } = {}) {
  const bodyHtml = `
    <h1>Newsletter confirmed</h1>
    <p class="subtle">${alreadyConfirmed ? "This subscription was already confirmed." : "Thanks â€” you are subscribed."}</p>
    <p class="subtle"><a href="/privacy">Privacy</a></p>
  `;

  return documentHtml({
    title: "Newsletter confirmed â€¢ Fast Focus",
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
    title: "Unsubscribed â€¢ Fast Focus",
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
      : `<p class="subtle">Premium (Pro). Double opt-in via email. Cancel any time. Current beta includes price history and eBay-only tracker alerts.</p>`;

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
      <p class="subtle">Tracker beta management is currently API-first and eBay-only while the Phase 2 surface hardens.</p>
      <p class="subtle"><a href="/privacy">Privacy</a></p>
    </section>
  `;

  return documentHtml({
    title: "Premium â€¢ Fast Focus",
    description: "Upgrade to Fast Focus Premium (Pro).",
    canonicalUrl,
    bodyHtml,
  });
}

export function renderPremiumConfirmResultHtml({ canonicalUrl, alreadyConfirmed = false } = {}) {
  const bodyHtml = `
    <h1>Premium confirmed</h1>
    <p class="subtle">${alreadyConfirmed ? "This subscription was already confirmed." : "Thanks â€” premium is now enabled on this device."}</p>
    <p class="subtle"><a href="/privacy">Privacy</a></p>
  `;

  return documentHtml({
    title: "Premium confirmed â€¢ Fast Focus",
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
    title: "Premium canceled â€¢ Fast Focus",
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
      const date = r.observed_date || "â€”";
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
    <h1>${escapeHtml(String(name))} â€¢ Price history</h1>
    <p class="subtle">Premium view. Currency: <code>${escapeHtml(String(currency))}</code></p>
    <p class="subtle"><a href="${escapeHtml(jsonHref)}" rel="nofollow">JSON</a></p>
    ${table}
    <p class="subtle"><a href="/privacy">Privacy</a></p>
  `;

  return documentHtml({
    title: `${name} price history â€¢ Fast Focus`,
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
    title: "Guides â€¢ Fast Focus",
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
        <li>Verify whatâ€™s included: battery, charger, body cap, strap, box, paperwork.</li>
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
        <li>Stock photos only, or photos that donâ€™t match the model name in the title.</li>
        <li>â€œUntestedâ€ / â€œas-isâ€ for a modern digital body (unless youâ€™re buying for parts).</li>
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
      title: "Guide not found â€¢ Fast Focus",
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
    title: `${metaTitle} â€¢ Fast Focus`,
    description: metaDescription,
    canonicalUrl,
    bodyHtml,
  });
}



