import { describe, expect, it } from "vitest";
import { createDesignBrief, renderDesignBrief, type DesignBriefSource } from "../src/design-brief.js";
import type { Choreography, ChoreographyHint } from "../src/choreography.js";
import type { SiteDetails, MotionDna } from "../src/types.js";

const detail = (over: Partial<SiteDetails> = {}): SiteDetails => ({ slug: "x", title: "X", description: null, palette: ["#ffffff", "#000000", "#ffffff"], technologies: [" GSAP ", "WebGL"], elements: ["Cards", "cards"], awards: [], nominee: false, score: null, ogImage: null, liveUrl: null, ...over });
const motion: MotionDna = { url: "u", stack: { libs: ["GSAP"], render: ["WebGL"], scrollModel: "native" }, scroll: { triggerCount: 1, scrubCount: 1, pinCount: 1, scrubRatio: 1, sample: [] }, easingVocab: [{ token: "Power4.Out", bezier: null, uses: 1 }], durationVocab: { p25: 10, median: 20, p75: 30 }, capturedAt: 1 };
const source = (slug: string, d: SiteDetails | null = detail(), m: MotionDna | null = null, structureStatus: DesignBriefSource["structureStatus"] = "not_requested"): DesignBriefSource => ({ slug, title: slug.toUpperCase(), detail: d, detailStatus: d ? "cached" : "unavailable", motion: m, structure: null, structureStatus });

const make = (sources: DesignBriefSource[], extra: Partial<Parameters<typeof createDesignBrief>[0]> = {}) => createDesignBrief({ slugs: sources.map((s) => s.slug), goal: "build a portfolio", ...extra }, sources);

describe("choreography stagger hints (createDesignBrief briefEvidence)", () => {
  const hint = (over: Partial<ChoreographyHint>): ChoreographyHint => ({ selector: ".x", value: 1, source: "tween-var", ...over });
  const withChoreography = (hints: ChoreographyHint[]) =>
    createDesignBrief({ slugs: ["a", "b"], goal: "g" }, [source("a"), source("b")], { choreography: { hints, groups: hints.length } satisfies Choreography });

  it("renders choreography hints as source=value @ selector strings", () => {
    const brief = withChoreography([
      hint({ selector: ".card", value: 0.08, source: "tween-var" }),
      hint({ selector: ".item (+4 siblings)", value: 150, source: "delay-delta" }),
    ]);
    expect(brief.direction.interactionPlan.staggerHints).toEqual([
      "tween-var=0.08 @ .card",
      "delay-delta=150 @ .item (+4 siblings)",
    ]);
    expect(renderDesignBrief(brief)).toContain("- Stagger: tween-var=0.08 @ .card; delay-delta=150 @ .item (+4 siblings)");
  });

  it("dedupes, keeps first-seen order, and caps at 8", () => {
    const hints = [
      hint({ selector: ".card", value: 0.08 }),
      hint({ selector: ".item (+4 siblings)", value: 150, source: "delay-delta" }),
      hint({ selector: ".card", value: 0.08 }), // exact duplicate: dropped
    ];
    for (let i = 0; i < 8; i++) hints.push(hint({ selector: `.row-${i}`, value: i * 10 + 0.01 }));
    const brief = withChoreography(hints);
    const staggerHints = brief.direction.interactionPlan.staggerHints;
    expect(staggerHints).toHaveLength(8);
    expect(staggerHints![0]).toBe("tween-var=0.08 @ .card");
    expect(staggerHints![1]).toBe("delay-delta=150 @ .item (+4 siblings)");
    expect(staggerHints![2]).toBe("tween-var=0.01 @ .row-0");
    expect(staggerHints![7]).toBe("tween-var=50.01 @ .row-5");
  });

  it("omits staggerHints without choreography evidence (additive field)", () => {
    const brief = make([source("a"), source("b")]);
    expect("staggerHints" in brief.direction.interactionPlan).toBe(false);
    expect(renderDesignBrief(brief)).not.toContain("Stagger:");
  });
});

describe("createDesignBrief", () => {
  it("applies two-source shared threshold and outliers", () => {
    const a = source("a", detail({ technologies: ["gsap", "one"] }));
    const b = source("b", detail({ technologies: ["gsap", "two"] }));
    const brief = make([a, b]);
    expect(brief.direction.sharedPatterns.map((x) => x.value)).toContain("technology:gsap");
    expect(brief.direction.outliers.map((x) => x.value)).toContain("technology:one");
  });
  it("uses ceil(n/2) for three sources and no patterns for one", () => {
    const three = make([source("a"), source("b"), source("c", detail({ technologies: ["rare"] }))]);
    expect(three.direction.sharedPatterns.some((x) => x.value === "technology:gsap")).toBe(true);
    expect(three.direction.outliers.some((x) => x.value === "technology:rare")).toBe(true);
    const one = make([source("a")]);
    expect(one.direction.sharedPatterns).toEqual([]);
    expect(one.direction.outliers).toEqual([]);
  });
  it("deduplicates, normalizes hex/luminance, and sorts signals", () => {
    const brief = make([source("z"), source("a")]);
    expect(brief.direction.palette.find((x) => x.value === "#FFFFFF")?.luminanceBand).toBe("light");
    expect(brief.direction.palette.find((x) => x.value === "#000000")?.luminanceBand).toBe("dark");
    expect(brief.direction.elementSignals.find((x) => x.value === "cards")?.frequency).toBe(2);
    expect(brief.direction.technologySignals[0].value).toBe("gsap");
  });
  it("aggregates partial cached motion and separates goal/constraints from evidence", () => {
    const base = make([source("a", detail(), motion), source("b")]);
    const constrained = make([source("a", detail(), motion), source("b")], { goal: "different", constraints: [" webgl ", "webgl"] });
    expect(base.direction.motion.libraries[0].value).toBe("gsap");
    expect(base.direction.motion.interactionSignals.map((x) => x.value)).toEqual(["pinned-sections", "scrubbed-scroll"]);
    expect(constrained.direction.technologySignals).toEqual(base.direction.technologySignals);
    expect(constrained.direction.buildConstraints).toContain("Honor constraint: webgl");
    expect(constrained.direction.buildConstraints).toContain("Avoid observed WebGL rendering where the stated constraint requires it; retain WebGL in the evidence above.");
  });
  it("derives only explicit interaction evidence and renders accessibility guidance", () => {
    const brief = make([
      source("a", detail({ elements: ["Cursor interaction", "Hover state", "Page transition"] }), motion),
      source("b", detail({ elements: ["Mouse interaction", "Preloader"] }), motion),
    ]);
    expect(brief.direction.interactionPlan.cursorHover.map((x) => x.value)).toEqual(["cursor-mouse-interaction", "micro-interaction", "hover-interaction"]);
    expect(brief.direction.interactionPlan.scroll.map((x) => x.value)).toEqual(["pinned-sections", "scroll-trigger", "scrubbed-scroll"]);
    expect(brief.direction.interactionPlan.entranceReveal.map((x) => x.value)).toEqual(["loading-entrance", "transition-reveal"]);
    expect(brief.direction.interactionPlan.easings.map((x) => x.value)).toEqual(["power4.out"]);
    expect(brief.direction.interactionPlan.durationRange).toEqual({ p25: 10, median: 20, p75: 30, sourceSlugs: ["a", "b"] });
    const markdown = renderDesignBrief(brief);
    expect(markdown).toContain("## Interaction plan");
    expect(markdown).toContain("Respect prefers-reduced-motion");
  });
  it("does not invent interaction behavior without cached evidence", () => {
    const brief = make([source("a"), source("b")]);
    expect(brief.direction.interactionPlan.cursorHover).toEqual([]);
    expect(brief.direction.interactionPlan.scroll).toEqual([]);
    expect(brief.direction.interactionPlan.entranceReveal).toEqual([]);
    expect(brief.direction.interactionPlan.durationRange).toBeNull();
    expect(renderDesignBrief(brief)).toContain("No cached timing evidence; do not invent durations or easing.");
  });
  it("includes only captured non-null structures and reports inconsistent captures", () => {
    const captured = source("a", detail());
    captured.structureStatus = "captured";
    captured.structure = { url: "u", title: "A", totalHeight: 100, bands: [{ index: 0, tag: "SECTION", label: "", background: "#fff", offsetTop: 0, height: 100, textStart: "" }] };
    const nullCaptured = source("b", detail());
    nullCaptured.structureStatus = "captured";
    const unavailable = source("c", detail());
    unavailable.structureStatus = "unavailable";
    unavailable.structure = { url: "u", title: "C", totalHeight: 100, bands: [{ index: 0, tag: "aside", label: "", background: "#000", offsetTop: 0, height: 100, textStart: "" }] };
    const brief = make([captured, nullCaptured, unavailable], { includeStructure: true });
    expect(brief.direction.structure?.availableSourceSlugs).toEqual(["a"]);
    expect(brief.direction.structure?.bandCounts).toEqual([{ slug: "a", count: 1 }]);
    expect(brief.direction.structure?.repeatedTags.map((tag) => tag.value)).toEqual(["section"]);
    expect(brief.direction.limitations).toContain("b: requested structure unavailable");
    expect(brief.direction.limitations).toContain("c: requested structure unavailable");
  });
  it("renders cited stable JSON and limitations with optional structure", () => {
    const brief = make([source("a", detail(), null, "captured"), source("b", null, null, "unavailable")], { includeStructure: true });
    const markdown = renderDesignBrief(brief);
    expect(markdown).toContain("## Direction");
    expect(markdown).toContain("`b`");
    expect(markdown).toContain("b: detail unavailable");
    expect(markdown).toContain("requested structure unavailable");
    expect(markdown.endsWith("```\n")).toBe(true);
    expect(markdown).toBe(renderDesignBrief(brief));
  });
});
