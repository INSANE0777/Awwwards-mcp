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

// Sent in `initialize`, so it is the first thing a client reads about this
// server. Guidance only: no tool behaviour depends on it.
export const SERVER_INSTRUCTIONS = `Awwwards MCP: design-reference discovery and page-analysis tools.

Full-profile loop: search_sites -> get_site_details (and get_site_elements) -> analyze_page_structure -> analyze_scroll_map / analyze_hover_census / get_motion_dna -> capture_component -> hand-rebuild the page into one HTML file -> build_project -> verify_build -> fix -> re-verify. Or render a build_pose_stub / build_gsap_stub / build_motion_manifest from the captured evidence. verify_flow compares interaction steps.

Choose tools by domain:
- Sites: search_sites (index, filters, FTS) vs search_directory (agencies) vs search_elements (UI components) vs get_collections (moodboards) vs get_annual_* (Annual Awards).
- One site: get_site_details (design DNA) vs get_site_elements (component visuals) vs create_design_brief (synthesized direction from 2-5 slugs).
- Motion: get_motion_dna (runtime fingerprint) vs analyze_scroll_map (per-element scroll census) vs analyze_hover_census (hover states) vs search_motion (cached corpus only).
- Build vs verify: build_project converts a local HTML rebuild into Vite/Astro/Next; verify_build scores a build against a reference; verify_flow compares interaction steps; build_pose_stub, build_gsap_stub and build_motion_manifest are pure/offline builders.
- Evidence tools (audit_url, analyze_accessibility, analyze_images, analyze_stack, analyze_bundle, analyze_network_capture) report evidence, not grades; read coverage/error fields before trusting numbers.

AWWWARDS_MCP_PROFILE=core exposes 12 core tools for the build loop and its discovery helpers; the default full profile exposes the complete set. Optional browser tools need Playwright; audit_url uses an installed Chrome/Edge over CDP instead, and record_site_motion also needs ffmpeg-static. Awwwards requests are rate-limited and cached.`;

/** A fresh McpServer with all 39 tools registered. */
export function createServer({ handlers, version }: ServerOptions): McpServer {
  const server = new McpServer(
    { name: "awwwards-mcp", version },
    { instructions: SERVER_INSTRUCTIONS },
  );

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
