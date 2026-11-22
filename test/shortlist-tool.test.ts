import { describe, expect, it } from "vitest";
import { z } from "zod";
import { shortlistInputSchema } from "../src/shortlist/contracts.js";
import { createServer } from "../src/server-instance.js";

function withProfile<T>(profile: string | undefined, fn: () => T): T {
  const saved = process.env.AWWWARDS_MCP_PROFILE;
  const savedLegacy = process.env.AWARDS_MCP_PROFILE;
  if (profile === undefined) delete process.env.AWWWARDS_MCP_PROFILE;
  else process.env.AWWWARDS_MCP_PROFILE = profile;
  delete process.env.AWARDS_MCP_PROFILE;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env.AWWWARDS_MCP_PROFILE;
    else process.env.AWWWARDS_MCP_PROFILE = saved;
    if (savedLegacy === undefined) delete process.env.AWARDS_MCP_PROFILE;
    else process.env.AWARDS_MCP_PROFILE = savedLegacy;
  }
}

type ToolEntry = {
  description?: string;
  inputSchema?: { safeParse: (value: unknown) => { success: boolean } };
  annotations?: Record<string, unknown>;
  handler?: (...args: any[]) => any;
};

function serverWith(handlers: Record<string, unknown> = {}): any {
  return createServer({ handlers: handlers as any, version: "0.0.0-test" });
}

function toolsFor(profile: string | undefined, handlers: Record<string, unknown> = {}) {
  return withProfile(profile, () => serverWith(handlers)) as {
    _registeredTools: Record<string, ToolEntry>;
  };
}

const validInput = {
  brief: "A dark editorial portfolio with restrained motion",
  criteria: [{ id: "motion", label: "Scroll motion", kind: "must", query: "webgl" }],
  outDir: "C:/tmp/shortlist",
};

describe("shortlist_references registration", () => {
  it("registers once in full and core, never in v2", () => {
    for (const profile of [undefined, "core"]) {
      const names = Object.keys(toolsFor(profile)._registeredTools);
      expect(names.filter((name) => name === "shortlist_references")).toHaveLength(1);
    }
    const v2 = Object.keys(toolsFor("v2")._registeredTools);
    expect(v2).not.toContain("shortlist_references");
  });

  it("declares write-safe annotations", () => {
    const tool = toolsFor(undefined)._registeredTools.shortlist_references!;
    expect(tool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    });
  });

  it("describes the live probe, local dossier and bounded result", () => {
    const tool = toolsFor(undefined)._registeredTools.shortlist_references!;
    const description = tool.description!;
    expect(description).toContain("up to 5 Awwwards references");
    expect(description).toContain("Probes live Awwwards sites");
    expect(description).toContain("optional Playwright for structure, motion and screenshots");
    expect(description).toContain("reported as unknown or partial");
    expect(description).toContain("local review dossier");
    expect(description).toContain("no hosting, no telemetry");
    expect(description).toContain("no taste score");
    expect(description).toContain("outDir must be absolute");
    expect(description).toContain(
      "targetStack is an annotation (same/compatible/unknown), never a filter.",
    );
    expect(description).toContain("reference-decision.json");
    expect(description).not.toContain("Local-only");
  });

  it("describes every input field in the JSON schema", () => {
    const json = z.toJSONSchema(shortlistInputSchema) as Record<string, unknown>;
    const missing: string[] = [];
    const walk = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      const properties = (node as { properties?: Record<string, { description?: string }> })
        .properties;
      for (const [key, child] of Object.entries(properties ?? {})) {
        if (!child.description) missing.push(key);
        walk(child);
      }
      for (const value of Object.values(node as Record<string, unknown>)) walk(value);
    };
    walk(json);
    expect(missing).toEqual([]);
  });

  it("passes the call through to the handler", async () => {
    const fake = { content: [{ type: "text", text: "shortlisted" }] };
    const handler = async (args: unknown) => {
      expect(args).toEqual(validInput);
      return fake;
    };
    const tool = toolsFor(undefined, { shortlist_references: handler })._registeredTools
      .shortlist_references!;
    await expect(tool.handler!(validInput)).resolves.toEqual(fake);
  });

  it("uses the shared input schema at the registration boundary", () => {
    const tool = toolsFor(undefined)._registeredTools.shortlist_references!;
    expect(tool.inputSchema).toBe(shortlistInputSchema);
  });

  it("rejects invalid input at the schema boundary", () => {
    const schema = toolsFor(undefined)._registeredTools.shortlist_references!.inputSchema!;
    expect(schema.safeParse({ ...validInput, limit: 2 }).success).toBe(false);
    expect(schema.safeParse({ ...validInput, seeds: ["https://example.com"] }).success).toBe(
      false,
    );
    expect(
      schema.safeParse({
        ...validInput,
        criteria: [
          { id: "same", label: "One", kind: "must", query: "a" },
          { id: "same", label: "Two", kind: "nice", query: "b" },
        ],
      }).success,
    ).toBe(false);
    expect(schema.safeParse({ ...validInput, outDir: undefined }).success).toBe(false);
    expect(schema.safeParse(validInput).success).toBe(true);
  });
});
