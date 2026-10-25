import { describe, expect, it, vi } from "vitest";
import { collapseBands, analyzePageStructure, splitCollapsedBands, diffBands, SCAN_SNIPPET } from "../src/structure.js";
import type { PageBand, PageStructure } from "../src/structure.js";
import type { RawBand } from "../src/structure.js";

const band = (over: Partial<RawBand> = {}): RawBand => ({
  tag: "section",
  label: "",
  bg: "rgb(16, 21, 42)",
  top: 0,
  height: 1000,
  textStart: "",
  ...over,
});

const pageBand = (label: string, height: number, offsetTop = 0, index = 0): PageBand => ({
  index,
  tag: "section",
  label,
  background: "rgb(0, 0, 0)",
  offsetTop,
  height,
  textStart: "",
});

const page = (bands: PageBand[], totalHeight: number): PageStructure => ({
  url: "https://example.com",
  title: "T",
  totalHeight,
  bands,
});

describe("diffBands", () => {
  it("returns zero deltas for identical band maps", () => {
    const bands = [pageBand(".a", 500), pageBand(".b", 500, 500, 1)];
    expect(diffBands(page(bands, 1000), page(bands, 1000))).toEqual({
      heightDelta: 0,
      bandsAdded: [],
      bandsRemoved: [],
      reordered: [],
    });
  });

  it("reports mobile-only added bands, desktop-only removed bands and height delta", () => {
    const desktop = page([pageBand(".a", 500), pageBand(".b", 500, 500, 1), pageBand(".c", 400, 1000, 2)], 1400);
    const mobile = page([pageBand(".a", 600), pageBand(".c", 300, 600, 1), pageBand(".d", 200, 900, 2)], 1100);
    expect(diffBands(desktop, mobile)).toEqual({
      heightDelta: -300,
      bandsAdded: [".d"],
      bandsRemoved: [".b"],
      reordered: [],
    });
  });

  it("flags common labels whose relative order changed", () => {
    const desktop = page([pageBand(".a", 300), pageBand(".b", 300, 300, 1), pageBand(".c", 300, 600, 2)], 900);
    const mobile = page([pageBand(".c", 300), pageBand(".a", 300, 300, 1), pageBand(".b", 300, 600, 2)], 900);
    expect(diffBands(desktop, mobile)).toMatchObject({
      heightDelta: 0,
      bandsAdded: [],
      bandsRemoved: [],
      reordered: [".a", ".b", ".c"],
    });
  });

  it("matches labels case-insensitively and names unlabeled bands", () => {
    const desktop = page([pageBand("Hero", 500), pageBand("", 500, 500, 1)], 1000);
    const mobile = page([pageBand("hero", 400), pageBand(".extra", 600, 400, 1)], 1000);
    expect(diffBands(desktop, mobile)).toEqual({
      heightDelta: 0,
      bandsAdded: [".extra"],
      bandsRemoved: ["(unlabeled)"],
      reordered: [],
    });
  });
});

describe("collapseBands", () => {
  it("resolves each y to the smallest covering candidate (most specific wins)", () => {
    const bands = collapseBands(
      [
        band({ label: "body", bg: "rgb(16, 21, 42)", top: 0, height: 2000 }),
        band({ label: ".shell", bg: "rgb(240, 242, 247)", top: 400, height: 1200 }),
      ],
      2000,
    );
    // body band 0-400, shell band 400-1600, body again 1600-2000
    expect(bands.map((b) => b.label)).toEqual(["body", ".shell", "body"]);
    expect(bands.map((b) => b.height)).toEqual([400, 1200, 400]);
  });

  it("merges consecutive runs with the same background", () => {
    const bands = collapseBands(
      [
        band({ label: "a", bg: "rgb(1, 1, 1)", top: 0, height: 300 }),
        band({ label: "b", bg: "rgb(1, 1, 1)", top: 300, height: 300 }),
      ],
      600,
    );
    expect(bands.length).toBe(1);
    expect(bands[0].height).toBe(600);
    expect(bands[0].label).toBe("a"); // first label wins on merge
  });

  it("absorbs tiny bands (<40px) into the previous band", () => {
    const bands = collapseBands(
      [
        band({ label: "big", bg: "rgb(1, 1, 1)", top: 0, height: 500 }),
        band({ label: "sliver", bg: "rgb(2, 2, 2)", top: 500, height: 30 }),
        band({ label: "tail", bg: "rgb(1, 1, 1)", top: 530, height: 470 }),
      ],
      1000,
    );
    expect(bands.map((b) => b.label)).toEqual(["big", "tail"]);
  });

  it("caps band count by merging the smallest band into its previous neighbor", () => {
    const many: RawBand[] = Array.from({ length: 12 }, (_, i) =>
      band({ label: `b${i}`, bg: `rgb(${i}, ${i}, ${i})`, top: i * 100, height: 100 }),
    );
    const bands = collapseBands(many, 1200, 5);
    expect(bands.length).toBeLessThanOrEqual(5);
    expect(bands[bands.length - 1].offsetTop + bands[bands.length - 1].height).toBe(1200);
  });

  it("rounds coordinates and assigns sequential indexes", () => {
    const bands = collapseBands(
      [band({ top: 0.4, height: 999.6, label: "x" })],
      1000,
    );
    expect(bands[0].index).toBe(0);
    expect(bands[0].offsetTop).toBe(0);
    expect(bands[0].height).toBe(1000);
  });
});

describe("splitCollapsedBands", () => {
  const pageBand = (over: Partial<PageBand> = {}): PageBand => ({
    index: 0,
    tag: "section",
    label: ".hero",
    background: "rgb(1, 1, 1)",
    offsetTop: 0,
    height: 6000,
    textStart: "Hero copy",
    ...over,
  });

  it("subdivides a giant band at landmark tops (ordered subs, heights sum to the parent)", () => {
    const subs = splitCollapsedBands([pageBand()], [1000, 3000]);
    expect(subs.map((b) => b.offsetTop)).toEqual([0, 1000, 3000]);
    expect(subs.map((b) => b.height)).toEqual([1000, 2000, 3000]);
    expect(subs.reduce((n, b) => n + b.height, 0)).toBe(6000);
    expect(subs.map((b) => b.index)).toEqual([0, 1, 2]);
    // Sub 0 keeps the parent identity; later subs take empty label/text.
    expect(subs.map((b) => b.label)).toEqual([".hero", "", ""]);
    expect(subs.map((b) => b.tag)).toEqual(["section", "section", "section"]);
    expect(subs.map((b) => b.background)).toEqual(["rgb(1, 1, 1)", "rgb(1, 1, 1)", "rgb(1, 1, 1)"]);
    expect(subs.map((b) => b.textStart)).toEqual(["Hero copy", "", ""]);
  });

  it("merges a <200px delta into the previous sub-band", () => {
    const subs = splitCollapsedBands([pageBand({ height: 3000 })], [400, 550]);
    // deltas 400 / 150 / 2450 — the 150px delta merges into sub 0.
    expect(subs.map((b) => b.offsetTop)).toEqual([0, 550]);
    expect(subs.map((b) => b.height)).toEqual([550, 2450]);
    expect(subs.reduce((n, b) => n + b.height, 0)).toBe(3000);
  });

  it("skips landmarks within 200px of an edge", () => {
    const subs = splitCollapsedBands([pageBand({ height: 3000 })], [100, 500, 2900]);
    // 100 and 2900 are <200px from an edge; only 500 is a valid cut.
    expect(subs.map((b) => b.offsetTop)).toEqual([0, 500]);
    expect(subs.map((b) => b.height)).toEqual([500, 2500]);
    // A giant whose landmarks ALL sit near the edges cannot split at all.
    expect(splitCollapsedBands([pageBand({ height: 3000 })], [100, 2900])).toEqual([
      pageBand({ height: 3000 }),
    ]);
  });

  it("passes bands through unchanged with no landmarks (byte-identical reference)", () => {
    const bands = [pageBand(), pageBand({ offsetTop: 6000, height: 500 })];
    expect(splitCollapsedBands(bands, [])).toBe(bands);
  });

  it("leaves non-giant bands and giants without 2 in-range landmarks alone", () => {
    const bands = [
      pageBand({ height: 2999 }),
      pageBand({ offsetTop: 2999, height: 2000 }),
    ];
    const res = splitCollapsedBands(bands, [1000, 1500, 3300, 3600]);
    expect(res).toHaveLength(2);
    // Small band: 2 in-range landmarks but height < 3000 → no split.
    expect(res[0].height).toBe(2999);
    // Giant band: 2 valid in-range landmarks, but 2000px height fails the ≥3000px gate → no split.
    expect(res[1]).toEqual({ ...bands[1], index: 1 });
    expect(res.map((b) => b.offsetTop + b.height)).toEqual([2999, 4999]);
  });

  it("skips the split entirely when the resulting count would exceed maxBands", () => {
    const giant = pageBand();
    // 3 valid cuts in 0-6000 → 4 sub-bands.
    expect(splitCollapsedBands([giant], [300, 600, 900], 3)).toHaveLength(1);
    expect(splitCollapsedBands([giant], [300, 600, 900], 3)).toEqual([giant]);
    expect(splitCollapsedBands([giant], [300, 600, 900], 4)).toHaveLength(4);
  });

  it("absorbs duplicate and unsorted landmark input deterministically", () => {
    const sorted = splitCollapsedBands([pageBand({ height: 3000 })], [500, 1500]);
    const messy = splitCollapsedBands([pageBand({ height: 3000 })], [1500, 500, 1500, 500]);
    expect(messy).toEqual(sorted);
    expect(sorted.map((b) => b.offsetTop)).toEqual([0, 500, 1500]);
  });

  // D2 residual gate: a giant with exactly ONE valid landmark now splits ONCE
  // into two parts (previously needed ≥2 in-range marks and stayed whole).
  it("splits a giant with a single landmark once into two bands (residual gate, was ≥2)", () => {
    const subs = splitCollapsedBands([pageBand()], [2000]);
    expect(subs.map((b) => b.offsetTop)).toEqual([0, 2000]);
    expect(subs.map((b) => b.height)).toEqual([2000, 4000]); // remainder absorbed by the tail
    expect(subs.reduce((n, b) => n + b.height, 0)).toBe(6000);
    // Sub 0 keeps the parent identity; the tail sub is anonymous.
    expect(subs.map((b) => b.label)).toEqual([".hero", ""]);
    expect(subs.map((b) => b.tag)).toEqual(["section", "section"]);
    expect(subs.map((b) => b.index)).toEqual([0, 1]);
  });

  it("single landmark inside the 200px edge clamp still cannot split", () => {
    expect(splitCollapsedBands([pageBand({ height: 3000 })], [150])).toHaveLength(1);
    expect(splitCollapsedBands([pageBand({ height: 3000 })], [2900])).toHaveLength(1);
  });
});

// D2 grab-bag: the scan snippet's landmark collection now also records
// <section>/<article>/[role=main] rect tops. No fake-document executor in
// this suite, so the contract is source-locked (house pattern).
it("SCAN_SNIPPET collects section/article/[role=main] landmark tops, bounded at 12 (source-lock)", () => {
  const src = String(SCAN_SNIPPET);
  expect(src).toContain(`querySelectorAll("section, article, [role=main]")`);
  expect(src).toContain("< 12"); // the new contributor's cap
  expect(src).toContain("querySelectorAll"); // runs inside the landmark try-block
});

describe("analyzePageStructure", () => {
  it("builds the structure from the loader's evaluate result", async () => {
    const fake = {
      launch: async () => ({
        newPage: async () => ({
          goto: async () => {},
          // settle wait from the load strategy; the fake's evaluate result is
          // returned for both the pre-scroll and the scan call
          waitForTimeout: async () => {},
          evaluate: async () => ({
            title: "Test Page",
            totalHeight: 2000,
            candidates: [
              band({ label: "body", bg: "rgb(16, 21, 42)", top: 0, height: 2000 }),
              band({ tag: "section", label: ".shell", bg: "rgb(240, 242, 247)", top: 500, height: 1000, textStart: "Production speed" }),
            ],
          }),
        }),
        close: async () => {},
      }),
    };
    const res = await analyzePageStructure("https://example.com", async () => ({ chromium: fake }));
    expect("error" in res).toBe(false);
    if (!("error" in res)) {
      expect(res.title).toBe("Test Page");
      expect(res.totalHeight).toBe(2000);
      expect(res.bands.map((b) => b.label)).toContain(".shell");
      expect(res.bands[0].background).toBe("rgb(16, 21, 42)");
    }
  });

  it("passes landmark tops through the scan into band splitting", async () => {
    const fake = {
      launch: async () => ({
        newPage: async () => ({
          goto: async () => {},
          waitForTimeout: async () => {},
          evaluate: async () => ({
            title: "Giant Page",
            totalHeight: 6000,
            landmarks: [1000, 3000],
            candidates: [
              band({ label: "body", bg: "rgb(16, 21, 42)", top: 0, height: 6000 }),
            ],
          }),
        }),
        close: async () => {},
      }),
    };
    const res = await analyzePageStructure("https://example.com", async () => ({ chromium: fake }));
    expect("error" in res).toBe(false);
    if (!("error" in res)) {
      // The 6000px body band split at both landmarks; later subs carry an
      // empty label.
      expect(res.bands.map((b) => b.height)).toEqual([1000, 2000, 3000]);
      expect(res.bands.map((b) => b.label)).toEqual(["body", "", ""]);
      expect(res.bands.map((b) => b.offsetTop)).toEqual([0, 1000, 3000]);
    }
  });

  it("returns the install hint when playwright is missing", async () => {
    const res = await analyzePageStructure("https://example.com", async () => {
      throw new Error("Cannot find package 'playwright'");
    });
    expect("error" in res).toBe(true);
    if ("error" in res) expect(res.error).toContain("npx playwright install chromium");
  });

  it("defaults to the load strategy, settles, and scrolls before the scan", async () => {
    const calls: string[] = [];
    const fake = {
      launch: async () => ({
        newPage: async () => ({
          goto: async (_u: string, o: any) => { calls.push("goto:" + o.waitUntil); },
          waitForTimeout: async (ms: number) => { calls.push("wait:" + ms); },
          evaluate: async () => {
            calls.push("eval");
            return {
              title: "Test Page",
              totalHeight: 2000,
              candidates: [
                band({ label: "body", bg: "rgb(16, 21, 42)", top: 0, height: 2000 }),
              ],
            };
          },
        }),
        close: async () => {},
      }),
    };
    const res = await analyzePageStructure("https://example.com", async () => ({ chromium: fake }));
    expect("error" in res).toBe(false);
    expect(calls[0]).toBe("goto:load"); // default wait strategy is "load"
    expect(calls.indexOf("wait:3000")).toBe(1); // settle right after load
    expect(calls.filter((c) => c === "eval").length).toBe(2); // pre-scroll + scan
    expect(calls[calls.length - 1]).toBe("eval"); // scan runs last, after the scroll
  });

  // Fake chromium whose newPage captures its creation options so tests can
  // pin the viewport threading (desktop default vs the mobile profile flags).
  const optionCapturingFake = (captured: any[]) => ({
    launch: async () => ({
      newPage: async (opts: any) => {
        captured.push(opts);
        return {
          goto: async () => {},
          // settle wait from the load strategy; the fake's evaluate result is
          // returned for both the pre-scroll and the scan call
          waitForTimeout: async () => {},
          evaluate: async () => ({
            title: "Test Page",
            totalHeight: 2000,
            candidates: [
              band({ label: "body", bg: "rgb(16, 21, 42)", top: 0, height: 2000 }),
            ],
          }),
        };
      },
      close: async () => {},
    }),
  });

  it("uses the mobile viewport profile when opts.viewport is mobile", async () => {
    const captured: any[] = [];
    const res = await analyzePageStructure(
      "https://x.test",
      async () => ({ chromium: optionCapturingFake(captured) }),
      40,
      { viewport: "mobile" },
    );
    expect("error" in res).toBe(false);
    expect(captured).toHaveLength(1);
    // The profile is SPLIT: width/height land in playwright's `viewport` key,
    // the mobile flags are sibling context options.
    expect(captured[0]).toEqual({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
  });

  it("defaults to the desktop viewport (no mobile flags)", async () => {
    const captured: any[] = [];
    const res = await analyzePageStructure(
      "https://x.test",
      async () => ({ chromium: optionCapturingFake(captured) }),
    );
    expect("error" in res).toBe(false);
    expect(captured).toHaveLength(1);
    // Exact equality: the desktop default must inject no mobile flags and no
    // extra fields into newPage.
    expect(captured[0]).toEqual({ viewport: { width: 1440, height: 900 } });
  });
});

// No-arrow lock for SCAN_SNIPPET's in-page code: page.evaluate re-serializes
// the source, so the snippet (and every helper inside it) must stay a plain
// function / function declaration — no arrows anywhere in its body.
it("SCAN_SNIPPET is a serializable plain function (no-arrow lock)", () => {
  expect(typeof SCAN_SNIPPET).toBe("function");
  expect(String(SCAN_SNIPPET)).not.toContain("=>");
});

// Mirror of the SCAN_SNIPPET in-page alpha parse (src/structure.ts). The
// snippet runs in a browser DOM we cannot spin up in offline tests, so the
// parse logic is mirrored here to pin the exact contract: space syntax,
// slash notation, percentage alphas, and the rgba?()-miss fallback (modern
// color functions are opaque; anything else stays conservative at 0).
// Keep in sync with src/structure.ts.
it("SCAN_SNIPPET alpha parsing handles space syntax and percentage alphas", () => {
  const parseAlpha = (color: string): number => {
    const m = /rgba?\(([^)]+)\)/.exec(color);
    let alpha = 0;
    if (m) {
      const parts = m[1].replace(/\//g, " ").trim().split(/[\s,]+/).filter(Boolean);
      const aRaw = parts.length >= 4 ? parts[3] : "1";
      alpha = aRaw.endsWith("%") ? parseFloat(aRaw) / 100 : parseFloat(aRaw);
      if (Number.isNaN(alpha)) alpha = 0;
    } else if (/^(oklch|oklab|lab|lch|hwb|color)\(/.test(color.trim())) {
      alpha = 1;
    }
    return alpha;
  };
  expect(parseAlpha("rgb(16 21 42 / 0)")).toBe(0); // space syntax, transparent
  expect(parseAlpha("rgb(16, 21, 42, 0)")).toBe(0); // legacy comma, transparent
  expect(parseAlpha("rgb(16 21 42 / 50%)")).toBeCloseTo(0.5); // percentage alpha
  expect(parseAlpha("rgb(240, 242, 247)")).toBe(1); // opaque, no alpha part
  expect(parseAlpha("oklch(0.7 0.1 200)")).toBe(1); // modern opaque function
  expect(parseAlpha("color(srgb 0.2 0.4 0.6)")).toBe(1); // modern opaque function
  expect(parseAlpha("linear-gradient(...)")).toBe(0); // non-function → conservative
});
