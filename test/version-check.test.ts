import { describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildUpdateNotice,
  checkForUpdate,
  compareVersions,
  isSafeVersion,
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

describe("isSafeVersion", () => {
  it("accepts only semver strings", () => {
    expect(isSafeVersion("1.2.3")).toBe(true);
    expect(isSafeVersion("1.2.3-beta.1+build.5")).toBe(true);
    expect(isSafeVersion(["2.0.0"])).toBe(false);
    expect(isSafeVersion("1.2.3 review-marker")).toBe(false);
    expect(isSafeVersion(undefined)).toBe(false);
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
    const missingExecPath = join(tmpdir(), "missing-node", "node");
    expect(selfUpdateCommand("1.2.3", "linux", missingExecPath)).toMatchObject({
      cmd: "npm",
      args: ["install", "-g", "awwwards-mcp@1.2.3"],
      shell: false,
    });
    expect(
      selfUpdateCommand("1.2.3", "linux", missingExecPath)?.env?.PATH?.split(
        delimiter,
      )[0],
    ).toBe(join(tmpdir(), "missing-node"));
    const originalPath = process.env.PATH;
    try {
      delete process.env.PATH;
      expect(
        selfUpdateCommand("1.2.3", "linux", missingExecPath)?.env?.PATH,
      ).toContain("/usr/bin:/bin");
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
    }
  });

  it("prefers the npm next to node when PATH may be minimal", () => {
    const dir = mkdtempSync(join(tmpdir(), "awwwards-npm-sibling-"));
    const npm = join(dir, "npm");
    writeFileSync(npm, "");
    try {
      expect(selfUpdateCommand("1.2.3", "linux", join(dir, "node"))).toMatchObject({
        cmd: npm,
        args: ["install", "-g", "awwwards-mcp@1.2.3"],
        shell: false,
      });
      expect(
        selfUpdateCommand("1.2.3", "linux", join(dir, "node"))?.env?.PATH?.split(
          delimiter,
        )[0],
      ).toBe(dir);
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
      const fallback = join(dir, "fallback");
      mkdirSync(fallback);
      const originalExecPath = process.execPath;
      const originalPath = process.env.PATH;
      try {
        writeFileSync(join(dir, "node"), "");
        writeFileSync(
          join(dir, "npm"),
          '#!/bin/sh\nprintf "%s\\n" "$*" > "${0%/*}/args.log"\n',
          { mode: 0o755 },
        );
        // If the sibling preference disappears, resolve this harmless shim
        // instead of the host's real npm and fail on its marker log.
        writeFileSync(
          join(fallback, "npm"),
          '#!/bin/sh\nprintf "%s\\n" "$*" > "${0%/*}/fallback.log"\n',
          { mode: 0o755 },
        );
        process.env.PATH = fallback;
        process.execPath = join(dir, "node");
        const child = startSelfUpdate("1.2.3");
        expect(child).not.toBeNull();
        if (!child) return;
        expect(await new Promise((resolve) => child.once("exit", resolve))).toBe(0);
        const logPath = join(dir, "args.log");
        const fallbackLogPath = join(fallback, "fallback.log");
        expect(readFileSync(logPath, "utf8")).toContain("install -g awwwards-mcp@1.2.3");
        expect(existsSync(fallbackLogPath)).toBe(false);
      } finally {
        process.execPath = originalExecPath;
        if (originalPath === undefined) delete process.env.PATH;
        else process.env.PATH = originalPath;
        rmSync(dir, { recursive: true, force: true });
      }
    },
    15000,
  );

  it.skipIf(process.platform !== "win32")(
    "actually runs npm.cmd on Windows with verbatim quoting",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "awwwards update-"));
      const originalExecPath = process.execPath;
      try {
        writeFileSync(join(dir, "node.exe"), "");
        writeFileSync(
          join(dir, "npm.cmd"),
          '@echo off\r\necho %* > "%~dp0args.log"\r\nexit /b 0\r\n',
        );
        process.execPath = join(dir, "node.exe");
        const child = startSelfUpdate("1.2.3");
        expect(child).not.toBeNull();
        if (!child) return;
        expect(await new Promise((resolve) => child.once("exit", resolve))).toBe(0);
        expect(readFileSync(join(dir, "args.log"), "utf8")).toContain(
          "install -g awwwards-mcp@1.2.3",
        );
      } finally {
        process.execPath = originalExecPath;
        rmSync(dir, { recursive: true, force: true });
      }
    },
    15000,
  );
});

describe("checkForUpdate", () => {
  it("ignores an unsafe cached version without throwing", () => {
    const dir = mkdtempSync(join(tmpdir(), "awwwards-version-state-"));
    const originalCache = process.env.AWWWARDS_CACHE_DIR;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      writeFileSync(
        join(dir, "version-check.json"),
        JSON.stringify({ checkedAt: Date.now(), latest: ["2.0.0"] }),
      );
      process.env.AWWWARDS_CACHE_DIR = dir;
      expect(() => checkForUpdate("1.0.0")).not.toThrow();
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
      if (originalCache === undefined) delete process.env.AWWWARDS_CACHE_DIR;
      else process.env.AWWWARDS_CACHE_DIR = originalCache;
      rmSync(dir, { recursive: true, force: true });
    }
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
    expect(notice).toMatch(/restart your agent/i);
  });

  it("does not claim a new attempt when this interval already tried", () => {
    const notice = buildUpdateNotice("1.0.0", "1.1.0", true, false);
    expect(notice).toContain("already made");
    expect(notice).not.toContain("attempting to install");
  });

  it("returns null when running the latest or newer", () => {
    expect(buildUpdateNotice("1.1.0", "1.1.0", false)).toBeNull();
    expect(buildUpdateNotice("2.0.0", "1.1.0", false)).toBeNull();
  });
});
