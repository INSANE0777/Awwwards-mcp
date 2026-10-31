import { describe, expect, it } from "vitest";
import { captureMotionDnaUnified, MOTION_SNIPPET, reduceScan } from "../src/motion-dna.js";
import { SCROLL_CENSUS_SNIPPET } from "../src/census.js";
import type { MotionScan } from "../src/motion-dna.js";

const scan: MotionScan = {
  libs: ["gsap", "scrolltrigger", "lenis"],
  render: ["webgl", "three"],
  scrollTrigger: {
    count: 5, scrubCount: 2, pinCount: 1,
    sample: [
      { start: "top 80%", end: "top 30%", scrub: false, pin: false, duration: 0.7, ease: "power4.out" },
      { start: "top top", end: "200% top", scrub: true, pin: true, duration: 1.2, ease: "none" },
    ],
  },
  tweens: { durations: [0.4, 0.7, 1.2], easeTokens: ["power4.out", "power4.out", "expo.out"] },
  cssBeziers: ["cubic-bezier(0.76, 0, 0.24, 1)", "cubic-bezier(0.76, 0, 0.24, 1)"],
  lenisConfigured: true,
};

describe("reduceScan", () => {
  it("derives stack/scroll/easing/duration vocab from a raw scan", () => {
    const dna = reduceScan("https://example.com", scan, 1700000000000);
    expect(dna.stack.libs).toEqual(["gsap", "scrolltrigger", "lenis"]);
    expect(dna.stack.scrollModel).toBe("lenis");
    expect(dna.scroll).toMatchObject({ triggerCount: 5, scrubCount: 2, pinCount: 1, scrubRatio: 0.4 });
    const eo = dna.easingVocab.find((e) => e.token === "power4.out");
    expect(eo!.uses).toBe(2);
    expect(eo!.bezier).toEqual([0.23, 1, 0.32, 1]);   // via Task 6 table
    // Durations are seconds on the wire (gsap/getAnimations) and milliseconds
    // in durationVocab (d*1000): [400,700,1200] -> quartiles 550/700/950 ms.
    expect(dna.durationVocab).toEqual({ p25: 550, median: 700, p75: 950 });
    expect(dna.capturedAt).toBe(1700000000000);
  });

  it("maps scrollModel: locomotive wins over native; unknown when nothing detected", () => {
    expect(reduceScan("u", { ...scan, libs: [], lenisConfigured: false }, 1).stack.scrollModel).toBe("unknown");
    expect(reduceScan("u", { ...scan, libs: ["locomotive"], lenisConfigured: false }, 1).stack.scrollModel).toBe("locomotive");
  });

  it("derives native scroll model when gsap present but no smooth-scroll lib", () => {
    expect(reduceScan("u", { ...scan, libs: ["gsap"], lenisConfigured: false }, 1).stack.scrollModel).toBe("native");
  });

  it("falls back to unknown duration/easing vocab on empty input", () => {
    const dna = reduceScan("u", { ...scan, tweens: { durations: [], easeTokens: [] }, cssBeziers: [] }, 1);
    expect(dna.durationVocab).toBeNull();
    expect(dna.easingVocab).toHaveLength(0);
  });
});

describe("MOTION_SNIPPET", () => {
  it("is a self-contained browser function (serializable, no outer refs)", () => {
    // Must be a plain function expression like SCAN_SNIPPET, not an arrow —
    // page re-serializes the source, and no outer closure refs may leak in.
    expect(String(MOTION_SNIPPET)).not.toContain("=>");
    expect(typeof MOTION_SNIPPET).toBe("function");
  });

  it("prefers a window ScrollTrigger over the plugin registry, same as the census", () => {
    const g = globalThis as any;
    const prevGsap = g.gsap;
    const prevST = g.ScrollTrigger;
    g.ScrollTrigger = { notA: "ScrollTrigger" };
    g.gsap = {
      plugins: {
        ScrollTrigger: {
          getAll: function () {
            return [{ animation: { vars: { duration: 1 } }, vars: {} }];
          },
        },
      },
    };
    try {
      const scan = MOTION_SNIPPET();
      const census = SCROLL_CENSUS_SNIPPET();
      expect(scan.libs).not.toContain("scrolltrigger");
      expect(scan.scrollTrigger.count).toBe(0);
      expect(census.gsapTriggers).toEqual([]);
    } finally {
      if (prevGsap === undefined) delete g.gsap;
      else g.gsap = prevGsap;
      if (prevST === undefined) delete g.ScrollTrigger;
      else g.ScrollTrigger = prevST;
    }
  });

  it("reports the full registry count while the sample stays capped at 20", () => {
    const g = globalThis as any;
    const prevST = g.ScrollTrigger;
    g.ScrollTrigger = {
      getAll: function () {
        return Array.from({ length: 25 }, function () {
          return { animation: { vars: { duration: 1 } }, vars: {} };
        });
      },
    };
    try {
      const scan = MOTION_SNIPPET();
      expect(scan.scrollTrigger.count).toBe(25);
      expect(scan.scrollTrigger.sample).toHaveLength(20);
    } finally {
      if (prevST === undefined) delete g.ScrollTrigger;
      else g.ScrollTrigger = prevST;
    }
  });

  it("resolves a plugin-only registry (gsap.plugins.ScrollTrigger) from globalThis", () => {
    const g = globalThis as any;
    const prevGsap = g.gsap;
    const prevST = g.ScrollTrigger;
    g.gsap = {
      plugins: {
        ScrollTrigger: {
          getAll: function () {
            return [{ animation: { vars: { duration: 1, ease: "power1.out" } }, vars: { scrub: true } }];
          },
        },
      },
    };
    delete g.ScrollTrigger;
    try {
      const scan = MOTION_SNIPPET();
      expect(scan.libs).toContain("scrolltrigger");
      expect(scan.scrollTrigger.count).toBeGreaterThan(0);
    } finally {
      if (prevGsap === undefined) delete g.gsap;
      else g.gsap = prevGsap;
      if (prevST === undefined) delete g.ScrollTrigger;
      else g.ScrollTrigger = prevST;
    }
  });
});

describe("captureMotionDnaUnified (C2, offline DI)", () => {
  // Fake playwright module: records launches/evaluates, dispatches evaluate
  // results by snippet identity. preScroll's page.evaluate gets the async
  // scroll helper first, then MOTION_SNIPPET, then SCROLL_CENSUS_SNIPPET.
  const scrollScan = {
    anims: [
      { selector: "a", tag: "a", props: ["transform"], durationMs: null, delayMs: null, easing: null, trigger: "gsap-scrolltrigger", scrub: true, pin: false, svgStroke: false },
      { selector: "b", tag: "b", props: ["opacity"], durationMs: null, delayMs: null, easing: null, trigger: "css-keyframe", scrub: false, pin: true, svgStroke: false },
      { selector: "c", tag: "c", props: [], durationMs: null, delayMs: null, easing: null, trigger: "unknown", scrub: false, pin: false, svgStroke: false },
    ],
    smilSelectors: ["#pulse"],
    nativeTimelines: [],
    gsapTriggers: [
      { selector: "a", scrub: true, pin: false, startPx: 0, endPx: 500, progress: 0.1, vars: {} },
      { selector: "b", scrub: false, pin: true, startPx: 0, endPx: 900, progress: 0, vars: {} },
    ],
    gsapRegistryTotal: 2,
  };

  function fakeLoader(dispatch: (fn: unknown) => unknown) {
    const evaluates: unknown[] = [];
    const newPageArgs: unknown[] = [];
    let launches = 0;
    let newPages = 0;
    let closes = 0;
    const loader = async () => ({
      chromium: {
        launch: async () => {
          launches++;
          return {
            newPage: async (pageOpts: unknown) => {
              newPages++;
              newPageArgs.push(pageOpts);
              return {
                goto: async () => {},
                waitForTimeout: async () => {},
                evaluate: async (fn: unknown) => {
                  evaluates.push(fn);
                  return dispatch(fn);
                },
              };
            },
            close: async () => {
              closes++;
            },
          };
        },
      },
    });
    return { loader, evaluates, newPageArgs, counts: () => ({ launches, newPages, closes }) };
  }

  it("one launch, two snippet evaluates (motion first, census second), one close", async () => {
    const fake = fakeLoader((fn) => {
      if (fn === MOTION_SNIPPET) return scan; // reuse the reduceScan fixture
      if (fn === SCROLL_CENSUS_SNIPPET) return scrollScan;
      return undefined; // preScroll's scroll helper evaluate
    });
    const dna = await captureMotionDnaUnified("https://example.com", { loader: fake.loader });
    expect(fake.counts()).toEqual({ launches: 1, newPages: 1, closes: 1 });
    expect(fake.evaluates).toHaveLength(3);
    expect(fake.evaluates[1]).toBe(MOTION_SNIPPET);
    expect(fake.evaluates[2]).toBe(SCROLL_CENSUS_SNIPPET);
    // Existing MotionDna shape survives + summary appended.
    expect(dna.stack.libs).toEqual(["gsap", "scrolltrigger", "lenis"]);
    expect(dna.scroll.triggerCount).toBe(5);
    expect(dna.censusSummary).toBeDefined();
  });

  it("censusSummary: counts verbatim from the census; scrubRatio/pinCount live only in dna.scroll", async () => {
    const fake = fakeLoader((fn) => {
      if (fn === MOTION_SNIPPET) return scan;
      if (fn === SCROLL_CENSUS_SNIPPET) return scrollScan;
      return undefined;
    });
    const dna = await captureMotionDnaUnified("https://example.com", { loader: fake.loader });
    const s = dna.censusSummary!;
    // All 7 trigger sources, tallied per reduceScrollCensus (smil counts
    // selectors even when no anim row carries the trigger).
    expect(Object.keys(s.counts).sort()).toEqual([
      "css-keyframe", "css-scroll-timeline", "css-view-timeline",
      "data-attr", "gsap-scrolltrigger", "smil", "unknown",
    ]);
    expect(s.counts["gsap-scrolltrigger"]).toBe(1);
    expect(s.counts["css-keyframe"]).toBe(1);
    expect(s.counts.smil).toBe(1);
    expect(s.counts.unknown).toBe(1);
    // Runtime scrub/pin truth stays in dna.scroll; the summary carries the
    // census tallies plus the registry row count (diagnostics only).
    expect(Object.keys(s).sort()).toEqual(["counts", "gsapRegistryCount"]);
    expect(s.gsapRegistryCount).toBe(2);
  });

  it("supports the census opts contract: reducedMotion reaches the page context", async () => {
    const fake = fakeLoader((fn) => {
      if (fn === MOTION_SNIPPET) return scan;
      if (fn === SCROLL_CENSUS_SNIPPET) return scrollScan;
      return undefined;
    });
    await captureMotionDnaUnified("https://example.com", {
      loader: fake.loader,
      reducedMotion: true,
      viewport: "mobile",
      waitStrategy: "networkidle",
    });
    const pageOpts = fake.newPageArgs[0] as {
      viewport: { width: number; height: number };
      reducedMotion?: string;
      deviceScaleFactor?: number;
    };
    expect(pageOpts.reducedMotion).toBe("reduce");
    expect(pageOpts.viewport).toEqual({ width: 390, height: 844 });
    expect(pageOpts.deviceScaleFactor).toBe(3);
  });

  it("error contract: rejects like captureMotionDna and still closes the browser", async () => {
    const fake = fakeLoader((fn) => {
      if (fn === MOTION_SNIPPET) throw new Error("boom");
      return undefined;
    });
    await expect(captureMotionDnaUnified("https://example.com", { loader: fake.loader })).rejects.toThrow("boom");
    expect(fake.counts().closes).toBe(1);
  });
});
