import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildUpdateNotice,
  compareVersions,
  parseVersion,
  selfUpdateCommand,
  startSelfUpdate,
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
    const dir = mkdtempSync(join(tmpdir(), "awwwards-npm-"));
    const execPath = join(dir, "node.exe");
    const npmCmd = join(dir, "npm.cmd");
    writeFileSync(npmCmd, "");
    try {
      expect(selfUpdateCommand("1.2.3", "win32", execPath)).toEqual({
        cmd: join(root, "System32", "cmd.exe"),
        args: ["/d", "/s", "/c", `""${npmCmd}" install -g awwwards-mcp@1.2.3"`],
        shell: false,
        windowsVerbatimArguments: true,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    expect(
      selfUpdateCommand("1.2.3", "linux", join(tmpdir(), "missing-node", "node")),
    ).toEqual({
      cmd: "npm",
      args: ["install", "-g", "awwwards-mcp@1.2.3"],
      shell: false,
    });
  });

  it("prefers the npm next to node when PATH may be minimal", () => {
    const dir = mkdtempSync(join(tmpdir(), "awwwards-npm-sibling-"));
    const npm = join(dir, "npm");
    writeFileSync(npm, "");
    try {
      expect(selfUpdateCommand("1.2.3", "linux", join(dir, "node"))).toEqual({
        cmd: npm,
        args: ["install", "-g", "awwwards-mcp@1.2.3"],
        shell: false,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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

  it.skipIf(process.platform === "win32")(
    "actually runs the npm next to node on macOS and Linux",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "awwwards-update-posix-"));
      const originalExecPath = process.execPath;
      try {
        writeFileSync(join(dir, "node"), "");
        writeFileSync(
          join(dir, "npm"),
          '#!/bin/sh\nprintf "%s\\n" "$*" > "$(dirname "$0")/args.log"\n',
          { mode: 0o755 },
        );
        process.execPath = join(dir, "node");
        expect(startSelfUpdate("1.2.3")).toBe(true);
        const logPath = join(dir, "args.log");
        const deadline = Date.now() + 8000;
        while (!existsSync(logPath) && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        expect(existsSync(logPath)).toBe(true);
        expect(readFileSync(logPath, "utf8")).toContain("install -g awwwards-mcp@1.2.3");
      } finally {
        process.execPath = originalExecPath;
        rmSync(dir, { recursive: true, force: true });
      }
    },
    15000,
  );

  it.skipIf(process.platform !== "win32")(
    "actually runs npm.cmd on Windows with verbatim quoting",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "awwwards-update-"));
      const originalExecPath = process.execPath;
      try {
        writeFileSync(join(dir, "node.exe"), "");
        writeFileSync(
          join(dir, "npm.cmd"),
          '@echo off\r\necho %* > "%~dp0args.log"\r\nexit /b 0\r\n',
        );
        process.execPath = join(dir, "node.exe");
        expect(startSelfUpdate("1.2.3")).toBe(true);
        const logPath = join(dir, "args.log");
        const deadline = Date.now() + 8000;
        while (!existsSync(logPath) && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        expect(existsSync(logPath)).toBe(true);
        expect(readFileSync(logPath, "utf8")).toContain("install -g awwwards-mcp@1.2.3");
      } finally {
        process.execPath = originalExecPath;
        rmSync(dir, { recursive: true, force: true });
      }
    },
    15000,
  );
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
    expect(notice).toMatch(/restart your agent/i);
  });

  it("returns null when running the latest or newer", () => {
    expect(buildUpdateNotice("1.1.0", "1.1.0", false)).toBeNull();
    expect(buildUpdateNotice("2.0.0", "1.1.0", false)).toBeNull();
  });
});
