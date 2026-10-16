import { describe, expect, it } from "vitest";
import {
  motionFingerprint,
  motionDiffScore,
  compareBands,
  verdictFrom,
} from "../src/verify-build.js";
import type { BandRow, MotionCensusInput } from "../src/verify-build.js";

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
