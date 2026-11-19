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

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { homedir } from "node:os";

const REGISTRY_URL = "https://registry.npmjs.org/awwwards-mcp/latest";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

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

function writeState(state: CheckState): void {
  try {
    mkdirSync(join(stateFile(), ".."), { recursive: true, mode: 0o700 });
    writeFileSync(stateFile(), JSON.stringify(state), { mode: 0o600 });
  } catch {
    // notification is best-effort; an unwritable cache dir is fine
  }
}

export function buildUpdateNotice(
  current: string,
  latest: string,
  autoUpdateEnabled: boolean,
  willAttempt = autoUpdateEnabled,
): string | null {
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
 * Fire-and-forget update check. Never throws, never blocks the caller:
 * registry errors, timeouts, and unwritable state files are all swallowed.
 */
export function checkForUpdate(currentVersion: string): void {
  const auto = process.env.AWWWARDS_AUTO_UPDATE === "1";
  // Skip the daily gate when auto-update is on but no latest is known yet?
  // No: state gates the fetch itself, so a fresh install always has a shot.
  const state = readState();
  if (state && Date.now() - state.checkedAt < CHECK_INTERVAL_MS) {
    // within the interval: reuse the known latest and, when opt-in was enabled
    // after the check, still make the one attempt this interval allows.
    if (state.latest) {
      const willAttempt = auto && state.autoAttemptedVersion !== state.latest;
      const notice = buildUpdateNotice(currentVersion, state.latest, auto, willAttempt);
      if (notice) console.error(notice);
      if (notice && willAttempt) attemptAutoUpdate(state.latest, state);
    }
    return;
  }

  void (async () => {
    try {
      const res = await fetch(REGISTRY_URL, {
        signal: AbortSignal.timeout(3000),
        headers: { accept: "application/json" },
      });
      if (!res.ok) return; // unpublished / registry hiccup → silent
      const data = (await res.json()) as { version?: string };
      if (!data?.version || !SAFE_VERSION.test(data.version)) return;
      const next: CheckState = { checkedAt: Date.now(), latest: data.version };
      writeState(next);
      const notice = buildUpdateNotice(currentVersion, data.version, auto, auto);
      if (notice) console.error(notice);
      if (notice && auto) attemptAutoUpdate(data.version, next);
    } catch {
      // offline / timeout / JSON garbage — never surface, never block
    }
  })();
}

function attemptAutoUpdate(version: string, state: CheckState): void {
  if (startSelfUpdate(version)) {
    writeState({
      ...state,
      autoAttemptedVersion: version,
      autoAttemptedAt: Date.now(),
    });
    return;
  }
  console.error(
    `awwwards-mcp: could not start the background self-update — install manually with \`npm install -g awwwards-mcp@${version}\``,
  );
}

// npm/npx are .cmd shims on Windows. Spawning npm.cmd with shell:true emits
// DEP0190 on modern Node, so run the validated install through cmd.exe's /c
// form with shell:false. The registry-provided version is validated first, so
// no shell syntax can reach the command line.
const SAFE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

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
  if (!SAFE_VERSION.test(version)) return null;
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
  // PATH too or it can pick a different (or no) Node.
  const nodeDir = dirname(execPath);
  const sibling = join(nodeDir, "npm");
  return {
    cmd: existsSync(sibling) ? sibling : "npm",
    args: ["install", "-g", `awwwards-mcp@${version}`],
    shell: false,
    env: {
      ...process.env,
      PATH: [nodeDir, process.env.PATH].filter(Boolean).join(delimiter),
    },
  };
}

export function startSelfUpdate(version: string): boolean {
  try {
    const command = selfUpdateCommand(version);
    if (!command) return false;
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
    return true;
  } catch {
    return false;
  }
}
