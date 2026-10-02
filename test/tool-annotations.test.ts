import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// cli.ts is the MCP entry: its 15 server.tool() calls run at connect time, so
// the annotation contract is asserted on the source itself. M8ven/OpenAI's
// directory rejects tools where any of the four hints is missing or
// non-boolean — this test fails if a tool regresses.
describe("tool annotations", () => {
  const src = readFileSync(join(__dirname, "../src/cli.ts"), "utf8");

  it("every server.tool declares all four boolean hints", () => {
    const calls = src.match(/server\.tool\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(15);

    // Slice out each balanced-parens server.tool(...) block and require the
    // four hint keys with explicit boolean values inside it.
    const re = /server\.tool\(/g;
    let m: RegExpExecArray | null;
    let checked = 0;
    while ((m = re.exec(src))) {
      let i = m.index + "server.tool(".length;
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
});
