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

// Live-verified 2026-10-25: page 4 is the last index page (page 5 returns 404).
// A shortcut so an out-of-range call fails before spending a request; refresh
// this constant when the index grows.
export const COLLECTIONS_INDEX_MAX_PAGE = 4;

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
  // Public owner of the collection: "awwwards" for curated rows, the member
  // username otherwise.
  owner: string;
  // Round-trip reference accepted by get_collections.slug: plain slug for
  // curated rows, "owner/slug" for member collections.
  ref: string;
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
  // Public owner + round-trip ref (same shape as list rows).
  owner: string;
  ref: string;
  title?: string;
  page: number;
  sites: SiteSummary[];
  // Site cards on this page only.
  siteCards: number;
  // Total collectables on the whole collection page: sites + elements (fonts,
  // colors, talks, …). Not all of them are site cards.
  items?: number;
  meta: SourceMeta;
  note: string;
}

export interface ParsedCollectionPage {
  slug: string;
  title?: string;
  sites: SiteSummary[];
  items?: number;
  // True when the HTML contains site card markup (a /sites/ anchor or a
  // submission blob). An element-only collection has neither: its empty sites
  // array is content, not parser drift.
  hasSiteMarkup: boolean;
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

function isHttp404(err: unknown): boolean {
  return /HTTP 404\b/.test(message(err));
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

// Splits a collection href into its public owner and the round-trip ref.
function ownerFromHref(href: string, slug: string): { owner: string; ref: string } {
  const parts = href.split("/").filter(Boolean);
  const owner = parts.length >= 3 && parts[1] === "collections" ? parts[0]! : "awwwards";
  return { owner, ref: owner === "awwwards" ? slug : `${owner}/${slug}` };
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
    const { owner, ref } = ownerFromHref(href, slug);
    seen.add(href);
    collections.push({
      title: cleanText(meta.name),
      slug,
      href,
      owner,
      ref,
      ...(blurb ? { blurb } : {}),
    });
  }
  const pages = [...html.matchAll(/\/collections\/\?page=(\d+)/g)].map((m) => Number(m[1]));
  return { collections, hasMore: pages.some((n) => n > page) };
}

// Collection pages are ordinary listings: the same data-collectable blob +
// /sites/<slug> anchor shape parseListing already handles, plus element cards
// for collections whose items are not websites (e.g. talks). Verified live
// 2026-10-25: brutalism page 1 has 10 site cards and 83 total items; talks has
// 19 element items and zero site cards. null = not a collection page.
export function parseCollectionPage(html: string, slug: string): ParsedCollectionPage | null {
  const heading = html.match(/<h1[^>]*js-collection-name[^>]*>([\s\S]*?)<\/h1>/);
  const grid = html.includes("grid-sites js-ajax-entries");
  if (!heading && !grid) return null;
  const title = heading ? cleanText(heading[1]) : "";
  const totalRaw = html.match(/class="total-grid"[^>]*>\s*<strong>(\d+)<\/strong>/)?.[1];
  const items = totalRaw === undefined ? undefined : Number(totalRaw);
  const hasSiteMarkup =
    /href="\/sites\/[^"]*"/.test(html) ||
    /&quot;type&quot;:&quot;submission&quot;/.test(html) ||
    /"type":"submission"/.test(html);
  return {
    slug,
    ...(title ? { title } : {}),
    sites: parseListing(html),
    ...(items !== undefined ? { items } : {}),
    hasSiteMarkup,
  };
}

// Accepts "brutalism", "collections/brutalism", "awwwards/brutalism",
// "Mixallo/collections/pastel-colors" or "Mixallo/pastel-colors".
// Returns null instead of building an unsafe path from caller input.
export function normalizeCollectionSlug(
  value: string,
): { slug: string; owner: string; href: string; ref: string; key: string } | null {
  const raw = value.trim().replace(/^\/+|\/+$/g, "");
  if (!raw || raw.includes("..") || /[\\?#]/.test(raw)) return null;
  const parts = raw.split("/").filter(Boolean);
  if (parts.some((p) => !/^[A-Za-z0-9._-]+$/.test(p))) return null;

  let owner = "awwwards";
  let slug: string;
  if (parts.length === 1) {
    slug = parts[0]!;
  } else if (parts.length === 2) {
    if (parts[0] === "collections") {
      // "collections/<slug>" is the short curated form; do not double it.
      slug = parts[1]!;
    } else {
      owner = parts[0]!;
      slug = parts[1]!;
    }
  } else if (parts.length === 3 && parts[1] === "collections") {
    // "collections/collections/<slug>" is still the curated form, not a member
    // named "collections".
    owner = parts[0] === "collections" ? "awwwards" : parts[0]!;
    slug = parts[2]!;
  } else {
    return null;
  }
  if (!slug || slug === "collections") return null;
  const curated = owner === "awwwards";
  return {
    slug,
    owner,
    href: curated ? `/awwwards/collections/${slug}/` : `/${owner}/collections/${slug}/`,
    ref: curated ? slug : `${owner}/${slug}`,
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
  if (p > COLLECTIONS_INDEX_MAX_PAGE) {
    throw new Error(
      `Page ${p} is out of range; the collections index has ${COLLECTIONS_INDEX_MAX_PAGE} pages ` +
        `(live-verified 2026-10-25). Use page 1-${COLLECTIONS_INDEX_MAX_PAGE}.`,
    );
  }
  // v2: rows carry owner/ref; v1 rows are ignored rather than served without them.
  const key = `collections:list:v2:${p}`;
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
    if (isHttp404(err)) {
      throw new Error(
        `Page ${p} is out of range; the collections index has ${COLLECTIONS_INDEX_MAX_PAGE} pages ` +
          `(live-verified 2026-10-25). Use page 1-${COLLECTIONS_INDEX_MAX_PAGE}.`,
      );
    }
    throw err;
  }
}

interface CachedCollection {
  title?: string;
  sites: SiteSummary[];
  items?: number;
  // Legacy rows written before `items` existed.
  total?: number;
}

function collectionResult(
  ref: { slug: string; owner: string; ref: string },
  page: number,
  data: CachedCollection,
  meta: SourceMeta,
): CollectionResult {
  const items = data.items ?? data.total;
  return {
    slug: ref.slug,
    owner: ref.owner,
    ref: ref.ref,
    ...(data.title ? { title: data.title } : {}),
    page,
    sites: data.sites,
    siteCards: data.sites.length,
    ...(items !== undefined ? { items } : {}),
    meta,
    note: collectionNote(page, data.sites.length, items),
  };
}

export async function getCollection(
  slugInput: string,
  page: number | undefined,
  deps: CollectionsDeps,
): Promise<CollectionResult> {
  const ref = normalizeCollectionSlug(slugInput);
  if (!ref) {
    throw new Error(
      "Invalid collection slug. Use <slug> for curated collections " +
        "(e.g. 'brutalism') or <owner>/<slug> for member collections.",
    );
  }
  const p = clampPage(page);
  const key = `collections:item:${ref.key}:${p}`;
  const fresh = deps.cache.getMeta<CachedCollection>(key, COLLECTIONS_TTL_MS);
  if (fresh) return collectionResult(ref, p, fresh, { cached: true });

  try {
    const path = p === 1 ? ref.href : `${ref.href}?page=${p}`;
    const parsed = parseCollectionPage(await fetchHtml(path, deps), ref.slug);
    if (!parsed) {
      throw new Error(
        `Awwwards collection page ${ref.href} did not match the collection layout; ` +
          "the parser needs an update.",
      );
    }
    if (parsed.sites.length === 0 && parsed.hasSiteMarkup) {
      throw new Error(
        `Awwwards collection ${ref.slug} contains site card markup but no site cards parsed; ` +
          "the parser needs an update.",
      );
    }
    const cached: CachedCollection = {
      title: parsed.title,
      sites: parsed.sites,
      items: parsed.items,
    };
    deps.cache.setMeta(key, cached);
    return collectionResult(ref, p, cached, { cached: false });
  } catch (err) {
    const stale = staleRead<CachedCollection>(deps.cache, key);
    if (stale) {
      return collectionResult(ref, p, stale, {
        cached: true,
        stale: true,
        ...(err instanceof BlockedError ? { blocked: true as const } : {}),
        error: message(err),
      });
    }
    if (isHttp404(err)) {
      if (p === 1) {
        throw new Error(
          `Collection not found (check the slug): ${ref.href} returned HTTP 404. ` +
            "Use a curated slug like 'brutalism' or 'owner/slug' for a member collection.",
        );
      }
      throw new Error(
        `Page ${p} is out of range for collection ${ref.slug}: the collection page returned HTTP 404. ` +
          "Use a lower page number.",
      );
    }
    throw err;
  }
}

function collectionNote(page: number, siteCards: number, items?: number): string {
  const suffix = "Personal, non-commercial inspiration use.";
  if (siteCards === 0) {
    return items !== undefined
      ? `Page ${page}: collection contains no site cards; ${items} element items. ${suffix}`
      : `Page ${page}: collection contains no site cards. ${suffix}`;
  }
  const cards = `${siteCards} site card${siteCards === 1 ? "" : "s"}`;
  if (items === undefined) return `Page ${page}: ${cards}. ${suffix}`;
  if (items === siteCards) return `Page ${page}: ${cards}; ${items} items total. ${suffix}`;
  return (
    `Page ${page}: ${cards}; ${items} items total across sites, elements and other collectables. ` +
    suffix
  );
}
