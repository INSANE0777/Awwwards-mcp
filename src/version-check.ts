// Update notification: once a day, compare the running version against the
// npm registry and (optionally) self-update. Designed around the constraints
// of a stdio MCP server:
//   - stdout is the JSON-RPC channel → every notice goes to stderr only
//   - serving must never wait on this → fire-and-forget, 3s timeout,
//     every failure swallowed (registry unreachable / package unpublished)
//   - cache each successful registry check for 24 hours
// Auto-update is strictly opt-in: AWWWARDS_AUTO_UPDATE=1 runs
// `npm install -g awwwards-mcp@<latest>` detached, then asks the user to
// restart their agent; without the env var, the notice just tells the agent.

import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { delimiter, dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { homedir } from "node:os";

const REGISTRY_URL = "https://registry.npmjs.org/awwwards-mcp/latest";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

// npm/npx are .cmd shims on Windows. Spawning npm.cmd with shell:true emits
// DEP0190 on modern Node, so run the validated install through cmd.exe's /c
// form with shell:false. The registry-provided version is validated first, so
// no shell syntax can reach the command line.
const SAFE_VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export function isSafeVersion(value: unknown): value is string {
  // npm's SemVer parser also bounds the length and the core numbers.
  if (typeof value !== "string" || value.length > 256) return false;
  const match = SAFE_VERSION.exec(value);
  return match !== null
    && match.slice(1, 4).every((part) => Number.isSafeInteger(Number(part)))
    && !match[4]?.split(".").some((id) => /^0\d+$/.test(id));
}

/** npm resolves build metadata to the same package version. */
export function canonicalVersion(version: string): string {
  return version.split("+", 1)[0];
}

function isRegularFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isExecutableFile(path: string): boolean {
  if (!isRegularFile(path)) return false;
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Split a Windows PATH into directories. Quotes protect semicolons in a
 * directory name, and only fully qualified entries are usable: drive-relative
 * forms such as `C:npm` resolve against the cwd.
 */
function windowsPathEntries(path: string): string[] {
  const entries: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of path) {
    if (char === '"') quoted = !quoted;
    else if (char === ";" && !quoted) {
      entries.push(current);
      current = "";
    } else current += char;
  }
  entries.push(current);
  return entries.filter((entry) =>
    /^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/.test(entry),
  );
}

/**
 * Resolve npm.cmd through PATH only. A bare `npm` handed to cmd.exe would be
 * searched in the inherited working directory first, so a project-local
 * npm.cmd could run instead of the installed one.
 */
function findNpmOnPath(): string | null {
  for (const dir of windowsPathEntries(process.env.PATH || "")) {
    const candidate = join(dir, "npm.cmd");
    if (isRegularFile(candidate)) return candidate;
  }
  return null;
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

type AutoClaim = "claimed" | "already-claimed" | "busy";
type UpdateNotice = Exclude<AutoClaim, "claimed"> | "manual" | "spawned";

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
  const path = stateFile();
  const temp = `${path}.${randomUUID()}.tmp`;
  const payload = JSON.stringify(state);
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  } catch {
    return;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      writeFileSync(temp, payload, { mode: 0o600 });
      renameSync(temp, path);
      return;
    } catch {
      // A reader on Windows can briefly block replacement. Retrying leaves
      // the previous valid JSON intact if the handle stays open.
      if (attempt < 2) {
        try {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        } catch {
          // no shared memory; continue immediately
        }
      }
    }
  }
  try {
    unlinkSync(temp);
  } catch {
    // already renamed or never written
  }
}

export function buildUpdateNotice(
  current: string,
  latest: string,
  outcome: UpdateNotice,
): string | null {
  if (!isSafeVersion(current) || !isSafeVersion(latest)) return null;
  if (compareVersions(latest, current) <= 0) return null;
  const messages = {
    manual: `update with \`npm install -g awwwards-mcp@latest\` (or clear your npx cache), or set AWWWARDS_AUTO_UPDATE=1 to self-update on startup.`,
    spawned: `auto-update is enabled; attempting to install v${latest} in the background. Restart your agent after it finishes.`,
    "already-claimed": `an auto-update attempt for v${latest} is already reserved; restart if it installed, otherwise run \`npm install -g awwwards-mcp@latest\`.`,
    busy: `the auto-update cache is busy or unavailable; install manually with \`npm install -g awwwards-mcp@latest\`.`,
  };
  return `awwwards-mcp: update available — v${latest} (running v${current}).\nawwwards-mcp: ${messages[outcome]}`;
}

function claimAutoAttempt(version: string, state: CheckState | null): AutoClaim {
  const canonical = canonicalVersion(version);
  if (
    isSafeVersion(state?.autoAttemptedVersion) &&
    canonicalVersion(state.autoAttemptedVersion) === canonical
  ) {
    return "already-claimed";
  }

  const versionHash = createHash("sha256").update(canonical).digest("hex");
  const path = `${stateFile()}.auto-${versionHash}`;
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  } catch {
    return "busy";
  }
  // Keep the exclusive claim even if the process dies before npm spawns.
  try {
    closeSync(openSync(path, "wx", 0o600));
    return "claimed";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EEXIST" ? "already-claimed" : "busy";
  }
}

/**
 * Fire-and-forget update check. Never throws, never blocks the caller:
 * registry errors, timeouts, and unwritable state files are all swallowed.
 */
export function checkForUpdate(currentVersion: string): void {
  if (!isSafeVersion(currentVersion)) return;
  const auto = process.env.AWWWARDS_AUTO_UPDATE === "1";
  const state = readState();
  if (state && Date.now() - state.checkedAt < CHECK_INTERVAL_MS) {
    if (isSafeVersion(state.latest)) {
      reportUpdate(currentVersion, state.latest, auto, state);
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
      const data = (await res.json()) as { version?: unknown };
      if (!isSafeVersion(data?.version)) return;
      const version = data.version;
      const refreshed: CheckState = { checkedAt: Date.now(), latest: version };
      // Carry forward reservations written by previous versions.
      if (isSafeVersion(state?.autoAttemptedVersion) && typeof state.autoAttemptedAt === "number") {
        refreshed.autoAttemptedVersion = state.autoAttemptedVersion;
        refreshed.autoAttemptedAt = state.autoAttemptedAt;
      }
      writeState(refreshed);
      reportUpdate(currentVersion, version, auto, refreshed);
    } catch {
      // offline / timeout / JSON garbage — never surface, never block
    }
  })();
}

function reportUpdate(
  current: string,
  version: string,
  auto: boolean,
  state: CheckState | null,
): void {
  if (compareVersions(version, current) <= 0) return;
  const report = (outcome: UpdateNotice) => {
    const notice = buildUpdateNotice(current, version, outcome);
    if (notice) console.error(notice);
  };
  const claim = auto ? claimAutoAttempt(version, state) : "manual";
  if (claim !== "claimed") {
    report(claim);
    return;
  }
  const child = startSelfUpdate(version);
  if (child) {
    child.once("spawn", () => report("spawned"));
  } else {
    console.error(
      `awwwards-mcp: could not start the background self-update — install manually with \`npm install -g awwwards-mcp@${version}\``,
    );
  }
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
  cwd?: string;
  env?: NodeJS.ProcessEnv;
} | null {
  if (!isSafeVersion(version)) return null;
  if (platform === "win32") {
    const systemRoot = process.env.SystemRoot || process.env.windir || "C:\\Windows";
    const nodeDir = dirname(execPath);
    const sibling = join(nodeDir, "npm.cmd");
    // Prefer the Node-adjacent shim, then PATH; never a bare npm command.
    const npmCmd = isRegularFile(sibling) ? sibling : findNpmOnPath();
    if (!npmCmd) return null;
    const basePath = process.env.PATH || "";
    return {
      cmd: join(systemRoot, "System32", "cmd.exe"),
      args: [
        "/d",
        "/s",
        "/v:off",
        "/c",
        // The shim path travels through the child environment because cmd.exe
        // expands %NAME% text inside a literal path, and /v:off keeps `!`
        // literal even when the host enables delayed expansion.
        `""%NPM_CMD%" install -g awwwards-mcp@${version}"`,
      ],
      shell: false,
      // Without verbatim quoting Node adds another quote layer and cmd.exe
      // exits 1 before running npm, so the old spawn silently did nothing.
      windowsVerbatimArguments: true,
      // A PATH-selected shim may call bare `node`; run next to the running
      // node and put that directory first so neither resolves via the cwd.
      cwd: nodeDir,
      env: {
        ...process.env,
        NPM_CMD: npmCmd,
        PATH: [nodeDir, basePath].filter(Boolean).join(";"),
      },
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
    cmd: isExecutableFile(sibling) ? sibling : "npm",
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
        cwd: command.cwd,
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
