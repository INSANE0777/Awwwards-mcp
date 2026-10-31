import { posix } from "node:path";

export const BASE_URL = "https://www.awwwards.com";
export const ASSETS_URL = "https://assets.awwwards.com";

export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 awwwards-mcp/1.0";

export const AWARD_FILTERS = {
  sotd: "websites/sites_of_the_day",
  sotm: "websites/sites_of_the_month",
  soty: "websites/sites_of_the_year",
  nominees: "websites/nominees",
  developer: "websites/developer",
  honorable: "websites/honorable",
  ecommerce: "websites/winner_category_ecommerce",
  portfolio: "websites/winner_category_portfolio",
  product: "websites/winner_category_product",
  typography: "websites/winner_category_typography",
  businessServices: "websites/winner_category_business-services",
  noCode: "websites/winner_category_no-code",
} as const;

export type AwardFilter = keyof typeof AWARD_FILTERS;

export interface SearchFilters {
  color?: string;
  tags?: string[];
  technology?: string;
  award?: AwardFilter;
  query?: string;
}

// Technology alias canonicalization for the technology/tags[0] URL filter.
// Every entry was verified against the live /websites/ tag list on 2026-10-23:
// the target slug exists there and the source token does not (so exact slugs
// always win and are never rewritten). Unknown tokens pass through unchanged.
export const TECHNOLOGY_ALIASES: Record<string, string> = {
  nextjs: "next-js",
  "next.js": "next-js",
  nuxtjs: "nuxt-js",
  "nuxt.js": "nuxt-js",
  vuejs: "vue-js",
  "vue.js": "vue-js",
  reactjs: "react",
  threejs: "three-js",
  "three.js": "three-js",
  tailwindcss: "tailwind",
  eleventy: "11ty",
  nodejs: "node-js",
  "node.js": "node-js",
  greensock: "gsap",
  sveltejs: "svelte",
};

// Own-property lookup only: a bare table[key] would resolve inherited keys
// ("constructor", "__proto__") to Object.prototype members and make callers
// treat a function/object as an alias. Unknown strings pass through unchanged.
function lookupAlias(table: Record<string, string>, key: string): string | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

export function canonicalizeTechnology(token: string): string {
  return lookupAlias(TECHNOLOGY_ALIASES, token.toLowerCase()) ?? token;
}

export function slugifyTag(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// Display-name slug → live URL slug for facets whose visible tag differs from
// the /websites/ slug. Deliberately separate from TECHNOLOGY_ALIASES: the
// cache FTS expands queries with canonicalizeTechnology only, so mapping
// "css" → "css3" there would change free-text search. Both directions meet on
// the URL slug: canonicalFacet("Adobe Illustrator") and
// canonicalFacet("illustrator") both return "illustrator".
const DISPLAY_SLUG_ALIASES: Record<string, string> = {
  "adobe-illustrator": "illustrator",
  "adobe-photoshop": "photoshop",
  angular: "angularjs",
  css: "css3",
  "p5-js": "p5js",
  sketch: "sketchapp",
  "swiper-js": "swiper",
  "curtains-js": "curtains",
  "matter-js": "matterjs",
  "navigation-menu": "navigation",
  seo: "seo-1",
};

// The single facet normalization path: requested tags/technology and stored
// display tags both go through trim → slugifyTag (lowercases) → display-slug
// alias → documented technology alias. Compare the results with equality;
// substring matching conflated "react" with "react-native" and only appeared
// to work because display tags happen to contain their slug.
export function canonicalFacet(value: string): string {
  const slug = slugifyTag(value.trim());
  return canonicalizeTechnology(lookupAlias(DISPLAY_SLUG_ALIASES, slug) ?? slug);
}

// Combined filter URLs return 404 on awwwards.com (verified 2026-09-17), so
// exactly one filter is used in the URL — the most specific one. The caller
// applies the remaining filters client-side over the parsed results. The URL
// value runs through canonicalFacet, the same path matchesFilters uses, so a
// whitespace or alias spelling cannot scrape a different facet than it filters.
export function buildFilterUrl(filters: SearchFilters): string {
  if (filters.color) {
    return `${BASE_URL}/websites/%23${filters.color.replace("#", "").toUpperCase()}/`;
  }
  if (filters.award) return `${BASE_URL}/${AWARD_FILTERS[filters.award]}/`;
  const tag = filters.technology ?? filters.tags?.[0];
  if (tag) return `${BASE_URL}/websites/${encodeURIComponent(canonicalFacet(tag))}/`;
  return `${BASE_URL}/websites/`;
}

export function thumbnailUrl(thumbPath: string, size: 440 | 880 = 880): string {
  const dim = size === 880 ? "880_660" : "440_330";
  return `${ASSETS_URL}/awards/media/cache/thumb_${dim}/${thumbPath}`;
}

export function elementUrl(mediaPath: string): string {
  return `${ASSETS_URL}/awards/${mediaPath}`;
}

// Video elements ship a poster at the same path with .mp4 → _static.jpeg
// (live-verified on the CDN); image elements are used as-is.
export function elementPosterPath(mediaPath: string): string {
  return mediaPath.endsWith(".mp4")
    ? mediaPath.replace(/\.mp4$/, "_static.jpeg")
    : mediaPath;
}

export class BlockedError extends Error {
  constructor(
    url: string,
    public status: number,
  ) {
    super(
      `Awwwards is blocking requests (HTTP ${status} on ${url}). ` +
        "Try again later; the tool never retries through blocks.",
    );
  }
}

class PolitenessError extends Error {}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

// Release a response body we will not read; some bodies throw on cancel.
async function cancelBody(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {}
}

// Default cap for one CDN image/asset download. The preview path embeds these
// buffers in MCP responses, so an unbounded body is both a memory and payload
// risk; oversized responses are aborted before they are fully buffered.
export const DEFAULT_CDN_MAX_BYTES = 25 * 1024 * 1024;

export function cdnMaxBytes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.AWWWARDS_MCP_IMAGE_MAX_BYTES;
  if (!raw) return DEFAULT_CDN_MAX_BYTES;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_CDN_MAX_BYTES;
  const floored = Math.floor(n);
  return floored > 0 ? floored : DEFAULT_CDN_MAX_BYTES;
}

async function readCappedBody(res: Response, maxBytes: number, label: string): Promise<Buffer> {
  const tooLarge = () => new Error(
    `Refusing ${label}: response exceeds AWWWARDS_MCP_IMAGE_MAX_BYTES (${maxBytes} bytes)`,
  );
  // Content-Length is advisory but lets a declared-oversize body fail before
  // any of it is read; the stream check below covers missing/lying headers.
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await cancelBody(res);
    throw tooLarge();
  }
  const body = res.body;
  if (!body) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw tooLarge();
    return buf;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw tooLarge();
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released/cancelled */
    }
  }
  return Buffer.concat(chunks, total);
}

// Decodes %XX byte-wise and never throws, so malformed escapes cannot fail open.
// Shortcut: decodes bytes as Latin-1, not UTF-8 — enough for path comparison.
function decodePercentEscapes(value: string): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const hex = value.slice(i + 1, i + 3);
    if (value[i] === "%" && /^[0-9a-f]{2}$/i.test(hex)) {
      out += String.fromCharCode(parseInt(hex, 16));
      i += 2;
    } else out += value[i];
  }
  return out;
}

// Refuse robots-disallowed gallery paths by raw, decoded, unbackslashed and
// normalized pathname, so percent-encoded, deep-encoded, traversing and
// redirected variants cannot reach /elements/*. Eight rounds cover any realistic
// encoding; anything still changing after that is refused.
function assertAllowedPagePath(rawUrl: string, original: string): void {
  const rawPathname = new URL(rawUrl, BASE_URL).pathname;
  let decoded = rawPathname;
  for (let i = 0; i < 8; i++) {
    const next = decodePercentEscapes(decoded);
    if (next === decoded) break;
    decoded = next;
    if (i === 7) {
      throw new PolitenessError(
        `Refusing over-encoded path: ${original}. ` +
          "Gallery records are cache-only; new elements come from site pages.",
      );
    }
  }
  // The raw pathname stays a candidate: decoding or normalization must never
  // turn a forbidden /elements prefix into an allowed path. Backslashes are
  // flattened before normalization because posix.normalize treats "\..\" as
  // one segment, which would let /elements%5c..%5csites/ normalize to /sites/.
  const unbackslashed = decoded.replace(/\\/g, "/");
  const candidates = [
    rawPathname,
    decoded,
    unbackslashed,
    posix.normalize(unbackslashed),
  ];
  for (const candidate of candidates) {
    const lower = candidate.toLowerCase();
    if (lower === "/elements" || lower.startsWith("/elements/")) {
      throw new PolitenessError(
        `Refusing robots-disallowed /elements/* path: ${original}. ` +
          "Gallery records are cache-only; new elements come from site pages.",
      );
    }
  }
}

export class RateLimiter {
  private last = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(private intervalMs: number) {}

  acquire(): Promise<void> {
    const next = this.chain.then(async () => {
      const wait = this.last + this.intervalMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.last = Date.now();
    });
    this.chain = next.catch(() => {});
    return next;
  }
}

// One 1 req/s budget for every awwwards.com request in the MCP server process
// (HTML listings + the official annual API). Opted into by cli.ts; tests and
// one-shot scripts keep constructing their own limiters.
export const SHARED_RATE_LIMITER = new RateLimiter(1000);

export class AwwwardsClient {
  private rateLimiter: RateLimiter;
  private fetchFn: typeof fetch;
  private timeoutMs: number;

  constructor(opts: { rateLimiter?: RateLimiter; fetchFn?: typeof fetch; timeoutMs?: number } = {}) {
    this.rateLimiter = opts.rateLimiter ?? new RateLimiter(1000);
    this.fetchFn = opts.fetchFn ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 2_147_483_647) {
      throw new RangeError("timeoutMs must be a positive integer within the timer range");
    }
  }

  private async fetchWithTimeout<T>(
    url: string,
    label: string,
    init: RequestInit,
    read: (res: Response) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(
          `Timed out fetching ${label} from ${url} after ${this.timeoutMs}ms ` +
            "(including response body); check connectivity and try again later.",
        ));
        controller.abort();
      }, this.timeoutMs);
    });
    try {
      return await Promise.race([
        (async () => read(await this.fetchFn(url, { ...init, signal: controller.signal })))(),
        timeout,
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  // Page fetch with manual redirects. The limiter wait sits outside the per-hop
  // network/body deadline, and a timed-out hop never starts another fetch.
  private async fetchPage(url: string, label: string): Promise<string> {
    let currentUrl = url;
    let redirects = 0;
    for (;;) {
      await this.rateLimiter.acquire();
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(
            `Timed out fetching ${label} from ${currentUrl} after ${this.timeoutMs}ms ` +
              "(including response body); check connectivity and try again later.",
          ));
          controller.abort();
        }, this.timeoutMs);
      });
      try {
        const res = await Promise.race([
          this.fetchFn(currentUrl, {
            headers: { "User-Agent": USER_AGENT },
            redirect: "manual",
            signal: controller.signal,
          }),
          timeout,
        ]);
        if (REDIRECT_STATUSES.has(res.status)) {
          const location = res.headers.get("location");
          if (!location) {
            await Promise.race([cancelBody(res), timeout]);
            throw new Error(
              `HTTP ${res.status} redirect without a Location header fetching ${label} from ${currentUrl}`,
            );
          }
          let next: string;
          try {
            next = new URL(location, currentUrl).toString();
          } catch {
            await Promise.race([cancelBody(res), timeout]);
            throw new Error(
              `Invalid redirect Location "${location}" fetching ${label} from ${currentUrl}`,
            );
          }
          // Cleanup shares the hop deadline: a slow or hung cancel must reject
          // here, never let the loop continue to the next hop.
          await Promise.race([cancelBody(res), timeout]);
          assertAllowedPagePath(next, currentUrl);
          if (++redirects > MAX_REDIRECTS) {
            throw new Error(`Too many redirects fetching ${label} from ${url}`);
          }
          currentUrl = next;
          continue;
        }
        if (!res.ok) {
          // Preserve the HTTP status: body cleanup is best-effort and must
          // never turn a block into a retryable timeout.
          void cancelBody(res);
          if (res.status === 403 || res.status === 429) {
            throw new BlockedError(currentUrl, res.status);
          }
          throw new Error(`HTTP ${res.status} for ${currentUrl}`);
        }
        return await Promise.race([res.text(), timeout]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    }
  }

  // Rate-limited page fetch with one retry on transient failures.
  // Blocks (403/429) and robots refusals are never retried.
  async getHtml(path: string): Promise<string> {
    const url = path.startsWith("http") ? path : BASE_URL + path;
    assertAllowedPagePath(url, path);
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this.fetchPage(url, "page");
      } catch (err) {
        if (err instanceof BlockedError || err instanceof PolitenessError) throw err;
        lastErr = err;
      }
    }
    throw lastErr;
  }

  // Thumbnail fetch from the CDN — not rate-limited.
  async getThumbnail(thumbPath: string, size: 440 | 880 = 880): Promise<Buffer> {
    return this.fetchCdnBinary(thumbnailUrl(thumbPath, size), `thumbnail ${thumbPath}`);
  }

  // Asset fetch from the CDN (element posters etc.) — not rate-limited.
  async getAsset(assetPath: string): Promise<Buffer> {
    return this.fetchCdnBinary(elementUrl(assetPath), `asset ${assetPath}`);
  }

  // Binary CDN assets (thumbnails, element media) all fetch through this single path.
  private async fetchCdnBinary(url: string, label: string): Promise<Buffer> {
    return this.fetchWithTimeout(
      url,
      label,
      { headers: { "User-Agent": USER_AGENT } },
      async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${label}`);
        return readCappedBody(res, cdnMaxBytes(), label);
      },
    );
  }
}
