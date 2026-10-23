import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AwwwardsClient,
  BlockedError,
  canonicalizeTechnology,
  RateLimiter,
  buildFilterUrl,
  elementPosterPath,
  elementUrl,
  thumbnailUrl,
} from "../src/awwwards.js";

const FIXTURES = join(__dirname, "fixtures");
const listingHtml = () => readFileSync(join(FIXTURES, "listing.html"), "utf8");

describe("RateLimiter", () => {
  afterEach(() => vi.useRealTimers());

  it("serializes calls at least intervalMs apart", async () => {
    vi.useFakeTimers();
    const rl = new RateLimiter(1000);
    const stamps: number[] = [];
    const track = async () => {
      await rl.acquire();
      stamps.push(Date.now());
    };
    const a = track();
    const b = track();
    const c = track();
    await vi.advanceTimersByTimeAsync(2500);
    await Promise.all([a, b, c]);
    expect(stamps[1] - stamps[0]).toBeGreaterThanOrEqual(999);
    expect(stamps[2] - stamps[1]).toBeGreaterThanOrEqual(999);
  });
});

describe("buildFilterUrl", () => {
  // Combined filter URLs 404 on awwwards.com (verified 2026-09-17), so exactly
  // one filter wins the URL; priority color > award > technology > first tag.
  it("picks the single most specific filter", () => {
    expect(buildFilterUrl({ color: "#404040" })).toBe(
      "https://www.awwwards.com/websites/%23404040/",
    );
    expect(buildFilterUrl({ award: "sotd" })).toBe(
      "https://www.awwwards.com/websites/sites_of_the_day/",
    );
    expect(buildFilterUrl({ technology: "WebGL", tags: ["3d"] })).toBe(
      "https://www.awwwards.com/websites/webgl/",
    );
    expect(buildFilterUrl({ tags: ["3d", "portfolio"] })).toBe(
      "https://www.awwwards.com/websites/3d/",
    );
    expect(buildFilterUrl({})).toBe("https://www.awwwards.com/websites/");
  });

  // Expanded award collections, each URL live-verified 2026-10-23 (robots.txt
  // allows the plain /websites/<slug>/ paths; every page parses site cards).
  it("builds the expanded award-collection URLs", () => {
    expect(buildFilterUrl({ award: "sotm" })).toBe("https://www.awwwards.com/websites/sites_of_the_month/");
    expect(buildFilterUrl({ award: "soty" })).toBe("https://www.awwwards.com/websites/sites_of_the_year/");
    expect(buildFilterUrl({ award: "nominees" })).toBe("https://www.awwwards.com/websites/nominees/");
    expect(buildFilterUrl({ award: "ecommerce" })).toBe("https://www.awwwards.com/websites/winner_category_ecommerce/");
    expect(buildFilterUrl({ award: "portfolio" })).toBe("https://www.awwwards.com/websites/winner_category_portfolio/");
    expect(buildFilterUrl({ award: "product" })).toBe("https://www.awwwards.com/websites/winner_category_product/");
    expect(buildFilterUrl({ award: "typography" })).toBe("https://www.awwwards.com/websites/winner_category_typography/");
    expect(buildFilterUrl({ award: "businessServices" })).toBe("https://www.awwwards.com/websites/winner_category_business-services/");
    expect(buildFilterUrl({ award: "noCode" })).toBe("https://www.awwwards.com/websites/winner_category_no-code/");
  });

  it("canonicalizes only the URL filter (technology, else first tag)", () => {
    expect(buildFilterUrl({ technology: "NextJS" })).toBe(
      "https://www.awwwards.com/websites/next-js/",
    );
    expect(buildFilterUrl({ tags: ["nextjs", "3d"] })).toBe(
      "https://www.awwwards.com/websites/next-js/",
    );
    // The first tag wins the URL; aliases apply to it, later tags are client-checked.
    expect(buildFilterUrl({ technology: "reactjs", tags: ["threejs"] })).toBe(
      "https://www.awwwards.com/websites/react/",
    );
    expect(buildFilterUrl({ tags: ["3d", "nextjs"] })).toBe(
      "https://www.awwwards.com/websites/3d/",
    );
  });
});

describe("canonicalizeTechnology", () => {
  // Each pair verified against the live /websites/ tag list on 2026-10-23:
  // the target slug exists there and the source token does not, so exact
  // slugs always win. Unverified candidates were dropped, not guessed.
  const pairs: [string, string][] = [
    ["nextjs", "next-js"],
    ["next.js", "next-js"],
    ["nuxtjs", "nuxt-js"],
    ["nuxt.js", "nuxt-js"],
    ["vuejs", "vue-js"],
    ["vue.js", "vue-js"],
    ["reactjs", "react"],
    ["threejs", "three-js"],
    ["three.js", "three-js"],
    ["tailwindcss", "tailwind"],
    ["eleventy", "11ty"],
    ["nodejs", "node-js"],
    ["node.js", "node-js"],
    ["greensock", "gsap"],
    ["sveltejs", "svelte"],
  ];

  it("maps every verified alias to its live slug (case-insensitively)", () => {
    for (const [alias, slug] of pairs) {
      expect(canonicalizeTechnology(alias)).toBe(slug);
      expect(canonicalizeTechnology(alias.toUpperCase())).toBe(slug);
    }
  });

  it("passes exact slugs and unknown tokens through", () => {
    // Targets exist under their own slug: never rewritten.
    for (const exact of ["next-js", "react", "webgl", "gsap", "11ty", "tailwind", "three-js"]) {
      expect(canonicalizeTechnology(exact)).toBe(exact);
    }
    expect(canonicalizeTechnology("some-unknown-tech")).toBe("some-unknown-tech");
    expect(canonicalizeTechnology("WebGL")).toBe("WebGL"); // passthrough keeps casing; buildFilterUrl lowercases after
  });
});

describe("thumbnailUrl", () => {
  it("builds CDN urls in both sizes", () => {
    const p = "submissions/2026/08/abc.jpg";
    expect(thumbnailUrl(p, 880)).toContain("/thumb_880_660/" + p);
    expect(thumbnailUrl(p, 440)).toContain("/thumb_440_330/" + p);
  });
});

describe("elementUrl / elementPosterPath", () => {
  it("builds CDN urls for element media", () => {
    expect(elementUrl("element/2026/08/x.mp4")).toBe(
      "https://assets.awwwards.com/awards/element/2026/08/x.mp4",
    );
  });

  it("derives video posters and passes images through unchanged", () => {
    expect(elementPosterPath("element/2026/08/x.mp4")).toBe("element/2026/08/x_static.jpeg");
    expect(elementPosterPath("element/2026/08/y.jpg")).toBe("element/2026/08/y.jpg");
  });
});

describe("AwwwardsClient", () => {
  const fakeFetch = (body: string | number, status = 200) =>
    vi.fn(async () =>
      new Response(typeof body === "string" ? body : "blocked", {
        status: typeof body === "string" ? status : body,
      }),
    ) as unknown as typeof fetch;

  it("fetches and parses a listing page through the rate limiter", async () => {
    const client = new AwwwardsClient({ fetchFn: fakeFetch(listingHtml()) });
    const html = await client.getHtml("/websites/");
    expect(html).toContain("card-site");
  });

  it.each([403, 429])("throws BlockedError immediately on %i without retrying", async (status) => {
    const fetchFn = fakeFetch(status);
    const client = new AwwwardsClient({ fetchFn });
    await expect(client.getHtml("/websites/")).rejects.toBeInstanceOf(BlockedError);
    expect((fetchFn as any).mock.calls.length).toBe(1);
  });

  it("retries once on a network error then succeeds", async () => {
    const calls = vi.fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(new Response(listingHtml(), { status: 200 }));
    const client = new AwwwardsClient({ fetchFn: calls as unknown as typeof fetch });
    const html = await client.getHtml("/websites/");
    expect(html).toContain("card-site");
    expect(calls.mock.calls.length).toBe(2);
  });

  it("getAsset rejects with the composed HTTP label on non-ok CDN responses", async () => {
    const client = new AwwwardsClient({ fetchFn: fakeFetch(404) });
    const err = await client
      .getAsset("element/2026/08/x.mp4")
      .catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("HTTP 404 fetching asset element/2026/08/x.mp4");
  });
});

describe("AwwwardsClient request timeouts", () => {
  afterEach(() => vi.useRealTimers());
  const stalled = () => new Promise<never>(() => {});
  const timeoutMs = 20;

  it("bounds a hung HTML fetch, aborts each attempt, and paces the retry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const times: number[] = [];
    const signals: AbortSignal[] = [];
    const fetchFn = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      times.push(Date.now());
      signals.push(init!.signal as AbortSignal);
      return stalled(); // Deliberately ignores abort, like some injected fetch mocks.
    });
    const client = new AwwwardsClient({ fetchFn: fetchFn as unknown as typeof fetch, timeoutMs });
    const result = expect(client.getHtml("/websites/")).rejects.toThrow(
      /Timed out fetching page from https:\/\/www\.awwwards\.com\/websites\/ after 20ms.*check connectivity/,
    );
    await vi.advanceTimersByTimeAsync(1021);
    await result;
    expect(times).toEqual([100_000, 101_000]);
    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("times out an HTML body read and retries once with a fresh signal", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const response = new Response("unread body");
    const read = vi.spyOn(response, "text").mockImplementation(stalled);
    const fetchFn = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      signals.push(init!.signal as AbortSignal);
      return Promise.resolve(signals.length === 1 ? response : new Response("recovered"));
    });
    const client = new AwwwardsClient({
      fetchFn: fetchFn as unknown as typeof fetch,
      rateLimiter: new RateLimiter(0),
      timeoutMs,
    });
    const result = client.getHtml("/websites/");
    await vi.advanceTimersByTimeAsync(21);
    expect(await result).toBe("recovered");
    expect(read).toHaveBeenCalledOnce();
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(25);
    expect(signals[1].aborted).toBe(false); // Successful requests clear their deadline.
  });

  it.each(["fetch", "body"])("bounds a hung CDN %s without retrying", async (stage) => {
    vi.useFakeTimers();
    const response = new Response("image bytes");
    const read = vi.spyOn(response, "arrayBuffer").mockImplementation(stalled);
    const fetchFn = vi.fn((_url: string | URL | Request, _init?: RequestInit) =>
      stage === "fetch" ? stalled() : Promise.resolve(response),
    );
    const client = new AwwwardsClient({ fetchFn: fetchFn as unknown as typeof fetch, timeoutMs });
    const result = expect(client.getThumbnail("test.jpg")).rejects.toThrow(
      /Timed out fetching thumbnail test\.jpg from https:\/\/assets\.awwwards\.com\/.*after 20ms.*check connectivity/,
    );
    await vi.advanceTimersByTimeAsync(21);
    await result;
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledTimes(stage === "body" ? 1 : 0);
    expect((fetchFn.mock.calls[0][1]!.signal as AbortSignal).aborted).toBe(true);
  });

  it("rejects invalid timeout settings", () => {
    expect(() => new AwwwardsClient({ timeoutMs: 0 })).toThrow(RangeError);
    expect(() => new AwwwardsClient({ timeoutMs: Infinity })).toThrow(RangeError);
  });
});
