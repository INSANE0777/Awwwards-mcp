import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cache } from "../src/cache.js";
import type { ElementRecord, MotionDna, SiteSummary } from "../src/types.js";

const dirs: string[] = [];
const tmpDir = () => {
  const d = mkdtempSync(join(tmpdir(), "awwwards-mcp-test-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// Accepts a bare slug or an overrides object (e.g. site({ slug, title, tags })).
const site = (spec: string | Partial<SiteSummary>): SiteSummary => {
  const over: Partial<SiteSummary> = typeof spec === "string" ? { slug: spec } : spec;
  return {
    id: 1,
    slug: over.slug ?? "a",
    title: "Test Site",
    createdAt: 1789516800,
    tags: ["3D", "WebGL"],
    thumbnailPath: "submissions/2026/08/abc.jpg",
    liveUrl: "https://example.com",
    detailPath: `/sites/${over.slug ?? "a"}`,
    awards: ["Site of the Day"],
    ...over,
  };
};

describe("Cache", () => {
  it("round-trips sites and honors TTL", () => {
    let t = 1_000_000;
    const cache = new Cache(tmpDir(), () => t);
    cache.upsertSites([site("a"), site("b")]);
    expect(cache.getSites(10_000).length).toBe(2);
    expect(cache.countSites()).toBe(2);
    expect(cache.getSite("a")!.liveUrl).toBe("https://example.com");
    expect(cache.getSite("a")!.tags).toEqual(["3D", "WebGL"]);
    t += 20_000;
    expect(cache.getSites(10_000).length).toBe(0); // expired
    expect(cache.countSites()).toBe(2); // stored rows include expired entries
    expect(cache.getSite("a")).toBeNull(); // expired lookups are misses
  });

  it("upserts over existing slugs instead of duplicating", () => {
    const cache = new Cache(tmpDir());
    cache.upsertSites([site("a")]);
    const updated = { ...site("a"), title: "Renamed" };
    cache.upsertSites([updated]);
    expect(cache.getSites(10_000).length).toBe(1);
    expect(cache.getSites(10_000)[0].title).toBe("Renamed");
  });

  it("stores and expires arbitrary meta values", () => {
    let t = 1_000_000;
    const cache = new Cache(tmpDir(), () => t);
    cache.setMeta("categories", { colors: ["#000000"], filters: ["3d"] });
    expect(cache.getMeta<any>("categories", 5_000)!.filters).toEqual(["3d"]);
    t += 6_000;
    expect(cache.getMeta("categories", 5_000)).toBeNull();
  });

  it("caches image buffers on disk keyed by asset path", async () => {
    const cache = new Cache(tmpDir());
    let calls = 0;
    const fetcher = async () => {
      calls++;
      return Buffer.from("jpeg-bytes-" + calls);
    };
    const first = await cache.getImage("submissions/2026/08/abc.jpg", fetcher);
    const second = await cache.getImage("submissions/2026/08/abc.jpg", fetcher);
    expect(calls).toBe(1);
    expect(second.equals(first)).toBe(true);
    expect(first.toString()).toContain("jpeg-bytes-1");
  });

  it("deletes meta keys", () => {
    const cache = new Cache(tmpDir());
    cache.setMeta("index:lock", { startedAt: 1 });
    expect(cache.getMeta<any>("index:lock", 10_000)).toEqual({ startedAt: 1 });
    cache.deleteMeta("index:lock");
    expect(cache.getMeta("index:lock", 10_000)).toBeNull();
    cache.deleteMeta("index:lock"); // idempotent
    expect(cache.getMeta("index:lock", 10_000)).toBeNull();
  });
});

describe("searchSites (FTS5)", () => {
  const seed = (cache: Cache) =>
    cache.upsertSites([
      site({ slug: "editorial-mag", title: "Editorial Mag", tags: ["Magazine / Newspaper / Blog"] }),
      site({ slug: "webgl-studio", title: "WebGL Studio", tags: ["3d", "webgl"] }),
      site({ slug: "magazine-post", title: "A Magazine Post About Editorial Things", tags: [] }),
    ]);

  it("matches multi-word queries that substring search could never match", () => {
    const cache = new Cache(tmpDir());
    seed(cache);
    // "magazine" is in the tag of row 1 and the title of row 3; "editorial"
    // in the title of row 1 and the title of row 3 — no single substring span.
    const rows = cache.searchSites("editorial magazine", 1000)!;
    expect(rows.map((r) => r.slug)).toContain("editorial-mag");
    expect(rows.map((r) => r.slug)).toContain("magazine-post");
  });

  it("ranks title hits above tag-only hits (bm25)", () => {
    const cache = new Cache(tmpDir());
    seed(cache);
    const rows = cache.searchSites("editorial", 1000)!;
    expect(rows[0]!.slug).toBe("editorial-mag"); // title hit leads
  });

  it("returns all ranked fresh matches beyond 200 by default", () => {
    let t = 1_000_000;
    const cache = new Cache(tmpDir(), () => t);
    cache.upsertSites([site({ slug: "stale-showcase", title: "Showcase Old" })]);
    t += 2_000;
    cache.upsertSites(Array.from({ length: 225 }, (_, i) =>
      site({ slug: `showcase-${i}`, title: `Showcase ${i}`, tags: [] }),
    ));

    const rows = cache.searchSites("showcase", 1_000)!;
    expect(rows).toHaveLength(225);
    expect(rows.map((r) => r.slug)).toContain("showcase-224");
    expect(rows.map((r) => r.slug)).not.toContain("stale-showcase");
  });

  it("respects an explicit limit for OR loose-match hints", () => {
    const cache = new Cache(tmpDir());
    seed(cache);
    expect(cache.searchSites("unmatched editorial", 1_000)).toEqual([]);
    const rows = cache.searchSites("unmatched editorial", 1_000, 1, "OR")!;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.slug).toBe("editorial-mag");
  });

  it("matches prefixes and porter stems (editor → Editorial)", () => {
    const cache = new Cache(tmpDir());
    seed(cache);
    const rows = cache.searchSites("edito", 1000)!;
    expect(rows.map((r) => r.slug)).toContain("editorial-mag");
    const stemmed = cache.searchSites("magazines", 1000)!; // stem ≡ magazine
    expect(stemmed.length).toBeGreaterThanOrEqual(2);
  });

  it("respects maxAgeMs and sanitizes FTS operators out of tokens", () => {
    const cache = new Cache(tmpDir());
    seed(cache);
    expect(cache.searchSites('editorial" OR NEAR (', 1000)).not.toBeNull();
    expect(cache.searchSites("editorial", 0)).toEqual([]); // all expired
  });

  it("backfills the fts table on first open of a legacy DB (rows exist, fts empty)", () => {
    // simulate a pre-FTS DB: drop the insert-sync trigger BEFORE seeding so
    // rows land in sites while sites_fts stays empty, then reopen a Cache on
    // the same dir and query — the backfill at open must make search work.
    const dir = tmpDir();
    const cache = new Cache(dir);
    cache.withDbForTest((db) => db.exec("DROP TRIGGER sites_fts_ai"));
    seed(cache);
    const reopened = new Cache(dir);
    const rows = reopened.searchSites("editorial", 1000)!;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    reopened.withDbForTest((db) => {
      const { n } = db.prepare("SELECT COUNT(*) AS n FROM sites_fts").get() as unknown as { n: number };
      expect(n).toBe(3);
    });
  });

  it("backfill INSERT is idempotent — a raced double-run cannot duplicate slugs", () => {
    // The sitesN>0 && ftsN===0 read is not atomic across processes: `npm run
    // index` and a first open can both pass it and both run the backfill
    // INSERT, and sites_fts.slug has no unique constraint. Run the statement
    // twice the way the raced processes would — its NOT IN guard must keep
    // the index single-rowed and searchSites duplicate-free.
    const cache = new Cache(tmpDir());
    cache.withDbForTest((db) => db.exec("DROP TRIGGER sites_fts_ai"));
    seed(cache);
    const backfill =
      "INSERT INTO sites_fts (slug, title, tags, awards) " +
      "SELECT slug, title, tags, awards FROM sites " +
      "WHERE slug NOT IN (SELECT slug FROM sites_fts)";
    cache.withDbForTest((db) => db.exec(backfill));
    cache.withDbForTest((db) => db.exec(backfill)); // the raced second run
    const rows = cache.searchSites("magazine", 1000)!;
    const slugs = rows.map((r) => r.slug);
    expect(slugs.length).toBeGreaterThanOrEqual(2);
    expect(new Set(slugs).size).toBe(slugs.length); // no duplicate slugs
    cache.withDbForTest((db) => {
      const { n } = db.prepare("SELECT COUNT(*) AS n FROM sites_fts").get() as unknown as { n: number };
      expect(n).toBe(3);
    });
  });
});

describe("elements cache", () => {
  const elementRecord = (overrides: Partial<ElementRecord> = {}): ElementRecord => ({
    slug: "micro-interactions-croing-tiktok-partner-agency",
    title: "Micro-interactions",
    cid: "norm:micro-interactions", // normalized category id
    category: "Micro-interactions",
    author: "CROING - TikTok Partner Agency",
    builtWith: ["GSAP", "WebGL"],
    related: ["elem-b", "elem-c"],
    mediaPath: "element/2025/11/abc.mp4",
    mediaType: "video",
    source: "gallery",
    projectId: null,
    fetchedAt: Date.now(),
    ...overrides,
  });

  it("upserts twice without duplicating rows", () => {
    const cache = new Cache(tmpDir());
    cache.upsertElements([elementRecord()]);
    cache.upsertElements([elementRecord({ title: "Micro-interactions v2" })]);
    expect(cache.countElements()).toBe(1);
    expect(cache.getElements(["micro-interactions-croing-tiktok-partner-agency"])[0]!.title)
      .toBe("Micro-interactions v2");
  });

  it("FTS-matches title and author with prefix semantics", () => {
    const cache = new Cache(tmpDir());
    cache.upsertElements([
      elementRecord(),
      elementRecord({ slug: "e2", title: "Editorial Footer", author: "Studio X", category: "Footers", cid: "norm:footers" }),
    ]);
    const hits = cache.searchElements("micro", 10);
    expect(hits.map((h) => h.slug)).toContain("micro-interactions-croing-tiktok-partner-agency");
    const byAuthor = cache.searchElements("studio", 10);
    expect(byAuthor.map((h) => h.slug)).toContain("e2");
    expect(cache.searchElements("zzzznothing", 10)).toEqual([]);
  });

  it("round-trips JSON arrays and optional fields", () => {
    const cache = new Cache(tmpDir());
    cache.upsertElements([
      elementRecord(),
      elementRecord({ slug: "site-elem", source: "site", projectId: "12345" }),
    ]);
    const [gallery, siteElem] = cache.getElements(["micro-interactions-croing-tiktok-partner-agency", "site-elem"]);
    expect(gallery!.builtWith).toEqual(["GSAP", "WebGL"]);
    expect(gallery!.related).toEqual(["elem-b", "elem-c"]);
    expect(gallery!.source).toBe("gallery");
    expect(gallery!.projectId).toBeNull();
    expect(siteElem!.source).toBe("site");
    expect(siteElem!.projectId).toBe("12345");
  });

  it("getElements silently drops missing slugs", () => {
    const cache = new Cache(tmpDir());
    cache.upsertElements([elementRecord()]);
    expect(cache.getElements(["nope", elementRecord().slug]).map((r) => r.slug))
      .toEqual(["micro-interactions-croing-tiktok-partner-agency"]);
    expect(cache.getElements([])).toEqual([]);
  });

  it("countElements counts only gallery-sourced rows", () => {
    const cache = new Cache(tmpDir());
    cache.upsertElements([
      elementRecord(),
      elementRecord({ slug: "site-elem", source: "site", cid: "norm:micro-interactions" }),
    ]);
    expect(cache.countElements()).toBe(1);
  });

  it("upserting an element updates its FTS row (author change is searchable)", () => {
    const cache = new Cache(tmpDir());
    cache.upsertElements([elementRecord()]);
    cache.upsertElements([elementRecord({ author: "Studio X", source: "site" })]);
    expect(cache.searchElements("studio", 10).map((r) => r.slug))
      .toContain("micro-interactions-croing-tiktok-partner-agency");
    // "croing" lives only in the slug; v2 indexes slug, so it now matches
    // (behavioral change from the slug-indexing migration, by design).
    expect(cache.searchElements("croing", 10).map((r) => r.slug))
      .toEqual(["micro-interactions-croing-tiktok-partner-agency"]);
  });

  it("FTS-matches slug tokens (footer-cta-hero style)", () => {
    const cache = new Cache(tmpDir());
    cache.upsertElements([
      elementRecord({ slug: "hero-with-number-countup", title: "Landing Hero" }),
    ]);
    // Slug is now an indexed FTS column: tokens from the slug itself match.
    expect(cache.searchElements("countup", 10).map((r) => r.slug)).toEqual(["hero-with-number-countup"]);
  });

  it("rebuilds elements_fts with slug tokens when opening a pre-v2 database", () => {
    // Simulate a database written by the old schema: rows exist, but the FTS
    // table was created without an indexed slug column (v1 layout).
    const dir = tmpDir();
    const old = new Cache(dir);
    old.upsertElements([elementRecord({ slug: "hero-with-number-countup", title: "Landing Hero" })]);
    old.withDbForTest((db) => {
      db.exec(`DROP TABLE elements_fts;
        CREATE VIRTUAL TABLE elements_fts USING fts5(
          slug UNINDEXED, title, author, builtWith, category, tokenize='porter unicode61');`);
      db.exec(`INSERT INTO elements_fts (slug, title, author, builtWith, category)
        VALUES ('hero-with-number-countup', 'Landing Hero', '', '[]', '')`);
      // A real v1 database was written before versioning existed: no stamp.
      db.prepare("DELETE FROM meta WHERE key = 'elements_fts_version'").run();
    });
    // Reopen the SAME directory: migration detects the old table shape,
    // drops + recreates it against the current schema, and repopulates.
    const reopened = new Cache(dir);
    expect(reopened.searchElements("countup", 10).map((r) => r.slug))
      .toEqual(["hero-with-number-countup"]);
  });

  it("listElements returns rows newest-fetched first", () => {
    let t = 1_000_000;
    const cache = new Cache(tmpDir(), () => t);
    cache.upsertElements([elementRecord({ slug: "old" })]);
    t += 5_000;
    cache.upsertElements([elementRecord({ slug: "new" })]);
    expect(cache.listElements(10).map((r) => r.slug)).toEqual(["new", "old"]);
    expect(cache.listElements(1).map((r) => r.slug)).toEqual(["new"]);
  });
});

describe("motion dna cache", () => {
  const dnaFixture: MotionDna = {
    url: "https://example.com/a",
    stack: { libs: ["gsap", "scrolltrigger"], render: ["webgl", "three"], scrollModel: "native" },
    scroll: { triggerCount: 6, scrubCount: 3, pinCount: 2, scrubRatio: 0.5, sample: [] },
    easingVocab: [{ token: "power4.out", bezier: [0.23, 1, 0.32, 1], uses: 9 }],
    durationVocab: { p25: 400, median: 700, p75: 1200 },
    capturedAt: Date.now(),
  };

  it("round-trips a record through upsert/get", () => {
    const cache = new Cache(tmpDir());
    cache.upsertMotionDna(dnaFixture);
    expect(cache.getMotionDna("https://example.com/a")).toEqual(dnaFixture);
    expect(cache.getMotionDna("https://example.com/b")).toBeNull();
  });

  it("searchMotion filters on lib, scrubRatio and pins", () => {
    const cache = new Cache(tmpDir());
    const noScrub = { ...dnaFixture, url: "https://example.com/noscrub",
      scroll: { ...dnaFixture.scroll, scrubCount: 0, scrubRatio: 0, pinCount: 0 } };
    cache.upsertMotionDna(dnaFixture);
    cache.upsertMotionDna(noScrub);
    expect(cache.searchMotion({}).length).toBe(2);
    expect(cache.searchMotion({ lib: "gsap" }).map((d) => d.url)).toContain("https://example.com/a");
    expect(cache.searchMotion({ scrubOnly: true }).map((d) => d.url)).toEqual(["https://example.com/a"]);
    expect(cache.searchMotion({ hasPins: true }).map((d) => d.url)).toEqual(["https://example.com/a"]);
  });
});
