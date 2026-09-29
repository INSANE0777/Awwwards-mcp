import { AwwwardsClient, buildFilterUrl, AWARD_FILTERS } from "./awwwards.js";
import type { Cache } from "./cache.js";
import type { ElementRecord, SiteSummary } from "./types.js";
import { parseListing, parseElements } from "./parsers.js";

// Longitudinal monitoring over the allowed SOTD listing — the RSS feed at
// /sites-of-the-day/feed/ is robots-disallowed (/feed → Disallow for "*"),
// so the delta comes from /websites/sites_of_the_day/, which the sites index
// already crawls with the same parser.

export interface NewWinnersResult {
  day: string; // UTC YYYY-MM-DD the delta was computed against
  isNewArrivals: boolean; // false = first-ever call, listing dumped instead
  newWinners: SiteSummary[];
  totalInListing: number;
}

// UTC midnight of "today" — SOTD pubDates are UTC day-granular, and UTC
// midnight is deterministic across the agent's local timezone.
export function utcDayStart(nowMs = Date.now()): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000;
}

// First call on a fresh cache has no baseline: everything the listing shows
// is "new" technically but meaningless as a delta — report it as a dump so
// the agent treats it as seeding, not as news.
export async function fetchNewWinners(
  client: AwwwardsClient,
  cache: Cache,
  opts: { award?: "sotd" | "developer" | "honorable"; now?: () => number } = {},
): Promise<NewWinnersResult> {
  const now = opts.now ?? Date.now;
  const award = opts.award ?? "sotd";
  const html = await client.getHtml(`${buildFilterUrl({ award: award })}`);
  const parsed = parseListing(html);
  const dayStart = utcDayStart(now());
  const fresh = parsed.filter((s) => s.createdAt >= dayStart);
  const baselineKey = `winners_baseline_${award}`;
  const baseline = cache.getMeta<string[]>(baselineKey, Number.POSITIVE_INFINITY);
  if (!baseline) {
    cache.setMeta(baselineKey, parsed.map((s) => s.slug));
    return { day: new Date(dayStart * 1000).toISOString().slice(0, 10), isNewArrivals: true, newWinners: [], totalInListing: parsed.length };
  }
  const seen = new Set(baseline);
  const arrivals = fresh.filter((s) => !seen.has(s.slug));
  // Always advance the baseline to the full listing — new arrivals are
  // reported once, never re-reported on the next poll.
  cache.setMeta(baselineKey, parsed.map((s) => s.slug));
  return { day: new Date(dayStart * 1000).toISOString().slice(0, 10), isNewArrivals: false, newWinners: arrivals, totalInListing: parsed.length };
}

// Watchlist rows in meta (one key per watch — watch-local content stays
// out of the shared sites index).
export interface WatchRecord {
  kind: "studio" | "tag" | "url";
  // studio: substring against the parsed author line; tag: tag slug filter;
  // url: the site detailPath stem to monitor for new award/date changes.
  pattern: string;
  award?: "sotd" | "developer" | "honorable";
  createdAt: number;
  lastCheckedAt: number | null;
  lastSlugs: string[] | null; // listing slugs at last check (tag/studio watches)
  note?: string;
}

export async function addWatch(
  cache: Cache,
  rec: Omit<WatchRecord, "createdAt" | "lastCheckedAt" | "lastSlugs">,
  nowMs = Date.now(),
): Promise<WatchRecord> {
  const full: WatchRecord = { ...rec, createdAt: nowMs, lastCheckedAt: null, lastSlugs: null };
  cache.setMeta(`watch_${full.kind}_${full.pattern}`, full);
  return full;
}

export function listWatches(cache: Cache): WatchRecord[] {
  return cache.listMetaPrefix<WatchRecord>("watch_");
}

export function removeWatch(cache: Cache, kind: WatchRecord["kind"], pattern: string): boolean {
  const key = `watch_${kind}_${pattern}`;
  const existed = cache.getMeta<WatchRecord>(key, Number.POSITIVE_INFINITY) !== null;
  cache.deleteMeta(key);
  return existed;
}

// Watch × listing match, evaluated against the freshest cached listing rows
// (new_winners/search_sites keep them fresh — watch_site never fetches).
// url watches match a site whose detailPath ends in /<pattern>; studio is
// case-insensitive substring; tag is tag-slug containment.
export function matchesWatch(
  w: WatchRecord,
  s: SiteSummary,
): boolean {
  if (w.pattern == null || w.pattern === "") return false;
  switch (w.kind) {
    case "url":
      return s.slug === w.pattern || s.detailPath === `/sites/${w.pattern}` ||
        s.detailPath === `/sites/${w.pattern}/`;
    case "studio":
      return (s.studio ?? "").toLowerCase().includes(w.pattern.trim().toLowerCase());
    case "tag":
      return s.tags.some((t) => t.toLowerCase().replace(/\W+/g, "-") === w.pattern.toLowerCase());
  }
}

// Evaluate all watches against `rows`, persist lastCheckedAt/lastSlugs, and
// return per-watch new entries (first evaluation seeds and reports none).
export function checkWatches(
  cache: Cache,
  rows: SiteSummary[],
  nowMs = Date.now(),
): { watch: WatchRecord; matches: SiteSummary[] }[] {
  const watches = listWatches(cache);
  const results: { watch: WatchRecord; matches: SiteSummary[] }[] = [];
  for (const w of watches) {
    const hits = rows.filter((s) => matchesWatch(w, s));
    const hitSlugs = hits.map((s) => s.slug).sort();
    if (w.lastSlugs === null) {
      // Seed: record the current set, report nothing.
      cache.setMeta(`watch_${w.kind}_${w.pattern}`, { ...w, lastCheckedAt: nowMs, lastSlugs: hitSlugs });
      continue;
    }
    const prev = new Set(w.lastSlugs);
    const fresh = hits.filter((s) => !prev.has(s.slug));
    cache.setMeta(`watch_${w.kind}_${w.pattern}`, { ...w, lastCheckedAt: nowMs, lastSlugs: hitSlugs });
    if (fresh.length > 0) results.push({ watch: w, matches: fresh });
  }
  return results;
}

// Winner → component backfill: for each new winner, fetch the site page once
// and index its "Elements" section as source="site" component records, so the
// fresh winner is immediately searchable in search_elements. The gallery
// element slugs come from real /inspiration/<slug> URLs; site sections give
// only media cards, so records get a `site-<siteslug>-<title>` slug in a
// namespace disjoint from gallery slugs — upsert can never merge the two.
export function recordsFromSiteHtml(
  html: string,
  site: SiteSummary,
  nowSec: number,
): ElementRecord[] {
  const media = parseElements(html) ?? [];
  return media.map((el) => ({
    slug: `site-${site.slug}-${el.title.toLowerCase().replace(/\W+/g, "-")}`,
    title: el.title,
    cid: "uncategorized", // site pages carry no facet taxonomy
    category: "uncategorized",
    author: site.studio ?? site.title,
    builtWith: [], // technologies live on the site detail, not the element card
    related: [],
    mediaPath: el.mediaPath,
    mediaType: el.mediaPath.endsWith(".mp4") ? "video" : el.mediaPath ? "image" : null,
    source: "site" as const,
    projectId: null,
    siteSlug: site.slug,
    fetchedAt: nowSec,
  }));
}
