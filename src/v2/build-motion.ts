// v2 pilot: consolidated offline builder. Not registered in the 1.x tool
// surface. Exactly one branch per request; every branch object is strict so
// cross-branch fields fail validation instead of being silently ignored.
import { z } from "zod";
import type { Handlers, ToolResponse } from "../server.js";
import { asMcpResult, type ToolContext } from "../tools/shared.js";

export const buildMotionRequestSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("pose_stub"),
      poseGrid: z.any().describe("PoseGrid object as returned by capture_page (kind=pose; id pose-grid-v1)"),
      scrollCensus: z
        .any()
        .optional()
        .describe("Optional full ScrollCensus from analyze_motion (kind=scroll, compact=false)"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("gsap_stub"),
      scrollCensus: z
        .any()
        .describe(
          "Full ScrollCensus JSON from analyze_motion (kind=scroll): anims[] + gsapTriggers[] required; compact census output is rejected",
        ),
      poseGrid: z.any().optional().describe("Optional PoseGrid JSON from capture_page (kind=pose)"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("manifest"),
      bands: z.any().describe("inspect_page (kind=structure) result (must carry bands[])"),
      scrollCensus: z
        .any()
        .describe(
          "Full analyze_motion (kind=scroll, compact=false) result: anims[] + gsapTriggers[] required; compact census output is rejected",
        ),
      sections: z
        .array(z.object({ label: z.string().min(1), selector: z.string().optional() }))
        .max(60)
        .optional()
        .describe("Optional section overrides in build order"),
    })
    .strict(),
]);

export type BuildMotionRequest = z.infer<typeof buildMotionRequestSchema>;

export const buildMotionInputSchema = z
  .object({
    request: buildMotionRequestSchema.describe(
      "Exactly one build operation; choose kind and its branch fields",
    ),
  })
  .strict();

export async function runBuildMotion(
  handlers: Handlers,
  request: BuildMotionRequest,
): Promise<ToolResponse> {
  switch (request.kind) {
    case "pose_stub":
      return handlers.build_pose_stub({
        poseGrid: request.poseGrid,
        ...(request.scrollCensus !== undefined ? { scrollCensus: request.scrollCensus } : {}),
      });
    case "gsap_stub":
      return handlers.build_gsap_stub({
        scrollCensus: request.scrollCensus,
        ...(request.poseGrid !== undefined ? { poseGrid: request.poseGrid } : {}),
      });
    case "manifest":
      return handlers.build_motion_manifest({
        bands: request.bands,
        scrollCensus: request.scrollCensus,
        ...(request.sections ? { sections: request.sections } : {}),
      });
    default: {
      const exhaustive: never = request;
      throw new Error(`unhandled build_motion request: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export function registerBuildMotion(ctx: ToolContext): void {
  ctx.tool(
    "build_motion",
    "Generate motion scaffolding from captured evidence. Choose exactly one request.kind: pose_stub (standalone three.js scroll stub from a PoseGrid, optional scroll census), gsap_stub (GSAP+ScrollTrigger timeline stub from a scroll census, optional PoseGrid), or manifest (motion.manifest.json scaffold from page bands + scroll census, optional section overrides). Pure and offline: no page fetches and no project files. Use build_project to convert a local HTML rebuild into a framework project.",
    buildMotionInputSchema,
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    (args: { request: BuildMotionRequest }) =>
      asMcpResult(runBuildMotion(ctx.handlers, args.request)),
  );
}
