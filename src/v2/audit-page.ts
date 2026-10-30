// v2 audit group: performance, accessibility, image delivery and bundle
// forensics. Not registered in the 1.x surface. Exactly one branch per
// request; every branch object is strict so cross-branch fields fail.
import { z } from "zod";
import type { Handlers, ToolResponse } from "../server.js";
import { asMcpResult, viewportSchema, type ToolContext } from "../tools/shared.js";

export const auditPageRequestSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("performance"),
      url: z.string().url().describe("Absolute http(s) URL of the page to audit"),
      viewport: z
        .enum(["desktop", "mobile"])
        .default("desktop")
        .describe("Runtime measurement geometry: desktop = 1280x800 (aegon baseline); mobile = 390x844"),
      timeoutMs: z
        .number()
        .int()
        .min(1000)
        .max(30000)
        .default(10000)
        .describe("Per static request timeout in ms (page HTML + each asset)"),
      compact: z
        .boolean()
        .optional()
        .describe("compact=true returns reduced perf, pre-cap antiPatterns counts, coverage and nextActions"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("accessibility"),
      url: z.string().url().describe("Absolute http(s) URL of the page to inspect"),
      viewport: viewportSchema,
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .default(100)
        .describe("Text-node sample cap (1-200)"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("images"),
      url: z.string().url().describe("Absolute page URL to audit"),
      viewport: viewportSchema,
      maxImages: z
        .number()
        .int()
        .min(1)
        .max(500)
        .default(200)
        .describe("Max images scanned in document order (default 200, max 500)"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("bundle"),
      url: z.string().url().describe("Absolute page URL whose script chunks to inspect"),
      keywords: z
        .array(z.string().min(1))
        .max(20)
        .optional()
        .describe("grep these strings across chunks (e.g. class names, effect names)"),
      maxChunks: z.number().int().min(1).max(100).optional().describe("default 40"),
      walkChunks: z
        .boolean()
        .optional()
        .describe("follow quoted same-origin .js refs inside fetched chunks and fetch up to 20 newly discovered ones"),
      edges: z.boolean().default(false).describe("static import graph over captured chunks"),
      bundleIntel: z
        .boolean()
        .default(false)
        .describe("opt-in route, vendor, source-map presence and module-graph evidence"),
    })
    .strict(),
]);

export type AuditPageRequest = z.infer<typeof auditPageRequestSchema>;

export const auditPageInputSchema = z
  .object({
    request: auditPageRequestSchema.describe(
      "Exactly one audit operation; choose kind and its branch fields",
    ),
  })
  .strict();

export async function runAuditPage(
  handlers: Handlers,
  request: AuditPageRequest,
): Promise<ToolResponse> {
  switch (request.kind) {
    case "performance":
      return handlers.audit_url({
        url: request.url,
        viewport: request.viewport,
        timeoutMs: request.timeoutMs,
        ...(request.compact !== undefined ? { compact: request.compact } : {}),
      });
    case "accessibility":
      return handlers.analyze_accessibility({
        url: request.url,
        viewport: request.viewport,
        limit: request.limit,
      });
    case "images":
      return handlers.analyze_images({
        url: request.url,
        viewport: request.viewport,
        maxImages: request.maxImages,
      });
    case "bundle":
      return handlers.analyze_bundle({
        url: request.url,
        ...(request.keywords !== undefined ? { keywords: request.keywords } : {}),
        ...(request.maxChunks !== undefined ? { maxChunks: request.maxChunks } : {}),
        ...(request.walkChunks !== undefined ? { walkChunks: request.walkChunks } : {}),
        edges: request.edges,
        bundleIntel: request.bundleIntel,
      });
    default: {
      const exhaustive: never = request;
      throw new Error(`unhandled audit_page request: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export function registerAuditPage(ctx: ToolContext): void {
  ctx.tool(
    "audit_page",
    "Audit a live page as evidence, not a grade. Choose exactly one request.kind: performance (runtime frame/long-task/layout-thrash measurement plus static animation anti-patterns), accessibility (contrast, alt, heading, focus and form-label evidence census), images (delivery formats, loading, responsiveness and issue samples), or bundle (script chunks, optional de-obfuscation and keyword grep). Acquisition and dependencies differ: performance uses installed Chrome/Edge over raw CDP, accessibility needs Playwright, images needs Playwright, and bundle fetches chunks with no browser.",
    auditPageInputSchema,
    { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    (args: { request: AuditPageRequest }) =>
      asMcpResult(runAuditPage(ctx.handlers, args.request)),
  );
}
