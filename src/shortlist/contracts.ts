import { z } from "zod";
import type { PageStructure } from "../structure.js";
import type { StackFingerprint } from "../stack.js";
import type { MotionDna, SiteDetails } from "../types.js";

// Inputs for shortlist_references. The agent turns the brief into criteria;
// this module only enforces shape and limits. parseShortlistInput returns the
// normalized shape, so constraints always carry their defaults afterwards.

// Criterion ids are unique per call so surfacedBy and coverage never merge two
// different requirements under one id. surfacedBy contains criterion ids only;
// explicit seeds are marked with `seeded` so a criterion may itself be "seed".
//
// Only the design's explicit bounds are enforced here: criteria 1-6, tags max
// 5, seeds max 8, limit 3-5, brief 1-2000. Label/query/tag lengths are
// intentionally uncapped.
export const criterionSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
      .describe("Stable id (lowercase letters, digits, hyphens; max 64) used in surfacedBy."),
    label: z.string().min(1).describe("Human-readable criterion name shown in the dossier."),
    kind: z
      .enum(["must", "nice"])
      .describe("must = required for a recommend; nice = improves ranking only."),
    query: z
      .string()
      .min(1)
      .optional()
      .describe("Search text for Awwwards discovery; required unless tags are given."),
    tags: z
      .array(z.string().min(1))
      .max(5)
      .optional()
      .describe("Up to 5 search tags; required unless query is given."),
  })
  .describe("One ranking requirement the brief implies.")
  .refine((c) => Boolean(c.query) || Boolean(c.tags?.length), {
    message: "a criterion needs a query or tags",
  });

export const constraintsSchema = z
  .object({
    targetStack: z
      .enum(["vite", "astro", "next", "any"])
      .optional()
      .describe(
        "Build stack the rebuild targets; recorded as same/compatible/unknown, never used as a filter.",
      ),
    allow3d: z
      .enum(["none", "any"])
      .default("any")
      .describe(
        "none excludes sites with an allowlisted 3D library and marks canvas/raw WebGL as unverified; any keeps them.",
      ),
    motionBudget: z
      .enum(["minimal", "scroll", "expressive"])
      .default("expressive")
      .describe(
        "Upper motion ceiling: minimal = no measured ScrollTriggers, scrubs or pins; scroll = non-pinned scroll-linked motion; expressive = pins. Entrance/non-scroll motion is not measured.",
      ),
    excludeStacks: z
      .array(z.string().min(1))
      .optional()
      .describe('Stack names to exclude outright, e.g. ["webflow"].'),
  })
  .describe(
    "Optional build constraints: allow3d, excludeStacks and motionBudget exclude candidates; targetStack is only annotated.",
  );

export const shortlistInputSchema = z.object({
  brief: z
    .string()
    .min(1)
    .max(2000)
    .describe("Rebuild brief: what you are building, who it is for and the feel to match."),
  criteria: z
    .array(criterionSchema)
    .min(1)
    .max(6)
    .refine(
      (criteria) => new Set(criteria.map((criterion) => criterion.id)).size === criteria.length,
      { message: "criterion ids must be unique" },
    )
    .describe("Ranking requirements the brief implies, 1-6 entries with unique ids."),
  constraints: constraintsSchema.default({ allow3d: "any", motionBudget: "expressive" }),
  seeds: z
    .array(z.string().regex(/^[\w-]+$/))
    .max(8)
    .optional()
    .describe("Up to 8 Awwwards slugs to shortlist unconditionally; they skip discovery."),
  limit: z
    .number()
    .int()
    .min(3)
    .max(5)
    .default(5)
    .describe("Maximum references to return, 3-5 (default 5)."),
  viewport: z
    .enum(["desktop", "mobile"])
    .default("desktop")
    .describe("Viewport for screenshots, structure and motion evidence."),
  outDir: z
    .string()
    .min(1)
    .describe("Absolute path for shortlist.md/html/json and reference-decision.json."),
  // Motion-only refresh: re-capture motion DNA and bypass its cache. Site,
  // structure and a11y evidence keep their own TTLs and are reused.
  refresh: z
    .boolean()
    .default(false)
    .describe("Re-capture motion DNA and bypass only its cache; other evidence keeps its TTL."),
});

export type CriterionInput = z.infer<typeof criterionSchema>;
export type ShortlistDecision = "recommend" | "consider" | "avoid";
export type ShortlistStatus = "ok" | "partial" | "inconclusive";

// Optional because callers may pass a partial object straight to
// classifyCandidate; parseShortlistInput always fills allow3d and motionBudget.
export interface ShortlistConstraints {
  targetStack?: "vite" | "astro" | "next" | "any";
  allow3d?: "none" | "any";
  motionBudget?: "minimal" | "scroll" | "expressive";
  excludeStacks?: string[];
}

export interface ShortlistInput {
  brief: string;
  criteria: CriterionInput[];
  constraints: ShortlistConstraints;
  seeds?: string[];
  limit: number;
  viewport: "desktop" | "mobile";
  outDir: string;
  refresh: boolean;
}

export interface CandidateSeed {
  siteSlug: string;
  title: string;
  liveUrl: string | null;
  thumbnailPath?: string;
  /** Criterion ids that surfaced this site; explicit seeds start empty. */
  surfacedBy: string[];
  /** True when the caller supplied this slug in `seeds`. */
  seeded?: boolean;
  detail?: SiteDetails | null;
}

export interface CandidateEvidence {
  stack: StackFingerprint | null;
  structure: PageStructure | null;
  motion: MotionDna | null;
  a11y: {
    status: "available" | "unknown";
    /** Worst sampled pairs below 4.5:1; capped sample, not a WCAG large-text pass. */
    contrastWorstPairs?: number;
  };
  unknowns: string[];
}

export interface ShortlistCandidate {
  siteSlug: string;
  title: string;
  liveUrl: string | null;
  decision: ShortlistDecision;
  reason: string;
  /** Criterion ids that surfaced this site; empty for a standalone seed. */
  surfacedBy: string[];
  /** True when the caller supplied this slug in `seeds`. */
  seeded?: boolean;
  /** True when the screenshot proxy refused a subresource; decision evidence is unaffected. */
  screenshotBlocked?: boolean;
  threeD: { detected: boolean; libraries: string[]; canvas: boolean };
  motionLevel: "minimal" | "scroll" | "expressive" | "unknown";
  stackFit: "same" | "compatible" | "unknown";
  evidence: CandidateEvidence;
  /** Task 3 rewrites these to assets/<flat-name>; ArtifactAsset.name must match the flat name. */
  artifacts: { thumbnail?: string; fullPage?: string; screenshot?: string };
}

export interface ShortlistResult {
  status: ShortlistStatus;
  brief: string;
  /** Capture profile used for screenshots, structure and motion evidence. */
  viewport: "desktop" | "mobile";
  criteria: Array<{ id: string; label: string; kind: "must" | "nice"; covered: boolean }>;
  candidates: ShortlistCandidate[];
  excluded: Array<{ siteSlug: string; reason: string }>;
  artifacts: {
    markdown: string;
    html: string;
    json: string;
    decision: string;
    decisionNew?: string;
  };
  limitations: string[];
}

export function parseShortlistInput(input: unknown): ShortlistInput | null {
  const parsed = shortlistInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
