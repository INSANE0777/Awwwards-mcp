import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cache } from "../src/cache.js";
import {
  addWatch, listWatches, removeWatch, utcDayStart, fetchNewWinners, recordsFromSiteHtml,
} from "../src/feed.js";
import type { AwwwardsClient } from "../src/awwwards.js";
import type { SiteSummary } from "../src/types.js";

const dirs: string[] = [];
const tmpDir = () => {
  const d = mkdtempSync(join(tmpdir(), "awwwards-mcp-test-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// Fake client: canned listing HTML pages per URL, counting fetches.
function fakeClient(pages: Record<string, string>, fetches = { n: 0 }): AwwwardsClient {
  return {
    getHtml: async (url: string) => {
      fetches.n++;
      const page = pages[url];
      if (page === undefined) throw new Error(`unexpected url: ${url}`);
      return page;
    },
  } as unknown as AwwwardsClient;
}

// One listing page whose 31-card wrapper this test fills with its own cards.
let seq = 0;
function card(title: string, createdAt: number, studio: string): string {
  const slug = `${title.toLowerCase().replace(/\W+/g, "-")}-${seq++}`;
  return (
    `<div data-collectable-model-value="${JSON.stringify({
      slug, title, createdAt, id: seq, tags: ["WebGL"], type: "submission",
      images: { thumbnail: "submissions/2026/09/x.jpg" },
    }).replace(/"/g, "&quot;")}">` +
    `<a href="/sites/${slug}">card</a>` +
    `<a class="figure-rollover__bt" href="https://example.com">live</a>` +
    `<span class="budget-tag--sotd">SOTD</span>` +
    `<h3 class="avatar-name__title">${studio}</h3></div>`
  );
}

const sotdUrl = "https://www.awwwards.com/websites/sites_of_the_day/";

describe("utcDayStart", () => {
  it("floors to UTC midnight", () => {
    // 2026-09-28T03:24:15Z → 2026-09-28T00:00:00Z
    expect(utcDayStart(Date.UTC(2026, 8, 28, 3, 24, 15))).toBe(Date.UTC(2026, 8, 28) / 1000);
  });
});

describe("fetchNewWinners", () => {
  // 2026-09-28T12:00:00Z
  const now = Date.UTC(2026, 8, 28, 12);
  it("seeds the baseline on first call, reports delta on second", async () => {
    const cache = new Cache(tmpDir(), () => Math.floor(now / 1000));
    const dayStart = utcDayStart(now);
    const pages: Record<string, string> = {
      [sotdUrl]: card("Day One", dayStart - 3600, "Alpha") + card("Older", dayStart - 40 * 86400, "Beta"),
    };
    const fetches = { n: 0 };
    const client = fakeClient(pages, fetches);

    const first = await fetchNewWinners(client, cache, { now: () => now });
    expect(first.isNewArrivals).toBe(true);
    expect(first.newWinners).toEqual([]);
    expect(first.totalInListing).toBe(2);
    expect(first.day).toBe("2026-09-28");
    expect(fetches.n).toBe(1);

    // Next day's listing adds a winner; yesterday's entry is still there.
    pages[sotdUrl] += card("Day Two", dayStart + 86400, "Gamma");
    const second = await fetchNewWinners(client, cache, { now: () => now + 86_400_000 });
    expect(second.isNewArrivals).toBe(false);
    expect(second.newWinners.map((s) => s.title)).toEqual(["Day Two"]);
    expect(second.day).toBe("2026-09-29");

    // Same-day re-poll reports nothing (baseline advanced to full listing).
    const third = await fetchNewWinners(client, cache, { now: () => now + 86_400_000 + 3_600_000 });
    expect(third.newWinners).toEqual([]);
  });

  it("re-reports an arrival only once even if the listing keeps it for days", async () => {
    const cache = new Cache(tmpDir(), () => Math.floor(now / 1000));
    const dayStart = utcDayStart(now);
    const persistent = card("Persistent", dayStart - 3600, "Alpha");
    const pages: Record<string, string> = { [sotdUrl]: persistent };
    const client = fakeClient(pages);

    await fetchNewWinners(client, cache, { now: () => now });
    // Stale-by-date entry still on the listing a week later.
    const again = await fetchNewWinners(client, cache, { now: () => now + 7 * 86_400_000 });
    // Persistent is in the baseline → not re-reported even though it remains listed.
    expect(again.newWinners).toEqual([]);
  });

  it("delta rows carry the parsed studio for watch filtering", async () => {
    const cache = new Cache(tmpDir(), () => Math.floor(now / 1000));
    const dayStart = utcDayStart(now);
    const pages = { [sotdUrl]: card("Vela Seed", dayStart, "ToyFight") };
    const client = fakeClient(pages);
    await fetchNewWinners(client, cache, { now: () => now }); // seed
    pages[sotdUrl] += card("Vela Two", dayStart + 86_400, "ToyFight");
    const res = await fetchNewWinners(client, cache, { now: () => now + 86_400_000 });
    expect(res.newWinners.length).toBe(1);
    // The server handler upserts these rows into the sites cache.
    expect(res.newWinners[0].studio).toBe("ToyFight");
  });
});

describe("recordsFromSiteHtml", () => {
  const site: SiteSummary = {
    id: 7, slug: "l-i-s-a", title: "LISA", createdAt: 1, tags: [],
    thumbnailPath: "p.jpg", liveUrl: null, detailPath: "/sites/l-i-s-a",
    awards: ["Site of the Day"], studio: "ToyFight",
  };

  it("turns a site page's Elements section into source=site records", () => {
    const html = readFileSync("test/fixtures/detail.html", "utf8");
    const recs = recordsFromSiteHtml(html, site, 1234);
    expect(recs.length).toBeGreaterThan(0);
    const first = recs[0];
    // Slug namespace is disjoint from gallery slugs: site-<siteslug>-<title>.
    expect(first.slug).toMatch(/^site-l-i-s-a-/);
    expect(first.slug).not.toContain("--");
    expect(first).toMatchObject({
      title: "Virtual assistant",
      mediaPath: "element/2026/08/6a723caaa57bb151055998.mp4",
      mediaType: "video",
      source: "site",
      siteSlug: "l-i-s-a",
      author: "ToyFight",
      cid: "uncategorized",
      fetchedAt: 1234,
    });
  });

  it("returns records even with no studio name (falls back to site title)", () => {
    const html = readFileSync("test/fixtures/detail.html", "utf8");
    const recs = recordsFromSiteHtml(html, { ...site, studio: null }, 1);
    expect(recs[0].author).toBe("LISA");
  });

  it("yields nothing for a page without an Elements section", () => {
    const recs = recordsFromSiteHtml("<html><body>no elements here</body></html>", site, 1);
    expect(recs).toEqual([]);
  });
});

describe("watchlist", () => {
  it("add / list / remove round-trips per kind+pattern", () => {
    const cache = new Cache(tmpDir());
    addWatch(cache, { kind: "studio", pattern: "ToyFight", note: "hero reference" });
    addWatch(cache, { kind: "tag", pattern: "webgl" });
    expect(listWatches(cache).length).toBe(2);
    expect(removeWatch(cache, "studio", "ToyFight")).toBe(true);
    expect(removeWatch(cache, "studio", "ToyFight")).toBe(false); // idempotent remove
    const left = listWatches(cache);
    expect(left.length).toBe(1);
    expect(left[0]).toMatchObject({ kind: "tag", pattern: "webgl" });
  });

  it("listMetaPrefix escapes keys with LIKE wildcards", () => {
    const cache = new Cache(tmpDir());
    addWatch(cache, { kind: "studio", pattern: "100%pure" });
    addWatch(cache, { kind: "studio", pattern: "toton" });
    const hits = listWatches(cache); // prefix "watch_" only
    expect(hits.map((w) => w.pattern).sort()).toEqual(["100%pure", "toton"]);
  });
});
