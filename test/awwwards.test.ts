import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AwwwardsClient,
  BlockedError,
  canonicalFacet,
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

  it("normalizes the URL facet with the same path used for client matching", () => {
    // Whitespace and punctuation cannot produce a different URL facet than
    // the one matchesFilters compares against.
    expect(buildFilterUrl({ technology: " next js " })).toBe(
      "https://www.awwwards.com/websites/next-js/",
    );
    expect(buildFilterUrl({ tags: ["Magazine / Newspaper / Blog"] })).toBe(
      "https://www.awwwards.com/websites/magazine-newspaper-blog/",
    );
    expect(canonicalFacet(" Next.js ")).toBe("next-js");
  });
});

describe("canonicalFacet display-name pairs", () => {
  // Live /websites/ pairs where the visible tag's slug differs from the URL
  // slug. Both the display name and the URL slug must normalize to the URL
  // slug, and the URL builder must use it.
  const pairs: Array<[display: string, urlSlug: string]> = [
    ["Adobe Illustrator", "illustrator"],
    ["Adobe Photoshop", "photoshop"],
    ["Angular", "angularjs"],
    ["CSS", "css3"],
    ["Curtains.js", "curtains"],
    ["Matter.js", "matterjs"],
    ["P5.js", "p5js"],
    ["Sketch", "sketchapp"],
    ["Swiper.js", "swiper"],
    ["Navigation Menu", "navigation"],
    ["SEO", "seo-1"],
  ];

  it("meets display slug and URL slug on the URL slug", () => {
    for (const [display, urlSlug] of pairs) {
      expect(canonicalFacet(display), display).toBe(urlSlug);
      expect(canonicalFacet(urlSlug), urlSlug).toBe(urlSlug);
      expect(buildFilterUrl({ technology: display })).toBe(
        `https://www.awwwards.com/websites/${urlSlug}/`,
      );
      expect(buildFilterUrl({ technology: urlSlug })).toBe(
        `https://www.awwwards.com/websites/${urlSlug}/`,
      );
    }
  });

  it("leaves the free-text alias table unchanged for cache FTS", () => {
    // The display-slug mapping lives only in canonicalFacet; widening
    // canonicalizeTechnology would rewrite free-text query tokens.
    expect(canonicalizeTechnology("css")).toBe("css");
    expect(canonicalizeTechnology("illustrator")).toBe("illustrator");
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
    expect(canonicalizeTechnology("WebGL")).toBe("WebGL"); // passthrough keeps casing; canonicalFacet slugifies it
  });

  it("never resolves inherited object names through the alias tables", () => {
    // Own-property lookup: a bare table[key] returned Object.prototype's
    // constructor/toString and canonicalFacet leaked the same way.
    for (const token of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(canonicalizeTechnology(token), token).toBe(token);
    }
    expect(canonicalFacet("constructor")).toBe("constructor");
    expect(canonicalFacet("__proto__")).toBe("proto"); // slugified before lookup
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

  it("cancels the body of a 500 response before both retries", async () => {
    const cancelled = vi.fn();
    const fetchFn = vi.fn(async () => {
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("error body"));
        },
        cancel: cancelled,
      });
      return new Response(body, { status: 500 });
    });
    const client = new AwwwardsClient({
      fetchFn: fetchFn as unknown as typeof fetch,
      rateLimiter: new RateLimiter(0),
    });
    await expect(client.getHtml("/sites/error")).rejects.toThrow(
      /HTTP 500 for https:\/\/www\.awwwards\.com\/sites\/error/,
    );
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(cancelled).toHaveBeenCalledTimes(2);
  });

  it("cancels the body of a 403 response before throwing BlockedError", async () => {
    const cancelled = vi.fn();
    const fetchFn = vi.fn(async () => {
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("blocked body"));
        },
        cancel: cancelled,
      });
      return new Response(body, { status: 403 });
    });
    const client = new AwwwardsClient({ fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.getHtml("/sites/blocked")).rejects.toBeInstanceOf(BlockedError);
    expect(fetchFn).toHaveBeenCalledOnce();
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("keeps BlockedError when a 403 body cancel outlasts the deadline", async () => {
    const cancelled = vi.fn();
    const fetchFn = vi.fn(async () => {
      const body = new ReadableStream({
        cancel: () => {
          cancelled();
          return new Promise<void>((resolve) => setTimeout(resolve, 45));
        },
      });
      return new Response(body, { status: 403 });
    });
    const client = new AwwwardsClient({ fetchFn: fetchFn as unknown as typeof fetch, timeoutMs: 20 });
    await expect(client.getHtml("/sites/blocked")).rejects.toBeInstanceOf(BlockedError);
    expect(fetchFn).toHaveBeenCalledOnce();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(cancelled).toHaveBeenCalledOnce();
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

  it.each([
    "/elements/",
    "/elements",
    "/elements/?page=2",
    "/elements?page=2",
    "/elements/footer/",
    "/elements/%2e%2e%2fsites/",
    "https://www.awwwards.com/elements/?page=2",
    "/%65lements/",
    "/%2565lements/",
    "/%65lements/%FF",
    "/%25252565lements/",
    "/x/%2e%2e/elements/",
    "/%65lements%5Cfooter",
    "/elements%5c..%5csites/",
    "/%65lements%5c..%5csites/",
  ])("rejects robots-disallowed %s before any fetch", async (path) => {
    const fetchFn = fakeFetch(listingHtml());
    const client = new AwwwardsClient({ fetchFn });
    await expect(client.getHtml(path)).rejects.toThrow(/robots-disallowed \/elements\/\*/);
    expect((fetchFn as any).mock.calls.length).toBe(0);
  });

  it("fails closed on encoding deeper than eight rounds", async () => {
    const path = "/%252525252525252565lements/";
    const fetchFn = fakeFetch(listingHtml());
    const client = new AwwwardsClient({ fetchFn });
    await expect(client.getHtml(path)).rejects.toThrow(/over-encoded path/);
    expect((fetchFn as any).mock.calls.length).toBe(0);
  });

  it("refuses a redirect into the element gallery before fetching the destination", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(null, { status: 302, headers: { Location: "/elements/footer/" } }),
    ) as unknown as typeof fetch;
    const client = new AwwwardsClient({ fetchFn });
    await expect(client.getHtml("/sites/redirect")).rejects.toThrow(
      /robots-disallowed \/elements\/\*/,
    );
    expect((fetchFn as any).mock.calls.length).toBe(1);
    expect((fetchFn as any).mock.calls[0][0]).toBe("https://www.awwwards.com/sites/redirect");
  });

  it.each([
    "/%65lements/%FF",
    "/%25252565lements/",
    "/elements/%2e%2e%2fsites/",
    "/elements%5c..%5csites/",
    "/%65lements%5c..%5csites/",
  ])(    "refuses a redirect to encoded or traversing gallery path %s",
    async (location) => {
      const fetchFn = vi.fn(async () =>
        new Response(null, { status: 302, headers: { Location: location } }),
      ) as unknown as typeof fetch;
      const client = new AwwwardsClient({ fetchFn });
      await expect(client.getHtml("/sites/redirect")).rejects.toThrow(
        /robots-disallowed \/elements\/\*/,
      );
      expect((fetchFn as any).mock.calls.length).toBe(1);
    },
  );

  it("cancels the redirect body it refuses to follow", async () => {
    const cancelled = vi.fn();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("nonempty"));
      },
      cancel: cancelled,
    });
    const fetchFn = vi.fn(async () =>
      new Response(body, { status: 302, headers: { Location: "/elements/footer/" } }),
    ) as unknown as typeof fetch;
    const client = new AwwwardsClient({ fetchFn });
    await expect(client.getHtml("/sites/redirect")).rejects.toThrow(
      /robots-disallowed \/elements\/\*/,
    );
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("rejects a malformed redirect Location and cancels every body", async () => {
    const cancelled = vi.fn();
    const fetchFn = vi.fn(async () => {
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("nonempty"));
        },
        cancel: cancelled,
      });
      return new Response(body, { status: 302, headers: { Location: "http://[" } });
    }) as unknown as typeof fetch;
    const client = new AwwwardsClient({
      fetchFn,
      rateLimiter: new RateLimiter(0),
    });
    await expect(client.getHtml("/sites/redirect")).rejects.toThrow(
      /Invalid redirect Location "http:\/\/\["/,
    );
    // One refused redirect per attempt; each response body must be released.
    expect(cancelled).toHaveBeenCalledTimes(2);
  });

  it("acquires the rate limiter before every redirect hop", async () => {
    const acquire = vi.fn(async () => {});
    const limiter = { acquire } as unknown as RateLimiter;
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { Location: "/sites/a" } }),
      )
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { Location: "/sites/b" } }),
      )
      .mockResolvedValueOnce(new Response(listingHtml(), { status: 200 }));
    const client = new AwwwardsClient({
      fetchFn: fetchFn as unknown as typeof fetch,
      rateLimiter: limiter,
    });
    await client.getHtml("/sites/start");
    expect(acquire).toHaveBeenCalledTimes(3);
  });

  it("follows a normal redirect to the final page", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { Location: "/sites/final" } }),
      )
      .mockResolvedValueOnce(new Response(listingHtml(), { status: 200 }));
    const client = new AwwwardsClient({ fetchFn: fetchFn as unknown as typeof fetch });
    const html = await client.getHtml("/sites/ok");
    expect(html).toContain("card-site");
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[1][0]).toBe("https://www.awwwards.com/sites/final");
  });

  it("still fetches inspiration, site, and non-gallery elements-prefixed pages", async () => {
    const fetchFn = fakeFetch(listingHtml());
    const client = new AwwwardsClient({ fetchFn });
    await client.getHtml("/inspiration/x/");
    await client.getHtml("/sites/x");
    await client.getHtml("/elements-other");
    expect((fetchFn as any).mock.calls.length).toBe(3);
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

  it("waits for the rate limiter outside the network deadline", async () => {
    const abortedAtCall: boolean[] = [];
    const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      abortedAtCall.push((init!.signal as AbortSignal).aborted);
      return new Response("ok");
    });
    const client = new AwwwardsClient({
      rateLimiter: {
        acquire: () => new Promise<void>((resolve) => setTimeout(resolve, 35)),
      } as unknown as RateLimiter,
      fetchFn: fetchFn as unknown as typeof fetch,
      timeoutMs,
    });
    await expect(client.getHtml("/sites/ok")).resolves.toBe("ok");
    expect(abortedAtCall).toEqual([false]);
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("a timed-out redirect hop starts no further fetch before the retry", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { Location: "/sites/hop2" } }),
      )
      .mockImplementation(stalled);
    const client = new AwwwardsClient({ fetchFn: fetchFn as unknown as typeof fetch, timeoutMs });
    const result = expect(client.getHtml("/sites/start")).rejects.toThrow(
      /Timed out fetching page from https:\/\/www\.awwwards\.com\/sites\/start after 20ms/,
    );
    // Hop 2 starts after the 1s limiter wait and times out 20ms later.
    await vi.advanceTimersByTimeAsync(1021);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    // Only the outer retry (after its own limiter wait) fetches again.
    await vi.advanceTimersByTimeAsync(1000);
    await result;
  });

  it("does not follow a redirect whose body cancel outlasts the hop deadline", async () => {
    const fetchFn = vi.fn((url: string | URL | Request) => {
      if (String(url).endsWith("/sites/dest")) {
        return Promise.resolve(new Response("destination"));
      }
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("nonempty"));
        },
        cancel: () => new Promise<void>((resolve) => setTimeout(resolve, 45)),
      });
      return Promise.resolve(
        new Response(body, { status: 302, headers: { Location: "/sites/dest" } }),
      );
    });
    const client = new AwwwardsClient({
      fetchFn: fetchFn as unknown as typeof fetch,
      rateLimiter: new RateLimiter(0),
      timeoutMs,
    });
    await expect(client.getHtml("/sites/start")).rejects.toThrow(
      /Timed out fetching page from https:\/\/www\.awwwards\.com\/sites\/start after 20ms/,
    );
    // Both attempts fetch only the original URL; the destination is never reached.
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(
      fetchFn.mock.calls.filter(([url]) => String(url).endsWith("/sites/dest")),
    ).toHaveLength(0);
  });

  it("still rejects at the deadline when a redirect body cancel never settles", async () => {
    const fetchFn = vi.fn((url: string | URL | Request) => {
      const body = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("nonempty"));
        },
        cancel: () => new Promise<void>(() => {}),
      });
      if (String(url).endsWith("/sites/dest")) {
        return Promise.resolve(new Response(body, { status: 200 }));
      }
      return Promise.resolve(
        new Response(body, { status: 302, headers: { Location: "/sites/dest" } }),
      );
    });
    const client = new AwwwardsClient({
      fetchFn: fetchFn as unknown as typeof fetch,
      rateLimiter: new RateLimiter(0),
      timeoutMs,
    });
    await expect(client.getHtml("/sites/start")).rejects.toThrow(
      /Timed out fetching page from https:\/\/www\.awwwards\.com\/sites\/start after 20ms/,
    );
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(
      fetchFn.mock.calls.filter(([url]) => String(url).endsWith("/sites/dest")),
    ).toHaveLength(0);
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
