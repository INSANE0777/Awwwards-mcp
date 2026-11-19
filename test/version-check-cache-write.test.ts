import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Isolated from version-check.test.ts: only this file simulates a permanently
// blocked cache replacement, so the main suite keeps its real fs behavior.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    renameSync: vi.fn(() => {
      throw Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
    }),
  };
});

import { checkForUpdate } from "../src/version-check.js";

describe("version-check cache writes", () => {
  let dir: string;
  let statePath: string;
  const previousState = JSON.stringify({ checkedAt: 1, latest: "1.0.0" });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "awwwards-version-cache-"));
    statePath = join(dir, "version-check.json");
    vi.stubEnv("AWWWARDS_CACHE_DIR", dir);
    vi.stubEnv("AWWWARDS_AUTO_UPDATE", "0");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ version: "2.0.0" }) })),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    writeFileSync(statePath, previousState);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps the previous JSON when every replacement attempt fails", async () => {
    checkForUpdate("1.0.0");
    // Let the fetch and response.json continuations finish.
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(renameSync).toHaveBeenCalledTimes(3);
    expect(readFileSync(statePath, "utf8")).toBe(previousState);
    expect(readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toHaveLength(0);
  });
});
