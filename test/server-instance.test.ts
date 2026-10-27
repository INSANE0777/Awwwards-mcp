import { describe, expect, it } from "vitest";
import { createServer } from "../src/server-instance.js";

// McpServer keeps its registry on a private field; reading it is the only
// way to assert registrations without opening a transport.
const toolNames = (server: unknown): string[] =>
  Object.keys((server as { _registeredTools?: Record<string, unknown> })._registeredTools ?? {});

describe("server factory", () => {
  it("returns a distinct server with 37 registrations per call", () => {
    const savedProfile = process.env.AWWWARDS_MCP_PROFILE;
    const savedLegacy = process.env.AWARDS_MCP_PROFILE;
    delete process.env.AWWWARDS_MCP_PROFILE;
    delete process.env.AWARDS_MCP_PROFILE;
    try {
      const handlers = {} as any;
      const first = createServer({ handlers, version: "0.0.0-test" });
      const second = createServer({ handlers, version: "0.0.0-test" });

      expect(second).not.toBe(first);
      expect(toolNames(first)).toHaveLength(37);
      expect(toolNames(second)).toHaveLength(37);
      expect(toolNames(second)).toEqual(toolNames(first));
    } finally {
      if (savedProfile === undefined) delete process.env.AWWWARDS_MCP_PROFILE;
      else process.env.AWWWARDS_MCP_PROFILE = savedProfile;
      if (savedLegacy === undefined) delete process.env.AWARDS_MCP_PROFILE;
      else process.env.AWARDS_MCP_PROFILE = savedLegacy;
    }
  });
});
