// v2 awards: Awwwards taxonomy and the official Annual Awards only. Not
// registered in the 1.x tool surface. Exactly one branch per request; every
// branch object is strict so cross-branch fields fail validation instead of
// being silently ignored.
import { z } from "zod";
import type { Handlers, ToolResponse } from "../server.js";
import { asMcpResult, type ToolContext } from "../tools/shared.js";

export const browseAwardsRequestSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("filters"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("annual_categories"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("annual_nominees"),
      category: z
        .string()
        .min(1)
        .describe("Category slug from browse_awards (kind=annual_categories), e.g. 'site-of-the-year'"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(20)
        .default(10)
        .describe("Nominees to hydrate in this call (max 20)"),
      offset: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe("Zero-based nominee offset within the category"),
      hydrate: z
        .boolean()
        .default(true)
        .describe("Hydrate uncached nominees (1 req/s); false returns cached entries plus id stubs"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("annual_nominee"),
      id: z
        .string()
        .min(1)
        .optional()
        .describe("Nominee UUID or full /api/annual/nominees/sites|users/<uuid> path"),
      category: z.string().min(1).optional().describe("Category slug, for slug-based lookup"),
      slug: z.string().min(1).optional().describe("Nominee slug, paired with category"),
    })
    .strict(),
]);

export type BrowseAwardsRequest = z.infer<typeof browseAwardsRequestSchema>;

export const browseAwardsInputSchema = z
  .object({
    request: browseAwardsRequestSchema.describe(
      "Exactly one awards operation; choose kind and its branch fields",
    ),
  })
  .strict();

export async function runBrowseAwards(
  handlers: Handlers,
  request: BrowseAwardsRequest,
): Promise<ToolResponse> {
  switch (request.kind) {
    case "filters":
      return handlers.list_categories();
    case "annual_categories":
      return handlers.get_annual_categories();
    case "annual_nominees":
      return handlers.get_annual_nominees({
        category: request.category,
        limit: request.limit,
        offset: request.offset,
        hydrate: request.hydrate,
      });
    case "annual_nominee":
      return handlers.get_annual_nominee({
        ...(request.id !== undefined ? { id: request.id } : {}),
        ...(request.category !== undefined ? { category: request.category } : {}),
        ...(request.slug !== undefined ? { slug: request.slug } : {}),
      });
    default: {
      const exhaustive: never = request;
      throw new Error(`unhandled browse_awards request: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export function registerBrowseAwards(ctx: ToolContext): void {
  ctx.tool(
    "browse_awards",
    "Awwwards taxonomy and the official Annual Awards only — not the daily site index (use search_references for that). Choose exactly one request.kind: filters (award collections, color hexes, tag/technology slugs and annual categories usable as filters), annual_categories (official Annual Awards categories with nominee counts), annual_nominees (one category's nominees, hydrated on demand at 1 request/second) or annual_nominee (one nominee by id, or category+slug). There is no all mode: exactly one kind per call.",
    browseAwardsInputSchema,
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    (args: { request: BrowseAwardsRequest }) =>
      asMcpResult(runBrowseAwards(ctx.handlers, args.request)),
  );
}
