import { AwwwardsClient } from "./awwwards.js";
import type { Cache } from "./cache.js";
import { parseElementsGallery, parseElementGalleryPage, parseElementCategories } from "./parsers.js";
import type { ElementRecord } from "./types.js";

export const ELEMENTS_INDEX_STALE_MS = 7 * 24 * 60 * 60 * 1000;
const PAGE_SIZE = 48; // crawl page window; item pages fetched sequentially 1/s via client's RateLimiter

export function normalizeCategory(category: string | null): string {
  if (!category) return "unsorted";
  return category.toLowerCase().replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "") || "unsorted";
}

// Fallback taxonomy for the category pass, used when the facet nav can't be
// parsed from the listing (drift). Frozen 2026-09-28 from the live facet nav
// on /elements/ (46 entries — order as scraped); see parseElementCategories.
export const GALLERY_CATEGORIES = [
  "404_page", "about_us", "animation", "blog", "branding", "CTA", "contact",
  "content", "cookie", "thumbnail", "FAQ", "footer", "forms", "gallery",
  "header", "hero_image", "icons", "illustration", "interaction", "layout",
  "loading", "login_and_sign_up", "maps", "menu", "microcopy_and_ux_writing",
  "mobile_thumbnail", "modal", "mouse_interaction", "navigation", "newsletter",
  "notification", "other", "pagination", "photo", "pricing_page", "products",
  "scroll", "search", "shopping_cart", "sidebar", "social_share", "stats",
  "team", "transition", "ui_components", "video",
] as const;

export async function runElementsIndexer(deps: {
  client: AwwwardsClient;
  cache: Cache;
  // Listing pages to crawl. The gallery paginates at /elements/?page=N
  // (48 items/page); Infinity = follow until a page is empty or fails.
  maxPages?: number;
  maxItems?: number;
  // Also crawl every taxonomy facet page (/elements/<category>/) to fill the
  // slug→cid map. Adds ~46 extra 1/s fetches, so opt-in: only for crawls that
  // asked for more than the bootstrap page.
  withCategories?: boolean;
  now?: () => number;
}): Promise<{ itemsIndexed: number; skipped: boolean }> {
  const { client, cache } = deps;
  const now = deps.now ?? Date.now;
  // Default 1 page: the server's empty-corpus auto-index stays a quick
  // bootstrap. Full-corpus crawls opt in via the index CLI (--elements-pages).
  const maxPages = deps.maxPages ?? 1;
  const maxItems = deps.maxItems ?? PAGE_SIZE * (Number.isFinite(maxPages) ? maxPages : 32);

  // getMeta(key, maxAgeMs) already returns null past maxAge — no manual check.
  if (cache.getMeta<number>("elements_indexed_at", ELEMENTS_INDEX_STALE_MS) !== null) {
    return { itemsIndexed: 0, skipped: true };
  }

  // Page 1 has no query; /elements/?page=N from N=2 up. A failed or empty
  // page ends the crawl — drift (null parse) means fewer pages exist than
  // we asked for, not that the corpus is empty (page 1 already succeeded).
  const slugs: string[] = [];
  const seen = new Set<string>();
  let firstPageHtml = ""; // reused by the taxonomy pass for facet discovery
  for (let page = 1; page <= maxPages; page++) {
    let html: string;
    try {
      html = await client.getHtml(page === 1 ? "/elements/" : `/elements/?page=${page}`);
    } catch {
      break; // a missing later page never aborts what earlier pages found
    }
    if (page === 1) firstPageHtml = html;
    const pageSlugs = parseElementsGallery(html) ?? [];
    if (pageSlugs.length === 0) break;
    for (const slug of pageSlugs) {
      if (!seen.has(slug)) slugs.push(slug);
      seen.add(slug);
    }
  }

  // Taxonomy pass: fetch each facet page once and map its slugs to that cid.
  // Item pages carry no breadcrumb (see parsers.ts), so this listing-side
  // pass is the only category source. A slug under several categories keeps
  // the first — facet pages overlap, and one cid per row is the storage model.
  const cidBySlug = new Map<string, string>();
  if (deps.withCategories) {
    let facets = parseElementCategories(firstPageHtml);
    if (!facets || facets.length === 0) facets = [...GALLERY_CATEGORIES];
    for (const cat of facets) {
      const cid = normalizeCategory(cat);
      let html: string;
      try {
        html = await client.getHtml(`/elements/${cat}/`);
      } catch {
        continue; // one dead facet page never aborts the crawl
      }
      for (const slug of parseElementsGallery(html) ?? []) {
        if (!cidBySlug.has(slug)) cidBySlug.set(slug, cid);
      }
    }
  }
  // maxItems caps item-page fetches, not listing pages: crawl every page in
  // the maxPages budget first, then take the head of the deduped list.
  const capped = slugs.slice(0, maxItems);

  const records: ElementRecord[] = [];
  for (const slug of capped) {
    let html: string;
    try {
      html = await client.getHtml(`/inspiration/${slug}/`);
    } catch {
      continue; // one failed element page never aborts the crawl
    }
    const item = parseElementGalleryPage(html);
    if (!item) continue;
    const cid =
      cidBySlug.get(item.slug) ?? normalizeCategory(item.category) /* breadcrumb, when present */;
    const categoryTitle = item.category ?? "";
    records.push({
      slug: item.slug,
      title: item.title ?? slug,
      cid,
      category: categoryTitle,
      author: item.author ?? "",
      builtWith: item.builtWith,
      related: item.related,
      mediaPath: item.mediaPath ?? "",
      mediaType: item.mediaType,
      source: "gallery",
      projectId: null, // legacy pairing field; Task 5 pairs via siteSlug below
      siteSlug: item.siteSlug, // attribution /sites/<slug> href — null when absent
      fetchedAt: now(),
    });
  }
  if (records.length > 0) {
    cache.upsertElements(records);
    // Never stamp freshness on an empty crawl: a listing that parsed but
    // whose item pages all failed must not block re-indexing for 7 days
    // while countElements() === 0 (repo "never cache empty parses" rule).
    cache.setMeta("elements_indexed_at", now());
  }
  return { itemsIndexed: records.length, skipped: false };
}
