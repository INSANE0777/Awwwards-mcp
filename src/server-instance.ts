// Per-connection server factory. serveStdio calls it once per era selection: a
// modern probe that falls back to a legacy opening discards the first instance
// and builds a second, so nothing here may be module-level state.
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Handlers } from "./server.js";
import { registerGuarded } from "./tool-profile.js";
import { registerAllTools } from "./tools/index.js";

export interface ServerOptions {
  handlers: Handlers;
  version: string;
}

/** A fresh McpServer with all 39 tools registered. */
export function createServer({ handlers, version }: ServerOptions): McpServer {
  const server = new McpServer({ name: "awwwards-mcp", version });

  // Every registration goes through the guard: AWWWARDS_MCP_PROFILE=core skips
  // non-core tools, AWWWARDS_MCP_MAX_RESPONSE_BYTES caps text+image payloads, and
  // AWWWARDS_MCP_DEBUG_MEMORY=1 logs one JSON line per call on stderr. The
  // legacy AWARDS_MCP_* names are accepted as a one-release fallback.
  const tool = ((name: string, description: string, inputSchema: any, annotations: any, handler: any) =>
    registerGuarded(server, "registerTool", [
      name,
      {
        description,
        // v2 registerTool wants a z.object, while the tool modules still pass
        // raw field shapes (the v1 style). Accept both.
        inputSchema: inputSchema instanceof z.ZodType ? inputSchema : z.object(inputSchema),
        annotations,
      },
      handler,
    ])) as unknown as (...args: any[]) => void;
  const registerTool = ((...args: any[]) =>
    registerGuarded(server, "registerTool", args)) as unknown as McpServer["registerTool"];
  registerAllTools({ handlers, tool, registerTool });

  return server;
}
