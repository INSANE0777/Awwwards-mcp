import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COLLECTIONS_INDEX_MAX_PAGE,
  COLLECTIONS_TTL_MS,
  getCollection,
  getCollections,
  normalizeCollectionSlug,
  parseCollectionPage,
  parseCollectionsIndex,
  type CollectionsDeps,
} from "../src/collections.js";
import { AwwwardsClient, BlockedError, RateLimiter } from "../src/awwwards.js";
import { Cache } from "../src/cache.js";
import { createHandlers } from "../src/server.js";

const FIXTURES = join(__dirname, "fixtures", "sources");
const indexHtml = readFileSync(join(FIXTURES, "collections-index.html"), "utf8");
const collectionHtml = readFileSync(join(FIXTURES, "collections-brutalism.html"), "utf8");
const mixedHtml = readFileSync(join(FIXTURES, "collections-mixed.html"), "utf8");
const talksHtml = readFileSync(join(FIXTURES, "collections-talks.html"), "utf8");

const dirs: string[] = [];
const tmpDir = () => {
  const d = mkdtempSync(join(tmpdir(), "awwwards-collections-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function fixtureFetch() {
  return vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes("/collections/brutalism/")) return new Response(collectionHtml);
    if (url.includes("/collections/talks/")) return new Response(talksHtml);
    if (url.includes("/collections/pastel-colors/")) return new Response(collectionHtml);
    if (url.match(/\/collections\/(?:\?page=\d+)?$/)) return new Response(indexHtml);
    throw new Error(`unexpected offline fetch: ${url}`);
  });
}

function deps(fetchFn: ReturnType<typeof fixtureFetch>, now: () => number = Date.now): CollectionsDeps {
  return {
    cache: new Cache(tmpDir(), now),
    fetchFn: fetchFn as unknown as typeof fetch,
    rateLimiter: new RateLimiter(0),
  };
}

describe("collections parsers", () => {
  it("parses the index blobs, curated + member hrefs, owner/ref and pagination", () => {
    const parsed = parseCollectionsIndex(indexHtml, 1);
    expect(parsed).not.toBeNull();
    expect(parsed!.collections).toHaveLength(6);
    expect(parsed!.hasMore).toBe(true);

    const brutal = parsed!.collections.find((c) => c.slug === "brutalism");
    expect(brutal).toMatchObject({
      title: "Brutalism",
      href: "/awwwards/collections/brutalism/",
      owner: "awwwards",
      ref: "brutalism",
    });
    expect(brutal!.blurb).toBeUndefined();

    const member = parsed!.collections.find((c) => c.slug === "pastel-colors");
    expect(member).toMatchObject({
      title: "Pastel colors",
      href: "/Mixallo/collections/pastel-colors/",
      owner: "Mixallo",
      ref: "Mixallo/pastel-colors",
    });

    const blurbed = parsed!.collections.find((c) => c.slug === "webgl-html5-games");
    expect(blurbed!.blurb).toContain("game engines");
  });

  it("returns null for a non-collections page and [] for an empty grid", () => {
    expect(parseCollectionsIndex("")).toBeNull();
    expect(parseCollectionsIndex("<html><body>drift</body></html>")).toBeNull();
    expect(parseCollectionsIndex('<ul data-group="collections"></ul>')).toEqual({
      collections: [],
      hasMore: false,
    });
  });

  it("parses a collection page through parseListing with explicit item counts", () => {
    const parsed = parseCollectionPage(collectionHtml, "brutalism");
    expect(parsed).not.toBeNull();
    expect(parsed!.title).toBe("BRUTALISM");
    expect(parsed!.items).toBe(83);
    expect(parsed!.sites).toHaveLength(6);
    expect(parsed!.hasSiteMarkup).toBe(true);
    expect(parsed!.sites[0]).toMatchObject({
      slug: "work-by-10011",
      detailPath: "/sites/work-by-10011",
      liveUrl: "http://www.10011mag.co",
    });
    expect(parseCollectionPage("<html></html>", "x")).toBeNull();
  });

  it("parses a mixed site+element collection without treating elements as sites", () => {
    const parsed = parseCollectionPage(mixedHtml, "brutalism");
    expect(parsed).not.toBeNull();
    expect(parsed!.sites).toHaveLength(3);
    expect(parsed!.items).toBe(83);
    expect(parsed!.hasSiteMarkup).toBe(true);
  });

  it("parses an element-only collection as empty sites, not drift", () => {
    const parsed = parseCollectionPage(talksHtml, "talks");
    expect(parsed).not.toBeNull();
    expect(parsed!.title).toBe("TALKS AND INTERVIEWS");
    expect(parsed!.sites).toEqual([]);
    expect(parsed!.items).toBe(19);
    expect(parsed!.hasSiteMarkup).toBe(false);
  });

  it("normalizes curated/member slugs, including collections/<slug>", () => {
    expect(normalizeCollectionSlug("brutalism")).toMatchObject({
      slug: "brutalism",
      href: "/awwwards/collections/brutalism/",
      owner: "awwwards",
      ref: "brutalism",
      key: "awwwards/brutalism",
    });
    expect(normalizeCollectionSlug("awwwards/brutalism")).toMatchObject({
      slug: "brutalism",
      owner: "awwwards",
      href: "/awwwards/collections/brutalism/",
    });
    expect(normalizeCollectionSlug("collections/brutalism")).toMatchObject({
      slug: "brutalism",
      href: "/awwwards/collections/brutalism/",
      key: "awwwards/brutalism",
    });
    expect(normalizeCollectionSlug("Mixallo/collections/pastel-colors")).toMatchObject({
      slug: "pastel-colors",
      owner: "Mixallo",
      href: "/Mixallo/collections/pastel-colors/",
      ref: "Mixallo/pastel-colors",
      key: "Mixallo/pastel-colors",
    });
    expect(normalizeCollectionSlug("../etc")).toBeNull();
    expect(normalizeCollectionSlug("a/b/c/d")).toBeNull();
  });
});

describe("collections cache + blocks", () => {
  it("serves a fresh list from cache without a second fetch", async () => {
    const fetchFn = fixtureFetch();
    const d = deps(fetchFn);

    const miss = await getCollections(1, d);
    expect(miss.meta).toEqual({ cached: false });
    expect(miss.collections).toHaveLength(6);
    expect(String(fetchFn.mock.calls[0]![0])).toBe("https://www.awwwards.com/collections/");

    const hit = await getCollections(1, d);
    expect(hit.meta).toEqual({ cached: true });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("ignores legacy v1 list cache rows and writes v2", async () => {
    const fetchFn = fixtureFetch();
    const d = deps(fetchFn);
    d.cache.setMeta("collections:list:1", { collections: [], hasMore: false });

    const res = await getCollections(1, d);
    expect(res.collections).toHaveLength(6);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(d.cache.getMeta("collections:list:v2:1", Number.POSITIVE_INFINITY)).not.toBeNull();
  });

  it("fetches index page N with ?page=N and rejects pages past the live max", async () => {
    const fetchFn = fixtureFetch();
    await getCollections(3, deps(fetchFn));
    expect(String(fetchFn.mock.calls[0]![0])).toBe(
      "https://www.awwwards.com/collections/?page=3",
    );

    const noFetch = fixtureFetch();
    await expect(getCollections(COLLECTIONS_INDEX_MAX_PAGE + 1, deps(noFetch))).rejects.toThrow(
      /out of range/,
    );
    expect(noFetch).not.toHaveBeenCalled();
  });

  it("serves stale cache with a blocked flag after the 7-day TTL", async () => {
    let now = 1_800_000_000_000;
    const fetchFn = fixtureFetch();
    const d = deps(fetchFn, () => now);

    await getCollections(1, d);
    now += COLLECTIONS_TTL_MS + 1;
    fetchFn.mockImplementation(async () => new Response("blocked", { status: 403 }));

    const stale = await getCollections(1, d);
    expect(stale.collections).toHaveLength(6);
    expect(stale.meta).toMatchObject({ cached: true, stale: true, blocked: true });
    expect(stale.meta.error).toContain("blocking");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("throws BlockedError when a block has no stale cache", async () => {
    const fetchFn = vi.fn(async () => new Response("blocked", { status: 403 }));
    await expect(
      getCollections(1, {
        cache: new Cache(tmpDir()),
        fetchFn: fetchFn as unknown as typeof fetch,
        rateLimiter: new RateLimiter(0),
      }),
    ).rejects.toBeInstanceOf(BlockedError);
    expect(fetchFn).toHaveBeenCalledTimes(1); // 403 is never retried
  });

  it("rejects an empty index body instead of caching layout drift", async () => {
    const d = deps(vi.fn(async () => new Response("<html></html>")) as unknown as ReturnType<typeof fixtureFetch>);
    await expect(getCollections(1, d)).rejects.toThrow(/layout may have changed/);
    expect(d.cache.getMeta("collections:list:v2:1", Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("returns an element-only collection with empty sites and an honest note", async () => {
    const d = deps(fixtureFetch());
    const res = await getCollection("talks", 1, d);
    expect(res.sites).toEqual([]);
    expect(res.siteCards).toBe(0);
    expect(res.items).toBe(19);
    expect(res.note).toContain("no site cards");
    expect(res.note).toContain("19 element items");
  });

  it("returns explicit siteCards/items for a mixed collection", async () => {
    const fetchFn = vi.fn(async () => new Response(mixedHtml));
    const d: CollectionsDeps = {
      cache: new Cache(tmpDir()),
      fetchFn: fetchFn as unknown as typeof fetch,
      rateLimiter: new RateLimiter(0),
    };
    const res = await getCollection("brutalism", 1, d);
    expect(res.siteCards).toBe(3);
    expect(res.items).toBe(83);
    expect(res.owner).toBe("awwwards");
    expect(res.ref).toBe("brutalism");
    expect(res.note).toContain("Page 1:");
    expect(res.note).toContain("3 site cards");
    expect(res.note).toContain("83 items total");
    expect(res.note).not.toContain("80");
  });

  it("caches one collection page and serves it stale on a later block", async () => {
    let now = 1_800_000_000_000;
    const fetchFn = fixtureFetch();
    const d = deps(fetchFn, () => now);

    const first = await getCollection("brutalism", 1, d);
    expect(first.meta).toEqual({ cached: false });
    expect(first.sites).toHaveLength(6);
    expect(first.page).toBe(1);
    expect(String(fetchFn.mock.calls[0]![0])).toBe(
      "https://www.awwwards.com/awwwards/collections/brutalism/",
    );

    now += COLLECTIONS_TTL_MS + 1;
    fetchFn.mockImplementation(async () => new Response("blocked", { status: 429 }));
    const stale = await getCollection("brutalism", 1, d);
    expect(stale.meta).toMatchObject({ cached: true, stale: true, blocked: true });
    expect(stale.sites).toHaveLength(6);
  });

  it("supports page=N for a collection with page-separated cache keys", async () => {
    const fetchFn = fixtureFetch();
    const d = deps(fetchFn);

    const p1 = await getCollection("brutalism", 1, d);
    const p2 = await getCollection("brutalism", 2, d);
    expect(p1.page).toBe(1);
    expect(p2.page).toBe(2);
    expect(String(fetchFn.mock.calls[1]![0])).toBe(
      "https://www.awwwards.com/awwwards/collections/brutalism/?page=2",
    );

    const again = await getCollection("brutalism", 2, d);
    expect(again.meta).toEqual({ cached: true });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("fetches a member collection at its owner/collections path", async () => {
    const fetchFn = fixtureFetch();
    const d = deps(fetchFn);
    const res = await getCollection("Mixallo/collections/pastel-colors", 1, d);
    expect(res.slug).toBe("pastel-colors");
    expect(res.owner).toBe("Mixallo");
    expect(res.ref).toBe("Mixallo/pastel-colors");
    expect(String(fetchFn.mock.calls[0]![0])).toBe(
      "https://www.awwwards.com/Mixallo/collections/pastel-colors/",
    );
  });

  it("notes the requested page, not 'first page only'", async () => {
    const d = deps(fixtureFetch());
    const p2 = await getCollection("brutalism", 2, d);
    expect(p2.note).toContain("Page 2:");
    expect(p2.note).not.toContain("First page only");
  });

  it("turns a page-1 collection 404 into 'collection not found', not out of range", async () => {
    const fetchFn = vi.fn(async () => new Response("not found", { status: 404 }));
    const d: CollectionsDeps = {
      cache: new Cache(tmpDir()),
      fetchFn: fetchFn as unknown as typeof fetch,
      rateLimiter: new RateLimiter(0),
    };
    const err = await getCollection("missing", 1, d).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/collection not found/i);
    expect((err as Error).message).not.toMatch(/out of range/i);
  });

  it("turns a collection-page 404 on page > 1 into an out-of-range error", async () => {
    const fetchFn = vi.fn(async () => new Response("not found", { status: 404 }));
    const d: CollectionsDeps = {
      cache: new Cache(tmpDir()),
      fetchFn: fetchFn as unknown as typeof fetch,
      rateLimiter: new RateLimiter(0),
    };
    await expect(getCollection("brutalism", 9, d)).rejects.toThrow(/page 9.*out of range/i);
  });

  it("still rejects true parser drift when site markup exists but parses empty", async () => {
    const drift = `<html><body>
      <h1 class="heading-1 js-collection-name">DRIFT</h1>
      <p class="total-grid"><strong>7</strong> items.</p>
      <div class="grid-sites js-ajax-entries">
        data-collectable-model-value="{&quot;type&quot;:&quot;submission&quot;,&quot;slug&quot;:&quot;broken&quot;}"
      </div>
    </body></html>`;
    const fetchFn = vi.fn(async () => new Response(drift));
    const d: CollectionsDeps = {
      cache: new Cache(tmpDir()),
      fetchFn: fetchFn as unknown as typeof fetch,
      rateLimiter: new RateLimiter(0),
    };
    await expect(getCollection("drift", 1, d)).rejects.toThrow(/parser needs an update/);
  });
});

describe("get_collections handler", () => {
  const cache = () => new Cache(tmpDir());
  const client = () =>
    new AwwwardsClient({
      fetchFn: (async () => {
        throw new Error("handler tests must not fetch");
      }) as unknown as typeof fetch,
    });

  it("forwards list args and returns JSON", async () => {
    const fn = vi.fn(async () => ({
      collections: [{
        title: "Brutalism",
        slug: "brutalism",
        href: "/awwwards/collections/brutalism/",
        owner: "awwwards",
        ref: "brutalism",
      }],
      page: 2,
      hasMore: false,
      meta: { cached: false as const },
      note: "note",
    }));
    const h = createHandlers({ client: client(), cache: cache(), getCollectionsFn: fn });

    const res = await h.get_collections({ page: 2 });
    expect(fn).toHaveBeenCalledWith({ page: 2 });
    expect(res.isError).toBeUndefined();
    expect(JSON.parse((res.content[0] as { text: string }).text)).toMatchObject({
      page: 2,
      hasMore: false,
      collections: [{ slug: "brutalism", ref: "brutalism" }],
    });
  });

  it("forwards a slug lookup with page", async () => {
    const fn = vi.fn(async () => ({
      slug: "brutalism",
      title: "BRUTALISM",
      page: 2,
      sites: [],
      siteCards: 0,
      items: 83,
      meta: { cached: false as const },
      note: "note",
    }));
    const h = createHandlers({ client: client(), cache: cache(), getCollectionsFn: fn });
    await h.get_collections({ slug: "brutalism", page: 2 });
    expect(fn).toHaveBeenCalledWith({ slug: "brutalism", page: 2 });
  });

  it("turns a block into an isError response", async () => {
    const h = createHandlers({
      client: client(),
      cache: cache(),
      getCollectionsFn: async () => {
        throw new BlockedError("https://www.awwwards.com/collections/", 403);
      },
    });
    const res = await h.get_collections({});
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain("blocking requests");
  });
});
