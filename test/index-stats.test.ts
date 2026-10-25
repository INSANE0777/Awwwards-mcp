import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cache } from "../src/cache.js";
import { getIndexStats } from "../src/index-stats.js";
import type { ElementRecord, MotionDna, SiteDetails, SiteSummary } from "../src/types.js";

const dirs: string[] = [];
const tmpDir = () => {
  const d = mkdtempSync(join(tmpdir(), "awwwards-stats-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 25);

const site = (slug: string, title: string, tags: string[]): SiteSummary => ({
  id: 1,
  slug,
  title,
  createdAt: 1789516800,
  tags,
  thumbnailPath: `submissions/${slug}.jpg`,
  liveUrl: "https://example.com",
  detailPath: `/sites/${slug}`,
  awards: ["Site of the Day"],
});

const details = (score: number | null, palette: string[]): SiteDetails => ({
  slug: "x",
  title: null,
  description: null,
  palette,
  technologies: [],
  elements: [],
  awards: [],
  nominee: false,
  score,
  ogImage: null,
  liveUrl: null,
});

const dna = (url: string, libs: string[], capturedAt: number): MotionDna => ({
  url,
  stack: { libs, render: [], scrollModel: "native" },
  scroll: { triggerCount: 0, scrubCount: 0, pinCount: 0, scrubRatio: 0, sample: [] },
  easingVocab: [],
  durationVocab: null,
  capturedAt,
});

const element = (slug: string, fetchedAt: number): ElementRecord => ({
  slug,
  title: "Element",
  cid: "hero",
  category: "hero",
  author: "Studio",
  builtWith: [],
  related: [],
  mediaPath: "",
  mediaType: null,
  source: "gallery",
  projectId: null,
  siteSlug: null,
  fetchedAt,
});

const BASE_COVERAGE = {
  sitesTotal: 3,
  note: "locally cached subset",
};

const WINDOW_COVERAGE = {
  detailsCached: 2,
  sitesTotal: 3,
  windowDays: 90,
  detailParseCap: 500,
  note: "locally cached subset",
};

/** Seeded cache: two recent detail rows + one 100-day-old row. */
function seeded() {
  let clock = NOW - 100 * DAY;
  const cache = new Cache(tmpDir(), () => clock);
  cache.upsertSites([
    site("alpha", "Cool Studio", ["WebGL", "3D"]),
    site("beta", "Beta Site", ["WebGL", "Next.js"]),
    site("gamma", "Gamma", ["Portfolio"]),
  ]);
  cache.upsertElements([element("el-one", clock)]);
  // Old rows (outside the default 90-day window).
  cache.setMeta("detail:old", details(10, ["#00FF00"]));
  cache.upsertMotionDna(dna("https://old.example", ["gsap"], clock));

  clock = NOW;
  cache.setMeta("detail:alpha", details(8, ["#FFFFFF", "#000000"]));
  cache.setMeta("detail:beta", details(6, ["#000000", "#FF0000"]));
  cache.upsertMotionDna(dna("https://one.example", ["gsap", "three.js"], clock));
  cache.upsertMotionDna(dna("https://two.example", ["gsap"], clock));
  return cache;
}

describe("getIndexStats", () => {
  it("aggregates sites, details, elements, technologies, colors, scores and motion libs", () => {
    const cache = seeded();
    const stats = getIndexStats({}, { cache, now: () => NOW });

    expect(stats.windowDays).toBe(90);
    expect(stats.top).toBe(10);
    expect(stats.sites.total).toBe(3);
    expect(stats.details.cached).toBe(2);
    expect(stats.elements.total).toBe(1);

    expect(stats.technologies.items).toEqual([
      { tag: "webgl", count: 2 },
      { tag: "3d", count: 1 },
      { tag: "next-js", count: 1 },
      { tag: "portfolio", count: 1 },
    ]);
    expect(stats.technologies.distinct).toBe(4);

    expect(stats.colors.items).toEqual([
      { hex: "#000000", count: 2 },
      { hex: "#FF0000", count: 1 },
      { hex: "#FFFFFF", count: 1 },
    ]);
    expect(stats.colors.detailsParsed).toBe(2);

    expect(stats.scores).toMatchObject({ n: 2, avg: 7, median: 7 });

    expect(stats.motionLibs.items).toEqual([
      { lib: "gsap", count: 2 },
      { lib: "three.js", count: 1 },
    ]);
    expect(stats.motionLibs.rows).toBe(2);

    // All-time metrics carry all-time coverage; windowed metrics carry the
    // window and the detail-parse cap.
    for (const metric of [stats.sites, stats.elements, stats.technologies]) {
      expect(metric.coverage).toEqual(BASE_COVERAGE);
      expect("windowDays" in metric.coverage).toBe(false);
    }
    for (const metric of [stats.details, stats.colors, stats.scores, stats.motionLibs]) {
      expect(metric.coverage).toEqual(WINDOW_COVERAGE);
    }
  });

  it("never emits site slugs, titles or URLs", () => {
    const cache = seeded();
    const json = JSON.stringify(getIndexStats({}, { cache, now: () => NOW }));
    for (const forbidden of ['"alpha"', "Cool Studio", "Beta Site", "example.com", "gamma"]) {
      expect(json).not.toContain(forbidden);
    }
    expect(json).toContain("locally cached subset");
  });

  it("honours the window and the top cap", () => {
    const cache = seeded();
    const wide = getIndexStats({ windowDays: 3650, top: 1 }, { cache, now: () => NOW });
    expect(wide.details.cached).toBe(3);
    expect(wide.scores).toMatchObject({ n: 3, avg: 8, median: 8 });
    expect(wide.colors.items).toEqual([{ hex: "#000000", count: 2 }]);
    expect(wide.motionLibs.items).toEqual([{ lib: "gsap", count: 3 }]);
    expect(wide.motionLibs.rows).toBe(3);
    expect(wide.technologies.items).toHaveLength(1);
    for (const metric of [wide.sites, wide.elements, wide.technologies]) {
      expect(metric.coverage).toEqual(BASE_COVERAGE);
    }
    for (const metric of [wide.details, wide.colors, wide.scores, wide.motionLibs]) {
      expect(metric.coverage.windowDays).toBe(3650);
      expect(metric.coverage.detailsCached).toBe(3);
    }

    const narrow = getIndexStats({ windowDays: 1 }, { cache, now: () => NOW + 10 * DAY });
    expect(narrow.details.cached).toBe(0);
    expect(narrow.colors.items).toEqual([]);
    expect(narrow.scores).toMatchObject({ n: 0, avg: null, median: null });
    expect(narrow.motionLibs.rows).toBe(0);
    expect(narrow.details.coverage.detailsCached).toBe(0);
    expect(narrow.details.coverage.windowDays).toBe(1);
    // Sites, elements and their tags are all-time: they describe the local index.
    expect(narrow.sites.total).toBe(3);
    expect(narrow.elements.total).toBe(1);
    expect(narrow.technologies.distinct).toBe(4);
    expect(narrow.sites.coverage).toEqual(BASE_COVERAGE);
  });

  it("clamps windowDays and top to the documented range", () => {
    const cache = seeded();
    const low = getIndexStats({ windowDays: 0, top: 0 }, { cache, now: () => NOW });
    expect(low.windowDays).toBe(1);
    expect(low.top).toBe(1);
    const high = getIndexStats({ windowDays: 99_999, top: 999 }, { cache, now: () => NOW });
    expect(high.windowDays).toBe(3650);
    expect(high.top).toBe(50);
  });

  it("returns a well-formed zero result on an empty cache", () => {
    const cache = new Cache(tmpDir(), () => NOW);
    const stats = getIndexStats({}, { cache, now: () => NOW });
    expect(stats.sites.total).toBe(0);
    expect(stats.details.cached).toBe(0);
    expect(stats.elements.total).toBe(0);
    expect(stats.technologies).toMatchObject({ items: [], distinct: 0 });
    expect(stats.colors).toMatchObject({ items: [], detailsParsed: 0 });
    expect(stats.scores).toMatchObject({ n: 0, avg: null, median: null });
    expect(stats.motionLibs).toMatchObject({ items: [], rows: 0 });
    expect(stats.sites.coverage).toEqual({
      sitesTotal: 0,
      note: "locally cached subset",
    });
    expect(stats.details.coverage).toEqual({
      detailsCached: 0,
      sitesTotal: 0,
      windowDays: 90,
      detailParseCap: 500,
      note: "locally cached subset",
    });
  });

  it("skips malformed JSON rows without failing the aggregates", () => {
    const cache = seeded();
    cache.withDbForTest((db) => {
      db.prepare("INSERT INTO meta (key, value, fetchedAt) VALUES (?, ?, ?)").run(
        "detail:bad",
        "{not json",
        NOW,
      );
      db.prepare("INSERT INTO motion_dna (url, data, capturedAt) VALUES (?, ?, ?)").run(
        "https://bad.example",
        "not json",
        NOW,
      );
      db.prepare("UPDATE sites SET tags = ? WHERE slug = ?").run("not json", "gamma");
    });
    const stats = getIndexStats({}, { cache, now: () => NOW });
    // The cached row exists (SQL count) but does not contribute evidence.
    expect(stats.details.cached).toBe(3);
    expect(stats.colors.detailsParsed).toBe(2);
    expect(stats.colors.items).toEqual([
      { hex: "#000000", count: 2 },
      { hex: "#FF0000", count: 1 },
      { hex: "#FFFFFF", count: 1 },
    ]);
    expect(stats.scores).toMatchObject({ n: 2, avg: 7, median: 7 });
    // rows counts parsed DNA rows, so the malformed row is not double-counted.
    expect(stats.motionLibs.rows).toBe(2);
    expect(stats.motionLibs.items).toEqual([
      { lib: "gsap", count: 2 },
      { lib: "three.js", count: 1 },
    ]);
    expect(stats.technologies.items).toEqual([
      { tag: "webgl", count: 2 },
      { tag: "3d", count: 1 },
      { tag: "next-js", count: 1 },
    ]);
    expect(stats.technologies.distinct).toBe(3);
  });

  it("makes zero network requests", () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error("network disabled");
    });
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const cache = seeded();
      getIndexStats({}, { cache, now: () => NOW });
      getIndexStats({ windowDays: 3650 }, { cache, now: () => NOW });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
