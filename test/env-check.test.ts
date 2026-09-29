import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkEnvironment, envStateFile } from "../src/env-check.js";

let tmp: string;
let origCacheDir: string | undefined;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "awwwards-env-"));
  origCacheDir = process.env.AWWWARDS_CACHE_DIR;
  process.env.AWWWARDS_CACHE_DIR = tmp;
});
afterEach(() => {
  if (origCacheDir === undefined) delete process.env.AWWWARDS_CACHE_DIR;
  else process.env.AWWWARDS_CACHE_DIR = origCacheDir;
  rmSync(tmp, { recursive: true, force: true });
});

describe("checkEnvironment", () => {
  it("runs the probe when there is no state, and records it on success", async () => {
    let calls = 0;
    checkEnvironment({ probe: async () => { calls++; return true; } });
    await new Promise((r) => setTimeout(r, 50)); // fire-and-forget → let it land
    expect(calls).toBe(1);
    expect(existsSync(envStateFile())).toBe(true);
  });

  it("skips the probe within the daily interval once a probe succeeded", async () => {
    checkEnvironment({ probe: async () => true });
    await new Promise((r) => setTimeout(r, 50));
    let calls = 0;
    checkEnvironment({ probe: async () => { calls++; } });
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toBe(0);
  });

  it("re-probes when the last probe failed (no state written)", async () => {
    checkEnvironment({ probe: async () => false });
    await new Promise((r) => setTimeout(r, 50));
    expect(existsSync(envStateFile())).toBe(false);
    let calls = 0;
    checkEnvironment({ probe: async () => { calls++; } });
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toBe(1);
  });

  it("treats a corrupt state file as no state", async () => {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync(tmp, { recursive: true });
    writeFileSync(envStateFile(), "not json{");
    let calls = 0;
    checkEnvironment({ probe: async () => { calls++; } });
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toBe(1);
  });

  it("state file reads back with a checkedAt timestamp", async () => {
    checkEnvironment({ probe: async () => true });
    await new Promise((r) => setTimeout(r, 50));
    const state = JSON.parse(readFileSync(envStateFile(), "utf8")) as { checkedAt: number };
    expect(Number.isFinite(state.checkedAt)).toBe(true);
    expect(state.checkedAt).toBeLessThanOrEqual(Date.now());
  });
});
