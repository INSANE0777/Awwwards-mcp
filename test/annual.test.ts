import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ANNUAL_TTL_MS,
  getCategories,
  getNominee,
  getNomineeBySlug,
  getNominees,
  resolveNominee,
  type AnnualDeps,
} from "../src/annual.js";
import { AwwwardsClient, BlockedError, RateLimiter } from "../src/awwwards.js";
import { Cache } from "../src/cache.js";
import { createHandlers } from "../src/server.js";
import type { SiteSummary } from "../src/types.js";

const FIXTURES = join(__dirname, "fixtures", "annual");
const categoriesRaw = readFileSync(join(FIXTURES, "categories.json"), "utf8");
const siteRaw = readFileSync(join(FIXTURES, "site-nominee.json"), "utf8");
const userRaw = readFileSync(join(FIXTURES, "user-nominee.json"), "utf8");

const SITE_ID = "09679d45-7588-444b-9288-dc56a11873a1";
const USER_ID = "08af5f2f-d4f6-47e9-9cdb-641841acffff";

const dirs: string[] = [];
const tmpDir = () => {
  const d = mkdtempSync(join(tmpdir(), "awwwards-annual-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

// Offline fetch: routes the three official endpoints to committed fixtures.
// Unknown detail ids 404 so a test never accidentally hits the network.
function fixtureFetch(overrides: {
  site?: (id: string) => Response;
  user?: (id: string) => Response;
  categories?: () => Response;
} = {}) {
  return vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes("/api/annual/categories")) {
      return overrides.categories ? overrides.categories() : json(JSON.parse(categoriesRaw));
    }
    const site = url.match(/\/api\/annual\/nominees\/sites\/([^/?#]+)$/);
    if (site) return overrides.site ? overrides.site(site[1]!) : json(JSON.parse(siteRaw));
    const user = url.match(/\/api\/annual\/nominees\/users\/([^/?#]+)$/);
    if (user) return overrides.user ? overrides.user(user[1]!) : json(JSON.parse(userRaw));
    throw new Error(`unexpected offline fetch: ${url}`);
  });
}

function deps(fetchFn: ReturnType<typeof fixtureFetch>, now: () => number = Date.now): AnnualDeps {
  return {
    cache: new Cache(tmpDir(), now),
    fetchFn: fetchFn as unknown as typeof fetch,
    // Zero interval keeps the offline suite fast; production defaults to 1000.
    rateLimiter: new RateLimiter(0),
  };
}

function categoriesPayload(ids: string[], kind: "site" | "user" = "site", slug = "test-category") {
  return {
    links: { self: "/api/annual/categories" },
    meta: { totalItems: 1 },
    data: [{
      id: `/api/annual/categories/${slug}`,
      type: "Category",
      attributes: { _id: slug, name: slug, slug, _type: kind, nominees: ids },
    }],
  };
}

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function sitePayload(id: string, slug: string) {
  return {
    data: {
      id: `/api/annual/nominees/sites/${id}`,
      type: "Site Nominee",
      attributes: { _id: id, name: slug, slug, images: [], videos: [] },
    },
  };
}

function siteRow(slug: string): SiteSummary {
  return {
    id: 1,
    slug,
    title: "Mario Roudil",
    createdAt: 1789516800,
    tags: ["3D"],
    thumbnailPath: "submissions/2026/08/x.jpg",
    liveUrl: "https://marioroudil.com/",
    detailPath: `/sites/${slug}`,
    awards: ["Site of the Day"],
  };
}

describe("annual API client", () => {
  it("normalizes the categories envelope without exposing nominee ids", async () => {
    const fetchFn = fixtureFetch();
    const result = await getCategories(deps(fetchFn));

    expect(result.categories).toHaveLength(6);
    expect(result.categories[0]).toEqual({
      name: "Site of the Year",
      slug: "site-of-the-year",
      kind: "site",
      nomineeCount: 3,
    });
    expect(result.categories[1]).toMatchObject({
      name: "Agency of the Year",
      kind: "user",
      nomineeCount: 3,
    });
    expect(result.meta).toEqual({ cached: false });
    expect(result.note).toContain("hydrated on request");
    expect(result.note).toContain("reference-only");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const url = String(fetchFn.mock.calls[0]![0]);
    expect(url).toBe("https://www.awwwards.com/api/annual/categories");
  });

  it("normalizes a site nominee leniently", async () => {
    const fetchFn = fixtureFetch();
    const result = await getNominee("site", SITE_ID, deps(fetchFn));

    expect(result.nominee).toMatchObject({
      id: SITE_ID,
      kind: "site",
      slug: "mario-roudil",
      name: "Mario Roudil",
      date: "2025-04-10T00:00:00+00:00",
      designBy: "Rémi Clauss",
      country: "France",
      url: "https://marioroudil.com/",
      awwwardsUrl: "https://www.awwwards.com/sites/mario-roudil",
    });
    if (result.nominee.kind !== "site") throw new Error("expected a site nominee");
    expect(result.nominee.images).toHaveLength(1);
    expect(result.nominee.videos).toHaveLength(7);
    expect(result.meta).toEqual({ cached: false });
    expect(result.mediaNote).toBe("reference-only");
  });

  it("normalizes a user nominee with tags and featured projects", async () => {
    const fetchFn = fixtureFetch();
    const result = await getNominee("user", USER_ID, deps(fetchFn));

    expect(result.nominee).toMatchObject({
      id: USER_ID,
      kind: "user",
      slug: "locomotive",
      name: "Locomotive",
      location: "Canada - Montréal",
      awwwardsUrl: "https://www.awwwards.com/locomotive/",
    });
    if (result.nominee.kind !== "user") throw new Error("expected a user nominee");
    expect(result.nominee.tags[0]).toEqual({ type: "sotd", quantity: 7 });
    expect(result.nominee.featuredProjects).toHaveLength(3);
    expect(result.nominee.featuredProjects[0]).toMatchObject({
      name: "The Culture Index",
      awwwardsUrl: "https://www.awwwards.com/sites/the-culture-index",
    });
  });

  it("serves a fresh cache hit without fetching again", async () => {
    const fetchFn = fixtureFetch();
    const d = deps(fetchFn);
    await getNominee("site", SITE_ID, d);
    const second = await getNominee("site", SITE_ID, d);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(second.meta).toEqual({ cached: true });
    expect(second.meta.stale).toBeUndefined();
  });

  it("serves stale cached categories with stale:true when the API fails", async () => {
    let t = 1_000_000;
    const fetchFn = fixtureFetch();
    const d = deps(fetchFn, () => t);
    await getCategories(d);
    t += ANNUAL_TTL_MS + 1;

    fetchFn.mockImplementation(async () => json({ error: "down" }, 500));
    const stale = await getCategories(d);

    expect(stale.categories).toHaveLength(6);
    expect(stale.meta.cached).toBe(true);
    expect(stale.meta.stale).toBe(true);
    expect(stale.meta.error).toContain("HTTP 500");
  });

  it("marks stale categories blocked when the API returns 403", async () => {
    let t = 1_000_000;
    const fetchFn = fixtureFetch();
    const d = deps(fetchFn, () => t);
    await getCategories(d);
    t += ANNUAL_TTL_MS + 1;
    fetchFn.mockClear();
    fetchFn.mockImplementation(async () => new Response("blocked", { status: 403 }));

    const stale = await getCategories(d);
    expect(stale.categories).toHaveLength(6);
    expect(stale.meta).toMatchObject({ cached: true, stale: true, blocked: true });
    expect(stale.meta.error).toContain("blocking requests");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("serves a stale nominee with stale:true instead of pretending it is fresh", async () => {
    let t = 1_000_000;
    const fetchFn = fixtureFetch();
    const d = deps(fetchFn, () => t);
    const fresh = await getNominee("site", SITE_ID, d);
    t += ANNUAL_TTL_MS + 1;

    fetchFn.mockImplementation(async () => json({ error: "down" }, 500));
    const stale = await getNominee("site", SITE_ID, d);

    expect(stale.nominee).toEqual(fresh.nominee);
    expect(stale.meta).toMatchObject({ cached: true, stale: true });
    expect(stale.meta.error).toContain("HTTP 500");
  });

  it("throws BlockedError on 403 without a retry", async () => {
    const fetchFn = vi.fn(async () => new Response("blocked", { status: 403 }));
    const d = deps(fetchFn as never);

    await expect(getNominee("site", SITE_ID, d)).rejects.toBeInstanceOf(BlockedError);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("rejects an unknown category and lists the known slugs", async () => {
    const d = deps(fixtureFetch());
    await expect(getNominees("not-a-category", {}, d)).rejects.toThrow(
      /Unknown annual category: not-a-category.*site-of-the-year/,
    );
  });

  it("clamps limit to 1-20 and honors offset", async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const fetchFn = vi.fn(async (input: unknown) => {
      if (String(input).includes("/api/annual/categories")) return json(categoriesPayload(ids));
      throw new Error("hydrate=false must not fetch nominee details");
    });
    const d = deps(fetchFn as never);

    const capped = await getNominees("test-category", { limit: 999, hydrate: false }, d);
    expect(capped.total).toBe(25);
    expect(capped.nominees).toHaveLength(20);
    expect(capped.meta.partial).toBe(true);
    expect(capped.nominees[0]).toMatchObject({ hydratePending: true, inLocalIndex: false });

    const one = await getNominees("test-category", { limit: 0, hydrate: false }, d);
    expect(one.nominees).toHaveLength(1);

    const tail = await getNominees("test-category", { offset: 24, limit: 10, hydrate: false }, d);
    expect(tail.nominees).toHaveLength(1);
    expect(tail.nominees[0]!.id).toBe(ids[24]);
  });

  it("hydrates partially when a mid-list nominee fails, then continues", async () => {
    const ids = [uuid(1), uuid(2), uuid(3)];
    const fetchFn = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/api/annual/categories")) return json(categoriesPayload(ids));
      if (url.endsWith(ids[1])) return json({ error: "boom" }, 500);
      return json(JSON.parse(siteRaw.replace(SITE_ID, url.split("/").pop()!)));
    });
    const d = deps(fetchFn as never);

    const result = await getNominees("test-category", { limit: 3 }, d);

    expect(result.nominees).toHaveLength(2);
    expect(result.meta.hydrated).toBe(2);
    expect(result.meta.partial).toBe(true);
    expect(result.meta.error).toContain("HTTP 500");
    // categories + nominee 1 + nominee 2 twice (one retry) + nominee 3
    expect(fetchFn).toHaveBeenCalledTimes(5);
  });

  it("resolves a full path and a bare UUID to the right kind", async () => {
    const fetchFn = fixtureFetch();
    const d = deps(fetchFn);

    const byPath = await resolveNominee(`/api/annual/nominees/users/${USER_ID}`, d);
    expect(byPath.nominee.kind).toBe("user");
    expect(String(fetchFn.mock.calls.at(-1)![0])).toContain(`/nominees/users/${USER_ID}`);

    const byUuid = await resolveNominee(USER_ID, d);
    expect(byUuid.nominee.id).toBe(USER_ID);
    expect(byUuid.meta).toEqual({ cached: true });
  });

  it("rejects malformed or unknown references", async () => {
    const d = deps(fixtureFetch());
    await expect(resolveNominee("not-a-uuid", d)).rejects.toThrow(/Invalid annual nominee reference/);
    await expect(
      resolveNominee("00000000-0000-4000-8000-000000000000", d),
    ).rejects.toThrow(/Unknown annual nominee id/);
  });

  it("finds a nominee by category+slug from cache and marks stale cache", async () => {
    let t = 1_000_000;
    const fetchFn = fixtureFetch();
    const d = deps(fetchFn, () => t);
    await getNominee("site", SITE_ID, d);

    const hit = await getNomineeBySlug("site-of-the-year", "mario-roudil", d);
    expect(hit.meta).toEqual({ cached: true });
    expect(hit.nominee.slug).toBe("mario-roudil");

    t += ANNUAL_TTL_MS + 1;
    const stale = await getNomineeBySlug("site-of-the-year", "mario-roudil", d);
    expect(stale.meta).toMatchObject({ cached: true, stale: true });
  });

  it("marks a list response stale when a cached nominee is served after a failure", async () => {
    let t = 1_000_000;
    const fetchFn = fixtureFetch();
    const d = deps(fetchFn, () => t);
    await getNominee("site", SITE_ID, d);
    await getCategories(d);
    t += ANNUAL_TTL_MS + 1;

    fetchFn.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/api/annual/categories")) return json(JSON.parse(categoriesRaw));
      return json({ error: "down" }, 500);
    });

    const result = await getNominees("site-of-the-year", { limit: 1 }, d);
    expect(result.nominees[0]).toMatchObject({ id: SITE_ID, siteSlug: "mario-roudil" });
    expect(result.meta).toMatchObject({ hydrated: 0, cached: 1, partial: false, stale: true });
    expect(result.meta.error).toContain("HTTP 500");
  });

  it("marks blocked:true and stops after a 403 when stale cache is served", async () => {
    let t = 1_000_000;
    const fetchFn = fixtureFetch();
    const d = deps(fetchFn, () => t);
    await getNominee("site", SITE_ID, d);
    t += ANNUAL_TTL_MS + 1;
    fetchFn.mockClear();
    fetchFn.mockImplementation(async () => new Response("blocked", { status: 403 }));

    const stale = await getNominee("site", SITE_ID, d);
    expect(stale.nominee.id).toBe(SITE_ID);
    expect(stale.meta).toMatchObject({ cached: true, stale: true, blocked: true });
    expect(stale.meta.error).toContain("blocking requests");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("serves stale categories blocked without hydrating any nominee", async () => {
    let t = 1_000_000;
    const fetchFn = fixtureFetch();
    const d = deps(fetchFn, () => t);
    await getCategories(d);
    t += ANNUAL_TTL_MS + 1;
    fetchFn.mockClear();
    fetchFn.mockImplementation(async () => new Response("blocked", { status: 403 }));

    const result = await getNominees("site-of-the-year", { limit: 3 }, d);
    expect(result.nominees).toHaveLength(3);
    expect(result.nominees[0]).toMatchObject({ kind: "site", hydratePending: true });
    expect(result.meta).toMatchObject({
      hydrated: 0,
      cached: 0,
      partial: true,
      stale: true,
      blocked: true,
    });
    expect(result.meta.error).toContain("blocking requests");
    expect(fetchFn).toHaveBeenCalledTimes(1); // categories only
  });

  it("stops list hydration at the first blocked nominee even when stale data is served", async () => {
    const ids = [uuid(1), uuid(2), uuid(3)];
    let t = 1_000_000;
    const fetchFn = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/api/annual/categories")) return json(categoriesPayload(ids));
      const id = url.split("/").pop()!;
      return json(sitePayload(id, `slug-${id.slice(-4)}`));
    });
    const d = deps(fetchFn as never, () => t);
    await getCategories(d);
    for (const id of ids) await getNominee("site", id, d);
    t += ANNUAL_TTL_MS + 1;
    fetchFn.mockClear();
    fetchFn.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/api/annual/categories")) return json(categoriesPayload(ids));
      if (url.endsWith(ids[0]!)) return json(sitePayload(ids[0]!, "first"));
      if (url.endsWith(ids[1]!)) return new Response("blocked", { status: 403 });
      return json(sitePayload(ids[2]!, "third"));
    });

    const result = await getNominees("test-category", { limit: 3 }, d);
    expect(result.nominees.map((n) => n.id)).toEqual([ids[0], ids[1]]);
    expect(result.meta).toMatchObject({
      hydrated: 1,
      cached: 1,
      partial: true,
      stale: true,
      blocked: true,
    });
    const detailUrls = fetchFn.mock.calls
      .map(([input]) => String(input))
      .filter((url) => url.includes("/nominees/"));
    expect(detailUrls).toHaveLength(2);
    expect(detailUrls.some((url) => url.includes(ids[2]!))).toBe(false);
  });

  it("stops list hydration at a thrown block with no stale cache", async () => {
    const ids = [uuid(1), uuid(2), uuid(3)];
    const fetchFn = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/api/annual/categories")) return json(categoriesPayload(ids));
      return new Response("blocked", { status: 403 });
    });
    const d = deps(fetchFn as never);

    const result = await getNominees("test-category", { limit: 3 }, d);
    expect(result.nominees).toEqual([]);
    expect(result.meta).toMatchObject({
      hydrated: 0,
      cached: 0,
      partial: true,
      blocked: true,
    });
    expect(result.meta.error).toContain("blocking requests");
    const detailUrls = fetchFn.mock.calls
      .map(([input]) => String(input))
      .filter((url) => url.includes("/nominees/"));
    expect(detailUrls).toHaveLength(1);
    expect(detailUrls[0]).toContain(ids[0]!);
  });

  it("rejects non-UUID path segments with zero HTTP calls", async () => {
    const fetchFn = fixtureFetch();
    const d = deps(fetchFn);

    for (const ref of [
      "/api/annual/nominees/sites/..",
      "/api/annual/nominees/sites/not-a-uuid",
      "/api/annual/nominees/users/x",
    ]) {
      await expect(resolveNominee(ref, d)).rejects.toThrow(/Invalid annual nominee reference/);
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("skips every cached candidate during a slug hydration scan", async () => {
    const ids = [uuid(1), uuid(2), uuid(3)];
    let t = 1_000_000;
    const fetchFn = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/api/annual/categories")) return json(categoriesPayload(ids));
      const id = url.split("/").pop()!;
      return json(sitePayload(id, `slug-${id.slice(-4)}`));
    });
    const d = deps(fetchFn as never, () => t);
    await getNominee("site", ids[0]!, d);
    await getNominee("site", ids[1]!, d);
    t += ANNUAL_TTL_MS + 1;
    fetchFn.mockClear();

    const found = await getNomineeBySlug("test-category", `slug-${ids[2]!.slice(-4)}`, d);
    expect(found.nominee.id).toBe(ids[2]);
    const detailUrls = fetchFn.mock.calls
      .map(([input]) => String(input))
      .filter((url) => url.includes("/nominees/"));
    expect(detailUrls).toHaveLength(1);
    expect(detailUrls[0]).toContain(ids[2]!);
  });

  it("surfaces the first slug-scan API failure instead of not-found", async () => {
    const ids = [uuid(1), uuid(2)];
    const fetchFn = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/api/annual/categories")) return json(categoriesPayload(ids));
      if (url.endsWith(ids[0]!)) return json({ error: "down" }, 500);
      return json(sitePayload(ids[1]!, "other"));
    });
    const d = deps(fetchFn as never);

    await expect(getNomineeBySlug("test-category", "wanted", d)).rejects.toThrow(/HTTP 500/);
    const urls = fetchFn.mock.calls.map(([input]) => String(input));
    expect(urls.filter((url) => url.includes(ids[1]!))).toHaveLength(0);
    // categories + two attempts for ids[0] (one retry)
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("stops a slug scan on a blocked fetch without touching later ids", async () => {
    const ids = [uuid(1), uuid(2)];
    const fetchFn = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/api/annual/categories")) return json(categoriesPayload(ids));
      return new Response("blocked", { status: 403 });
    });
    const d = deps(fetchFn as never);

    await expect(getNomineeBySlug("test-category", "wanted", d)).rejects.toBeInstanceOf(BlockedError);
    const urls = fetchFn.mock.calls.map(([input]) => String(input));
    expect(urls.filter((url) => url.includes(ids[1]!))).toHaveLength(0);
    expect(fetchFn).toHaveBeenCalledTimes(2); // categories + one 403, no retry
  });

  it("does not scan nominees via slug when stale categories are blocked", async () => {
    let t = 1_000_000;
    const fetchFn = fixtureFetch();
    const d = deps(fetchFn, () => t);
    await getCategories(d);
    await getNominee("site", SITE_ID, d);
    t += ANNUAL_TTL_MS + 1;
    fetchFn.mockClear();
    fetchFn.mockImplementation(async () => new Response("blocked", { status: 403 }));

    const cached = await getNomineeBySlug("site-of-the-year", "mario-roudil", d);
    expect(cached.nominee.id).toBe(SITE_ID);
    expect(cached.meta).toMatchObject({ cached: true, stale: true, blocked: true });
    expect(fetchFn).toHaveBeenCalledTimes(1); // categories only, no scan
  });

  it("resolves a bare UUID from stale blocked categories without a nominee request", async () => {
    let t = 1_000_000;
    const fetchFn = fixtureFetch();
    const d = deps(fetchFn, () => t);
    await getCategories(d);
    await getNominee("site", SITE_ID, d);
    t += ANNUAL_TTL_MS + 1;
    fetchFn.mockClear();
    fetchFn.mockImplementation(async () => new Response("blocked", { status: 403 }));

    const cached = await resolveNominee(SITE_ID, d);
    expect(cached.nominee.id).toBe(SITE_ID);
    expect(cached.meta).toMatchObject({ cached: true, stale: true, blocked: true });
    expect(fetchFn).toHaveBeenCalledTimes(1); // categories only
  });

  it("builds summaries with siteSlug and inLocalIndex from cache only", async () => {
    const fetchFn = fixtureFetch();
    const d = deps(fetchFn);

    const before = await getNominees("site-of-the-year", { limit: 1 }, d);
    expect(before.nominees[0]).toMatchObject({
      id: SITE_ID,
      kind: "site",
      slug: "mario-roudil",
      siteSlug: "mario-roudil",
      inLocalIndex: false,
      image: expect.stringContaining("assets.awwwards.com"),
    });

    d.cache.upsertSites([siteRow("mario-roudil")]);
    const after = await getNominees("site-of-the-year", { limit: 1 }, d);
    expect(after.nominees[0]!.inLocalIndex).toBe(true);
    expect(after.meta).toMatchObject({ hydrated: 0, cached: 1, partial: false });
  });
});

describe("annual tools", () => {
  const cache = () => new Cache(tmpDir());
  const client = () =>
    new AwwwardsClient({ fetchFn: (async () => {
      throw new Error("handler tests must not fetch");
    }) as unknown as typeof fetch });

  it("returns categories JSON from the injected provider", async () => {
    const h = createHandlers({
      client: client(),
      cache: cache(),
      annualCategoriesFn: async () => ({
        categories: [{ name: "Site of the Year", slug: "site-of-the-year", kind: "site", nomineeCount: 30 }],
        meta: { cached: false },
        note: "Nominees hydrate on request; media is reference-only.",
      }),
    });
    const res = await h.get_annual_categories();
    expect(res.isError).toBeUndefined();
    expect(JSON.parse((res.content[0] as { text: string }).text)).toEqual({
      categories: [{ name: "Site of the Year", slug: "site-of-the-year", kind: "site", nomineeCount: 30 }],
      meta: { cached: false },
      note: "Nominees hydrate on request; media is reference-only.",
    });
  });

  it("forwards list args and returns the nominees payload", async () => {
    const fn = vi.fn(async () => ({
      category: { name: "Agency of the Year", slug: "agency-of-the-year", kind: "user" as const, nomineeCount: 30 },
      total: 30,
      nominees: [{ id: USER_ID, kind: "user" as const, slug: "locomotive", inLocalIndex: false }],
      meta: { hydrated: 1, cached: 0, partial: false, note: "note" },
    }));
    const h = createHandlers({ client: client(), cache: cache(), annualNomineesFn: fn });

    const res = await h.get_annual_nominees({ category: "agency-of-the-year", limit: 3, offset: 2, hydrate: false });
    expect(fn).toHaveBeenCalledWith({ category: "agency-of-the-year", limit: 3, offset: 2, hydrate: false });
    expect(JSON.parse((res.content[0] as { text: string }).text)).toMatchObject({
      total: 30,
      nominees: [{ id: USER_ID, kind: "user", slug: "locomotive" }],
      meta: { hydrated: 1, cached: 0, partial: false },
    });
  });

  it("returns a nominee by id and by category+slug", async () => {
    const nominee = {
      id: SITE_ID,
      kind: "site" as const,
      slug: "mario-roudil",
      awwwardsUrl: "https://www.awwwards.com/sites/mario-roudil",
      images: [],
      videos: [],
    };
    const fn = vi.fn(async () => ({
      nominee,
      meta: { cached: true },
      mediaNote: "reference-only" as const,
    }));
    const h = createHandlers({ client: client(), cache: cache(), annualNomineeFn: fn });

    const byId = await h.get_annual_nominee({ id: SITE_ID });
    const byIdBody = JSON.parse((byId.content[0] as { text: string }).text);
    expect(byIdBody.nominee.slug).toBe("mario-roudil");
    expect(byIdBody.mediaNote).toBe("reference-only");

    await h.get_annual_nominee({ category: "site-of-the-year", slug: "mario-roudil" });
    expect(fn).toHaveBeenLastCalledWith({ category: "site-of-the-year", slug: "mario-roudil" });
  });

  it("rejects a nominee call with neither id nor category+slug", async () => {
    const fn = vi.fn();
    const h = createHandlers({ client: client(), cache: cache(), annualNomineeFn: fn });
    const res = await h.get_annual_nominee({});
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toContain("Provide either id");
    expect(fn).not.toHaveBeenCalled();
  });
});
