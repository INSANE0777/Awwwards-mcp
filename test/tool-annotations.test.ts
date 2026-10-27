import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// cli.ts is the MCP entry: its 37 tool registrations run at connect time, so
// the annotation contract is asserted on the source itself. M8ven/OpenAI's
// directory rejects tools where any of the four hints is missing or
// non-boolean — this test fails if a tool regresses.
describe("tool annotations", () => {
  const src = readFileSync(join(__dirname, "../src/cli.ts"), "utf8");

  it("every tool registration declares all four boolean hints", () => {
    // get_site_details uses registerTool because its cross-field .refine
    // cannot be expressed as a raw parameter shape.
    const regRe = /server\.(?:tool|registerTool)\(/g;
    const calls = src.match(regRe) ?? [];
    expect(calls.length).toBe(37);

    // Slice out each balanced-parens registration block and require the
    // four hint keys with explicit boolean values inside it.
    const re = /server\.(?:tool|registerTool)\(/g;
    let m: RegExpExecArray | null;
    let checked = 0;
    while ((m = re.exec(src))) {
      let i = m.index + m[0].length;
      let depth = 1;
      while (i < src.length && depth > 0) {
        if (src[i] === "(") depth++;
        else if (src[i] === ")") depth--;
        i++;
      }
      const block = src.slice(m.index, i);
      for (const hint of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]) {
        expect(block, `tool block missing ${hint}: ${block.slice(0, 80)}`).toMatch(
          new RegExp(`${hint}: (true|false)`,
        ));
      }
      checked++;
    }
    expect(checked).toBe(calls.length);
  });

  it("registers create_design_brief as a read-only idempotent open-world tool", () => {
    const registrations = src.match(/server\.tool\(\n  "create_design_brief"/g) ?? [];
    expect(registrations).toHaveLength(1);
    const start = src.indexOf('server.tool(\n  "create_design_brief"');
    expect(start).toBeGreaterThanOrEqual(0);
    const block = src.slice(start, src.indexOf("\n);", start) + 3);
    expect(block).toContain("slugs:");
    expect(block).toContain("goal:");
    expect(block).toContain("includeStructure:");
    expect(block).toContain("readOnlyHint: true");
    expect(block).toContain("destructiveHint: false");
    expect(block).toContain("idempotentHint: true");
    expect(block).toContain("openWorldHint: true");
    expect(block).toContain("/^[\\w-]+$/");
    expect(block).toContain("toLowerCase()");
    expect(block).toContain("goal: z.string().trim().min(1).max(2000)");
    expect(block).toContain("audience: z.string().trim().min(1).max(1000).optional()");
    expect(block).toContain("constraints: z.array(z.string().trim().min(1).max(1000)).max(20).optional()");
  });

  it("registers analyze_network_capture as a read-only offline tool", () => {
    const start = src.indexOf('server.tool(\n  "analyze_network_capture"');
    expect(start).toBeGreaterThanOrEqual(0);
    const block = src.slice(start, src.indexOf("\n);", start) + 3);
    expect(block).toContain("path: z.string()");
    expect(block).toContain("top: z.number().int().min(1).max(200).optional()");
    expect(block).toContain("readOnlyHint: true");
    expect(block).toContain("destructiveHint: false");
    expect(block).toContain("idempotentHint: true");
    expect(block).toContain("openWorldHint: false");
  });

  it("registers verify_flow as a non-read-only click tool with bounded steps", () => {
    const start = src.indexOf('server.registerTool(\n  "verify_flow"');
    expect(start).toBeGreaterThanOrEqual(0);
    const block = src.slice(start, src.indexOf("\n);", start) + 3);
    expect(block).toContain("inputSchema: verifyFlowArgsSchema");
    expect(block).toContain("readOnlyHint: false");
    expect(block).toContain("destructiveHint: false");
    expect(block).toContain("idempotentHint: false");
    expect(block).toContain("openWorldHint: true");
    expect(block).toContain("No screenshots");
  });
});
