import { describe, expect, it } from "vitest";
import { runBuildProjectCli, type RunBuildProjectCliIo } from "../src/build-project-cli.js";
import type { BuildProjectResult } from "../src/build-project.js";

const ok: BuildProjectResult = {
  outDir: "/abs/out",
  target: "vite",
  files: ["index.html", "package.json"],
  warnings: [],
};

interface Harness {
  lines: string[];
  calls: Array<{ html: string; target: string; out: string; name?: string }>;
  run: (args: string[], result: BuildProjectResult | { error: string } | "throw") => Promise<number>;
}

const harness = (): Harness => {
  const lines: string[] = [];
  const calls: Array<{ html: string; target: string; out: string; name?: string }> = [];
  const run = async (args: string[], result: BuildProjectResult | { error: string } | "throw") => {
    const io: RunBuildProjectCliIo = {
      args,
      write: (line) => lines.push(line),
      buildFn: async (a) => {
        calls.push(a);
        if (result === "throw") throw new Error("disk exploded");
        return result as BuildProjectResult | { error: string };
      },
    };
    return runBuildProjectCli(io);
  };
  return { lines, calls, run };
};

describe("runBuildProjectCli (Task 3, offline injected buildFn)", () => {
  it("success → exit 0, exactly one machine-parseable JSON line", async () => {
    const h = harness();
    const code = await h.run(["site.html", "--target", "vite", "--out", "out/site"], ok);
    expect(code).toBe(0);
    expect(h.lines).toHaveLength(1);
    const parsed = JSON.parse(h.lines[0]);
    expect(parsed.outDir).toBe("/abs/out");
    expect(parsed.files).toContain("index.html");
    expect(h.calls[0]).toEqual({ html: "site.html", target: "vite", out: "out/site" });
  });

  it("--name forwards; space and = flag forms reach the core", async () => {
    const eq = harness();
    await eq.run(["a.html", "--target=next", "--out=o", "--name", "My Site"], ok);
    expect(eq.calls[0]).toEqual({ html: "a.html", target: "next", out: "o", name: "My Site" });
  });

  it("core {error} → exit 3 with an {error} JSON line; thrown error → exit 3", async () => {
    const h = harness();
    const code = await h.run(["site.html", "--target", "vite", "--out", "o"], { error: "cannot read site.html" });
    expect(code).toBe(3);
    expect(JSON.parse(h.lines[0])).toEqual({ error: "cannot read site.html" });
    const thrown = harness();
    expect(await thrown.run(["site.html", "--target", "vite", "--out", "o"], "throw")).toBe(3);
    expect(JSON.parse(thrown.lines[0]).error).toContain("disk exploded");
  });

  it("usage errors → exit 2 with the usage JSON line (no core call)", async () => {
    const cases: string[][] = [
      [],
      ["site.html"],
      ["site.html", "--target", "svelte", "--out", "o"],
      ["a.html", "b.html", "--target", "vite", "--out", "o"],
      ["site.html", "--target"],
      ["site.html", "--target", "vite"],
    ];
    for (const args of cases) {
      const h = harness();
      const code = await h.run(args, ok);
      expect(code).toBe(2);
      expect(h.lines).toHaveLength(1);
      expect(h.calls).toHaveLength(0);
      expect(JSON.parse(h.lines[0]).error).toContain("usage: awwwards-build-project");
    }
  });

  it("warnings ride the success line (missing assets are warned, never fatal)", async () => {
    const h = harness();
    const code = await h.run(["site.html", "--target", "astro", "--out", "o"], {
      ...ok,
      target: "astro",
      warnings: ["asset not found: ./assets/gone.png"],
    });
    expect(code).toBe(0);
    expect(JSON.parse(h.lines[0]).warnings).toEqual(["asset not found: ./assets/gone.png"]);
  });
});
