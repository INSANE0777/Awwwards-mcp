import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ACTIVE_ANIMS_SNIPPET,
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

  it("matches candidates with :hover stripped (live :hover never matches at rest)", () => {
    expect(String(HOVER_RULES_SNIPPET)).toMatch(/replace\(\s*\/:hover\/g\s*,\s*""\s*\)/);
  });

  it("reads computed props via camelCase IDL access with kebab fallback", () => {
    expect(String(HOVER_SNAPSHOT_SNIPPET)).toMatch(/String\(\s*cs\[p\][^)]*getPropertyValue/);
  });

  it("prop list inside HOVER_SNAPSHOT_SNIPPET covers every HOVER_PROPS entry", () => {
    const src = String(HOVER_SNAPSHOT_SNIPPET);
    for (const p of HOVER_PROPS) expect(src).toContain('"' + p + '"');
  });

  it("installs snippet shims before navigation (tsx __name injection breaks evaluate)", () => {
    // tsx/esbuild keepNames injects __name() into HOVER_RULES_SNIPPET (it has
    // an inner `collect` function), so evaluate needs the init-script shim.
    const src = readFileSync(join(__dirname, "../src/hover-census.ts"), "utf8");
    expect(src.indexOf("await installSnippetShims(page);")).toBeGreaterThan(
      src.indexOf("browser.newPage("),
    );
  });
});

// Offline orchestrator harness. The fake page routes evaluate calls by source:
// the snapshot snippet carries getComputedStyle (the rules snippet does not).
// Snapshot semantics mimic real DOM state: while idx is hovered its snapshot
// returns hovered styles, otherwise resting; indexes without a labeled element
// (idx >= candidates.length) return null like a missing DOM node; a failed
// page.hover leaves the element un-hovered (continue-on-fail produces an empty
// diff downstream, exactly like a real page that didn't react).
function harness(opts?: {
  hoverThrowIdx?: number;
  active1NoAnims?: boolean;
  rules?: string[];
  candidates?: string[];
}) {
  let hoveredIdx: number | null = null;
  let activeCalls = 0;
  const hoverSelectors: string[] = [];
  const scan = {
    rules: opts?.rules ?? ["a:hover", "button:hover"],
    candidates: opts?.candidates ?? ["a", "button"],
  };

  // Fake element geometry for the ACTIVE_ANIMS route: the enrichment's
  // micro-moves land inside this rect, the orchestrator's unhover lands on
  // (0,0) outside it.
  const rect = { x: 100, y: 200, width: 200, height: 40 };
  const activeHovered = {
    rect,
    transform: "translate(7.5%, 0)",
    anims: [{ sel: ".cf-hero-ch", name: "gsap", durationMs: 500, easing: "power2.in" }],
  };
  const activeResting = { rect, transform: null, anims: [] as Array<never> };

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
      move: async (x: number, y: number) => {
        // Moves inside the element rect keep hover (Playwright pointer
        // semantics); any move outside it — the orchestrator's (0,0) unhover —
        // ends it.
        if (x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height) {
          return;
        }
        hoveredIdx = null;
      },
    },
    hover: async (sel: string) => {
      hoverSelectors.push(sel);
      const idx = Number(String(sel).split("'")[1]);
      if (idx === opts?.hoverThrowIdx) throw new Error("hover timeout");
      hoveredIdx = idx;
      activeCalls = 0;
    },
    evaluate: async (fn: unknown, arg?: unknown) => {
      const src = String(fn);
      // ACTIVE_ANIMS_SNIPPET routes on getBoundingClientRect (its unique
      // marker — the rules snippet never calls it, the snapshot one uses
      // getComputedStyle). Returns mid-flight hover state; the active1NoAnims
      // knob empties the anims on the post-move call to exercise the active0
      // fallback in captureHoverCensus.
      if (src.indexOf("getBoundingClientRect") !== -1) {
        if (Number(arg) !== hoveredIdx) return activeResting;
        const call = ++activeCalls;
        if (opts?.active1NoAnims && call >= 2) return { ...activeHovered, anims: [] };
        return activeHovered;
      }
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
    // pushed as a sample (empty diffs are dropped per plan). L5 enrichment
    // fills in the mid-flight style trail and the running anims.
    expect(result.samples).toEqual([
      {
        selector: "hover-candidate-0",
        changedProps: ["transform", "color", "boxShadow"],
        transitionMs: 300,
        easing: null,
        activeAnims: [{ sel: ".cf-hero-ch", name: "gsap", durationMs: 500, easing: "power2.in" }],
        styleTrail: ["translate(7.5%, 0)", "translate(7.5%, 0)"],
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

describe("ACTIVE_ANIMS_SNIPPET + hover L5 enrichment", () => {
  it("is a self-contained browser function, source-locked and wired into the orchestrator", () => {
    // Plain function expression like the other snippets — page.evaluate
    // re-serializes the source, so no arrows and no outer closure refs.
    const src = String(ACTIVE_ANIMS_SNIPPET);
    expect(typeof ACTIVE_ANIMS_SNIPPET).toBe("function");
    expect(src).not.toContain("=>");
    // Attribute marker as it serializes: "[data-__hidx='" + idx + "']".
    expect(src).toContain("[data-__hidx");
    // Routing marker the fake-page harness (and readers) can rely on.
    expect(src).toContain("getBoundingClientRect");
    // The enrichment must be reachable from the orchestrator, not dead code.
    expect(String(captureHoverCensus)).toContain("ACTIVE_ANIMS_SNIPPET");
  });

  it("pushes bounded styleTrail + activeAnims on hover samples", async () => {
    const { loader } = harness();
    const result = await captureHoverCensus("https://example.com", { loader });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    const s = result.samples[0];
    expect(s.styleTrail).toContain("translate(7.5%, 0)");
    expect((s.styleTrail ?? []).length).toBeLessThanOrEqual(4);
    for (const t of s.styleTrail ?? []) expect(t.length).toBeLessThanOrEqual(60);
    expect((s.activeAnims ?? []).length).toBeLessThanOrEqual(6);
    for (const a of s.activeAnims ?? []) {
      expect(typeof a.sel).toBe("string");
      expect(typeof a.name).toBe("string");
      expect(a.durationMs === null || typeof a.durationMs === "number").toBe(true);
      expect(a.easing === null || typeof a.easing === "string").toBe(true);
    }
  });

  it("falls back to the pre-sweep anims when the settled sample comes back empty", async () => {
    const { loader } = harness({ active1NoAnims: true });
    const result = await captureHoverCensus("https://example.com", { loader });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.samples[0].activeAnims).toEqual([
      { sel: ".cf-hero-ch", name: "gsap", durationMs: 500, easing: "power2.in" },
    ]);
  });

  it("omits the enrichment fields when the sample is never pushed (empty diff)", async () => {
    // Candidate 1 hovers fine but its diff is empty → no sample at all, so no
    // activeAnims/styleTrail may leak into the pack.
    const { loader } = harness();
    const result = await captureHoverCensus("https://example.com", { loader });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.samples.map((s) => s.selector)).toEqual(["hover-candidate-0"]);
  });
});
