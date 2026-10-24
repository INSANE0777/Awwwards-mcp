import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
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
  it("parses the index blobs, curated + member hrefs and pagination", () => {
    const parsed = parseCollectionsIndex(indexHtml, 1);
    expect(parsed).not.toBeNull();
    expect(parsed!.collections).toHaveLength(6);
    expect(parsed!.hasMore).toBe(true);

    const brutal = parsed!.collections.find((c) => c.slug === "brutalism");
    expect(brutal).toMatchObject({
      title: "Brutalism",
      href: "/awwwards/collections/brutalism/",
    });
    expect(brutal!.blurb).toBeUndefined();

    const member = parsed!.collections.find((c) => c.slug === "pastel-colors");
    expect(member).toMatchObject({
      title: "Pastel colors",
      href: "/Mixallo/collections/pastel-colors/",
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

  it("parses a collection page through parseListing and keeps the item total", () => {
    const parsed = parseCollectionPage(collectionHtml, "brutalism");
    expect(parsed).not.toBeNull();
    expect(parsed!.title).toBe("BRUTALISM");
    expect(parsed!.total).toBe(83);
    expect(parsed!.sites).toHaveLength(6);
    expect(parsed!.sites[0]).toMatchObject({
      slug: "work-by-10011",
      detailPath: "/sites/work-by-10011",
      liveUrl: "http://www.10011mag.co",
    });
    expect(parseCollectionPage("<html></html>", "x")).toBeNull();
  });

  it("normalizes curated/member slugs and rejects path injection", () => {
    expect(normalizeCollectionSlug("brutalism")).toEqual({
      slug: "brutalism",
      href: "/awwwards/collections/brutalism/",
      key: "awwwards/brutalism",
    });
    expect(normalizeCollectionSlug("Mixallo/collections/pastel-colors")).toEqual({
      slug: "pastel-colors",
      href: "/Mixallo/collections/pastel-colors/",
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

  it("fetches index page N with ?page=N", async () => {
    const fetchFn = fixtureFetch();
    await getCollections(3, deps(fetchFn));
    expect(String(fetchFn.mock.calls[0]![0])).toBe(
      "https://www.awwwards.com/collections/?page=3",
    );
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
    expect(d.cache.getMeta("collections:list:1", Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("caches one collection page and serves it stale on a later block", async () => {
    let now = 1_800_000_000_000;
    const fetchFn = fixtureFetch();
    const d = deps(fetchFn, () => now);

    const first = await getCollection("brutalism", d);
    expect(first.meta).toEqual({ cached: false });
    expect(first.sites).toHaveLength(6);
    expect(first.total).toBe(83);
    expect(String(fetchFn.mock.calls[0]![0])).toBe(
      "https://www.awwwards.com/awwwards/collections/brutalism/",
    );

    now += COLLECTIONS_TTL_MS + 1;
    fetchFn.mockImplementation(async () => new Response("blocked", { status: 429 }));
    const stale = await getCollection("brutalism", d);
    expect(stale.meta).toMatchObject({ cached: true, stale: true, blocked: true });
    expect(stale.sites).toHaveLength(6);
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
      collections: [{ title: "Brutalism", slug: "brutalism", href: "/awwwards/collections/brutalism/" }],
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
      collections: [{ slug: "brutalism" }],
    });
  });

  it("forwards a slug lookup", async () => {
    const fn = vi.fn(async () => ({
      slug: "brutalism",
      title: "BRUTALISM",
      sites: [],
      meta: { cached: false as const },
      note: "note",
    }));
    const h = createHandlers({ client: client(), cache: cache(), getCollectionsFn: fn });
    await h.get_collections({ slug: "brutalism" });
    expect(fn).toHaveBeenCalledWith({ slug: "brutalism" });
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
