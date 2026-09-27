import { describe, expect, it } from "vitest";
import { normalizeEasing, quartiles } from "../src/easings.js";

describe("normalizeEasing", () => {
  it("maps GSAP power-family presets to their Penner bezier equivalents", () => {
    expect(normalizeEasing("power1.out")).toEqual({ kind: "bezier", value: [0.25, 0.46, 0.45, 0.94] });
    expect(normalizeEasing("power4.out")).toEqual({ kind: "bezier", value: [0.23, 1, 0.32, 1] });
    expect(normalizeEasing("power2.inOut")).toEqual({ kind: "bezier", value: [0.645, 0.045, 0.355, 1] });
    // GSAP power3 = quart; quartIn approximation is (0.895, 0.03, 0.685, 0.22),
    // matching the table. The brief's draft had the cubicIn value here by typo.
    expect(normalizeEasing("power3.in")).toEqual({ kind: "bezier", value: [0.895, 0.03, 0.685, 0.22] });
    expect(normalizeEasing("power4.inOut")).toEqual({ kind: "bezier", value: [0.86, 0, 0.07, 1] });
  });

  it("maps sine/expo presets", () => {
    expect(normalizeEasing("sine.inOut")).toEqual({ kind: "bezier", value: [0.37, 0, 0.63, 1] });
    expect(normalizeEasing("expo.out")).toEqual({ kind: "bezier", value: [0.19, 1, 0.22, 1] });
    expect(normalizeEasing("expo.inOut")).toEqual({ kind: "bezier", value: [1, 0, 0, 1] });
  });

  it("passes cubic-bezier CSS strings through as bezier", () => {
    expect(normalizeEasing("cubic-bezier(0.76, 0, 0.24, 1)")).toEqual({ kind: "bezier", value: [0.76, 0, 0.24, 1] });
  });

  it("returns kind=unknown for bounce/elastic/custom families (no honest bezier exists)", () => {
    for (const t of ["bounce.out", "elastic.out(1, 0.3)", "CustomEase(myEase)", "steps(4)"]) {
      expect(normalizeEasing(t).kind).toBe("unknown");
      // value keeps the raw token so callers still see provenance
      expect(normalizeEasing(t).value).toBeTruthy();
    }
  });

  it("respects case-insensitive GSAP names", () => {
    expect(normalizeEasing("POWER4.OUT")).toEqual({ kind: "bezier", value: [0.23, 1, 0.32, 1] });
  });
});

describe("quartiles", () => {
  it("computes linearly interpolated quartiles", () => {
    expect(quartiles([1, 2, 3, 4])).toEqual({ p25: 1.75, median: 2.5, p75: 3.25 });
    expect(quartiles([400, 700, 1200])).toEqual({ p25: 550, median: 700, p75: 950 });
  });
  it("handles singletons and rejects empty input", () => {
    expect(quartiles([5])).toEqual({ p25: 5, median: 5, p75: 5 });
    expect(quartiles([])).toBeNull();
  });
});
