import { describe, expect, it } from "vitest";
import {
  motionFingerprint,
  motionDiffScore,
  compareBands,
  verdictFrom,
  verifyBuild,
} from "../src/verify-build.js";
import type { BandRow, MotionCensusInput } from "../src/verify-build.js";
import type { PageStructure } from "../src/structure.js";
import type { ScrollCensus } from "../src/census.js";
import type { HoverCensus } from "../src/hover-census.js";

const base = (p: Partial<MotionCensusInput>): MotionCensusInput => ({
  counts: {
    "gsap-scrolltrigger": 3,
    "css-scroll-timeline": 0,
    "css-view-timeline": 0,
    "data-attr": 0,
    "css-keyframe": 2,
    smil: 0,
  },
  anims: [
    { easing: "power2.out", scrub: true, pin: false },
    { easing: "power2.out", scrub: true, pin: false },
    { easing: "power1.in", scrub: false, pin: true },
  ],
  nativeScrollTimelines: 1,
  ...p,
});

describe("motionFingerprint", () => {
  it("is order-independent (key order + easing token order)", () => {
    const a = motionFingerprint({
      counts: {
        "gsap-scrolltrigger": 3,
        "css-scroll-timeline": 0,
        "css-view-timeline": 1,
        "data-attr": 0,
        "css-keyframe": 2,
        smil: 0,
      },
      anims: [{ easing: "power2.out", scrub: false, pin: false }],
      nativeScrollTimelines: 1,
      easingTokens: ["power2.out", "linear"],
    });
    const b = motionFingerprint({
      counts: {
        smil: 0,
        "css-keyframe": 2,
        "data-attr": 0,
        "css-view-timeline": 1,
        "css-scroll-timeline": 0,
        "gsap-scrolltrigger": 3,
      },
      anims: [{ easing: "power2.out", scrub: false, pin: false }],
      nativeScrollTimelines: 1,
      easingTokens: ["linear", "power2.out"],
    });
    expect(a).toBe(b);
    expect(a.split("|").length).toBeGreaterThan(2);
  });

  it("reflects scrub/pin counts and an easing token", () => {
    const fp = motionFingerprint(base({}));
    expect(fp).toContain("sc:2");
    expect(fp).toContain("pin:1");
    expect(fp).toContain("power1.in");
  });
});

describe("motionDiffScore", () => {
  it("identical fingerprints → 100", () => {
    const fp = motionFingerprint(base({}));
    expect(motionDiffScore(fp, fp)).toBe(100);
  });

  it("disjoint motion (triggers, easings linear vs power2.out, native 0 vs 4) → < 50", () => {
    const ref = motionFingerprint({
      counts: {
        "gsap-scrolltrigger": 2,
        "css-scroll-timeline": 0,
        "css-view-timeline": 0,
        "data-attr": 0,
        "css-keyframe": 0,
        smil: 0,
      },
      anims: [{ easing: "linear", scrub: false, pin: false }],
      nativeScrollTimelines: 0,
    });
    const build = motionFingerprint({
      counts: {
        "gsap-scrolltrigger": 0,
        "css-scroll-timeline": 0,
        "css-view-timeline": 0,
        "data-attr": 0,
        "css-keyframe": 3,
        smil: 0,
      },
      anims: [{ easing: "power2.out", scrub: false, pin: false }],
      nativeScrollTimelines: 4,
    });
    expect(motionDiffScore(ref, build)).toBeLessThan(50);
  });
});

describe("compareBands", () => {
  const ref: BandRow[] = [
    { label: "hero", bg: "#111111", tag: "h1" },
    { label: "Feature grid", bg: "#222222", tag: "section" },
    { label: "footer", bg: "#333333", tag: "footer" },
  ];
  const build: BandRow[] = [
    { label: "  HERO  ", bg: "#111111", tag: "h1" },
    { label: "feature-grid", bg: "#222222", tag: "section" },
  ];

  it("matches 3 ref vs 2 build, flags refOnly, scores > 50", () => {
    const r = compareBands(ref, build);
    expect(r.matched).toHaveLength(2);
    expect(r.refOnly).toEqual(["footer"]);
    expect(r.buildOnly).toEqual([]);
    expect(r.score).toBeGreaterThan(50);
  });

  it("falls back to bg+tag match when labels differ", () => {
    const r = compareBands(
      [{ label: "pricing card", bg: "#fafafa", tag: "div" }],
      [{ label: "totally different", bg: "#fafafa", tag: "div" }]
    );
    expect(r.matched).toHaveLength(1);
    expect(r.refOnly).toEqual([]);
    expect(r.buildOnly).toEqual([]);
  });
});

describe("verdictFrom", () => {
  it("thresholds: 90/80→pass, 70/60→warn, 40/30→fail", () => {
    expect(verdictFrom(90, 80).verdict).toBe("pass");
    expect(verdictFrom(70, 60).verdict).toBe("warn");
    expect(verdictFrom(40, 30).verdict).toBe("fail");
  });

  it("returns a 3-line human-readable evidence trail", () => {
    const r = verdictFrom(90, 80);
    expect(r.evidence.length).toBe(3);
    expect(r.overall).toBe(86);
    expect(r.evidence[2]).toContain("86");
  });
});

describe("verifyBuild orchestrator", () => {
  const refStruct = (): PageStructure => ({
    url: "https://ref.test",
    title: "Reference",
    totalHeight: 2000,
    bands: [
      { index: 0, tag: "h1", label: "hero", background: "#000000", offsetTop: 0, height: 900, textStart: "" },
      { index: 1, tag: "footer", label: "footer", background: "#000000", offsetTop: 900, height: 1100, textStart: "" },
    ],
  });
  const scrollCensus = (): ScrollCensus => ({
    url: "https://x.test",
    capturedAt: 0,
    counts: {
      "gsap-scrolltrigger": 1,
      "css-scroll-timeline": 0,
      "css-view-timeline": 0,
      "data-attr": 0,
      "css-keyframe": 0,
      smil: 0,
      unknown: 0,
    },
    anims: [{ selector: "section", tag: "section", props: ["transform"], durationMs: null, delayMs: null, easing: "power2.out", trigger: "gsap-scrolltrigger", scrub: true, pin: false, svgStroke: false }],
    svgStrokes: [],
    nativeScrollTimelines: 0,
    reducedMotion: false,
  });
  const hoverCensus = (): HoverCensus => ({
    url: "https://x.test",
    capturedAt: 0,
    hoverRuleCount: 0,
    candidates: 0,
    samples: [],
    reducedMotion: false,
  });

  // The aegon evidence-pass defaults would fetch the build URL and launch
  // Chrome, so every verifyBuild call here opts into offline fakes.
  const okFetch =
    (body: string): typeof fetch =>
    (async () => ({ ok: true, status: 200, text: async () => body })) as unknown as typeof fetch;
  const offlineEvidence = {
    perfFn: async () => ({ error: "skipped in fixture" }),
    rulesFn: () => [],
    fetchFn: okFetch(""),
  };
  const perfMeasurement = () => ({
    seconds: 6,
    frames: 360,
    fps: 58,
    droppedFrames: 4,
    worstFrameMs: 41,
    longTaskCount: 2,
    longTaskMaxMs: 64,
    longAnimationFrameCount: 1,
    longAnimationFrameMaxBlockingMs: 33,
    layoutThrashCount: 3,
    measureBeforeCompositeCount: 5,
    layoutReads: 40,
    styleWrites: 12,
    scrollListeners: [] as Array<{ type: string; passive: boolean }>,
    animationsAtEnd: 0,
    chromePath: "fake-chrome",
  });

  it("scores an identical build: bands matched, verdict in pass/warn/fail, evidence, fingerprints", async () => {
    let hoverCalls = 0;
    const report = await verifyBuild({
      buildUrl: "https://build.test",
      referenceUrl: "https://ref.test",
      structureFn: async () => refStruct(),
      scrollFn: async () => ({ ...scrollCensus() }),
      hoverFn: async () => {
        hoverCalls++;
        return hoverCensus();
      },
      ...offlineEvidence,
    });
    expect("error" in report).toBe(false);
    if ("error" in report) return;
    expect(report.bands.matched).toContain("hero");
    expect(report.verdict).toMatch(/pass|warn|fail/);
    expect(report.evidence.length).toBeGreaterThan(2);
    expect(report.motion.refFingerprint).toContain("k1");
    // Presence-only: hover censuses ran for both pages but don't gate the score.
    expect(hoverCalls).toBe(2);
  });

  it("structure-scan error short-circuits before scroll/hover run", async () => {
    const scrollFn = async (): Promise<ScrollCensus> => {
      throw new Error("scrollFn must not be called");
    };
    const hoverFn = async (): Promise<HoverCensus> => {
      throw new Error("hoverFn must not be called");
    };
    const report = await verifyBuild({
      buildUrl: "https://build.test",
      referenceUrl: "https://ref.test",
      structureFn: async () => ({ error: "nope" }),
      scrollFn,
      hoverFn,
      ...offlineEvidence,
    });
    expect("error" in report).toBe(true);
    if (!("error" in report)) return;
    expect(report.error).toContain("nope");
    expect(report.error.toLowerCase()).toContain("reference");
  });

  it("scroll-census error mentions headless browser required", async () => {
    const report = await verifyBuild({
      buildUrl: "https://build.test",
      referenceUrl: "https://ref.test",
      structureFn: async () => refStruct(),
      scrollFn: async () => ({ error: "playwright missing" }),
      hoverFn: async () => hoverCensus(),
      ...offlineEvidence,
    });
    expect("error" in report).toBe(true);
    if (!("error" in report)) return;
    expect(report.error).toContain("headless browser required");
  });

  it("maps structure bands (incl. PageBand.background) into BandRow labels", async () => {
    const report = await verifyBuild({
      buildUrl: "https://build.test",
      referenceUrl: "https://ref.test",
      structureFn: async () => refStruct(),
      scrollFn: async () => scrollCensus(),
      hoverFn: async () => hoverCensus(),
      ...offlineEvidence,
    });
    expect("error" in report).toBe(false);
    if ("error" in report) return;
    // hero matched by label; footer matched too; nothing lost in refOnly.
    expect(report.bands.matched).toEqual(["hero", "footer"]);
    expect(report.bands.refOnly).toEqual([]);
  });

  it("appends measured perf + anti-pattern evidence after the score-derived lines", async () => {
    const rulesFn = () => [
      { ruleId: "blur-heavy", severity: "HIGH" as const, message: "Heavy blur", why: "w", improvements: "i", source: "css" as const },
      { ruleId: "transition-all", severity: "MEDIUM" as const, message: "all", why: "w", improvements: "i", source: "html" as const },
    ];
    const report = await verifyBuild({
      buildUrl: "https://build.test",
      referenceUrl: "https://ref.test",
      structureFn: async () => refStruct(),
      scrollFn: async () => scrollCensus(),
      hoverFn: async () => hoverCensus(),
      perfFn: async () => perfMeasurement(),
      rulesFn,
      fetchFn: okFetch("<html><body>build</body></html>"),
    });
    expect("error" in report).toBe(false);
    if ("error" in report) return;
    expect(report.evidence).toHaveLength(6);
    expect(report.evidence.slice(0, 4)).toEqual([
      "Bands: 100/100 similarity",
      "Motion: 100/100 fingerprint similarity",
      "Overall: 100/100 → PASS",
      "Hover: reference 0 samples, build 0 samples (presence only)",
    ]);
    // Field mapping (perf-live renames): fps→fps, droppedFrames→dropped,
    // longTaskCount→longTasks, layoutThrashCount→thrash.
    expect(report.evidence[4]).toBe("perf: fps=58 dropped=4 longTasks=2 thrash=3 (measured)");
    // HIGH (12) outranks MEDIUM (5) → worst rule id wins.
    expect(report.evidence[5]).toBe("anti-patterns: 2 (worst: blur-heavy)");
  });

  it("evidence failures degrade to notes; score/verdict/prior evidence byte-identical", async () => {
    const common = {
      buildUrl: "https://build.test",
      referenceUrl: "https://ref.test",
      structureFn: async () => refStruct(),
      scrollFn: async () => scrollCensus(),
      hoverFn: async () => hoverCensus(),
    };
    const control = await verifyBuild({ ...common, ...offlineEvidence });
    const degraded = await verifyBuild({
      ...common,
      perfFn: async () => ({ error: "no chrome" }),
      rulesFn: () => {
        throw new Error("rules blew up");
      },
      fetchFn: okFetch("<html></html>"),
    });
    expect("error" in control).toBe(false);
    expect("error" in degraded).toBe(false);
    if ("error" in control || "error" in degraded) return;
    // Control equality: the pre-existing score/verdict/evidence is untouched.
    expect(degraded.overall).toBe(control.overall);
    expect(degraded.verdict).toBe(control.verdict);
    expect(degraded.evidence.slice(0, 4)).toEqual(control.evidence.slice(0, 4));
    // Hard-pinned literal = the pre-change values for this fixture.
    expect(degraded.evidence.slice(0, 4)).toEqual([
      "Bands: 100/100 similarity",
      "Motion: 100/100 fingerprint similarity",
      "Overall: 100/100 → PASS",
      "Hover: reference 0 samples, build 0 samples (presence only)",
    ]);
    // Both degrade lines replace the success lines, in the same slots.
    expect(degraded.evidence[4]).toBe("perf: not measured (no chrome)");
    expect(degraded.evidence[5]).toBe("anti-patterns: not scanned (rules blew up)");
  });

  it("a failed build-page fetch degrades only the anti-patterns line", async () => {
    const statusFetch =
      (status: number): typeof fetch =>
      (async () => ({ ok: status < 400, status, text: async () => "" })) as unknown as typeof fetch;
    const report = await verifyBuild({
      buildUrl: "https://build.test",
      referenceUrl: "https://ref.test",
      structureFn: async () => refStruct(),
      scrollFn: async () => scrollCensus(),
      hoverFn: async () => hoverCensus(),
      perfFn: async () => perfMeasurement(),
      rulesFn: () => {
        throw new Error("rulesFn must not be called — fetch failed first");
      },
      fetchFn: statusFetch(503),
    });
    expect("error" in report).toBe(false);
    if ("error" in report) return;
    expect(report.evidence[4]).toBe("perf: fps=58 dropped=4 longTasks=2 thrash=3 (measured)");
    expect(report.evidence[5]).toBe("anti-patterns: not scanned (HTTP 503 fetching https://build.test)");
  });

  it("early structural error short-circuits before the evidence pass runs", async () => {
    let perfCalls = 0;
    let rulesCalls = 0;
    const report = await verifyBuild({
      buildUrl: "https://build.test",
      referenceUrl: "https://ref.test",
      structureFn: async () => ({ error: "nope" }),
      scrollFn: async () => scrollCensus(),
      hoverFn: async () => hoverCensus(),
      perfFn: async () => {
        perfCalls++;
        return { error: "must not run" };
      },
      rulesFn: () => {
        rulesCalls++;
        return [];
      },
      fetchFn: okFetch(""),
    });
    expect("error" in report).toBe(true);
    expect(perfCalls).toBe(0);
    expect(rulesCalls).toBe(0);
  });
});
