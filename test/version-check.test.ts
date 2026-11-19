import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
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

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

const malformedVersions = ["2.0.0-..", "2.0.0-", "2.0.0+.."];
const nodeExecPath = process.execPath;

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
    expect(isSafeVersion("1.2.3-0.01a+001")).toBe(true);
    expect(isSafeVersion(["2.0.0"])).toBe(false);
    expect(isSafeVersion("1.2.3 review-marker")).toBe(false);
    expect(isSafeVersion(undefined)).toBe(false);
  });

  it.each([
    ...malformedVersions, "02.0.0", "2.0.0-01", "2.0.0-rc.", "2.0.0+.build", "2.0.0\n",
    "9007199254740992.0.0", `2.0.0+${"a".repeat(251)}`,
  ])(
    "rejects malformed SemVer %j",
    (version) => {
      expect(isSafeVersion(version)).toBe(false);
      expect(selfUpdateCommand(version)).toBeNull();
      expect(buildUpdateNotice("1.0.0", version, "manual")).toBeNull();
    },
  );
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
    chmodSync(npm, 0o755);
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

  it("falls back to PATH when the sibling npm is not a file", () => {
    const dir = mkdtempSync(join(tmpdir(), "awwwards-npm-dir-"));
    mkdirSync(join(dir, "npm"));
    try {
      expect(selfUpdateCommand("1.2.3", "linux", join(dir, "node"))?.cmd).toBe("npm");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "falls back to PATH when the sibling npm is not executable",
    () => {
      const dir = mkdtempSync(join(tmpdir(), "awwwards-npm-mode-"));
      const npm = join(dir, "npm");
      writeFileSync(npm, "");
      // Deterministic regardless of the runner's umask.
      chmodSync(npm, 0o644);
      try {
        expect(selfUpdateCommand("1.2.3", "linux", join(dir, "node"))?.cmd).toBe("npm");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it("resolves a missing sibling npm.cmd from absolute PATH entries only", () => {
    const root = process.env.SystemRoot || process.env.windir || "C:\\Windows";
    const pathDir = mkdtempSync(join(tmpdir(), "awwwards-npm-cmd-path-"));
    const missing = mkdtempSync(join(tmpdir(), "awwwards-npm-cmd-missing-"));
    const npmCmd = join(pathDir, "npm.cmd");
    const originalPath = process.env.PATH;
    const missingNode = join(missing, "node.exe");
    writeFileSync(npmCmd, "");
    try {
      process.env.PATH = pathDir;
      const fallback = {
        cmd: join(root, "System32", "cmd.exe"),
        args: ["/d", "/s", "/c", `""${npmCmd}" install -g awwwards-mcp@1.2.3"`],
        shell: false,
        windowsVerbatimArguments: true,
      };
      expect(selfUpdateCommand("1.2.3", "win32", missingNode)).toEqual(fallback);
      const dir = mkdtempSync(join(tmpdir(), "awwwards-npm-cmd-dir-"));
      mkdirSync(join(dir, "npm.cmd"));
      try {
        expect(selfUpdateCommand("1.2.3", "win32", join(dir, "node.exe"))).toEqual(fallback);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }

      // Quoted entries are common on Windows and still absolute.
      process.env.PATH = `"${pathDir}"`;
      expect(selfUpdateCommand("1.2.3", "win32", missingNode)).toEqual(fallback);

      // Empty and relative PATH entries resolve against the cwd; skip them.
      process.env.PATH = `.${delimiter}${delimiter}`;
      expect(selfUpdateCommand("1.2.3", "win32", missingNode)).toBeNull();
      delete process.env.PATH;
      expect(selfUpdateCommand("1.2.3", "win32", missingNode)).toBeNull();
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
      rmSync(pathDir, { recursive: true, force: true });
      rmSync(missing, { recursive: true, force: true });
    }
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
        const siblingNpm = join(dir, "npm");
        const fallbackNpm = join(fallback, "npm");
        writeFileSync(siblingNpm, '#!/bin/sh\nprintf "%s\\n" "$*" > "${0%/*}/args.log"\n');
        // Deterministic regardless of the runner's umask.
        chmodSync(siblingNpm, 0o755);
        // Keep every possible PATH lookup inside the fixture.
        writeFileSync(fallbackNpm, '#!/bin/sh\nprintf "%s\\n" "$*" > "${0%/*}/fallback.log"\n');
        chmodSync(fallbackNpm, 0o755);
        process.env.PATH = fallback;
        process.execPath = join(dir, "node");
        const child = startSelfUpdate("1.2.3");
        expect(child).not.toBeNull();
        if (!child) return;
        expect(await once(child, "exit")).toEqual([0, null]);
        // Bare npm would also find the sibling through the child PATH.
        expect(spawn).toHaveBeenLastCalledWith(
          join(dir, "npm"),
          ["install", "-g", "awwwards-mcp@1.2.3"],
          expect.any(Object),
        );
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
    "falls back to npm.cmd on PATH on Windows",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "awwwards update path-"));
      const missing = mkdtempSync(join(tmpdir(), "awwwards missing node-"));
      try {
        writeFileSync(
          join(dir, "npm.cmd"),
          '@echo off\r\necho %* > "%~dp0args.log"\r\nexit /b 0\r\n',
        );
        vi.stubEnv("PATH", dir);
        process.execPath = join(missing, "node.exe");
        const child = startSelfUpdate("1.2.3");
        expect(child).not.toBeNull();
        if (!child) return;
        expect(await once(child, "exit")).toEqual([0, null]);
        expect(readFileSync(join(dir, "args.log"), "utf8")).toContain(
          "install -g awwwards-mcp@1.2.3",
        );
      } finally {
        process.execPath = nodeExecPath;
        vi.unstubAllEnvs();
        rmSync(dir, { recursive: true, force: true });
        rmSync(missing, { recursive: true, force: true });
      }
    },
    15000,
  );

  it.skipIf(process.platform !== "win32")(
    "ignores a malicious npm.cmd in the working directory",
    async () => {
      const cwdDir = mkdtempSync(join(tmpdir(), "awwwards-npm-cwd-"));
      const pathDir = mkdtempSync(join(tmpdir(), "awwwards-npm-cwd-path-"));
      const missing = mkdtempSync(join(tmpdir(), "awwwards-npm-cwd-missing-"));
      // A bare `npm` would find this one first: cmd.exe searches the cwd.
      writeFileSync(
        join(cwdDir, "npm.cmd"),
        '@echo off\r\necho cwd > "%~dp0malicious.log"\r\nexit /b 0\r\n',
      );
      writeFileSync(
        join(pathDir, "npm.cmd"),
        '@echo off\r\necho %* > "%~dp0args.log"\r\nexit /b 0\r\n',
      );
      const script = `
        import { once } from "node:events";
        process.execPath = process.env.FIXTURE_NODE;
        const { startSelfUpdate } = await import(${JSON.stringify(
          new URL("../src/version-check.ts", import.meta.url).href,
        )});
        const timer = setTimeout(() => process.exit(3), 10000);
        const child = startSelfUpdate("1.2.3");
        if (!child) process.exit(2);
        const [code] = await once(child, "exit");
        clearTimeout(timer);
        process.exit(code ?? 1);
      `;
      const { spawn: spawnNode } =
        await vi.importActual<typeof import("node:child_process")>("node:child_process");
      const worker = spawnNode(
        nodeExecPath,
        ["--experimental-strip-types", "--input-type=module", "--eval", script],
        {
          cwd: cwdDir,
          env: { ...process.env, PATH: pathDir, FIXTURE_NODE: join(missing, "node.exe") },
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 15000,
        },
      );
      const stderr: Buffer[] = [];
      worker.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      try {
        const [code] = await once(worker, "close");
        expect(code, Buffer.concat(stderr).toString()).toBe(0);
        expect(readFileSync(join(pathDir, "args.log"), "utf8")).toContain(
          "install -g awwwards-mcp@1.2.3",
        );
        expect(existsSync(join(cwdDir, "malicious.log"))).toBe(false);
      } finally {
        rmSync(cwdDir, { recursive: true, force: true });
        rmSync(pathDir, { recursive: true, force: true });
        rmSync(missing, { recursive: true, force: true });
      }
    },
    20000,
  );

  it.skipIf(process.platform !== "win32")(
    "actually runs npm.cmd on Windows with verbatim quoting",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "awwwards update-"));
      const fallback = join(dir, "fallback");
      try {
        mkdirSync(fallback);
        writeFileSync(
          join(fallback, "npm.cmd"),
          '@echo off\r\necho %* > "%~dp0fallback.log"\r\nexit /b 0\r\n',
        );
        vi.stubEnv("PATH", fallback);
        writeFileSync(join(dir, "node.exe"), "");
        writeFileSync(
          join(dir, "npm.cmd"),
          '@echo off\r\necho %* > "%~dp0args.log"\r\nexit /b 0\r\n',
        );
        process.execPath = join(dir, "node.exe");
        const child = startSelfUpdate("1.2.3");
        expect(child).not.toBeNull();
        if (!child) return;
        expect(await once(child, "exit")).toEqual([0, null]);
        expect(readFileSync(join(dir, "args.log"), "utf8")).toContain(
          "install -g awwwards-mcp@1.2.3",
        );
        expect(existsSync(join(fallback, "fallback.log"))).toBe(false);
      } finally {
        process.execPath = nodeExecPath;
        vi.unstubAllEnvs();
        rmSync(dir, { recursive: true, force: true });
      }
    },
    15000,
  );
});

describe("checkForUpdate", () => {
  const latest = "2.0.0";
  const day = 24 * 60 * 60 * 1000;
  const now = Date.UTC(2026, 10, 19, 12);
  let dir: string;
  let statePath: string;
  let child: EventEmitter & { unref: () => void };
  const fakeSpawn = vi.mocked(spawn);
  const fetchRegistry = vi.fn();
  const registryResponse = (version: unknown) => ({ ok: true, json: async () => ({ version }) });
  const start = () => checkForUpdate("1.0.0");
  const checkedState = () => JSON.parse(readFileSync(statePath, "utf8"));
  const notices = () => vi.mocked(console.error).mock.calls.flat().join("\n");
  const drainRefresh = async () => {
    // Let both the fetch and response.json continuations finish.
    await new Promise<void>((resolve) => setImmediate(resolve));
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "awwwards-version-state-"));
    statePath = join(dir, "version-check.json");
    vi.stubEnv("AWWWARDS_CACHE_DIR", dir);
    vi.stubEnv("AWWWARDS_AUTO_UPDATE", "1");
    vi.stubEnv("PATH", dir);
    process.execPath = join(dir, "node");
    writeFileSync(join(dir, "npm.cmd"), "");
    writeFileSync(join(dir, "npm"), "");
    vi.spyOn(Date, "now").mockReturnValue(now);
    vi.spyOn(console, "error").mockImplementation(() => {});
    child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    fakeSpawn.mockClear().mockReturnValue(child as ReturnType<typeof spawn>);
    fetchRegistry.mockReset().mockResolvedValue(registryResponse(latest));
    vi.stubGlobal("fetch", fetchRegistry);
  });

  afterEach(() => {
    process.execPath = nodeExecPath;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });

  it.each([...malformedVersions, ["2.0.0"]].map((version) => [version]))(
    "ignores a malformed cached version %j",
    (version) => {
      const state = JSON.stringify({ checkedAt: now, latest: version });
      writeFileSync(statePath, state);
      start();
      expect(readFileSync(statePath, "utf8")).toBe(state);
      expect(fetchRegistry).not.toHaveBeenCalled();
      expect(console.error).not.toHaveBeenCalled();
      expect(fakeSpawn).not.toHaveBeenCalled();
    },
  );

  it.each([...malformedVersions, ["2.0.0"]].map((version) => [version]))(
    "rejects a malformed registry version %j before saving or launching",
    async (version) => {
      fetchRegistry.mockResolvedValue(registryResponse(version));
      start();
      await drainRefresh();
      expect(fetchRegistry).toHaveBeenCalledOnce();
      expect(existsSync(statePath)).toBe(false);
      expect(console.error).not.toHaveBeenCalled();
      expect(fakeSpawn).not.toHaveBeenCalled();
    },
  );

  it("keeps the claim when a delayed opt-out response overwrites the registry cache", async () => {
    let finishOptOut!: (response: ReturnType<typeof registryResponse>) => void;
    fetchRegistry.mockImplementationOnce(() => new Promise((resolve) => { finishOptOut = resolve; }));
    vi.stubEnv("AWWWARDS_AUTO_UPDATE", "0");
    start();
    vi.stubEnv("AWWWARDS_AUTO_UPDATE", "1");
    start();
    await drainRefresh();
    expect(fakeSpawn).toHaveBeenCalledOnce();
    expect(notices()).not.toContain("attempting to install");
    child.emit("spawn");
    expect(notices()).toContain("attempting to install");

    vi.mocked(Date.now).mockReturnValue(now + 1);
    finishOptOut(registryResponse(latest));
    await drainRefresh();
    expect(checkedState()).toEqual({ checkedAt: now + 1, latest });
    vi.mocked(console.error).mockClear();
    start();
    expect(fakeSpawn).toHaveBeenCalledOnce();
    expect(fetchRegistry).toHaveBeenCalledTimes(2);
    expect(notices()).toContain("is already reserved;");
    expect(notices()).not.toContain("attempting to install");
  });

  it("refreshes checkedAt and keeps a claim across days", async () => {
    writeFileSync(statePath, JSON.stringify({ checkedAt: now, latest }));
    start();
    expect(fakeSpawn).toHaveBeenCalledOnce();
    expect(fetchRegistry).not.toHaveBeenCalled();

    const claimFiles = readdirSync(dir).filter((name) => name.startsWith("version-check.json.auto-"));
    expect(claimFiles).toHaveLength(1);
    writeFileSync(statePath, JSON.stringify({ checkedAt: now - day, latest }));
    start();
    await drainRefresh();
    expect(checkedState()).toEqual({ checkedAt: now, latest });
    expect(fakeSpawn).toHaveBeenCalledOnce();
    expect(fetchRegistry).toHaveBeenCalledOnce();

    vi.mocked(Date.now).mockReturnValue(now + 1);
    writeFileSync(statePath, JSON.stringify({ checkedAt: now - day, latest }));
    fetchRegistry.mockResolvedValue(registryResponse("2.1.0-rc.1+build.02"));
    start();
    await drainRefresh();
    expect(checkedState()).toEqual({ checkedAt: now + 1, latest: "2.1.0-rc.1+build.02" });
    expect(fakeSpawn).toHaveBeenLastCalledWith(
      expect.any(String),
      process.platform === "win32"
        ? ["/d", "/s", "/c", `""${join(dir, "npm.cmd")}" install -g awwwards-mcp@2.1.0-rc.1+build.02"`]
        : ["install", "-g", "awwwards-mcp@2.1.0-rc.1+build.02"],
      expect.any(Object),
    );
    start();
    expect(fetchRegistry).toHaveBeenCalledTimes(2);
    expect(fakeSpawn).toHaveBeenCalledTimes(2);

    vi.mocked(Date.now).mockReturnValue(now + day / 2);
    start();
    expect(fakeSpawn).toHaveBeenCalledTimes(2);
    expect(fetchRegistry).toHaveBeenCalledTimes(2);
  });

  it("treats build metadata as the same npm target", async () => {
    writeFileSync(statePath, JSON.stringify({ checkedAt: now, latest }));
    start();
    expect(fakeSpawn).toHaveBeenCalledOnce();

    vi.mocked(Date.now).mockReturnValue(now + 1);
    writeFileSync(statePath, JSON.stringify({ checkedAt: now - day, latest: "2.0.0+new" }));
    fetchRegistry.mockResolvedValue(registryResponse("2.0.0+new"));
    start();
    await drainRefresh();
    expect(checkedState()).toEqual({ checkedAt: now + 1, latest: "2.0.0+new" });
    expect(fakeSpawn).toHaveBeenCalledOnce();
    expect(notices()).toContain("is already reserved;");
  });

  it("honors a legacy attempt and never reclaims the same version", async () => {
    writeFileSync(statePath, JSON.stringify({
      checkedAt: now - day, latest, autoAttemptedVersion: latest, autoAttemptedAt: now - 1,
    }));
    vi.stubEnv("AWWWARDS_AUTO_UPDATE", "0");
    start();
    await drainRefresh();
    vi.stubEnv("AWWWARDS_AUTO_UPDATE", "1");
    start();
    expect(checkedState().checkedAt).toBe(now);
    expect(notices()).toContain("is already reserved;");
    expect(fakeSpawn).not.toHaveBeenCalled();

    vi.mocked(Date.now).mockReturnValue(now + day / 2);
    start();
    expect(fetchRegistry).toHaveBeenCalledOnce();
    expect(fakeSpawn).not.toHaveBeenCalled();
  });

  it("reports a busy cache without reporting a launch or an existing claim", async () => {
    writeFileSync(statePath, "");
    vi.stubEnv("AWWWARDS_CACHE_DIR", statePath);
    start();
    await drainRefresh();
    expect(notices()).toContain("cache is busy or unavailable");
    expect(notices()).not.toMatch(/already reserved|attempting to install/);
    expect(fakeSpawn).not.toHaveBeenCalled();
  });

  it("reports an asynchronous spawn error without a prior attempt notice or a retry", () => {
    writeFileSync(statePath, JSON.stringify({ checkedAt: now, latest }));
    start();
    expect(fakeSpawn).toHaveBeenCalledOnce();
    expect(console.error).not.toHaveBeenCalled();
    child.emit("error", new Error("fixture spawn failure"));
    expect(notices()).toContain("failed to start");
    start();
    expect(notices()).toContain("is already reserved;");
    expect(notices()).not.toContain("attempting to install");
    expect(fakeSpawn).toHaveBeenCalledOnce();
  });

  it("reports a synchronous spawn error without claiming a launch", () => {
    writeFileSync(statePath, JSON.stringify({ checkedAt: now, latest }));
    fakeSpawn.mockImplementationOnce(() => { throw new Error("fixture spawn failure"); });
    start();
    expect(notices()).toContain("could not start");
    expect(notices()).not.toMatch(/already reserved|attempting to install/);
  });

  it("lets only one of two processes claim a version when both refresh a stale cache", async () => {
    writeFileSync(statePath, JSON.stringify({ checkedAt: now - day, latest }));
    const script = `
      const { createRequire, syncBuiltinESMExports } = await import("node:module");
      const { EventEmitter } = await import("node:events");
      const childProcess = createRequire(process.cwd() + "/package.json")("node:child_process");
      childProcess.spawn = () => {
        process.stdout.write("npm invoked\\n");
        const child = Object.assign(new EventEmitter(), { unref() {} });
        process.nextTick(() => child.emit("spawn"));
        return child;
      };
      syncBuiltinESMExports();
      process.execPath = process.env.FIXTURE_NODE;
      Date.now = () => ${now};
      globalThis.fetch = async () => {
        const go = new Promise(resolve => process.once("message", resolve));
        process.send("ready");
        await go;
        process.disconnect();
        return { ok: true, json: async () => ({ version: "${latest}" }) };
      };
      const { checkForUpdate } = await import(${JSON.stringify(new URL("../src/version-check.ts", import.meta.url).href)});
      checkForUpdate("1.0.0");
    `;
    const { spawn: spawnNode } = await vi.importActual<typeof import("node:child_process")>("node:child_process");
    const workers = [0, 1].map(() => {
      const worker = spawnNode(nodeExecPath, ["--experimental-strip-types", "--input-type=module", "--eval", script], {
        env: { ...process.env, FIXTURE_NODE: process.execPath },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        timeout: 5000,
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      worker.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
      worker.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
      const closed = once(worker, "close");
      const ready = Promise.race([
        once(worker, "message").then(([message]) => message),
        closed.then(() => { throw new Error(Buffer.concat(stderr).toString() || "worker exited before refresh"); }),
      ]);
      return { worker, closed, ready, stdout, stderr };
    });
    try {
      expect(await Promise.all(workers.map(({ ready }) => ready))).toEqual(["ready", "ready"]);
      workers.forEach(({ worker }) => worker.send("go"));
      expect(await Promise.all(workers.map(({ closed }) => closed))).toEqual([[0, null], [0, null]]);
      const launches = workers.map(({ stdout }) => Buffer.concat(stdout).toString());
      expect(launches.sort()).toEqual(["", "npm invoked\n"]);
      const logs = workers.map(({ stderr }) => Buffer.concat(stderr).toString());
      expect(logs.filter((log) => log.includes("already reserved"))).toHaveLength(1);
      expect(logs.filter((log) => log.includes("attempting to install"))).toHaveLength(1);
      expect(checkedState()).toEqual({ checkedAt: now, latest });
    } finally {
      await Promise.allSettled(workers.map(({ closed }) => closed));
    }
  }, 10000);
});

describe("buildUpdateNotice", () => {
  it("returns a notice when the registry version is newer", () => {
    const notice = buildUpdateNotice("1.0.0", "1.1.0", "manual");
    expect(notice).toContain("v1.1.0");
    expect(notice).toContain("v1.0.0");
    expect(notice).toContain("npm install -g awwwards-mcp@latest");
  });

  it("mentions the restart step when auto-update is enabled", () => {
    const notice = buildUpdateNotice("1.0.0", "1.1.0", "spawned");
    expect(notice).toMatch(/restart your agent/i);
  });

  it("does not claim a new attempt when this interval already tried", () => {
    const notice = buildUpdateNotice("1.0.0", "1.1.0", "already-claimed");
    expect(notice).toContain("is already reserved;");
    expect(notice).not.toContain("for today");
    expect(notice).not.toContain("attempting to install");
  });

  it("returns null when running the latest or newer", () => {
    expect(buildUpdateNotice("1.1.0", "1.1.0", "manual")).toBeNull();
    expect(buildUpdateNotice("2.0.0", "1.1.0", "manual")).toBeNull();
  });
});
