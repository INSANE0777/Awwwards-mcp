import {
  AwwwardsClient,
  BASE_URL,
  BlockedError,
  SHARED_RATE_LIMITER,
} from "./awwwards.js";
import type { RateLimiter } from "./awwwards.js";
import type { Cache } from "./cache.js";

// Official Awwwards Annual Awards API (JSON:API, read-only).
// Terms posture: personal, non-commercial inspiration use; media URLs are
// reference-only and never downloaded. The daily listing scrape is untouched.
// `GET /api/annual/nominees` is empty (totalItems: 0) — never call it.

export const ANNUAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const ANNUAL_DEFAULT_LIMIT = 10;
export const ANNUAL_MAX_LIMIT = 20;

// Deliberate simplification of the plan: reuse the existing `meta` table
// (namespaced keys + JSON values) instead of adding an annual_cache table.
const CATEGORIES_KEY = "annual:categories";

const CATEGORIES_NOTE =
  "Nominees are hydrated on request at 1 request/second. Annual data comes from " +
  "Awwwards' official public read-only API for personal, non-commercial inspiration " +
  "use; media URLs are reference-only (no downloads).";

export interface AnnualCategory {
  name: string;
  slug: string;
  kind: "site" | "user";
  nomineeCount: number;
}

// Cache-only shape: keeps each category's nominee UUIDs so a bounded list call
// can slice before hydrating. Never returned to tools directly.
interface CategoryRecord extends AnnualCategory {
  nominees: string[];
}

interface AnnualNomineeBase {
  id: string;
  slug: string;
  name?: string;
}

export interface AnnualSiteNominee extends AnnualNomineeBase {
  kind: "site";
  date?: string;
  description?: string;
  designBy?: string;
  country?: string;
  url?: string;
  awwwardsUrl: string;
  images: string[];
  videos: string[];
}

export interface AnnualUserNominee extends AnnualNomineeBase {
  kind: "user";
  description?: string;
  awwwardsUrl: string;
  location?: string;
  avatar?: string;
  tags: { type: string; quantity: number }[];
  featuredProjects: {
    name: string;
    date: string;
    url: string;
    awwwardsUrl?: string;
  }[];
}

export type AnnualNominee = AnnualSiteNominee | AnnualUserNominee;

export interface AnnualNomineeSummary {
  id: string;
  kind: "site" | "user";
  slug?: string;
  name?: string;
  country?: string;
  location?: string;
  date?: string;
  designBy?: string;
  image?: string;
  awwwardsUrl?: string;
  siteSlug?: string;
  inLocalIndex: boolean;
  // hydrate=false and no fresh cache: the id is known, the detail is not.
  hydratePending?: true;
}

export interface AnnualMeta {
  cached: boolean;
  stale?: true;
  // A 403/429 stopped the request. Consumers must not issue more requests.
  blocked?: true;
  error?: string;
}

export interface AnnualCategoriesResult {
  categories: AnnualCategory[];
  meta: AnnualMeta;
  note: string;
}

export interface AnnualNomineeResult {
  nominee: AnnualNominee;
  meta: AnnualMeta;
  mediaNote: "reference-only";
}

export interface AnnualNomineesMeta {
  hydrated: number;
  cached: number;
  partial: boolean;
  stale?: true;
  blocked?: true;
  error?: string;
  note: string;
}

export interface AnnualNomineesResult {
  category: AnnualCategory;
  total: number;
  nominees: AnnualNomineeSummary[];
  meta: AnnualNomineesMeta;
}

export interface AnnualDeps {
  cache: Cache;
  fetchFn?: typeof fetch;
  rateLimiter?: RateLimiter;
  timeoutMs?: number;
}

export interface AnnualNomineeOptions {
  limit?: number;
  offset?: number;
  hydrate?: boolean;
}

type Json = Record<string, unknown>;

function record(value: unknown): Json | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// AwwwardsClient already gives the house semantics: rate limiter, house UA,
// 10 s timeout including body, one retry on failure, no retry on 403/429.
// Its limiter defaults to SHARED_RATE_LIMITER (also used by cli.ts's scraper),
// so the MCP process keeps one 1 req/s awwwards.com budget.
async function fetchAnnualJson(path: string, deps: AnnualDeps): Promise<unknown> {
  const client = new AwwwardsClient({
    rateLimiter: deps.rateLimiter ?? SHARED_RATE_LIMITER,
    fetchFn: deps.fetchFn,
    timeoutMs: deps.timeoutMs,
  });
  const body = await client.getHtml(path);
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error(`Annual API returned invalid JSON for ${path}; the response shape may have changed.`);
  }
}

function idFromResource(resource: Json, fallback: string): string {
  const raw = str(resource.id);
  if (!raw) return fallback;
  const parts = raw.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? fallback;
}

function resourceData(payload: unknown): Json {
  const resource = record(record(payload)?.data);
  if (!resource) {
    throw new Error(
      "Annual API nominee response is missing its data object; the response shape may have changed.",
    );
  }
  return resource;
}

function parseCategories(payload: unknown): CategoryRecord[] {
  const data = record(payload)?.data;
  if (!Array.isArray(data)) {
    throw new Error(
      "Annual API categories response is missing its data array; the response shape may have changed.",
    );
  }
  const records: CategoryRecord[] = [];
  for (const item of data) {
    const resource = record(item);
    const attrs = resource ? record(resource.attributes) : undefined;
    const slug = attrs ? str(attrs.slug) : undefined;
    if (!attrs || !slug) continue;
    const nominees = stringArray(attrs.nominees);
    records.push({
      name: str(attrs.name) ?? slug,
      slug,
      // Only two annual categories exist today; an unknown _type is treated
      // as a site category rather than dropping the entry.
      kind: attrs._type === "user" ? "user" : "site",
      nomineeCount: nominees.length,
      nominees,
    });
  }
  if (records.length === 0) {
    throw new Error("Annual API returned no categories; the response shape may have changed.");
  }
  return records;
}

function publicCategory(c: CategoryRecord): AnnualCategory {
  return { name: c.name, slug: c.slug, kind: c.kind, nomineeCount: c.nomineeCount };
}

function parseSiteNominee(payload: unknown, fallbackId: string): AnnualSiteNominee {
  const resource = resourceData(payload);
  const attrs = record(resource.attributes) ?? {};
  const id = idFromResource(resource, fallbackId);
  const slug = str(attrs.slug) ?? id;
  return {
    id,
    kind: "site",
    slug,
    name: str(attrs.name),
    date: str(attrs.date),
    description: str(attrs.description),
    designBy: str(attrs.designBy),
    country: str(attrs.country),
    url: str(attrs.url),
    awwwardsUrl: str(attrs.awwwardsUrl) ?? `${BASE_URL}/sites/${slug}`,
    images: stringArray(attrs.images),
    videos: stringArray(attrs.videos),
  };
}

function parseUserNominee(payload: unknown, fallbackId: string): AnnualUserNominee {
  const resource = resourceData(payload);
  const attrs = record(resource.attributes) ?? {};
  const id = idFromResource(resource, fallbackId);
  const slug = str(attrs.slug) ?? id;
  const tags = Array.isArray(attrs.tags)
    ? attrs.tags.flatMap((item) => {
        const t = record(item);
        const type = t ? str(t.type) : undefined;
        const quantity = t && typeof t.quantity === "number" ? t.quantity : 0;
        return type ? [{ type, quantity }] : [];
      })
    : [];
  const featuredProjects = Array.isArray(attrs.featuredProjects)
    ? attrs.featuredProjects.flatMap((item) => {
        const p = record(item);
        const name = p ? str(p.name) : undefined;
        if (!p || !name) return [];
        const url = str(p.url) ?? "";
        const awwwardsUrl = str(p.awwwardsUrl);
        return [{
          name,
          date: str(p.date) ?? "",
          url,
          ...(awwwardsUrl ? { awwwardsUrl } : {}),
        }];
      })
    : [];
  return {
    id,
    kind: "user",
    slug,
    name: str(attrs.name),
    description: str(attrs.description),
    awwwardsUrl: str(attrs.awwwardsUrl) ?? `${BASE_URL}/${slug}/`,
    location: str(attrs.location),
    avatar: str(attrs.avatar),
    tags,
    featuredProjects,
  };
}

function nomineeKey(kind: "site" | "user", id: string): string {
  return `annual:nominee:${kind}:${id}`;
}

function nomineePath(kind: "site" | "user", id: string): string {
  return `/api/annual/nominees/${kind === "site" ? "sites" : "users"}/${encodeURIComponent(id)}`;
}

// Cache lookups are guarded: the store itself may be the failure source.
function staleRead<T>(cache: Cache, key: string): T | null {
  try {
    return cache.getMeta<T>(key, Number.POSITIVE_INFINITY);
  } catch {
    return null;
  }
}

function inLocalIndex(cache: Cache, slug: string): boolean {
  try {
    return cache.getSite(slug, Number.POSITIVE_INFINITY) !== null;
  } catch {
    return false;
  }
}

const MEDIA_NOTE = "reference-only" as const;
const BLOCKED_NOTE = "Awwwards is blocking requests; no further requests were made.";

// Reads a nominee from cache at any age, never the network.
function cachedOnlyNominee(
  kind: "site" | "user",
  id: string,
  cache: Cache,
): AnnualNomineeResult | null {
  const key = nomineeKey(kind, id);
  const fresh = cache.getMeta<AnnualNominee>(key, ANNUAL_TTL_MS);
  if (fresh) return { nominee: fresh, meta: { cached: true }, mediaNote: MEDIA_NOTE };
  const stale = staleRead<AnnualNominee>(cache, key);
  if (stale) {
    return { nominee: stale, meta: { cached: true, stale: true }, mediaNote: MEDIA_NOTE };
  }
  return null;
}

function summarize(nominee: AnnualNominee, cache: Cache): AnnualNomineeSummary {
  const base: AnnualNomineeSummary = {
    id: nominee.id,
    kind: nominee.kind,
    slug: nominee.slug,
    name: nominee.name,
    awwwardsUrl: nominee.awwwardsUrl,
    inLocalIndex: false,
  };
  if (nominee.kind === "site") {
    return {
      ...base,
      date: nominee.date,
      designBy: nominee.designBy,
      country: nominee.country,
      image: nominee.images[0],
      siteSlug: nominee.slug,
      inLocalIndex: inLocalIndex(cache, nominee.slug),
    };
  }
  return {
    ...base,
    location: nominee.location,
    image: nominee.avatar,
  };
}

async function loadCategoryRecords(
  deps: AnnualDeps,
): Promise<{ records: CategoryRecord[]; meta: AnnualMeta }> {
  const fresh = deps.cache.getMeta<CategoryRecord[]>(CATEGORIES_KEY, ANNUAL_TTL_MS);
  if (fresh) return { records: fresh, meta: { cached: true } };
  try {
    const records = parseCategories(await fetchAnnualJson("/api/annual/categories", deps));
    deps.cache.setMeta(CATEGORIES_KEY, records);
    return { records, meta: { cached: false } };
  } catch (err) {
    const stale = staleRead<CategoryRecord[]>(deps.cache, CATEGORIES_KEY);
    if (stale) {
      return {
        records: stale,
        meta: {
          cached: true,
          stale: true,
          ...(err instanceof BlockedError ? { blocked: true as const } : {}),
          error: message(err),
        },
      };
    }
    throw err;
  }
}

export async function getCategories(deps: AnnualDeps): Promise<AnnualCategoriesResult> {
  const { records, meta } = await loadCategoryRecords(deps);
  return { categories: records.map(publicCategory), meta, note: CATEGORIES_NOTE };
}

export async function getNominee(
  kind: "site" | "user",
  id: string,
  deps: AnnualDeps,
  options: { allowStale?: boolean } = {},
): Promise<AnnualNomineeResult> {
  const key = nomineeKey(kind, id);
  const fresh = deps.cache.getMeta<AnnualNominee>(key, ANNUAL_TTL_MS);
  if (fresh) return { nominee: fresh, meta: { cached: true }, mediaNote: MEDIA_NOTE };
  try {
    const payload = await fetchAnnualJson(nomineePath(kind, id), deps);
    const nominee = kind === "site"
      ? parseSiteNominee(payload, id)
      : parseUserNominee(payload, id);
    deps.cache.setMeta(key, nominee);
    return { nominee, meta: { cached: false }, mediaNote: MEDIA_NOTE };
  } catch (err) {
    // The slug scan opts out so the first real failure surfaces unchanged.
    if (options.allowStale === false) throw err;
    const stale = staleRead<AnnualNominee>(deps.cache, key);
    if (stale) {
      return {
        nominee: stale,
        mediaNote: MEDIA_NOTE,
        meta: {
          cached: true,
          stale: true,
          ...(err instanceof BlockedError ? { blocked: true as const } : {}),
          error: message(err),
        },
      };
    }
    throw err;
  }
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

function unknownCategory(slug: string, records: CategoryRecord[]): Error {
  return new Error(
    `Unknown annual category: ${slug}. Known categories: ${records.map((c) => c.slug).join(", ")}.`,
  );
}

export async function getNominees(
  categorySlug: string,
  options: AnnualNomineeOptions,
  deps: AnnualDeps,
): Promise<AnnualNomineesResult> {
  const { records, meta: categoryMeta } = await loadCategoryRecords(deps);
  const category = records.find((c) => c.slug === categorySlug);
  if (!category) throw unknownCategory(categorySlug, records);

  const limit = clampInt(options.limit, ANNUAL_DEFAULT_LIMIT, 1, ANNUAL_MAX_LIMIT);
  const offset = clampInt(options.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const hydrate = options.hydrate !== false;
  const ids = category.nominees.slice(offset, offset + limit);

  const nominees: AnnualNomineeSummary[] = [];
  const errors: string[] = categoryMeta.error ? [categoryMeta.error] : [];
  let hydrated = 0;
  let cached = 0;
  let partial = false;
  let stale = categoryMeta.stale === true;
  let blocked = categoryMeta.blocked === true;

  // A blocked categories request serves stale categories but must not fan out
  // into nominee requests. Uncached entries become id-only stubs.
  const canHydrate = hydrate && !blocked;

  for (const id of ids) {
    const key = nomineeKey(category.kind, id);
    const fresh = deps.cache.getMeta<AnnualNominee>(key, ANNUAL_TTL_MS);
    if (fresh) {
      nominees.push(summarize(fresh, deps.cache));
      cached++;
      continue;
    }
    if (!canHydrate) {
      partial = true;
      nominees.push({ id, kind: category.kind, inLocalIndex: false, hydratePending: true });
      continue;
    }
    try {
      const result = await getNominee(category.kind, id, deps);
      nominees.push(summarize(result.nominee, deps.cache));
      if (result.meta.cached) cached++;
      else hydrated++;
      if (result.meta.stale) {
        stale = true;
        if (result.meta.error) errors.push(result.meta.error);
      }
      // A stale-served block ends the call; the remaining ids stay pending.
      if (result.meta.blocked) {
        blocked = true;
        break;
      }
    } catch (err) {
      partial = true;
      errors.push(message(err));
      // Never keep hammering through a block; the rest are left pending.
      if (err instanceof BlockedError) {
        blocked = true;
        break;
      }
    }
  }

  if (ids.length > nominees.length) partial = true;

  return {
    category: publicCategory(category),
    total: category.nomineeCount,
    nominees,
    meta: {
      hydrated,
      cached,
      partial,
      ...(stale ? { stale: true as const } : {}),
      ...(blocked ? { blocked: true as const } : {}),
      ...(errors.length > 0 ? { error: errors[0] } : {}),
      note:
        "Details hydrate on request at 1 request/second and cache for 7 days. " +
        "Media URLs are reference-only; nothing is downloaded or redistributed.",
    },
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOMINEE_PATH_RE = /\/api\/annual\/nominees\/(sites|users)\/([^/?#]+)\/?$/;

function invalidReference(idOrPath: string): Error {
  return new Error(
    `Invalid annual nominee reference: ${idOrPath}. ` +
      "Pass a UUID or a full /api/annual/nominees/sites|users/<uuid> path.",
  );
}

// Accepts a bare UUID (kind resolved from the cached categories) or a full
// `/api/annual/nominees/sites|users/<uuid>` path (or absolute URL ending in it).
export async function resolveNominee(
  idOrPath: string,
  deps: AnnualDeps,
): Promise<AnnualNomineeResult> {
  const ref = idOrPath.trim();
  const pathMatch = NOMINEE_PATH_RE.exec(ref);
  if (pathMatch) {
    const id = pathMatch[2]!;
    // Validate before any cache/network work: `..` and other path fragments
    // must never become a nominee id.
    if (!UUID_RE.test(id)) throw invalidReference(idOrPath);
    const kind = pathMatch[1] === "sites" ? "site" : "user";
    return getNominee(kind, id.toLowerCase(), deps);
  }
  if (!UUID_RE.test(ref)) throw invalidReference(idOrPath);
  const id = ref.toLowerCase();
  const { records, meta } = await loadCategoryRecords(deps);
  const category = records.find((c) => c.nominees.includes(id));
  if (!category) {
    throw new Error(
      `Unknown annual nominee id: ${id}. Use the annual nominees tool to find its id, ` +
        "or pass the full /api/annual/nominees/... path.",
    );
  }
  // A blocked categories lookup may use stale categories to identify the kind,
  // but it must not trigger a fresh nominee request.
  if (meta.blocked) {
    const cached = cachedOnlyNominee(category.kind, id, deps.cache);
    if (cached) {
      return {
        ...cached,
        meta: {
          ...cached.meta,
          blocked: true,
          ...(meta.error ? { error: meta.error } : {}),
        },
      };
    }
    throw new Error(meta.error ?? BLOCKED_NOTE);
  }
  return getNominee(category.kind, id, deps);
}

// Slug convenience for get_annual_nominee({category, slug}): fresh cache first,
// then any cached age, then a bounded 20-entry hydration scan for uncached ids.
// Slugs are not API keys, so resolving one may cost up to 20 paced requests
// (~20 s at 1 req/s). The first failed fetch stops the scan unchanged.
export async function getNomineeBySlug(
  categorySlug: string,
  slug: string,
  deps: AnnualDeps,
): Promise<AnnualNomineeResult> {
  const { records, meta: categoryMeta } = await loadCategoryRecords(deps);
  const category = records.find((c) => c.slug === categorySlug);
  if (!category) throw unknownCategory(categorySlug, records);

  const blockedFields = categoryMeta.blocked
    ? {
        blocked: true as const,
        ...(categoryMeta.error ? { error: categoryMeta.error } : {}),
      }
    : {};

  const cachedIds = new Set<string>();
  for (const id of category.nominees) {
    const key = nomineeKey(category.kind, id);
    const fresh = deps.cache.getMeta<AnnualNominee>(key, ANNUAL_TTL_MS);
    if (fresh) {
      cachedIds.add(id);
      if (fresh.slug === slug) {
        return {
          nominee: fresh,
          meta: { cached: true, ...blockedFields },
          mediaNote: MEDIA_NOTE,
        };
      }
      continue;
    }
    const stale = staleRead<AnnualNominee>(deps.cache, key);
    if (stale) {
      cachedIds.add(id);
      if (stale.slug === slug) {
        return {
          nominee: stale,
          meta: { cached: true, stale: true, ...blockedFields },
          mediaNote: MEDIA_NOTE,
        };
      }
    }
  }

  if (categoryMeta.blocked) throw new Error(categoryMeta.error ?? BLOCKED_NOTE);

  let attempted = 0;
  for (const id of category.nominees) {
    // Any cached candidate (fresh or stale) was already considered above;
    // re-fetching it would waste a request and could mask a block.
    if (cachedIds.has(id)) continue;
    if (attempted >= ANNUAL_MAX_LIMIT) break;
    attempted++;
    const result = await getNominee(category.kind, id, deps, { allowStale: false });
    if (result.nominee.slug === slug) return result;
  }
  throw new Error(
    `No nominee with slug "${slug}" in ${categorySlug} among ${cachedIds.size} cached ` +
      `and ${attempted} uncached entries. ` +
      "Find its id with the annual nominees tool (offset/limit), then request that nominee by id.",
  );
}
