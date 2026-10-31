import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// The release workflow runs this gate before npm ci; these cases prove every
// version source is checked without touching the network.
const script = join(import.meta.dirname, "..", "scripts", "release-version-gate.mjs");
const root = mkdtempSync(join(tmpdir(), "release-version-gate-"));

afterAll(() => rmSync(root, { recursive: true, force: true }));

type Versions = { pkg: string; lockRoot: string; lockEntry: string };
const agree = (version: string): Versions => ({
  pkg: version,
  lockRoot: version,
  lockEntry: version,
});

function run(versions: Versions, tag: string) {
  const dir = mkdtempSync(join(root, "case-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", version: versions.pkg }));
  writeFileSync(
    join(dir, "package-lock.json"),
    JSON.stringify({
      name: "x",
      version: versions.lockRoot,
      lockfileVersion: 3,
      packages: { "": { name: "x", version: versions.lockEntry } },
    }),
  );
  return spawnSync(process.execPath, [script, tag], { cwd: dir, encoding: "utf8" });
}

describe("release version gate", () => {
  it("accepts a tag that matches both files", () => {
    expect(run(agree("1.16.0"), "v1.16.0").status).toBe(0);
  });

  it("rejects a tag that disagrees with the files", () => {
    const result = run(agree("1.15.1"), "v1.16.0");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("1.15.1");
  });

  it("rejects a package.json version that disagrees with the rest", () => {
    expect(run({ ...agree("1.16.0"), pkg: "1.15.1" }, "v1.16.0").status).toBe(1);
  });

  it("rejects a package-lock.json root version that disagrees with the rest", () => {
    expect(run({ ...agree("1.16.0"), lockRoot: "1.15.1" }, "v1.16.0").status).toBe(1);
  });

  it("rejects a package-lock.json packages entry that disagrees with the rest", () => {
    expect(run({ ...agree("1.16.0"), lockEntry: "1.15.1" }, "v1.16.0").status).toBe(1);
  });
});
