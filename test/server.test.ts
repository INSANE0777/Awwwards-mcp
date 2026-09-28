import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHandlers, slugifyTag, suggestTags, tokenizeQuery } from "../src/server.js";
import { AwwwardsClient, RateLimiter } from "../src/awwwards.js";
import { Cache } from "../src/cache.js";
import { INDEX_LOCK_STALE_MS, INDEX_STALE_MS } from "../src/indexer.js";
import type { ElementRecord, SiteSummary } from "../src/types.js";

const FIXTURES = join(__dirname, "fixtures");
const listingHtml = readFileSync(join(FIXTURES, "listing.html"), "utf8");

const dirs: string[] = [];
const tmpDir = () => {
  const d = mkdtempSync(join(tmpdir(), "awwwards-srv-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function site(overrides: Partial<SiteSummary> = {}): SiteSummary {
  return {
    id: 1, slug: "s1", title: "Cool Studio", createdAt: 1789516800,
    tags: ["WebGL", "3D"], thumbnailPath: "submissions/2026/08/abc.jpg",
    liveUrl: "https://example.com", detailPath: "/sites/s1",
    awards: ["Site of the Day"], ...overrides,
  };
}

// Client whose fake fetch serves fixture pages; every call is recorded.
function fakeClient() {
  const fetchFn = vi.fn(async (input: any) => {
    const url = String(input);
    if (url.includes("/sites/l-i-s-a")) {
      return new Response(readFileSync(join(FIXTURES, "detail.html"), "utf8"), { status: 200 });
    }
    return new Response(listingHtml, { status: 200 });
  });
  const client = new AwwwardsClient({ fetchFn: fetchFn as unknown as typeof fetch });
  return { client, fetchFn };
}

// Synthetic detail page with n element blobs in the fixture's attribute
// encoding: JSON with `\/` slashes and double quotes entity-escaped, so the
// blob ends at the first raw `">` — exactly what parseElements expects.
function elementsPage(n: number): string {
  const names = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
  const blob = (title: string, mediaPath: string) =>
    JSON.stringify({ collectableTitle: title, collectableImage: mediaPath })
      .replace(/\//g, "\\/")
      .replace(/"/g, "&quot;");
  const items = Array.from(
    { length: n },
    (_, i) =>
      `<div data-collectable-model-value="${blob(
        `Element ${names[i]}`,
        `element/2026/08/el${i + 1}.${i % 2 === 0 ? "mp4" : "jpg"}`,
      )}"></div>`,
  ).join("\n");
  return `<h2>Elements</h2>${items}<h2>Color Palette</h2>`;
}

describe("slugifyTag", () => {
  it("normalizes site tags to filter slugs", () => {
    expect(slugifyTag("Content architecture")).toBe("content-architecture");
    expect(slugifyTag("3D")).toBe("3d");
    expect(slugifyTag("WebGL")).toBe("webgl");
  });
});

describe("search_sites", () => {
  it("keeps full by default and limits compact previews without hiding cards", async () => {
    const cache = new Cache(tmpDir());
    cache.upsertSites(Array.from({ length: 8 }, (_, i) => site({
      slug: `compact-${i}`, title: `Studio ${i}`, createdAt: 1789516800 - i,
      tags: ["WebGL", "3D", "Portfolio", "Animation"],
      thumbnailPath: `submissions/compact-${i}.jpg`,
    })));
    const { client, fetchFn } = fakeClient();
    const thumbnail = vi.spyOn(client, "getThumbnail").mockResolvedValue(Buffer.from("jpeg"));
    const h = createHandlers({ client, cache });
    const compact = await h.search_sites({ tags: ["webgl"], count: 6, responseMode: "compact" });
    const body = (compact.content[0] as { type: "text"; text: string }).text;
    expect(body).toContain("8 site(s) matched; showing 1-6");
    for (let i = 0; i < 6; i++) expect(body).toContain(`${i + 1}. Studio ${i} (slug: compact-${i})`);
    expect(body).toContain("WebGL, 3D, Portfolio +1");
    expect(compact.content.filter((block) => block.type === "image")).toHaveLength(2);
    expect(compact.content.slice(1).filter((block) => block.type === "text")
      .map((block) => (block as { type: "text"; text: string }).text))
      .toEqual(["Preview #1: compact-0", "Preview #2: compact-1"]);
    expect(thumbnail.mock.calls.map(([path]) => path)).toEqual([
      "submissions/compact-0.jpg", "submissions/compact-1.jpg",
    ]);
    expect(fetchFn).not.toHaveBeenCalled();

    const full = await h.search_sites({ tags: ["webgl"], count: 6 });
    expect(full.content).toEqual([
      { type: "text", text: "8 site(s) matched; showing 1-6:\n\n" +
        Array.from({ length: 6 }, (_, i) =>
          `- Studio ${i} (slug: compact-${i}) [Site of the Day]\n` +
          "  live: https://example.com\n" +
          "  awwwards: https://www.awwwards.com/sites/s1\n" +
          "  tags: WebGL, 3D, Portfolio, Animation",
        ).join("\n\n"),
      },
      ...Array.from({ length: 6 }, () => ({
        type: "image", data: Buffer.from("jpeg").toString("base64"), mimeType: "image/jpeg",
      })),
    ]);
  });

  it("keeps untrusted multiline metadata on one compact card line", async () => {
    const cache = new Cache(tmpDir());
    cache.upsertSites([
      site({
        slug: "unsafe", title: "Studio\n2. Forged\tTitle", createdAt: 1789516801,
        liveUrl: "https://example.com/\n3. forged", awards: ["Site\r\nof the Day"],
        tags: ["Web\nGL", "3D\tMotion"], thumbnailPath: "submissions/unsafe.jpg",
      }),
      site({ slug: "real", title: "Real Studio", createdAt: 1789516800,
        thumbnailPath: "submissions/real.jpg" }),
    ]);
    const { client } = fakeClient();
    vi.spyOn(client, "getThumbnail").mockResolvedValue(Buffer.from("jpeg"));
    const h = createHandlers({ client, cache });
    const compact = await h.search_sites({ count: 2, responseMode: "compact" });
    expect((compact.content[0] as { type: "text"; text: string }).text).toBe(
      "2 site(s) matched; showing 1-2:\n\n" +
      "1. Studio 2. Forged Title (slug: unsafe) | live: https://example.com/ 3. forged | " +
      "awards: Site of the Day | tags: Web GL, 3D Motion\n" +
      "2. Real Studio (slug: real) | live: https://example.com | " +
      "awards: Site of the Day | tags: WebGL, 3D",
    );
    const full = await h.search_sites({ count: 2 });
    expect((full.content[0] as { type: "text"; text: string }).text)
      .toContain("- Studio\n2. Forged\tTitle (slug: unsafe) [Site\r\nof the Day]");
  });

  it("previews the selected score-sorted page, not page one", async () => {
    const cache = new Cache(tmpDir());
    cache.upsertSites(Array.from({ length: 8 }, (_, i) => site({
      slug: `rank-${i}`, createdAt: 1789516800 + i,
      thumbnailPath: `submissions/rank-${i}.jpg`,
    })));
    for (let i = 0; i < 8; i++) cache.setMeta(`detail:rank-${i}`, { score: i });
    const { client, fetchFn } = fakeClient();
    const thumbnail = vi.spyOn(client, "getThumbnail").mockResolvedValue(Buffer.from("jpeg"));
    const res = await createHandlers({ client, cache }).search_sites({
      count: 3, page: 2, sortBy: "score", responseMode: "compact",
    });
    const body = (res.content[0] as { type: "text"; text: string }).text;
    expect(body).toContain("showing 4-6");
    expect(body).toContain("4. Cool Studio (slug: rank-4)");
    expect(res.content.filter((block) => block.type === "image")).toHaveLength(2);
    expect(thumbnail.mock.calls.map(([path]) => path)).toEqual([
      "submissions/rank-4.jpg", "submissions/rank-3.jpg",
    ]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("keeps the second card when its first preview fails", async () => {
    const cache = new Cache(tmpDir());
    cache.upsertSites([site({ slug: "first", createdAt: 1789516801, thumbnailPath: "submissions/first.jpg" }),
      site({ slug: "second", createdAt: 1789516800, thumbnailPath: "submissions/second.jpg" })]);
    const { client } = fakeClient();
    vi.spyOn(client, "getThumbnail").mockImplementation(async (path) => {
      if (path === "submissions/first.jpg") throw new Error("CDN unavailable");
      return Buffer.from("jpeg");
    });
    const res = await createHandlers({ client, cache }).search_sites({ count: 2, responseMode: "compact" });
    const body = (res.content[0] as { type: "text"; text: string }).text;
    expect(body).toContain("1. Cool Studio (slug: first)");
    expect(body).toContain("2. Cool Studio (slug: second)");
    expect(res.content.slice(1).filter((block) => block.type === "text")
      .map((block) => (block as { type: "text"; text: string }).text))
      .toEqual(["Preview #2: second"]);
    expect(res.content.filter((block) => block.type === "image")).toHaveLength(1);
  });

  it("supports a single compact match", async () => {
    const cache = new Cache(tmpDir());
    cache.upsertSites([site({ slug: "single" })]);
    const { client } = fakeClient();
    vi.spyOn(client, "getThumbnail").mockResolvedValue(Buffer.from("jpeg"));
    const res = await createHandlers({ client, cache }).search_sites({ count: 1, responseMode: "compact" });
    expect((res.content[0] as { type: "text"; text: string }).text).toContain("1. Cool Studio (slug: single)");
    expect(res.content.filter((block) => block.type === "image")).toHaveLength(1);
  });

  it("keeps zero-result guidance unchanged in compact mode", async () => {
    const cache = new Cache(tmpDir());
    const { client } = fakeClient();
    const h = createHandlers({ client, cache });
    const full = await h.search_sites({ query: "unfindabletopicword" });
    const compact = await h.search_sites({ query: "unfindabletopicword", responseMode: "compact" });
    expect((compact.content[0] as { type: "text"; text: string }).text)
      .toContain("No sites matched the search");
    expect(compact.content).toEqual(full.content);
    expect(compact.content.filter((block) => block.type === "image")).toHaveLength(0);
  });

  it("serves matching fresh cache without any network call", async () => {
    const cache = new Cache(tmpDir());
    cache.upsertSites(Array.from({ length: 8 }, (_, i) => site({ slug: `s${i + 1}` })));
    const { client, fetchFn } = fakeClient();
    const h = createHandlers({ client, cache });
    const res = await h.search_sites({ tags: ["webgl"], count: 6 });
    const pageCalls = fetchFn.mock.calls.filter((c: any[]) =>
      String(c[0]).includes("/websites/") || String(c[0]).includes("/sites/"),
    );
    expect(pageCalls.length).toBe(0);
    const text = res.content[0] as any;
    expect(text.type).toBe("text");
    expect(text.text).toContain("s1");
    expect(text.text).toContain("https://example.com");
  });

  it("scrapes when the cache cannot satisfy the filters, then caches", async () => {
    const cache = new Cache(tmpDir());
    const { client, fetchFn } = fakeClient();
    const h = createHandlers({ client, cache });
    const res = await h.search_sites({ technology: "webgl", count: 3 });
    expect(String(fetchFn.mock.calls[0][0])).toContain("/websites/webgl/");
    expect(res.content.filter((b: any) => b.type === "image").length).toBe(3);
    expect(cache.getSites(10_000).length).toBeGreaterThan(0);
  });

  it("applies the free-text query client-side", async () => {
    const cache = new Cache(tmpDir());
    // 7 matching rows ≥ count → cache-serve path; the "Boring Corp" row
    // (upserted over s2) carries a NEWER createdAt, so without the query
    // check it would sort first into the served window — its absence proves
    // the query filter excluded it, not the count-6 pagination slice.
    cache.upsertSites([
      ...Array.from({ length: 8 }, (_, i) => site({ slug: `s${i + 1}` })),
      site({ slug: "s2", title: "Boring Corp", tags: [], createdAt: 1789516800 + 60 }),
    ]);
    const { client } = fakeClient();
    const h = createHandlers({ client, cache });
    const res = await h.search_sites({ query: "cool", count: 6 });
    expect((res.content[0] as any).text).toContain("s1");
    expect((res.content[0] as any).text).not.toContain("s2");
  });

  it("paginates with page and count", async () => {
    const cache = new Cache(tmpDir());
    cache.upsertSites(Array.from({ length: 8 }, (_, i) => site({ slug: `s${i + 1}` })));
    const { client } = fakeClient();
    const h = createHandlers({ client, cache });
    const p1 = await h.search_sites({ count: 3, page: 1 });
    const p2 = await h.search_sites({ count: 3, page: 2 });
    expect((p1.content[0] as any).text).toContain("s1");
    expect((p2.content[0] as any).text).toContain("s4");
    expect(p1.content.filter((b: any) => b.type === "image").length).toBe(3);
  });

  it("falls back to stale cache when the live request fails", async () => {
    const cache = new Cache(tmpDir());
    cache.upsertSites([site(), site({ slug: "s2" })]);
    const client = new AwwwardsClient({
      fetchFn: vi.fn(async () => {
        throw new Error("ECONNRESET");
      }) as unknown as typeof fetch,
    });
    const h = createHandlers({ client, cache });
    // 2 fresh sites < count*page (12*2) → scrape attempt fails → stale cache served
    const res = await h.search_sites({ count: 12, page: 2 });
    const text = (res.content[0] as any).text;
    expect(text).toContain("stale");
    expect(text).toContain("s1");
    expect(res.isError).toBeUndefined();
  });

  it("keeps the stale warning but inlines only two compact fallback images", async () => {
    const cache = new Cache(tmpDir());
    cache.upsertSites(Array.from({ length: 4 }, (_, i) => site({
      slug: `stale-${i}`, createdAt: 1789516800 - i,
      thumbnailPath: `submissions/stale-${i}.jpg`,
    })));
    const client = new AwwwardsClient({
      fetchFn: vi.fn(async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch,
      rateLimiter: new RateLimiter(0),
    });
    const thumbnail = vi.spyOn(client, "getThumbnail").mockResolvedValue(Buffer.from("jpeg"));
    const res = await createHandlers({ client, cache }).search_sites({
      count: 6, page: 2, responseMode: "compact",
    });
    expect(res.isError).toBeUndefined();
    const body = (res.content[0] as { type: "text"; text: string }).text;
    expect(body).toContain("Serving 4 result(s) from stale cache instead:");
    expect(body).toContain("(slug: stale-3)");
    expect(res.content.slice(1).filter((block) => block.type === "text")
      .map((block) => (block as { type: "text"; text: string }).text))
      .toEqual(["Preview #1: stale-0", "Preview #2: stale-1"]);
    expect(res.content.filter((block) => block.type === "image")).toHaveLength(2);
    expect(thumbnail.mock.calls.map(([path]) => path)).toEqual([
      "submissions/stale-0.jpg", "submissions/stale-1.jpg",
    ]);
  });

  it("keeps a partially filled compact page when its top-up fails", async () => {
    const cache = new Cache(tmpDir());
    cache.upsertSites(Array.from({ length: 4 }, (_, i) => site({
      slug: `partial-${i}`, createdAt: 1789516800 - i,
      thumbnailPath: `submissions/partial-${i}.jpg`,
    })));
    const client = new AwwwardsClient({
      fetchFn: vi.fn(async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch,
      rateLimiter: new RateLimiter(0),
    });
    const thumbnail = vi.spyOn(client, "getThumbnail").mockResolvedValue(Buffer.from("jpeg"));
    const res = await createHandlers({ client, cache }).search_sites({
      count: 3, page: 2, responseMode: "compact",
    });
    const body = (res.content[0] as { type: "text"; text: string }).text;
    expect(body).toContain("4 site(s) matched; showing 4-4:");
    expect(body).toContain("4. Cool Studio (slug: partial-3)");
    expect(body).not.toContain("stale cache instead");
    expect(thumbnail.mock.calls.map(([path]) => path)).toEqual(["submissions/partial-3.jpg"]);
  });

  it("client-checks the technology filter when serving from cache", async () => {
    const cache = new Cache(tmpDir());
    cache.upsertSites(Array.from({ length: 8 }, (_, i) => site({ slug: `t${i + 1}`, tags: ["3D"] })));
    const { client, fetchFn } = fakeClient();
    const h = createHandlers({ client, cache });
    const res = await h.search_sites({ technology: "webgl", count: 6 });
    const text = (res.content[0] as any).text;
    // v1 bug: 8 rows ≥ count → served unfiltered with zero fetches. Fixed: the
    // zero cache matches force a scrape of /websites/webgl/, and results come
    // from that page.
    expect(String(fetchFn.mock.calls[0][0])).toContain("/websites/webgl/");
    expect(text).not.toContain("8 site(s) matched");
    expect(res.content.filter((b: any) => b.type === "image").length).toBe(6);
  });

  it("never serves a color search from cache", async () => {
    const cache = new Cache(tmpDir());
    cache.upsertSites(Array.from({ length: 8 }, (_, i) => site({ slug: `c${i + 1}` })));
    const { client, fetchFn } = fakeClient();
    const h = createHandlers({ client, cache });
    const res = await h.search_sites({ color: "#404040", count: 6 });
    expect(String(fetchFn.mock.calls[0][0])).toContain("%23404040");
    expect(res.content.filter((b: any) => b.type === "image").length).toBe(6);
  });

  it("scrapes the color page and filters fresh rows by award", async () => {
    const cache = new Cache(tmpDir());
    cache.upsertSites([
      ...Array.from({ length: 8 }, (_, i) =>
        site({ slug: `a${i + 1}`, awards: ["Site of the Day"] })),
      site({ slug: "plain", awards: [] }),
    ]);
    const { client, fetchFn } = fakeClient();
    const h = createHandlers({ client, cache });
    // Color can't be verified client-side, so the search scrapes the color
    // page (color wins the URL); award is NOT the URL source, so it is still
    // client-checked against the freshly parsed rows.
    const res = await h.search_sites({ color: "#404040", award: "sotd", count: 6 });
    expect(String(fetchFn.mock.calls[0][0])).toContain("%23404040");
    const text = (res.content[0] as any).text;
    expect(res.content.filter((b: any) => b.type === "image").length).toBe(6);
  });

  it("client-checks the award filter when serving from cache", async () => {
    const cache = new Cache(tmpDir());
    cache.upsertSites([
      ...Array.from({ length: 8 }, (_, i) =>
        site({ slug: `w${i + 1}`, awards: ["Site of the Day"], createdAt: 1789516800 + i })),
      site({ slug: "plain", awards: [], createdAt: 1789516800 + 100 }),
    ]);
    const { client, fetchFn } = fakeClient();
    const h = createHandlers({ client, cache });
    const res = await h.search_sites({ award: "sotd", count: 6 });
    const text = (res.content[0] as any).text;
    expect(text).toContain("8 site(s) matched");
    expect(text).not.toContain("plain");
    const pageCalls = fetchFn.mock.calls.filter((c: any[]) =>
      String(c[0]).includes("/websites/") || String(c[0]).includes("/sites/"));
    expect(pageCalls.length).toBe(0);
  });
});

describe("search_sites error hardening", () => {
  it("returns isError instead of throwing when the cache store is broken", async () => {
    const cache = new Cache(tmpDir());
    const { client } = fakeClient();
    const h = createHandlers({ client, cache });
    (cache as any).getSites = () => {
      throw new Error("corrupt db");
    };
    (cache as any).upsertSites = () => {};
    const res = await h.search_sites({ tags: ["3d"], count: 6 });
    expect(res.isError).toBe(true);
  });
});

describe("get_site_details", () => {
  it("scrapes the detail page and returns palette + technologies", async () => {
    const cache = new Cache(tmpDir());
    const { client } = fakeClient();
    const h = createHandlers({ client, cache });
    const res = await h.get_site_details({ slug: "l-i-s-a" });
    const text = (res.content[0] as any).text;
    expect(text).toContain("#"); // a palette hex
    expect(text).toContain("WebGL");
    expect(text).toContain("lisa.locomotive.ca");
  });

  it("includes the jury score line when present", async () => {
    const cache = new Cache(tmpDir());
    const { client } = fakeClient();
    const h = createHandlers({ client, cache });
    const res = await h.get_site_details({ slug: "l-i-s-a" });
    // the l-i-s-a fixture (detail.html) has a c-heading-score block
    expect((res.content[0] as any).text).toMatch(/Jury score: \d\.\d{1,2}\/10/);
  });
});

describe("compare_sites", () => {
  it("compares cached details and summary fallbacks without any HTTP or CDN requests", async () => {
    const cache = new Cache(tmpDir());
    cache.upsertSites([site({ slug: "first", title: "Fallback title", liveUrl: "https://fallback.test", awards: ["Site of the Day"] })]);
    const base = {
      title: null, description: null, palette: ["#123456"], technologies: ["WebGL"],
      elements: ["3D"], awards: [], score: 7.5, ogImage: null, liveUrl: null,
    };
    cache.setMeta("detail:first", { ...base, slug: "first", juryDimensions: { design: 8, usability: 7, creativity: 9, content: 6 } });
    cache.setMeta("detail:second", { ...base, slug: "second", title: "Second", liveUrl: "https://second.test", awards: [{ title: "Developer Award", date: "2026-09-01" }] });
    cache.setMeta("detail:third", { ...base, slug: "third", title: "Third", score: null });
    const { client, fetchFn } = fakeClient();
    const res = await createHandlers({ client, cache }).compare_sites({ slugs: ["first", "second", "third"] });
    expect(res.isError).toBeUndefined();
    expect(res.content).toHaveLength(1);
    const { sites } = JSON.parse((res.content[0] as any).text);
    expect(sites.map((s: any) => s.slug)).toEqual(["first", "second", "third"]);
    expect(sites[0]).toMatchObject({
      title: "Fallback title", liveUrl: "https://fallback.test", palette: ["#123456"],
      technologies: ["WebGL"], elements: ["3D"], awards: [{ title: "Site of the Day", date: "" }],
      score: 7.5, juryDimensions: { design: 8, usability: 7, creativity: 9, content: 6 },
    });
    expect(sites[1]).toMatchObject({ title: "Second", liveUrl: "https://second.test", awards: [{ title: "Developer Award", date: "2026-09-01" }] });
    expect(sites[2].juryDimensions).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("fetches only missing details from /sites/{slug}, seeds elements, then serves cache", async () => {
    const cache = new Cache(tmpDir());
    cache.setMeta("detail:cached", {
      slug: "cached", title: "Cached", description: "hello", palette: [], technologies: [],
      elements: [], awards: [], score: null, ogImage: null, liveUrl: null,
    });
    const { client, fetchFn } = fakeClient();
    const h = createHandlers({ client, cache });
    const first = await h.compare_sites({ slugs: ["cached", "l-i-s-a"] });
    expect(first.isError).toBeUndefined();
    const { sites } = JSON.parse((first.content[0] as any).text);
    expect(sites[1].palette.length).toBeGreaterThan(0);
    expect(sites[1].technologies).toContain("WebGL");
    expect(sites[1].score).toBeGreaterThan(0);
    expect(cache.getMeta<any[]>("elements:l-i-s-a", SITE_TTL)).not.toBeNull();
    await h.compare_sites({ slugs: ["l-i-s-a", "cached"] });
    await h.get_site_details({ slug: "l-i-s-a" });
    expect(fetchFn.mock.calls.map((call: any[]) => String(call[0]))).toEqual(["https://www.awwwards.com/sites/l-i-s-a"]);
  });

  it("fetches each missing slug once and shares parsed details with get_site_details", async () => {
    const cache = new Cache(tmpDir());
    const html = readFileSync(join(FIXTURES, "detail.html"), "utf8");
    const fetchFn = vi.fn(async () => new Response(html, { status: 200 }));
    const client = new AwwwardsClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const h = createHandlers({ client, cache });
    const res = await h.compare_sites({ slugs: ["one", "two"] });
    expect(res.isError).toBeUndefined();
    expect(JSON.parse((res.content[0] as any).text).sites).toHaveLength(2);
    await h.get_site_details({ slug: "one" });
    await h.compare_sites({ slugs: ["two", "one"] });
    expect(fetchFn.mock.calls.map((call: any[]) => String(call[0]))).toEqual([
      "https://www.awwwards.com/sites/one", "https://www.awwwards.com/sites/two",
    ]);
  });

  it("rejects invalid counts, duplicates and unsafe slugs before accessing cache or network", async () => {
    const cache = new Cache(tmpDir());
    const { client, fetchFn } = fakeClient();
    const h = createHandlers({ client, cache });
    for (const slugs of [["one"], ["a", "b", "c", "d"], ["a", "A"], ["good", "../bad"], ["good", "bad?x=1"], ["good", ""]]) {
      const res = await h.compare_sites({ slugs });
      expect(res.isError).toBe(true);
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("reports an all-empty parse without caching it or fetching images", async () => {
    const cache = new Cache(tmpDir());
    const fetchFn = vi.fn(async () => new Response("<html>layout drift</html>", { status: 200 }));
    const client = new AwwwardsClient({ fetchFn: fetchFn as unknown as typeof fetch });
    cache.setMeta("detail:cached", { slug: "cached", title: "Cached", description: "ok", palette: [], technologies: [], elements: [], awards: [], score: null, ogImage: null, liveUrl: null });
    const res = await createHandlers({ client, cache }).compare_sites({ slugs: ["cached", "broken"] });
    expect(res.isError).toBe(true);
    expect((res.content[0] as any).text).toContain("broken");
    expect(cache.getMeta("detail:broken", SITE_TTL)).toBeNull();
    expect(cache.getMeta("elements:broken", SITE_TTL)).toBeNull();
    expect(fetchFn.mock.calls.map((call: any[]) => String(call[0]))).toEqual(["https://www.awwwards.com/sites/broken"]);
  });
});

const SITE_TTL = 7 * 24 * 60 * 60 * 1000;

describe("get_index_status", () => {
  it("reports a never-indexed cache without any network calls", async () => {
    const cache = new Cache(tmpDir());
    const { client, fetchFn } = fakeClient();
    const res = await createHandlers({ client, cache }).get_index_status();
    expect(res.isError).toBeUndefined();
    expect(JSON.parse((res.content[0] as any).text)).toEqual({
      sitesCount: 0, progress: { pagesDone: 0, pagesTotal: 0 },
      lastSuccessfulFinishAt: null, lastError: null,
      lock: { startedAt: null, active: false, stale: false },
      indexFreshness: { stale: true, ageMs: null, staleAfterMs: INDEX_STALE_MS },
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("shows cached taxonomy total during the first crawl before status exists", async () => {
    const cache = new Cache(tmpDir());
    cache.setMeta("categories", { colors: [], filters: ["3d", "webgl", "studio"] });
    cache.setMeta("index:progress", ["3d"]);
    cache.setMeta("index:lock", { startedAt: Date.now() });
    const { client, fetchFn } = fakeClient();
    const res = await createHandlers({ client, cache }).get_index_status();
    expect(JSON.parse((res.content[0] as any).text)).toMatchObject({
      progress: { pagesDone: 1, pagesTotal: 3 },
      lastSuccessfulFinishAt: null, lock: { active: true },
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("uses completed status after the progress checkpoint is cleared", async () => {
    const cache = new Cache(tmpDir());
    cache.setMeta("index:status", { finishedAt: Date.now(), pagesDone: 3, pagesTotal: 3 });
    const { client, fetchFn } = fakeClient();
    const res = await createHandlers({ client, cache }).get_index_status();
    expect(cache.getMeta("index:progress", Number.POSITIVE_INFINITY)).toBeNull();
    expect(JSON.parse((res.content[0] as any).text)).toMatchObject({
      progress: { pagesDone: 3, pagesTotal: 3 }, indexFreshness: { stale: false },
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("shows the new crawl at zero immediately after acquiring a lock", async () => {
    const cache = new Cache(tmpDir());
    cache.setMeta("categories", { colors: [], filters: ["3d", "webgl", "studio", "portfolio"] });
    cache.setMeta("index:status", { finishedAt: Date.now() - INDEX_STALE_MS, pagesDone: 3, pagesTotal: 3 });
    cache.setMeta("index:lock", { startedAt: Date.now() });
    const { client, fetchFn } = fakeClient();
    const res = await createHandlers({ client, cache }).get_index_status();
    expect(JSON.parse((res.content[0] as any).text)).toMatchObject({
      progress: { pagesDone: 0, pagesTotal: 4 },
      lock: { active: true }, indexFreshness: { stale: true },
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("reads persisted counts, progress, errors, lock and freshness offline", async () => {
    const cache = new Cache(tmpDir());
    cache.upsertSites([site({ slug: "a" }), site({ slug: "b" })]);
    const finishedAt = Date.now() - 1000;
    cache.setMeta("index:status", { finishedAt, pagesDone: 1, pagesTotal: 3, lastError: "blocked" });
    cache.setMeta("index:progress", ["3d", "webgl"]);
    cache.setMeta("index:lock", { startedAt: Date.now() - 1000 });
    const { client, fetchFn } = fakeClient();
    const h = createHandlers({ client, cache });
    const currentResult = await h.get_index_status();
    const current = JSON.parse((currentResult.content[0] as any).text);
    expect(current).toMatchObject({
      sitesCount: 2, progress: { pagesDone: 2, pagesTotal: 3 },
      lastSuccessfulFinishAt: finishedAt, lastError: "blocked",
      lock: { active: true, stale: false }, indexFreshness: { stale: false },
    });
    cache.setMeta("index:status", { finishedAt: Date.now() - INDEX_STALE_MS, pagesDone: 3, pagesTotal: 3 });
    cache.setMeta("index:lock", { startedAt: Date.now() - INDEX_LOCK_STALE_MS });
    const old = await h.get_index_status();
    const stale = JSON.parse((old.content[0] as any).text);
    expect(stale.lock).toMatchObject({ active: false, stale: true });
    expect(stale.indexFreshness.stale).toBe(true);
    expect(stale.lastError).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("list_categories", () => {
  it("returns colors and filters as JSON and caches for 30 days", async () => {
    const cache = new Cache(tmpDir());
    const { client, fetchFn } = fakeClient();
    const h = createHandlers({ client, cache });
    const res = await h.list_categories();
    const parsed = JSON.parse((res.content[0] as any).text);
    expect(parsed.colors.length).toBeGreaterThanOrEqual(20);
    expect(parsed.filters).toContain("3d");
    await h.list_categories(); // second call is served from the meta cache
    expect(fetchFn.mock.calls.length).toBe(1);
  });
});

describe("capture_live_site", () => {
  it("returns install instructions when the capture function reports failure", async () => {
    const cache = new Cache(tmpDir());
    const { client } = fakeClient();
    const h = createHandlers({
      client,
      cache,
      captureFn: async () => ({ error: "Playwright is not installed." }),
    });
    const res = await h.capture_live_site({ url: "https://example.com" });
    expect((res.content[0] as any).text).toContain("Playwright is not installed");
  });
});

describe("empty-parse guards", () => {
  it("list_categories errors instead of caching an empty taxonomy", async () => {
    const cache = new Cache(tmpDir());
    const client = new AwwwardsClient({
      fetchFn: (async () => new Response("<html><body>nothing</body></html>", { status: 200 })) as unknown as typeof fetch,
    });
    const h = createHandlers({ client, cache });
    const res = await h.list_categories();
    expect(res.isError).toBe(true);
    expect((res.content[0] as any).text).toContain("parsed 0 categories");
    expect(cache.getMeta<any>("categories", 30 * 24 * 60 * 60 * 1000)).toBeNull();
  });

  it("get_site_details errors instead of caching an empty parse", async () => {
    const cache = new Cache(tmpDir());
    const client = new AwwwardsClient({
      fetchFn: (async () => new Response("<html><body>nothing</body></html>", { status: 200 })) as unknown as typeof fetch,
    });
    const h = createHandlers({ client, cache });
    const res = await h.get_site_details({ slug: "l-i-s-a" });
    expect(res.isError).toBe(true);
    expect(cache.getMeta<any>("detail:l-i-s-a", 7 * 24 * 60 * 60 * 1000)).toBeNull();
  });
});

describe("get_site_elements", () => {
  it("returns posters inline with video urls; caches after one page fetch", async () => {
    const cache = new Cache(tmpDir());
    const { client, fetchFn } = fakeClient();
    const h = createHandlers({ client, cache });
    const res = await h.get_site_elements({ slug: "l-i-s-a" });
    const body = (res.content[0] as any).text;
    expect(body).toContain("3D model");
    expect(body).toContain("(video)");
    expect(body).toContain("https://assets.awwwards.com/awards/element/");
    expect(res.content.filter((b: any) => b.type === "image").length).toBe(6);
    const res2 = await h.get_site_elements({ slug: "l-i-s-a" });
    expect(res2.content.filter((b: any) => b.type === "image").length).toBe(6);
    const pageCalls = fetchFn.mock.calls.filter(
      (c: any[]) => String(c[0]).includes("/sites/l-i-s-a"),
    );
    expect(pageCalls.length).toBe(1); // second call served from meta cache
  });

  it("shares one page fetch with get_site_details", async () => {
    const cache = new Cache(tmpDir());
    const { client, fetchFn } = fakeClient();
    const h = createHandlers({ client, cache });
    await h.get_site_details({ slug: "l-i-s-a" });
    await h.get_site_elements({ slug: "l-i-s-a" });
    const pageCalls = fetchFn.mock.calls.filter(
      (c: any[]) => String(c[0]).includes("/sites/l-i-s-a"),
    );
    expect(pageCalls.length).toBe(1);
  });

  it("shares one page fetch with get_site_details when elements runs first", async () => {
    const cache = new Cache(tmpDir());
    const { client, fetchFn } = fakeClient();
    const h = createHandlers({ client, cache });
    await h.get_site_elements({ slug: "l-i-s-a" });
    await h.get_site_details({ slug: "l-i-s-a" });
    const pageCalls = fetchFn.mock.calls.filter(
      (c: any[]) => String(c[0]).includes("/sites/l-i-s-a"),
    );
    expect(pageCalls.length).toBe(1); // details served from the cross-seeded cache
  });

  it("lists every element in text but caps inline posters at 8", async () => {
    const cache = new Cache(tmpDir());
    const client = new AwwwardsClient({
      fetchFn: vi.fn(async () => new Response(elementsPage(9), { status: 200 })) as unknown as typeof fetch,
    });
    const h = createHandlers({ client, cache });
    const res = await h.get_site_elements({ slug: "nine-elements" });
    const body = (res.content[0] as any).text;
    expect(body).toContain("9 design element(s)");
    expect(body).toContain("Element nine"); // the 9th is still listed in text
    expect(res.content.filter((b: any) => b.type === "image").length).toBe(8);
  });

  it("degrades to text-only when every poster fetch fails", async () => {
    const cache = new Cache(tmpDir());
    const client = new AwwwardsClient({
      fetchFn: vi.fn(async (input: any) => {
        const url = String(input);
        if (url.includes("/sites/")) {
          return new Response(elementsPage(3), { status: 200 });
        }
        return new Response("cdn unavailable", { status: 500 }); // asset urls
      }) as unknown as typeof fetch,
    });
    const h = createHandlers({ client, cache });
    const res = await h.get_site_elements({ slug: "broken-posters" });
    expect(res.isError).toBeUndefined();
    const body = (res.content[0] as any).text;
    expect(body).toContain("Element one");
    expect(body).toContain("Element three");
    expect(res.content.filter((b: any) => b.type === "image").length).toBe(0);
  });

  it("reports a legitimate empty (and caches it) when there is no Elements section", async () => {
    const cache = new Cache(tmpDir());
    const fetchFn = vi.fn(async () =>
      new Response("<html><body>no sections</body></html>", { status: 200 }));
    const client = new AwwwardsClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const h = createHandlers({ client, cache });
    const res = await h.get_site_elements({ slug: "plain-site" });
    expect((res.content[0] as any).text).toContain("No design elements listed");
    expect(res.isError).toBeUndefined();
    expect(
      cache.getMeta<any[]>("elements:plain-site", 7 * 24 * 60 * 60 * 1000),
    ).toEqual([]);
    // Repeat call is served from the cached empty: zero additional page fetches.
    await h.get_site_elements({ slug: "plain-site" });
    const pageCalls = fetchFn.mock.calls.filter(
      (c: any[]) => String(c[0]).includes("/sites/plain-site"),
    );
    expect(pageCalls.length).toBe(1);
  });

  it("errors without caching on a section-with-zero-blobs mismatch", async () => {
    const cache = new Cache(tmpDir());
    const client = new AwwwardsClient({
      fetchFn: (async () =>
        new Response(
          "<h2>Elements</h2><p>broken</p><h2>Color Palette</h2>",
          { status: 200 },
        )) as unknown as typeof fetch,
    });
    const h = createHandlers({ client, cache });
    const res = await h.get_site_elements({ slug: "weird" });
    expect(res.isError).toBe(true);
    expect(cache.getMeta("elements:weird", Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("search query tokenization", () => {
  it("merges a top-up scrape into a partially filled window instead of replacing it", async () => {
    const cache = new Cache(tmpDir());
    cache.upsertSites([
      site({ slug: "ed1", title: "Editorial Thing 1", tags: [], createdAt: 1789516800 }),
      site({ slug: "ed2", title: "Editorial Thing 2", tags: [], createdAt: 1789516800 + 1 }),
      site({ slug: "ed3", title: "Editorial Thing 3", tags: [], createdAt: 1789516800 + 2 }),
    ]);
    const { client, fetchFn } = fakeClient();
    const h = createHandlers({ client, cache });
    // 3 verified cache matches < count*page (6): the window is partial. The
    // old no-scrape behavior under-served (returned 3 forever); the old
    // REPLACE behavior scraped and discarded the verified rows (returned 0 —
    // no fixture title matches "editorial"). The merge path must scrape AND
    // keep the cache rows.
    const res = await h.search_sites({ query: "editorial", count: 6 });
    expect(String(fetchFn.mock.calls[0][0])).toContain("/websites/"); // top-up scrape fired
    const text = (res.content[0] as any).text;
    // The verified cache rows survive the merge...
    expect(text).toContain("ed1");
    expect(text).toContain("ed2");
    expect(text).toContain("ed3");
    // ...while the scraped fixture-only rows are client-filtered out.
    expect(text).not.toContain("l-i-s-a");
  });

  it("splits multi-word queries into tokens (all must match)", async () => {
    const cache = new Cache(tmpDir());
    cache.upsertSites([
      site({ slug: "mag", title: "Editorial Mag", tags: ["Magazine / Newspaper / Blog"] }),
      site({ slug: "half", title: "Editorial Only", tags: [] }),
      site({ slug: "other", title: "Unrelated", tags: [] }),
    ]);
    const { client, fetchFn } = fakeClient();
    const h = createHandlers({ client, cache });
    const res = await h.search_sites({ query: "editorial mag", count: 6 });
    const text = (res.content[0] as any).text;
    expect(text).toContain("mag");
    expect(text).not.toContain("half");
    expect(text).not.toContain("other");
    // 1 verified cache match < 6 → partial window → a top-up scrape fires, but
    // every scraped row fails the all-tokens check, so only the cache row serves.
    const pageCalls = fetchFn.mock.calls.filter((c: any[]) => String(c[0]).includes("/websites/"));
    expect(pageCalls.length).toBe(1);
  });

  it("suggests taxonomy tags on zero results", async () => {
    const cache = new Cache(tmpDir());
    cache.upsertSites([site({ slug: "plain", title: "Nothing Relevant", tags: [] })]);
    // seed taxonomy meta so suggestions come from the real slugs
    cache.setMeta("categories", {
      colors: [],
      filters: ["magazine-newspaper-blog", "storytelling", "typography", "minimal", "clean", "portfolio"],
    });
    const { client } = fakeClient();
    const h = createHandlers({ client, cache });
    const res = await h.search_sites({ query: "magazine editorial", count: 6 });
    const text = (res.content[0] as any).text;
    expect(text).toContain("No sites matched");
    expect(text).toContain("Closest filter tags");
    expect(text).toContain("magazine-newspaper-blog");
    // "storytelling" shares no query token and no >=4-char prefix with either
    // token, so the scoring rule leaves it at 0 and it must not be suggested.
    expect(text).not.toContain("storytelling");
  });

  it("matches multi-word queries against the FTS cache (historical failure)", async () => {
    const cache = new Cache(tmpDir());
    cache.upsertSites([site({ slug: "mag", title: "Editorial Mag", tags: ["Magazine / Newspaper / Blog"] })]);
    const { client, fetchFn } = fakeClient();
    const h = createHandlers({ client, cache });
    const res = await h.search_sites({ query: "editorial magazine", count: 6 });
    expect(res.content[0]).toHaveProperty("text");
    expect((res.content[0] as any).text).toContain("mag");
    // 1 FTS row < count 6: the partial-window top-up merge still fires under
    // FTS routing (the scraped rows are client-checked and dropped here).
    const pageCalls = fetchFn.mock.calls.filter((c: any[]) => String(c[0]).includes("/websites/"));
    expect(pageCalls.length).toBe(1);
    // The porter stem matches where substring search cannot: "magazines"
    // appears nowhere in the title/tag text ("Magazine" does).
    const stemmed = await h.search_sites({ query: "editorial magazines", count: 6 });
    expect((stemmed.content[0] as any).text).toContain("mag");
  });

  it("orders query results by bm25 rank, not createdAt (title hit leads)", async () => {
    const cache = new Cache(tmpDir());
    // The tag-only-style longer-title hit is NEWER, so the legacy
    // newest-first sort would serve it first; bm25 ranks the short-title
    // exact hit first. This goes through the partial-window merge (2 rows <
    // count 6), so it also pins the merge's keep-rank-order behavior.
    cache.upsertSites([
      site({ slug: "magazine-post", title: "A Magazine Post About Editorial Things", createdAt: 1789516800 + 500 }),
      site({ slug: "editorial-mag", title: "Editorial Mag", createdAt: 1789516800 }),
    ]);
    const { client } = fakeClient();
    const h = createHandlers({ client, cache });
    const res = await h.search_sites({ query: "editorial", count: 6 });
    const text = (res.content[0] as any).text;
    expect(text.indexOf("editorial-mag")).toBeLessThan(text.indexOf("magazine-post"));
  });

  it("falls back to the legacy substring path when FTS5 is unavailable", async () => {
    const cache = new Cache(tmpDir());
    cache.upsertSites([site({ slug: "mag", title: "Editorial Mag", tags: ["Magazine / Newspaper / Blog"] })]);
    // Simulate an FTS-less Node build: drop the derived table via the test
    // hook and flip the cached capability flag so the probe never re-fires.
    cache.withDbForTest((db) => db.exec("DROP TABLE sites_fts"));
    cache.ftsAvailable = false;
    const { client } = fakeClient();
    const h = createHandlers({ client, cache });
    const res = await h.search_sites({ query: "editorial", count: 6 });
    expect((res.content[0] as any).text).toContain("mag");
  });

  it("hints loose OR matches on FTS zero results", async () => {
    const cache = new Cache(tmpDir());
    // "half" matches the "editorial" token but not the AND of both tokens,
    // so the strict search is empty while the loose hint names it.
    cache.upsertSites([site({ slug: "half", title: "Editorial Only", tags: [] })]);
    const { client } = fakeClient();
    const h = createHandlers({ client, cache });
    const res = await h.search_sites({ query: "editorial magazine", count: 6 });
    const text = (res.content[0] as any).text;
    expect(text).toContain("No sites matched");
    expect(text).toContain("Loose matches (any token): half");
  });

  it("drops stem-matched rows that fail a non-query filter (filter composition)", async () => {
    const cache = new Cache(tmpDir());
    // Both rows match the FTS stem ("magazines" → magazin): one via its
    // Magazine tag, one via its title only. skipQueryCheck must skip ONLY the
    // query re-check — with no URL filter (pure query + tags search) the tag
    // is client-checked with honorUrlSource=false, so the untagged stem match
    // must drop instead of riding the FTS path into the results.
    cache.upsertSites([
      site({ slug: "mag-tagged", title: "Paper Journal", tags: ["Magazine / Newspaper / Blog"] }),
      site({ slug: "mag-untagged", title: "Magazine Warehouse", tags: [] }),
    ]);
    const { client, fetchFn } = fakeClient();
    const h = createHandlers({ client, cache });
    const res = await h.search_sites({ query: "magazines", tags: ["magazine"], count: 6 });
    const text = (res.content[0] as any).text;
    expect(text).toContain("1 site(s) matched");
    expect(text).toContain("mag-tagged");
    expect(text).not.toContain("mag-untagged");
    // The partial-window top-up may scrape (1 row < count 6), but no fixture
    // card carries the literal token "magazines", so nothing scraped joins
    // the result either.
    expect(fetchFn.mock.calls.every((c: any[]) => !String(c[0]).includes("/sites/"))).toBe(true);
    expect(text).not.toContain("l-i-s-a");
  });
});

describe("suggestTags", () => {
  it("ranks slugs sharing tokens or prefixes with query tokens", () => {
    const s = suggestTags(
      ["magazine", "editorial"],
      ["magazine-newspaper-blog", "typography", "minimal", "clean", "storytelling"],
      6,
    );
    expect(s[0]).toBe("magazine-newspaper-blog"); // +2: slug contains the token "magazine"
    // "storytelling" contains neither token and shares no >=4-char prefix with
    // either, so the exact rule scores it 0 and it must not be suggested.
    expect(s).not.toContain("storytelling");
    expect(s.length).toBeLessThanOrEqual(6);
    // +1 branch: token shares a >=5-char prefix with the slug without being contained
    expect(suggestTags(["typographic"], ["typography", "minimal"], 6)).toEqual(["typography"]);
    // +1 branch (reversed): slug is a prefix of the token
    expect(suggestTags(["minimalism"], ["mini", "clean"], 6)).toEqual(["mini"]);
    // tokens shorter than 4 chars never score
    expect(suggestTags(["art"], ["artstation", "clean"], 6)).toEqual([]);
    // equal scores rank stably by slug
    expect(suggestTags(["clean"], ["clean-ui", "clean-type"], 6)).toEqual(["clean-type", "clean-ui"]);
  });
});

describe("search sortBy score", () => {
  it("sorts scored sites first (desc) then unscored (newest first)", async () => {
    const cache = new Cache(tmpDir());
    cache.upsertSites([
      site({ slug: "lo", title: "Low Score" }),
      site({ slug: "hi", title: "High Score" }),
      site({ slug: "none", title: "No Score", createdAt: 1789516800 + 500 }),
      site({ slug: "none2", title: "No Score 2", createdAt: 1789516800 + 400 }),
    ]);
    cache.setMeta("detail:hi", { slug: "hi", title: null, description: null, palette: [], technologies: [], elements: [], awards: [], ogImage: null, liveUrl: null, score: 8.4 });
    cache.setMeta("detail:lo", { slug: "lo", title: null, description: null, palette: [], technologies: [], elements: [], awards: [], ogImage: null, liveUrl: null, score: 6.1 });
    const { client, fetchFn } = fakeClient();
    const h = createHandlers({ client, cache });
    const res = await h.search_sites({ sortBy: "score", count: 6 });
    const text = (res.content[0] as any).text;
    const order = ["hi", "lo", "none", "none2"].map((s) => text.indexOf(s));
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
    expect(order[2]).toBeLessThan(order[3]);
    expect(fetchFn.mock.calls.filter((c: any[]) => String(c[0]).includes("/sites/")).length).toBe(0); // enrichment reads cache only
  });
});

describe("analyze_page_structure", () => {
  it("returns the band map as a JSON text block", async () => {
    const cache = new Cache(tmpDir());
    const { client } = fakeClient();
    const structure = {
      url: "file:///build/index.html",
      title: "Build",
      totalHeight: 2000,
      bands: [
        { index: 0, tag: "body", label: "body", background: "rgb(16, 21, 42)", offsetTop: 0, height: 1000, textStart: "" },
        { index: 1, tag: "section", label: ".shell", background: "rgb(240, 242, 247)", offsetTop: 1000, height: 1000, textStart: "Production speed" },
      ],
    };
    const h = createHandlers({
      client,
      cache,
      analyzeFn: async () => structure,
    });
    const res = await h.analyze_page_structure({ url: "file:///build/index.html" });
    expect(res.isError).toBeUndefined();
    const parsed = JSON.parse((res.content[0] as any).text);
    expect(parsed.totalHeight).toBe(2000);
    expect(parsed.bands.length).toBe(2);
  });

  it("surfaces the install hint as isError when playwright is missing", async () => {
    const cache = new Cache(tmpDir());
    const { client } = fakeClient();
    const h = createHandlers({
      client,
      cache,
      analyzeFn: async () => ({ error: "install playwright" }),
    });
    const res = await h.analyze_page_structure({ url: "https://example.com" });
    expect(res.isError).toBe(true);
    expect((res.content[0] as any).text).toContain("install playwright");
  });

  it("forwards maxBands and the viewport to the analyzer", async () => {
    const cache = new Cache(tmpDir());
    const { client } = fakeClient();
    const seen: Array<{
      url: string;
      maxBands?: number;
      opts?: { waitStrategy?: string; viewport?: string };
    }> = [];
    const h = createHandlers({
      client,
      cache,
      analyzeFn: async (
        url: string,
        maxBands?: number,
        opts?: { waitStrategy?: string; viewport?: string },
      ) => {
        seen.push({ url, maxBands, opts });
        return { url, title: "T", totalHeight: 100, bands: [] };
      },
    });
    await h.analyze_page_structure({
      url: "https://example.com",
      maxBands: 10,
      viewport: "mobile",
    });
    expect(seen[0]?.maxBands).toBe(10);
    expect(seen[0]?.opts).toMatchObject({ viewport: "mobile" });
  });
});

describe("record_site_motion", () => {
  it("returns the filmstrip inline and forwards url + frames to the motion fn", async () => {
    const cache = new Cache(tmpDir());
    const { client } = fakeClient();
    const seen: Array<{
      url: string;
      opts: { cacheImagesDir: string; frames?: number; waitStrategy?: string; viewport?: string };
    }> = [];
    const h = createHandlers({
      client,
      cache,
      motionFn: async (url, opts) => {
        seen.push({ url, opts });
        return {
          file: "/cache/motion-abc1234567.webm",
          base64: Buffer.from("strip-jpeg").toString("base64"),
          frames: 16,
        };
      },
    });
    const res = await h.record_site_motion({
      url: "https://example.com",
      frames: 12,
      waitStrategy: "networkidle",
      viewport: "mobile",
    });
    expect(res.isError).toBeUndefined();
    expect((res.content[0] as any).text).toBe(
      "Motion recording saved to /cache/motion-abc1234567.webm",
    );
    expect(res.content[1]).toEqual({
      type: "image",
      data: Buffer.from("strip-jpeg").toString("base64"),
      mimeType: "image/jpeg",
    });
    expect(seen[0]).toEqual({
      url: "https://example.com",
      opts: {
        cacheImagesDir: cache.imagesDir,
        frames: 12,
        waitStrategy: "networkidle",
        viewport: "mobile",
      },
    });
  });

  it("surfaces the install hint as isError when the motion fn reports failure", async () => {
    const cache = new Cache(tmpDir());
    const { client } = fakeClient();
    const h = createHandlers({
      client,
      cache,
      motionFn: async () => ({ error: "Install it with:  npm install -D ffmpeg-static" }),
    });
    const res = await h.record_site_motion({ url: "https://example.com" });
    expect(res.isError).toBe(true);
    expect((res.content[0] as any).text).toContain("ffmpeg-static");
  });
});

describe("viewport threading", () => {
  it("threads viewport: mobile through capture_live_site to the capture fn", async () => {
    const cache = new Cache(tmpDir());
    const { client } = fakeClient();
    const seen: Array<{ url: string; opts?: { waitStrategy?: string; viewport?: string } }> = [];
    const h = createHandlers({
      client,
      cache,
      captureFn: async (url: string, imagesDir: string, opts?: { viewport?: string }) => {
        seen.push({ url, opts });
        return { file: join(imagesDir, "shot.png"), base64: Buffer.from("png").toString("base64") };
      },
    });
    const res = await h.capture_live_site({ url: "https://example.com", viewport: "mobile" });
    expect(res.isError).toBeUndefined();
    expect(seen[0]?.url).toBe("https://example.com");
    expect(seen[0]?.opts).toMatchObject({ viewport: "mobile" });
  });

  it("arrives as desktop when viewport is omitted (zod default path)", async () => {
    const cache = new Cache(tmpDir());
    const { client } = fakeClient();
    const captured: {
      capture?: unknown;
      analyze?: unknown;
      motion?: unknown;
    } = {};
    const h = createHandlers({
      client,
      cache,
      captureFn: async (_url: string, _imagesDir: string, opts?: unknown) => {
        captured.capture = opts;
        return { file: "shot.png", base64: Buffer.from("png").toString("base64") };
      },
      analyzeFn: async (_url: string, _maxBands?: number, opts?: unknown) => {
        captured.analyze = opts;
        return { url: "https://example.com", title: "T", totalHeight: 100, bands: [] };
      },
      motionFn: async (_url: string, opts?: unknown) => {
        captured.motion = opts;
        return { file: "m.webm", base64: Buffer.from("strip").toString("base64"), frames: 16 };
      },
    });
    // Tool callers omitting viewport get zod's "desktop" default; the handler
    // normalizes direct calls to the same explicit value.
    await h.capture_live_site({ url: "https://example.com" });
    await h.analyze_page_structure({ url: "https://example.com" });
    await h.record_site_motion({ url: "https://example.com" });
    expect(captured.capture).toMatchObject({ viewport: "desktop" });
    expect(captured.analyze).toMatchObject({ viewport: "desktop" });
    expect(captured.motion).toMatchObject({ viewport: "desktop" });
  });
});

// ---- search_elements / get_element handlers ----

const elementFixture: ElementRecord = {
  slug: "footers-editorial-studio", title: "Editorial Footer", cid: "footers",
  category: "Footers", author: "Studio X", builtWith: ["GSAP", "Lenis"],
  related: ["footers-editorial-studio-2"], mediaPath: "element/2025/11/e.jpg",
  mediaType: "image", source: "gallery", projectId: null, siteSlug: null,
  fetchedAt: Date.now(),
};
const elementFixture2: ElementRecord = {
  ...elementFixture, slug: "footers-editorial-studio-2", title: "Second Footer",
};

describe("search_elements handler", () => {
  it("returns facet-filtered compact payloads with media URLs (no base64)", async () => {
    const { client } = fakeClient();
    const cache = new Cache(tmpDir());
    cache.upsertElements([elementFixture, elementFixture2]);
    const h = createHandlers({ client, cache });
    const res = await h.search_elements({ query: "footer", category: "footers", limit: 10 });
    const body = JSON.parse((res.content[0] as any).text);
    expect(body.results.length).toBe(2);
    expect(body.results[0].mediaUrl).toContain("assets.awwwards.com");
    expect(JSON.stringify(res)).not.toContain("base64");
  });

  it("stack facet rejects records missing a requested token", async () => {
    const { client } = fakeClient();
    const cache = new Cache(tmpDir());
    cache.upsertElements([elementFixture, elementFixture2]);
    const h = createHandlers({ client, cache });
    const res = await h.search_elements({ query: "footer", stack: ["lenis", "webgl"], limit: 10 });
    expect(JSON.parse((res.content[0] as any).text).results).toHaveLength(0);
  });

  it("serves an empty corpus without a query via listElements (no FTS call)", async () => {
    const { client } = fakeClient();
    const cache = new Cache(tmpDir());
    cache.upsertElements([elementFixture, elementFixture2]);
    const h = createHandlers({ client, cache });
    const res = await h.search_elements({ category: "footers", limit: 1 });
    const body = JSON.parse((res.content[0] as any).text);
    expect(body.count).toBe(1);
    expect(body.results[0].slug).toBe("footers-editorial-studio");
  });

  it("pairs elements to sites: stored siteSlug wins, else author→title fallback", async () => {
    const { client } = fakeClient();
    const cache = new Cache(tmpDir());
    // Sites index has two rows; only one matches elementFixture's author
    // "Studio X" by title. A stored siteSlug bypasses the fallback entirely.
    cache.upsertSites([
      site({ slug: "studio-x", title: "Studio X" }),
      site({ slug: "other-site", title: "Unrelated" }),
    ]);
    cache.upsertElements([
      elementFixture, // siteSlug null → resolves via author→title
      elementFixture2, // siteSlug stored → used as-is
    ]);
    cache.upsertElements([
      { ...elementFixture2, siteSlug: "the-real-site" },
    ]);
    const h = createHandlers({ client, cache });
    const res = await h.search_elements({ query: "footer", limit: 10 });
    const parsed = JSON.parse((res.content[0] as any).text);
    const bySlug = new Map(parsed.results.map((r: any) => [r.slug, r]));
    // Fallback: author "Studio X" matches exactly one site title.
    expect(bySlug.get("footers-editorial-studio").siteSlug).toBe("studio-x");
    expect(bySlug.get("footers-editorial-studio").siteUrl).toContain("/sites/studio-x/");
    // Stored value beats the fallback.
    expect(bySlug.get("footers-editorial-studio-2").siteSlug).toBe("the-real-site");
  });

  it("leaves siteSlug null when the author matches zero or multiple site titles", async () => {
    const { client } = fakeClient();
    const cache = new Cache(tmpDir());
    cache.upsertSites([
      site({ slug: "studio-x-1", title: "Studio X" }),
      site({ slug: "studio-x-2", title: "Studio X" }), // duplicate titles → ambiguous
    ]);
    cache.upsertElements([elementFixture]);
    const h = createHandlers({ client, cache });
    const res = await h.search_elements({ query: "footer", limit: 10 });
    const parsed = JSON.parse((res.content[0] as any).text);
    expect(parsed.results[0].siteSlug).toBeNull();
    expect(parsed.results[0].siteUrl).toBeNull();
  });

  it("renders mediaUrl/posterUrl null when mediaPath is empty (no garbage URL)", async () => {
    const { client } = fakeClient();
    const cache = new Cache(tmpDir());
    const noMedia: ElementRecord = { ...elementFixture, mediaPath: "" };
    cache.upsertElements([noMedia]);
    const h = createHandlers({ client, cache });
    const res = await h.search_elements({ query: "footer", limit: 5 });
    const body = JSON.parse((res.content[0] as any).text);
    expect(body.results[0].mediaUrl).toBeNull();
    expect(body.results[0].posterUrl).toBeNull();
  });
});

describe("get_element handler", () => {
  it("returns full record with resolved related titles", async () => {
    const { client } = fakeClient();
    const cache = new Cache(tmpDir());
    cache.upsertElements([elementFixture, elementFixture2]);
    const h = createHandlers({ client, cache });
    const res = await h.get_element({ id: "footers-editorial-studio" });
    const body = JSON.parse((res.content[0] as any).text);
    expect(body.slug).toBe("footers-editorial-studio");
    expect(body.related).toEqual([{ slug: "footers-editorial-studio-2", title: "Second Footer" }]);
  });

  it("reports a clean error for an unknown id", async () => {
    const { client } = fakeClient();
    const cache = new Cache(tmpDir());
    const h = createHandlers({ client, cache });
    const res = await h.get_element({ id: "nope" });
    expect(res.isError).toBe(true);
  });
});

describe("get_motion_dna handler", () => {
  const dnaFixture = {
    url: "https://example.com/a",
    stack: { libs: ["gsap", "scrolltrigger"], render: ["webgl", "three"], scrollModel: "native" as const },
    scroll: { triggerCount: 6, scrubCount: 3, pinCount: 2, scrubRatio: 0.5, sample: [] },
    easingVocab: [{ token: "power4.out", bezier: [0.23, 1, 0.32, 1], uses: 9 }],
    durationVocab: { p25: 400, median: 700, p75: 1200 },
    capturedAt: Date.now(),
  };

  it("serves cached records under 90 days", async () => {
    const { client } = fakeClient();
    const cache = new Cache(tmpDir());
    cache.upsertMotionDna({ ...dnaFixture, capturedAt: Date.now() });
    const captured = vi.fn();
    const h = createHandlers({ client, cache, motionDnaFn: async (u: string) => { captured(u); return dnaFixture; } });
    const res = await h.get_motion_dna({ url: dnaFixture.url });
    expect(JSON.parse((res.content[0] as any).text).url).toBe(dnaFixture.url);
    expect(captured).not.toHaveBeenCalled();
  });

  it("live-captures and upserts on a cache miss, surfacing failure as clean error", async () => {
    const { client } = fakeClient();
    const cache = new Cache(tmpDir());
    const h = createHandlers({ client, cache, motionDnaFn: async () => { throw new Error("boom"); } });
    const miss = await h.get_motion_dna({ url: "https://unreachable.example" });
    expect(miss.isError).toBe(true);
    expect((miss.content[0] as any).text).toContain("boom");
  });
});

describe("search_motion handler", () => {
  const dnaFixture = {
    url: "https://example.com/a",
    stack: { libs: ["gsap"], render: ["webgl"], scrollModel: "lenis" as const },
    scroll: { triggerCount: 10, scrubCount: 4, pinCount: 3, scrubRatio: 0.4, sample: [] },
    easingVocab: [{ token: "power2.out", bezier: null, uses: 5 }],
    durationVocab: null,
    capturedAt: Date.now(),
  };

  it("returns compact payloads and honors limit", async () => {
    const { client } = fakeClient();
    const cache = new Cache(tmpDir());
    cache.upsertMotionDna(dnaFixture);
    const h = createHandlers({ client, cache });
    const res = await h.search_motion({});
    const body = JSON.parse((res.content[0] as any).text);
    expect(body.count).toBe(1);
    expect(body.results[0]).toEqual({
      url: "https://example.com/a", libs: ["gsap"], scrollModel: "lenis",
      triggerCount: 10, scrubCount: 4, pinCount: 3, topEasing: "power2.out",
    });
  });

  it("filters on lib, scrubOnly and hasPins", async () => {
    const { client } = fakeClient();
    const cache = new Cache(tmpDir());
    const quiet = { ...dnaFixture, url: "https://example.com/quiet",
      scroll: { triggerCount: 2, scrubCount: 0, pinCount: 0, scrubRatio: 0, sample: [] } };
    cache.upsertMotionDna(quiet);
    cache.upsertMotionDna(dnaFixture);
    const h = createHandlers({ client, cache });
    const urls = async (args: Parameters<ReturnType<typeof createHandlers>["search_motion"]>[0]) =>
      JSON.parse(((await h.search_motion(args)).content[0] as any).text).results.map((r: any) => r.url);
    expect(await urls({ scrubOnly: true })).toEqual(["https://example.com/a"]);
    expect(await urls({ hasPins: true })).toEqual(["https://example.com/a"]);
    // lib matches both rows; insertion order is preserved
    expect(await urls({ lib: "gsap" })).toEqual(["https://example.com/quiet", "https://example.com/a"]);
  });
});
