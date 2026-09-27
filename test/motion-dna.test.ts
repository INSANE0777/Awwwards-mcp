import { describe, expect, it } from "vitest";
import { reduceScan, MOTION_SNIPPET } from "../src/motion-dna.js";
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
});
