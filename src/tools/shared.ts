import type { McpServer, CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Handlers, ToolResponse } from "../server.js";

// The handlers return ToolResponse, which is structurally identical to the
// SDK's CallToolResult at runtime ({ content, isError? }). CallToolResult's
// schema additionally carries a [k: string]: unknown index signature that a
// TypeScript interface cannot satisfy implicitly, so a cast bridges the two.
export const asMcpResult = (p: Promise<ToolResponse>): Promise<CallToolResult> =>
  p as unknown as Promise<CallToolResult>;

// Shared by capture_live_site, analyze_page_structure and record_site_motion.
export const waitStrategySchema = z
  .enum(["load", "networkidle"])
  .default("load")
  .describe("'load' + settle works on heavy sites; 'networkidle' waits for total quiet");

export const viewportSchema = z
  .enum(["desktop", "mobile"])
  .default("desktop")
  .describe(
    "desktop = 1440x900 (default); mobile = 390x844 iPhone-class with deviceScaleFactor 3, isMobile + hasTouch",
  );

export interface ToolContext {
  handlers: Handlers;
  tool: (...args: any[]) => void;
  registerTool: (...args: any[]) => void;
}
