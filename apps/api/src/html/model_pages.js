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

function countWords(text) {
  return String(text)
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function softClampBio(sentences, { minWords = 80, maxWords = 200 } = {}) {
  const optionalTail = [
    "If you’re buying used, prioritize clear photos, a clean functional test, and a seller with straightforward return terms.",
    "Used prices can move with availability and demand, so treat any range as a snapshot rather than a guarantee.",
  ];

  const base = sentences.filter(Boolean);
  let out = [...base];

  while (countWords(out.join(" ")) < minWords && optionalTail.length) out.push(optionalTail.shift());

  while (countWords(out.join(" ")) > maxWords && out.length > 1) out.pop();

  return out.join(" ");
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
  slr_film: "SLR (film)",
  tlr_film: "TLR (film)",
  medium_format: "Medium format",
  instant: "Instant",
  other: "Other",
};

const FILM_FORMAT_LABELS = {
  "135": "35mm (135)",
  "120": "120",
  "110": "110",
  "220": "220",
  instax_mini: "Instax Mini",
  instax_wide: "Instax Wide",
  polaroid_600: "Polaroid 600",
  polaroid_i_type: "Polaroid i‑Type",
  "4x5": "4×5",
  "8x10": "8×10",
  other: "Other",
};

const LENS_CATEGORY_LABELS = {
  prime: "Prime",
  zoom: "Zoom",
  teleconverter: "Teleconverter",
  other: "Other",
};

const MOUNT_LABELS = {
  sony_e: "Sony E",
  canon_rf: "Canon RF",
  canon_ef: "Canon EF",
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

function formatBool(value) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return null;
}

function formatDate(value) {
  if (!isNonEmptyString(value)) return null;
  // value is typically YYYY-MM-DD from Postgres DATE
  return value;
}

function formatTimestamp(value) {
  if (!isNonEmptyString(value)) return null;
  return value;
}

function formatDimensionsMM({ dimensions_w_mm, dimensions_h_mm, dimensions_d_mm }) {
  if (!dimensions_w_mm || !dimensions_h_mm || !dimensions_d_mm) return null;
  return `${dimensions_w_mm}×${dimensions_h_mm}×${dimensions_d_mm} mm`;
}

function formatFocalRangeMm(minMm, maxMm) {
  if (!Number.isFinite(Number(minMm)) || !Number.isFinite(Number(maxMm))) return null;
  if (Number(minMm) === Number(maxMm)) return `${Number(minMm)} mm`;
  return `${Number(minMm)}–${Number(maxMm)} mm`;
}

function formatMaxAperture(wideF, teleF) {
  if (!Number.isFinite(Number(wideF)) || !Number.isFinite(Number(teleF))) return null;
  if (Number(wideF) === Number(teleF)) return `f/${Number(wideF)}`;
  return `f/${Number(wideF)}–${Number(teleF)}`;
}

function formatMount(mountCode) {
  if (!isNonEmptyString(mountCode)) return null;
  const pretty = MOUNT_LABELS[mountCode] || humanLabel(mountCode);
  return pretty ? `${pretty} (${mountCode})` : mountCode;
}

function formatStorageMedia(value) {
  if (!value) return null;
  const items = Array.isArray(value) ? value : [];
  const out = items
    .map((v) => (isNonEmptyString(v) ? v : null))
    .filter(Boolean)
    .slice(0, 10)
    .map((v) => v.replaceAll("_", " "));
  return out.length ? out.join(", ") : null;
}

function formatMoney(amount, currency) {
  if (amount === null || amount === undefined) return null;
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  if (isNonEmptyString(currency)) {
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
    } catch {
      // ignore
    }
  }
  return `${n.toFixed(0)}`;
}

function normalizeModuleArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeChecklistItems(value) {
  const raw = normalizeModuleArray(value);
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const label = isNonEmptyString(item.label) ? item.label.trim() : null;
      const severity = isNonEmptyString(item.severity) ? item.severity.trim().toLowerCase() : null;
      if (!label) return null;
      return { label, severity };
    })
    .filter(Boolean);
}

function severityPrefix(severity) {
  if (severity === "high") return "High";
  if (severity === "medium") return "Medium";
  if (severity === "low") return "Low";
  return null;
}

function renderBullets(items) {
  if (!items.length) return "";
  const li = items
    .map((item) => {
      const prefix = severityPrefix(item.severity);
      const text = prefix ? `${prefix}: ${item.label}` : item.label;
      return `<li>${escapeHtml(text)}</li>`;
    })
    .join("");
  return `<ul>${li}</ul>`;
}

function navHtml() {
  return `
    <nav aria-label="Primary">
      <a href="/cameras">Cameras</a>
      <a href="/lenses">Lenses</a>
      <a href="/brands">Brands</a>
      <a href="/compare">Compare</a>
      <a href="/guides">Guides</a>
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
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid rgba(127,127,127,0.35); padding: 8px 10px; vertical-align: top; }
      th { text-align: left; width: 240px; }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.95em; }
      .grid { display: grid; grid-template-columns: 1fr; gap: 16px; }
      @media (min-width: 860px) { .grid { grid-template-columns: 1fr 1fr; } }
      .card { border: 1px solid rgba(127,127,127,0.35); border-radius: 12px; padding: 14px 14px; }
      .card h3 { margin: 0 0 8px; font-size: 16px; }
      .badge { display: inline-block; padding: 1px 8px; border-radius: 999px; border: 1px solid rgba(127,127,127,0.35); font-size: 12px; margin-left: 6px; }
      .badge-sponsored { background: rgba(255, 193, 7, 0.16); border-color: rgba(255, 193, 7, 0.35); font-weight: 600; }
      footer { max-width: 1040px; margin: 0 auto; padding: 20px; opacity: 0.75; }
      footer a { color: inherit; text-decoration: underline; text-underline-offset: 3px; }
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

function renderSpecTable(rows) {
  const body = rows
    .map(({ label, value }) => {
      const v = isNonEmptyString(value) ? value : "—";
      return `<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(v)}</td></tr>`;
    })
    .join("");
  return `<table aria-label="Specifications"><tbody>${body}</tbody></table>`;
}

function buildCameraBio(camera) {
  const name = camera.display_name || "This camera";
  const brand = camera.brand_name || "the manufacturer";

  const medium = enumLabel(camera.capture_medium);
  const category = enumLabel(camera.camera_category, CAMERA_CATEGORY_LABELS);

  const year = camera.release_year || null;
  const announce = formatDate(camera.announce_date);

  const system = enumLabel(camera.lens_system_type);
  const mount = formatMount(camera.mount_code);

  const sensor = enumLabel(camera.sensor_format, SENSOR_FORMAT_LABELS);
  const mp = camera.resolution_mp !== null && camera.resolution_mp !== undefined ? Number(camera.resolution_mp) : null;
  const ibis = formatBool(camera.ibis);

  const filmFormat = enumLabel(camera.film_format, FILM_FORMAT_LABELS);
  const frameSize = isNonEmptyString(camera.frame_size) ? camera.frame_size : null;

  const weight = camera.weight_g ? `${camera.weight_g} g` : null;
  const sealed = formatBool(camera.weather_sealed);

  const fixedFocal = formatFocalRangeMm(camera.fixed_focal_length_min_mm, camera.fixed_focal_length_max_mm);
  const fixedAperture = formatMaxAperture(camera.fixed_max_aperture_wide_f, camera.fixed_max_aperture_tele_f);
  const fixedBasis = enumLabel(camera.fixed_focal_length_basis);

  const sentences = [];

  sentences.push(`The ${name} is a${medium ? ` ${medium.toLowerCase()}` : ""}${category ? ` ${category.toLowerCase()}` : ""} camera from ${brand}.`);

  if (announce && year) sentences.push(`It was announced on ${announce} and released in ${year}.`);
  else if (year) sentences.push(`It was released in ${year}.`);
  else if (announce) sentences.push(`It was announced on ${announce}.`);

  if (system === "Interchangeable" && mount) {
    sentences.push(`It uses the ${mount} mount, which defines the lens ecosystem you can buy into.`);
  }

  if (system === "Fixed" && fixedFocal && fixedAperture) {
    sentences.push(
      `It has a built-in lens covering ${fixedFocal}${fixedBasis === "Equiv 35mm" ? " (35mm equivalent)" : ""} with a maximum aperture of ${fixedAperture}.`,
    );
  }

  if (camera.capture_medium === "digital") {
    if (sensor && mp) {
      sentences.push(
        `Its ${sensor} sensor captures about ${mp}MP${ibis === "Yes" ? ", with in-body stabilization," : ""} making it a solid option for everyday photography, travel, and hybrid use.`,
      );
    } else if (sensor) {
      sentences.push(`It uses a ${sensor} sensor, with features that depend on the specific configuration and firmware.`);
    }
  }

  if (camera.capture_medium === "film") {
    if (filmFormat) {
      sentences.push(
        `It shoots ${filmFormat} film${frameSize ? ` (${frameSize})` : ""}, so mechanical condition and consumables matter as much as cosmetics.`,
      );
    }
  }

  if (weight || sealed) {
    const parts = [];
    if (weight) parts.push(`weighs about ${weight}`);
    if (sealed) parts.push(`${sealed === "Yes" ? "is" : "is not"} marketed as weather sealed`);
    sentences.push(`In hand it ${parts.join(" and ")}.`);
  }

  return softClampBio(sentences);
}

function buildLensBio(lens) {
  const name = lens.display_name || "This lens";
  const brand = lens.brand_name || "the manufacturer";

  const category = enumLabel(lens.lens_category, LENS_CATEGORY_LABELS);
  const mount = formatMount(lens.mount_code);

  const coverage = enumLabel(lens.coverage_format, SENSOR_FORMAT_LABELS);
  const focal = formatFocalRangeMm(lens.focal_length_min_mm, lens.focal_length_max_mm);
  const aperture = formatMaxAperture(lens.max_aperture_wide_f, lens.max_aperture_tele_f);

  const year = lens.release_year || null;
  const announce = formatDate(lens.announce_date);

  const hasIs = formatBool(lens.has_is);
  const weight = lens.weight_g ? `${lens.weight_g} g` : null;
  const sealed = formatBool(lens.weather_sealed);

  const sentences = [];

  sentences.push(`The ${name} is a${category ? ` ${category.toLowerCase()}` : ""} lens from ${brand}${mount ? ` for the ${mount} mount` : ""}.`);

  if (coverage) sentences.push(`It is designed to cover ${coverage} sensors.`);

  if (focal && aperture) sentences.push(`The focal range is ${focal} with a maximum aperture of ${aperture}.`);
  else if (focal) sentences.push(`The focal range is ${focal}.`);

  if (announce && year) sentences.push(`It was announced on ${announce} and released in ${year}.`);
  else if (year) sentences.push(`It was released in ${year}.`);
  else if (announce) sentences.push(`It was announced on ${announce}.`);

  if (hasIs) sentences.push(`${hasIs === "Yes" ? "It includes" : "It does not include"} optical image stabilization.`);

  if (weight || sealed) {
    const parts = [];
    if (weight) parts.push(`weighs about ${weight}`);
    if (sealed) parts.push(`${sealed === "Yes" ? "is" : "is not"} marketed as weather sealed`);
    sentences.push(`Physically it ${parts.join(" and ")}.`);
  }

  return softClampBio(sentences);
}

function fallbackCameraChecklist(camera) {
  const film = camera.capture_medium === "film";
  if (film) {
    return [
      { severity: "high", label: "Test shutter speeds and listen for irregular timing." },
      { severity: "high", label: "Inspect light seals/foam for decay and plan replacement if sticky." },
      { severity: "medium", label: "Check film advance/rewind, door latch, and frame spacing." },
      { severity: "medium", label: "Look for viewfinder haze, fungus, or prism desilvering." },
      { severity: "low", label: "Verify meter operation (if present) and battery availability." },
    ];
  }

  return [
    { severity: "high", label: "Confirm the sensor is clean (no scratches/oil) and run a dust test." },
    { severity: "high", label: "Test shutter, dials/buttons, ports, hotshoe, and card slot reliability." },
    { severity: "medium", label: "Verify autofocus performance and stabilization (IBIS/lens IS) behavior." },
    { severity: "medium", label: "Check battery health and confirm a genuine charger/cable is included." },
    { severity: "low", label: "Inspect lens mount and contacts for wear, play, or corrosion." },
  ];
}

function fallbackLensChecklist() {
  return [
    { severity: "high", label: "Inspect front/rear elements for scratches, haze, or fungus." },
    { severity: "high", label: "Check for decentering (sharpness symmetry) and aperture blade issues." },
    { severity: "medium", label: "Test autofocus and image stabilization (if present) for noise or hunting." },
    { severity: "medium", label: "Ensure zoom/focus rings are smooth with no grit or binding." },
    { severity: "low", label: "Verify filter threads, hood fit, and mount contacts are undamaged." },
  ];
}

function renderPriceBandCard(priceBand, { premiumPriceHistoryHref = null } = {}) {
  if (!priceBand) {
    const premiumLink = premiumPriceHistoryHref
      ? `<p class="subtle"><a href="${escapeHtml(premiumPriceHistoryHref)}">Premium: view price history</a></p>`
      : "";
    return `<div class="card"><h3>Typical used price</h3><div class="subtle">Not enough matched listing data yet for this currency.</div>${premiumLink}</div>`;
  }

  const rows = [
    { label: "Currency", value: priceBand.currency || "—" },
    { label: "Observed date", value: priceBand.observed_date || null },
    { label: "Country", value: priceBand.country || null },
    { label: "Condition tier", value: priceBand.condition_physical_tier || null },
    { label: "Sample size", value: String(priceBand.sample_size ?? 0) },
    { label: "Min", value: formatMoney(priceBand.min, priceBand.currency) },
    { label: "P25", value: formatMoney(priceBand.p25, priceBand.currency) },
    { label: "Median", value: formatMoney(priceBand.median, priceBand.currency) },
    { label: "P75", value: formatMoney(priceBand.p75, priceBand.currency) },
    { label: "Max", value: formatMoney(priceBand.max, priceBand.currency) },
    { label: "Computed at", value: formatTimestamp(priceBand.as_of) },
    { label: "Method", value: priceBand.method || null },
  ];

  const premiumLink = premiumPriceHistoryHref
    ? `<p class="subtle"><a href="${escapeHtml(premiumPriceHistoryHref)}">Premium: view price history</a></p>`
    : "";

  return `<div class="card"><h3>Typical used price (asking)</h3>${renderSpecTable(rows)}${premiumLink}</div>`;
}

function renderListingCountsCard({ listingCounts, lastUpdatedAt }) {
  if (!listingCounts || listingCounts.length === 0) {
    return `<div class="card"><h3>Listings snapshot</h3><div class="subtle">No active matched listings for this model yet.</div></div>`;
  }

  const tableRows = listingCounts
    .map(
      (r) =>
        `<tr><td><code>${escapeHtml(r.marketplace_code)}</code></td><td>${escapeHtml(String(r.listing_count))}</td><td>${escapeHtml(
          r.last_retrieved_at || "—",
        )}</td></tr>`,
    )
    .join("");

  return `<div class="card">
  <h3>Listings snapshot</h3>
  <div class="subtle">Last refresh: ${escapeHtml(lastUpdatedAt || "—")}</div>
  <table aria-label="Listing counts by source">
    <thead><tr><th scope="col">Source</th><th scope="col">Count</th><th scope="col">Last retrieved</th></tr></thead>
    <tbody>${tableRows}</tbody>
  </table>
</div>`;
}

function formatLocation({ country, region, city }) {
  const parts = [];
  if (isNonEmptyString(city)) parts.push(city.trim());
  if (isNonEmptyString(region)) parts.push(region.trim());
  if (isNonEmptyString(country)) parts.push(country.trim());
  return parts.length ? parts.join(", ") : null;
}

function formatListingPrice(listing) {
  const price = formatMoney(listing.price_amount, listing.price_currency);
  const ship =
    listing.shipping_amount !== null && listing.shipping_amount !== undefined
      ? formatMoney(listing.shipping_amount, listing.shipping_currency || listing.price_currency)
      : null;
  if (price && ship) return `${price} + ${ship} ship`;
  return price || "—";
}

function renderListingsTable(listings) {
  const rows = Array.isArray(listings) ? listings : [];
  if (rows.length === 0) {
    return `<div class="subtle">No active matched listings yet.</div>`;
  }

  const body = rows
    .map((l) => {
      const loc = formatLocation(l) || "—";
      const condition = enumLabel(l.condition_physical_tier) || "—";
      const retrieved = l.last_retrieved_at || "—";
      const price = formatListingPrice(l);
      const source = isNonEmptyString(l.marketplace_display_name) ? l.marketplace_display_name : null;
      const sponsored = l.marketplace_is_sponsored === true;
      const sponsoredLabel = isNonEmptyString(l.marketplace_sponsored_label) ? l.marketplace_sponsored_label : "Sponsor (paid)";
      const badgeHtml = sponsored ? ` <span class="badge badge-sponsored">${escapeHtml(sponsoredLabel)}</span>` : "";
      const sourceHtml = source
        ? `${escapeHtml(source)} <span class="subtle">(${escapeHtml(l.marketplace_code)})</span>${badgeHtml}`
        : `<code>${escapeHtml(l.marketplace_code)}</code>${badgeHtml}`;
      const deal = l.deal_score !== null && l.deal_score !== undefined ? String(Math.round(Number(l.deal_score))) : "—";
      const go = `/go/listings/${encodeURIComponent(l.listing_id)}?page_type=model`;
      const explain = `/listings/${encodeURIComponent(l.listing_id)}`;
      return `<tr>
        <td>${sourceHtml}</td>
        <td>${escapeHtml(l.title)}</td>
        <td>${escapeHtml(price)}</td>
        <td>${escapeHtml(deal)}</td>
        <td>${escapeHtml(condition)}</td>
        <td>${escapeHtml(loc)}</td>
        <td>${escapeHtml(retrieved)}</td>
        <td><a href="${escapeHtml(go)}" rel="nofollow sponsored noopener noreferrer" target="_blank">View</a> • <a href="${escapeHtml(
          explain,
        )}" rel="nofollow">Why</a></td>
      </tr>`;
    })
    .join("");

  return `<table aria-label="Listings">
    <thead>
      <tr>
        <th scope="col">Source</th>
        <th scope="col">Title</th>
        <th scope="col">Price</th>
        <th scope="col">Deal</th>
        <th scope="col">Condition</th>
        <th scope="col">Location</th>
        <th scope="col">Retrieved</th>
        <th scope="col">Link</th>
      </tr>
    </thead>
    <tbody>${body}</tbody>
  </table>`;
}

export function renderCameraModelPageHtml(modelPage, { currency = "EUR", canonicalUrl = null, robots = null } = {}) {
  const camera = modelPage?.camera || null;
  if (!camera) return renderErrorPageHtml({ statusCode: 404, title: "Camera not found", message: "Unknown camera model." });

  const modules = safeJsonObject(camera.content_modules) || {};
  const bio = isNonEmptyString(modules.bio) ? modules.bio.trim() : buildCameraBio(camera);

  const usedChecklist = normalizeChecklistItems(modules.used_buying_checklist);
  const knownIssues = normalizeChecklistItems(modules.known_issues);

  const checklistOut = usedChecklist.length ? usedChecklist : fallbackCameraChecklist(camera);

  const specRows = [
    { label: "Brand", value: camera.brand_name },
    { label: "Model", value: camera.display_name },
    { label: "Capture medium", value: enumLabel(camera.capture_medium) },
    { label: "Category", value: enumLabel(camera.camera_category, CAMERA_CATEGORY_LABELS) },
    { label: "Lens system", value: enumLabel(camera.lens_system_type) },
    { label: "Mount", value: formatMount(camera.mount_code) },
    { label: "Release year", value: camera.release_year ? String(camera.release_year) : null },
    { label: "Announce date", value: formatDate(camera.announce_date) },
    { label: "Production start year", value: camera.production_start_year ? String(camera.production_start_year) : null },
    { label: "Production end year", value: camera.production_end_year ? String(camera.production_end_year) : null },
    { label: "Discontinued", value: formatBool(camera.is_discontinued) },
    { label: "Sensor format", value: enumLabel(camera.sensor_format, SENSOR_FORMAT_LABELS) },
    { label: "Resolution", value: camera.resolution_mp ? `${Number(camera.resolution_mp)} MP` : null },
    { label: "IBIS", value: formatBool(camera.ibis) },
    { label: "Video max", value: isNonEmptyString(camera.video_max) ? camera.video_max : null },
    { label: "Storage media", value: formatStorageMedia(camera.storage_media) },
    { label: "Battery model", value: isNonEmptyString(camera.battery_model) ? camera.battery_model : null },
    { label: "Film format", value: enumLabel(camera.film_format, FILM_FORMAT_LABELS) },
    { label: "Frame size", value: isNonEmptyString(camera.frame_size) ? camera.frame_size : null },
    { label: "DX coding", value: formatBool(camera.dx_coding) },
    { label: "Metering", value: isNonEmptyString(camera.metering) ? camera.metering : null },
    { label: "Focus type", value: isNonEmptyString(camera.focus_type) ? camera.focus_type : null },
    { label: "Flash", value: isNonEmptyString(camera.flash) ? camera.flash : null },
    { label: "Shutter type", value: isNonEmptyString(camera.shutter_type) ? camera.shutter_type : null },
    { label: "Weight", value: camera.weight_g ? `${camera.weight_g} g` : null },
    { label: "Weather sealed", value: formatBool(camera.weather_sealed) },
    { label: "Dimensions", value: formatDimensionsMM(camera) },
  ];

  const title = `${camera.display_name} — specs, used checklist, and typical price`;
  const description = bio.length > 160 ? `${bio.slice(0, 157)}…` : bio;

  const brandHref = camera.brand_slug ? `/brands/${encodeURIComponent(camera.brand_slug)}` : null;
  const crumbBrand = brandHref ? `<a href="${escapeHtml(brandHref)}">${escapeHtml(camera.brand_name || camera.brand_slug)}</a>` : "";

  const body = `
    <h1>${escapeHtml(camera.display_name)}</h1>
    <nav class="subtle" aria-label="Breadcrumb">
      <a href="/cameras">Cameras</a>${crumbBrand ? ` • ${crumbBrand}` : ""}
    </nav>
    <div class="subtle">${escapeHtml(camera.brand_name || "")}${camera.release_year ? ` • Released ${escapeHtml(String(camera.release_year))}` : ""}</div>

    <h2>About</h2>
    <p>${escapeHtml(bio)}</p>

    <h2>Specs</h2>
    ${renderSpecTable(specRows)}

    <div class="grid">
      ${renderPriceBandCard(modelPage.price_band, { premiumPriceHistoryHref: `/premium/price-history/cameras/${encodeURIComponent(camera.slug)}` })}
      ${renderListingCountsCard({ listingCounts: modelPage.listing_counts_by_source, lastUpdatedAt: modelPage.last_updated_at })}
    </div>

    <h2>Listings</h2>
    <div class="subtle">Outbound links may be affiliate links. We may earn a commission.</div>
    ${renderListingsTable(modelPage.listings)}

    <h2>Used-buyer checklist</h2>
    ${renderBullets(checklistOut)}

    <h2>Known issues</h2>
    ${
      knownIssues.length
        ? renderBullets(knownIssues)
        : `<div class="subtle">No model-specific issues recorded yet. Use the checklist above and prefer listings with clear photos and return options.</div>`
    }

    <h2>Data</h2>
    <ul>
      <li>Currency view: <code>${escapeHtml(currency)}</code> (change via <code>?currency=USD</code>)</li>
      <li>Camera JSON: <code>/api/v1/cameras/${escapeHtml(camera.slug)}</code></li>
      <li>Listings JSON: <code>/api/v1/listings?camera_slug=${escapeHtml(camera.slug)}</code></li>
    </ul>
  `;

  return documentHtml({ title, description, canonicalUrl, robots, bodyHtml: body });
}

export function renderLensModelPageHtml(modelPage, { currency = "EUR", canonicalUrl = null, robots = null } = {}) {
  const lens = modelPage?.lens || null;
  if (!lens) return renderErrorPageHtml({ statusCode: 404, title: "Lens not found", message: "Unknown lens model." });

  const modules = safeJsonObject(lens.content_modules) || {};
  const bio = isNonEmptyString(modules.bio) ? modules.bio.trim() : buildLensBio(lens);

  const usedChecklist = normalizeChecklistItems(modules.used_buying_checklist);
  const knownIssues = normalizeChecklistItems(modules.known_issues);

  const checklistOut = usedChecklist.length ? usedChecklist : fallbackLensChecklist();

  const opticalSpecs = safeJsonObject(lens.optical_specs) || {};

  const specRows = [
    { label: "Brand", value: lens.brand_name },
    { label: "Model", value: lens.display_name },
    { label: "Mount", value: formatMount(lens.mount_code) },
    { label: "Coverage format", value: enumLabel(lens.coverage_format, SENSOR_FORMAT_LABELS) },
    { label: "Category", value: enumLabel(lens.lens_category, LENS_CATEGORY_LABELS) },
    { label: "Focal length", value: formatFocalRangeMm(lens.focal_length_min_mm, lens.focal_length_max_mm) },
    { label: "Max aperture", value: formatMaxAperture(lens.max_aperture_wide_f, lens.max_aperture_tele_f) },
    { label: "Image stabilization", value: formatBool(lens.has_is) },
    { label: "Release year", value: lens.release_year ? String(lens.release_year) : null },
    { label: "Announce date", value: formatDate(lens.announce_date) },
    { label: "Production start year", value: lens.production_start_year ? String(lens.production_start_year) : null },
    { label: "Production end year", value: lens.production_end_year ? String(lens.production_end_year) : null },
    { label: "Discontinued", value: formatBool(lens.is_discontinued) },
    { label: "Weight", value: lens.weight_g ? `${lens.weight_g} g` : null },
    { label: "Weather sealed", value: formatBool(lens.weather_sealed) },
    { label: "Filter thread", value: opticalSpecs.filter_thread_mm ? `${Number(opticalSpecs.filter_thread_mm)} mm` : null },
    { label: "Min focus distance", value: opticalSpecs.min_focus_distance_m ? `${Number(opticalSpecs.min_focus_distance_m)} m` : null },
    { label: "Max magnification", value: opticalSpecs.max_magnification ? `${Number(opticalSpecs.max_magnification)}` : null },
    { label: "Aperture blades", value: opticalSpecs.aperture_blades ? `${Number(opticalSpecs.aperture_blades)}` : null },
    { label: "Elements", value: opticalSpecs.elements ? `${Number(opticalSpecs.elements)}` : null },
    { label: "Groups", value: opticalSpecs.groups ? `${Number(opticalSpecs.groups)}` : null },
  ];

  const title = `${lens.display_name} — specs, used checklist, and typical price`;
  const description = bio.length > 160 ? `${bio.slice(0, 157)}…` : bio;

  const brandHref = lens.brand_slug ? `/brands/${encodeURIComponent(lens.brand_slug)}` : null;
  const crumbBrand = brandHref ? `<a href="${escapeHtml(brandHref)}">${escapeHtml(lens.brand_name || lens.brand_slug)}</a>` : "";

  const body = `
    <h1>${escapeHtml(lens.display_name)}</h1>
    <nav class="subtle" aria-label="Breadcrumb">
      <a href="/lenses">Lenses</a>${crumbBrand ? ` • ${crumbBrand}` : ""}
    </nav>
    <div class="subtle">${escapeHtml(lens.brand_name || "")}${lens.release_year ? ` • Released ${escapeHtml(String(lens.release_year))}` : ""}</div>

    <h2>About</h2>
    <p>${escapeHtml(bio)}</p>

    <h2>Specs</h2>
    ${renderSpecTable(specRows)}

    <div class="grid">
      ${renderPriceBandCard(modelPage.price_band, { premiumPriceHistoryHref: `/premium/price-history/lenses/${encodeURIComponent(lens.slug)}` })}
      ${renderListingCountsCard({ listingCounts: modelPage.listing_counts_by_source, lastUpdatedAt: modelPage.last_updated_at })}
    </div>

    <h2>Listings</h2>
    <div class="subtle">Outbound links may be affiliate links. We may earn a commission.</div>
    ${renderListingsTable(modelPage.listings)}

    <h2>Used-buyer checklist</h2>
    ${renderBullets(checklistOut)}

    <h2>Known issues</h2>
    ${
      knownIssues.length
        ? renderBullets(knownIssues)
        : `<div class="subtle">No model-specific issues recorded yet. Use the checklist above and ask for close-up photos of glass and mount surfaces.</div>`
    }

    <h2>Data</h2>
    <ul>
      <li>Currency view: <code>${escapeHtml(currency)}</code> (change via <code>?currency=USD</code>)</li>
      <li>Lens JSON: <code>/api/v1/lenses/${escapeHtml(lens.slug)}</code></li>
      <li>Listings JSON: <code>/api/v1/listings?lens_slug=${escapeHtml(lens.slug)}</code></li>
    </ul>
  `;

  return documentHtml({ title, description, canonicalUrl, robots, bodyHtml: body });
}

function renderDealScoreCard(listing, { isPremium = false } = {}) {
  const score = listing.deal_score !== null && listing.deal_score !== undefined ? Number(listing.deal_score) : null;
  const conf = listing.deal_score_confidence !== null && listing.deal_score_confidence !== undefined ? Number(listing.deal_score_confidence) : null;
  const version = isNonEmptyString(listing.deal_score_version) ? listing.deal_score_version : null;

  if (score === null || !Number.isFinite(score)) {
    return `<section class="card" aria-label="Deal score">
      <h2>Deal score</h2>
      <p class="subtle">Deal score is not computed for this listing yet.</p>
    </section>`;
  }

  const breakdownHidden = listing.deal_score_breakdown_hidden === true;
  const breakdown = safeJsonObject(listing.deal_score_breakdown);
  const factors = Array.isArray(breakdown?.factors) ? breakdown.factors : [];

  const rows = factors
    .map((f) => {
      const key = isNonEmptyString(f?.key) ? f.key : "";
      const weight = typeof f?.weight === "number" ? String(f.weight) : "—";
      const value = typeof f?.value === "number" ? String(f.value) : "—";
      const fc = typeof f?.confidence === "number" ? String(f.confidence) : "—";
      return `<tr>
        <td><code>${escapeHtml(key)}</code></td>
        <td>${escapeHtml(weight)}</td>
        <td>${escapeHtml(value)}</td>
        <td>${escapeHtml(fc)}</td>
      </tr>`;
    })
    .join("");

  const table = breakdownHidden
    ? `<p class="subtle">
        Factor breakdown is a Premium feature. ${isPremium ? "" : `<a href="/premium">Upgrade</a> to see the details.`}
      </p>`
    : rows
      ? `<table aria-label="Deal score factors">
          <thead>
            <tr>
              <th scope="col">Factor</th>
              <th scope="col">Weight</th>
              <th scope="col">Value</th>
              <th scope="col">Confidence</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>`
      : `<div class="subtle">No factor breakdown recorded.</div>`;

  return `<section class="card" aria-label="Deal score">
    <h2>Deal score</h2>
    <p><strong>${escapeHtml(String(Math.round(score)))}</strong> / 100${conf !== null && Number.isFinite(conf) ? ` <span class="subtle">(confidence ${escapeHtml(String(conf))})</span>` : ""}</p>
    <p class="subtle">Deterministic score (${escapeHtml(version || "unknown")}); not a guarantee of value or condition.</p>
    ${table}
  </section>`;
}

export function renderListingDetailPageHtml(listing, { canonicalUrl = null, robots = null, isPremium = false } = {}) {
  if (!listing) return renderErrorPageHtml({ statusCode: 404, title: "Listing not found", message: "Unknown listing id." });

  const source = isNonEmptyString(listing.marketplace_display_name) ? listing.marketplace_display_name : listing.marketplace_code;
  const sponsored = listing.marketplace_is_sponsored === true;
  const sponsoredLabel = isNonEmptyString(listing.marketplace_sponsored_label) ? listing.marketplace_sponsored_label : "Sponsor (paid)";
  const sponsorBadgeHtml = sponsored ? ` <span class="badge badge-sponsored">${escapeHtml(sponsoredLabel)}</span>` : "";
  const price = formatListingPrice(listing);
  const condition = enumLabel(listing.condition_physical_tier) || "—";
  const loc = formatLocation(listing) || "—";
  const retrieved = listing.last_retrieved_at || "—";
  const go = `/go/listings/${encodeURIComponent(listing.listing_id)}?page_type=other&utm_source=ff_listing&utm_medium=internal`;
  const jsonHref = `/api/v1/listings/${encodeURIComponent(listing.listing_id)}`;

  const title = `Listing • ${source}`;
  const description = `Used listing from ${source}.`;

  const body = `
    <h1>Listing</h1>
    <div class="subtle">${escapeHtml(source || "—")}${sponsorBadgeHtml}</div>

    <section class="card" aria-label="Listing details">
      <h2>Details</h2>
      <ul>
        <li><strong>Title:</strong> ${escapeHtml(listing.title || "—")}</li>
        <li><strong>Price:</strong> ${escapeHtml(price)}</li>
        <li><strong>Condition:</strong> ${escapeHtml(condition)}</li>
        <li><strong>Location:</strong> ${escapeHtml(loc)}</li>
        <li><strong>Retrieved:</strong> ${escapeHtml(retrieved)}</li>
      </ul>
      <p><a href="${escapeHtml(go)}" rel="nofollow sponsored noopener noreferrer" target="_blank">View on marketplace</a></p>
      ${sponsored ? `<p class="subtle">This listing is a paid placement (${escapeHtml(sponsoredLabel)}).</p>` : ""}
      <p class="subtle"><a href="${escapeHtml(jsonHref)}" rel="nofollow">JSON</a></p>
    </section>

    ${renderDealScoreCard(listing, { isPremium })}

    <p class="subtle"><a href="/privacy">Privacy</a></p>
  `;

  return documentHtml({ title, description, canonicalUrl, robots, bodyHtml: body });
}

export function renderErrorPageHtml({ statusCode = 500, title, message }) {
  const safeTitle = title || "Error";
  const safeMsg = message || "Something went wrong.";
  const body = `<h1>${escapeHtml(safeTitle)}</h1><p class="subtle">${escapeHtml(safeMsg)}</p><p class="subtle">Status: ${escapeHtml(
    String(statusCode),
  )}</p>`;
  return documentHtml({ title: safeTitle, description: safeMsg, bodyHtml: body });
}
