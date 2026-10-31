import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { isCliEntry } from "../src/cli-entry.js";

const ROOT = join(import.meta.dirname, "..");
const TSX_CLI = join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const PKG = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  bin: Record<string, string>;
};

describe("isCliEntry", () => {
  const self = join(ROOT, "src", "verify-cli.ts");
  const meta = pathToFileURL(self).href;

  it("matches the real file path", () => {
    expect(isCliEntry(meta, self, [])).toBe(true);
  });

  it("matches an installed-alias basename (hardlink/copy), and rejects unrelated entries", () => {
    expect(isCliEntry(meta, "/usr/local/bin/awwwards-verify", ["awwwards-verify"])).toBe(true);
    expect(isCliEntry(meta, "C:/app/vitest.mjs", ["awwwards-verify"])).toBe(false);
    expect(isCliEntry(meta, undefined, ["awwwards-verify"])).toBe(false);
  });
});

describe("advertised bins", () => {
  it("every bin source starts with a node shebang (tsc preserves it)", () => {
    for (const [name, target] of Object.entries(PKG.bin)) {
      const source = join(ROOT, "src", `${target.split("/").pop()?.replace(/\.js$/, "")}.ts`);
      expect(existsSync(source), `${name}: missing ${source}`).toBe(true);
      expect(readFileSync(source, "utf8").split("\n")[0], name).toBe("#!/usr/bin/env node");
    }
  });
});

// The bug behind this test: npm runs a bin through an extensionless
// node_modules/.bin symlink, so argv[1] is the alias, not <name>-cli.js. The
// old suffix guard missed it and the CLI exited 0 without output.
const aliasEntry = (target: string, alias: string): { path: string; cleanup: () => void } | null => {
  const dir = mkdtempSync(join(tmpdir(), "awwwards-bin-"));
  const link = join(dir, alias);
  try {
    symlinkSync(target, link, "file");
    return { path: link, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
  } catch {
    // Windows without developer mode cannot symlink. pack:smoke exercises the
    // real installed aliases; skip here instead of polluting the source tree.
    rmSync(dir, { recursive: true, force: true });
    return null;
  }
};

const runAlias = (target: string, alias: string, args: string[]) => {
  const entry = aliasEntry(target, alias);
  if (!entry) return null;
  try {
    return spawnSync(process.execPath, [TSX_CLI, entry.path, ...args], {
      encoding: "utf8",
      timeout: 30_000,
    });
  } finally {
    entry.cleanup();
  }
};

describe("bin entry through an installed-alias path", () => {
  it("awwwards-verify runs its usage error (exit 4, JSON line) instead of exiting 0 silently", (ctx) => {
    const result = runAlias(join(ROOT, "src", "verify-cli.ts"), "awwwards-verify.ts", []);
    if (!result) return ctx.skip();
    expect(result.status).toBe(4);
    expect(result.stdout.trim()).not.toBe("");
    expect(JSON.parse(result.stdout).error).toContain("usage: awwwards-verify");
  });

  it("awwwards-build-project runs its usage error (exit 2, JSON line) instead of exiting 0 silently", (ctx) => {
    const result = runAlias(join(ROOT, "src", "build-project-cli.ts"), "awwwards-build-project.ts", []);
    if (!result) return ctx.skip();
    expect(result.status).toBe(2);
    expect(result.stdout.trim()).not.toBe("");
    expect(JSON.parse(result.stdout).error).toContain("usage: awwwards-build-project");
  });
});
