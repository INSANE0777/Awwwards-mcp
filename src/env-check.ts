// Environment probe: at startup (once per day), report whether the optional
// heavy deps the live-capture and motion tools need are actually usable, so
// the agent learns about a missing playwright/ffmpeg BEFORE a capture fails
// mid-task instead of after. Companion to version-check.ts; same constraints
// of a stdio MCP server:
//   - stdout is the JSON-RPC channel → notices go to stderr only
//   - serving must never wait on this → fire-and-forget, per-step timeouts,
//     every failure swallowed (missing module, crashed spawn, dead FS)
//   - at most one probe per day per machine (state in the cache dir)
// A real chromium launch is mandatory — import("playwright") succeeding does
// NOT mean the browser binary is present (the browsers are a separate
// download into the user's cache; the exact failure class this catches).
//
// cwd note: the probe spawns `node -e` from THIS package's root, because
// `node -e` resolves modules from cwd — walking up from a random MCP-client
// cwd would miss a globally-installed playwright/ffmpeg, which the package
// itself resolves fine from dist/../node_modules up to the global root.

import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

// dist/env-check.js → one level up is the package root (the repo root in dev).
const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));

type CheckState = { checkedAt: number };

export function envStateFile(): string {
  const cacheRoot =
    process.env.AWWWARDS_CACHE_DIR ?? join(homedir(), ".awwwards-mcp");
  return join(cacheRoot, "env-check.json");
}

function readState(): CheckState | null {
  try {
    if (!existsSync(envStateFile())) return null;
    return JSON.parse(readFileSync(envStateFile(), "utf8")) as CheckState;
  } catch {
    return null;
  }
}

function writeState(): void {
  try {
    mkdirSync(dirname(envStateFile()), { recursive: true });
    writeFileSync(envStateFile(), JSON.stringify({ checkedAt: Date.now() }));
  } catch {
    /* state is an optimization; unwritable state just means we probe again */
  }
}

export const ENV_FIX_HINTS = {
  playwright:
    "awwwards-mcp: live capture/analyze/motion tools need Playwright — run:  npm install -g playwright && npx playwright install chromium  (restart your agent afterward)\n",
  ffmpeg:
    "awwwards-mcp: motion recording needs ffmpeg-static — run:  npm install -g ffmpeg-static  (restart your agent afterward)\n",
} as const;

function run(
  cmd: string,
  args: string[],
  timeoutMs: number,
): Promise<{ code: number | null; out: string }> {
  return new Promise((res) => {
    try {
      const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], cwd: pkgRoot });
      let out = "";
      const timer = setTimeout(() => child.kill(), timeoutMs);
      child.stdout.on("data", (d) => (out += String(d)));
      child.stderr.on("data", (d) => (out += String(d)));
      child.on("close", (code) => {
        clearTimeout(timer);
        res({ code, out: out.slice(0, 300) });
      });
      child.on("error", () => {
        clearTimeout(timer);
        res({ code: null, out: "" });
      });
    } catch {
      res({ code: null, out: "" });
    }
  });
}

const LAUNCH_SCRIPT =
  'import("playwright").then(m=>m.chromium.launch()).then(b=>b.close()).then(()=>console.log("ok"))' +
  '.catch(e=>{console.error(e.message);process.exit(1)})';
const FFMPEG_SCRIPT =
  'import("ffmpeg-static").then(m=>console.log(m.default??m)).catch(()=>process.exit(1))';

async function defaultProbe(): Promise<boolean> {
  const pw = await run(process.execPath, ["-e", LAUNCH_SCRIPT], 30_000);
  if (pw.code !== 0)
    console.error(ENV_FIX_HINTS.playwright + (pw.out ? `  last error: ${pw.out}` : ""));

  const ff = await run(process.execPath, ["-e", FFMPEG_SCRIPT], 10_000);
  if (ff.code !== 0) console.error(ENV_FIX_HINTS.ffmpeg);

  // A flaky chromium launch (first-run policy, AV scan) must not crash the
  // probe — it just counts as a failure, so tomorrow still re-checks.
  return pw.code === 0 && ff.code === 0;
}

/**
 * Once a day, probe playwright + ffmpeg from the server's own install
 * location. Fire-and-forget; stdout untouched; every failure swallowed.
 * `probe` is injectable for tests; resolves with true on a healthy env,
 * false/throw when unusable — the scheduler records state on true only.
 */
export function checkEnvironment(opts?: { probe?: () => Promise<boolean | void> }): void {
  const state = readState();
  if (state && Date.now() - state.checkedAt < CHECK_INTERVAL_MS) return;
  // Fire-and-forget AND swallow-everything: a rejected probe must not surface
  // as an unhandled rejection or break server startup.
  const probe = opts?.probe ?? defaultProbe;
  void probe()
    .then((healthy) => {
      if (healthy === true) writeState();
    })
    .catch(() => {});
}
