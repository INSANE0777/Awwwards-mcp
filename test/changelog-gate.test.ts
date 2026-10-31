import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { findSection } from "../scripts/changelog-gate.mjs";

const root = mkdtempSync(join(tmpdir(), "changelog-gate-"));
const script = join(import.meta.dirname, "..", "scripts", "changelog-gate.mjs");

afterAll(() => rmSync(root, { recursive: true, force: true }));

const changelog = [
  "# Changelog",
  "",
  "## v1.16.0 - 2026-10-31",
  "",
  "Release body.",
  "",
  "### Details",
  "",
  "- item",
  "",
  "## v1.15.1 - 2026-10-30",
  "",
  "Older body.",
].join("\n");

const emptyChangelog = [
  "## v1.17.0 - 2026-11-01",
  "",
  "## v1.16.0 - 2026-10-31",
  "",
  "Body.",
].join("\n");

describe("changelog section extraction", () => {
  it("finds the exact heading and stops before the next release heading", () => {
    expect(findSection(changelog, "1.16.0")).toBe("Release body.\n\n### Details\n\n- item");
    expect(findSection(changelog, "1.16.0")).not.toContain("Older body");
    expect(findSection(changelog, "1.16.0")).not.toContain("## v1.15.1");
  });

  it("accepts a leading v in the requested version", () => {
    expect(findSection(changelog, "v1.16.0")).toBe(findSection(changelog, "1.16.0"));
  });

  it("returns null for a missing version", () => {
    expect(findSection(changelog, "1.17.0")).toBeNull();
  });

  it("returns an empty body for a heading with no content", () => {
    expect(findSection(emptyChangelog, "1.17.0")).toBe("");
  });

  it("does not match a longer version heading", () => {
    const longer = ["## v1.16.01 - 2026-10-31", "", "Newer patch.", ""].join("\n");
    expect(findSection(longer, "1.16.0")).toBeNull();
    expect(findSection(changelog, "1.16.01")).toBeNull();
  });

  it("treats dots in the version literally", () => {
    const literal = ["## v1x16x0 - 2026-10-31", "", "Not this release.", ""].join("\n");
    expect(findSection(literal, "1.16.0")).toBeNull();
  });
});

describe("changelog gate script", () => {
  const dir = mkdtempSync(join(root, "case-"));
  writeFileSync(join(dir, "CHANGELOG.md"), changelog);
  const emptyDir = mkdtempSync(join(root, "empty-"));
  writeFileSync(join(emptyDir, "CHANGELOG.md"), emptyChangelog);

  const run = (version: string, mode: string, cwd = dir) =>
    spawnSync(process.execPath, [script, version, mode], { cwd, encoding: "utf8" });

  it("passes --check on the exact heading", () => {
    expect(run("1.16.0", "--check").status).toBe(0);
  });

  it("fails --check on a missing or longer version heading", () => {
    expect(run("1.16.01", "--check").status).toBe(1);
    expect(run("1.17.0", "--check").status).toBe(1);
  });

  it("fails --check on an empty section", () => {
    const result = run("1.17.0", "--check", emptyDir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("empty");
  });

  it("fails --body on an empty section", () => {
    const result = run("1.17.0", "--body", emptyDir);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("empty");
  });

  it("prints only the released section for --body", () => {
    const result = run("1.16.0", "--body");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("Release body.\n\n### Details\n\n- item\n");
  });
});
