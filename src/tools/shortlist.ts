import { shortlistInputSchema } from "../shortlist/contracts.js";
import { asMcpResult, type ToolContext } from "./shared.js";

export function registerShortlistReferences(ctx: ToolContext): void {
  ctx.registerTool(
    "shortlist_references",
    {
      description:
        "Turn a rebuild brief and structured criteria into up to 5 Awwwards references with rebuild evidence, explicit unknowns and a local review dossier. Probes live Awwwards sites and uses optional Playwright for structure, motion and screenshots; missing browser evidence is reported as unknown or partial. The dossier stays local with no hosting, no telemetry, no taste score and no hosted board. Writes shortlist.md/html/json and reference-decision.json; outDir must be absolute. targetStack is an annotation (same/compatible/unknown), never a filter.",
      inputSchema: shortlistInputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    (args: any) => asMcpResult(ctx.handlers.shortlist_references(args)),
  );
}
