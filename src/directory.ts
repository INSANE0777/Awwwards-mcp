import { AwwwardsClient, BlockedError, SHARED_RATE_LIMITER } from "./awwwards.js";
import type { RateLimiter } from "./awwwards.js";
import type { Cache } from "./cache.js";

// The directory's filters are PATH-based (/directory/<filter-slug>/), not query
// params. Verified live 2026-10-25: /directory/United%20States/ returned only
// US cards, /directory/over_hundred_thousand/ returned 14 budget-filtered cards,
// and /directory/?page=2 paginates the ordinary listing. The free-text directory
// search endpoint (/directory/search/?...) is robots-disallowed, so `query` is
// applied client-side over the one fetched page instead.
export const DIRECTORY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// URL slugs from the live filter sidebar (Type, Category, Budget, Country).
// Only slugs verified on 2026-10-25 are whitelisted; an unknown category is a
// caller error rather than a wasted 404 request.
export const DIRECTORY_CATEGORIES = [
  "agency-studio",
  "freelance",
  "international",
  "app-development",
  "art-direction",
  "graphic-design",
  "interactive",
  "other",
  "seo-sem",
  "social-media",
  "ux-ui",
  "web-design",
  "web-development",
] as const;

export const DIRECTORY_BUDGETS: Record<string, string> = {
  over_thirty_thousand: "$30,000 - $50,000",
  five_thirty_thousand: "$5,000 - $30,000",
  fifty_to_hundred_thousand: "$50,000 - $100,000",
  over_hundred_thousand: "Over $100,000",
  less_than_five_thousand: "Under $5,000",
};

export interface SourceMeta {
  cached: boolean;
  stale?: true;
  blocked?: true;
  error?: string;
}

export interface DirectoryCard {
  name: string;
  slug: string;
  href: string;
  location?: string;
  website?: string;
  // Sum of the card's HM/SOTD/SOTM/SOTY boxes.
  awardsCount?: number;
  awards?: { hm: number; sotd: number; sotm: number; soty: number };
  thumb?: string;
}

export interface DirectoryResult {
  cards: DirectoryCard[];
  page: number;
  hasMore: boolean;
  // true only when `query` filtered this page in-process (the directory search
  // endpoint is robots-disallowed); false when the server-side path filter did
  // the work.
  filteredClientSide: boolean;
  meta: SourceMeta;
  note: string;
}

export interface DirectoryArgs {
  query?: string;
  country?: string;
  category?: string;
  budget?: string;
  page?: number;
}

export interface DirectoryDeps {
  cache: Cache;
  fetchFn?: typeof fetch;
  rateLimiter?: RateLimiter;
  timeoutMs?: number;
}

type FilterKind = "country" | "category" | "budget";

const FILTER_ORDER: FilterKind[] = ["country", "category", "budget"];

const BASE_NOTE =
  "Directory cards from awwwards.com/directory (one page per call). Filters are " +
  "path-based, so one filter is applied per request. Contact details are stripped; " +
  "public profile fields only. Personal, non-commercial inspiration use.";

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function cleanText(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Explicit PII guard: directory cards are public profile metadata, but a name,
// location or website field could still contain an email/phone. Strip both
// before anything leaves the parser.
export function stripPii(value: string): string {
  return value
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, (m) => (m.replace(/\D/g, "").length >= 9 ? "" : m))
    .replace(/\s+/g, " ")
    .trim();
}

function clampPage(page: number | undefined): number {
  const n = typeof page === "number" && Number.isFinite(page) ? Math.trunc(page) : 1;
  return Math.min(100, Math.max(1, n));
}

// Parses the ordinary agency grid (card-directory). The page also renders a
// separate "pro" promo grid (card-directory-sp) that duplicates featured rows,
// so only card-directory blocks are emitted.
// null = no directory grid at all (layout drift); [] = grid but no cards.
export function parseDirectory(
  html: string,
  page = 1,
): { cards: DirectoryCard[]; hasMore: boolean } | null {
  if (!html.includes("grid-cards js-ajax-entries")) return null;
  const cards: DirectoryCard[] = [];
  const seen = new Set<string>();
  for (const part of html.split('<div class="card-directory">').slice(1)) {
    const href = part.match(/card-directory__cover">\s*<a href="([^"]+)"/)?.[1];
    if (!href || !href.startsWith("/") || href.startsWith("//")) continue;
    const slug = decodeLoose(href.replace(/^\/+|\/+$/g, "").split("/").pop() ?? "");
    if (!slug || seen.has(slug)) continue;

    const name = stripPii(cleanText(part.match(/avatar-name__name">\s*<strong>([\s\S]*?)<\/strong>/)?.[1] ?? ""));
    if (!name) continue;
    const location = stripPii(
      cleanText(
        part.match(
          /card-directory__section"><strong>Location<\/strong><\/div>\s*<div>([\s\S]*?)<\/div>/,
        )?.[1] ?? "",
      ),
    );
    const website = stripPii(
      cleanText(
        part.match(
          /card-directory__section"><strong>Website<\/strong><\/div>\s*<div>[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/,
        )?.[1] ?? "",
      ),
    );

    const scores: Record<string, number> = {};
    for (const m of part.matchAll(
      /box-score__top">\s*<strong>([A-Z]+)<\/strong>\s*<\/div>\s*<div class="box-score__bottom">\s*<strong>(\d+)<\/strong>/g,
    )) {
      scores[m[1]] = Number(m[2]);
    }
    const awards = {
      hm: scores.HM ?? 0,
      sotd: scores.SOTD ?? 0,
      sotm: scores.SOTM ?? 0,
      soty: scores.SOTY ?? 0,
    };
    const awardsCount = awards.hm + awards.sotd + awards.sotm + awards.soty;
    const thumb = part.match(/class="card-directory__media"[^>]*src="([^"]+)"/)?.[1];

    seen.add(slug);
    cards.push({
      name,
      slug,
      href,
      ...(location ? { location } : {}),
      ...(website ? { website } : {}),
      ...(awardsCount > 0 ? { awardsCount, awards } : {}),
      ...(thumb ? { thumb } : {}),
    });
  }
  const pages = [...html.matchAll(/\?page=(\d+)/g)].map((m) => Number(m[1]));
  return { cards, hasMore: pages.some((n) => n > page) };
}

function decodeLoose(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeCountry(value: string): string {
  const decoded = decodeLoose(value.trim()).replace(/\s+/g, " ");
  if (!decoded || /[\\/?#]/.test(decoded) || decoded.includes("..")) {
    throw new Error(`Invalid directory country: "${value}".`);
  }
  return encodeURIComponent(decoded);
}

function normalizeCategory(value: string): string {
  const slug = decodeLoose(value.trim())
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug || !(DIRECTORY_CATEGORIES as readonly string[]).includes(slug)) {
    throw new Error(
      `Unknown directory category: "${value}". Known slugs: ${DIRECTORY_CATEGORIES.join(", ")}.`,
    );
  }
  return slug;
}

function normalizeBudget(value: string): string {
  const wanted = decodeLoose(value.trim()).toLowerCase();
  if (DIRECTORY_BUDGETS[wanted]) return wanted;
  const loose = (s: string) => s.toLowerCase().replace(/[\s,]/g, "");
  for (const [slug, label] of Object.entries(DIRECTORY_BUDGETS)) {
    if (label.toLowerCase() === wanted || loose(label) === loose(wanted)) return slug;
  }
  throw new Error(
    `Unknown directory budget: "${value}". Known slugs: ${Object.keys(DIRECTORY_BUDGETS).join(", ")}.`,
  );
}

// One path filter only — combined /directory/<a>/<b>/ URLs are not a verified
// shape. Priority is country > category > budget; the rest are reported back
// in `ignored` instead of being silently dropped.
export function buildDirectoryPath(args: DirectoryArgs): {
  path: string;
  page: number;
  applied?: { kind: FilterKind; value: string };
  ignored: FilterKind[];
} {
  const page = clampPage(args.page);
  const supplied: { kind: FilterKind; value: string }[] = [];
  if (args.country?.trim()) supplied.push({ kind: "country", value: normalizeCountry(args.country) });
  if (args.category?.trim()) supplied.push({ kind: "category", value: normalizeCategory(args.category) });
  if (args.budget?.trim()) supplied.push({ kind: "budget", value: normalizeBudget(args.budget) });

  supplied.sort((a, b) => FILTER_ORDER.indexOf(a.kind) - FILTER_ORDER.indexOf(b.kind));
  const applied = supplied[0];
  const ignored = supplied.slice(1).map((f) => f.kind);
  const base = applied ? `/directory/${applied.value}/` : "/directory/";
  return {
    path: page === 1 ? base : `${base}?page=${page}`,
    page,
    ...(applied ? { applied } : {}),
    ignored,
  };
}

function filterCards(cards: DirectoryCard[], query: string | undefined): DirectoryCard[] {
  const terms = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return cards;
  return cards.filter((c) => {
    const hay = `${c.name} ${c.location ?? ""} ${c.website ?? ""}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

function resultNote(args: {
  queryApplied: boolean;
  shown: number;
  ignored: FilterKind[];
  applied?: { kind: FilterKind; value: string };
}): string {
  const parts = [BASE_NOTE];
  if (args.queryApplied) {
    parts.push(
      `query filtered client-side over this page only (${args.shown} card${args.shown === 1 ? "" : "s"}); fetch another page for more.`,
    );
  }
  if (args.ignored.length) {
    parts.push(
      `one path filter per request: applied ${args.applied?.kind ?? "none"}; ignored ${args.ignored.join(", ")}.`,
    );
  }
  return parts.join(" ");
}

async function fetchHtml(path: string, deps: DirectoryDeps): Promise<string> {
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

export async function searchDirectory(
  args: DirectoryArgs,
  deps: DirectoryDeps,
): Promise<DirectoryResult> {
  const request = buildDirectoryPath(args);
  const filterKey = request.applied ? `${request.applied.kind}:${request.applied.value}` : "all";
  const key = `directory:${filterKey}:${request.page}`;
  const queryApplied = (args.query ?? "").trim().length > 0;

  const fresh = deps.cache.getMeta<{ cards: DirectoryCard[]; hasMore: boolean }>(
    key,
    DIRECTORY_TTL_MS,
  );
  if (fresh) {
    const cards = filterCards(fresh.cards, args.query);
    return {
      cards,
      page: request.page,
      hasMore: fresh.hasMore,
      filteredClientSide: queryApplied,
      meta: { cached: true },
      note: resultNote({
        queryApplied,
        shown: cards.length,
        ignored: request.ignored,
        applied: request.applied,
      }),
    };
  }

  try {
    const parsed = parseDirectory(await fetchHtml(request.path, deps), request.page);
    if (!parsed) {
      throw new Error(
        "Awwwards directory layout may have changed: no directory grid found. " +
          "The parser needs an update.",
      );
    }
    const cached = { cards: parsed.cards, hasMore: parsed.hasMore };
    deps.cache.setMeta(key, cached);
    const cards = filterCards(parsed.cards, args.query);
    return {
      cards,
      page: request.page,
      hasMore: parsed.hasMore,
      filteredClientSide: queryApplied,
      meta: { cached: false },
      note: resultNote({
        queryApplied,
        shown: cards.length,
        ignored: request.ignored,
        applied: request.applied,
      }),
    };
  } catch (err) {
    const stale = staleRead<{ cards: DirectoryCard[]; hasMore: boolean }>(deps.cache, key);
    if (stale) {
      const cards = filterCards(stale.cards, args.query);
      return {
        cards,
        page: request.page,
        hasMore: stale.hasMore,
        filteredClientSide: queryApplied,
        meta: {
          cached: true,
          stale: true,
          ...(err instanceof BlockedError ? { blocked: true as const } : {}),
          error: message(err),
        },
        note: resultNote({
          queryApplied,
          shown: cards.length,
          ignored: request.ignored,
          applied: request.applied,
        }),
      };
    }
    throw err;
  }
}
