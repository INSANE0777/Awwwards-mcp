import { describe, expect, it } from "vitest";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildUpdateNotice,
  compareVersions,
  parseVersion,
  selfUpdateCommand,
} from "../src/version-check.js";

describe("parseVersion", () => {
  it("splits semver into numeric triple", () => {
    expect(parseVersion("1.2.3")).toEqual([1, 2, 3]);
    expect(parseVersion("1.10.0")).toEqual([1, 10, 0]);
  });

  it("unparseable versions sort as oldest", () => {
    expect(parseVersion("garbage")).toEqual([0, 0, 0]);
  });
});

describe("compareVersions", () => {
  it("orders by major, then minor, then patch", () => {
    expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.10.0", "1.9.0")).toBe(1);
    expect(compareVersions("1.0.1", "1.0.0")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0", "2.0.0")).toBe(-1);
  });
});

describe("selfUpdateCommand", () => {
  it("uses System32 cmd.exe and the Node-adjacent npm.cmd on Windows without a shell", () => {
    const root = process.env.SystemRoot || process.env.windir || "C:\\Windows";
    const npmCmd = join(dirname(process.execPath), "npm.cmd");
    expect(selfUpdateCommand("1.2.3", "win32")).toEqual({
      cmd: join(root, "System32", "cmd.exe"),
      args: ["/d", "/s", "/c", `""${npmCmd}" install -g awwwards-mcp@1.2.3"`],
      shell: false,
    });
    expect(selfUpdateCommand("1.2.3", "linux")).toEqual({
      cmd: "npm",
      args: ["install", "-g", "awwwards-mcp@1.2.3"],
      shell: false,
    });
  });

  it("fails closed when npm.cmd is not beside the running Node binary", () => {
    expect(
      selfUpdateCommand("1.2.3", "win32", join(tmpdir(), "missing-node", "node.exe")),
    ).toBeNull();
  });

  it("rejects version strings that could be shell syntax", () => {
    expect(selfUpdateCommand("1.2.3 && calc", "win32")).toBeNull();
    expect(selfUpdateCommand("$(id)", "linux")).toBeNull();
    expect(selfUpdateCommand("1.2.3-beta.1", "linux")).not.toBeNull();
    expect(selfUpdateCommand("1.2.3+build.5", "linux")).not.toBeNull();
  });
});

describe("buildUpdateNotice", () => {
  it("returns a notice when the registry version is newer", () => {
    const notice = buildUpdateNotice("1.0.0", "1.1.0", false);
    expect(notice).toContain("v1.1.0");
    expect(notice).toContain("v1.0.0");
    expect(notice).toContain("npm install -g awwwards-mcp@latest");
  });

  it("mentions the restart step when auto-update is enabled", () => {
    const notice = buildUpdateNotice("1.0.0", "1.1.0", true);
    expect(notice).toContain("restart your agent");
  });

  it("returns null when running the latest or newer", () => {
    expect(buildUpdateNotice("1.1.0", "1.1.0", false)).toBeNull();
    expect(buildUpdateNotice("2.0.0", "1.1.0", false)).toBeNull();
  });
});
