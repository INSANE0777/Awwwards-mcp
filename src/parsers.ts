import type { Categories, ElementMedia, GalleryItem, SiteDetails, SiteSummary } from "./types.js";

const ENTITIES: Record<string, string> = {
  "&quot;": '"',
  "&amp;": "&",
  "&#039;": "'",
  "&#39;": "'",
  "&lt;": "<",
  "&gt;": ">",
  "&nbsp;": " ",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(?:quot|amp|#0?39|lt|gt|nbsp);/g, (e) => ENTITIES[e] ?? e);
}

const AWARD_LABELS: Record<string, string> = {
  sotd: "Site of the Day",
  dev: "Developer Award",
  hm: "Honorable Mention",
  sotm: "Site of the Month",
  mobile: "Mobile Excellence",
  ecom: "E-Commerce Award",
};

// Card JSON blob and its markup: the blob sits in data-collectable-model-value
// immediately before the card markup. The blob is HTML-entity-escaped JSON, so
// the closing quote of the attribute is the first raw `">` after the split point.
export function parseListing(html: string): SiteSummary[] {
  const sites: SiteSummary[] = [];
  const parts = html.split('data-collectable-model-value="');
  for (const part of parts.slice(1)) {
    const end = part.indexOf('">');
    if (end < 0) continue;
    let meta: any;
    try {
      meta = JSON.parse(decodeEntities(part.slice(0, end)));
    } catch {
      continue;
    }
    if (!meta?.slug || !meta?.title) continue;
    if (meta.type && meta.type !== "submission") continue;
    const card = part.slice(end, end + 8000); // one card block is ~3KB; 8KB is safe
    const detailMatch = card.match(/href="(\/sites\/[^"#?]+)"/);
    if (!detailMatch) continue; // collections/other modules are not site cards
    const liveMatch = card.match(/class="figure-rollover__bt"[^>]*href="(https?:\/\/[^"]+)"/);
    const awards = [...card.matchAll(/budget-tag--([a-z-]+)/g)].map(
      (m) => AWARD_LABELS[m[1]] ?? m[1],
    );
    sites.push({
      id: meta.id ?? 0,
      slug: meta.slug,
      title: decodeEntities(meta.title),
      createdAt: meta.createdAt ?? 0,
      tags: Array.isArray(meta.tags) ? meta.tags.map(decodeEntities) : [],
      thumbnailPath: meta.images?.thumbnail ?? "",
      liveUrl: liveMatch ? decodeEntities(liveMatch[1]) : null,
      detailPath: detailMatch[1],
      awards: [...new Set(awards)],
    });
  }
  return sites;
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

export function parseDetail(html: string, slug: string): SiteDetails {
  const palette = [
    ...new Set(
      [...html.matchAll(/<strong>HEX<\/strong>\s*#([0-9A-Fa-f]{6})/g)].map((m) =>
        `#${m[1].toUpperCase()}`,
      ),
    ),
  ];

  const techIdx = html.indexOf("Technologies & Tools</h2>");
  const techSection = techIdx >= 0 ? html.slice(techIdx, techIdx + 6000) : "";
  const technologies = [
    ...new Set(
      [...techSection.matchAll(/class="button button--tag"[^>]*>([^<]+)</g)].map((m) =>
        stripTags(m[1]),
      ),
    ),
  ].filter(Boolean);

  const elStart = html.indexOf(">Elements</h2>");
  const elEnd = elStart >= 0 ? html.indexOf(">Color Palette</h2>", elStart) : -1;
  const elSection = elStart >= 0 && elEnd > elStart ? html.slice(elStart, elEnd) : "";
  const elements = [...elSection.matchAll(/collectableTitle&quot;:&quot;(.+?)&quot;/g)].map(
    (m) => decodeEntities(m[1]),
  );

  const awards = [...html.matchAll(
    /(Site of the Day|Developer Award|Honorable Mention|Site of the Month|Mobile Excellence|E-Commerce Award)\s*[-–]\s*([A-Z][a-z]+ \d{1,2}, \d{4})/g,
  )].map((m) => ({ title: m[1], date: m[2] }));

  const descIdx = html.indexOf(">Description</h2>");
  const descMatch =
    descIdx >= 0
      ? html.slice(descIdx, descIdx + 3000).match(/<h3 class="heading-6">([\s\S]{0,2000}?)<\/h3>/)
      : null;
  // Curated section is primary (longer/richer when present, ~16% of pages);
  // og:description meta is the fallback (50/50 in the 2026-09-19 probe, same
  // text as meta description). Ported from scripts/enrich-styles.mjs.
  const curatedDescription = descMatch ? stripTags(descMatch[1]) || null : null;
  const ogDescMatch = html.match(/property="og:description" content="([^"]*)"/);
  const ogDescription = ogDescMatch ? decodeEntities(ogDescMatch[1]).trim() || null : null;

  const ogMatch = html.match(/property="og:image" content="([^"]+)"/);

  // Live site: the h1 anchor points at the awarded site itself
  // (verified: <h1 class="heading-1 text-uppercase"> <a href="https://..." target="_blank" rel="noopener">TITLE</a>).
  // Fallback: first blank-target noopener anchor to a non-awwwards host.
  const h1Match = html.match(
    /<h1 class="heading-1[^"]*">\s*<a href="(https?:\/\/(?!www\.awwwards\.com|assets\.awwwards\.com)[^"]+)"[^>]*>([\s\S]*?)<\/a>/,
  );
  const liveFallback = h1Match
    ? null
    : html.match(
        /href="(https?:\/\/(?!www\.awwwards\.com|assets\.awwwards\.com)[^"]+)"[^>]*target="_blank" rel="noopener"/,
      );
  const liveUrl = h1Match?.[1] ?? liveFallback?.[1] ?? null;
  const titleMatch = html.match(/property="og:title" content="([^"]+)"/);

  return {
    slug,
    title: titleMatch ? decodeEntities(titleMatch[1]) : (h1Match ? stripTags(h1Match[2]) : null),
    description: curatedDescription ?? ogDescription,
    palette,
    technologies,
    elements,
    awards,
    ogImage: ogMatch ? decodeEntities(ogMatch[1]) : null,
    liveUrl: liveUrl ? decodeEntities(liveUrl) : null,
    score: parseScore(html),
    juryDimensions: parseJuryDimensions(html),
  };
}

// Displayed overall jury score, e.g. c-heading-score__note">→ 7.37<sup>/ 10</sup>.
// Non-award pages have no such heading → null.
export function parseScore(html: string): number | null {
  const m = /c-heading-score__note[^>]*>[^<]*?([\d]+(?:\.\d{1,2})?)/.exec(html);
  return m ? parseFloat(m[1]) : null;
}

const DIMENSION_KEYS = ["design", "usability", "creativity", "content"] as const;
type DimensionKey = (typeof DIMENSION_KEYS)[number];
type JuryDimensions = Record<DimensionKey, number>;

// Per-dimension jury scores from the layout-overall chartbar block on award
// pages (verified live 2026-09-20 on SOTD winners aspen-search,
// hearst-exhibit-2026 and emergence-magazine): four weighted type labels —
// <div class="layout-overall__type">Design<strong>40%</strong></div> ... —
// followed by four progressbars whose data-note attributes carry the scores
// in the same order:
// <div class="layout-overall__progressbar js-chart-bar" data-note="7.54">.
// The 40/30/20/10-weighted average of the notes reproduces the displayed
// total score exactly on every probed page. No Development dimension exists
// in the HTML. Undefined when the block is absent, the counts differ, or the
// labels are not exactly the known four — refuse to guess a drifted mapping.
export function parseJuryDimensions(html: string): JuryDimensions | undefined {
  const start = html.indexOf('<div class="layout-overall"');
  if (start < 0) return undefined;
  // The block ends at the votes tabs controller that follows it; bound the
  // slice so data-note attributes elsewhere on the page cannot leak in.
  const tabsIdx = html.indexOf('<div data-controller="tabs">', start);
  const block = html.slice(start, tabsIdx > start ? tabsIdx : start + 4000);
  const labels = [...block.matchAll(/layout-overall__type">\s*(\w+)\s*<strong>/g)].map((m) =>
    m[1].toLowerCase(),
  );
  const notes = [...block.matchAll(/data-note="([0-9]+(?:\.[0-9]+)?)"/g)].map((m) =>
    parseFloat(m[1]),
  );
  if (labels.length !== 4 || notes.length !== 4) return undefined;
  const dims: Partial<JuryDimensions> = {};
  for (const [i, label] of labels.entries()) {
    if ((DIMENSION_KEYS as readonly string[]).includes(label)) dims[label as DimensionKey] = notes[i];
  }
  if (DIMENSION_KEYS.some((k) => typeof dims[k] !== "number")) return undefined;
  return {
    design: dims.design!,
    usability: dims.usability!,
    creativity: dims.creativity!,
    content: dims.content!,
  };
}

const NON_FILTERS = new Set(["sites_of_the_day"]);

// Filter taxonomy from listing-page sidebars: color filters link to
// /websites/%23<HEX>/ and tag/technology filters to /websites/<slug>/. Award
// collections (sites_of_the_day) are not tags — they are exposed via the
// `award` argument on the search tool instead.
export function parseCategories(html: string): Categories {
  const colors = [
    ...new Set(
      [...html.matchAll(/href="\/websites\/%23([0-9A-Fa-f]{6})\/"/g)].map((m) =>
        `#${m[1].toUpperCase()}`,
      ),
    ),
  ].sort();
  const filters = [
    ...new Set(
      [...html.matchAll(/href="\/websites\/([a-z0-9-]{2,60})\/"/g)].map((m) => m[1]),
    ),
  ]
    .filter((s) => !NON_FILTERS.has(s))
    .sort();
  return { colors, filters };
}

// Elements section highlights: null means the page has no Elements section
// (a legitimate empty); an empty array means the section exists but no blobs
// parsed — the markup changed and the parser needs updating.
export function parseElements(html: string): ElementMedia[] | null {
  const start = html.indexOf(">Elements</h2>");
  if (start < 0) return null;
  const end = html.indexOf(">Color Palette</h2>", start);
  const section = end > start ? html.slice(start, end) : html.slice(start);
  const elements: ElementMedia[] = [];
  const parts = section.split('data-collectable-model-value="');
  for (const part of parts.slice(1)) {
    const stop = part.indexOf('">');
    if (stop < 0) continue;
    let blob: any;
    try {
      blob = JSON.parse(decodeEntities(part.slice(0, stop)));
    } catch {
      continue;
    }
    const mediaPath = blob?.collectableImage;
    // Only element media; other blobs (site card, collections) must not leak
    // in if the end bound is missing. Media paths come in two schemes: modern
    // sites store them under element/YYYY/MM/..., 2018-era sites under
    // external/YYYY/MM/... (both verified live 2026-09-18 — the CDN serves
    // both prefixes and their _static.jpeg posters).
    if (typeof mediaPath === "string" && /^(element|external)\//.test(mediaPath)) {
      elements.push({
        title: decodeEntities(String(blob.collectableTitle ?? "")),
        mediaPath,
      });
    }
  }
  return elements;
}

// /elements/ gallery listing: element tiles deep-link to
// /inspiration/<slug> pages (live-verified 2026-09-28, e.g.
// /inspiration/about-page-realevate).
// null = no /inspiration/ href anywhere (drift or empty body);
// [] = page parsed but gallery has zero tiles (legitimate empty).
export function parseElementsGallery(html: string): string[] | null {
  const matches = [...html.matchAll(/href="\/inspiration\/([\w-]+)\/?"/g)].map((m) => m[1]);
  if (matches.length === 0) return html.length === 0 ? null : [];
  return [...new Set(matches)];
}

// Taxonomy facets from a gallery page's filter nav (nav-filters__subitem
// links into /elements/<category>/). Anchoring the match on the subitem class
// excludes pagination (?page=N) and card-level /elements/ noise. Verified
// against the 2026-09-28 fixture: 46 facets, including the unobvious
// 404_page/thumbnail/mobile_thumbnail which ARE real facet nav entries.
export function parseElementCategories(html: string): string[] | null {
  const matches = [...html.matchAll(/nav-filters__subitem[^>]*href="\/elements\/([\w-]+)\/?"/g)].map(
    (m) => m[1],
  );
  if (matches.length === 0) return html.length === 0 ? null : [];
  return [...new Set(matches)];
}

// Element detail page (/inspiration/<slug>). Anchor notes verified against the
// committed fixture test/fixtures/elements-item.html (2026-09-28, slug
// "about-page-realevate"):
// - og:url is ABSENT on element pages; the canonical link carries the
//   permalink: <link rel="canonical" href="https://www.awwwards.com/inspiration/<slug>" />.
// - Title/author: <h1 class="gallery-element__title">About Page
//   <small>from</small> <a href="/sites/realevate">Realevate</a></h1> — the
//   word "from" is wrapped in <small>, so the anchor is "from</small>".
// - builtWith: <p class="subtitle-center">This element was built with...</p>
//   followed by <strong class="button button--tag no-pointer">interaction</strong>.
// - Collectable blob attributes close with a raw `"` then newline+`>`, so the
//   stop marker is the first `"` after the split.
// - No /elements/<category>/ breadcrumb on this page shape → category null.
export function parseElementGalleryPage(html: string): GalleryItem | null {
  const allSlugs = parseElementsGallery(html) ?? [];
  const slug =
    html.match(/rel="canonical" href="[^"]*?\/inspiration\/([\w-]+)\/?"/)?.[1] ?? allSlugs[0] ?? null;
  if (!slug) return null;

  const title = html
    .match(/<h1[^>]*>\s*([\s\S]{2,200}?)\s*(?:<small>from<\/small>|<\/h1>)/)?.[1]
    ?.replace(/<[^>]+>/g, "")
    .trim() ?? null;

  // "from</small> <a ...>Author</a>" inside the h1. The anchor's attributes
  // contain ">" inside quoted values (data-action="click->preview#preview"),
  // so the tag body must be quote-aware, not [^>]*.
  const author =
    html.match(
      /from<\/small>\s*<a(?:[^>"']|"[^"]*"|'[^']*')*>\s*([\s\S]{2,120}?)<\/a>/,
    )?.[1]?.replace(/<[^>]+>/g, "").trim() ?? null;

  // Task 5 pairing: the same attribution anchor's href is the owning site's
  // slug (e.g. /sites/realevate), the join key to the sites table. Verified
  // against the 2026-09-28 fixture: exactly one /sites/ anchor per item page.
  const siteSlug = html.match(/from<\/small>\s*<a[^>]*?href="\/sites\/([\w-]+)"/)?.[1] ?? null;

  // "This element was built with" section: tag chips until the section closes.
  const builtWith: string[] = [];
  const builtI = html.indexOf('was built with...</p>');
  if (builtI >= 0) {
    const chunk = html.slice(builtI, builtI + 2000);
    for (const t of chunk.matchAll(/button--tag[^>]*>([^<]{2,30})</g)) {
      const v = t[1].trim();
      if (v && !builtWith.includes(v)) builtWith.push(v);
    }
  }

  const related = allSlugs.filter((s) => s !== slug);

  // Media: same collectable blob scheme as site details.
  let mediaPath: string | null = null;
  let mediaType: "video" | "image" | null = null;
  for (const part of html.split('data-collectable-model-value="').slice(1)) {
    const stop = part.indexOf('"');
    if (stop < 0) continue;
    try {
      const blob = JSON.parse(decodeEntities(part.slice(0, stop))) as { collectableImage?: string };
      if (blob?.collectableImage) {
        mediaPath = blob.collectableImage;
        mediaType = mediaPath.endsWith(".mp4") ? "video" : "image";
        break;
      }
    } catch {
      /* blob variants without media are fine */
    }
  }

  // Category: breadcrumb link into /elements/<category>/.
  const category = html.match(/href="\/elements\/([\w-]+)\/"/)?.[1] ?? null;

  return { slug, title, author, builtWith, related, mediaPath, mediaType, category, siteSlug };
}
