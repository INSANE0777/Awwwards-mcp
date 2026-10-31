// v2 monitor group: winner polling and watchlist state. Not registered in the
// 1.x surface. The union is keyed on action because kind is the watch kind.
// Every branch object is strict so cross-branch fields fail validation.
import { z } from "zod";
import type { Handlers, ToolResponse } from "../server.js";
import { asMcpResult, type ToolContext } from "../tools/shared.js";

export const monitorAwardsRequestSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("poll_winners"),
      award: z
        .enum(["sotd", "developer", "honorable"])
        .default("sotd")
        .describe("Which winners feed to poll"),
    })
    .strict(),
  z
    .object({
      action: z.literal("add_watch"),
      kind: z.enum(["studio", "tag", "url"]).describe("What the pattern identifies"),
      pattern: z.string().describe("Studio name, tag slug or site URL-slug to watch"),
      award: z
        .enum(["sotd", "developer", "honorable"])
        .optional()
        .describe("Winners feed to watch"),
      note: z.string().optional().describe("Optional reminder note"),
    })
    .strict(),
  z.object({ action: z.literal("list_watches") }).strict(),
  z
    .object({
      action: z.literal("remove_watch"),
      kind: z.enum(["studio", "tag", "url"]).describe("What the pattern identifies"),
      pattern: z.string().describe("Studio name, tag slug or site URL-slug to stop watching"),
    })
    .strict(),
]);

export type MonitorAwardsRequest = z.infer<typeof monitorAwardsRequestSchema>;

export const monitorAwardsInputSchema = z
  .object({
    request: monitorAwardsRequestSchema.describe(
      "Exactly one monitor operation; choose action and its branch fields",
    ),
  })
  .strict();

export async function runMonitorAwards(
  handlers: Handlers,
  request: MonitorAwardsRequest,
): Promise<ToolResponse> {
  switch (request.action) {
    case "poll_winners":
      return handlers.new_winners({ award: request.award });
    case "add_watch":
      return handlers.watch_site({
        action: "add",
        kind: request.kind,
        pattern: request.pattern,
        ...(request.award !== undefined ? { award: request.award } : {}),
        ...(request.note !== undefined ? { note: request.note } : {}),
      });
    case "list_watches":
      return handlers.watch_site({ action: "list" });
    case "remove_watch":
      return handlers.watch_site({
        action: "remove",
        kind: request.kind,
        pattern: request.pattern,
      });
    default: {
      const exhaustive: never = request;
      throw new Error(`unhandled monitor_awards request: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export function registerMonitorAwards(ctx: ToolContext): void {
  ctx.tool(
    "monitor_awards",
    "Ongoing Awwwards winner discovery and watch state. Choose exactly one request.action: poll_winners (new-entrant delta against the previous poll; the first call seeds the baseline and writes it), add_watch, list_watches (report deltas from the freshest cached listing, no fetch), or remove_watch. poll_winners writes the poll baseline and add/remove mutate the watchlist, so this tool is not read-only.",
    monitorAwardsInputSchema,
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    (args: { request: MonitorAwardsRequest }) =>
      asMcpResult(runMonitorAwards(ctx.handlers, args.request)),
  );
}
