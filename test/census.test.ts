import { describe, expect, it } from "vitest";
import { SCROLL_CENSUS_SNIPPET, reduceScrollCensus, captureScrollCensus, sampleKeyframes } from "../src/census.js";
import type { RawAnim, ScrollScan, GsapTriggerRow } from "../src/census.js";

// Fixture builder: Trigger is used verbatim in results, so tests can encode
// expected counts by handing raw anims pre-classified (the snippet owns the
// in-page classification; the reducer trusts it).
const anim = (p: Partial<RawAnim>): RawAnim => ({
  selector: p.selector ?? "div.x",
  tag: p.tag ?? "div",
  props: p.props ?? ["transform"],
  durationMs: p.durationMs ?? 600,
  delayMs: p.delayMs ?? null,
  easing: p.easing ?? null,
  trigger: p.trigger ?? "css-keyframe",
  scrub: p.scrub ?? false,
  pin: p.pin ?? false,
  svgStroke: false,
});

const scan: ScrollScan = {
  anims: [
    anim({ selector: "section.hero", trigger: "css-keyframe" }),
    anim({ selector: "div.scrub", trigger: "gsap-scrolltrigger", scrub: true }),
    anim({ selector: "p.view", trigger: "css-view-timeline" }),
    anim({ selector: "div.pin", trigger: "gsap-scrolltrigger", pin: true }),
  ],
  smilSelectors: ["svg#logo"],
  nativeTimelines: [{ selector: "main", kind: "scroll" }],
  gsapTriggers: [],
};

describe("reduceScrollCensus", () => {
  it("counts by trigger and sorts anims with scrub/pin first", () => {
    const c = reduceScrollCensus("https://example.com", scan, 1700000000000);
    expect(c.counts["gsap-scrolltrigger"]).toBe(2);
    expect(c.counts["css-keyframe"]).toBe(1);
    expect(c.counts["css-view-timeline"]).toBe(1);
    expect(c.anims[0].selector).toBe("div.scrub");
    expect(c.svgStrokes).toEqual(["svg#logo"]);
    expect(c.nativeScrollTimelines).toBe(1);
    expect(c.url).toBe("https://example.com");
    expect(c.capturedAt).toBe(1700000000000);
    expect(c.reducedMotion).toBe(false);
  });

  it("marks svgStroke when stroke props are animated", () => {
    const c = reduceScrollCensus("u", {
      anims: [anim({ selector: "svg path", props: ["stroke-dashoffset"] })],
      smilSelectors: [],
      nativeTimelines: [],
      gsapTriggers: [],
    }, 1);
    expect(c.anims[0].svgStroke).toBe(true);
    expect(c.svgStrokes).toContain("svg path");
  });

  it("passes keyframes through to the census unchanged", () => {
    const c = reduceScrollCensus("u", {
      anims: [{ ...anim({}), keyframes: [{ offset: 0, props: { transform: "none" } }] }],
      smilSelectors: [],
      nativeTimelines: [],
      gsapTriggers: [],
    }, 1);
    expect(c.anims[0].keyframes).toEqual([{ offset: 0, props: { transform: "none" } }]);
  });

  it("passes gsapTriggers through to the census preserving order", () => {
    const rows: GsapTriggerRow[] = [
      { selector: "div.a", scrub: true, pin: false, startPx: 0, endPx: 500, progress: 0.5, vars: { y: "100" } },
      { selector: "", scrub: false, pin: false, startPx: null, endPx: null, progress: null, vars: {} },
    ];
    const c = reduceScrollCensus("u", {
      anims: [],
      smilSelectors: [],
      nativeTimelines: [],
      gsapTriggers: rows,
    }, 1);
    expect(c.gsapTriggers).toEqual(rows);
  });
});

describe("SCROLL_CENSUS_SNIPPET", () => {
  it("is a self-contained browser function (serializable, no outer refs)", () => {
    // Plain function expression like SCAN_SNIPPET/MOTION_SNIPPET, not an arrow —
    // page.evaluate re-serializes the source, so no arrows and no outer
    // closure refs may appear.
    expect(String(SCROLL_CENSUS_SNIPPET)).not.toContain("=>");
    expect(typeof SCROLL_CENSUS_SNIPPET).toBe("function");
  });

  it("harvests bounded keyframe matrices (source-lock)", () => {
    // Harness fallback: this suite has no fake-document snippet executor, so
    // lock the harvest call site and the 60-row cap on the serialized source.
    // (The props pass already called effect.getKeyframes(), so "getKeyframes"
    // alone is not the signal — the cap lock is.)
    const src = String(SCROLL_CENSUS_SNIPPET);
    expect(src).toContain("getKeyframes");
    expect(src).toContain("kfCount < 60");
  });

  it("harvests the GSAP registry with exact bounds (source-lock)", () => {
    // 20-row cap, 24-char var clamp, and the brief's 11 priority vars keys.
    const src = String(SCROLL_CENSUS_SNIPPET);
    expect(src).toContain("gsapTriggers.length >= 20");
    expect(src).toContain(".slice(0, 24)");
    expect(src).toContain("autoAlpha");
    expect(src).toContain("gsapTriggers");
  });
});

describe("sampleKeyframes", () => {
  it("samples first/mid/last frames with ≤4 priority props and 40-char values", () => {
    const long = "0123456789012345678901234567890123456789EXTRA";
    const kfs = Array.from({ length: 10 }, (_, i) => ({
      offset: i / 10,
      transform: "translateX(" + i + "px)",
      opacity: String(i % 2),
      color: long,
      width: "10px",
      margin: "0px",
    }));
    const out = sampleKeyframes(kfs);
    expect(out.length).toBe(3);
    expect(out[0].offset).toBe(0);
    expect(out[2].offset).toBe(0.9);
    for (const kf of out) {
      expect(Object.keys(kf.props).length).toBeLessThanOrEqual(4);
      for (const v of Object.values(kf.props)) expect(String(v).length).toBeLessThanOrEqual(40);
    }
    // Priority-ordered, unprioritized props dropped, long values clamped.
    expect(Object.keys(out[0].props)).toEqual(["transform", "opacity", "color", "width"]);
    expect(out[0].props.color).toBe(long.slice(0, 40));
  });

  it("keeps all frames when ≤4 and nulls non-number offsets", () => {
    const out = sampleKeyframes([
      { offset: 0, transform: "none" },
      { offset: "half", opacity: "1" },
      { offset: 1, transform: "scale(2)" },
    ]);
    expect(out.length).toBe(3);
    expect(out[1].offset).toBeNull();
    expect(out[1].props).toEqual({ opacity: "1" });
    expect(out[2].props).toEqual({ transform: "scale(2)" });
  });

  it("returns [] for an empty matrix", () => {
    expect(sampleKeyframes([])).toEqual([]);
  });
});

// Direct snippet execution: the harness below routes a fixed fixture through
// page.evaluate, but the GSAP registry pass needs a fake ScrollTrigger global,
// so these tests stub globalThis (restored in finally) and call the snippet
// body in-process — the DOM passes no-op harmlessly under their own try/catch.
describe("gsapTriggers capture (direct snippet run)", () => {
  const g = globalThis as any;

  function withST<T>(stGlobal: unknown, fn: () => T): T {
    const prev = g.ScrollTrigger;
    g.ScrollTrigger = stGlobal;
    try {
      return fn();
    } finally {
      if (prev === undefined) delete g.ScrollTrigger;
      else g.ScrollTrigger = prev;
    }
  }

  it("captures compiled ScrollTrigger numerics + tween vars (bounded)", () => {
    const el = { nodeType: 1, tagName: "DIV" };
    const fakeST = {
      getAll: function () {
        return [{
          trigger: el,
          start: 640,
          end: 1800,
          progress: 0.3,
          animation: { vars: { y: 100, stagger: 0.09, onUpdate: function () {} } },
        }];
      },
    };
    const scan = withST(fakeST, SCROLL_CENSUS_SNIPPET);
    const gt = scan.gsapTriggers;
    expect(gt.length).toBe(1);
    expect(gt[0].startPx).toBe(640);
    expect(gt[0].endPx).toBe(1800);
    expect(gt[0].progress).toBe(0.3);
    expect(gt[0].selector).toBe("div");
    expect(gt[0].scrub).toBe(false);
    expect(gt[0].pin).toBe(false);
    expect(gt[0].vars.y).toBe("100");
    expect(gt[0].vars.stagger).toBe("0.09");
    expect(gt[0].vars.onUpdate).toBeUndefined(); // functions/objects skipped
  });

  it("caps at 20 rows and nulls uncompiled numerics", () => {
    const fakeST = {
      getAll: function () {
        const arr: Record<string, never>[] = [];
        for (let i = 0; i < 25; i++) arr.push({});
        return arr;
      },
    };
    const scan = withST(fakeST, SCROLL_CENSUS_SNIPPET);
    expect(scan.gsapTriggers.length).toBe(20);
    const row = scan.gsapTriggers[0];
    expect(row.startPx).toBeNull();
    expect(row.endPx).toBeNull();
    expect(row.progress).toBeNull();
    expect(row.selector).toBe("");
    expect(row.vars).toEqual({});
  });

  it("always emits gsapTriggers ([] when no GSAP)", () => {
    const scan = withST(undefined, SCROLL_CENSUS_SNIPPET);
    expect(scan.gsapTriggers).toEqual([]);
  });
});

// Offline orchestrator harness: a fake page whose evaluate returns the fixture
// scan; a fake browser that hands it out; a loader resolving a fake chromium.
// fakeBrowser optionally records the context opts passed to newPage and can
// throw on newPage (reducedMotion + page-opts assertion).
function harness(scan: ScrollScan, newPageImpl?: (opts: unknown) => Promise<any>) {
  const fakePage = {
    addInitScript: async () => {},
    goto: async () => {},
    waitForTimeout: async () => {},
    evaluate: async () => scan,
  };
  let seenContextOpts: unknown = null;
  const fakeBrowser = {
    newPage: newPageImpl ?? (async (opts: unknown) => {
      seenContextOpts = opts;
      return fakePage;
    }),
    close: async () => {},
  };
  const loader = async () => ({
    chromium: { launch: async () => fakeBrowser },
  });
  return { loader, getSeenContextOpts: () => seenContextOpts, fakeBrowser };
}

describe("captureScrollCensus", () => {
  const currentScan: ScrollScan = {
    anims: [
      anim({ selector: "div.scrub", trigger: "gsap-scrolltrigger", scrub: true }),
    ],
    smilSelectors: [],
    nativeTimelines: [{ selector: "main", kind: "scroll" }],
    gsapTriggers: [],
  };

  it("captures a census through a fake browser", async () => {
    const { loader } = harness(currentScan);
    const result = await captureScrollCensus("https://example.com", { loader });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.url).toBe("https://example.com");
    expect(result.reducedMotion).toBe(false);
    expect(result.anims[0].trigger).toBe("gsap-scrolltrigger");
  });

  it("returns { error } when the browser fails to launch", async () => {
    const loader = async () => ({
      chromium: {
        launch: async () => {
          throw new Error("boom");
        },
      },
    });
    const result = await captureScrollCensus("https://example.com", { loader });
    expect("error" in result).toBe(true);
    expect(JSON.stringify(result)).toContain("boom");
  });

  it("emulates reduced motion when requested", async () => {
    const { loader, getSeenContextOpts } = harness(currentScan);
    const result = await captureScrollCensus("https://example.com", {
      loader,
      reducedMotion: true,
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.reducedMotion).toBe(true);
    expect((getSeenContextOpts() as { reducedMotion?: string }).reducedMotion).toBe("reduce");
  });
});
