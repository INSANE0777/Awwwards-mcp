import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildDirectoryPath,
  DIRECTORY_COUNTRIES,
  DIRECTORY_TTL_MS,
  parseDirectory,
  searchDirectory,
  stripPii,
  type DirectoryDeps,
} from "../src/directory.js";
import { AwwwardsClient, BlockedError, RateLimiter } from "../src/awwwards.js";
import { Cache } from "../src/cache.js";
import { createHandlers } from "../src/server.js";

const FIXTURES = join(__dirname, "fixtures", "sources");
const directoryHtml = readFileSync(join(FIXTURES, "directory.html"), "utf8");
const usHtml = readFileSync(join(FIXTURES, "directory-united-states.html"), "utf8");

const dirs: string[] = [];
const tmpDir = () => {
  const d = mkdtempSync(join(tmpdir(), "awwwards-directory-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function fixtureFetch() {
  return vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes("United%20States")) return new Response(usHtml);
    if (url.match(/\/directory\/(?:[^?]+\/)?(?:\?page=\d+)?$/)) return new Response(directoryHtml);
    throw new Error(`unexpected offline fetch: ${url}`);
  });
}

function deps(fetchFn: ReturnType<typeof fixtureFetch>, now: () => number = Date.now): DirectoryDeps {
  return {
    cache: new Cache(tmpDir(), now),
    fetchFn: fetchFn as unknown as typeof fetch,
    rateLimiter: new RateLimiter(0),
  };
}

describe("directory parser", () => {
  it("parses ordinary cards, skips the pro promo grid and keeps award counts", () => {
    const parsed = parseDirectory(directoryHtml, 1);
    expect(parsed).not.toBeNull();
    expect(parsed!.cards).toHaveLength(6);
    expect(parsed!.hasMore).toBe(true);
    expect(parsed!.cards[0]).toEqual({
      name: "Locomotive",
      slug: "locomotive",
      href: "/locomotive/",
      location: "Canada",
      website: "locomotive.ca",
      awardsCount: 229,
      awards: { hm: 132, sotd: 92, sotm: 4, soty: 1 },
      thumb: "https://assets.awwwards.com/awards/avatar/210282/63ed3bd6390c6148123811.jpg",
    });
    // The fixture contains one card-directory-sp promo card; it must not leak.
    expect(parsed!.cards.some((c) => c.slug === "isadoradigitalagency")).toBe(false);
  });

  it("parses the country-filtered page", () => {
    const parsed = parseDirectory(usHtml, 1);
    expect(parsed!.cards).toHaveLength(6);
    expect(new Set(parsed!.cards.map((c) => c.location))).toEqual(new Set(["United States"]));
    expect(parsed!.hasMore).toBe(true);
  });

  it("returns null for a non-directory body and [] for an empty grid", () => {
    expect(parseDirectory("")).toBeNull();
    expect(parseDirectory("<html><body>drift</body></html>")).toBeNull();
    expect(parseDirectory('<ul class="grid-cards js-ajax-entries"></ul>')).toEqual({
      cards: [],
      hasMore: false,
    });
  });
});

describe("directory country canonicalization", () => {
  it("ships the live canonical country list", () => {
    expect(DIRECTORY_COUNTRIES.length).toBe(82);
    expect(DIRECTORY_COUNTRIES).toContain("United States");
    expect(DIRECTORY_COUNTRIES).toContain("Réunion");
    expect(DIRECTORY_COUNTRIES).toContain("Hong Kong - Macau");
  });

  it("accepts a canonical country and builds its path", () => {
    expect(buildDirectoryPath({ country: "United States" })).toMatchObject({
      path: "/directory/United%20States/",
      applied: [{ kind: "country", value: "United States" }],
      ignored: [],
    });
  });

  it("rejects lowercase, hyphenated and unknown countries with examples", () => {
    expect(() => buildDirectoryPath({ country: "united states" })).toThrow(
      /Unknown directory country: united states\..*United States/,
    );
    expect(() => buildDirectoryPath({ country: "united-states" })).toThrow(
      /Unknown directory country/,
    );
    expect(() => buildDirectoryPath({ country: "Atlantis" })).toThrow(
      /Unknown directory country: Atlantis\..*Canada/,
    );
    expect(() => buildDirectoryPath({ country: "../../etc" })).toThrow(
      /Invalid directory country/,
    );
  });

  it("never falls back to a wrong-country page", async () => {
    const fetchFn = fixtureFetch();
    const d = deps(fetchFn);
    await expect(searchDirectory({ country: "united states" }, d)).rejects.toThrow(
      /Unknown directory country/,
    );
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("directory filters + PII", () => {
  it("builds one path filter with page and machine-readable applied/ignored arrays", () => {
    expect(buildDirectoryPath({ budget: "Over $100,000" })).toMatchObject({
      path: "/directory/over_hundred_thousand/",
      applied: [{ kind: "budget", value: "over_hundred_thousand" }],
      ignored: [],
    });
    expect(buildDirectoryPath({ category: "App Development", page: 2 }).path).toBe(
      "/directory/app-development/?page=2",
    );
    expect(buildDirectoryPath({ country: "United States", category: "web-design" })).toMatchObject({
      path: "/directory/United%20States/",
      applied: [{ kind: "country", value: "United States" }],
      ignored: [{ kind: "category", value: "web-design" }],
    });
  });

  it("rejects unknown filters", () => {
    expect(() => buildDirectoryPath({ category: "not-a-category" })).toThrow(/Unknown directory category/);
    expect(() => buildDirectoryPath({ budget: "cheap" })).toThrow(/Unknown directory budget/);
  });

  it("strips emails and phones with separators but keeps digit-heavy domains", () => {
    expect(stripPii("Jane +1 (555) 123-4567 jane@example.com")).toBe("Jane");
    expect(stripPii("studio123456789.com")).toBe("studio123456789.com");
    expect(stripPii("United States")).toBe("United States");
    expect(stripPii("2026 awards")).toBe("2026 awards");
  });

  it("never emits contact PII from a card", () => {
    const html = `<div class="grid-cards js-ajax-entries">
      <div class="card-directory">
        <div class="card-directory__cover"><a href="/jane/"><img class="card-directory__media" src="https://assets.awwwards.com/a.jpg"></a></div>
        <figcaption class="avatar-name__name"><strong>Jane jane@example.com</strong></figcaption>
        <div class="card-directory__section"><strong>Location</strong></div>
        <div>+1 (555) 123-4567</div>
      </div>
    </div>`;
    const parsed = parseDirectory(html, 1)!;
    expect(parsed.cards[0]!.name).toBe("Jane");
    expect(parsed.cards[0]!.location).toBeUndefined();
    const json = JSON.stringify(parsed.cards);
    expect(json).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    expect(json).not.toMatch(/\+?\d[\d\s().-]{7,}\d/);
  });
});

describe("directory cache + blocks", () => {
  it("serves a fresh page from cache and fetches the filtered path once", async () => {
    const fetchFn = fixtureFetch();
    const d = deps(fetchFn);

    const miss = await searchDirectory({ country: "United States", page: 2 }, d);
    expect(miss.meta).toEqual({ cached: false });
    expect(miss.cards).toHaveLength(6);
    expect(String(fetchFn.mock.calls[0]![0])).toBe(
      "https://www.awwwards.com/directory/United%20States/?page=2",
    );

    const hit = await searchDirectory({ country: "United States", page: 2 }, d);
    expect(hit.meta).toEqual({ cached: true });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("exposes applied/ignored arrays on results", async () => {
    const d = deps(fixtureFetch());
    const res = await searchDirectory({ country: "United States", category: "web-design" }, d);
    expect(res.applied).toEqual([{ kind: "country", value: "United States" }]);
    expect(res.ignored).toEqual([{ kind: "category", value: "web-design" }]);
    expect(res.filteredClientSide).toBe(false);
    expect(res.note).toContain("ignored category");
  });

  it("filters query client-side over the fetched page", async () => {
    const fetchFn = fixtureFetch();
    const d = deps(fetchFn);

    const all = await searchDirectory({}, d);
    expect(all.cards).toHaveLength(6);
    expect(all.filteredClientSide).toBe(false);
    expect(all.applied).toEqual([]);
    expect(all.ignored).toEqual([]);

    const one = await searchDirectory({ query: "Locomotive" }, d);
    expect(one.cards.map((c) => c.slug)).toEqual(["locomotive"]);
    expect(one.filteredClientSide).toBe(true);
    expect(one.note).toContain("client-side");

    const none = await searchDirectory({ query: "zzz" }, d);
    expect(none.cards).toEqual([]);
    expect(none.filteredClientSide).toBe(true);
  });

  it("serves stale cache with a blocked flag after the 7-day TTL", async () => {
    let now = 1_800_000_000_000;
    const fetchFn = fixtureFetch();
    const d = deps(fetchFn, () => now);

    await searchDirectory({}, d);
    now += DIRECTORY_TTL_MS + 1;
    fetchFn.mockImplementation(async () => new Response("blocked", { status: 403 }));

    const stale = await searchDirectory({}, d);
    expect(stale.cards).toHaveLength(6);
    expect(stale.meta).toMatchObject({ cached: true, stale: true, blocked: true });
    expect(stale.meta.error).toContain("blocking");
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("throws BlockedError when a block has no stale cache", async () => {
    const fetchFn = vi.fn(async () => new Response("blocked", { status: 429 }));
    await expect(
      searchDirectory({}, {
        cache: new Cache(tmpDir()),
        fetchFn: fetchFn as unknown as typeof fetch,
        rateLimiter: new RateLimiter(0),
      }),
    ).rejects.toBeInstanceOf(BlockedError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty body instead of caching layout drift", async () => {
    const fetchFn = vi.fn(async () => new Response("<html></html>"));
    const d: DirectoryDeps = {
      cache: new Cache(tmpDir()),
      fetchFn: fetchFn as unknown as typeof fetch,
      rateLimiter: new RateLimiter(0),
    };
    await expect(searchDirectory({}, d)).rejects.toThrow(/layout may have changed/);
    expect(d.cache.getMeta("directory:all:1", Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("search_directory handler", () => {
  const cache = () => new Cache(tmpDir());
  const client = () =>
    new AwwwardsClient({
      fetchFn: (async () => {
        throw new Error("handler tests must not fetch");
      }) as unknown as typeof fetch,
    });

  it("forwards args and returns JSON", async () => {
    const fn = vi.fn(async () => ({
      cards: [{ name: "Locomotive", slug: "locomotive", href: "/locomotive/" }],
      page: 1,
      hasMore: false,
      filteredClientSide: true,
      applied: [],
      ignored: [],
      meta: { cached: false as const },
      note: "note",
    }));
    const h = createHandlers({ client: client(), cache: cache(), searchDirectoryFn: fn });

    const res = await h.search_directory({ query: "loco", country: "Canada", page: 2 });
    expect(fn).toHaveBeenCalledWith({ query: "loco", country: "Canada", page: 2 });
    expect(res.isError).toBeUndefined();
    expect(JSON.parse((res.content[0] as { text: string }).text)).toMatchObject({
      cards: [{ slug: "locomotive" }],
      filteredClientSide: true,
      applied: [],
      ignored: [],
    });
  });

  it("turns a block into an isError response", async () => {
    const h = createHandlers({
      client: client(),
      cache: cache(),
      searchDirectoryFn: async () => {
        throw new BlockedError("https://www.awwwards.com/directory/", 429);
      },
    });
    const res = await h.search_directory({});
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain("blocking requests");
  });
});
