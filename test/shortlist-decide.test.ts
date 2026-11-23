import { describe, expect, it } from "vitest";
import type { StackFingerprint } from "../src/stack.js";
import type { PageStructure } from "../src/structure.js";
import type { MotionDna } from "../src/types.js";
import type {
  CandidateEvidence,
  CandidateSeed,
  CriterionInput,
  ShortlistCandidate,
} from "../src/shortlist/contracts.js";
import { parseShortlistInput } from "../src/shortlist/contracts.js";
import {
  THREE_D_LIBS,
  classifyCandidate,
  criterionCoverage,
  motionLevel,
  shortlistStatus,
  stackFit,
  threeDSignal,
} from "../src/shortlist/decide.js";

const dna = (over: Partial<MotionDna> = {}): MotionDna => ({
  url: "https://example.com",
  stack: { libs: [], render: [], scrollModel: "native" },
  scroll: { triggerCount: 0, scrubCount: 0, pinCount: 0, scrubRatio: 0, sample: [] },
  easingVocab: [],
  durationVocab: null,
  capturedAt: 1,
  ...over,
});

const motionAt = (level: "minimal" | "scroll" | "expressive"): MotionDna =>
  level === "expressive"
    ? dna({
        scroll: { triggerCount: 1, scrubCount: 0, pinCount: 1, scrubRatio: 0, sample: [] },
      })
    : level === "scroll"
      ? dna({
          scroll: { triggerCount: 1, scrubCount: 1, pinCount: 0, scrubRatio: 1, sample: [] },
        })
      : dna();

const stack = (over: Partial<StackFingerprint> = {}): StackFingerprint => ({
  id: "stack-fingerprint-v1",
  framework: "static",
  frameworkMarkers: [],
  frameworkConfidence: "low",
  css: "custom",
  cssMarkers: [],
  cssConfidence: "low",
  libs: [],
  ...over,
});

const structure = (over: Partial<PageStructure> = {}): PageStructure => ({
  url: "https://s.example",
  title: "S",
  totalHeight: 900,
  bands: [],
  scrollMode: "document",
  ...over,
});

const seed = (over: Partial<CandidateSeed> = {}): CandidateSeed => ({
  siteSlug: "s",
  title: "S",
  liveUrl: "https://s.example",
  surfacedBy: ["a"],
  ...over,
});

const evidence = (over: Partial<CandidateEvidence> = {}): CandidateEvidence => ({
  stack: stack(),
  structure: structure(),
  motion: dna(),
  a11y: { status: "available", contrastWorstPairs: 0 },
  unknowns: [],
  ...over,
});

const criterion = (over: Partial<CriterionInput> = {}): CriterionInput => ({
  id: "a",
  label: "A",
  kind: "must",
  query: "a",
  ...over,
});

const candidate = (
  decision: ShortlistCandidate["decision"],
  surfacedBy: string[],
): ShortlistCandidate => ({
  siteSlug: `s-${decision}-${surfacedBy.join("-")}`,
  title: "S",
  liveUrl: "https://s.example",
  decision,
  reason: "",
  surfacedBy,
  threeD: { detected: false, libraries: [], canvas: false },
  motionLevel: "minimal",
  stackFit: "unknown",
  evidence: evidence(),
  artifacts: {},
});

const baseInput = {
  brief: "Portfolio rebuild with fast project discovery.",
  criteria: [{ id: "a", label: "A", kind: "must", query: "portfolio" }],
  outDir: "C:/work/shortlist",
};

describe("shortlist contracts", () => {
  it("rejects an empty or overfull criteria list", () => {
    expect(parseShortlistInput({ ...baseInput, criteria: [] })).toBeNull();
    expect(
      parseShortlistInput({
        ...baseInput,
        criteria: Array.from({ length: 7 }, (_, i) => ({
          id: `c${i}`,
          label: `C${i}`,
          kind: "nice",
          query: "q",
        })),
      }),
    ).toBeNull();
  });

  it("rejects a limit outside 3-5 and an empty outDir", () => {
    expect(parseShortlistInput({ ...baseInput, limit: 2 })).toBeNull();
    expect(parseShortlistInput({ ...baseInput, limit: 6 })).toBeNull();
    expect(parseShortlistInput({ ...baseInput, outDir: "" })).toBeNull();
    expect(parseShortlistInput({ ...baseInput, limit: 3 })).not.toBeNull();
    expect(parseShortlistInput({ ...baseInput, limit: 5 })).not.toBeNull();
  });

  it("accepts only Awwwards slugs as seeds", () => {
    expect(parseShortlistInput({ ...baseInput, seeds: ["https://evil.test"] })).toBeNull();
    expect(parseShortlistInput({ ...baseInput, seeds: ["https://evil.test/x"] })).toBeNull();
    expect(parseShortlistInput({ ...baseInput, seeds: ["site-slug_a"] })).not.toBeNull();
    expect(
      parseShortlistInput({
        ...baseInput,
        seeds: Array.from({ length: 8 }, (_, i) => `s${i}`),
      }),
    ).not.toBeNull();
    expect(
      parseShortlistInput({
        ...baseInput,
        seeds: Array.from({ length: 9 }, (_, i) => `s${i}`),
      }),
    ).toBeNull();
  });

  it("rejects duplicate criterion ids", () => {
    expect(
      parseShortlistInput({
        ...baseInput,
        criteria: [
          { id: "same", label: "One", kind: "must", query: "a" },
          { id: "same", label: "Two", kind: "nice", query: "b" },
        ],
      }),
    ).toBeNull();
    expect(
      parseShortlistInput({
        ...baseInput,
        criteria: [
          { id: "one", label: "One", kind: "must", query: "a" },
          { id: "two", label: "Two", kind: "nice", query: "b" },
        ],
      }),
    ).not.toBeNull();
  });

  it("validates criterion ids and requires a query or tags", () => {
    expect(
      parseShortlistInput({
        ...baseInput,
        criteria: [{ id: "Bad Id", label: "A", kind: "must", query: "a" }],
      }),
    ).toBeNull();
    expect(
      parseShortlistInput({
        ...baseInput,
        criteria: [{ id: "-a", label: "A", kind: "must", query: "a" }],
      }),
    ).toBeNull();
    expect(
      parseShortlistInput({
        ...baseInput,
        criteria: [{ id: "a", label: "A", kind: "must" }],
      }),
    ).toBeNull();
    expect(
      parseShortlistInput({
        ...baseInput,
        criteria: [{ id: "a".repeat(64), label: "A", kind: "must", query: "a" }],
      }),
    ).not.toBeNull();
    expect(
      parseShortlistInput({
        ...baseInput,
        criteria: [{ id: "a".repeat(65), label: "A", kind: "must", query: "a" }],
      }),
    ).toBeNull();
    expect(
      parseShortlistInput({
        ...baseInput,
        criteria: [{ id: "a", label: "A", kind: "must", tags: ["x"] }],
      }),
    ).not.toBeNull();
    expect(
      parseShortlistInput({
        ...baseInput,
        criteria: [
          { id: "a", label: "A", kind: "must", tags: ["1", "2", "3", "4", "5", "6"] },
        ],
      }),
    ).toBeNull();
  });

  it("normalizes omitted limit, viewport, refresh and constraints", () => {
    const parsed = parseShortlistInput(baseInput);
    expect(parsed).not.toBeNull();
    expect(parsed?.limit).toBe(5);
    expect(parsed?.viewport).toBe("desktop");
    expect(parsed?.refresh).toBe(false);
    expect(parsed?.constraints).toMatchObject({
      allow3d: "any",
      motionBudget: "expressive",
    });
  });

  it("normalizes an explicit empty constraints object", () => {
    const parsed = parseShortlistInput({ ...baseInput, constraints: {} });
    expect(parsed?.constraints).toEqual({
      allow3d: "any",
      motionBudget: "expressive",
    });
  });

  it("does not cap labels, queries, tag values or excludeStacks", () => {
    const long = "x".repeat(500);
    const parsed = parseShortlistInput({
      ...baseInput,
      criteria: [{ id: "a", label: long, kind: "must", query: long, tags: [long] }],
      constraints: {
        excludeStacks: Array.from({ length: 9 }, (_, i) => `stack-${i}`),
      },
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.criteria[0]?.label).toBe(long);
    expect(parsed?.constraints.excludeStacks).toHaveLength(9);
  });

  it("leaves an invalid brief out entirely", () => {
    expect(parseShortlistInput({ ...baseInput, brief: "" })).toBeNull();
    expect(parseShortlistInput({ ...baseInput, brief: "x".repeat(2001) })).toBeNull();
  });
});

describe("motionLevel", () => {
  it("turns raw motion counts into a ceiling level", () => {
    expect(motionLevel(dna())).toBe("minimal");
    expect(
      motionLevel(
        dna({ scroll: { triggerCount: 100, scrubCount: 0, pinCount: 0, scrubRatio: 0, sample: [] } }),
      ),
    ).toBe("scroll");
    expect(
      motionLevel(
        dna({ scroll: { triggerCount: 2, scrubCount: 2, pinCount: 0, scrubRatio: 1, sample: [] } }),
      ),
    ).toBe("scroll");
    expect(
      motionLevel(
        dna({ scroll: { triggerCount: 2, scrubCount: 2, pinCount: 1, scrubRatio: 1, sample: [] } }),
      ),
    ).toBe("expressive");
    expect(motionLevel(null)).toBe("unknown");
  });

  it("treats trigger-only and pin-plus-trigger motion as real levels", () => {
    expect(
      motionLevel(
        dna({ scroll: { triggerCount: 1, scrubCount: 0, pinCount: 0, scrubRatio: 0, sample: [] } }),
      ),
    ).toBe("scroll");
    expect(
      motionLevel(
        dna({ scroll: { triggerCount: 1, scrubCount: 0, pinCount: 1, scrubRatio: 0, sample: [] } }),
      ),
    ).toBe("expressive");
  });

  it("does not let trigger-only motion pass a minimal budget", () => {
    const result = classifyCandidate({
      seed: seed(),
      evidence: evidence({
        motion: dna({
          scroll: { triggerCount: 100, scrubCount: 0, pinCount: 0, scrubRatio: 0, sample: [] },
        }),
      }),
      constraints: { motionBudget: "minimal" },
    });
    expect(result.motionLevel).toBe("scroll");
    expect(result.decision).toBe("avoid");
    expect(result.reason).toMatch(/over the minimal budget/i);
  });

  it("lets a pin outweigh a scrub", () => {
    expect(
      motionLevel(
        dna({ scroll: { triggerCount: 5, scrubCount: 4, pinCount: 1, scrubRatio: 0.8, sample: [] } }),
      ),
    ).toBe("expressive");
  });

  it("returns unknown for corrupt DNA without usable scroll counts", () => {
    expect(motionLevel({ ...dna(), scroll: undefined } as unknown as MotionDna)).toBe(
      "unknown",
    );
    expect(motionLevel({ ...dna(), scroll: {} } as unknown as MotionDna)).toBe("unknown");
    expect(motionLevel({ ...dna(), scroll: { ...dna().scroll, triggerCount: NaN } })).toBe(
      "unknown",
    );
    expect(motionLevel({ ...dna(), scroll: { ...dna().scroll, triggerCount: -1 } })).toBe(
      "unknown",
    );
    expect(motionLevel({ ...dna(), scroll: { ...dna().scroll, pinCount: undefined } as never })).toBe(
      "unknown",
    );
    expect(motionLevel({ ...dna(), scroll: { ...dna().scroll, scrubCount: 1.5 } })).toBe(
      "unknown",
    );
  });
});

describe("threeDSignal", () => {
  it("has exactly the true-3D allowlist", () => {
    expect([...THREE_D_LIBS].sort()).toEqual([
      "@react-three/fiber",
      "aframe",
      "babylon",
      "babylon.js",
      "babylonjs",
      "ogl",
      "playcanvas",
      "react-three-fiber",
      "regl",
      "spline",
      "three",
      "three-js",
      "three.js",
    ]);
  });

  it("detects only 3D libraries from the stack", () => {
    const signal = threeDSignal(stack({ libs: ["Three", "three", "GSAP"] }), null, null);
    expect(signal.detected).toBe(true);
    expect(signal.libraries).toEqual(["three"]);
    expect(signal.canvas).toBe(false);
  });

  it("does not treat motion libraries as 3D", () => {
    expect(threeDSignal(stack({ libs: ["gsap", "lenis"] }), null, null)).toEqual({
      detected: false,
      libraries: [],
      canvas: false,
    });
    expect(
      threeDSignal(
        stack({ libs: ["gsap", "scrolltrigger", "locomotive", "framer-motion", "anime"] }),
        null,
        null,
      ).detected,
    ).toBe(false);
  });

  it("does not treat canvas-only engines or bare webgl as 3D", () => {
    for (const lib of ["webgl", "pixi", "pixijs", "rive"]) {
      expect(threeDSignal(stack({ libs: [lib] }), null, null)).toEqual({
        detected: false,
        libraries: [],
        canvas: false,
      });
    }
  });

  it("detects true 3D engines", () => {
    expect(threeDSignal(stack({ libs: ["three"] }), null, null).detected).toBe(true);
    expect(threeDSignal(stack({ libs: ["babylon"] }), null, null).detected).toBe(true);
  });

  it("tolerates case and whitespace in library names", () => {
    const signal = threeDSignal(
      stack({ libs: ["  THREE  ", " WebGL ", "babylon"] }),
      null,
      null,
    );
    expect(signal.detected).toBe(true);
    expect(signal.libraries).toEqual(["three", "babylon"]);
  });

  it("recognizes every allowlisted 3D library", () => {
    const signal = threeDSignal(
      stack({
        libs: [
          "three",
          "three-js",
          "babylon",
          "babylonjs",
          "playcanvas",
          "regl",
          "ogl",
        ],
      }),
      null,
      null,
    );
    expect(signal.libraries).toHaveLength(7);
  });

  it("gathers 3D libraries from motion stack and render when stack libs are empty", () => {
    const motion = dna({
      stack: { libs: ["lenis"], render: ["webgl", "three"], scrollModel: "lenis" },
    });
    expect(threeDSignal(stack({ libs: [] }), null, motion)).toEqual({
      detected: true,
      libraries: ["three"],
      canvas: false,
    });
    expect(threeDSignal(stack(), structure(), motion).detected).toBe(true);
  });

  it("keeps canvas scroll mode as a separate signal, not detected 3D", () => {
    const signal = threeDSignal(null, structure({ scrollMode: "canvas" }), null);
    expect(signal).toEqual({ detected: false, libraries: [], canvas: true });
  });

  it("stays false for a plain document with no libraries", () => {
    expect(threeDSignal(stack(), structure(), null)).toEqual({
      detected: false,
      libraries: [],
      canvas: false,
    });
    expect(threeDSignal(null, null, null)).toEqual({
      detected: false,
      libraries: [],
      canvas: false,
    });
  });
});

describe("stackFit", () => {
  it("returns unknown for any, vite, undefined, a missing stack and static", () => {
    expect(stackFit(undefined, stack({ framework: "next" }))).toBe("unknown");
    expect(stackFit("any", stack({ framework: "next" }))).toBe("unknown");
    expect(stackFit("vite", stack({ framework: "next" }))).toBe("unknown");
    expect(stackFit("next", null)).toBe("unknown");
    expect(stackFit("next", stack({ framework: "static" }))).toBe("unknown");
  });

  it("matches the detected framework and otherwise reports compatible", () => {
    expect(stackFit("next", stack({ framework: " Next " }))).toBe("same");
    expect(stackFit("astro", stack({ framework: "Next" }))).toBe("compatible");
  });
});

describe("classifyCandidate", () => {
  it("recommends only when hard evidence is complete", () => {
    const result = classifyCandidate({ seed: seed(), evidence: evidence(), constraints: {} });
    expect(result.decision).toBe("recommend");
    expect(result.siteSlug).toBe("s");
    expect(result.liveUrl).toBe("https://s.example");
    expect(result.surfacedBy).toEqual(["a"]);
    expect(result.reason).not.toMatch(/no 3D detected/i);
    expect(result.reason).toMatch(/none measured/i);
    expect(result.reason).not.toMatch(/motion minimal/i);
    expect(result.reason).not.toMatch(/hard constraints clear/i);
    expect(result.reason).toContain(
      "No measured hard-constraint failure; motion none measured (ScrollTrigger/scrub/pin scan only; bundled or CSS/IO motion not measured).",
    );
    expect(result.evidence.unknowns).toContain("motion-unmeasured");
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it("adds motion-unmeasured without mutating the caller's evidence", () => {
    const ev = evidence();
    const result = classifyCandidate({ seed: seed(), evidence: ev, constraints: {} });
    expect(result.evidence.unknowns).toContain("motion-unmeasured");
    expect(ev.unknowns).not.toContain("motion-unmeasured");
  });

  it("preserves an explicit seed's empty surfacedBy and seeded flag", () => {
    const result = classifyCandidate({
      seed: seed({ surfacedBy: [], seeded: true }),
      evidence: evidence(),
      constraints: {},
    });
    expect(result.surfacedBy).toEqual([]);
    expect(result.seeded).toBe(true);
    expect(result.decision).toBe("recommend");
  });

  it("marks a site without a live URL as consider and records the unknown", () => {
    const ev = evidence();
    const result = classifyCandidate({
      seed: seed({ liveUrl: null }),
      evidence: ev,
      constraints: {},
    });
    expect(result.decision).toBe("consider");
    expect(result.reason).toMatch(/live URL/i);
    expect(result.evidence.unknowns).toContain("liveUrl");
    expect(result.evidence).not.toBe(ev);
    expect(ev.unknowns).toEqual([]);
  });

  it("marks missing stack, structure or motion evidence as consider", () => {
    expect(
      classifyCandidate({ seed: seed(), evidence: evidence({ stack: null }), constraints: {} })
        .decision,
    ).toBe("consider");
    expect(
      classifyCandidate({ seed: seed(), evidence: evidence({ structure: null }), constraints: {} })
        .decision,
    ).toBe("consider");
    expect(
      classifyCandidate({ seed: seed(), evidence: evidence({ motion: null }), constraints: {} })
        .decision,
    ).toBe("consider");
  });

  it("marks an unknown motion level as consider", () => {
    const result = classifyCandidate({
      seed: seed(),
      evidence: evidence({ motion: null }),
      constraints: {},
    });
    expect(result.decision).toBe("consider");
    expect(result.motionLevel).toBe("unknown");
    expect(result.reason).toMatch(/motion/i);
  });

  it("avoids detected 3D when allow3d is none", () => {
    const result = classifyCandidate({
      seed: seed(),
      evidence: evidence({ stack: stack({ libs: ["gsap", "three"] }) }),
      constraints: { allow3d: "none" },
    });
    expect(result.decision).toBe("avoid");
    expect(result.reason).toMatch(/3D/i);
    expect(result.reason).toMatch(/three/i);
  });

  it("keeps raw WebGL unverified under allow3d none", () => {
    const result = classifyCandidate({
      seed: seed(),
      evidence: evidence({
        motion: dna({ stack: { libs: [], render: ["webgl"], scrollModel: "native" } }),
        unknowns: ["3d-unverified"],
      }),
      constraints: { allow3d: "none" },
    });
    expect(result.decision).toBe("consider");
    expect(result.reason).toMatch(/3D state unverified/i);
    expect(result.reason).toMatch(/allow3d:none cannot be proven/i);
  });

  it("keeps a canvas/Pixi page unverified rather than calling it 3D", () => {
    const result = classifyCandidate({
      seed: seed(),
      evidence: evidence({
        stack: stack({ libs: ["pixi"] }),
        structure: structure({ scrollMode: "canvas" }),
      }),
      constraints: { allow3d: "none" },
    });
    expect(result.threeD).toEqual({ detected: false, libraries: [], canvas: true });
    expect(result.decision).toBe("consider");
    expect(result.reason).toMatch(/canvas scroll mode/i);
    expect(result.reason).toMatch(/3D unverified/i);
  });

  it("lets an excluded stack beat the unverified 3D consider", () => {
    const result = classifyCandidate({
      seed: seed(),
      evidence: evidence({
        stack: stack({ framework: "next", libs: [] }),
        structure: structure({ scrollMode: "canvas" }),
      }),
      constraints: { allow3d: "none", excludeStacks: ["Next.js"] },
    });
    expect(result.decision).toBe("avoid");
    expect(result.reason).toMatch(/excluded by excludeStacks/i);
  });

  it("lets over-budget motion beat the unverified 3D consider", () => {
    const result = classifyCandidate({
      seed: seed(),
      evidence: evidence({
        structure: structure({ scrollMode: "canvas" }),
        motion: motionAt("expressive"),
      }),
      constraints: { allow3d: "none", motionBudget: "scroll" },
    });
    expect(result.decision).toBe("avoid");
    expect(result.reason).toMatch(/over the scroll budget/i);
  });

  it("avoids three.js and react-three-fiber aliases under allow3d none", () => {
    for (const lib of ["three.js", "@react-three/fiber"]) {
      const result = classifyCandidate({
        seed: seed(),
        evidence: evidence({ stack: stack({ libs: [lib] }) }),
        constraints: { allow3d: "none" },
      });
      expect(result.decision).toBe("avoid");
      expect(result.reason).toMatch(/3D detected/i);
    }
  });

  it("normalizes common excludeStacks aliases before matching", () => {
    for (const [framework, alias] of [
      ["next", "Next.js"],
      ["webflow", " WebFlow "],
    ] as const) {
      const result = classifyCandidate({
        seed: seed(),
        evidence: evidence({ stack: stack({ framework }) }),
        constraints: { excludeStacks: [alias] },
      });
      expect(result.decision).toBe("avoid");
      expect(result.reason).toContain(`Stack ${framework} is excluded`);
    }
  });

  it("normalizes nextjs in excludeStacks", () => {
    const result = classifyCandidate({
      seed: seed(),
      evidence: evidence({ stack: stack({ framework: "next" }) }),
      constraints: { excludeStacks: ["nextjs"] },
    });
    expect(result.decision).toBe("avoid");
    expect(result.reason).toContain("Stack next is excluded");
  });

  it("avoids a true 3D library under allow3d none", () => {
    const result = classifyCandidate({
      seed: seed(),
      evidence: evidence({ stack: stack({ libs: ["three"] }) }),
      constraints: { allow3d: "none" },
    });
    expect(result.decision).toBe("avoid");
    expect(result.reason).toMatch(/3D detected/i);
    expect(result.reason).not.toMatch(/unverified/i);
  });

  it("keeps detected 3D when allow3d is any", () => {
    const result = classifyCandidate({
      seed: seed(),
      evidence: evidence({ stack: stack({ libs: ["gsap", "three"] }) }),
      constraints: { allow3d: "any" },
    });
    expect(result.decision).toBe("recommend");
    expect(result.threeD).toEqual({ detected: true, libraries: ["three"], canvas: false });
  });

  it("detects 3D from motion render when stack libs are empty", () => {
    const result = classifyCandidate({
      seed: seed(),
      evidence: evidence({
        stack: stack({ libs: [] }),
        motion: dna({
          stack: { libs: [], render: ["webgl", "three"], scrollModel: "native" },
        }),
      }),
      constraints: { allow3d: "none" },
    });
    expect(result.decision).toBe("avoid");
    expect(result.threeD).toEqual({ detected: true, libraries: ["three"], canvas: false });
  });

  it("defaults allow3d to any and motionBudget to expressive", () => {
    const threeD = classifyCandidate({
      seed: seed(),
      evidence: evidence({ stack: stack({ libs: ["three"] }) }),
      constraints: {},
    });
    expect(threeD.decision).toBe("recommend");

    const expressive = classifyCandidate({
      seed: seed(),
      evidence: evidence({ motion: motionAt("expressive") }),
      constraints: {},
    });
    expect(expressive.decision).toBe("recommend");
  });

  it("avoids an excluded stack case-insensitively and trimmed", () => {
    const result = classifyCandidate({
      seed: seed(),
      evidence: evidence({ stack: stack({ framework: "WebFlow" }) }),
      constraints: { excludeStacks: [" Webflow ", "framer"] },
    });
    expect(result.decision).toBe("avoid");
    expect(result.reason).toMatch(/webflow/i);
  });

  it("recommends a stack that is not excluded", () => {
    const result = classifyCandidate({
      seed: seed(),
      evidence: evidence({ stack: stack({ framework: "webflow" }) }),
      constraints: { excludeStacks: ["framer"] },
    });
    expect(result.decision).toBe("recommend");
  });

  it("avoids motion that exceeds the budget", () => {
    const scroll = evidence({ motion: motionAt("scroll") });
    expect(
      classifyCandidate({
        seed: seed(),
        evidence: scroll,
        constraints: { motionBudget: "minimal" },
      }).decision,
    ).toBe("avoid");
    expect(
      classifyCandidate({
        seed: seed(),
        evidence: evidence({ motion: motionAt("expressive") }),
        constraints: { motionBudget: "minimal" },
      }).decision,
    ).toBe("avoid");
    expect(
      classifyCandidate({
        seed: seed(),
        evidence: evidence({ motion: motionAt("expressive") }),
        constraints: { motionBudget: "scroll" },
      }).decision,
    ).toBe("avoid");
    expect(
      classifyCandidate({
        seed: seed(),
        evidence: evidence({ motion: motionAt("scroll") }),
        constraints: { motionBudget: "scroll" },
      }).decision,
    ).toBe("recommend");
    expect(
      classifyCandidate({
        seed: seed(),
        evidence: evidence({ motion: motionAt("expressive") }),
        constraints: { motionBudget: "expressive" },
      }).decision,
    ).toBe("recommend");
  });

  it("carries the evidence and thumbnail forward", () => {
    const ev = evidence();
    const result = classifyCandidate({
      seed: seed({ thumbnailPath: "submissions/s.jpg" }),
      evidence: ev,
      constraints: {},
    });
    expect(result.evidence.stack).toBe(ev.stack);
    expect(result.evidence.structure).toBe(ev.structure);
    expect(result.evidence.motion).toBe(ev.motion);
    expect(result.evidence.a11y).toEqual(ev.a11y);
    expect(result.evidence.unknowns).toEqual([
      ...ev.unknowns,
      "motion-unmeasured",
    ]);
    expect(result.artifacts.thumbnail).toBe("submissions/s.jpg");
  });

  it("computes threeD, motionLevel and stackFit from raw evidence", () => {
    const result = classifyCandidate({
      seed: seed(),
      evidence: evidence({
        stack: stack({ framework: "next", libs: ["gsap"] }),
        structure: structure({ scrollMode: "document" }),
        motion: motionAt("expressive"),
      }),
      constraints: { targetStack: "next" },
    });
    expect(result.threeD).toEqual({ detected: false, libraries: [], canvas: false });
    expect(result.motionLevel).toBe("expressive");
    expect(result.stackFit).toBe("same");
  });

  it("ignores stale precomputed 3D and motion fields", () => {
    const raw = evidence({
      stack: stack({ libs: ["three"] }),
      structure: structure({ scrollMode: "canvas" }),
      motion: dna({
        scroll: { triggerCount: 9, scrubCount: 0, pinCount: 9, scrubRatio: 0, sample: [] },
      }),
    });
    const stale = {
      ...raw,
      threeD: { detected: false, libraries: [], canvas: false },
      motionLevel: "minimal",
    } as CandidateEvidence;

    const result = classifyCandidate({
      seed: seed(),
      evidence: stale,
      constraints: { allow3d: "none" },
    });
    expect(result.decision).toBe("avoid");
    expect(result.threeD.detected).toBe(true);
    expect(result.motionLevel).toBe("expressive");
  });
});

describe("shortlistStatus", () => {
  const must = criterion();

  it("is inconclusive with no candidates", () => {
    expect(shortlistStatus([], [must])).toBe("inconclusive");
  });

  it("is inconclusive when a must criterion has only avoid candidates", () => {
    expect(shortlistStatus([candidate("avoid", ["a"])], [must])).toBe("inconclusive");
  });

  it("is inconclusive when a must criterion has no candidate at all", () => {
    expect(shortlistStatus([candidate("recommend", ["b"])], [must])).toBe("inconclusive");
  });

  it("does not let a standalone explicit seed cover a must criterion", () => {
    const explicitSeed = classifyCandidate({
      seed: seed({ surfacedBy: [], seeded: true }),
      evidence: evidence(),
      constraints: {},
    });
    expect(explicitSeed.decision).toBe("recommend");
    expect(shortlistStatus([explicitSeed], [must])).toBe("inconclusive");
  });

  it("lets a search result cover a criterion literally named seed", () => {
    const searchHit = classifyCandidate({
      seed: seed({ surfacedBy: ["seed"] }),
      evidence: evidence(),
      constraints: {},
    });
    const seedCriterion = criterion({ id: "seed", kind: "must" });
    expect(criterionCoverage([searchHit], [seedCriterion])).toEqual({ seed: true });
    expect(shortlistStatus([searchHit], [seedCriterion])).toBe("ok");
  });

  it("lets a mixed seed-plus-criterion candidate cover both ids", () => {
    const mixed = classifyCandidate({
      seed: seed({ surfacedBy: ["seed", "a"] }),
      evidence: evidence(),
      constraints: {},
    });
    const both = [criterion({ id: "a", kind: "must" }), criterion({ id: "seed", kind: "must" })];
    expect(criterionCoverage([mixed], both)).toEqual({ a: true, seed: true });
    expect(shortlistStatus([mixed], both)).toBe("ok");
  });

  it("never returns ok for a consider-only shortlist", () => {
    const considered = classifyCandidate({
      seed: seed(),
      evidence: evidence({ motion: null }),
      constraints: {},
    });
    expect(considered.decision).toBe("consider");
    expect(shortlistStatus([considered], [must])).toBe("partial");
  });

  it("is ok when every must criterion has a recommend", () => {
    expect(
      shortlistStatus([candidate("recommend", ["a"]), candidate("consider", ["a"])], [must]),
    ).toBe("ok");
  });

  it("is partial when one must criterion is only consider", () => {
    const criteria = [criterion({ id: "a" }), criterion({ id: "b" })];
    expect(
      shortlistStatus(
        [candidate("recommend", ["a"]), candidate("consider", ["b"])],
        criteria,
      ),
    ).toBe("partial");
  });

  it("is inconclusive when any must criterion is uncovered", () => {
    const criteria = [criterion({ id: "a" }), criterion({ id: "b" })];
    expect(
      shortlistStatus(
        [candidate("recommend", ["a"]), candidate("consider", ["c"])],
        criteria,
      ),
    ).toBe("inconclusive");
    expect(
      shortlistStatus(
        [candidate("recommend", ["a"]), candidate("avoid", ["b"])],
        criteria,
      ),
    ).toBe("inconclusive");
  });

  it("credits a site surfaced by two criteria to both", () => {
    const criteria = [criterion({ id: "a" }), criterion({ id: "b" })];
    expect(shortlistStatus([candidate("recommend", ["a", "b"])], criteria)).toBe("ok");
  });

  it("is inconclusive when every candidate is avoid, even with only nice criteria", () => {
    expect(
      shortlistStatus([candidate("avoid", ["nice"])], [
        criterion({ id: "nice", kind: "nice" }),
      ]),
    ).toBe("inconclusive");
  });

  it("ignores nice criteria when deciding must coverage", () => {
    expect(
      shortlistStatus([candidate("consider", ["nice"])], [
        criterion({ id: "nice", kind: "nice" }),
      ]),
    ).toBe("partial");
    expect(
      shortlistStatus([candidate("recommend", ["nice"])], [
        criterion({ id: "nice", kind: "nice" }),
      ]),
    ).toBe("ok");
    expect(
      shortlistStatus([candidate("recommend", ["a"])], [
        criterion({ id: "a" }),
        criterion({ id: "nice", kind: "nice" }),
      ]),
    ).toBe("ok");
  });
});

describe("criterionCoverage", () => {
  it("counts a criterion literally named seed and agrees with status", () => {
    const criteria = [criterion({ id: "a" }), criterion({ id: "seed" })];
    const candidates = [candidate("recommend", ["a"]), candidate("consider", ["seed"])];
    expect(criterionCoverage(candidates, criteria)).toEqual({ a: true, seed: true });
    expect(shortlistStatus(candidates, criteria)).toBe("partial");
  });

  it("leaves a standalone explicit seed uncovered", () => {
    const criteria = [criterion({ id: "a" })];
    const explicitSeed = candidate("recommend", []);
    explicitSeed.seeded = true;
    expect(criterionCoverage([explicitSeed], criteria)).toEqual({ a: false });
    expect(shortlistStatus([explicitSeed], criteria)).toBe("inconclusive");
  });

  it("counts consider as coverage while status still requires a recommend", () => {
    const criteria = [criterion({ id: "a" })];
    const candidates = [candidate("consider", ["a"])];
    expect(criterionCoverage(candidates, criteria)).toEqual({ a: true });
    expect(shortlistStatus(candidates, criteria)).toBe("partial");
  });

  it("ignores avoid candidates", () => {
    const criteria = [criterion({ id: "a" })];
    const candidates = [candidate("avoid", ["a"])];
    expect(criterionCoverage(candidates, criteria)).toEqual({ a: false });
    expect(shortlistStatus(candidates, criteria)).toBe("inconclusive");
  });
});
