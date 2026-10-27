import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CORE_TOOL_NAMES,
  DEFAULT_MAX_RESPONSE_BYTES,
  isCoreTool,
  registerGuarded,
} from "../src/tool-profile.js";

type Registration = { name: string; handler?: (...args: any[]) => any };

function fakeServer() {
  const regs: Registration[] = [];
  const record = (args: any[]) => {
    const handler = args[args.length - 1];
    regs.push({ name: String(args[0]), handler: typeof handler === "function" ? handler : undefined });
  };
  return { server: { tool: (...args: any[]) => record(args), registerTool: (...args: any[]) => record(args) }, regs };
}

// cli.ts connects to stdio on import, so the registration contract is read
// from source: every tool name must go through the guarded wrapper.
function cliToolNames(): string[] {
  const src = readFileSync(join(__dirname, "../src/cli.ts"), "utf8");
  return [...src.matchAll(/^(?:tool|registerTool)\(\n  "([a-z0-9_]+)"/gm)].map((m) => m[1]);
}

describe("tool profile", () => {
  it("core profile registers only the 12 core tools and skips the rest", () => {
    const { server, regs } = fakeServer();
    const env = { AWARDS_MCP_PROFILE: "core" };
    const handler = async () => ({ content: [] });
    for (const name of CORE_TOOL_NAMES) {
      registerGuarded(server as any, "tool", [name, "d", {}, {}, handler], env);
    }
    registerGuarded(server as any, "tool", ["compare_sites", "d", {}, {}, handler], env);
    registerGuarded(server as any, "registerTool", ["verify_flow", "d", {}, {}, handler], env);

    expect(regs.map((r) => r.name)).toEqual([...CORE_TOOL_NAMES]);
    expect(isCoreTool("search_sites", env)).toBe(true);
    expect(isCoreTool("compare_sites", env)).toBe(false);
    expect(isCoreTool("compare_sites", {})).toBe(true); // full is the default
    expect(isCoreTool("compare_sites", { AWARDS_MCP_PROFILE: "full" })).toBe(true);
  });

  it("full profile (default) registers all 37 tools, unchanged", () => {
    const names = cliToolNames();
    expect(names).toHaveLength(37);
    expect(new Set(names).size).toBe(37);

    const { server, regs } = fakeServer();
    for (const name of names) {
      registerGuarded(server as any, "tool", [name, "d", {}, {}, async () => ({ content: [] })], {});
    }
    expect(regs.map((r) => r.name)).toEqual(names);
  });

  it("returns a truncated JSON block when text+image bytes exceed the limit", async () => {
    const { server, regs } = fakeServer();
    registerGuarded(
      server as any,
      "tool",
      [
        "big_tool",
        "d",
        {},
        {},
        async () => ({
          content: [
            { type: "text", text: "abcd" },
            { type: "image", data: "0123456789", mimeType: "image/png" },
          ],
        }),
      ],
      { AWARDS_MCP_MAX_RESPONSE_BYTES: "10" },
    );
    const result = await regs[0].handler!();
    expect(result.content).toEqual([
      {
        type: "text",
        text: JSON.stringify({
          truncated: true,
          tool: "big_tool",
          bytes: 14,
          limit: 10,
          note: "Response exceeded AWARDS_MCP_MAX_RESPONSE_BYTES; narrow the request or raise the limit.",
        }),
      },
    ]);
  });

  it("passes payloads under the default 8MB limit through unchanged", async () => {
    const { server, regs } = fakeServer();
    const payload = { content: [{ type: "text", text: "ok" }] };
    registerGuarded(server as any, "tool", ["small_tool", "d", {}, {}, async () => payload], {});
    expect(await regs[0].handler!()).toBe(payload);
    expect(DEFAULT_MAX_RESPONSE_BYTES).toBe(8_000_000);
  });

  it("debug memory logging writes one JSON line to stderr, never stdout", async () => {
    const { server, regs } = fakeServer();
    const lines: string[] = [];
    const err = vi.spyOn(console, "error").mockImplementation((line?: unknown) => {
      lines.push(String(line));
    });
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      registerGuarded(
        server as any,
        "tool",
        ["dbg_tool", "d", {}, {}, async () => ({ content: [{ type: "text", text: "x" }] })],
        { AWARDS_MCP_DEBUG_MEMORY: "1" },
      );
      await regs[0].handler!();
    } finally {
      err.mockRestore();
      out.mockRestore();
    }
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ tool: "dbg_tool" });
    expect(JSON.parse(lines[0]).durationMs).toBeGreaterThanOrEqual(0);
    expect(out).not.toHaveBeenCalled();
  });
});
