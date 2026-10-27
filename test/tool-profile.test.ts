import { describe, expect, it, vi } from "vitest";
import {
  CORE_TOOL_NAMES,
  DEFAULT_MAX_RESPONSE_BYTES,
  isCoreTool,
  registerGuarded,
} from "../src/tool-profile.js";
import { registerAllTools } from "../src/tools/index.js";

type Registration = { name: string; handler?: (...args: any[]) => any };

function fakeServer() {
  const regs: Registration[] = [];
  const record = (args: any[]) => {
    const handler = args[args.length - 1];
    regs.push({ name: String(args[0]), handler: typeof handler === "function" ? handler : undefined });
  };
  return { server: { tool: (...args: any[]) => record(args), registerTool: (...args: any[]) => record(args) }, regs };
}

// cli.ts connects to stdio on import, so the registration contract is checked
// against the tool modules directly: registerAllTools on a fake server.
function cliToolNames(): string[] {
  const { server, regs } = fakeServer();
  registerAllTools({
    handlers: {} as any,
    tool: server.tool as any,
    registerTool: server.registerTool as any,
  });
  return regs.map((r) => r.name);
}

describe("tool profile", () => {
  it("core profile registers only the 12 core tools and skips the rest", () => {
    const { server, regs } = fakeServer();
    const env = { AWWWARDS_MCP_PROFILE: "core" };
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
    expect(isCoreTool("compare_sites", { AWWWARDS_MCP_PROFILE: "full" })).toBe(true);
    // One-release legacy fallback; the canonical name wins when both are set.
    expect(isCoreTool("compare_sites", { AWARDS_MCP_PROFILE: "core" })).toBe(false);
    expect(
      isCoreTool("search_sites", { AWARDS_MCP_PROFILE: "full", AWWWARDS_MCP_PROFILE: "core" }),
    ).toBe(true);
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

  it("core names are a subset of actual cli registrations (no typos)", () => {
    const names = cliToolNames();
    expect(CORE_TOOL_NAMES).toHaveLength(12);
    expect(new Set(CORE_TOOL_NAMES).size).toBe(12);
    for (const name of CORE_TOOL_NAMES) expect(names).toContain(name);
  });

  it("truncates over-budget payloads but preserves isError and other fields", async () => {
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
          isError: true,
          structuredContent: { keep: true },
          content: [
            { type: "text", text: "abcd" },
            { type: "image", data: "0123456789", mimeType: "image/png" },
          ],
        }),
      ],
      { AWWWARDS_MCP_MAX_RESPONSE_BYTES: "10" },
    );
    const result = await regs[0].handler!();
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ keep: true });
    expect(result.content).toEqual([
      {
        type: "text",
        text: JSON.stringify({
          truncated: true,
          tool: "big_tool",
          bytes: 14,
          limit: 10,
          note: "Response exceeded AWWWARDS_MCP_MAX_RESPONSE_BYTES; narrow the request or raise the limit.",
        }),
      },
    ]);
  });

  it("accepts the legacy env name but the canonical name wins", async () => {
    const payload = { content: [{ type: "text", text: "abcd" }, { type: "image", data: "0123456789" }] };
    const legacy = fakeServer();
    registerGuarded(legacy.server as any, "tool", ["t", "d", {}, {}, async () => payload], {
      AWARDS_MCP_MAX_RESPONSE_BYTES: "10",
    });
    expect((await legacy.regs[0].handler!()).content[0].text).toContain('"truncated":true');

    const both = fakeServer();
    registerGuarded(both.server as any, "tool", ["t", "d", {}, {}, async () => payload], {
      AWWWARDS_MCP_MAX_RESPONSE_BYTES: "100",
      AWARDS_MCP_MAX_RESPONSE_BYTES: "10",
    });
    expect(await both.regs[0].handler!()).toBe(payload);
  });

  it("keeps a legitimate >8MB capture_pose payload under the 32MB default", async () => {
    const payload = {
      content: [
        { type: "text", text: "x".repeat(9_000_000) },
        { type: "image", data: "A".repeat(1_000_000), mimeType: "image/png" },
      ],
    };
    const { server, regs } = fakeServer();
    registerGuarded(server as any, "tool", ["capture_pose_3d", "d", {}, {}, async () => payload], {});
    expect(await regs[0].handler!()).toBe(payload);
    expect(DEFAULT_MAX_RESPONSE_BYTES).toBe(32_000_000);
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
        { AWWWARDS_MCP_DEBUG_MEMORY: "1" },
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
