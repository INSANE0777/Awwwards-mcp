// v2 motion group: runtime motion fingerprint, scroll census and hover census.
// Not registered in the 1.x surface. Exactly one branch per request; every
// branch object is strict so cross-branch fields fail validation.
import { z } from "zod";
import type { Handlers, ToolResponse } from "../server.js";
import { asMcpResult, viewportSchema, type ToolContext } from "../tools/shared.js";

export const analyzeMotionRequestSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("dna"),
      url: z.string().url().describe("Absolute site URL"),
      recapture: z
        .boolean()
        .default(false)
        .describe("Force a fresh live capture even if a recent record exists"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("scroll"),
      url: z.string().url().describe("Absolute page URL to census"),
      // Inline optional enum, not waitStrategySchema: that schema's .default("load")
      // would shadow the handler's own networkidle default.
      waitStrategy: z
        .enum(["load", "networkidle"])
        .optional()
        .describe("'load' plus a settle works on heavy sites; 'networkidle' (default) waits for total quiet"),
      viewport: viewportSchema,
      reducedMotion: z
        .boolean()
        .default(false)
        .describe("Emulate prefers-reduced-motion: reduce for this capture"),
      scrubProbe: z
        .boolean()
        .optional()
        .describe("drive the page through up to 8 scroll steps and sample each scrubbed trigger's progress curve"),
      compact: z
        .boolean()
        .optional()
        .describe("token-diet summary: keyframes/props/durations and scrubCurves replaced by counts"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("hover"),
      url: z.string().url().describe("Absolute page URL to census"),
      // Inline optional enum, not waitStrategySchema: see scroll branch.
      waitStrategy: z
        .enum(["load", "networkidle"])
        .optional()
        .describe("'load' plus a settle works on heavy sites; 'networkidle' (default) waits for total quiet"),
      viewport: viewportSchema,
      reducedMotion: z
        .boolean()
        .default(false)
        .describe("Emulate prefers-reduced-motion: reduce for this capture"),
      compact: z
        .boolean()
        .optional()
        .describe("token-diet summary: sample style bodies become a selector list + count"),
    })
    .strict(),
]);

export type AnalyzeMotionRequest = z.infer<typeof analyzeMotionRequestSchema>;

export const analyzeMotionInputSchema = z
  .object({
    request: analyzeMotionRequestSchema.describe(
      "Exactly one motion operation; choose kind and its branch fields",
    ),
  })
  .strict();

export async function runAnalyzeMotion(
  handlers: Handlers,
  request: AnalyzeMotionRequest,
): Promise<ToolResponse> {
  switch (request.kind) {
    case "dna":
      return handlers.get_motion_dna({
        url: request.url,
        recapture: request.recapture,
      });
    case "scroll":
      return handlers.analyze_scroll_map({
        url: request.url,
        ...(request.waitStrategy !== undefined ? { waitStrategy: request.waitStrategy } : {}),
        viewport: request.viewport,
        reducedMotion: request.reducedMotion,
        ...(request.scrubProbe !== undefined ? { scrubProbe: request.scrubProbe } : {}),
        ...(request.compact !== undefined ? { compact: request.compact } : {}),
      });
    case "hover":
      return handlers.analyze_hover_census({
        url: request.url,
        ...(request.waitStrategy !== undefined ? { waitStrategy: request.waitStrategy } : {}),
        viewport: request.viewport,
        reducedMotion: request.reducedMotion,
        ...(request.compact !== undefined ? { compact: request.compact } : {}),
      });
    default: {
      const exhaustive: never = request;
      throw new Error(`unhandled analyze_motion request: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export function registerAnalyzeMotion(ctx: ToolContext): void {
  ctx.tool(
    "analyze_motion",
    "Runtime motion analysis of a live page in one place. Choose exactly one request.kind: dna (motion fingerprint: animation stack, scroll/pin/scrub counts, easing vocabulary and duration distribution; serves the cached corpus first and live-captures unseen URLs or when recapture=true), scroll (per-element scroll-animation census with triggers and optional scrub probes), or hover (:hover interaction census). dna reads the cached corpus before any live capture; scroll and hover always capture live.",
    analyzeMotionInputSchema,
    { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    (args: { request: AnalyzeMotionRequest }) =>
      asMcpResult(runAnalyzeMotion(ctx.handlers, args.request)),
  );
}
