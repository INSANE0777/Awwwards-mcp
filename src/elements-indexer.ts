import { AwwwardsClient } from "./awwwards.js";
import type { Cache } from "./cache.js";
import { parseElementsGallery, parseElementGalleryPage } from "./parsers.js";
import type { ElementRecord } from "./types.js";

export const ELEMENTS_INDEX_STALE_MS = 7 * 24 * 60 * 60 * 1000;
const PAGE_SIZE = 48; // crawl page window; item pages fetched sequentially 1/s via client's RateLimiter

export function normalizeCategory(category: string | null): string {
  if (!category) return "unsorted";
  return category.toLowerCase().replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "") || "unsorted";
}

export async function runElementsIndexer(deps: {
  client: AwwwardsClient;
  cache: Cache;
  // Listing pages to crawl. The gallery paginates at /elements/?page=N
  // (48 items/page); Infinity = follow until a page is empty or fails.
  maxPages?: number;
  maxItems?: number;
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
  for (let page = 1; page <= maxPages; page++) {
    let html: string;
    try {
      html = await client.getHtml(page === 1 ? "/elements/" : `/elements/?page=${page}`);
    } catch {
      break; // a missing later page never aborts what earlier pages found
    }
    const pageSlugs = parseElementsGallery(html) ?? [];
    if (pageSlugs.length === 0) break;
    for (const slug of pageSlugs) {
      if (!seen.has(slug)) slugs.push(slug);
      seen.add(slug);
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
    records.push({
      slug: item.slug,
      title: item.title ?? slug,
      cid: normalizeCategory(item.category),
      category: item.category ?? "",
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
