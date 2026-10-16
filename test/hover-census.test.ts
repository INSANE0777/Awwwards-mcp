import { describe, expect, it } from "vitest";
import {
  HOVER_PROPS,
  HOVER_RULES_SNIPPET,
  HOVER_SNAPSHOT_SNIPPET,
  diffHoverStyles,
  captureHoverCensus,
} from "../src/hover-census.js";

describe("HOVER_PROPS", () => {
  it("is exactly the 13 observed properties", () => {
    expect(HOVER_PROPS).toEqual([
      "transform",
      "color",
      "backgroundColor",
      "opacity",
      "filter",
      "boxShadow",
      "letterSpacing",
      "borderRadius",
      "clipPath",
      "scale",
      "translate",
      "fill",
      "stroke",
    ]);
  });
});

describe("diffHoverStyles", () => {
  it("detects transform/color/boxShadow changes + transitionMs 300 from '0.3s' + easing null", () => {
    const before: Record<string, string | null> = {};
    for (const p of HOVER_PROPS) before[p] = "rgb(0, 0, 0)";
    before.transform = "none";
    before.boxShadow = "none";
    before.__transitionDuration = "0s";
    before.__transitionTimingFunction = "ease";
    const after = {
      ...before,
      transform: "matrix(1, 0, 0, 1, 8, 0)",
      color: "rgb(255, 0, 0)",
      boxShadow: "rgba(0, 0, 0, 0.2) 0px 4px 8px 0px",
      __transitionDuration: "0.3s",
    };
    const d = diffHoverStyles(before, after);
    expect(d.changedProps).toEqual(["transform", "color", "boxShadow"]);
    expect(d.transitionMs).toBe(300);
    expect(d.easing).toBe(null);
  });

  it("returns an empty diff when given the same object twice", () => {
    const s: Record<string, string | null> = { transform: "none", color: "rgb(1, 2, 3)" };
    expect(diffHoverStyles(s, s)).toEqual({
      changedProps: [],
      transitionMs: null,
      easing: null,
    });
  });
});

describe("HOVER_RULES_SNIPPET / HOVER_SNAPSHOT_SNIPPET", () => {
  it("are self-contained browser functions (serializable, no arrows)", () => {
    // Plain function expressions like SCROLL_CENSUS_SNIPPET — page.evaluate
    // re-serializes the source, so no arrows and no outer closure refs.
    expect(String(HOVER_RULES_SNIPPET)).not.toContain("=>");
    expect(String(HOVER_SNAPSHOT_SNIPPET)).not.toContain("=>");
    expect(typeof HOVER_RULES_SNIPPET).toBe("function");
    expect(typeof HOVER_SNAPSHOT_SNIPPET).toBe("function");
  });
});

// Offline orchestrator harness. The fake page routes evaluate calls by source:
// the snapshot snippet carries getComputedStyle (the rules snippet does not).
// Snapshot semantics mimic real DOM state: while idx is hovered its snapshot
// returns hovered styles, otherwise resting; indexes without a labeled element
// (idx >= candidates.length) return null like a missing DOM node; a failed
// page.hover leaves the element un-hovered (continue-on-fail produces an empty
// diff downstream, exactly like a real page that didn't react).
function harness(opts?: { hoverThrowIdx?: number; rules?: string[]; candidates?: string[] }) {
  let hoveredIdx: number | null = null;
  const hoverSelectors: string[] = [];
  const scan = {
    rules: opts?.rules ?? ["a:hover", "button:hover"],
    candidates: opts?.candidates ?? ["a", "button"],
  };

  const resting: Record<string, string | null> = {};
  for (const p of HOVER_PROPS) resting[p] = "rgb(0, 0, 0)";
  resting.transform = "none";
  resting.boxShadow = "none";
  resting.__transitionDuration = "0s";
  resting.__transitionTimingFunction = "ease";
  const hovered = {
    ...resting,
    transform: "matrix(1, 0, 0, 1, 8, 0)",
    color: "rgb(255, 0, 0)",
    boxShadow: "rgba(0, 0, 0, 0.2) 0px 4px 8px 0px",
    __transitionDuration: "0.3s",
  };

  const fakePage = {
    addInitScript: async () => {},
    goto: async () => {},
    waitForTimeout: async () => {},
    mouse: {
      move: async () => {
        hoveredIdx = null;
      },
    },
    hover: async (sel: string) => {
      hoverSelectors.push(sel);
      const idx = Number(String(sel).split("'")[1]);
      if (idx === opts?.hoverThrowIdx) throw new Error("hover timeout");
      hoveredIdx = idx;
    },
    evaluate: async (fn: unknown, arg?: unknown) => {
      const src = String(fn);
      if (src.indexOf("getComputedStyle") !== -1) {
        const idx = Number(arg);
        if (idx >= scan.candidates.length) return null;
        // Only candidate 0 has a hover transition; candidate 1's hover is a
        // no-op (covers the "empty diff → not pushed" path down-stream).
        return { ...(idx === hoveredIdx && idx === 0 ? hovered : resting) };
      }
      return scan;
    },
  };
  const fakeBrowser = {
    newPage: async (pageOpts: unknown) => {
      (fakeBrowser as any).__pageOpts = pageOpts;
      return fakePage;
    },
    close: async () => {},
  };
  const loader = async () => ({ chromium: { launch: async () => fakeBrowser } });
  return {
    loader,
    hoverSelectors,
    getPageOpts: () => (fakeBrowser as any).__pageOpts,
  };
}

describe("captureHoverCensus", () => {
  it("captures hover samples through a fake browser", async () => {
    const { loader, hoverSelectors } = harness();
    const result = await captureHoverCensus("https://example.com", { loader });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.url).toBe("https://example.com");
    expect(result.reducedMotion).toBe(false);
    // Plan-locked: both counters report the harvested hover-rule count.
    expect(result.hoverRuleCount).toBe(2);
    expect(result.candidates).toBe(2);
    // Both candidates get hovered; only candidate 0 reacts, so only it is
    // pushed as a sample (empty diffs are dropped per plan).
    expect(result.samples).toEqual([
      {
        selector: "hover-candidate-0",
        changedProps: ["transform", "color", "boxShadow"],
        transitionMs: 300,
        easing: null,
      },
    ]);
    expect(hoverSelectors).toEqual(["[data-__hidx='0']", "[data-__hidx='1']"]);
  });

  it("continues when page.hover times out", async () => {
    const { loader, hoverSelectors } = harness({ hoverThrowIdx: 1 });
    const result = await captureHoverCensus("https://example.com", { loader });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    // candidate 0 sampled; candidate 1's hover failure yields an empty diff,
    // which the orchestrator drops per plan ("push … when changedProps
    // nonempty").
    expect(result.samples.map((s) => s.selector)).toEqual(["hover-candidate-0"]);
    expect(hoverSelectors).toEqual(["[data-__hidx='0']", "[data-__hidx='1']"]);
  });

  it("emits no samples when the page has no hover candidates", async () => {
    const { loader } = harness({ rules: [], candidates: [] });
    const result = await captureHoverCensus("https://example.com", { loader });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.samples).toEqual([]);
    expect(result.hoverRuleCount).toBe(0);
    expect(result.candidates).toBe(0);
  });

  it("returns { error } when the browser fails to launch", async () => {
    const loader = async () => ({
      chromium: {
        launch: async () => {
          throw new Error("boom");
        },
      },
    });
    const result = await captureHoverCensus("https://example.com", { loader });
    expect("error" in result).toBe(true);
    expect(JSON.stringify(result)).toContain("boom");
  });

  it("emulates reduced motion when requested", async () => {
    const { loader, getPageOpts } = harness();
    const result = await captureHoverCensus("https://example.com", {
      loader,
      reducedMotion: true,
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.reducedMotion).toBe(true);
    expect((getPageOpts() as { reducedMotion?: string }).reducedMotion).toBe("reduce");
  });
});
