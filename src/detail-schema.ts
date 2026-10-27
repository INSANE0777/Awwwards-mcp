import { z } from "zod";

// get_site_details user-facing contract: exactly one of slug or slugs, at most
// 10 distinct slugs (case-insensitive). The handler repeats these checks
// because direct handler calls bypass the MCP schema layer.
export const detailArgsSchema = z
  .object({
    slug: z
      .string()
      .regex(/^[\w-]+$/)
      .optional()
      .describe("Site slug from search_sites, e.g. 'l-i-s-a'. Provide exactly one of slug or slugs"),
    slugs: z
      .array(z.string().regex(/^[\w-]+$/))
      .min(1)
      .max(10)
      .refine(
        (slugs) => new Set(slugs.map((slug) => slug.toLowerCase())).size === slugs.length,
        "Site slugs must be distinct",
      )
      .optional()
      .describe(
        "1–10 distinct site slugs for a bounded batch: ordered compact details per slug, cached/fetched/error status, no images",
      ),
    compact: z.boolean().optional()
      .describe("token-diet summary: palette/technologies/elements become counts; awards and jury numerics stay"),
  })
  .refine((args) => (args.slug === undefined) !== (args.slugs === undefined), {
    message: "Provide exactly one of slug or slugs",
  });
