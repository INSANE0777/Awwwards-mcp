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

  it("neutralizes newlines and angle brackets in comment-borne census fields", () => {
    const payload = "\n}); alert('pwn'); //";
    const html = buildGsapStub(
      null,
      census([
        anim({
          selector: ".hero",
          trigger: payload,
          props: [payload],
        }),
      ]),
    );
    expect(html).not.toContain("\n}); alert('pwn')");
    expect(html).not.toContain("</script><script>");
    expect(html).toContain("alert('pwn')"); // inert inside the same line comment
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

  // B1: measured scrub curves (ScrubCurve in census.ts, field names copied verbatim).
  describe("measured scrub curves", () => {
    const curve = (over: Record<string, unknown> = {}) => ({
      selector: ".hero",
      startPx: 120,
      endPx: 1500,
      steps: [
        { scrollY: 120, progress: 0, transform: "translateY(0px)" },
        { scrollY: 800, progress: 0.5, transform: "translateY(60px)" },
        // consecutive duplicate → collapsed into one .to()
        { scrollY: 1500, progress: 1, transform: "translateY(60px)" },
      ],
      ...over,
    });

    it("emits a scrub timeline per curve with per-step measured .to() transforms", () => {
      const html = buildGsapStub(
        null,
        census([anim({ selector: ".hero", scrub: true })], { scrubCurves: [curve()] }),
      );
      expect(html).toContain("// measured scrub curve: .hero 120->1500");
      expect(html).toContain('scrub: true');
      expect(html).toContain('.to(".hero", { transform: "translateY(0px)" })');
      expect(html).toContain('.to(".hero", { transform: "translateY(60px)" })');
      expect((html.match(/\.to\("\.hero"/g) ?? []).length).toBe(2);
    });

    it("supersedes the guessed census timeline when measured transforms exist", () => {
      const html = buildGsapStub(
        null,
        census(
          [anim({ selector: ".hero", scrub: true }), anim({ selector: ".strip" })],
          { scrubCurves: [curve()] },
        ),
      );
      // measured .hero + census .strip; the guessed scrub timeline is gone
      expect((html.match(/gsap\.timeline/g) ?? []).length).toBe(2);
      expect(html).toContain(".from(\".strip\"");
      expect(html).not.toContain(".from(\".hero\"");
    });

    it("falls back to the census pattern when a curve has no measured transforms", () => {
      const html = buildGsapStub(
        null,
        census([], { scrubCurves: [curve({ steps: [{ scrollY: 0, progress: 0, transform: null }] })] }),
      );
      expect(html).toContain("// measured scrub curve: .hero 120->1500");
      expect(html).toContain('.from(".hero", { opacity: 0, y: 40 });');
      expect(html).not.toContain('.to(".hero"');
    });

    // D2 grab-bag: superseding a pinned census row must not silently unpin —
    // the measured scrub timeline inherits pin:true.
    it("carries pin:true onto the measured scrub timeline when the superseded census row was pinned", () => {
      const html = buildGsapStub(
        null,
        census([anim({ selector: ".hero", scrub: true, pin: true })], { scrubCurves: [curve()] }),
      );
      // the census timeline was superseded (guessed tween gone)…
      expect(html).not.toContain('.from(".hero"');
      expect((html.match(/gsap\.timeline/g) ?? []).length).toBe(1);
      // …but the measured config still pins the section.
      expect(html).toContain('start: "top 80%", scrub: true, pin: true');
      // an unpinned curve carries no pin flag
      const unpinned = buildGsapStub(
        null,
        census([anim({ selector: ".hero", scrub: true })], { scrubCurves: [curve()] }),
      );
      expect(unpinned).not.toContain("pin: true");
    });

    it("is byte-identical when scrubCurves is absent or empty", () => {
      const pack = census([anim()]);
      expect(buildGsapStub(null, pack)).not.toContain("measured scrub curve");
      expect(buildGsapStub(null, pack)).toBe(buildGsapStub(null, { ...pack, scrubCurves: [] }));
    });
  });
});
