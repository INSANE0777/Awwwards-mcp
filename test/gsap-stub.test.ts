import { describe, expect, it } from "vitest";
import { buildGsapStub, normalizeEase } from "../src/gsap-stub.js";

// Lenient fixtures mirroring the ScrollCensus RawAnim / ScrollCensus shapes.
// The builder takes unknown args, so these are plain structural objects.
const anim = (over: Record<string, unknown> = {}) => ({
  selector: ".hero-copy",
  tag: "div",
  props: ["opacity", "transform"],
  durationMs: 500,
  delayMs: null,
  easing: "power1.out",
  trigger: "gsap-scrolltrigger",
  scrub: false,
  pin: false,
  svgStroke: false,
  ...over,
});

const census = (anims: unknown[] = [], over: Record<string, unknown> = {}) => ({
  url: "https://example.com",
  capturedAt: 0,
  counts: {},
  anims,
  svgStrokes: [],
  nativeScrollTimelines: 0,
  reducedMotion: false,
  ...over,
});

describe("normalizeEase", () => {
  it("maps the css-ease bezier to power2.out", () => {
    expect(normalizeEase("cubic-bezier(0.25, 0.1, 0.25, 1)")).toBe("power2.out");
  });

  it("passes gsap tokens through (restoring camelCase)", () => {
    expect(normalizeEase("power4.inOut")).toBe("power4.inOut");
    expect(normalizeEase("power4.inout")).toBe("power4.inOut");
  });

  it("falls back on non-gsap keywords and garbage", () => {
    expect(normalizeEase("linear")).toBe("power2.out");
    expect(normalizeEase("garbage!!")).toBe("power2.out");
    expect(normalizeEase("")).toBe("power2.out");
    expect(normalizeEase(null)).toBe("power2.out");
  });

  it("survives float noise via 1-decimal rounding and non-finite beziers via fallback", () => {
    expect(normalizeEase("cubic-bezier(0.3000000001, 0, 0.2, 1)")).toBe("power3.out");
    expect(normalizeEase("cubic-bezier(0, 0, oops, 1)")).toBe("power2.out");
  });
});

describe("buildGsapStub", () => {
  it("builds one timeline per usable census anim with scrub/pin/duration/ease", () => {
    const html = buildGsapStub(
      null,
      census([
        anim({ selector: ".hero", scrub: true, pin: true, durationMs: 760, easing: "power1.out" }),
        anim({ selector: ".strip" }),
      ]),
    );
    expect(html).toContain("gsap.registerPlugin(ScrollTrigger)");
    expect(html).toContain("scrub: true");
    expect(html).toContain("pin: true");
    expect(html).toContain("duration: 0.76");
    expect(html).toContain("power1.out");
    expect(html).toContain('start: "top 80%"');
    // selector embedded via jsStr (double-quoted literal)
    expect(html).toContain('".hero"');
    expect(html).toContain('".strip"');
  });

  it("notes svg stroke anims", () => {
    const html = buildGsapStub(null, census([anim({ selector: ".logo", svgStroke: true })]));
    expect(html).toContain("svg stroke draw");
  });

  it("adds the camera module only when canvasW>0 and >=2 snapshots", () => {
    const grid = {
      id: "pose-grid-v1",
      url: "https://example.com",
      steps: 2,
      canvasSelector: "#gl",
      canvasW: 1200,
      canvasH: 600,
      snapshots: [{ scrollRatio: 0 }, { scrollRatio: 1 }],
    };
    const on = buildGsapStub(grid, census());
    expect(on).toContain("esm.sh/three");
    expect(on).toContain("POSE_KEYS");
    // synthesized anchors from scroll ratios: y=r*2.5, z=12-r*4
    expect(on).toContain('"y":2.5');
    expect(on).toContain('"z":8');

    const off = buildGsapStub({ ...grid, canvasW: 0 }, census());
    expect(off).not.toContain("esm.sh/three");
  });

  it("always guards reduced motion", () => {
    const plain = buildGsapStub(null, census());
    expect(plain).toContain("@media (prefers-reduced-motion: reduce)");
    expect(plain).toContain('matchMedia("(prefers-reduced-motion: reduce)")');
    const honored = buildGsapStub(null, census([], { reducedMotion: true }));
    expect(honored).toContain("census: source already honors reduced motion");
  });

  it("never throws on empty inputs and still builds a valid page", () => {
    const html = buildGsapStub(null, null);
    expect(html).toContain("no usable scroll-census anims");
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
  });

  it("neutralizes `<` in selectors so a hostile value cannot close the script tag", () => {
    const html = buildGsapStub(null, census([anim({ selector: "<img src=x onerror=alert(1)>" })]));
    expect(html).toContain("\\u003cimg src=x");
    expect(html).not.toContain("<img src=x");
  });

  it("is byte-deterministic for identical inputs", () => {
    const a = buildGsapStub(null, census([anim()]));
    const b = buildGsapStub(null, census([anim()]));
    expect(a).toBe(b);
  });

  it("never emits eval(", () => {
    const html = buildGsapStub(
      { canvasW: 100, canvasH: 100, snapshots: [{ scrollRatio: 0 }, { scrollRatio: 1 }] },
      census([anim()]),
    );
    expect(html.includes("eval(")).toBe(false);
  });
});
