// awwwards-verify — verdict-only CLI wrapper around verifyBuild (plan Task C4).
// NOT an MCP tool (tool count stays 25): a bin that spawns a real browser via
// verifyBuild's lazy-default deps. Output is ONE machine-parseable JSON line:
// the VerifyReport on success, {error} on failure. Exit codes: 0 pass,
// 1 warn, 2 fail, 3 error, 4 usage (malformed invocation only — an unreachable
// URL still runs the full check and exits 3 with the {error} verdict).
import type { VerifyReport } from "./verify-build.js";
import type { ViewportName } from "./viewport.js";

const USAGE =
  "usage: awwwards-verify <buildUrl> <referenceUrl> [--viewport desktop|mobile]";

export type VerifyBuildCliFn = (
  args: {
    buildUrl: string;
    referenceUrl: string;
    viewport?: ViewportName;
  },
) => Promise<VerifyReport | { error: string }>;

export interface RunVerifyCliIo {
  args: string[];
  write: (line: string) => void;
  // Injectable for offline tests; default pulls the real verifyBuild lazily-ish
  // (static import is fine — verify-build.ts itself has zero runtime deps).
  verifyBuildFn?: VerifyBuildCliFn;
}

export async function runVerifyCli({ args, write, verifyBuildFn }: RunVerifyCliIo): Promise<number> {
  const positional: string[] = [];
  let viewport: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--viewport") {
      if (i + 1 >= args.length) {
        write(JSON.stringify({ error: USAGE }));
        return 4;
      }
      viewport = args[i + 1];
      i++;
    } else if (args[i].startsWith("--viewport=")) {
      viewport = args[i].slice("--viewport=".length);
    } else {
      positional.push(args[i]);
    }
  }
  if (positional.length !== 2 || (viewport !== undefined && viewport !== "desktop" && viewport !== "mobile")) {
    write(JSON.stringify({ error: USAGE }));
    return 4;
  }
  try {
    // Lazy import keeps playwright untouched until a run actually starts.
    const verify =
      verifyBuildFn ??
      ((verifyArgs: { buildUrl: string; referenceUrl: string; viewport?: ViewportName }) =>
        import("./verify-build.js").then((m) => m.verifyBuild(verifyArgs)));
    const report = await verify({
      buildUrl: positional[0],
      referenceUrl: positional[1],
      viewport: viewport as ViewportName | undefined,
    });
    write(JSON.stringify(report));
    if ("verdict" in report) {
      return report.verdict === "pass" ? 0 : report.verdict === "warn" ? 1 : 2;
    }
    return 3;
  } catch (err) {
    write(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    return 3;
  }
}

// Main guard (house pattern): only run when this compiled file is the entry,
// so tests can import runVerifyCli without side effects.
if (process.argv[1]?.replace(/\\/g, "/").endsWith("verify-cli.js")) {
  runVerifyCli({
    args: process.argv.slice(2),
    write: (line) => process.stdout.write(line + "\n"),
  }).then((code) => {
    process.exitCode = code;
  });
}
