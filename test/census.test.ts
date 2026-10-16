import { describe, expect, it } from "vitest";
import { SCROLL_CENSUS_SNIPPET, reduceScrollCensus, captureScrollCensus } from "../src/census.js";
import type { RawAnim, ScrollScan } from "../src/census.js";

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
    }, 1);
    expect(c.anims[0].svgStroke).toBe(true);
    expect(c.svgStrokes).toContain("svg path");
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
