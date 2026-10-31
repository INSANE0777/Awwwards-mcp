// Packaged-install smoke: builds, packs, installs the tarball into a throwaway
// global prefix, then runs every advertised bin through its installed alias.
// It also proves the documented browser layout: playwright/ffmpeg-static as
// siblings in the same global node_modules resolve from the package's own
// dist files. Bounded by per-child timeouts; the temp prefix is always removed.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WIN = process.platform === "win32";
const NPM = WIN ? "npm.cmd" : "npm";
const TIMEOUT_MS = 120_000;
const PKG = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

const quoteWin = (args) => args.map((arg) => (/[\s"]/.test(arg) ? `"${arg}"` : arg));

function run(cmd, args, opts = {}) {
  // npm/npx are .cmd shims on Windows: run one explicit cmd.exe line.
  // (Passing an args array with shell:true triggers Node's DEP0190 warning.)
  if (WIN) {
    const line = [cmd, ...quoteWin(args)].join(" ");
    return spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", line], {
      encoding: "utf8",
      timeout: TIMEOUT_MS,
      windowsVerbatimArguments: true,
      ...opts,
    });
  }
  return spawnSync(cmd, args, { encoding: "utf8", timeout: TIMEOUT_MS, ...opts });
}

function step(label, result) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`${label} exited ${result.status}\n${result.stdout ?? ""}${result.stderr ?? ""}`);
  }
  return result;
}

function runBin(binPath, args, env) {
  const opts = { encoding: "utf8", timeout: TIMEOUT_MS, env };
  // The installed alias is a .cmd shim on Windows; the doubled quotes let
  // cmd.exe /s keep the quoted path (which may contain spaces) intact.
  if (WIN) {
    const line = `""${binPath}"${args.length ? " " + quoteWin(args).join(" ") : ""}"`;
    return spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", line], {
      ...opts,
      windowsVerbatimArguments: true,
    });
  }
  return spawnSync(binPath, args, opts);
}

function main() {
  console.log("pack-smoke: build");
  step("npm run build", run(NPM, ["run", "build"], { cwd: ROOT }));

  for (const [name, target] of Object.entries(PKG.bin)) {
    const first = readFileSync(join(ROOT, target), "utf8").split("\n")[0];
    if (first !== "#!/usr/bin/env node") {
      throw new Error(`${name}: ${target} lost its shebang after tsc (got ${JSON.stringify(first)})`);
    }
  }

  const temp = mkdtempSync(join(tmpdir(), "awwwards-pack-smoke-"));
  try {
    console.log("pack-smoke: pack");
    const packed = JSON.parse(
      step("npm pack", run(NPM, ["pack", "--json", "--pack-destination", temp], { cwd: ROOT }))
        .stdout,
    );
    const tarball = join(temp, packed[0].filename);

    console.log("pack-smoke: global side-by-side install");
    const prefix = join(temp, "prefix");
    mkdirSync(prefix, { recursive: true });
    const install = (args) =>
      step(`npm install ${args.join(" ")}`, run(NPM, ["install", "-g", "--prefix", prefix, ...args], { cwd: ROOT }));
    install(["--no-audit", "--no-fund", "--ignore-scripts", tarball]);

    const globalRoot = step("npm root -g", run(NPM, ["root", "-g", "--prefix", prefix], { cwd: ROOT })).stdout.trim();
    const globalPrefix = step("npm prefix -g", run(NPM, ["prefix", "-g", "--prefix", prefix], { cwd: ROOT })).stdout.trim();
    const binDir = WIN ? globalPrefix : join(globalPrefix, "bin");
    const pkgDir = join(globalRoot, PKG.name);
    if (!existsSync(join(pkgDir, "package.json"))) {
      throw new Error(`installed package missing at ${pkgDir}`);
    }

    console.log("pack-smoke: advertised bins");
    const cacheFile = join(temp, "cache-is-a-file");
    writeFileSync(cacheFile, "");
    const env = { ...process.env, AWWWARDS_CACHE_DIR: join(temp, "cache") };
    const cases = [
      { bin: "awwwards-verify", args: [], status: 4, stdout: "usage: awwwards-verify" },
      { bin: "awwwards-build-project", args: [], status: 2, stdout: "usage: awwwards-build-project" },
      { bin: "awwwards-index", args: ["--elements"], status: 2, stderr: "retired" },
      {
        bin: "awwwards-mcp",
        args: [],
        // A path that is a file forces the documented startup error; it proves
        // the entry ran without starting a crawl or a stdio server.
        env: { ...env, AWWWARDS_CACHE_DIR: cacheFile },
        status: 1,
        stderr: "cannot initialize cache",
      },
    ];
    for (const testCase of cases) {
      const candidates = WIN
        ? [join(binDir, `${testCase.bin}.cmd`), join(binDir, testCase.bin)]
        : [join(binDir, testCase.bin)];
      const binPath = candidates.find((candidate) => existsSync(candidate));
      if (!binPath) throw new Error(`${testCase.bin}: installed executable missing (${candidates.join(", ")})`);
      if (!WIN && (statSync(binPath).mode & 0o111) === 0) {
        throw new Error(`${testCase.bin}: ${binPath} is not executable`);
      }
      const result = runBin(binPath, testCase.args, testCase.env ?? env);
      if (result.error) throw new Error(`${testCase.bin}: ${result.error.message}`);
      const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
      if (result.status === 0 || output.trim() === "") {
        throw new Error(
          `${testCase.bin}: silent exit ${result.status} (expected ${testCase.status}); ` +
            `the entry guard did not run the CLI`,
        );
      }
      if (result.status !== testCase.status) {
        throw new Error(`${testCase.bin}: exit ${result.status}, expected ${testCase.status}\n${output}`);
      }
      if (testCase.stdout && !result.stdout.includes(testCase.stdout)) {
        throw new Error(`${testCase.bin}: stdout missing ${JSON.stringify(testCase.stdout)}\n${output}`);
      }
      if (testCase.stderr && !result.stderr.includes(testCase.stderr)) {
        throw new Error(`${testCase.bin}: stderr missing ${JSON.stringify(testCase.stderr)}\n${output}`);
      }
      console.log(`  ${testCase.bin}: exit ${result.status}, non-silent`);
    }

    console.log("pack-smoke: browser side-by-side layout");
    const stub = (name, source) => {
      const dir = join(globalRoot, name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name, version: "0.0.0", type: "module", exports: "./index.js" }),
      );
      writeFileSync(join(dir, "index.js"), source);
    };
    stub("playwright", 'export const STUB = "playwright";\n');
    stub("ffmpeg-static", 'export default "ffmpeg-static";\n');
    const probe = join(pkgDir, "layout-probe.mjs");
    writeFileSync(
      probe,
      'const pw = await import("playwright");\n' +
        'const ff = await import("ffmpeg-static");\n' +
        'console.log(JSON.stringify({ playwright: pw.STUB, ffmpeg: ff.default }));\n',
    );
    const probeResult = step("layout probe", run(process.execPath, [probe], { cwd: pkgDir }));
    const resolved = JSON.parse(probeResult.stdout);
    if (resolved.playwright !== "playwright" || resolved.ffmpeg !== "ffmpeg-static") {
      throw new Error(`side-by-side imports did not resolve: ${probeResult.stdout}`);
    }
    console.log("  playwright + ffmpeg-static resolve from the package's own install");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }

  console.log("pack-smoke: PASS");
}

main();
