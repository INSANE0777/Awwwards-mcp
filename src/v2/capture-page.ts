// v2 capture group: screenshot, component pack, pose grid and motion recording.
// Not registered in the 1.x surface. Exactly one branch per request; every
// branch object is strict so cross-branch fields fail validation.
import { z } from "zod";
import type { Handlers, ToolResponse } from "../server.js";
import { asMcpResult, viewportSchema, waitStrategySchema, type ToolContext } from "../tools/shared.js";

export const capturePageRequestSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("screenshot"),
      url: z.string().url().describe("Absolute URL of the site to capture"),
      waitStrategy: waitStrategySchema,
      viewport: viewportSchema,
      inline: z
        .boolean()
        .optional()
        .describe("false omits the inline base64 preview (file is still saved)"),
      maxInlineBytes: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Byte budget for the inline base64 preview (default 2500000)"),
      waitForOverlay: z
        .boolean()
        .default(true)
        .describe("wait up to 10s for a full-screen fixed preloader to clear; false captures immediately"),
      scrollCapture: z
        .enum(["auto", "anchors", "viewport"])
        .default("auto")
        .describe(
          'inner-scroller pages: "auto"/"anchors" saves 6 ordered viewport screenshots; "viewport" saves one; document-scrolling pages keep the single full-page capture',
        ),
    })
    .strict(),
  z
    .object({
      kind: z.literal("component"),
      url: z.string().url().describe("Absolute page URL whose component to serialize"),
      selector: z
        .string()
        .min(1)
        .optional()
        .describe("CSS selector of the component root (default 'header')"),
      maxNodes: z.number().int().min(50).max(2000).optional()
        .describe("Max DOM nodes to serialize (default 400, clamp 50-2000)"),
      viewport: viewportSchema,
      compact: z
        .boolean()
        .optional()
        .describe("token-diet summary: node styles/text/svg/anims and typography/paletteSummary are dropped"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("pose"),
      url: z.string().url().describe("Absolute page URL to capture (https:// or file://)"),
      steps: z.number().int().min(3).max(10).optional()
        .describe("Scroll samples across the page (default 6)"),
      viewport: viewportSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("recording"),
      url: z.string().url().describe("Absolute URL of the site to record"),
      frames: z
        .number()
        .int()
        .min(4)
        .max(36)
        .default(16)
        .describe("Filmstrip tile count (default 16 → a 4x4 grid)"),
      waitStrategy: waitStrategySchema,
      viewport: viewportSchema,
    })
    .strict(),
]);

export type CapturePageRequest = z.infer<typeof capturePageRequestSchema>;

export const capturePageInputSchema = z
  .object({
    request: capturePageRequestSchema.describe(
      "Exactly one capture operation; choose kind and its branch fields",
    ),
  })
  .strict();

export async function runCapturePage(
  handlers: Handlers,
  request: CapturePageRequest,
): Promise<ToolResponse> {
  switch (request.kind) {
    case "screenshot":
      return handlers.capture_live_site({
        url: request.url,
        waitStrategy: request.waitStrategy,
        viewport: request.viewport,
        ...(request.inline !== undefined ? { inline: request.inline } : {}),
        ...(request.maxInlineBytes !== undefined ? { maxInlineBytes: request.maxInlineBytes } : {}),
        waitForOverlay: request.waitForOverlay,
        scrollCapture: request.scrollCapture,
      });
    case "component":
      return handlers.capture_component({
        url: request.url,
        ...(request.selector !== undefined ? { selector: request.selector } : {}),
        ...(request.maxNodes !== undefined ? { maxNodes: request.maxNodes } : {}),
        maxDepth: 12,
        viewport: request.viewport,
        ...(request.compact !== undefined ? { compact: request.compact } : {}),
      });
    case "pose":
      return handlers.capture_pose_3d({
        url: request.url,
        ...(request.steps !== undefined ? { steps: request.steps } : {}),
        viewport: request.viewport,
      });
    case "recording":
      return handlers.record_site_motion({
        url: request.url,
        frames: request.frames,
        waitStrategy: request.waitStrategy,
        viewport: request.viewport,
      });
    default: {
      const exhaustive: never = request;
      throw new Error(`unhandled capture_page request: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export function registerCapturePage(ctx: ToolContext): void {
  ctx.tool(
    "capture_page",
    "Capture the artifact needed for a rebuild. Choose exactly one request.kind: screenshot (full-page or inner-scroller anchors), component (portable component pack with structure, styles and animations), pose (WebGL/canvas pose grid for scroll-driven 3D), or recording (motion filmstrip video of preloader, scroll and hover). Component packs cap serialized tree depth at 12 (not configurable on this surface; depthCapped:true means deeper nodes were omitted) so the payload stays inside Code Mode's depth limit. Dependencies differ: all four need the optional Playwright dependency; recording also needs ffmpeg-static. This tool is not read-only: the recording branch can click interactive elements and submit their forms to expose hover/click motion.",
    capturePageInputSchema,
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    (args: { request: CapturePageRequest }) =>
      asMcpResult(runCapturePage(ctx.handlers, args.request)),
  );
}
