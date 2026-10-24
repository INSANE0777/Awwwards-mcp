import { describe, expect, it, vi } from "vitest";
import {
  A11Y_NOTE,
  A11Y_PLAYWRIGHT_HINT,
  A11Y_SNIPPET,
  analyzeAccessibility,
  compositeBackground,
  contrastRatio,
  contrastRatioOverLayers,
  parseCssColor,
  reduceA11y,
  type RawA11yScan,
} from "../src/a11y.js";

const rawScan = (over: Partial<RawA11yScan> = {}): RawA11yScan => ({
  url: "https://example.com/",
  lang: "en",
  title: "Example",
  textSamples: [
    {
      text: "Low contrast",
      color: "rgb(200, 200, 200)",
      backgroundLayers: [{ color: "rgb(255, 255, 255)", opacity: 1 }],
      selector: "main > p",
      fontSize: 14,
      bold: false,
    },
    {
      text: "High contrast",
      color: "rgb(0, 0, 0)",
      backgroundLayers: [{ color: "rgb(255, 255, 255)", opacity: 1 }],
      selector: "#hero > h1",
      fontSize: 32,
      bold: true,
    },
    {
      text: "Modern color",
      color: "oklch(0.5 0.1 30)",
      backgroundLayers: [{ color: "rgb(255, 255, 255)", opacity: 1 }],
      selector: ".modern",
      fontSize: 16,
      bold: false,
    },
  ],
  images: { total: 5, scanned: 5, missingAlt: 2, emptyAlt: 1, decorativeOk: 2 },
  headings: {
    total: 3,
    multipleH1: 1,
    order: [1, 3, 2],
    skipped: [{ level: 3, previous: 1, selector: "#jump" }],
  },
  focus: {
    count: 12,
    scanned: 12,
    positiveTabindex: 2,
    outlineRuleCount: 1,
    outlineRules: [{ selector: "button:focus", css: "button:focus { outline: none; }" }],
    rulesInspected: 40,
    sheetsChecked: 2,
    sheetsBlocked: 1,
  },
  forms: {
    controls: 4,
    scanned: 4,
    unlabeledCount: 1,
    unlabeled: [{ selector: "form > input", type: "email" }],
  },
  ...over,
});

describe("A11Y_SNIPPET", () => {
  it("is serializable as browser source: no arrow functions, no module references", () => {
    const src = String(A11Y_SNIPPET);
    expect(src).not.toContain("=>");
    expect(src).toContain("globalThis");
    expect(src).toContain("createTreeWalker");
    expect(src).toContain("styleSheets");
    // In-page literals, not closures over Node constants.
    expect(src).not.toContain("MAX_");
    expect(src).not.toContain("export ");
  });

  it("collects only plain JSON-serializable data", () => {
    expect(() => JSON.stringify(rawScan())).not.toThrow();
  });
});

describe("parseCssColor / contrastRatio", () => {
  it("parses comma and space rgb(a) forms", () => {
    expect(parseCssColor("rgb(255, 0, 0)")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
    expect(parseCssColor("rgba(0 0 0 / 50%)")).toEqual({ r: 0, g: 0, b: 0, a: 0.5 });
    expect(parseCssColor("transparent")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(parseCssColor("oklch(0.5 0.1 30)")).toBeNull();
  });

  it("computes WCAG contrast ratios for known pairs", () => {
    expect(contrastRatio("rgb(0, 0, 0)", "rgb(255, 255, 255)")).toBeCloseTo(21, 5);
    expect(contrastRatio("rgb(255, 255, 255)", "rgb(255, 255, 255)")).toBeCloseTo(1, 5);
    expect(contrastRatio("rgb(119, 119, 119)", "rgb(255, 255, 255)")).toBeCloseTo(4.48, 1);
    // 50% black over the white canvas ≈ #808080 → ratio ≈ 3.95.
    expect(contrastRatio("rgba(0, 0, 0, 0.5)", "rgb(255, 255, 255)")).toBeCloseTo(3.95, 1);
    expect(contrastRatio("oklch(0.5 0.1 30)", "rgb(255, 255, 255)")).toBeNull();
  });

  it("composites 50%-white over 50%-black bottom-up, not as an opaque layer", () => {
    const layers = [
      { color: "rgba(255, 255, 255, 0.5)", opacity: 1 },
      { color: "rgba(0, 0, 0, 0.5)", opacity: 1 },
    ];
    const bg = compositeBackground(layers);
    expect(bg).not.toBeNull();
    // 50% black over white canvas = 127.5; 50% white over that = 191.25.
    expect(bg!.r).toBeCloseTo(191.25, 2);
    expect(bg!.g).toBeCloseTo(191.25, 2);
    expect(bg!.b).toBeCloseTo(191.25, 2);
    const ratio = contrastRatioOverLayers("rgb(0, 0, 0)", layers);
    expect(ratio).toBeGreaterThan(11.3);
    expect(ratio).toBeLessThan(11.6);
    expect(ratio).not.toBeCloseTo(21, 1); // naive first-opaque-ancestor result
  });

  it("applies ancestor opacity per layer", () => {
    const ratio = contrastRatioOverLayers("rgb(0, 0, 0)", [
      { color: "rgb(255, 255, 255)", opacity: 0.5 },
      { color: "rgb(0, 0, 0)", opacity: 1 },
    ]);
    // Opaque white at 50% opacity over black = #808080 → ≈5.32.
    expect(ratio).toBeCloseTo(5.32, 1);
  });
});

describe("reduceA11y", () => {
  it("reduces raw samples into bounded evidence + coverage", () => {
    const { evidence, coverage } = reduceA11y(rawScan());
    expect(evidence.contrast.sampled).toBe(2);
    expect(evidence.contrast.unparseable).toBe(1);
    expect(evidence.contrast.worstPairs.map((p) => p.selector)).toEqual(["main > p", "#hero > h1"]);
    expect(evidence.contrast.worstPairs[0].ratio).toBeLessThan(1.7);
    expect(evidence.contrast.worstPairs[0].background).toBe("rgb(255, 255, 255)");
    expect(evidence.images.missingAlt).toBe(2);
    expect(evidence.headings.skipped).toEqual([{ level: 3, previous: 1, selector: "#jump" }]);
    expect(evidence.focus.outlineRules).toHaveLength(1);
    expect(evidence.forms.unlabeled[0].type).toBe("email");
    expect(evidence.document).toEqual({ lang: "en", titlePresent: true });
    expect(coverage).toEqual({ textNodesSampled: 3, images: 5, focusables: 12 });
  });

  it("reports the composited background for layered samples", () => {
    const { evidence } = reduceA11y(rawScan({
      textSamples: [{
        text: "Layered",
        color: "rgb(0, 0, 0)",
        backgroundLayers: [
          { color: "rgba(255, 255, 255, 0.5)", opacity: 1 },
          { color: "rgba(0, 0, 0, 0.5)", opacity: 1 },
        ],
        selector: ".layered",
        fontSize: 16,
        bold: false,
      }],
    }));
    const pair = evidence.contrast.worstPairs[0];
    expect(pair.background).toBe("rgb(191, 191, 191)");
    expect(pair.ratio).toBeGreaterThan(11.3);
    expect(pair.ratio).toBeLessThan(11.6);
  });

  it("caps text samples at the requested limit and at 200", () => {
    const many = rawScan({
      textSamples: Array.from({ length: 250 }, (_, i) => ({
        text: `t${i}`,
        color: "rgb(0, 0, 0)",
        backgroundLayers: [{ color: "rgb(255, 255, 255)", opacity: 1 }],
        selector: `p:nth-child(${i})`,
        fontSize: 16,
        bold: false,
      })),
    });
    expect(reduceA11y(many, 100).coverage.textNodesSampled).toBe(100);
    expect(reduceA11y(many, 9999).coverage.textNodesSampled).toBe(200);
    expect(reduceA11y(many, 100).evidence.contrast.worstPairs).toHaveLength(15);
  });
});

function fakePlaywright(pageScan: RawA11yScan = rawScan()) {
  const page = {
    addInitScript: vi.fn(async () => {}),
    goto: vi.fn(async () => {}),
    waitForTimeout: vi.fn(async () => {}),
    evaluate: vi.fn(async () => pageScan),
  };
  const browser = {
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => {}),
  };
  const chromium = { launch: vi.fn(async () => browser) };
  return { loader: async () => ({ chromium }), page, browser, chromium };
}

describe("analyzeAccessibility", () => {
  it("orchestrates the snippet and stamps heuristic evidence", async () => {
    const { loader, page, browser } = fakePlaywright();
    const result = await analyzeAccessibility(
      "https://example.com/",
      { viewport: "mobile", limit: 50 },
      loader,
    );
    if ("error" in result) throw new Error(result.error);
    expect(result.viewport).toBe("mobile");
    expect(result.heuristic).toBe(true);
    expect(result.note).toBe(A11Y_NOTE);
    expect(result.coverage.textNodesSampled).toBe(3);
    expect(browser.newPage).toHaveBeenCalledWith(
      expect.objectContaining({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      }),
    );
    expect(page.goto).toHaveBeenCalledWith("https://example.com/", {
      waitUntil: "load",
      timeout: 45_000,
    });
    expect(page.waitForTimeout).toHaveBeenCalledWith(3000);
    expect(page.evaluate.mock.calls[0][1]).toEqual({ limit: 50 });
    expect(browser.close).toHaveBeenCalled();
  });

  it("defaults to the desktop viewport and 100-sample limit", async () => {
    const { loader, page } = fakePlaywright();
    const result = await analyzeAccessibility("https://example.com/", {}, loader);
    if ("error" in result) throw new Error(result.error);
    expect(result.viewport).toBe("desktop");
    expect(page.evaluate.mock.calls[0][1]).toEqual({ limit: 100 });
  });

  it("degrades to the install hint when playwright is missing", async () => {
    const result = await analyzeAccessibility("https://example.com/", {}, async () => {
      throw new Error("Cannot find module 'playwright'");
    });
    expect(result).toEqual({ error: A11Y_PLAYWRIGHT_HINT });
  });

  it("rejects unusable URLs without loading playwright", async () => {
    let loaded = false;
    const loader = async () => {
      loaded = true;
      return {};
    };
    expect(await analyzeAccessibility("file:///tmp/page.html", {}, loader)).toEqual({
      error: "analyze_accessibility only accepts http(s) URLs",
    });
    expect(await analyzeAccessibility("not a url", {}, loader)).toEqual({
      error: "Invalid URL: not a url",
    });
    expect(loaded).toBe(false);
  });

  it("degrades navigation errors and still closes the browser", async () => {
    const { loader, page, browser } = fakePlaywright();
    page.goto.mockRejectedValueOnce(new Error("net::ERR_TIMED_OUT"));
    const result = await analyzeAccessibility("https://example.com/", {}, loader);
    expect(result).toEqual({ error: "net::ERR_TIMED_OUT" });
    expect(browser.close).toHaveBeenCalled();
  });
});
