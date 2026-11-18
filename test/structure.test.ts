import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildResponsiveReport,
  collapseBands,
  analyzePageStructure,
  coordinateY,
  MAX_PRESCROLL_STEPS,
  preScroll,
  PRE_SCROLL_DEADLINE_MS,
  selectorFromParts,
  splitCollapsedBands,
  diffBands,
  SCAN_SNIPPET,
} from "../src/structure.js";
import type { PageBand, PageStructure, RawResponsiveElement, RawResponsiveScan } from "../src/structure.js";
import type { RawBand } from "../src/structure.js";
import { VIEWPORT_PROFILES } from "../src/viewport.js";

const FIXTURES = join(__dirname, "fixtures");

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

describe("buildResponsiveReport", () => {
  it("orders kinds, caps each at 10, keeps raw counts and marks truncation", () => {
    const raw = JSON.parse(
      readFileSync(join(FIXTURES, "responsive", "scan-overflow.json"), "utf8"),
    ) as RawResponsiveScan;
    const report = buildResponsiveReport(raw);
    expect(report.measuredAt).toBe("mobile");
    expect(report.viewport).toEqual({ width: 390, height: 844, dpr: 3 });
    expect(report.pageOverflow).toEqual({ horizontal: true, scrollWidth: 421, innerWidth: 390 });
    expect(report.issues.map((i) => i.kind)).toEqual([
      ...Array(10).fill("overflow"),
      "small-text",
      "small-tap-target",
    ]);
    expect(report.issues[0]!.selector).toBe("div.hero > img.banner");
    expect(report.issues[0]!.rect).toEqual({ x: 320, y: 10, w: 300, h: 120 });
    expect(report.issues[10]!.selector).toBe("main > p.lede");
    expect(report.issues[11]!.selector).toBe("button#cta");
    expect(report.counts).toEqual({ overflow: 12, smallText: 1, smallTapTarget: 1 });
    expect(report.truncated).toBe(true);
  });

  it("returns zero issues for a clean scan", () => {
    const raw = JSON.parse(
      readFileSync(join(FIXTURES, "responsive", "scan-clean.json"), "utf8"),
    ) as RawResponsiveScan;
    const report = buildResponsiveReport(raw);
    expect(report.issues).toEqual([]);
    expect(report.pageOverflow).toEqual({ horizontal: false, scrollWidth: 390, innerWidth: 390 });
    expect(report.counts).toEqual({ overflow: 0, smallText: 0, smallTapTarget: 0 });
    expect(report.truncated).toBe(false);
  });

  const rawElement = (parts: string[], y = 0): RawResponsiveElement => ({
    parts,
    x: 400,
    y,
    w: 50,
    h: 10,
    detail: "evidence",
  });

  const rawScan = (over: Partial<RawResponsiveScan> = {}): RawResponsiveScan => ({
    innerWidth: 390,
    scrollWidth: 390,
    counts: { overflow: 0, smallText: 0, smallTapTarget: 0 },
    overflow: [],
    smallText: [],
    smallTapTarget: [],
    ...over,
  });

  it("defensively caps an over-long raw overflow array at 10", () => {
    const raw = rawScan({
      scrollWidth: 421,
      counts: { overflow: 12, smallText: 0, smallTapTarget: 0 },
      overflow: Array.from({ length: 12 }, (_, i) => rawElement([`div.o${i}`], i * 10)),
    });
    const report = buildResponsiveReport(raw);
    expect(report.issues).toHaveLength(10);
    expect(report.counts.overflow).toBe(12);
    expect(report.truncated).toBe(true);
  });

  it("caps smallText at 10 while reporting the pre-cap count (11 → truncated)", () => {
    const raw = rawScan({
      counts: { overflow: 0, smallText: 11, smallTapTarget: 0 },
      smallText: Array.from({ length: 11 }, (_, i) => rawElement([`p.t${i}`], i * 10)),
    });
    const report = buildResponsiveReport(raw);
    expect(report.issues.filter((i) => i.kind === "small-text")).toHaveLength(10);
    expect(report.counts.smallText).toBe(11);
    expect(report.truncated).toBe(true);
  });

  it("caps smallTapTarget at 10 while reporting the pre-cap count (11 → truncated)", () => {
    const raw = rawScan({
      counts: { overflow: 0, smallText: 0, smallTapTarget: 11 },
      smallTapTarget: Array.from({ length: 11 }, (_, i) => rawElement([`button.b${i}`], i * 10)),
    });
    const report = buildResponsiveReport(raw);
    expect(report.issues.filter((i) => i.kind === "small-tap-target")).toHaveLength(10);
    expect(report.counts.smallTapTarget).toBe(11);
    expect(report.truncated).toBe(true);
  });

  it("keeps 10 of each kind without truncation when the caps are not hit", () => {
    const raw = rawScan({
      counts: { overflow: 0, smallText: 10, smallTapTarget: 10 },
      smallText: Array.from({ length: 10 }, (_, i) => rawElement([`p.t${i}`], i * 10)),
      smallTapTarget: Array.from({ length: 10 }, (_, i) => rawElement([`button.b${i}`], i * 10)),
    });
    const report = buildResponsiveReport(raw);
    expect(report.issues).toHaveLength(20);
    expect(report.truncated).toBe(false);
  });

  it("derives viewport from the profile used (default is the mobile profile)", () => {
    const raw = rawScan();
    const fallback = buildResponsiveReport(raw);
    expect(fallback.viewport).toEqual({
      width: VIEWPORT_PROFILES.mobile.width,
      height: VIEWPORT_PROFILES.mobile.height,
      dpr: VIEWPORT_PROFILES.mobile.deviceScaleFactor,
    });
    const custom = buildResponsiveReport(raw, {
      width: 412,
      height: 915,
      deviceScaleFactor: 2.625,
      isMobile: true,
    });
    expect(custom.viewport).toEqual({ width: 412, height: 915, dpr: 2.625 });
  });
});

describe("selectorFromParts", () => {
  it("reverses innermost-first parts and joins with >", () => {
    expect(selectorFromParts(["img.banner", "div.hero"])).toBe("div.hero > img.banner");
    expect(selectorFromParts([])).toBe("");
  });

  it("caps the selector at 160 characters", () => {
    expect(selectorFromParts(["x".repeat(200)])).toHaveLength(160);
  });
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

  it("caps added, removed and reordered lists at 60", () => {
    const many = Array.from({ length: 65 }, (_, i) => pageBand(`.b${i}`, 10, i * 10, i));
    const baseOne = page([pageBand(".only", 10)], 10);
    const all = page([pageBand(".only", 10), ...many], 660);
    expect(diffBands(baseOne, all).bandsAdded).toHaveLength(60);
    expect(diffBands(all, baseOne).bandsRemoved).toHaveLength(60);
    expect(diffBands(page(many, 650), page([...many].reverse(), 650)).reordered).toHaveLength(60);
  });

  it("does not match distinct labels sharing a >24-char prefix (full labels returned)", () => {
    const prefix = "a".repeat(30);
    const base = page([pageBand(`${prefix}-hero`, 500)], 500);
    const other = page([pageBand(`${prefix}-footer`, 500)], 500);
    expect(diffBands(base, other)).toEqual({
      heightDelta: 0,
      bandsAdded: [`${prefix}-footer`],
      bandsRemoved: [`${prefix}-hero`],
      reordered: [],
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

// Review pins: the responsive predicates have no DOM executor offline, so each
// exclusion/guard is source-locked — deleting one fails a named assertion.
describe("SCAN_SNIPPET responsive predicates (source-lock)", () => {
  const src = String(SCAN_SNIPPET);

  it("measures overflow against documentElement.clientWidth, not window.innerWidth", () => {
    expect(src).toContain("doc.documentElement.clientWidth || g.innerWidth");
    expect(src).toContain("right > viewportWidth + 1");
    expect(src).toContain("innerWidth: viewportWidth");
  });

  it("§7: an inline prose link is not a tap target", () => {
    expect(src).toContain('g.getComputedStyle(el).display === "inline"');
    expect(src).toContain('String(el.tagName || "").toLowerCase() === "a"');
    expect(src).toContain('doc.querySelectorAll("a[href], button, input, select, textarea, [role=button]")');
  });

  it("§7: a marquee inside an overflow-x scroller is excluded from offences", () => {
    expect(src).toContain('s.overflowX === "auto" || s.overflowX === "scroll"');
    expect(src).toContain('s.overflowX === "hidden" && !isRoot');
    expect(src).toContain("hasTransformLike(s) && !isRoot");
    expect(src).toContain("hasNonDefaultZoom(style.zoom)");
    expect(src).toContain("!insideScroller(el)");
    expect(src).toContain("depth < 100");
  });

  // A hidden clip or transform on body/html applies to the whole page, so it
  // must not excuse offenders: otherwise `overflow-x:hidden` on the root
  // reports pageOverflow with an empty offender list. No DOM executor here,
  // so the root exception is source-locked per the house pattern.
  it("a root overflow-x:hidden or transform still reports overflow offenders", () => {
    expect(src).toContain("const isRoot = cur === doc.body || cur === doc.documentElement;");
    expect(src).toContain('s.overflowX === "hidden" && !isRoot');
    expect(src).toContain("hasTransformLike(s) && !isRoot");
    expect(src).toContain("right > viewportWidth + 1 && !insideScroller(el)");
  });

  it("counts small text only when the element owns a direct text node below 12px", () => {
    expect(src).toContain("if (!hasDirectText(el)) continue;");
    expect(src).toContain("if (!(size < 12)) continue;");
  });

  it("only measures widths > 0 and keeps the widest overflow offenders first", () => {
    expect(src).toContain("if (r.width > 0) {");
    expect(src).toContain("return b.over - a.over;");
  });

  it("keeps the 24px tap floor and a per-kind cap of 10", () => {
    expect(src).toContain("if (r.width >= 24 && r.height >= 24) continue;");
    expect(src).toContain("overflow.length < 10");
    expect(src).toContain("smallText.length < 10");
    expect(src).toContain("smallTapTarget.length < 10");
  });

  it("guards the scan on args.responsive === true and uses document scroll offsets", () => {
    expect(src).toContain("args.responsive === true");
    expect(src).toContain("r.left + g.scrollX");
    expect(src).toContain("r.top + g.scrollY");
  });

  it("rejects opacity:0 and clipped sr-only boxes as invisible", () => {
    expect(src).toContain('parseFloat(String(s.opacity || "1")) === 0');
    expect(src).toContain('clip === "rect(0px, 0px, 0px, 0px)"');
    expect(src).toContain('clipPath === "inset(50%)"');
  });

  it("mirrors a11y.ts selector parts: classList[0] only, 4 parts, id stops", () => {
    expect(src).toContain("while (cur && cur.nodeType === 1 && depth < 4)");
    expect(src).toContain("String(cur.classList[0])");
    expect(src).toContain('parts.push(tag + "#" + String(cur.id))');
    expect(src).not.toContain("classes[i]"); // no fallback to later classes
  });

  // §7 acceptance: run the in-page snippet against a minimal DOM. The inline
  // prose link must be excluded at scan time, leaving exactly 3 issues.
  it("§7 acceptance: one overflow, one 10px text, one 16px button and an inline link report 3 issues", () => {
    type FakeEl = {
      tagName: string;
      id: string;
      classList: string[];
      children: FakeEl[];
      childNodes: Array<{ nodeType: number; textContent: string }>;
      parentElement: FakeEl | null;
      nodeType: number;
      textContent: string;
      rect: { left: number; top: number; width: number; height: number };
      style: Record<string, string>;
      getBoundingClientRect: () => { left: number; top: number; width: number; height: number };
    };
    const el = (
      tagName: string,
      rect: FakeEl["rect"],
      style: Record<string, string> = {},
      text = "",
      className = "",
    ): FakeEl => {
      const node: FakeEl = {
        tagName,
        id: "",
        classList: className ? [className] : [],
        children: [],
        childNodes: text ? [{ nodeType: 3, textContent: text }] : [],
        parentElement: null,
        nodeType: 1,
        textContent: text,
        rect,
        style,
        getBoundingClientRect: () => node.rect,
      };
      return node;
    };
    const html = el("html", { left: 0, top: 0, width: 390, height: 800 });
    const body = el("body", { left: 0, top: 0, width: 390, height: 800 }, {}, "", "page");
    const overflow = el("div", { left: 320, top: 10, width: 300, height: 100 }, {}, "wide", "overflow");
    const smallText = el("p", { left: 16, top: 240, width: 320, height: 14 }, { fontSize: "10px" }, "small text", "lede");
    const button = el("button", { left: 16, top: 360, width: 16, height: 16 }, {}, "Go", "cta");
    const inlineLink = el("a", { left: 40, top: 400, width: 80, height: 16 }, { display: "inline" }, "prose link", "link");
    html.children = [body];
    body.children = [overflow, smallText, button, inlineLink];
    for (const child of body.children) child.parentElement = body;
    body.parentElement = html;
    const documentElement = Object.assign(html, { scrollHeight: 800, clientWidth: 390, scrollWidth: 421 });
    const fakeDoc = {
      title: "Acceptance",
      documentElement,
      body,
      querySelectorAll: (selector: string): FakeEl[] => {
        if (selector === "*") return [html, body, overflow, smallText, button, inlineLink];
        if (selector.includes("a[href]")) return [button, inlineLink];
        return [];
      },
    };
    const g = globalThis as any;
    const saved = {
      document: g.document,
      getComputedStyle: g.getComputedStyle,
      scrollX: g.scrollX,
      scrollY: g.scrollY,
    };
    g.document = fakeDoc;
    g.scrollX = 0;
    g.scrollY = 0;
    g.getComputedStyle = (node: FakeEl) => ({
      display: node.style.display ?? "block",
      visibility: "visible",
      opacity: "1",
      clip: "",
      clipPath: "",
      overflowX: "visible",
      transform: "none",
      fontSize: node.style.fontSize ?? "16px",
      backgroundColor: "rgb(255, 255, 255)",
    });
    try {
      const raw = SCAN_SNIPPET({ responsive: true }).responsive!;
      expect(raw.counts).toEqual({ overflow: 1, smallText: 1, smallTapTarget: 1 });
      expect(raw.overflow).toHaveLength(1);
      expect(raw.smallText[0]!.detail).toContain("10px");
      expect(raw.smallTapTarget).toHaveLength(1);
      expect(raw.smallTapTarget[0]!.parts[0]).toBe("button.cta");
      const report = buildResponsiveReport(raw);
      expect(report.issues.map((i) => i.kind)).toEqual([
        "overflow",
        "small-text",
        "small-tap-target",
      ]);
      expect(report.issues).toHaveLength(3);
      expect(report.truncated).toBe(false);
    } finally {
      g.document = saved.document;
      g.getComputedStyle = saved.getComputedStyle;
      g.scrollX = saved.scrollX;
      g.scrollY = saved.scrollY;
    }
  });
});

// Inner scroll containers (body{position:fixed} + div.page{overflow-y:auto}):
// the scan must report scroller coordinates so bands match the real content
// height instead of one viewport-tall band.
describe("inner scroll root", () => {
  it("coordinateY maps document-root and element-scroller rect tops", () => {
    expect(coordinateY(100, 500)).toBe(600);
    expect(coordinateY(100, 500, null)).toBe(600);
    // Scroller top 20, scrolled 3000: element at viewport 120 sits at content 3100.
    expect(coordinateY(120, 999, { top: 20, scrollTop: 3000 })).toBe(3100);
    // Window scroll cancels out of the scroller form (both rects move together).
    expect(coordinateY(120 + 250, 250, { top: 20 + 250, scrollTop: 3000 })).toBe(3100);
  });

  it("collapses a scroller scan in scroller coordinates", () => {
    const raw = {
      title: "Scroller",
      totalHeight: 4992,
      scrollRoot: "div#page.page",
      candidates: [
        { tag: "body", label: "body", bg: "rgb(0, 0, 0)", top: 0, height: 4992, textStart: "" },
        { tag: "section", label: ".hero", bg: "rgb(255, 255, 255)", top: 0, height: 2496, textStart: "Hero" },
        { tag: "section", label: ".outro", bg: "rgb(0, 0, 255)", top: 2496, height: 2496, textStart: "Outro" },
      ],
    };
    const bands = collapseBands(raw.candidates, raw.totalHeight);
    expect(bands.map((b) => [b.offsetTop, b.height, b.label])).toEqual([
      [0, 2496, ".hero"],
      [2496, 2496, ".outro"],
    ]);
    expect(splitCollapsedBands(bands, [1500]).map((b) => b.offsetTop)).toEqual([0, 2496]);
  });

  it("escapes special-character ids/classes in scrollRoot so re-query stays valid", () => {
    const label = String.raw`div#page\:main\/x\.y.scroll\.inner`;
    const scroller = {
      tagName: "DIV",
      id: "page:main/x.y",
      classList: ["scroll.inner"],
      scrollHeight: 4000,
      clientHeight: 900,
      scrollTop: 0,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1440, height: 900 }),
    };
    const body = {
      tagName: "BODY",
      id: "",
      classList: [] as string[],
      children: [] as any[],
      textContent: "",
      getBoundingClientRect: () => ({ width: 1440, height: 900 }),
    };
    const fakeDoc = {
      title: "Special",
      documentElement: { scrollHeight: 900, clientHeight: 900 },
      body,
      querySelectorAll: (selector: string) => {
        if (selector === "*") return [body, scroller];
        // capture re-queries the exact label the scan returned.
        if (selector === label) return [scroller];
        return [];
      },
    };
    const g = globalThis as any;
    const saved = {
      document: g.document,
      CSS: g.CSS,
      getComputedStyle: g.getComputedStyle,
      scrollX: g.scrollX,
      scrollY: g.scrollY,
    };
    g.document = fakeDoc;
    g.scrollX = 0;
    g.scrollY = 0;
    g.getComputedStyle = () => ({
      overflowY: "auto",
      display: "block",
      visibility: "visible",
      backgroundColor: "rgb(255, 255, 255)",
    });
    try {
      g.CSS = { escape: (s: string) => String(s).replace(/[^A-Za-z0-9_-]/g, "\\$&") };
      expect(SCAN_SNIPPET({}).scrollRoot).toBe(label);
      expect(fakeDoc.querySelectorAll(label)).toHaveLength(1);
      // Old engine / fake page without CSS.escape: the fallback escapes the same
      // punctuation, so the label stays a valid one-element selector.
      g.CSS = undefined;
      expect(SCAN_SNIPPET({}).scrollRoot).toBe(label);
      expect(fakeDoc.querySelectorAll(label)).toHaveLength(1);
    } finally {
      g.document = saved.document;
      g.CSS = saved.CSS;
      g.getComputedStyle = saved.getComputedStyle;
      g.scrollX = saved.scrollX;
      g.scrollY = saved.scrollY;
    }
  });

  it("passes the scanned scrollRoot through to PageStructure", async () => {
    const fake = {
      launch: async () => ({
        newPage: async () => ({
          goto: async () => {},
          waitForTimeout: async () => {},
          evaluate: async () => ({
            title: "Pinned Body",
            totalHeight: 4000,
            scrollRoot: "div#page.page",
            candidates: [band({ label: "body", top: 0, height: 4000 })],
          }),
        }),
        close: async () => {},
      }),
    };
    const res = await analyzePageStructure("https://example.com", async () => ({ chromium: fake }));
    expect("error" in res).toBe(false);
    if (!("error" in res)) expect(res.scrollRoot).toBe("div#page.page");
  });

  it("omits scrollRoot for document-root scans", async () => {
    const fake = {
      launch: async () => ({
        newPage: async () => ({
          goto: async () => {},
          waitForTimeout: async () => {},
          evaluate: async () => ({
            title: "Normal",
            totalHeight: 800,
            candidates: [band({ label: "body", top: 0, height: 800 })],
          }),
        }),
        close: async () => {},
      }),
    };
    const res = await analyzePageStructure("https://example.com", async () => ({ chromium: fake }));
    expect("error" in res).toBe(false);
    if (!("error" in res)) expect("scrollRoot" in res).toBe(false);
  });

  it("SCAN_SNIPPET detection and preScroll mirror each other (source-lock)", () => {
    const scan = String(SCAN_SNIPPET);
    const scroll = String(preScroll);
    for (const src of [scan, scroll]) {
      expect(src).toContain("el === doc.body || el === doc.documentElement");
      expect(src).toContain("el.scrollHeight > el.clientHeight + 100");
      expect(src).toContain('String(s.overflowY) !== "auto" && String(s.overflowY) !== "scroll"');
      expect(src).toContain("css.escape"); // id/class escaped for a valid selector
    }
    expect(scan).toContain("Math.max(Number(de.scrollHeight || 0), bodyHeight) > viewportHeight + 100"); // document scroll wins
    expect(scan).toContain("r.top - scrollerTop + scrollerScrollTop");
    expect(scan).toContain("out.scrollRoot = scrollRootLabel(scroller)");
    expect(scroll).toContain("Math.max(Number(de.scrollHeight || 0), bodyHeight) > viewportHeight + 100");
    expect(scroll).toContain('behavior: "instant"');
    expect(scroll).toContain("scroller.scrollTop = y");
    expect(scroll).toContain("scroller.scrollTop = 0");
  });
});

// The pre-scroll walk must terminate even when a page grows its scrollHeight
// on every scroll: 80 × 450px steps / 8s hard cap, then back to the top.
describe("preScroll caps", () => {
  const withFakes = async (
    doc: any,
    win: any,
    run: () => Promise<unknown>,
    styles: Record<string, unknown> = {},
    stylesFor?: (node: any) => Record<string, unknown>,
  ) => {
    const g = globalThis as any;
    const saved = {
      document: g.document,
      window: g.window,
      setTimeout: g.setTimeout,
      getComputedStyle: g.getComputedStyle,
    };
    g.document = doc;
    g.window = win;
    g.getComputedStyle = (node: any) => ({
      overflowY: "auto",
      display: "block",
      visibility: "visible",
      ...styles,
      ...(stylesFor ? stylesFor(node) : {}),
    });
    g.setTimeout = (cb: any) => saved.setTimeout(cb, 0); // no real 40ms settle in tests
    try {
      return await run();
    } finally {
      g.document = saved.document;
      g.window = saved.window;
      g.setTimeout = saved.setTimeout;
      g.getComputedStyle = saved.getComputedStyle;
    }
  };

  it("caps the window walk when scrollHeight keeps growing, then resets", async () => {
    const scrolled: number[] = [];
    let height = 1000;
    const doc = {
      documentElement: {
        get scrollHeight() {
          return height;
        },
        clientHeight: 900,
      },
      body: {},
      querySelectorAll: () => [],
    };
    const win = {
      scrollTo: (...args: any[]) => {
        const position = args[0];
        const y = typeof position === "object" ? Number(position.top) : Number(args[1]);
        scrolled.push(y);
        height += 4500; // would never terminate without the cap
      },
    };
    await withFakes(doc, win, () =>
      preScroll({ evaluate: async (fn: any) => fn() }),
    );
    expect(scrolled).toHaveLength(MAX_PRESCROLL_STEPS + 1);
    expect(scrolled[MAX_PRESCROLL_STEPS]).toBe(0); // reset
    expect(Math.max(...scrolled)).toBe(450 * (MAX_PRESCROLL_STEPS - 1));
  });

  it("caps the inner-scroller walk and resets scrollTop", async () => {
    const tops: number[] = [];
    let height = 2000;
    let top = 0;
    const el = {
      tagName: "DIV",
      id: "page",
      classList: [],
      clientHeight: 900,
      get scrollHeight() {
        return height;
      },
      get scrollTop() {
        return top;
      },
      set scrollTop(v: number) {
        top = v;
        tops.push(v);
        height += 4500;
      },
      getBoundingClientRect: () => ({ width: 1440, height: 900 }),
    };
    const doc = {
      documentElement: { scrollHeight: 900, clientHeight: 900 },
      body: {},
      querySelectorAll: (sel: string) => (sel === "*" ? [el] : []),
    };
    const win = {
      scrollTo: () => {
        throw new Error("window must not scroll when an inner root exists");
      },
    };
    await withFakes(doc, win, () =>
      preScroll({ evaluate: async (fn: any) => fn() }),
    );
    expect(tops).toHaveLength(MAX_PRESCROLL_STEPS + 1);
    expect(tops[MAX_PRESCROLL_STEPS]).toBe(0); // reset
    expect(Math.max(...tops)).toBe(450 * (MAX_PRESCROLL_STEPS - 1));
  });

  it("returns document metrics and a null scrollRoot for a document-scrolling page", async () => {
    const doc = {
      documentElement: { scrollHeight: 2000, clientHeight: 900 },
      body: {},
      querySelectorAll: () => [],
    };
    const win = { scrollTo: () => {} };
    const info = await withFakes(doc, win, () =>
      preScroll({ evaluate: async (fn: any) => fn() }),
    );
    expect(info).toEqual({ scrollRoot: null, scrollHeight: 2000, clientHeight: 900 });
  });

  it("reports a diagnostic virtualHeight only for a credible virtual wrapper", async () => {
    const wrapper = {
      tagName: "DIV",
      id: "smooth",
      nodeType: 1,
      classList: [],
      children: [],
      parentElement: null,
      scrollHeight: 0,
      clientHeight: 0,
      scrollTop: 0,
      style: {},
      getBoundingClientRect: () => ({ width: 1440, height: 9000 }),
    };
    const doc = {
      documentElement: { scrollHeight: 900, clientHeight: 900 },
      body: { scrollHeight: 900, getBoundingClientRect: () => ({ width: 1440 }) },
      querySelectorAll: (sel: string) => (sel === "*" ? [wrapper] : []),
    };
    const win = { scrollTo: () => {} };
    const info = await withFakes(doc, win, () =>
      preScroll({ evaluate: async (fn: any) => fn() }),
    );
    expect(info).toEqual({
      scrollRoot: null,
      scrollHeight: 900,
      clientHeight: 900,
      virtualHeight: 9000,
    });
  });

  it("keeps a subpixel clipped virtual wrapper and restricts transform proofs", async () => {
    const makeWrapper = (styles: Record<string, unknown>) => {
      const wrapper = {
        tagName: "DIV",
        id: "subpixel",
        nodeType: 1,
        classList: [],
        children: [],
        parentElement: null,
        scrollHeight: 0,
        clientHeight: 0,
        scrollTop: 0,
        offsetWidth: 1440,
        offsetHeight: 1200,
        style: {},
        getBoundingClientRect: () => ({ width: 1440, height: 1200.390625 }),
      };
      return { wrapper, styles };
    };
    const baseDoc = (wrapper: any) => ({
      documentElement: { scrollHeight: 900, clientHeight: 900 },
      body: { scrollHeight: 900, getBoundingClientRect: () => ({ width: 1440 }) },
      querySelectorAll: (sel: string) => (sel === "*" ? [wrapper] : []),
    });

    const plain = makeWrapper({ clipPath: "inset(600.1px 0)" });
    const plainInfo = await withFakes(
      baseDoc(plain.wrapper),
      { scrollTo: () => {} },
      () => preScroll({ evaluate: async (fn: any) => fn() }),
      { overflowY: "visible" },
      (node) => (node === plain.wrapper ? plain.styles : {}),
    );
    expect((plainInfo as any).virtualHeight).toBe(1200);

    // Local px insets cannot be mapped through a transform: retain.
    const transformed = makeWrapper({
      clipPath: "inset(600.1px 0)",
      transform: "translateZ(0)",
    });
    const transformedInfo = await withFakes(
      baseDoc(transformed.wrapper),
      { scrollTo: () => {} },
      () => preScroll({ evaluate: async (fn: any) => fn() }),
      { overflowY: "visible" },
      (node) => (node === transformed.wrapper ? transformed.styles : {}),
    );
    expect((transformedInfo as any).virtualHeight).toBe(1200);

    // Individual `scale` is a transform too: local px cannot be mapped.
    const scaled = makeWrapper({
      clipPath: "inset(650px 0)",
      scale: "0.5",
    });
    const scaledInfo = await withFakes(
      baseDoc(scaled.wrapper),
      { scrollTo: () => {} },
      () => preScroll({ evaluate: async (fn: any) => fn() }),
      { overflowY: "visible" },
      (node) => (node === scaled.wrapper ? scaled.styles : {}),
    );
    expect((scaledInfo as any).virtualHeight).toBe(1200);

    // `zoom` is a geometry transform too.
    const zoomed = makeWrapper({
      clipPath: "inset(650px 0)",
      zoom: "0.5",
    });
    const zoomedInfo = await withFakes(
      baseDoc(zoomed.wrapper),
      { scrollTo: () => {} },
      () => preScroll({ evaluate: async (fn: any) => fn() }),
      { overflowY: "visible" },
      (node) => (node === zoomed.wrapper ? zoomed.styles : {}),
    );
    expect((zoomedInfo as any).virtualHeight).toBe(1200);

    // A percentage sum >= 100% still proves emptiness under a transform.
    const empty = makeWrapper({
      clipPath: "inset(100%)",
      transform: "translateZ(0)",
    });
    const emptyInfo = await withFakes(
      baseDoc(empty.wrapper),
      { scrollTo: () => {} },
      () => preScroll({ evaluate: async (fn: any) => fn() }),
      { overflowY: "visible" },
      (node) => (node === empty.wrapper ? empty.styles : {}),
    );
    expect("virtualHeight" in (emptyInfo as any)).toBe(false);
  });

  it("withholds virtualHeight for provably empty clip-path and legacy clip wrappers", async () => {
    for (const styles of [
      { clipPath: "inset(100%)" },
      { position: "absolute", clip: "rect(0,0,0,0)" },
    ]) {
      const wrapper = {
        tagName: "DIV",
        id: "clip-shape",
        nodeType: 1,
        classList: [],
        children: [],
        parentElement: null,
        scrollHeight: 0,
        clientHeight: 0,
        scrollTop: 0,
        style: {},
        getBoundingClientRect: () => ({ width: 1440, height: 9000 }),
      };
      const doc = {
        documentElement: { scrollHeight: 900, clientHeight: 900 },
        body: { scrollHeight: 900, getBoundingClientRect: () => ({ width: 1440 }) },
        querySelectorAll: (sel: string) => (sel === "*" ? [wrapper] : []),
      };
      const info = await withFakes(
        doc,
        { scrollTo: () => {} },
        () => preScroll({ evaluate: async (fn: any) => fn() }),
        styles,
      );
      expect("virtualHeight" in (info as any)).toBe(false);
    }
  });

  it("withholds virtualHeight for a clipped wrapper", async () => {
    const wrapper = {
      tagName: "DIV",
      id: "clip",
      nodeType: 1,
      classList: [],
      children: [],
      parentElement: null,
      scrollHeight: 0,
      clientHeight: 0,
      scrollTop: 0,
      style: {},
      getBoundingClientRect: () => ({ width: 1440, height: 9000 }),
    };
    const doc = {
      documentElement: { scrollHeight: 900, clientHeight: 900 },
      body: { scrollHeight: 900, getBoundingClientRect: () => ({ width: 1440 }) },
      querySelectorAll: (sel: string) => (sel === "*" ? [wrapper] : []),
    };
    const win = { scrollTo: () => {} };
    const info = await withFakes(
      doc,
      win,
      () => preScroll({ evaluate: async (fn: any) => fn() }),
      { overflowY: "hidden" },
    );
    expect("virtualHeight" in (info as any)).toBe(false);
  });

  it("withholds virtualHeight for content-visibility and filtered wrappers", async () => {
    for (const hiddenStyle of [
      { contentVisibility: "hidden" },
      { filter: "opacity(0)" },
    ]) {
      const wrapper = {
        tagName: "DIV",
        id: "invisible",
        nodeType: 1,
        classList: [],
        children: [],
        parentElement: null,
        scrollHeight: 0,
        clientHeight: 0,
        scrollTop: 0,
        style: {},
        getBoundingClientRect: () => ({ width: 1440, height: 9000 }),
      };
      const doc = {
        documentElement: { scrollHeight: 900, clientHeight: 900 },
        scrollingElement: { scrollHeight: 900, clientHeight: 900 },
        body: { scrollHeight: 900, getBoundingClientRect: () => ({ width: 1440 }) },
        querySelectorAll: (sel: string) => (sel === "*" ? [wrapper] : []),
      };
      const info = await withFakes(
        doc,
        { scrollTo: () => {} },
        () => preScroll({ evaluate: async (fn: any) => fn() }),
        {},
        (node) => (node === wrapper ? hiddenStyle : {}),
      );
      expect("virtualHeight" in (info as any)).toBe(false);
    }
  });

  it("reports body-scroller content height and no virtual hint", async () => {
    for (const bodyHeight of [6000, 950, 1000]) {
      const doc = {
        documentElement: { scrollHeight: 900, clientHeight: 900 },
        scrollingElement: { scrollHeight: 900, clientHeight: 900 },
        body: {
          scrollHeight: bodyHeight,
          clientHeight: 900,
          getBoundingClientRect: () => ({ width: 1440 }),
        },
        querySelectorAll: () => [],
      };
      const info = await withFakes(doc, { scrollTo: () => {} }, () =>
        preScroll({ evaluate: async (fn: any) => fn() }),
      );
      expect(info).toEqual({
        scrollRoot: null,
        scrollHeight: bodyHeight,
        clientHeight: 900,
      });
    }
  });

  it("returns metrics measured after the walk when a lazy page grows", async () => {
    let height = 2000;
    const doc = {
      documentElement: {
        get scrollHeight() {
          return height;
        },
        clientHeight: 900,
      },
      scrollingElement: {
        get scrollHeight() {
          return height;
        },
        clientHeight: 900,
      },
      body: {
        get scrollHeight() {
          return height;
        },
        clientHeight: 900,
        getBoundingClientRect: () => ({ width: 1440 }),
      },
      querySelectorAll: () => [],
    };
    const win = { scrollTo: () => { height = 9000; } };
    const info = await withFakes(
      doc,
      win,
      () => preScroll({ evaluate: async (fn: any) => fn() }),
      { overflowY: "visible" },
    );
    expect(info.scrollHeight).toBe(9000);
    expect("virtualHeight" in (info as any)).toBe(false);
  });

  it("does not report virtualHeight from a layout that grew during the walk", async () => {
    let height = 950;
    let wrapperHeight = 950;
    const wrapper = {
      tagName: "DIV",
      id: "grow",
      classList: [],
      nodeType: 1,
      parentElement: null,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1440, height: wrapperHeight }),
    };
    const doc = {
      documentElement: {
        get scrollHeight() {
          return height;
        },
        clientHeight: 900,
      },
      scrollingElement: {
        get scrollHeight() {
          return height;
        },
        clientHeight: 900,
      },
      body: {
        get scrollHeight() {
          return height;
        },
        clientHeight: 900,
        getBoundingClientRect: () => ({ width: 1440 }),
      },
      querySelectorAll: (sel: string) => (sel === "*" ? [wrapper] : []),
    };
    const win = {
      scrollTo: () => {
        height = 8550;
        wrapperHeight = 8550;
      },
    };
    const info = await withFakes(
      doc,
      win,
      () => preScroll({ evaluate: async (fn: any) => fn() }),
      { overflowY: "visible" },
    );
    expect(info.scrollHeight).toBe(8550);
    expect("virtualHeight" in (info as any)).toBe(false);
  });

  it("returns the inner scroller label and its metrics", async () => {
    const el = {
      tagName: "DIV",
      id: "page",
      classList: ["page"],
      clientHeight: 800,
      scrollHeight: 4000,
      scrollTop: 0,
      getBoundingClientRect: () => ({ width: 1440, height: 800 }),
    };
    const doc = {
      documentElement: { scrollHeight: 800, clientHeight: 800 },
      body: {},
      querySelectorAll: (sel: string) => (sel === "*" ? [el] : []),
    };
    const win = { scrollTo: () => {} };
    const info = await withFakes(doc, win, () =>
      preScroll({ evaluate: async (fn: any) => fn() }),
    );
    expect(info).toEqual({ scrollRoot: "div#page.page", scrollHeight: 4000, clientHeight: 800 });
    expect(el.scrollTop).toBe(0); // walk reset the scroller
  });

  it("escapes special-character scroller ids/classes (CSS.escape and fallback)", async () => {
    const el = {
      tagName: "DIV",
      id: "page:main/x.y",
      classList: ["scroll.inner"],
      clientHeight: 900,
      scrollHeight: 2000,
      scrollTop: 0,
      getBoundingClientRect: () => ({ width: 1440, height: 900 }),
    };
    const doc = {
      documentElement: { scrollHeight: 900, clientHeight: 900 },
      body: {},
      querySelectorAll: (sel: string) => (sel === "*" ? [el] : []),
    };
    const win = { scrollTo: () => {} };
    const g = globalThis as any;
    const saved = g.CSS;
    const expected = String.raw`div#page\:main\/x\.y.scroll\.inner`;
    try {
      g.CSS = { escape: (s: string) => String(s).replace(/[^A-Za-z0-9_-]/g, "\\$&") };
      const escaped = await withFakes(doc, win, () =>
        preScroll({ evaluate: async (fn: any) => fn() }),
      );
      expect(escaped.scrollRoot).toBe(expected);
      // No CSS.escape in an old engine/fake page: the fallback still escapes.
      g.CSS = undefined;
      const fallback = await withFakes(doc, win, () =>
        preScroll({ evaluate: async (fn: any) => fn() }),
      );
      expect(fallback.scrollRoot).toBe(expected);
    } finally {
      g.CSS = saved;
    }
  });

  it("source-locks the cap literals and applies them to both walks", () => {
    const src = String(preScroll);
    expect(src).toContain(`maxSteps = ${MAX_PRESCROLL_STEPS}`);
    expect(PRE_SCROLL_DEADLINE_MS).toBe(8000);
    expect(src).toMatch(/deadlineMs = (8e3|8000)/); // esbuild prints 8000 as 8e3
    expect(src).toContain("Date.now() - started < deadlineMs");
    expect(src.match(/steps < maxSteps/g)).toHaveLength(2);
  });
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

  it("passes the responsive flag to the scan and builds the report", async () => {
    const rawScan = {
      title: "Mobile Page",
      totalHeight: 800,
      candidates: [
        band({ label: "body", bg: "rgb(16, 21, 42)", top: 0, height: 800 }),
      ],
      responsive: {
        innerWidth: 390,
        scrollWidth: 390,
        counts: { overflow: 0, smallText: 0, smallTapTarget: 0 },
        overflow: [],
        smallText: [],
        smallTapTarget: [],
      },
    };
    const argsSeen: any[] = [];
    const fake = {
      launch: async () => ({
        newPage: async () => ({
          goto: async () => {},
          waitForTimeout: async () => {},
          evaluate: async (_fn: unknown, arg?: unknown) => {
            argsSeen.push(arg);
            return rawScan;
          },
        }),
        close: async () => {},
      }),
    };
    const res = await analyzePageStructure(
      "https://example.com",
      async () => ({ chromium: fake }),
      40,
      { viewport: "mobile", responsive: true },
    );
    expect("error" in res).toBe(false);
    // preScroll calls evaluate with no argument; the scan passes the options.
    expect(argsSeen).toEqual([undefined, undefined, { responsive: true }]);
    if (!("error" in res)) {
      expect(res.responsive).toEqual({
        measuredAt: "mobile",
        viewport: { width: 390, height: 844, dpr: 3 },
        pageOverflow: { horizontal: false, scrollWidth: 390, innerWidth: 390 },
        issues: [],
        counts: { overflow: 0, smallText: 0, smallTapTarget: 0 },
        truncated: false,
      });
    }
  });

  it("omits responsive when the scan does not return raw evidence", async () => {
    const argsSeen: any[] = [];
    const fake = {
      launch: async () => ({
        newPage: async () => ({
          goto: async () => {},
          waitForTimeout: async () => {},
          evaluate: async (_fn: unknown, arg?: unknown) => {
            argsSeen.push(arg);
            return {
              title: "Desktop Page",
              totalHeight: 800,
              candidates: [
                band({ label: "body", bg: "rgb(16, 21, 42)", top: 0, height: 800 }),
              ],
            };
          },
        }),
        close: async () => {},
      }),
    };
    const res = await analyzePageStructure(
      "https://example.com",
      async () => ({ chromium: fake }),
      40,
      { responsive: false },
    );
    expect("error" in res).toBe(false);
    expect(argsSeen[2]).toEqual({ responsive: false });
    if (!("error" in res)) expect("responsive" in res).toBe(false);
  });

  it("viewport mobile without compare does not scan and returns no responsive key", async () => {
    const argsSeen: any[] = [];
    const fake = {
      launch: async () => ({
        newPage: async () => ({
          goto: async () => {},
          waitForTimeout: async () => {},
          evaluate: async (_fn: unknown, arg?: unknown) => {
            argsSeen.push(arg);
            return {
              title: "Mobile Page",
              totalHeight: 800,
              candidates: [
                band({ label: "body", bg: "rgb(16, 21, 42)", top: 0, height: 800 }),
              ],
            };
          },
        }),
        close: async () => {},
      }),
    };
    const res = await analyzePageStructure(
      "https://example.com",
      async () => ({ chromium: fake }),
      40,
      { viewport: "mobile" },
    );
    expect("error" in res).toBe(false);
    expect(argsSeen[2]).toEqual({ responsive: false });
    if (!("error" in res)) expect("responsive" in res).toBe(false);
  });

  it("returns the install hint when playwright is missing", async () => {
    const res = await analyzePageStructure("https://example.com", async () => {
      throw new Error("Cannot find package 'playwright'");
    });
    expect("error" in res).toBe(true);
    if ("error" in res) expect(res.error).toContain("npm exec --global -- playwright install chromium");
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
    expect(calls.filter((c) => c === "eval").length).toBe(3); // overlay + pre-scroll + scan
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

describe("analyzePageStructure attach mode", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const SCAN = {
    title: "Attached Page",
    totalHeight: 900,
    scrollMode: "canvas" as const,
    note: "visible canvas; DOM bands cannot describe it",
    candidates: [
      band({ label: "body", bg: "rgb(16, 21, 42)", top: 0, height: 900 }),
    ],
  };
  // ws input avoids http discovery (covered in browser.test.ts) so these tests
  // never touch the network.
  const ATTACH_WS = "ws://127.0.0.1:9222/devtools/browser/test";

  // Fake browser with no newPage: any launch/page-creation fallback throws.
  function attachFake(pageUrl = "https://example.com/", scan: any = SCAN) {
    const evalCalls: Array<{ fn: unknown; arg?: unknown }> = [];
    const calls: string[] = [];
    const page = {
      url: () => pageUrl,
      evaluate: async (fn: unknown, arg?: unknown) => {
        evalCalls.push({ fn, arg });
        return scan;
      },
      goto: async () => {
        calls.push("goto");
      },
      waitForTimeout: async () => {
        calls.push("wait");
      },
      close: async () => {
        calls.push("page.close");
      },
    };
    const browser = {
      contexts: () => [
        {
          pages: () => [page],
          close: async () => {
            calls.push("context.close");
          },
        },
      ],
      close: async () => {
        calls.push("browser.close");
      },
    };
    const chromium = {
      launch: async () => {
        calls.push("launch");
        return browser;
      },
      connectOverCDP: async (endpoint: string) => {
        calls.push("connect:" + endpoint);
        return browser;
      },
    };
    return { evalCalls, calls, page, loader: async () => ({ chromium }) };
  }

  it.each([undefined, ""])(
    "requires AWWWARDS_MCP_ATTACH=1 (ambient value %s) and never loads playwright otherwise",
    async (ambient) => {
      vi.stubEnv("AWWWARDS_MCP_ATTACH", ambient);
      let loaded = false;
      const res = await analyzePageStructure(
        "https://example.com",
        async () => {
          loaded = true;
          return {};
        },
        40,
        { cdpEndpoint: "http://127.0.0.1:9222" },
      );
      expect("error" in res).toBe(true);
      if ("error" in res) expect(res.error).toContain("AWWWARDS_MCP_ATTACH=1");
      expect(loaded).toBe(false);
    },
  );

  it("scans the attached page without launch, goto, settle or preScroll", async () => {
    vi.stubEnv("AWWWARDS_MCP_ATTACH", "1");
    const fake = attachFake();
    const res = await analyzePageStructure(
      "https://example.com",
      fake.loader,
      40,
      { cdpEndpoint: ATTACH_WS },
    );
    expect("error" in res).toBe(false);
    if (!("error" in res)) {
      expect(res.attached).toBe(true);
      expect(res.title).toBe("Attached Page");
      expect(res.totalHeight).toBe(900);
      expect(res.bands.map((b) => b.label)).toEqual(["body"]);
      // Attach never navigates but still receives the same additive diagnosis.
      expect(res.scrollMode).toBe("canvas");
      expect(res.note).toContain("DOM bands");
    }
    expect(fake.calls).toEqual(["connect:" + ATTACH_WS, "browser.close"]);
    // Two evaluates: the one-shot dev shim, then the scan (preScroll would add
    // an argument-less call after them).
    expect(fake.evalCalls).toHaveLength(2);
    expect(String(fake.evalCalls[0]!.fn)).toContain("globalThis.__name");
    expect(fake.evalCalls[1]).toEqual({ fn: SCAN_SNIPPET, arg: { responsive: false } });
  });

  it("rejects an invalid endpoint before loading playwright", async () => {
    vi.stubEnv("AWWWARDS_MCP_ATTACH", "1");
    let loaded = false;
    const res = await analyzePageStructure(
      "https://example.com",
      async () => {
        loaded = true;
        return {};
      },
      40,
      { cdpEndpoint: "https://127.0.0.1:9222" },
    );
    expect("error" in res).toBe(true);
    expect(loaded).toBe(false);
  });

  it("rejects a custom viewport in attach mode", async () => {
    vi.stubEnv("AWWWARDS_MCP_ATTACH", "1");
    const fake = attachFake();
    const res = await analyzePageStructure(
      "https://example.com",
      fake.loader,
      40,
      { viewport: "mobile", cdpEndpoint: "http://127.0.0.1:9222" },
    );
    expect("error" in res).toBe(true);
    expect(fake.calls).toEqual([]);
  });

  it("rejects a responsive scan in attach mode", async () => {
    vi.stubEnv("AWWWARDS_MCP_ATTACH", "1");
    const fake = attachFake();
    const res = await analyzePageStructure(
      "https://example.com",
      fake.loader,
      40,
      { responsive: true, cdpEndpoint: "http://127.0.0.1:9222" },
    );
    expect("error" in res).toBe(true);
    expect(fake.calls).toEqual([]);
  });

  it("errors when no open page matches and disconnects", async () => {
    vi.stubEnv("AWWWARDS_MCP_ATTACH", "1");
    const fake = attachFake("https://other.test/page");
    const res = await analyzePageStructure(
      "https://example.com",
      fake.loader,
      40,
      { cdpEndpoint: ATTACH_WS },
    );
    expect("error" in res).toBe(true);
    if ("error" in res) expect(res.error).toContain("https://other.test");
    expect(fake.evalCalls).toEqual([]);
    expect(fake.calls).toEqual(["connect:" + ATTACH_WS, "browser.close"]);
  });
});

// No-arrow lock for SCAN_SNIPPET's in-page code: page.evaluate re-serializes
// the source, so the snippet (and every helper inside it) must stay a plain
// function / function declaration — no arrows anywhere in its body.
it("SCAN_SNIPPET is a serializable plain function (no-arrow lock)", () => {
  expect(typeof SCAN_SNIPPET).toBe("function");
  const src = String(SCAN_SNIPPET);
  expect(src).not.toContain("=>");
  expect(src).toContain("smallTapTarget");
});

// Conservative scroll-mode diagnosis. The fake DOM carries only what the
// snippet reads; elements are flat in document order like querySelectorAll("*").
describe("SCAN_SNIPPET scroll modes (conservative)", () => {
  type FakeNode = any;

  function fakeEl(
    tag: string,
    opts: {
      id?: string;
      cls?: string;
      top?: number;
      width?: number;
      height?: number;
      style?: Record<string, unknown>;
      children?: FakeNode[];
      scrollHeight?: number;
      clientHeight?: number;
      text?: string;
    } = {},
  ): FakeNode {
    const node: FakeNode = {
      tagName: tag.toUpperCase(),
      id: opts.id ?? "",
      classList: opts.cls ? [opts.cls] : [],
      children: [],
      parentElement: null,
      nodeType: 1,
      textContent: opts.text ?? "",
      style: {},
      scrollHeight: opts.scrollHeight ?? 0,
      clientHeight: opts.clientHeight ?? 0,
      scrollTop: 0,
      computed: { ...(opts.style ?? {}) },
      getBoundingClientRect: () => {
        const top = opts.top ?? 0;
        const width = opts.width ?? 1440;
        const height = opts.height ?? 900;
        return { left: 0, top, right: width, bottom: top + height, width, height };
      },
    };
    for (const child of opts.children ?? []) {
      child.parentElement = node;
      node.children.push(child);
    }
    return node;
  }

  function scanDom(opts: {
    docHeight: number;
    bodyScrollHeight?: number;
    bodyClientHeight?: number;
    bodyOverflowY?: string;
    els: FakeNode[];
    canvases?: FakeNode[];
  }) {
    const body = fakeEl("body", { width: 1440, height: 900 });
    body.scrollHeight = opts.bodyScrollHeight ?? opts.docHeight;
    body.clientHeight = opts.bodyClientHeight ?? 900;
    body.computed = { overflowY: opts.bodyOverflowY ?? "visible" };
    body.children = opts.els.filter((el) => !el.parentElement);
    for (const el of body.children) el.parentElement = body;
    const html = fakeEl("html", { width: 1440, height: 900 });
    html.scrollHeight = opts.docHeight;
    html.clientHeight = 900;
    const fakeDoc = {
      title: "T",
      documentElement: html,
      body,
      // Body overflow can exceed the real document scroller on pinned pages.
      scrollingElement: { scrollHeight: opts.docHeight, clientHeight: 900 },
      querySelectorAll: (sel: string) =>
        sel === "*" ? [body, ...opts.els] : sel === "canvas" ? (opts.canvases ?? []) : [],
    };
    const g = globalThis as any;
    const saved = {
      document: g.document,
      getComputedStyle: g.getComputedStyle,
      scrollX: g.scrollX,
      scrollY: g.scrollY,
      innerHeight: g.innerHeight,
      innerWidth: g.innerWidth,
    };
    g.document = fakeDoc;
    g.scrollX = 0;
    g.scrollY = 0;
    g.innerHeight = 900;
    g.innerWidth = 1440;
    g.getComputedStyle = (node: FakeNode) => ({
      overflowY: "visible",
      display: "block",
      visibility: "visible",
      opacity: "1",
      position: "relative",
      backgroundColor: "rgb(255, 255, 255)",
      transform: "none",
      ...(node.computed ?? {}),
    });
    try {
      return SCAN_SNIPPET({});
    } finally {
      g.document = saved.document;
      g.getComputedStyle = saved.getComputedStyle;
      g.scrollX = saved.scrollX;
      g.scrollY = saved.scrollY;
      g.innerHeight = saved.innerHeight;
      g.innerWidth = saved.innerWidth;
    }
  }

  it("virtual: translated wrapper gives its height, zero-based bands, and fixed chrome stays at 0", () => {
    const header = fakeEl("header", {
      id: "chrome",
      top: 0,
      height: 140,
      style: { position: "fixed", backgroundColor: "rgb(238, 238, 238)" },
    });
    const one = fakeEl("section", {
      id: "one",
      top: -2400,
      height: 3000,
      style: { backgroundColor: "rgb(170, 0, 0)" },
    });
    const two = fakeEl("section", {
      id: "two",
      top: 600,
      height: 3000,
      style: { backgroundColor: "rgb(0, 170, 0)" },
    });
    const nav = fakeEl("nav", {
      id: "nav",
      top: -2400,
      height: 200,
      style: { position: "fixed", backgroundColor: "rgb(51, 51, 51)" },
    });
    const smooth = fakeEl("div", { id: "smooth", top: -2400, height: 9000, children: [nav, one, two] });
    // A translated wrapper still inflates body.scrollHeight (6600 here) while
    // the real document scroller stays one viewport tall.
    const res = scanDom({ docHeight: 900, bodyScrollHeight: 6600, els: [header, smooth, nav, one, two] });
    expect(res.scrollMode).toBe("virtual");
    expect(res.virtualRoot).toBe("div#smooth");
    expect(res.totalHeight).toBe(9000);
    expect(res.scrollRoot).toBeUndefined();
    const tops = new Map(res.candidates.map((c) => [c.label, c.top]));
    expect(tops.get("#one")).toBe(0);
    expect(tops.get("#two")).toBe(3000);
    // The fixed header is a viewport sibling: +2400 would put it inside content.
    expect(tops.get("#chrome")).toBe(0);
    // A fixed descendant of the transformed wrapper is content: the transform
    // makes the wrapper its containing block, so its rect top is already -2400.
    expect(tops.get("#nav")).toBe(0);
    const bands = collapseBands(res.candidates, res.totalHeight);
    expect(bands.find((b) => b.label === "#two")?.offsetTop).toBe(3000);
  });

  it("clipped: a tall overflow:hidden child is not a virtual page", () => {
    const section = fakeEl("section", { height: 3000 });
    const clip = fakeEl("div", {
      id: "clip",
      height: 9000,
      style: { overflowY: "hidden" },
      children: [section],
    });
    const res = scanDom({ docHeight: 900, bodyScrollHeight: 9000, els: [clip, section] });
    expect(res.scrollMode).toBe("document");
    expect(res.totalHeight).toBe(900);
    expect(res.virtualRoot).toBeUndefined();
  });

  it("ignores hidden, transparent, fixed-overlay and narrow virtual candidates", () => {
    const hidden = fakeEl("div", { id: "hidden", height: 9000, style: { visibility: "hidden" } });
    const zero = fakeEl("div", { id: "zero", height: 9000, style: { opacity: "0" } });
    const inner = fakeEl("div", { id: "inner", height: 9000 });
    const overlay = fakeEl("div", {
      id: "overlay",
      height: 9000,
      style: { position: "fixed" },
      children: [inner],
    });
    const narrow = fakeEl("div", { id: "narrow", width: 200, height: 9000 });
    const contentHidden = fakeEl("div", {
      id: "content-hidden",
      height: 9000,
      style: { contentVisibility: "hidden" },
    });
    const filterHidden = fakeEl("div", {
      id: "filter-hidden",
      height: 9000,
      style: { filter: "opacity(0)" },
    });
    const res = scanDom({
      docHeight: 900,
      bodyScrollHeight: 27000,
      els: [hidden, zero, overlay, inner, narrow, contentHidden, filterHidden],
    });
    expect(res.scrollMode).toBe("document");
    expect(res.totalHeight).toBe(900);
    expect(res.virtualRoot).toBeUndefined();
  });

  it("rejects provably empty clip-path and legacy clip wrappers", () => {
    const self = fakeEl("div", {
      id: "clip-self",
      height: 9000,
      style: { clipPath: "inset(100%)" },
    });
    const selfRes = scanDom({ docHeight: 900, bodyScrollHeight: 6600, els: [self] });
    expect(selfRes.scrollMode).toBe("document");
    expect(selfRes.totalHeight).toBe(900);
    expect(selfRes.virtualRoot).toBeUndefined();

    const child = fakeEl("section", { id: "child", height: 9000 });
    const ancestor = fakeEl("div", {
      id: "clip-ancestor",
      height: 9000,
      style: { clipPath: "inset(100%)" },
      children: [child],
    });
    const ancestorRes = scanDom({
      docHeight: 900,
      bodyScrollHeight: 6600,
      els: [ancestor, child],
    });
    expect(ancestorRes.scrollMode).toBe("document");
    expect(ancestorRes.virtualRoot).toBeUndefined();

    const legacy = fakeEl("div", {
      id: "legacy",
      height: 9000,
      style: { position: "absolute", clip: "rect(0,0,0,0)" },
    });
    const legacyRes = scanDom({ docHeight: 900, bodyScrollHeight: 6600, els: [legacy] });
    expect(legacyRes.scrollMode).toBe("document");
    expect(legacyRes.virtualRoot).toBeUndefined();

    // Only proven-empty shapes are rejected: a partial inset is not proof.
    const control = fakeEl("div", {
      id: "control",
      height: 9000,
      style: { clipPath: "inset(10%)" },
    });
    const controlRes = scanDom({ docHeight: 900, bodyScrollHeight: 6600, els: [control] });
    expect(controlRes.scrollMode).toBe("virtual");
    expect(controlRes.virtualRoot).toBe("div#control");
  });

  it("uses fractional clip geometry and limits proofs under transforms", () => {
    const subpixel = fakeEl("div", {
      id: "subpixel",
      width: 1200.390625,
      height: 1200.390625,
      style: { clipPath: "inset(600.1px 0)" },
    });
    (subpixel as any).offsetWidth = 1200;
    (subpixel as any).offsetHeight = 1200;
    const subpixelRes = scanDom({ docHeight: 900, bodyScrollHeight: 6600, els: [subpixel] });
    expect(subpixelRes.scrollMode).toBe("virtual");
    expect(subpixelRes.virtualRoot).toBe("div#subpixel");

    const transformedPx = fakeEl("div", {
      id: "transformed-px",
      width: 1200.390625,
      height: 1200.390625,
      style: { clipPath: "inset(600.1px 0)", transform: "translateZ(0)" },
    });
    const transformedPxRes = scanDom({
      docHeight: 900,
      bodyScrollHeight: 6600,
      els: [transformedPx],
    });
    expect(transformedPxRes.scrollMode).toBe("virtual");

    const scaledPx = fakeEl("div", {
      id: "scaled-px",
      width: 1440,
      height: 1200,
      style: { clipPath: "inset(650px 0)", scale: "0.5" },
    });
    const scaledPxRes = scanDom({
      docHeight: 900,
      bodyScrollHeight: 6600,
      els: [scaledPx],
    });
    expect(scaledPxRes.scrollMode).toBe("virtual");
    expect(scaledPxRes.virtualRoot).toBe("div#scaled-px");

    const zoomedPx = fakeEl("div", {
      id: "zoomed-px",
      width: 1440,
      height: 1200,
      style: { clipPath: "inset(650px 0)", zoom: "0.5" },
    });
    const zoomedPxRes = scanDom({
      docHeight: 900,
      bodyScrollHeight: 6600,
      els: [zoomedPx],
    });
    expect(zoomedPxRes.scrollMode).toBe("virtual");
    expect(zoomedPxRes.virtualRoot).toBe("div#zoomed-px");

    const transformedEmpty = fakeEl("div", {
      id: "transformed-empty",
      width: 1200,
      height: 9000,
      style: { clipPath: "inset(100%)", transform: "translateZ(0)" },
    });
    const transformedEmptyRes = scanDom({
      docHeight: 900,
      bodyScrollHeight: 6600,
      els: [transformedEmpty],
    });
    expect(transformedEmptyRes.scrollMode).toBe("document");
    expect(transformedEmptyRes.virtualRoot).toBeUndefined();
  });

  it("body scroller: body overflow is not a virtual page and totalHeight follows body", () => {
    const tall = [
      fakeEl("section", { id: "a", top: 0, height: 2000 }),
      fakeEl("section", { id: "b", top: 2000, height: 2000 }),
      fakeEl("section", { id: "c", top: 4000, height: 2000 }),
    ];
    const big = scanDom({
      docHeight: 900,
      bodyScrollHeight: 6000,
      bodyClientHeight: 900,
      bodyOverflowY: "auto",
      els: tall,
    });
    expect(big.scrollMode).toBe("document");
    expect(big.totalHeight).toBe(6000);
    expect(big.virtualRoot).toBeUndefined();
    expect(new Map(big.candidates.map((c) => [c.label, c.top])).get("#c")).toBe(4000);

    const short = [
      fakeEl("section", { id: "a", top: 0, height: 800 }),
      fakeEl("section", { id: "b", top: 800, height: 800 }),
      fakeEl("section", { id: "c", top: 1600, height: 800 }),
    ];
    const small = scanDom({
      docHeight: 900,
      bodyScrollHeight: 2400,
      bodyClientHeight: 900,
      bodyOverflowY: "auto",
      els: short,
    });
    expect(small.scrollMode).toBe("document");
    expect(small.totalHeight).toBe(2400);
    expect(small.virtualRoot).toBeUndefined();
    expect(new Map(small.candidates.map((c) => [c.label, c.top])).get("#c")).toBe(1600);

    // Short body overflow still counts: 50px and 100px beyond the viewport.
    for (const bodyHeight of [950, 1000]) {
      const shortBody = scanDom({
        docHeight: 900,
        bodyScrollHeight: bodyHeight,
        bodyClientHeight: 900,
        bodyOverflowY: "auto",
        els: [],
      });
      expect(shortBody.scrollMode).toBe("document");
      expect(shortBody.totalHeight).toBe(bodyHeight);
      expect(shortBody.virtualRoot).toBeUndefined();
    }

    // A viewport canvas on a scrolling body is not a canvas-only page either.
    const canvas = fakeEl("canvas", { id: "gl", width: 1440, height: 900 });
    const withCanvas = scanDom({
      docHeight: 900,
      bodyScrollHeight: 6000,
      bodyClientHeight: 900,
      bodyOverflowY: "auto",
      els: [...tall, canvas],
      canvases: [canvas],
    });
    expect(withCanvas.scrollMode).toBe("document");
  });

  it("canvas: only a visible dominant canvas qualifies and the note stays qualified", () => {
    const visible = fakeEl("canvas", { id: "gl", width: 1440, height: 900 });
    const mixed = fakeEl("p", { id: "ui", top: 20, height: 40, text: "Menu" });
    const shown = scanDom({ docHeight: 900, els: [visible, mixed], canvases: [visible] });
    expect(shown.scrollMode).toBe("canvas");
    expect(shown.note).toContain("motion recording");
    expect(shown.note).toContain("3D scene capture");
    expect(shown.note).toContain("DOM bands");
    expect(shown.note).not.toMatch(/not in the DOM|no DOM content|DOM-free/i);

    // Partial insets shrink the visible area; 49% leaves 0.04%, 10% leaves
    // 64%, and 5% leaves 81% (the established 80% area threshold).
    for (const inset of ["49%", "10%"]) {
      const clipped = fakeEl("canvas", {
        width: 1440,
        height: 900,
        style: { clipPath: `inset(${inset})` },
      });
      const res = scanDom({ docHeight: 900, els: [clipped], canvases: [clipped] });
      expect(res.scrollMode).toBe("document");
      expect(res.note).toBeUndefined();
    }
    const mild = fakeEl("canvas", {
      width: 1440,
      height: 900,
      style: { clipPath: "inset(5%)" },
    });
    const mildRes = scanDom({ docHeight: 900, els: [mild], canvases: [mild] });
    expect(mildRes.scrollMode).toBe("canvas");

    // Under a transform, unknown clip geometry cannot prove dominance.
    const transformedInset = fakeEl("canvas", {
      width: 1440,
      height: 900,
      style: { clipPath: "inset(49%)", transform: "translateZ(0)" },
    });
    const transformedInsetRes = scanDom({
      docHeight: 900,
      els: [transformedInset],
      canvases: [transformedInset],
    });
    expect(transformedInsetRes.scrollMode).toBe("document");

    for (const shape of [
      "circle(1px at center)",
      "ellipse(1px 1px at center)",
      "polygon(0% 0%, 1% 0%, 1% 1%, 0% 1%)",
    ]) {
      const unresolved = fakeEl("canvas", {
        width: 1440,
        height: 900,
        style: { clipPath: shape },
      });
      const unresolvedRes = scanDom({
        docHeight: 900,
        els: [unresolved],
        canvases: [unresolved],
      });
      expect(unresolvedRes.scrollMode).toBe("document");
    }

    const rounded = fakeEl("canvas", {
      width: 1440,
      height: 900,
      style: { clipPath: "inset(5% round 50%)" },
    });
    const roundedRes = scanDom({ docHeight: 900, els: [rounded], canvases: [rounded] });
    expect(roundedRes.scrollMode).toBe("document");

    const legacyTiny = fakeEl("canvas", {
      width: 1440,
      height: 900,
      style: { position: "absolute", clip: "rect(0px, 1px, 1px, 0px)" },
    });
    const legacyTinyRes = scanDom({
      docHeight: 900,
      els: [legacyTiny],
      canvases: [legacyTiny],
    });
    expect(legacyTinyRes.scrollMode).toBe("document");

    const legacyFull = fakeEl("canvas", {
      width: 1440,
      height: 900,
      style: { position: "absolute", clip: "rect(0px, 1440px, 900px, 0px)" },
    });
    const legacyFullRes = scanDom({
      docHeight: 900,
      els: [legacyFull],
      canvases: [legacyFull],
    });
    expect(legacyFullRes.scrollMode).toBe("canvas");

    const zoomedInset = fakeEl("canvas", {
      width: 1440,
      height: 900,
      style: { clipPath: "inset(50px)", zoom: "2" },
    });
    const zoomedInsetRes = scanDom({
      docHeight: 900,
      els: [zoomedInset],
      canvases: [zoomedInset],
    });
    expect(zoomedInsetRes.scrollMode).toBe("document");

    const zoomedNoClip = fakeEl("canvas", {
      width: 1440,
      height: 900,
      style: { zoom: "2" },
    });
    const zoomedNoClipRes = scanDom({
      docHeight: 900,
      els: [zoomedNoClip],
      canvases: [zoomedNoClip],
    });
    expect(zoomedNoClipRes.scrollMode).toBe("canvas");

    const scaledInset = fakeEl("canvas", {
      width: 1440,
      height: 900,
      style: { clipPath: "inset(5%)", scale: "0.5" },
    });
    const scaledInsetRes = scanDom({
      docHeight: 900,
      els: [scaledInset],
      canvases: [scaledInset],
    });
    expect(scaledInsetRes.scrollMode).toBe("document");

    const transformedZero = fakeEl("canvas", {
      width: 1440,
      height: 900,
      style: { clipPath: "inset(0)", transform: "translateZ(0)" },
    });
    const transformedZeroRes = scanDom({
      docHeight: 900,
      els: [transformedZero],
      canvases: [transformedZero],
    });
    expect(transformedZeroRes.scrollMode).toBe("canvas");

    const transformedShellCanvas = fakeEl("canvas", { id: "gl", width: 1440, height: 900 });
    const transformedShell = fakeEl("div", {
      id: "transform-shell",
      width: 1440,
      height: 900,
      style: { overflowY: "hidden", transform: "translateZ(0)" },
      children: [transformedShellCanvas],
    });
    const transformedShellRes = scanDom({
      docHeight: 900,
      els: [transformedShell, transformedShellCanvas],
      canvases: [transformedShellCanvas],
    });
    expect(transformedShellRes.scrollMode).toBe("document");

    const hidden = fakeEl("canvas", { width: 1440, height: 900, style: { visibility: "hidden" } });
    const zero = fakeEl("canvas", { width: 1440, height: 900, style: { opacity: "0" } });
    const none = fakeEl("canvas", { width: 1440, height: 900, style: { display: "none" } });
    const small = fakeEl("canvas", { width: 400, height: 300 });
    for (const canvas of [hidden, zero, none, small]) {
      const res = scanDom({ docHeight: 900, els: [canvas], canvases: [canvas] });
      expect(res.scrollMode).toBe("document");
      expect(res.note).toBeUndefined();
    }

    const wrapper = fakeEl("div", { style: { opacity: "0" }, children: [visible] });
    const transparentAncestor = scanDom({ docHeight: 900, els: [wrapper, visible], canvases: [visible] });
    expect(transparentAncestor.scrollMode).toBe("document");
  });

  it("canvas: clipping ancestors bound the visible area; a full-viewport shell still qualifies", () => {
    const clippedCanvas = fakeEl("canvas", { id: "gl", width: 1440, height: 900 });
    const clippedShell = fakeEl("div", {
      id: "clip",
      width: 100,
      height: 100,
      style: { overflowY: "hidden" },
      children: [clippedCanvas],
    });
    const ui = fakeEl("p", { id: "ui", top: 20, height: 40, text: "Menu" });
    const clipped = scanDom({
      docHeight: 900,
      els: [clippedShell, clippedCanvas, ui],
      canvases: [clippedCanvas],
    });
    expect(clipped.scrollMode).toBe("document");
    expect(clipped.note).toBeUndefined();

    const clipCanvas = fakeEl("canvas", { id: "gl-clip", width: 1440, height: 900 });
    const clipShell = fakeEl("div", {
      id: "clip-clip",
      width: 100,
      height: 100,
      style: { overflowY: "clip" },
      children: [clipCanvas],
    });
    const clipped2 = scanDom({
      docHeight: 900,
      els: [clipShell, clipCanvas],
      canvases: [clipCanvas],
    });
    expect(clipped2.scrollMode).toBe("document");

    const shapeCanvas = fakeEl("canvas", { id: "gl-shape", width: 1440, height: 900 });
    const shapeShell = fakeEl("div", {
      id: "shape-shell",
      width: 1440,
      height: 900,
      style: { clipPath: "inset(100%)" },
      children: [shapeCanvas],
    });
    const clipped3 = scanDom({
      docHeight: 900,
      els: [shapeShell, shapeCanvas],
      canvases: [shapeCanvas],
    });
    expect(clipped3.scrollMode).toBe("document");

    const shellCanvas = fakeEl("canvas", { id: "gl", width: 1440, height: 900 });
    const fullShell = fakeEl("div", {
      id: "shell",
      width: 1440,
      height: 900,
      style: { overflowY: "hidden" },
      children: [shellCanvas],
    });
    fullShell.clientWidth = 1440;
    fullShell.clientHeight = 900;
    const accepted = scanDom({
      docHeight: 900,
      els: [fullShell, shellCanvas],
      canvases: [shellCanvas],
    });
    expect(accepted.scrollMode).toBe("canvas");
    expect(accepted.note).toContain("DOM bands");

    // A 300px border is not visible canvas area: the real clip box is 840x300.
    const borderCanvas = fakeEl("canvas", { id: "gl-border", width: 1440, height: 900 });
    const borderShell = fakeEl("div", {
      id: "border-shell",
      width: 1440,
      height: 900,
      style: { overflowY: "hidden" },
      children: [borderCanvas],
    });
    borderShell.clientWidth = 840;
    borderShell.clientHeight = 300;
    borderShell.clientLeft = 300;
    borderShell.clientTop = 300;
    const bordered = scanDom({
      docHeight: 900,
      els: [borderShell, borderCanvas],
      canvases: [borderCanvas],
    });
    expect(bordered.scrollMode).toBe("document");
  });

  it("canvas: 79% of the viewport is not enough and 81% is", () => {
    const below = fakeEl("canvas", { width: 1440, height: 711 });
    const belowRes = scanDom({ docHeight: 900, els: [below], canvases: [below] });
    expect(belowRes.scrollMode).toBe("document");

    const above = fakeEl("canvas", { width: 1440, height: 729 });
    const aboveRes = scanDom({ docHeight: 900, els: [above], canvases: [above] });
    expect(aboveRes.scrollMode).toBe("canvas");
  });

  it("document and element controls keep their existing measurements", () => {
    const section = fakeEl("section", {
      id: "a",
      height: 5000,
      style: { backgroundColor: "rgb(1, 1, 1)" },
    });
    const doc = scanDom({ docHeight: 5000, els: [section] });
    expect(doc.scrollMode).toBe("document");
    expect(doc.totalHeight).toBe(5000);
    expect(doc.virtualRoot).toBeUndefined();
    expect(doc.note).toBeUndefined();

    const pane = fakeEl("div", {
      id: "page",
      height: 900,
      style: { overflowY: "auto" },
      scrollHeight: 4000,
      clientHeight: 900,
    });
    const element = scanDom({ docHeight: 900, els: [pane] });
    expect(element.scrollMode).toBe("element");
    expect(element.scrollRoot).toBe("div#page");
    expect(element.totalHeight).toBe(4000);
  });

  it("analyzePageStructure passes the diagnostics through launched scans only when present", async () => {
    const mk = (extra: Record<string, unknown>) => ({
      chromium: {
        launch: async () => ({
          newPage: async () => ({
            addInitScript: async () => {},
            goto: async () => {},
            waitForTimeout: async () => {},
            url: () => "https://x.test/",
            evaluate: async () => ({
              title: "T",
              totalHeight: 9000,
              candidates: [
                { tag: "body", label: "body", bg: "rgb(0,0,0)", top: 0, height: 9000, textStart: "" },
              ],
              ...extra,
            }),
          }),
          close: async () => {},
        }),
      },
    });
    const withMode = await analyzePageStructure("https://x.test/", async () =>
      mk({ scrollMode: "virtual", virtualRoot: "div#smooth", note: "diagnostic" }),
    );
    if ("error" in withMode) throw new Error(withMode.error);
    expect(withMode.scrollMode).toBe("virtual");
    expect(withMode.virtualRoot).toBe("div#smooth");
    expect(withMode.note).toBe("diagnostic");

    const without = await analyzePageStructure("https://x.test/", async () => mk({}));
    if ("error" in without) throw new Error(without.error);
    expect("scrollMode" in without).toBe(false);
    expect("virtualRoot" in without).toBe(false);
    expect("note" in without).toBe(false);
  });

  it("SCAN_SNIPPET and preScroll mirror the conservative virtual negatives (source-lock)", () => {
    for (const src of [String(SCAN_SNIPPET), String(preScroll)]) {
      expect(src).toContain("viewportHeight + 100");
      expect(src).toContain('String(s.position) === "fixed"');
      expect(src).toContain('String(s.visibility) === "hidden"');
      expect(src).toContain('String(s.overflowY) === "hidden"');
      // The threshold survives serialization as 0.6 or .6 and the cap as 2e4.
      expect(src).toMatch(/0?\.6\s*\*\s*bodyWidth/);
      expect(src).toMatch(/2e4|20000/);
    }
  });
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
