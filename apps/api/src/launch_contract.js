export const SITE_TAGLINE = "Camera-body-first used market intelligence";

export const PRIMARY_NAV_LINKS = [
  { href: "/cameras", label: "Cameras", testId: "ff-nav-cameras" },
  { href: "/brands", label: "Brands", testId: "ff-nav-brands" },
  { href: "/compare", label: "Compare", testId: "ff-nav-compare" },
];

export const PARKED_SURFACE_ROBOTS = "noindex,follow";

export const SITEMAP_STATIC_PATHS = ["/", "/cameras", "/brands", "/compare", "/about", "/privacy"];

export function buildLlmsText() {
  return [
    "# Fast Focus",
    "",
    "Fast Focus is a camera-body-first discovery surface for used-camera buyers.",
    "",
    "## Launch pages",
    "- /",
    "- /brands/{brand}",
    "- /cameras",
    "- /cameras/{slug}",
    "- /compare",
    "- /compare/{slugA}-vs-{slugB}",
    "",
    "## Machine-readable endpoints",
    "- /api/v1/brands",
    "- /api/v1/cameras",
    "- /api/v1/cameras/{slug}",
    "- /api/v1/cameras/{slug}/price-band",
    "- /api/v1/listings?camera_slug={slug}",
    "- /api/v1/price-bands/methodology",
    "",
    "## Crawl guidance",
    "- Prefer canonical URLs over query-param variations.",
    "- Use /sitemap.xml for the indexable launch surface.",
    "- /go/* is an outbound tracking redirect and should not be indexed.",
    "- Lens, guide, newsletter, and premium routes may exist in code, but they are not part of the launch navigation contract.",
    "",
  ].join("\n");
}
