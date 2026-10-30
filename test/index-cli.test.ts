import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const TSX_CLI = join(__dirname, "../node_modules/tsx/dist/cli.mjs");
const CLI = join(__dirname, "../src/index-cli.ts");

describe("index CLI --elements retirement", () => {
  it.each([
    ["--elements"],
    ["--elements=all"],
    ["--elements=10"],
    ["--elements="],
    ["--pages", "1", "--elements=all"],
  ])("rejects %s before touching the cache", (...args: string[]) => {
    const dir = mkdtempSync(join(tmpdir(), "awwwards-cli-"));
    try {
      const cacheDir = join(dir, "cache");
      const result = spawnSync(process.execPath, [TSX_CLI, CLI, ...args], {
        env: { ...process.env, AWWWARDS_CACHE_DIR: cacheDir },
        encoding: "utf8",
        timeout: 30_000,
      });
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("retired");
      expect(existsSync(cacheDir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
