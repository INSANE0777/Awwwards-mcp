import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AwwwardsClient } from "../src/awwwards.js";
import { Cache } from "../src/cache.js";
import { createHandlers, SITE_TTL_MS } from "../src/server.js";
import type { SiteSummary } from "../src/types.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function site(slug: string, title: string, tags: string[] = []): SiteSummary {
  return {
    id: 1,
    slug,
    title,
    createdAt: 1789516800,
    tags,
    thumbnailPath: `submissions/${slug}.jpg`,
    liveUrl: "https://example.com",
    detailPath: `/sites/${slug}`,
    awards: [],
  };
}

function slugs(text: string): string[] {
  return [...text.matchAll(/\(slug: ([^)]+)\)/g)].map((match) => match[1]!);
}

describe("search_sites deep FTS results", () => {
  it("filters beyond the old 200-row cap and paginates ranked matches without scraping", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awwwards-search-depth-"));
    dirs.push(dir);
    const cache = new Cache(dir);
    cache.upsertSites([
      ...Array.from({ length: 225 }, (_, i) => site(`showcase-${i}`, "Showcase")),
      site(
        "deep-filtered",
        "An Independent Creative Studio Exploring Interactive Design Projects Across Many Years",
        ["Showcase", "Deep Filter"],
      ),
    ]);

    const ranked = cache.searchSites("showcase", SITE_TTL_MS)!;
    expect(ranked).toHaveLength(226);
    // Short title matches outrank the long, tag-only match. Confirm the test
    // really exercises a row that the old LIMIT 200 would have discarded.
    expect(ranked.findIndex((row) => row.slug === "deep-filtered")).toBeGreaterThanOrEqual(200);

    const fetchFn = vi.fn(async () => new Response(
      readFileSync(join(__dirname, "fixtures", "listing.html"), "utf8"),
      { status: 200 },
    ));
    const client = new AwwwardsClient({ fetchFn: fetchFn as unknown as typeof fetch });
    vi.spyOn(client, "getThumbnail").mockResolvedValue(Buffer.from("offline-image"));
    const search = createHandlers({ cache, client }).search_sites;

    const filtered = await search({ query: "showcase", tags: ["deep-filter"], count: 1 });
    expect(filtered.isError).toBeUndefined();
    expect(filtered.content[0]).toHaveProperty("type", "text");
    expect(filtered.content[0]).toHaveProperty("text", expect.stringContaining("1 site(s) matched"));
    expect(slugs((filtered.content[0] as { text: string }).text)).toEqual(["deep-filtered"]);
    expect(filtered.content.filter((block) => block.type === "image")).toHaveLength(1);
    expect(fetchFn).not.toHaveBeenCalled();

    const deepPage = await search({ query: "showcase", page: 22, count: 10 });
    expect(deepPage.isError).toBeUndefined();
    const deepText = (deepPage.content[0] as { text: string }).text;
    expect(deepText).toContain("226 site(s) matched; showing 211-220");
    const deepSlugs = slugs(deepText);
    expect(new Set(deepSlugs).size).toBe(10);
    const matchingSlugs = new Set(ranked.map((row) => row.slug));
    expect(deepSlugs.every((slug) => matchingSlugs.has(slug))).toBe(true);
    expect(deepPage.content.filter((block) => block.type === "image")).toHaveLength(10);
    expect(fetchFn).not.toHaveBeenCalled();

    cache.setMeta("detail:deep-filtered", { score: 9.8 });
    cache.setMeta("detail:showcase-0", { score: 8.2 });
    const scored = await search({ query: "showcase", sortBy: "score", count: 2 });
    expect(scored.isError).toBeUndefined();
    expect(slugs((scored.content[0] as { text: string }).text)).toEqual([
      "deep-filtered", "showcase-0",
    ]);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
