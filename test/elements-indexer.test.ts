import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AwwwardsClient } from "../src/awwwards.js";
import { Cache } from "../src/cache.js";
import type { ElementRecord } from "../src/types.js";
import { normalizeCategory, runElementsIndexer } from "../src/elements-indexer.js";

const FIXTURES = join(__dirname, "fixtures");
// Repo uses core.autocrlf=true: normalize CRLF so parser behavior is
// checkout-independent (same helper shape as parsers.test.ts).
const readFixture = (name: string): string =>
  readFileSync(join(FIXTURES, name), "utf8").replace(/\r\n/g, "\n");
const galleryHtml = readFixture("elements-listing.html");
const itemHtml = readFixture("elements-item.html");

describe("normalizeCategory", () => {
  it("slug-izes display categories", () => {
    expect(normalizeCategory("Micro Interactions!")).toBe("micro-interactions");
    expect(normalizeCategory(null)).toBe("unsorted");
  });
});

describe("runElementsIndexer", () => {
  it("crawls listing + item pages, upserts gallery records, stamps meta", async () => {
    const fetchFn = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/elements/")) return new Response(galleryHtml, { status: 200 });
      return new Response(itemHtml, { status: 200 });
    });
    const client = new AwwwardsClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const dir = mkdtempSync(join(tmpdir(), "aww-eix-"));
    const cache = new Cache(dir);
    try {
      const res = await runElementsIndexer({ client, cache, maxItems: 3 });
      // 3 item pages fetched and parsed from the listing's first 3 slugs.
      expect(res.itemsIndexed).toBe(3);
      expect(fetchFn).toHaveBeenCalledTimes(4); // 1 listing + 3 item pages
      // But every item fetch serves the SAME fixture, whose canonical link
      // carries slug "about-page-realevate" (Task 2 fixture lesson) — the
      // upsert dedupes the 3 records down to 1 gallery row.
      expect(cache.countElements()).toBe(1);
      const first = cache.listElements(1)[0]; // brief's db.prepare fallback is unavailable (no public db handle)
      expect(first.source).toBe("gallery");
      expect(first.projectId).toBeNull();
      expect(first.slug).toBe("about-page-realevate");
      // Second run within stale window skips fetching entirely.
      const callsBefore = fetchFn.mock.calls.length;
      const res2 = await runElementsIndexer({ client, cache, maxItems: 3 });
      expect(res2.skipped).toBe(true);
      expect(res2.itemsIndexed).toBe(0);
      expect(fetchFn.mock.calls.length).toBe(callsBefore);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not stamp freshness meta when every item fetch fails", async () => {
    // Listing parses but every item page 403s → records empty → no upsert
    // and no "elements_indexed_at", so the stale gate lets a retry in
    // instead of blocking re-indexing for 7 days against 0 rows.
    const fetchFn = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/elements/")) return new Response(galleryHtml, { status: 200 });
      return new Response("blocked", { status: 403 });
    });
    const client = new AwwwardsClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const dir = mkdtempSync(join(tmpdir(), "aww-eix3-"));
    const cache = new Cache(dir);
    try {
      const res = await runElementsIndexer({ client, cache, maxItems: 3 });
      expect(res.itemsIndexed).toBe(0);
      expect(cache.countElements()).toBe(0);
      expect(cache.getMeta("elements_indexed_at", Number.POSITIVE_INFINITY)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("crawls additional listing pages via ?page=N until maxPages, deduping slugs", async () => {
    // Page 2 returns a fresh slug set; page 3 404s (loop stops early).
    // Every item fetch serves the same fixture → canonical slug dedupes.
    // Default maxPages is 1 (auto-index stays cheap); pagination is opt-in.
    const page2Html = galleryHtml.replace(
      'href="/inspiration/about-page-realevate/"',
      'href="/inspiration/second-page-fixture/"',
    );
    const fetchFn = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith("/elements/")) return new Response(galleryHtml, { status: 200 });
      if (url.includes("/elements/?page=2")) return new Response(page2Html, { status: 200 });
      if (url.includes("/elements/?page=")) return new Response("gone", { status: 404 });
      return new Response(itemHtml, { status: 200 });
    });
    const client = new AwwwardsClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const dir = mkdtempSync(join(tmpdir(), "aww-eix4-"));
    const cache = new Cache(dir);
    try {
      const res = await runElementsIndexer({ client, cache, maxPages: 2, maxItems: 10 });
      // Page 1 slugs + page 2's new slug, deduped across pages. All item
      // pages serve the same canonical fixture slug, so upserts collapse to
      // 1 stored row — but all 10 distinct slugs were fetched and reported.
      expect(res.itemsIndexed).toBe(10); // 10 distinct listing slugs fetched
      expect(cache.countElements()).toBe(1); // same canonical slug → 1 row
      const listedUrls = fetchFn.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("/elements/"));
      expect(listedUrls.some((u) => u.endsWith("/elements/"))).toBe(true);
      expect(listedUrls.some((u) => u.includes("page=2"))).toBe(true);
      expect(listedUrls.some((u) => /page=3/.test(u))).toBe(false); // 404 stops the loop
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not overwrite related/site rows it did not fetch", async () => {
    // Tier B row present before indexing; the Tier A crawl (which never
    // fetched this slug) must leave it untouched — source and projectId
    // survive the upsert run.
    const fetchFn = vi.fn(async () => new Response(itemHtml, { status: 200 }));
    const client = new AwwwardsClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const dir = mkdtempSync(join(tmpdir(), "aww-eix2-"));
    const cache = new Cache(dir);
    try {
      // ElementRecord requires non-nullable cid/category/author/mediaPath —
      // brief's nulls adapted to empty strings for the type.
      const tierBRow: ElementRecord = {
        slug: "site-only-element",
        title: "Site Element",
        cid: "unsorted",
        category: "",
        author: "",
        builtWith: [],
        related: [],
        mediaPath: "",
        mediaType: null,
        source: "site",
        projectId: "l-i-s-a",
        siteSlug: null,
        fetchedAt: 1,
      };
      cache.upsertElements([tierBRow]);
      await runElementsIndexer({ client, cache, maxItems: 2 });
      const kept = cache.getElements(["site-only-element"]);
      expect(kept.length).toBe(1);
      expect(kept[0].source).toBe("site");
      expect(kept[0].projectId).toBe("l-i-s-a");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
