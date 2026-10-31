#!/usr/bin/env node
// awwwards-build-project — build_project CLI wrapper (plan Task 3). Output is
// ONE machine-parseable JSON line: {outDir, target, files, warnings} on
// success, {error} on failure. Exit codes: 0 ok, 2 usage (malformed args),
// 3 io (unreadable html, unwritable out, thrown error). The MCP build_project
// handler calls buildProject() itself — this bin exists for agents on plain
// CLIs; verify-cli's shape (DI fn, main guard) is mirrored exactly.
import { isCliEntry } from "./cli-entry.js";
import { parseBuildArgs, buildProject, type BuildProjectFn } from "./build-project.js";

export type { BuildProjectFn };

export interface RunBuildProjectCliIo {
  args: string[];
  write: (line: string) => void;
  // Injectable for offline tests; default is the real buildProject.
  buildFn?: BuildProjectFn;
}

export async function runBuildProjectCli({ args, write, buildFn }: RunBuildProjectCliIo): Promise<number> {
  const parsed = parseBuildArgs(args);
  if ("error" in parsed) {
    write(JSON.stringify({ error: parsed.error }));
    return 2;
  }
  try {
    const result = await (buildFn ?? buildProject)(parsed);
    write(JSON.stringify(result));
    return "error" in result ? 3 : 0;
  } catch (err) {
    write(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    return 3;
  }
}

// Main guard (house pattern): only run when this file is the entry, so tests
// can import runBuildProjectCli without side effects. isCliEntry follows npm's
// extensionless bin symlink and the advertised alias.
if (
  isCliEntry(import.meta.url, process.argv[1], [
    "awwwards-build-project",
    "build-project-cli.js",
    "build-project-cli.ts",
  ])
) {
  runBuildProjectCli({
    args: process.argv.slice(2),
    write: (line) => process.stdout.write(line + "\n"),
  }).then((code) => {
    process.exitCode = code;
  });
}
