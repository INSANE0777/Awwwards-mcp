import { parseCategories, parseDetail, parseElements, parseListing } from "./parsers.js";
import {
  AwwwardsClient,
  BlockedError,
  buildFilterUrl,
  elementPosterPath,
  elementUrl,
} from "./awwwards.js";
import type { Cache } from "./cache.js";
import type { PageStructure, WaitOpts, WaitStrategy } from "./structure.js";
import type { AwardFilter, SearchFilters } from "./awwwards.js";
import type { ViewportName } from "./viewport.js";
import type { Categories, ElementMedia, ElementRecord, MotionDna, SiteDetails, SiteSummary } from "./types.js";
import { INDEX_LOCK_STALE_MS, INDEX_STALE_MS } from "./indexer.js";
import { fetchNewWinners, addWatch, listWatches, removeWatch, recordsFromSiteHtml, checkWatches, matchesWatch } from "./feed.js";

const AWARD_FILTER_LABELS: Record<AwardFilter, string> = {
  sotd: "Site of the Day",
  developer: "Developer Award",
  honorable: "Honorable Mention",
};

export const SITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const CATEGORY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// The text block lists every element; only this many posters are fetched inline.
export const MAX_INLINE_POSTERS = 8;

export type Block =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface ToolResponse {
  content: Block[];
  isError?: boolean;
}

export interface SearchArgs extends SearchFilters {
  responseMode?: "full" | "compact";
  count?: number;
  page?: number;
  // "newest" (default) = current newest-first behavior; "score" orders scored
  // sites first (detail-meta score, desc), unscored after, newest-first.
  sortBy?: "score" | "newest";
}

export type CaptureFn = (
  url: string,
  imagesDir: string,
  opts?: WaitOpts,
) => Promise<{ file: string; base64: string } | { error: string }>;

export type AnalyzeFn = (
  url: string,
  maxBands?: number,
  opts?: WaitOpts,
) => Promise<PageStructure | { error: string }>;

export type MotionFn = (
  url: string,
  opts: {
    cacheImagesDir: string;
    frames?: number;
    waitStrategy?: WaitStrategy;
    viewport?: ViewportName;
  },
) => Promise<{ file: string; base64: string; frames: number } | { error: string }>;

export type MotionDnaFn = (
  url: string,
  opts?: { viewport?: ViewportName },
) => Promise<MotionDna>;

export function slugifyTag(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// Free-text queries match token-wise: every whitespace-separated token must
// substring-match the site's title+tags. A single token behaves exactly like
// the old whole-query substring check.
export function tokenizeQuery(q: string): string[] {
  return q.toLowerCase().split(/\s+/).filter(Boolean);
}

// Zero-result suggestions: rank taxonomy slugs against the query's tokens.
// +2 per token (>=4 chars) the slug contains; +1 when slug and token share a
// >=4-char prefix (compared via their first 5 chars, in either direction).
// Ties rank stably by slug; only positive scores are suggested.
export function suggestTags(tokens: string[], taxonomy: string[], limit = 6): string[] {
  const scored: [string, number][] = [];
  for (const slug of taxonomy) {
    let score = 0;
    for (const t of tokens) {
      if (t.length < 4) continue;
      if (slug.includes(t)) score += 2;
      else if (slug.startsWith(t.slice(0, 5)) || t.startsWith(slug.slice(0, 5))) score += 1;
    }
    if (score > 0) scored.push([slug, score]);
  }
  return scored
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([s]) => s);
}

function text(t: string): Block {
  return { type: "text", text: t };
}

function summarizeSite(s: SiteSummary): string {
  const award = s.awards.length ? ` [${s.awards.join(", ")}]` : "";
  return `- ${s.title} (slug: ${s.slug})${award}\n  live: ${s.liveUrl ?? "unknown"}\n  awwwards: https://www.awwwards.com${s.detailPath}\n  tags: ${s.tags.join(", ")}`;
}

function formatCompactSite(s: SiteSummary, number: number): string {
  const tags = s.tags.slice(0, 3);
  const extra = s.tags.length - tags.length;
  return [
    `${number}. ${s.title} (slug: ${s.slug})`,
    s.liveUrl ? `live: ${s.liveUrl}` : null,
    s.awards.length ? `awards: ${s.awards.join(", ")}` : null,
    tags.length ? `tags: ${tags.join(", ")}${extra > 0 ? ` +${extra}` : ""}` : null,
  ].filter(Boolean).join(" | ").replace(/\s+/g, " ").trim();
}

// An all-empty parse on an awarded page means the layout changed (or the page
// was not found): neither tool may cache such a parse, so the mismatch can
// still be surfaced. A Nominee submission carries no palette, technology,
// award or description section at all, so its empty parse is real content.
function isAllEmptyDetail(d: SiteDetails): boolean {
  return (
    d.palette.length === 0 &&
    d.technologies.length === 0 &&
    d.elements.length === 0 &&
    d.awards.length === 0 &&
    !d.description
  );
}

function errorResponse(err: unknown): ToolResponse {
  const message =
    err instanceof BlockedError
      ? err.message
      : `awwwards-mcp request failed: ${err instanceof Error ? err.message : String(err)}`;
  return { content: [text(message)], isError: true };
}

export interface Handlers {
  search_sites(args: SearchArgs): Promise<ToolResponse>;
  get_site_details(args: { slug: string }): Promise<ToolResponse>;
  compare_sites(args: { slugs: string[] }): Promise<ToolResponse>;
  get_index_status(): Promise<ToolResponse>;
  get_site_elements(args: { slug: string }): Promise<ToolResponse>;
  search_elements(args: {
    query?: string;
    category?: string;
    stack?: string[];
    limit?: number;
  }): Promise<ToolResponse>;
  get_element(args: { id: string }): Promise<ToolResponse>;
  list_categories(): Promise<ToolResponse>;
  capture_live_site(args: {
    url: string;
    waitStrategy?: WaitStrategy;
    viewport?: ViewportName;
  }): Promise<ToolResponse>;
  analyze_page_structure(args: {
    url: string;
    maxBands?: number;
    waitStrategy?: WaitStrategy;
    viewport?: ViewportName;
  }): Promise<ToolResponse>;
  record_site_motion(args: {
    url: string;
    frames?: number;
    waitStrategy?: WaitStrategy;
    viewport?: ViewportName;
  }): Promise<ToolResponse>;
  get_motion_dna(args: { url: string; recapture?: boolean }): Promise<ToolResponse>;
  search_motion(args: {
    lib?: string;
    scrubOnly?: boolean;
    hasPins?: boolean;
    limit?: number;
  }): Promise<ToolResponse>;
  new_winners(args: { award?: "sotd" | "developer" | "honorable" }): Promise<ToolResponse>;
  watch_site(args: {
    action: "add" | "list" | "remove";
    kind?: "studio" | "tag" | "url";
    pattern?: string;
    award?: "sotd" | "developer" | "honorable";
    note?: string;
  }): Promise<ToolResponse>;
}

// Freshness window for cached Motion DNA rows; records older than this are
// re-captured live by get_motion_dna.
export const MOTION_DNA_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export function createHandlers(deps: {
  client: AwwwardsClient;
  cache: Cache;
  captureFn?: CaptureFn;
  analyzeFn?: AnalyzeFn;
  motionFn?: MotionFn;
  motionDnaFn?: MotionDnaFn;
}): Handlers {
  const { client, cache } = deps;

  // Which filter wins the URL (combined filter URLs 404 on awwwards.com).
  const urlSource = (f: SearchArgs): "color" | "award" | "technology" | "tag" | "none" =>
    f.color ? "color" : f.award ? "award" : f.technology ? "technology" : f.tags?.length ? "tag" : "none";

  // Two modes:
  // - honorUrlSource=true: rows freshly scraped from the filter page — the URL
  //   really did apply the highest-priority filter (color > award > technology
  //   > first tag), so skip re-checking that one and verify the rest.
  // - honorUrlSource=false: cache/index rows — nothing guarantees the URL
  //   filter was applied, so check every client-checkable filter. Color is
  //   never client-checkable (site rows carry no colors); it is handled by
  //   never serving color searches from cache (see search_sites).
  // skipQueryCheck=true: the rows already matched the free-text query through
  // FTS (prefix+stem semantics); re-checking with substring semantics would
  // wrongly drop stem matches ("magazines" → "Magazine"), so only the
  // non-query filters run. Scraped rows keep the check (default false) — they
  // never came from FTS.
  function matchesFilters(
    s: SiteSummary,
    f: SearchArgs,
    honorUrlSource: boolean,
    skipQueryCheck = false,
  ): boolean {
    const source = urlSource(f);
    if (f.tags?.length) {
      const tagsToCheck =
        honorUrlSource && source === "tag" ? f.tags.slice(1) : f.tags;
      for (const t of tagsToCheck) {
        const slug = t.toLowerCase();
        if (!s.tags.some((st) => slugifyTag(st).includes(slug))) return false;
      }
    }
    if (f.technology && !(honorUrlSource && source === "technology")) {
      const slug = f.technology.toLowerCase();
      if (!s.tags.some((st) => slugifyTag(st).includes(slug))) return false;
    }
    if (f.award && !(honorUrlSource && source === "award")) {
      if (!s.awards.includes(AWARD_FILTER_LABELS[f.award])) return false;
    }
    if (f.query && !skipQueryCheck) {
      const queryTokens = tokenizeQuery(f.query);
      if (queryTokens.length) {
        const hay = (s.title + " " + s.tags.join(" ")).toLowerCase();
        if (!queryTokens.every((t) => hay.includes(t))) return false;
      }
    }
    return true;
  }

  async function siteImage(s: SiteSummary): Promise<Block | null> {
    try {
      const buf = await cache.getImage(s.thumbnailPath, () =>
        client.getThumbnail(s.thumbnailPath, 880),
      );
      return { type: "image", data: buf.toString("base64"), mimeType: "image/jpeg" };
    } catch {
      return null; // thumbnail failures degrade to metadata-only cards
    }
  }

  async function compactContent(slice: SiteSummary[], start: number, header: string): Promise<Block[]> {
    const images = await Promise.all(slice.slice(0, 2).map(siteImage));
    return [
      text(`${header}\n\n${slice.map((s, i) => formatCompactSite(s, start + i)).join("\n")}`),
      ...images.flatMap((image, i): Block[] => image
        ? [text(`Preview #${start + i}: ${slice[i].slug}`), image]
        : []),
    ];
  }

  // sortBy: "score" view. Scores live in detail-meta entries written by
  // get_site_details, so this reads the cache only — never a live fetch during
  // search. SiteDetails gains its score field in a later v1.5.0 task, so the
  // meta read is typed locally. Scored sites come first (desc); unscored ones
  // follow, newest-first.
  function orderByScore(list: SiteSummary[], sortBy: SearchArgs["sortBy"]): SiteSummary[] {
    if (sortBy !== "score") return list;
    const withScores = list.map((s) => ({
      s,
      score: cache.getMeta<{ score?: number }>(`detail:${s.slug}`, SITE_TTL_MS)?.score ?? null,
    }));
    withScores.sort(
      (a, b) => (b.score ?? -1) - (a.score ?? -1) || b.s.createdAt - a.s.createdAt,
    );
    return withScores.map((w) => w.s);
  }

  async function search_sites(args: SearchArgs): Promise<ToolResponse> {
    const count = Math.min(Math.max(args.count ?? 6, 1), 12);
    const page = Math.max(args.page ?? 1, 1);
    try {
      // Color can't be verified client-side (site rows carry no colors), so a
      // color search always scrapes its filter page; everything else is
      // client-checkable against the index.
      let sites: SiteSummary[];
      let ftsRows = false; // query served from FTS-ranked rows (bm25 order)
      let ftsEmpty = false; // FTS ran and matched nothing → loose hints apply
      if (args.color) {
        sites = [];
      } else if (args.query) {
        const ranked = cache.searchSites(args.query, SITE_TTL_MS);
        if (ranked) {
          ftsRows = true;
          ftsEmpty = ranked.length === 0;
          // FTS already applied the query (prefix+stem, bm25-ranked). Re-check
          // only the non-query filters; re-checking the query here with
          // substring semantics would wrongly drop prefix/stem matches.
          // Array.filter preserves the bm25 order.
          sites = ranked.filter((s) => matchesFilters(s, args, false, true));
        } else {
          // FTS5 unavailable or no usable tokens: legacy substring path.
          sites = cache.getSites(SITE_TTL_MS).filter((s) => matchesFilters(s, args, false));
        }
      } else {
        sites = cache.getSites(SITE_TTL_MS).filter((s) => matchesFilters(s, args, false));
      }
      // A scrape normally REPLACES the matched rows (fresh rows are only
      // guaranteed the URL filter), so it must run when the cache cannot serve
      // the requested page window at all. When the window is only PARTIALLY
      // filled (e.g. a query matched 3 cached rows for count 6), replacing
      // would discard already-verified matches — those runs scrape the filter
      // page and MERGE instead: dedupe by slug, verified cache rows win
      // duplicate slugs, scraped-only rows appended; the merge result is
      // client-checked as before (cache rows already passed matchesFilters,
      // scraped rows matchesFilters(true)). Non-FTS runs sort everything
      // newest-first like getSites; FTS runs keep the bm25-ranked cache rows
      // first in rank order and append the scraped-only rows newest-first
      // among themselves — re-sorting ranked rows by createdAt would destroy
      // the ranking the query asked for.
      const pageWindowEmpty = sites.slice((page - 1) * count, page * count).length === 0;
      const pageWindowPartial = !pageWindowEmpty && sites.length < page * count;
      if (pageWindowEmpty) {
        const html = await client.getHtml(buildFilterUrl(args));
        const parsed = parseListing(html);
        if (parsed.length === 0) {
          return {
            content: [
              text(
                "Awwwards layout may have changed: parsed 0 site cards. " +
                  "The awwwards-mcp parser likely needs an update.",
              ),
            ],
            isError: true,
          };
        }
        cache.upsertSites(parsed);
        // Freshly parsed rows carry the URL filter by construction
        // (honorUrlSource: true); serve only those, newest-first like getSites.
        sites = parsed
          .filter((s) => matchesFilters(s, args, true))
          .sort((a, b) => b.createdAt - a.createdAt);
      } else if (pageWindowPartial) {
        // Top-up scrape: best-effort in the fullest sense — a fetch failure
        // (HTTP error, BlockedError) must not escape to the outer catch, whose
        // stale-fallback always slices page 1 and would silently discard the
        // requested page window's cached rows. Keep those rows instead.
        try {
          const html = await client.getHtml(buildFilterUrl(args));
          const parsed = parseListing(html);
          if (parsed.length > 0) {
            cache.upsertSites(parsed);
            const fresh = parsed.filter((s) => matchesFilters(s, args, true));
            if (ftsRows) {
              // Ranked cache rows keep their bm25 order; scraped-only rows
              // append newest-first (cache rows win duplicate slugs, as
              // everywhere — a slug in the ranked set is never re-added).
              const rankedSlugs = new Set(sites.map((s) => s.slug));
              const scrapedOnly = fresh
                .filter((s) => !rankedSlugs.has(s.slug))
                .sort((a, b) => b.createdAt - a.createdAt);
              sites = [...sites, ...scrapedOnly];
            } else {
              const bySlug = new Map<string, SiteSummary>();
              // Scraped rows seed the map; verified cache rows then overwrite any
              // duplicate slug, so they always win.
              for (const s of fresh) bySlug.set(s.slug, s);
              for (const s of sites) bySlug.set(s.slug, s);
              sites = [...bySlug.values()].sort((a, b) => b.createdAt - a.createdAt);
            }
          }
        } catch {
          /* keep cached rows; an empty parse is equally tolerated above */
        }
      }

      const ordered = orderByScore(sites, args.sortBy);
      const slice = ordered.slice((page - 1) * count, page * count);
      if (slice.length === 0) {
        // Loose-match hint, computed once: only for genuine FTS zero results
        // (FTS ran and matched nothing) — rows dropped by the non-query
        // filters are not "loose matches". Up to 3 OR-relaxed slugs.
        let looseHint = "";
        if (ftsEmpty && args.query) {
          const orSlugs = (cache.searchSites(args.query, SITE_TTL_MS, 3, "OR") ?? [])
            .map((s) => s.slug);
          if (orSlugs.length > 0) {
            looseHint = `\nLoose matches (any token): ${orSlugs.join(", ")}.`;
          }
        }
        if (sites.length === 0) {
          // True zero-result search: suggest the closest taxonomy tags. The
          // taxonomy comes from the cache only — never a live fetch just to
          // phrase a suggestion; without a cached taxonomy, keep today's text.
          const cats = cache.getMeta<Categories>("categories", CATEGORY_TTL_MS);
          const suggestions = cats
            ? suggestTags(tokenizeQuery(args.query ?? ""), cats.filters)
            : [];
          if (suggestions.length > 0) {
            return {
              content: [
                text(
                  `No sites matched the search. Closest filter tags: ${suggestions.join(", ")}. ` +
                    `Run list_categories for the full taxonomy.${looseHint}`,
                ),
              ],
            };
          }
        }
        return {
          content: [
            text(
              `No sites matched the search on this page. Try fewer filters or run list_categories. ` +
                "(Deep pagination is unavailable by design: awwwards.com's robots.txt disallows it.)" +
                // looseHint is empty unless this is a true FTS zero result.
                looseHint,
            ),
          ],
        };
      }

      if (args.responseMode === "compact") {
        const start = (page - 1) * count + 1;
        return { content: await compactContent(
          slice,
          start,
          `${ordered.length} site(s) matched; showing ${start}-${start + slice.length - 1}:`,
        ) };
      }

      const images = await Promise.all(slice.map(siteImage));
      const content: Block[] = [
        text(
          `${ordered.length} site(s) matched; showing ${(page - 1) * count + 1}-${(page - 1) * count + slice.length}:\n\n` +
            slice.map(summarizeSite).join("\n\n"),
        ),
        ...images.filter((b): b is Block => b !== null),
      ];
      return { content };
    } catch (err) {
      // Spec: on live-request failure, serve stale cache if present. The store
      // itself may be the failure source, so this lookup is guarded too.
      let stale: SiteSummary[] = [];
      try {
        stale = cache.getSites(Infinity).filter((s) => matchesFilters(s, args, false));
      } catch {
        stale = [];
      }
      if (stale.length > 0) {
        const orderedStale = orderByScore(stale, args.sortBy);
        const slice = orderedStale.slice(0, count);
        if (args.responseMode === "compact") {
          const message = `The live awwwards.com request failed (${err instanceof Error ? err.message : String(err)}). ` +
            `Serving ${slice.length} result(s) from stale cache instead:`;
          return { content: await compactContent(slice, 1, message) };
        }
        const images = await Promise.all(slice.map(siteImage));
        return {
          content: [
            text(
              `The live awwwards.com request failed (${err instanceof Error ? err.message : String(err)}). ` +
                `Serving ${slice.length} result(s) from stale cache instead:\n\n` +
                slice.map(summarizeSite).join("\n\n"),
            ),
            ...images.filter((b): b is Block => b !== null),
          ],
        };
      }
      return errorResponse(err);
    }
  }

  // Shared by details and comparison: only successful parses seed the detail
  // and elements caches, and neither caller needs an image to do so.
  async function loadDetail(slug: string): Promise<SiteDetails | null> {
    const metaKey = `detail:${slug}`;
    let d = cache.getMeta<SiteDetails>(metaKey, SITE_TTL_MS);
    if (!d) {
      const html = await client.getHtml(`/sites/${slug}`);
      d = parseDetail(html, slug);
      // Nominees legitimately parse empty; only an awarded page that parses
      // empty is parser drift, and only drift stays uncached.
      if (isAllEmptyDetail(d) && !d.nominee) return null;
      cache.setMeta(metaKey, d);
      // No Elements section is a legitimate empty; a zero-blob section is
      // left uncached so get_site_elements can report parser drift.
      if (cache.getMeta<ElementMedia[]>(`elements:${slug}`, SITE_TTL_MS) === null) {
        const els = parseElements(html);
        if (els === null) cache.setMeta(`elements:${slug}`, []);
        else if (els.length > 0) cache.setMeta(`elements:${slug}`, els);
      }
    }
    return d;
  }

  async function get_site_details(args: { slug: string }): Promise<ToolResponse> {
    try {
      const d = await loadDetail(args.slug);
      if (!d) {
        return {
          content: [text(
            "Awwwards layout may have changed: parsed no design data for " +
              args.slug +
              ". The awwwards-mcp parser likely needs an update (or the site page was not found).",
          )],
          isError: true,
        };
      }
      const cachedSite = cache.getSite(args.slug, SITE_TTL_MS);
      const liveUrl = d.liveUrl ?? cachedSite?.liveUrl ?? null;

      const content: Block[] = [
        text(
          [
            `# ${d.title ?? args.slug}`,
            liveUrl ? `Live site: ${liveUrl}` : null,
            d.awards.length
              ? `Awards: ${d.awards.map((a) => `${a.title} (${a.date})`).join(", ")}`
              : null,
            d.score != null ? `Jury score: ${d.score.toFixed(2)}/10` : null,
            d.juryDimensions
              ? `Jury dimensions: Design ${d.juryDimensions.design.toFixed(2)}, Usability ${d.juryDimensions.usability.toFixed(2)}, Creativity ${d.juryDimensions.creativity.toFixed(2)}, Content ${d.juryDimensions.content.toFixed(2)}`
              : null,
            d.palette.length ? `Color palette: ${d.palette.join(", ")}` : null,
            d.technologies.length ? `Technologies & tools: ${d.technologies.join(", ")}` : null,
            d.elements.length ? `Design elements: ${d.elements.join(", ")}` : null,
            d.description ? `Description: ${d.description}` : null,
            d.nominee
              ? `Status: Nominee - awwwards.com publishes no jury score, color palette or technologies for nominees.`
              : null,
            d.ogImage ? `Full-size screenshot: ${d.ogImage}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        ),
      ];
      if (cachedSite) {
        const img = await siteImage(cachedSite);
        if (img) content.push(img);
      }
      return { content };
    } catch (err) {
      return errorResponse(err);
    }
  }

  async function compare_sites(args: { slugs: string[] }): Promise<ToolResponse> {
    try {
      const slugs = args.slugs;
      if (!Array.isArray(slugs) || slugs.length < 2 || slugs.length > 3 ||
          slugs.some((slug) => typeof slug !== "string" || !/^[\w-]+$/.test(slug)) ||
          new Set(slugs.map((slug) => slug.toLowerCase())).size !== slugs.length) {
        return { content: [text("Provide 2 or 3 distinct site slugs (letters, digits, underscores or hyphens only).")], isError: true };
      }

      const sites = [];
      for (const slug of slugs) {
        const detail = await loadDetail(slug);
        if (!detail) {
          return { content: [text(
            `Awwwards layout may have changed: parsed no design data for ${slug}. ` +
              "The awwwards-mcp parser likely needs an update (or the site page was not found).",
          )], isError: true };
        }
        const summary = cache.getSite(slug, SITE_TTL_MS);
        sites.push({
          slug,
          title: detail.title ?? summary?.title ?? slug,
          liveUrl: detail.liveUrl ?? summary?.liveUrl ?? null,
          palette: detail.palette,
          technologies: detail.technologies,
          elements: detail.elements,
          awards: detail.awards.length ? detail.awards : (summary?.awards ?? []).map((title) => ({ title, date: "" })),
          score: detail.score,
          juryDimensions: detail.juryDimensions ?? null,
          nominee: detail.nominee,
        });
      }
      return { content: [text(JSON.stringify({ sites }, null, 2))] };
    } catch (err) {
      return errorResponse(err);
    }
  }

  async function get_index_status(): Promise<ToolResponse> {
    try {
      const status = cache.getMeta<{
        finishedAt?: number; pagesDone: number; pagesTotal: number; lastError?: string;
      }>("index:status", Number.POSITIVE_INFINITY);
      const progress = cache.getMeta<string[]>("index:progress", Number.POSITIVE_INFINITY);
      const lock = cache.getMeta<{ startedAt: number }>("index:lock", Number.POSITIVE_INFINITY);
      const now = Date.now();
      const finishedAt = status?.finishedAt ?? null;
      const lockAge = lock ? now - lock.startedAt : null;
      const indexAge = finishedAt === null ? null : Math.max(0, now - finishedAt);
      const active = lockAge !== null && lockAge < INDEX_LOCK_STALE_MS;
      const categoryTotal = cache.getMeta<Categories>("categories", Number.POSITIVE_INFINITY)?.filters.length;
      return { content: [text(JSON.stringify({
        sitesCount: cache.countSites(),
        progress: {
          pagesDone: progress?.length ?? (active ? 0 : status?.pagesDone ?? 0),
          pagesTotal: active ? categoryTotal ?? status?.pagesTotal ?? 0 : status?.pagesTotal ?? categoryTotal ?? 0,
        },
        lastSuccessfulFinishAt: finishedAt,
        lastError: status?.lastError ?? null,
        lock: {
          startedAt: lock?.startedAt ?? null,
          active,
          stale: lockAge !== null && lockAge >= INDEX_LOCK_STALE_MS,
        },
        indexFreshness: {
          stale: indexAge === null || indexAge >= INDEX_STALE_MS,
          ageMs: indexAge,
          staleAfterMs: INDEX_STALE_MS,
        },
      }, null, 2))] };
    } catch (err) {
      return errorResponse(err);
    }
  }

  async function get_site_elements(args: { slug: string }): Promise<ToolResponse> {
    try {
      const elementsKey = `elements:${args.slug}`;
      let elements = cache.getMeta<ElementMedia[]>(elementsKey, SITE_TTL_MS);
      if (elements === null) {
        const html = await client.getHtml(`/sites/${args.slug}`);
        const parsed = parseElements(html);
        if (parsed === null) {
          elements = [];
          cache.setMeta(elementsKey, elements);
        } else if (parsed.length === 0) {
          return {
            content: [
              text(
                "Awwwards layout may have changed: found an Elements section but parsed 0 elements. " +
                  "The awwwards-mcp parser likely needs an update.",
              ),
            ],
            isError: true,
          };
        } else {
          elements = parsed;
          cache.setMeta(elementsKey, elements);
        }
        // One fetch feeds both caches: seed the detail cache from the same
        // HTML unless it is an all-empty parse (never cached, per contract).
        if (cache.getMeta<SiteDetails>(`detail:${args.slug}`, SITE_TTL_MS) === null) {
          const d = parseDetail(html, args.slug);
          if (!isAllEmptyDetail(d) || d.nominee) cache.setMeta(`detail:${args.slug}`, d);
        }
      }
      const cachedSite = cache.getSite(args.slug, SITE_TTL_MS);
      const title =
        cache.getMeta<SiteDetails>(`detail:${args.slug}`, SITE_TTL_MS)?.title ??
        cachedSite?.title ??
        args.slug;
      if (elements.length === 0) {
        return { content: [text(`No design elements listed for ${title} (${args.slug}).`)] };
      }
      const shown = elements.slice(0, MAX_INLINE_POSTERS);
      const lines = elements.map((el, i) => {
        const isVideo = el.mediaPath.endsWith(".mp4");
        return `${i + 1}. ${el.title} (${isVideo ? "video" : "image"})` +
          (isVideo ? ` — ${elementUrl(el.mediaPath)}` : "");
      });
      const posters = await Promise.all(
        shown.map(async (el): Promise<Block | null> => {
          try {
            const poster = elementPosterPath(el.mediaPath);
            const buf = await cache.getImage(poster, () => client.getAsset(poster));
            return { type: "image", data: buf.toString("base64"), mimeType: "image/jpeg" };
          } catch {
            return null; // poster failures degrade to text-only listings
          }
        }),
      );
      return {
        content: [
          text(`${title}: ${elements.length} design element(s):\n\n${lines.join("\n")}`),
          ...posters.filter((b): b is Block => b !== null),
        ],
      };
    } catch (err) {
      return errorResponse(err);
    }
  }

  // Task 5 read-time pairing: rows crawled before the attribution href was
  // parsed carry siteSlug = null, so fall back to matching the element author
  // against site titles (exact, case-insensitive; matched ~74% of the live
  // corpus at 2026-09-28). Author names are not unique across sites, so the
  // fallback only fills when exactly one site row has that title.
  function resolveSiteSlug(r: ElementRecord): string | null {
    if (r.siteSlug) return r.siteSlug;
    if (!r.author) return null;
    const titleMatches = cache.getSites(Infinity)
      .filter((s) => s.title.trim().toLowerCase() === r.author.trim().toLowerCase());
    return titleMatches.length === 1 ? titleMatches[0].slug : null;
  }

  // Compact payload per hit. mediaPath is coalesced to "" by rowToElement; an
  // empty path would yield a garbage "assets.awwwards.com/awards/" URL, so
  // mediaUrl/posterUrl render as null instead.
  function compactElement(r: ElementRecord) {
    return {
      slug: r.slug,
      title: r.title,
      category: r.category,
      author: r.author,
      mediaUrl: r.mediaPath ? elementUrl(r.mediaPath) : null,
      posterUrl: r.mediaPath ? elementUrl(elementPosterPath(r.mediaPath)) : null,
      source: r.source,
      projectId: r.projectId,
      siteSlug: resolveSiteSlug(r),
      siteUrl: (() => {
        const s = resolveSiteSlug(r);
        return s ? `https://www.awwwards.com/sites/${s}/` : null;
      })(),
    };
  }

  async function search_elements(args: {
    query?: string; category?: string; stack?: string[]; limit?: number;
  }): Promise<ToolResponse> {
    try {
      // Empty corpus → best-effort auto-index (gallery crawl is small and
      // one-shot; identical UX to the sites index auto-run).
      if (cache.countElements() === 0) {
        const { runElementsIndexer } = await import("./elements-indexer.js");
        try {
          await runElementsIndexer({ client, cache, maxItems: 48 });
        } catch (err) {
          return {
            content: [
              text(
                `Element index is empty and the gallery crawl failed (${err instanceof Error ? err.message : String(err)}). Try again later or run get_index_status.`,
              ),
            ],
            isError: true,
          };
        }
      }
      // Tokens exist but no query → no FTS call at all (searchElements with an
      // empty MATCH string would error). No-query searches list recent rows.
      const ftsQuery = args.query
        ? tokenizeQuery(args.query).map((t) => `"${t}"*`).join(" ")
        : null;
      const rows = ftsQuery
        ? cache.searchElements(ftsQuery, 100)
        : cache.listElements(200);

      const stackWords = (args.stack ?? []).map((s) => s.toLowerCase());
      const hits = rows
        .filter((r) => (args.category ? r.cid === args.category : true))
        .filter((r) => {
          if (stackWords.length === 0) return true;
          const hay = r.builtWith.map((b) => b.toLowerCase()).join(" ");
          return stackWords.every((w) => hay.includes(w));
        })
        .slice(0, args.limit ?? 8)
        .map(compactElement);
      return { content: [text(JSON.stringify({ count: hits.length, results: hits }, null, 1))] };
    } catch (err) {
      return errorResponse(err);
    }
  }

  async function get_element(args: { id: string }): Promise<ToolResponse> {
    try {
      const [record] = cache.getElements([args.id]);
      if (!record) {
        return { content: [text(`Unknown element id: ${args.id}`)], isError: true };
      }
      // One batched lookup resolves every related slug's title.
      const bySlug = new Map(cache.getElements(record.related).map((r) => [r.slug, r]));
      const related = record.related.map((slug) => {
        const r = bySlug.get(slug);
        return { slug, title: r?.title ?? "" };
      });
      return { content: [text(JSON.stringify({ ...record, related }, null, 1))] };
    } catch (err) {
      return errorResponse(err);
    }
  }

  async function list_categories(): Promise<ToolResponse> {
    try {
      let cats = cache.getMeta<Categories>("categories", CATEGORY_TTL_MS);
      if (!cats) {
        cats = parseCategories(await client.getHtml("/websites/"));
        if (cats.colors.length === 0 && cats.filters.length === 0) {
          return {
            content: [
              text(
                "Awwwards layout may have changed: parsed 0 categories. " +
                  "The awwwards-mcp parser likely needs an update.",
              ),
            ],
            isError: true,
          };
        }
        cache.setMeta("categories", cats);
      }
      return {
        content: [
          text(
            JSON.stringify(
              {
                colorCount: cats.colors.length,
                colors: cats.colors,
                filterCount: cats.filters.length,
                filters: cats.filters,
                usage:
                  "Pass one of: color (hex), award (sotd|developer|honorable), technology or a tag slug to search_sites. Combine at most one URL filter with client-side tags.",
              },
              null,
              1,
            ),
          ),
        ],
      };
    } catch (err) {
      return errorResponse(err);
    }
  }

  async function capture_live_site(args: {
    url: string;
    waitStrategy?: WaitStrategy;
    viewport?: ViewportName;
  }): Promise<ToolResponse> {
    try {
      // Lazy default: playwright is only touched when the tool actually runs.
      // The default is wrapped because captureLiveSite's third positional is
      // the injectable playwright loader — opts must land in fourth place.
      const capture =
        deps.captureFn ??
        ((url: string, imagesDir: string, opts?: WaitOpts) =>
          import("./capture.js").then((m) => m.captureLiveSite(url, imagesDir, undefined, opts)));
      // The tool schema defaults viewport to "desktop" (zod); the ?? keeps
      // direct handler calls on the same explicit path.
      const result = await capture(args.url, cache.imagesDir, {
        waitStrategy: args.waitStrategy,
        viewport: args.viewport ?? "desktop",
      });
      if ("error" in result) return { content: [text(result.error)], isError: true };
      return {
        content: [
          text(`Full-page capture of ${args.url} saved to ${result.file}`),
          { type: "image", data: result.base64, mimeType: "image/png" },
        ],
      };
    } catch (err) {
      return errorResponse(err);
    }
  }

  async function analyze_page_structure(args: {
    url: string;
    maxBands?: number;
    waitStrategy?: WaitStrategy;
    viewport?: ViewportName;
  }): Promise<ToolResponse> {
    try {
      // Lazy default: playwright is only touched when the tool actually runs.
      // maxBands from the tool schema is forwarded so the analyzer honors the
      // caller's cap (falling back to the analyzer's own default of 40).
      const analyze =
        deps.analyzeFn ??
        ((url: string, maxBands?: number, opts?: WaitOpts) =>
          import("./structure.js").then((m) =>
            m.analyzePageStructure(url, undefined, maxBands, opts),
          ));
      const structure = await analyze(args.url, args.maxBands, {
        waitStrategy: args.waitStrategy,
        viewport: args.viewport ?? "desktop",
      });
      if ("error" in structure) return { content: [text(structure.error)], isError: true };
      return { content: [text(JSON.stringify(structure, null, 1))] };
    } catch (err) {
      return errorResponse(err);
    }
  }

  async function record_site_motion(args: {
    url: string;
    frames?: number;
    waitStrategy?: WaitStrategy;
    viewport?: ViewportName;
  }): Promise<ToolResponse> {
    try {
      // Lazy default: playwright/ffmpeg are only touched when the tool runs.
      // The default forwards motionOpts wholesale, so waitStrategy and viewport
      // flow into recordSiteMotion's MotionOpts (which already accepts both).
      const motion =
        deps.motionFn ??
        ((
          url: string,
          motionOpts: {
            cacheImagesDir: string;
            frames?: number;
            waitStrategy?: WaitStrategy;
            viewport?: ViewportName;
          },
        ) => import("./motion.js").then((m) => m.recordSiteMotion(url, motionOpts)));
      const result = await motion(args.url, {
        cacheImagesDir: cache.imagesDir,
        frames: args.frames,
        waitStrategy: args.waitStrategy,
        viewport: args.viewport ?? "desktop",
      });
      if ("error" in result) return { content: [text(result.error)], isError: true };
      return {
        content: [
          text(`Motion recording saved to ${result.file}`),
          { type: "image", data: result.base64, mimeType: "image/jpeg" },
        ],
      };
    } catch (err) {
      return errorResponse(err);
    }
  }

  async function get_motion_dna(args: { url: string; recapture?: boolean }): Promise<ToolResponse> {
    try {
      const cached = args.recapture ? null : cache.getMotionDna(args.url);
      if (cached && Date.now() - cached.capturedAt < MOTION_DNA_TTL_MS) {
        return { content: [text(JSON.stringify(cached, null, 1))] };
      }
      // Lazy default: playwright is only touched when the tool actually runs.
      const capture =
        deps.motionDnaFn ??
        ((url: string, opts?: { viewport?: ViewportName }) =>
          import("./motion-dna.js").then((m) => m.captureMotionDna(url, opts)));
      const dna = await capture(args.url, { viewport: "desktop" });
      cache.upsertMotionDna(dna);
      return { content: [text(JSON.stringify(dna, null, 1))] };
    } catch (err) {
      return errorResponse(err);
    }
  }

  // Compact payloads only: the full record lives in the corpus under its url.
  async function search_motion(args: {
    lib?: string;
    scrubOnly?: boolean;
    hasPins?: boolean;
    limit?: number;
  }): Promise<ToolResponse> {
    try {
      const hits = cache
        .searchMotion(args)
        .slice(0, args.limit ?? 20)
        .map((d) => ({
          url: d.url,
          libs: d.stack.libs,
          scrollModel: d.stack.scrollModel,
          triggerCount: d.scroll.triggerCount,
          scrubCount: d.scroll.scrubCount,
          pinCount: d.scroll.pinCount,
          topEasing: d.easingVocab[0]?.token ?? null,
        }));
      return { content: [text(JSON.stringify({ count: hits.length, results: hits }, null, 1))] };
    } catch (err) {
      return errorResponse(err);
    }
  }

  // ---- longitudinal monitoring ----

  async function new_winners(args: { award?: "sotd" | "developer" | "honorable" }): Promise<ToolResponse> {
    try {
      const res = await fetchNewWinners(client, cache, { award: args.award ?? "sotd" });
      // Seed the sites cache too — next search_sites serves these rows
      // without re-fetching the same listing.
      if (res.newWinners.length > 0) cache.upsertSites(res.newWinners);
      // Backfill: index each winner's Elements section as source="site"
      // component records so search_elements covers fresh winners without
      // waiting for the gallery crawl. One page fetch per winner; per-winner
      // failures never abort the rest.
      let backfilled = 0;
      if (res.newWinners.length > 0) {
        const records: ElementRecord[] = [];
        for (const site of res.newWinners) {
          try {
            const html = await client.getHtml(site.detailPath);
            records.push(...recordsFromSiteHtml(html, site, Math.floor(Date.now() / 1000)));
            backfilled++;
          } catch {
            /* site page 404/blocked — the detail remains fetchable on demand */
          }
        }
        if (records.length > 0) cache.upsertElements(records);
      }
      const body = res.isNewArrivals
        ? `First poll for ${res.day} — no baseline yet, so there is no delta. ` +
          `${res.totalInListing} current listing entries stored as the baseline; call again after the next winners land.`
        : `${res.newWinners.length} new ${AWARD_FILTER_LABELS[args.award ?? "sotd"]} winner(s) for ${res.day} ` +
          `(listing shows ${res.totalInListing})` +
          (backfilled > 0 ? `; ${backfilled} site page(s) backfilled into the component index.` : ".") +
          ` Search components with search_elements (source hits show siteSlug).`;
      return {
        content: [
          text(body),
          ...(res.isNewArrivals
            ? []
            : [text(res.newWinners.map(summarizeSite).join("\n\n") || "(no unreported winners — poll again tomorrow)")]),
        ],
      };
    } catch (err) {
      return errorResponse(err);
    }
  }

  async function watch_site(args: {
    action: "add" | "list" | "remove";
    kind?: "studio" | "tag" | "url";
    pattern?: string;
    award?: "sotd" | "developer" | "honorable";
    note?: string;
  }): Promise<ToolResponse> {
    try {
      if (args.action === "list") {
        const watches = listWatches(cache);
        if (watches.length === 0) return { content: [text("No watches. Add one with action=add.")] };
        // Evaluate against the freshest cached listing rows; watch_site itself
        // never fetches — new_winners/search_sites keep this supply fresh.
        const rows = cache.getSites(SITE_TTL_MS);
        const deltas = rows.length > 0 ? checkWatches(cache, rows) : [];
        const lines = watches.map((w) => {
          const delta = deltas.find((d) => d.watch.kind === w.kind && d.watch.pattern === w.pattern);
          const matches = rows.filter((s) => matchesWatch(w, s));
          return (
            `- [${w.kind}] ${w.pattern}${w.award ? ` (award: ${w.award})` : ""}` +
            `${w.note ? ` — ${w.note}` : ""}\n` +
            `  currently matching: ${matches.length} site(s)` +
            (matches.length ? `: ${matches.map((s) => s.slug).join(", ")}` : "") +
            `\n  last checked: ${w.lastCheckedAt ? new Date(w.lastCheckedAt).toISOString() : "never (list again after rows load to seed)"}` +
            (delta ? `\n  NEW since last check: ${delta.matches.map((s) => `${s.title} (/sites/${s.slug})`).join("; ")}` : "")
          );
        });
        return { content: [text(lines.join("\n"))] };
      }
      if (!args.kind || !args.pattern) {
        return { content: [text("add/remove need kind (studio|tag|url) and pattern.")], isError: true };
      }
      if (args.action === "remove") {
        return {
          content: [
            text(removeWatch(cache, args.kind, args.pattern) ? `Removed watch [${args.kind}] ${args.pattern}.` : `No watch [${args.kind}] ${args.pattern}.`),
          ],
        };
      }
      const rec = await addWatch(cache, {
        kind: args.kind,
        pattern: args.pattern,
        award: args.award,
        note: args.note,
      });
      return {
        content: [
          text(
            `Watching [${rec.kind}] ${rec.pattern}. Poll with action=list after new winners land ` +
              "(new_winners also advances the baseline any watch compares against).",
          ),
        ],
      };
    } catch (err) {
      return errorResponse(err);
    }
  }

  return {
    search_sites,
    get_site_details,
    compare_sites,
    get_index_status,
    get_site_elements,
    search_elements,
    get_element,
    list_categories,
    capture_live_site,
    analyze_page_structure,
    record_site_motion,
    get_motion_dna,
    search_motion,
    new_winners,
    watch_site,
  };
}
