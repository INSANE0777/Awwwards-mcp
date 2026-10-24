import { AwwwardsClient, BlockedError, SHARED_RATE_LIMITER } from "./awwwards.js";
import type { RateLimiter } from "./awwwards.js";
import type { Cache } from "./cache.js";
import { decodeEntities, parseListing } from "./parsers.js";
import type { SiteSummary } from "./types.js";

// Awwwards collections are real pages under two shapes:
// - curated: /awwwards/collections/<slug>/ (the /collections/<slug>/ form 404s)
// - member:  /<username>/collections/<slug>/
// The index at /collections/ lists both and paginates with ?page=N.
// Robots allows /collections/ (only /websites/? is query-disallowed).
export const COLLECTIONS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SourceMeta {
  cached: boolean;
  stale?: true;
  blocked?: true;
  error?: string;
}

export interface CollectionSummary {
  title: string;
  slug: string;
  href: string;
  blurb?: string;
}

export interface CollectionsListResult {
  collections: CollectionSummary[];
  page: number;
  hasMore: boolean;
  meta: SourceMeta;
  note: string;
}

export interface CollectionResult {
  slug: string;
  title?: string;
  sites: SiteSummary[];
  // Total items claimed by the page ("N items."), when present. sites is the
  // first page only, so this makes the truncation explicit.
  total?: number;
  meta: SourceMeta;
  note: string;
}

export interface CollectionsDeps {
  cache: Cache;
  fetchFn?: typeof fetch;
  rateLimiter?: RateLimiter;
  timeoutMs?: number;
}

const LIST_NOTE =
  "Collections are listed from awwwards.com/collections (paginated, one page per call). " +
  "Personal, non-commercial inspiration use.";

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function cleanText(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function clampPage(page: number | undefined): number {
  const n = typeof page === "number" && Number.isFinite(page) ? Math.trunc(page) : 1;
  return Math.min(100, Math.max(1, n));
}

function collectionHref(meta: any, slug: string): string {
  const owner = typeof meta?.user?.username === "string" ? meta.user.username : "";
  return owner && owner !== "awwwards"
    ? `/${owner}/collections/${slug}/`
    : `/awwwards/collections/${slug}/`;
}

// Listing cards carry an HTML-escaped data-model JSON blob followed by the
// card markup. Verified live 2026-10-25: 32 collection blobs per index page,
// type "collection"; site/element blobs on the same page are ignored.
// null = no collections grid at all (layout drift); [] = grid but no items.
export function parseCollectionsIndex(
  html: string,
  page = 1,
): { collections: CollectionSummary[]; hasMore: boolean } | null {
  if (!html.includes('data-group="collections"')) return null;
  const collections: CollectionSummary[] = [];
  const seen = new Set<string>();
  for (const part of html.split('data-model="').slice(1)) {
    const end = part.indexOf('"');
    if (end < 0) continue;
    let meta: any;
    try {
      meta = JSON.parse(decodeEntities(part.slice(0, end)));
    } catch {
      continue;
    }
    if (meta?.type !== "collection" || typeof meta.slug !== "string" || typeof meta.name !== "string") {
      continue;
    }
    const slug = meta.slug.trim();
    if (!slug) continue;
    const card = part.slice(end, end + 4000);
    const href =
      card.match(/href="(\/[^"]*\/collections\/[^"/]+\/)"/)?.[1] ?? collectionHref(meta, slug);
    // Same slug can exist under different owners; dedupe on the full href.
    if (seen.has(href)) continue;
    const blurb = cleanText(String(meta.description ?? ""));
    seen.add(href);
    collections.push({
      title: cleanText(meta.name),
      slug,
      href,
      ...(blurb ? { blurb } : {}),
    });
  }
  const pages = [...html.matchAll(/\/collections\/\?page=(\d+)/g)].map((m) => Number(m[1]));
  return { collections, hasMore: pages.some((n) => n > page) };
}

// Collection pages are ordinary site listings: the same data-collectable blob
// + /sites/<slug> anchor shape parseListing already handles. Verified live
// 2026-10-25 on brutalism (10 of 83 items on page 1). null = not a collection
// page (no heading and no site grid).
export function parseCollectionPage(
  html: string,
  slug: string,
): { slug: string; title?: string; sites: SiteSummary[]; total?: number } | null {
  const heading = html.match(/<h1[^>]*js-collection-name[^>]*>([\s\S]*?)<\/h1>/);
  const grid = html.includes("grid-sites js-ajax-entries");
  if (!heading && !grid) return null;
  const title = heading ? cleanText(heading[1]) : "";
  const totalRaw = html.match(/class="total-grid"[^>]*>\s*<strong>(\d+)<\/strong>/)?.[1];
  const total = totalRaw === undefined ? undefined : Number(totalRaw);
  return {
    slug,
    ...(title ? { title } : {}),
    sites: parseListing(html),
    ...(total !== undefined ? { total } : {}),
  };
}

// Accepts "brutalism", "awwwards/brutalism", or "Mixallo/collections/pastel-colors".
// Returns null instead of building an unsafe path from caller input.
export function normalizeCollectionSlug(
  value: string,
): { slug: string; href: string; key: string } | null {
  const raw = value.trim().replace(/^\/+|\/+$/g, "");
  if (!raw || raw.includes("..") || /[\\?#]/.test(raw)) return null;
  const parts = raw.split("/").filter(Boolean);
  if (parts.some((p) => !/^[A-Za-z0-9._-]+$/.test(p))) return null;
  let owner: string | undefined;
  let slug: string;
  if (parts.length === 1) {
    slug = parts[0]!;
  } else if (parts.length === 2) {
    owner = parts[0]!;
    slug = parts[1]!;
  } else if (parts.length === 3 && parts[1] === "collections") {
    owner = parts[0]!;
    slug = parts[2]!;
  } else {
    return null;
  }
  if (!slug || slug === "collections") return null;
  const curated = !owner || owner === "awwwards";
  return {
    slug,
    href: curated ? `/awwwards/collections/${slug}/` : `/${owner}/collections/${slug}/`,
    key: curated ? `awwwards/${slug}` : `${owner}/${slug}`,
  };
}

async function fetchHtml(path: string, deps: CollectionsDeps): Promise<string> {
  const client = new AwwwardsClient({
    rateLimiter: deps.rateLimiter ?? SHARED_RATE_LIMITER,
    fetchFn: deps.fetchFn,
    timeoutMs: deps.timeoutMs,
  });
  return client.getHtml(path);
}

// Cache lookups are guarded: the store itself may be the failure source.
function staleRead<T>(cache: Cache, key: string): T | null {
  try {
    return cache.getMeta<T>(key, Number.POSITIVE_INFINITY);
  } catch {
    return null;
  }
}

export async function getCollections(
  page: number | undefined,
  deps: CollectionsDeps,
): Promise<CollectionsListResult> {
  const p = clampPage(page);
  const key = `collections:list:${p}`;
  const fresh = deps.cache.getMeta<{ collections: CollectionSummary[]; hasMore: boolean }>(
    key,
    COLLECTIONS_TTL_MS,
  );
  if (fresh) return { ...fresh, page: p, meta: { cached: true }, note: LIST_NOTE };

  try {
    const parsed = parseCollectionsIndex(
      await fetchHtml(p === 1 ? "/collections/" : `/collections/?page=${p}`, deps),
      p,
    );
    if (!parsed) {
      throw new Error(
        "Awwwards collections index layout may have changed: no collections grid found. " +
          "The parser needs an update.",
      );
    }
    const cached = { collections: parsed.collections, hasMore: parsed.hasMore };
    deps.cache.setMeta(key, cached);
    return { ...cached, page: p, meta: { cached: false }, note: LIST_NOTE };
  } catch (err) {
    const stale = staleRead<{ collections: CollectionSummary[]; hasMore: boolean }>(deps.cache, key);
    if (stale) {
      return {
        ...stale,
        page: p,
        meta: {
          cached: true,
          stale: true,
          ...(err instanceof BlockedError ? { blocked: true as const } : {}),
          error: message(err),
        },
        note: LIST_NOTE,
      };
    }
    throw err;
  }
}

export async function getCollection(
  slugInput: string,
  deps: CollectionsDeps,
): Promise<CollectionResult> {
  const ref = normalizeCollectionSlug(slugInput);
  if (!ref) {
    throw new Error(
      "Invalid collection slug. Use <slug> for curated collections " +
        "(e.g. 'brutalism') or <owner>/<slug> for member collections.",
    );
  }
  const key = `collections:item:${ref.key}`;
  const fresh = deps.cache.getMeta<{
    title?: string;
    sites: SiteSummary[];
    total?: number;
  }>(key, COLLECTIONS_TTL_MS);
  if (fresh) {
    return { slug: ref.slug, ...fresh, meta: { cached: true }, note: collectionNote(fresh) };
  }

  try {
    const parsed = parseCollectionPage(await fetchHtml(ref.href, deps), ref.slug);
    if (!parsed) {
      throw new Error(
        `Awwwards collection page ${ref.href} did not match the collection layout; ` +
          "the parser needs an update.",
      );
    }
    if (parsed.sites.length === 0 && (parsed.total ?? 0) > 0) {
      throw new Error(
        `Awwwards collection ${ref.slug} claims ${parsed.total} items but no site cards parsed; ` +
          "the parser needs an update.",
      );
    }
    const cached = { title: parsed.title, sites: parsed.sites, total: parsed.total };
    deps.cache.setMeta(key, cached);
    return { slug: ref.slug, ...cached, meta: { cached: false }, note: collectionNote(cached) };
  } catch (err) {
    const stale = staleRead<{
      title?: string;
      sites: SiteSummary[];
      total?: number;
    }>(deps.cache, key);
    if (stale) {
      return {
        slug: ref.slug,
        ...stale,
        meta: {
          cached: true,
          stale: true,
          ...(err instanceof BlockedError ? { blocked: true as const } : {}),
          error: message(err),
        },
        note: collectionNote(stale),
      };
    }
    throw err;
  }
}

function collectionNote(result: { sites: SiteSummary[]; total?: number }): string {
  const shown = result.sites.length;
  const total = result.total;
  const scope =
    total !== undefined && total > shown
      ? `First page only: ${shown} of ${total} items.`
      : `First page only: ${shown} site${shown === 1 ? "" : "s"}.`;
  return `${scope} Personal, non-commercial inspiration use.`;
}
