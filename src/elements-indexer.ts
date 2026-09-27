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
  maxPages?: number; // listing-page completions (TODO: pagination; first page only for now)
  maxItems?: number;
  now?: () => number;
}): Promise<{ itemsIndexed: number; skipped: boolean }> {
  const { client, cache } = deps;
  const now = deps.now ?? Date.now;
  const maxItems = deps.maxItems ?? PAGE_SIZE;

  // getMeta(key, maxAgeMs) already returns null past maxAge — no manual check.
  if (cache.getMeta<number>("elements_indexed_at", ELEMENTS_INDEX_STALE_MS) !== null) {
    return { itemsIndexed: 0, skipped: true };
  }

  const listingHtml = await client.getHtml("/elements/");
  const slugs = (parseElementsGallery(listingHtml) ?? []).slice(0, maxItems);

  const records: ElementRecord[] = [];
  for (const slug of slugs) {
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
      projectId: null, // Task 5 pairs gallery items to site slugs when possible
      fetchedAt: now(),
    });
  }
  if (records.length > 0) cache.upsertElements(records);
  cache.setMeta("elements_indexed_at", now());
  return { itemsIndexed: records.length, skipped: false };
}
