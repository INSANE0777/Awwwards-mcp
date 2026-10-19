import { describe, expect, it } from "vitest";
import { CHOREOGRAPHY_CAP, choreographyFromCensus } from "../src/choreography.js";
import type { GsapTriggerRow, RawAnim, ScrollCensus } from "../src/census.js";

// Fixture builders: fixtures are consumed verbatim by the pure reducer, so
// tests encode expected hints by handing raw rows pre-shaped.
const anim = (p: Partial<RawAnim>): RawAnim => ({
  selector: p.selector ?? "div.card",
  tag: p.tag ?? "div",
  props: p.props ?? ["transform"],
  durationMs: p.durationMs ?? 600,
  delayMs: p.delayMs ?? null,
  easing: p.easing ?? null,
  trigger: p.trigger ?? "css-keyframe",
  scrub: p.scrub ?? false,
  pin: p.pin ?? false,
  svgStroke: false,
});

const trigger = (p: Partial<GsapTriggerRow>): GsapTriggerRow => ({
  selector: p.selector ?? "main>h1",
  scrub: false,
  pin: false,
  startPx: 0,
  endPx: 800,
  progress: 0,
  vars: p.vars ?? {},
});

const census = (over: Partial<ScrollCensus> = {}): ScrollCensus => ({
  url: "https://example.com",
  capturedAt: 1700000000000,
  counts: {
    "gsap-scrolltrigger": 0,
    "css-scroll-timeline": 0,
    "css-view-timeline": 0,
    "data-attr": 0,
    "css-keyframe": 0,
    smil: 0,
    unknown: 0,
  },
  anims: [],
  svgStrokes: [],
  nativeScrollTimelines: 0,
  gsapTriggers: [],
  reducedMotion: false,
  ...over,
});

describe("choreographyFromCensus — tween-var path", () => {
  it("turns numeric gsapTriggers vars.stagger into hints, registry order", () => {
    const c = choreographyFromCensus(census({
      gsapTriggers: [
        trigger({ selector: "main>h1", vars: { stagger: "0.09" } }),
        trigger({ selector: "ul>li", vars: { stagger: "0.2" } }),
        trigger({ selector: "p.washed", vars: { stagger: "each" } }), // non-numeric → skipped
        trigger({ selector: "", vars: { stagger: "0.1" } }), // unresolvable target → skipped
        trigger({ selector: "span", vars: { stagger: "0" } }), // zero → skipped
      ],
    }));
    expect(c.groups).toBe(2);
    expect(c.hints).toEqual([
      { selector: "main>h1", value: 0.09, source: "tween-var" },
      { selector: "ul>li", value: 0.2, source: "tween-var" },
    ]);
  });

  it("rounds values to ≤2dp", () => {
    const c = choreographyFromCensus(census({ gsapTriggers: [trigger({ vars: { stagger: "0.0999999" } })] }));
    expect(c.hints[0].value).toBe(0.1);
  });
});

describe("choreographyFromCensus — delay-delta path", () => {
  it("detects stepped delays across same props+duration siblings", () => {
    const c = choreographyFromCensus(census({
      anims: [
        anim({ selector: "div.card:nth-of-type(1)", delayMs: 0 }),
        anim({ selector: "div.card:nth-of-type(2)", delayMs: 120 }),
        anim({ selector: "div.card:nth-of-type(3)", delayMs: 240 }),
      ],
    }));
    expect(c.groups).toBe(1);
    expect(c.hints).toEqual([
      { selector: "div.card:nth-of-type(1) (+2 siblings)", value: 120, source: "delay-delta" },
    ]);
  });

  it("never fires without ≥3 members or a repeated positive delta", () => {
    const two = choreographyFromCensus(census({ anims: [anim({ delayMs: 0 }), anim({ delayMs: 120 })] }));
    expect(two.hints).toEqual([]);
    const flat = choreographyFromCensus(census({
      anims: [anim({ delayMs: 0 }), anim({ delayMs: 0 }), anim({ delayMs: 0 })],
    }));
    expect(flat.hints).toEqual([]);
    const jittered = choreographyFromCensus(census({
      anims: [
        anim({ delayMs: 0 }),
        anim({ delayMs: 120 }),
        anim({ delayMs: 300 }), // deltas 120 / 180 land in different 10ms buckets
      ],
    }));
    expect(jittered.hints).toEqual([]);
  });

  it("different props or durations stay separate bundles", () => {
    const c = choreographyFromCensus(census({
      anims: [
        anim({ props: ["transform"], durationMs: 600, delayMs: 0 }),
        anim({ props: ["opacity"], durationMs: 600, delayMs: 120 }),
        anim({ props: ["transform"], durationMs: 600, delayMs: 240 }),
      ],
    }));
    expect(c.hints).toEqual([]);
  });
});

describe("choreographyFromCensus — caps and empties", () => {
  it("caps at 20 hints, tween-var first (delay-delta starves past the cap)", () => {
    const gsapTriggers = Array.from({ length: 22 }, (_, i) =>
      trigger({ selector: `ul>li:nth-of-type(${i + 1})`, vars: { stagger: "0.05" } }),
    );
    const c = choreographyFromCensus(census({
      gsapTriggers,
      anims: [
        anim({ delayMs: 0 }),
        anim({ delayMs: 120 }),
        anim({ delayMs: 240 }),
      ],
    }));
    expect(c.hints.length).toBe(CHOREOGRAPHY_CAP);
    expect(c.groups).toBe(CHOREOGRAPHY_CAP);
    expect(c.hints.every((h) => h.source === "tween-var")).toBe(true);
  });

  it("caps mixed sources at 20 with tween-var filling first", () => {
    const gsapTriggers = Array.from({ length: 18 }, (_, i) =>
      trigger({ selector: `ul>li:nth-of-type(${i + 1})`, vars: { stagger: "0.05" } }),
    );
    const c = choreographyFromCensus(census({
      gsapTriggers,
      anims: [
        anim({ delayMs: 0 }),
        anim({ delayMs: 120 }),
        anim({ delayMs: 240 }),
        anim({ props: ["opacity"], delayMs: 0 }),
        anim({ props: ["opacity"], delayMs: 100 }),
        anim({ props: ["opacity"], delayMs: 200 }),
      ],
    }));
    expect(c.hints.length).toBe(CHOREOGRAPHY_CAP);
    expect(c.hints.filter((h) => h.source === "tween-var")).toHaveLength(18);
    expect(c.hints.filter((h) => h.source === "delay-delta")).toHaveLength(2);
  });

  it("empty census shapes all reduce to empty", () => {
    expect(choreographyFromCensus(census())).toEqual({ hints: [], groups: 0 });
    const withScrub = census({ scrubCurves: [], gsapTriggers: [] });
    expect(choreographyFromCensus(withScrub)).toEqual({ hints: [], groups: 0 });
    const noDelays = census({ anims: [anim({ delayMs: null }), anim({ delayMs: 50 })] });
    expect(choreographyFromCensus(noDelays)).toEqual({ hints: [], groups: 0 });
  });
});

describe("choreographyFromCensus — determinism", () => {
  it("is byte-equal across repeated runs (no Date, no randomness, no mutation)", () => {
    const c = census({
      gsapTriggers: [trigger({ vars: { stagger: "0.09" } }), trigger({ vars: {} })],
      anims: [
        anim({ delayMs: 240 }),
        anim({ delayMs: 0 }),
        anim({ delayMs: 120 }),
      ],
    });
    const first = JSON.stringify(choreographyFromCensus(c));
    const again = JSON.stringify(choreographyFromCensus(c));
    expect(again).toBe(first);
    // Input census must survive the reduction untouched.
    expect(c.anims.map((a) => a.delayMs)).toEqual([240, 0, 120]);
    expect(c.gsapTriggers).toHaveLength(2);
  });
});
