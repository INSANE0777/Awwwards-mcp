import type { MotionDna } from "../types.js";
import type { PageStructure } from "../structure.js";
import type { StackFingerprint } from "../stack.js";
import type {
  CandidateEvidence,
  CandidateSeed,
  CriterionInput,
  ShortlistCandidate,
  ShortlistConstraints,
  ShortlistStatus,
} from "./contracts.js";

const MOTION_ORDER = { minimal: 0, scroll: 1, expressive: 2 } as const;

const STACK_ALIASES: Record<string, string> = {
  "next.js": "next",
  nextjs: "next",
  "next-js": "next",
  "nuxt.js": "nuxt",
  nuxtjs: "nuxt",
  "nuxt-js": "nuxt",
  "astro.build": "astro",
  "webflow.com": "webflow",
};

function normalizeStackName(value: string): string {
  const key = value.trim().toLowerCase();
  return STACK_ALIASES[key] ?? key;
}

// True 3D engines only. webgl is not proof (motion-dna adds it for any canvas),
// and pixi/rive are 2D. Keep this list narrow; see threeDSignal's residual note.
export const THREE_D_LIBS: ReadonlySet<string> = new Set([
  "three",
  "three.js",
  "three-js",
  "babylon",
  "babylon.js",
  "babylonjs",
  "playcanvas",
  "regl",
  "ogl",
  "@react-three/fiber",
  "react-three-fiber",
  "spline",
  "aframe",
]);

export function motionLevel(
  dna: MotionDna | null,
): "minimal" | "scroll" | "expressive" | "unknown" {
  if (!dna?.scroll) return "unknown";
  const { triggerCount, scrubCount, pinCount } = dna.scroll;
  const counts = [triggerCount, scrubCount, pinCount];
  if (
    !counts.every(
      (count) => Number.isInteger(count) && count >= 0,
    )
  ) {
    return "unknown";
  }
  // minimal = no measured ScrollTriggers/scrubs/pins; scroll = non-pinned
  // scroll-linked motion; expressive = at least one pin. Entrance/non-scroll
  // motion is not measured, so a page with none of these counts is minimal.
  if (pinCount > 0) return "expressive";
  if (scrubCount > 0 || triggerCount > 0) return "scroll";
  return "minimal";
}

// Gathers stack libs plus motion stack/render evidence because analyze_stack's
// HTML pass usually sees no libraries. Residual risk: a raw WebGL scene with no
// recognized 3D library and no full-canvas scroll mode is not detected here;
// the handler must record that as unknown/limitation, never claim 3D is absent.
export function threeDSignal(
  stack: StackFingerprint | null,
  structure: PageStructure | null,
  motion: MotionDna | null,
): { detected: boolean; libraries: string[]; canvas: boolean } {
  const raw = [
    ...(stack?.libs ?? []),
    ...(motion?.stack?.libs ?? []),
    ...(motion?.stack?.render ?? []),
  ];
  const libraries = [
    ...new Set(
      raw.map((lib) => lib.trim().toLowerCase()).filter((lib) => THREE_D_LIBS.has(lib)),
    ),
  ];
  const canvas = structure?.scrollMode === "canvas";
  return { detected: libraries.length > 0, libraries, canvas };
}

// targetStack is an annotation, never a filter. analyze_stack can prove
// Next/Astro but cannot see Vite or a static site, so those stay unknown.
// `compatible` means a different but known framework, not rebuild compatibility.
export function stackFit(
  targetStack: ShortlistConstraints["targetStack"],
  stack: StackFingerprint | null,
): "same" | "compatible" | "unknown" {
  const target = targetStack?.trim().toLowerCase();
  if (!target || target === "any" || target === "vite") return "unknown";
  if (!stack) return "unknown";
  const framework = stack.framework?.trim().toLowerCase() ?? "";
  if (!framework || framework === "static") return "unknown";
  return target === framework ? "same" : "compatible";
}

function covers(candidate: ShortlistCandidate, criterionId: string): boolean {
  return (
    candidate.decision !== "avoid" &&
    candidate.surfacedBy.includes(criterionId)
  );
}

export function classifyCandidate(args: {
  seed: CandidateSeed;
  evidence: CandidateEvidence;
  constraints: ShortlistConstraints;
}): ShortlistCandidate {
  const { seed, evidence, constraints } = args;
  const allow3d = constraints.allow3d ?? "any";
  const motionBudget = constraints.motionBudget ?? "expressive";
  // Computed from raw evidence only; callers cannot pre-set a pass.
  const threeD = threeDSignal(evidence.stack, evidence.structure, evidence.motion);
  const level = motionLevel(evidence.motion);
  const fit = stackFit(constraints.targetStack, evidence.stack);
  const framework = evidence.stack?.framework
    ? normalizeStackName(evidence.stack.framework)
    : undefined;
  const excluded = (constraints.excludeStacks ?? []).map(normalizeStackName);
  // Copy rather than mutate: the caller's evidence must stay untouched.
  const baseEvidence = seed.liveUrl
    ? evidence
    : {
        ...evidence,
        unknowns: evidence.unknowns.includes("liveUrl")
          ? evidence.unknowns
          : [...evidence.unknowns, "liveUrl"],
      };
  const effectiveEvidence =
    level === "minimal" && !baseEvidence.unknowns.includes("motion-unmeasured")
      ? {
          ...baseEvidence,
          unknowns: [...baseEvidence.unknowns, "motion-unmeasured"],
        }
      : baseEvidence;

  const build = (
    decision: ShortlistCandidate["decision"],
    reason: string,
  ): ShortlistCandidate => ({
    siteSlug: seed.siteSlug,
    title: seed.title,
    liveUrl: seed.liveUrl,
    decision,
    reason,
    surfacedBy: [...seed.surfacedBy],
    ...(seed.seeded ? { seeded: true } : {}),
    threeD,
    motionLevel: level,
    stackFit: fit,
    evidence: effectiveEvidence,
    artifacts: seed.thumbnailPath ? { thumbnail: seed.thumbnailPath } : {},
  });

  const unverified3d = evidence.unknowns.includes("3d-unverified");
  const unverifiedSources = [
    ...(threeD.canvas ? ["canvas scroll mode"] : []),
    ...(unverified3d ? ["raw WebGL"] : []),
  ];

  if (allow3d === "none" && threeD.detected) {
    return build(
      "avoid",
      `3D detected (${threeD.libraries.join(", ")}); allow3d is none.`,
    );
  }
  if (framework && excluded.includes(framework)) {
    return build("avoid", `Stack ${framework} is excluded by excludeStacks.`);
  }
  if (level !== "unknown" && MOTION_ORDER[level] > MOTION_ORDER[motionBudget]) {
    return build("avoid", `Motion is ${level}, over the ${motionBudget} budget.`);
  }
  if (allow3d === "none" && unverifiedSources.length > 0) {
    return build(
      "consider",
      `3D state unverified (${unverifiedSources.join(", ")}, 3D unverified); allow3d:none cannot be proven.`,
    );
  }
  if (!seed.liveUrl) {
    return build("consider", "No live URL, so live evidence cannot be measured.");
  }
  if (!evidence.stack) {
    return build("consider", "Stack evidence is missing, so hard constraints are unproven.");
  }
  if (!evidence.structure) {
    return build(
      "consider",
      "Structure evidence is missing, so the 3D/canvas signal is unproven.",
    );
  }
  if (!evidence.motion || level === "unknown") {
    return build(
      "consider",
      evidence.motion
        ? "Motion level is unknown, so the motion budget is unproven."
        : "Motion evidence is missing, so the motion budget is unproven.",
    );
  }

  const threeDNote = threeD.detected
    ? `3D detected (${threeD.libraries.join(", ")})`
    : threeD.canvas
      ? "canvas scroll mode, 3D unverified"
      : unverified3d
        ? "raw WebGL, 3D unverified"
        : "no recognized 3D library or canvas scroll mode";
  const motionNote =
    level === "minimal"
      ? "none measured (ScrollTrigger/scrub/pin scan only; bundled or CSS/IO motion not measured)"
      : level;
  if (level === "minimal") {
    return build(
      "recommend",
      `No measured hard-constraint failure; motion ${motionNote}.`,
    );
  }
  return build(
    "recommend",
    `Hard constraints clear: ${threeDNote}; stack ${framework ?? "unknown"}; motion ${motionNote}.`,
  );
}

// One coverage rule for status and artifacts: avoid never covers, and a
// candidate covers only criteria whose ids are in surfacedBy.
export function criterionCoverage(
  candidates: ShortlistCandidate[],
  criteria: CriterionInput[],
): Record<string, boolean> {
  const coverage: Record<string, boolean> = {};
  for (const criterion of criteria) {
    coverage[criterion.id] = candidates.some((candidate) =>
      covers(candidate, criterion.id),
    );
  }
  return coverage;
}

export function shortlistStatus(
  candidates: ShortlistCandidate[],
  criteria: CriterionInput[],
): ShortlistStatus {
  if (candidates.length === 0) return "inconclusive";
  if (candidates.every((candidate) => candidate.decision === "avoid")) return "inconclusive";

  const musts = criteria.filter((criterion) => criterion.kind === "must");
  if (musts.length === 0) {
    return candidates.some((candidate) => candidate.decision === "recommend")
      ? "ok"
      : "partial";
  }

  const coverage = criterionCoverage(candidates, criteria);
  let allRecommended = true;
  for (const must of musts) {
    if (!coverage[must.id]) return "inconclusive";
    const recommended = candidates.some(
      (candidate) => candidate.decision === "recommend" && covers(candidate, must.id),
    );
    if (!recommended) allRecommended = false;
  }
  return allRecommended ? "ok" : "partial";
}
