import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { extractArtifact } from "../scripts/release-artifact.mjs";
import { verifyArtifact } from "../scripts/verify-published-artifact.mjs";

const root = mkdtempSync(join(tmpdir(), "release-artifact-"));

afterAll(() => rmSync(root, { recursive: true, force: true }));

const fixturePath = (name: string) => join(import.meta.dirname, "fixtures", "release", name);
const fixture = (name: string) => JSON.parse(readFileSync(fixturePath(name), "utf8"));
const integrity: string = fixture("pack-single.json")[0].integrity;
const otherIntegrity: string = fixture("pack-multiple.json")[1].integrity;

describe("pack output extraction", () => {
  it("returns the filename and integrity of the single packed entry", () => {
    expect(extractArtifact(fixture("pack-single.json"))).toEqual({
      filename: "awwwards-mcp-1.16.0.tgz",
      integrity,
    });
  });

  it("rejects pack output with no entries", () => {
    expect(() => extractArtifact(fixture("pack-empty.json"))).toThrow(/0 entries/);
  });

  it("rejects pack output with more than one entry", () => {
    expect(() => extractArtifact(fixture("pack-multiple.json"))).toThrow(/2 entries/);
  });

  it("rejects a packed entry without a filename", () => {
    expect(() => extractArtifact([{ integrity }])).toThrow(/filename/);
  });

  it("rejects a packed entry without integrity", () => {
    expect(() => extractArtifact([{ filename: "awwwards-mcp-1.16.0.tgz" }])).toThrow(/integrity/);
  });
});

describe("packed artifact verification", () => {
  it("accepts a packed tarball whose integrity matches the registry", () => {
    expect(() => verifyArtifact(integrity, integrity)).not.toThrow();
  });

  it("rejects a packed tarball whose integrity differs from the registry", () => {
    expect(() => verifyArtifact(integrity, otherIntegrity)).toThrow(/does not match/);
  });

  it("rejects malformed local or registry integrity", () => {
    expect(() => verifyArtifact("sha512-not base64!", integrity)).toThrow(/local pack integrity/);
    expect(() => verifyArtifact(integrity, "integrity")).toThrow(/registry integrity/);
  });
});

describe("release artifact scripts", () => {
  it("emits filename and integrity for a single pack entry", () => {
    const output = join(mkdtempSync(join(root, "artifact-")), "github-output");
    writeFileSync(output, "");
    const result = spawnSync(
      process.execPath,
      [join(import.meta.dirname, "..", "scripts", "release-artifact.mjs"), fixturePath("pack-single.json")],
      { encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: output } },
    );
    expect(result.status).toBe(0);
    expect(readFileSync(output, "utf8")).toBe(`filename=awwwards-mcp-1.16.0.tgz\nintegrity=${integrity}\n`);
  });

  it("passes when the local pack matches the registry integrity", () => {
    const result = spawnSync(
      process.execPath,
      [
        join(import.meta.dirname, "..", "scripts", "verify-published-artifact.mjs"),
        fixturePath("pack-single.json"),
        integrity,
      ],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);
  });

  it("fails when the local pack differs from the registry integrity", () => {
    const result = spawnSync(
      process.execPath,
      [
        join(import.meta.dirname, "..", "scripts", "verify-published-artifact.mjs"),
        fixturePath("pack-single.json"),
        otherIntegrity,
      ],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("does not match");
  });
});
