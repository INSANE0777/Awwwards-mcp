// Update notification: once a day, compare the running version against the
// npm registry and (optionally) self-update. Designed around the constraints
// of a stdio MCP server:
//   - stdout is the JSON-RPC channel → every notice goes to stderr only
//   - serving must never wait on this → fire-and-forget, 3s timeout,
//     every failure swallowed (registry unreachable / package unpublished)
//   - at most one registry hit per day per machine (state in the cache dir)
// Auto-update is strictly opt-in: AWWWARDS_AUTO_UPDATE=1 runs
// `npm install -g awwwards-mcp@<latest>` detached, then asks the user to
// restart their agent; without the env var, the notice just tells the agent.

import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { homedir } from "node:os";

const REGISTRY_URL = "https://registry.npmjs.org/awwwards-mcp/latest";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const AUTO_LOCK_MS = 60 * 1000;

// npm/npx are .cmd shims on Windows. Spawning npm.cmd with shell:true emits
// DEP0190 on modern Node, so run the validated install through cmd.exe's /c
// form with shell:false. The registry-provided version is validated first, so
// no shell syntax can reach the command line.
const SAFE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function isSafeVersion(value: unknown): value is string {
  return typeof value === "string" && SAFE_VERSION.test(value);
}

export function parseVersion(v: string): [number, number, number] {
  const m = v.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return [0, 0, 0];
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** 1 when a > b, -1 when a < b, 0 when equal. Unparseable sorts as oldest. */
export function compareVersions(a: string, b: string): number {
  const [pa, pb] = [parseVersion(a), parseVersion(b)];
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
}

type CheckState = {
  checkedAt: number;
  latest?: string;
  autoAttemptedVersion?: string;
  autoAttemptedAt?: number;
};

function stateFile(): string {
  const cacheRoot =
    process.env.AWWWARDS_CACHE_DIR ?? join(homedir(), ".awwwards-mcp");
  return join(cacheRoot, "version-check.json");
}

function readState(): CheckState | null {
  try {
    if (!existsSync(stateFile())) return null;
    return JSON.parse(readFileSync(stateFile(), "utf8")) as CheckState;
  } catch {
    return null;
  }
}

function writeState(state: CheckState): boolean {
  try {
    mkdirSync(dirname(stateFile()), { recursive: true, mode: 0o700 });
    writeFileSync(stateFile(), JSON.stringify(state), { mode: 0o600 });
    return true;
  } catch {
    // notification is best-effort; an unwritable cache dir is fine
    return false;
  }
}

export function buildUpdateNotice(
  current: string,
  latest: string,
  autoUpdateEnabled: boolean,
  willAttempt = autoUpdateEnabled,
): string | null {
  if (!isSafeVersion(current) || !isSafeVersion(latest)) return null;
  if (compareVersions(latest, current) <= 0) return null;
  const lines = [
    `awwwards-mcp: update available — v${latest} (running v${current}).`,
    autoUpdateEnabled
      ? willAttempt
        ? `awwwards-mcp: auto-update is enabled; attempting to install v${latest} in the background. Restart your agent after it finishes.`
        : `awwwards-mcp: an auto-update attempt for v${latest} was already made; restart if it installed, otherwise run \`npm install -g awwwards-mcp@latest\`.`
      : `awwwards-mcp: update with \`npm install -g awwwards-mcp@latest\` (or clear your npx cache), or set AWWWARDS_AUTO_UPDATE=1 to self-update on startup.`,
  ];
  return lines.join("\n");
}

/**
 * Claim the one auto-update attempt for this version inside one daily
 * interval. The lock makes the read-check-write atomic across concurrent
 * MCP server startups sharing the same cache.
 */
function claimAutoAttempt(version: string, base: CheckState): boolean {
  if (!isSafeVersion(version)) return false;
  const lockPath = `${stateFile()}.auto.lock`;
  let fd: number | undefined;
  try {
    mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 });
    try {
      const stat = statSync(lockPath);
      if (Date.now() - stat.mtimeMs > AUTO_LOCK_MS) unlinkSync(lockPath);
    } catch {
      // no stale lock
    }
    fd = openSync(lockPath, "wx", 0o600);
  } catch {
    return false;
  }
  try {
    const fresh = readState() ?? base;
    if (fresh.autoAttemptedVersion === version) return false;
    return writeState({
      ...fresh,
      latest: version,
      autoAttemptedVersion: version,
      autoAttemptedAt: Date.now(),
    });
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // best-effort unlock
      }
    }
    try {
      unlinkSync(lockPath);
    } catch {
      // already gone
    }
  }
}

/**
 * Fire-and-forget update check. Never throws, never blocks the caller:
 * registry errors, timeouts, and unwritable state files are all swallowed.
 */
export function checkForUpdate(currentVersion: string): void {
  const auto = process.env.AWWWARDS_AUTO_UPDATE === "1";
  // Skip the daily gate when auto-update is on but no latest is known yet?
  // No: state gates the fetch itself, so a fresh install always has a shot.
  const state = readState();
  if (state && Date.now() - state.checkedAt < CHECK_INTERVAL_MS) {
    if (!isSafeVersion(state.latest)) return;
    if (compareVersions(state.latest, currentVersion) <= 0) return;
    if (!auto) {
      const notice = buildUpdateNotice(currentVersion, state.latest, false);
      if (notice) console.error(notice);
      return;
    }
    // Within the interval: if opt-in was enabled after the check, make the
    // one attempt this interval allows; later startups do not retry.
    const result = runAutoUpdate(state.latest, state);
    const notice = buildUpdateNotice(currentVersion, state.latest, true, result.started);
    if (notice) console.error(notice);
    if (result.failure) console.error(result.failure);
    return;
  }

  void (async () => {
    try {
      const res = await fetch(REGISTRY_URL, {
        signal: AbortSignal.timeout(3000),
        headers: { accept: "application/json" },
      });
      if (!res.ok) return; // unpublished / registry hiccup → silent
      const data = (await res.json()) as { version?: unknown };
      if (!isSafeVersion(data?.version)) return;
      const version = data.version;
      const checkedAt = Date.now();
      if (compareVersions(version, currentVersion) <= 0) {
        writeState({ checkedAt, latest: version });
        return;
      }
      if (!auto) {
        writeState({ checkedAt, latest: version });
        const notice = buildUpdateNotice(currentVersion, version, false);
        if (notice) console.error(notice);
        return;
      }
      const result = runAutoUpdate(version, { checkedAt, latest: version });
      const notice = buildUpdateNotice(currentVersion, version, true, result.started);
      if (notice) console.error(notice);
      if (result.failure) console.error(result.failure);
    } catch {
      // offline / timeout / JSON garbage — never surface, never block
    }
  })();
}

function runAutoUpdate(
  version: string,
  base: CheckState,
): { started: boolean; failure?: string } {
  if (!claimAutoAttempt(version, base)) return { started: false };
  const child = startSelfUpdate(version);
  if (!child) {
    return {
      started: false,
      failure: `awwwards-mcp: could not start the background self-update — install manually with \`npm install -g awwwards-mcp@${version}\``,
    };
  }
  return { started: true };
}

export function selfUpdateCommand(
  version: string,
  platform: NodeJS.Platform = process.platform,
  execPath: string = process.execPath,
): {
  cmd: string;
  args: string[];
  shell: boolean;
  windowsVerbatimArguments?: boolean;
  env?: NodeJS.ProcessEnv;
} | null {
  if (!isSafeVersion(version)) return null;
  if (platform === "win32") {
    const systemRoot = process.env.SystemRoot || process.env.windir || "C:\\Windows";
    const npmCmd = join(dirname(execPath), "npm.cmd");
    if (!existsSync(npmCmd)) return null;
    return {
      cmd: join(systemRoot, "System32", "cmd.exe"),
      args: ["/d", "/s", "/c", `""${npmCmd}" install -g awwwards-mcp@${version}"`],
      shell: false,
      // Without verbatim quoting Node adds another quote layer and cmd.exe
      // exits 1 before running npm, so the old spawn silently did nothing.
      windowsVerbatimArguments: true,
    };
  }
  // GUI-launched agents often have a minimal PATH that omits nvm/Homebrew
  // bins. Prefer the npm next to the running node, then fall back to PATH.
  // npm's shebang is `#!/usr/bin/env node`, so the child needs node's dir on
  // PATH too or it can pick a different (or no) Node. Keep the system default
  // when PATH is unset rather than replacing it with only the node directory.
  const nodeDir = dirname(execPath);
  const sibling = join(nodeDir, "npm");
  const basePath = process.env.PATH || "/usr/bin:/bin";
  return {
    cmd: existsSync(sibling) ? sibling : "npm",
    args: ["install", "-g", `awwwards-mcp@${version}`],
    shell: false,
    env: {
      ...process.env,
      PATH: [nodeDir, basePath].filter(Boolean).join(delimiter),
    },
  };
}

export function startSelfUpdate(version: string): ReturnType<typeof spawn> | null {
  try {
    const command = selfUpdateCommand(version);
    if (!command) return null;
    const child = spawn(
      command.cmd,
      command.args,
      {
        detached: true,
        stdio: "ignore",
        shell: command.shell,
        windowsHide: true,
        windowsVerbatimArguments: command.windowsVerbatimArguments,
        env: command.env,
      },
    );
    child.on("error", () => {
      console.error(
        `awwwards-mcp: background self-update failed to start — install manually with \`npm install -g awwwards-mcp@${version}\``,
      );
    });
    child.on("exit", (code, signal) => {
      if (signal) {
        console.error(
          `awwwards-mcp: background self-update was terminated by ${signal} — install manually with \`npm install -g awwwards-mcp@${version}\``,
        );
      } else if (code !== 0) {
        console.error(
          `awwwards-mcp: background self-update exited with code ${code} — install manually with \`npm install -g awwwards-mcp@${version}\``,
        );
      }
    });
    child.unref();
    return child;
  } catch {
    return null;
  }
}
