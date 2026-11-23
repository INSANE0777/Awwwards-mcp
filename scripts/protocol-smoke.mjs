#!/usr/bin/env node
// Protocol smoke: both MCP eras, every profile surface for the current Atlas
// flag, representative tool calls, typed failures, output-schema success/error
// (core drives one real verify_build pair, so core sessions need Chromium),
// annotations, cancellation (full/v2) and a clean stdout channel. Each session
// runs against its own temp cache under the OS temp directory; the seeded
// index:status timestamp is read back through a tool call, so a fallback to the
// user's real cache fails the run. It also fails on stdout noise, trailing or
// partial lines, wrong/duplicate/missing response ids, blocked egress, a
// non-terminating child, or leftover temp state.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { GUARD_MARKER } from "./egress-guard-marker.cjs";

const argv = process.argv.slice(2);
const dumpIndex = argv.indexOf("--dump-catalog");
const DUMP_PATH = dumpIndex >= 0 ? resolve(argv[dumpIndex + 1] ?? "") : null;
if (dumpIndex >= 0 && !argv[dumpIndex + 1]) {
  console.error("usage: protocol-smoke.mjs [cli.js] --dump-catalog <path>");
  process.exit(2);
}
// Without --dump-catalog every argument is positional and the first is the
// candidate CLI. The pre-catalog script read argv[2]; stripping only the dump
// flags keeps that old invocation working, while an unconditional filter used
// to drop the first positional and silently test dist/cli.js instead.
const positional =
  dumpIndex >= 0 ? argv.filter((_, index) => index !== dumpIndex && index !== dumpIndex + 1) : argv;
const CLI = resolve(positional[0] ?? "dist/cli.js");
const GUARD = resolve("scripts/v2-eval-no-egress.cjs");
const CATALOG_BASELINE = resolve("scripts/fixtures/protocol-catalog.json");
// Core now launches Chromium for verify_build, so a cold v2 initialize can
// exceed 20 s on a loaded Windows runner; a wrong candidate still fails fast
// because a dead child rejects pending requests immediately.
export const REQUEST_TIMEOUT_MS = 30_000;
// verify_build launches several browsers and runs a 6 s perf window; a cold
// Windows run measured ~38 s and a loaded one exceeded the old 60 s cap, so
// this call gets an explicit bounded budget instead of the request default.
export const CORE_VERIFY_TIMEOUT_MS = 120_000;
// Must outlast the cancelled call's own timeout: a server that ignores the
// cancellation answers when the call times out, inside this window.
export const CANCEL_SETTLE_MS = 2_500;
export const CANCELLED_CALL_TIMEOUT_MS = 1_000;
const MODERN = "2026-07-28";
const LEGACY = "2025-06-18";
const ATLAS = process.env.AWWWARDS_MCP_ATLAS === "1";
const PKG = JSON.parse(readFileSync("package.json", "utf8"));
const SURFACES = { full: ATLAS ? 46 : 42, core: 14, v2: ATLAS ? 16 : 15 };
const ATLAS_FLAT = ["search_atlas", "get_atlas", "capture_atlas", "export_evidence_pack"];
const ANNOTATIONS = ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"];
const BUDGET = 200;
const META = {
  _meta: {
    "io.modelcontextprotocol/protocolVersion": MODERN,
    "io.modelcontextprotocol/clientCapabilities": {},
  },
};

const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

let fixtureServer;
let fixtureBase;
const tempDirs = [];

function prepareCache(label) {
  const dir = mkdtempSync(join(tmpdir(), `awwwards-protocol-${label}-`));
  tempDirs.push(dir);
  assert(
    realpathSync(dir).startsWith(`${realpathSync(tmpdir())}${sep}`),
    `cache ${dir} is not under the OS temp directory`,
  );
  assert(resolve(dir) !== resolve(join(homedir(), ".awwwards-mcp")), "cache resolves to the real user cache");
  const now = Date.now();
  const finishedAt = now - 60_000 - tempDirs.length;
  writeFileSync(join(dir, "version-check.json"), JSON.stringify({ checkedAt: now, latest: PKG.version }));
  writeFileSync(join(dir, "env-check.json"), JSON.stringify({ checkedAt: now }));
  return { dir, finishedAt };
}

async function seedCache(dir, finishedAt) {
  const { Cache } = await import(pathToFileURL(resolve("dist/cache.js")).href);
  new Cache(dir).setMeta("index:status", {
    finishedAt,
    pagesDone: 1,
    pagesTotal: 1,
    sitesIndexed: 0,
    skipped: 0,
  });
}

function startClient({ dir, profile, label, extraEnv = {} }) {
  const env = {
    ...process.env,
    AWWWARDS_CACHE_DIR: dir,
    AWWWARDS_MCP_PROFILE: profile,
    AWWWARDS_AUTO_UPDATE: "0",
    AWWWARDS_MCP_DEBUG_MEMORY: "0",
    ...extraEnv,
  };
  if (ATLAS) env.AWWWARDS_MCP_ATLAS = "1";
  else {
    delete env.AWWWARDS_MCP_ATLAS;
    delete env.AWARDS_MCP_ATLAS;
  }
  const child = spawn(process.execPath, ["--require", GUARD, CLI], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32",
  });

  const pending = new Map();
  const responded = new Set();
  const problems = [];
  let buffer = "";
  let stderr = "";
  let nextId = 1;
  let exit = null;
  let closed = false;
  let spawnError = null;

  const exitPromise = new Promise((done) => {
    child.once("exit", (code, signal) => {
      exit = { code, signal };
      // A dead child can never answer; fail pending calls now instead of
      // letting a wrong candidate path look like a 20-second timeout.
      for (const [id, waiter] of pending) {
        clearTimeout(waiter.timer);
        pending.delete(id);
        waiter.reject(
          new Error(`${label}: child exited (code ${code} signal ${signal}) before answering ${waiter.method}`),
        );
      }
      done(exit);
    });
  });
  const closePromise = new Promise((done) => {
    child.once("close", () => {
      closed = true;
      done();
    });
  });
  child.once("error", (error) => {
    spawnError = error;
    problems.push(`${label}: child error: ${error.message}`);
  });

  const ingest = (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      problems.push(`${label}: non-JSON stdout line: ${line.slice(0, 160)}`);
      return;
    }
    if (!message || typeof message !== "object" || message.jsonrpc !== "2.0") {
      problems.push(`${label}: non-JSON-RPC stdout line: ${line.slice(0, 160)}`);
      return;
    }
    if (message.id === undefined) {
      problems.push(`${label}: unsolicited server notification: ${line.slice(0, 160)}`);
      return;
    }
    const waiter = pending.get(message.id);
    if (!waiter) {
      problems.push(
        `${label}: ${responded.has(message.id) ? "duplicate" : "unknown"} response id ${message.id}`,
      );
      return;
    }
    pending.delete(message.id);
    responded.add(message.id);
    clearTimeout(waiter.timer);
    waiter.resolve(message);
  };

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    for (;;) {
      const index = buffer.indexOf("\n");
      if (index < 0) break;
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line !== "") ingest(line);
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  function request(method, params, timeoutMs = REQUEST_TIMEOUT_MS) {
    const id = nextId++;
    const message = { jsonrpc: "2.0", id, method };
    if (params !== undefined) message.params = params;
    const promise = new Promise((resolveRequest, rejectRequest) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        rejectRequest(new Error(`${label}: ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(id, { resolve: resolveRequest, reject: rejectRequest, timer, method });
      child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
        if (!error) return;
        clearTimeout(timer);
        pending.delete(id);
        rejectRequest(new Error(`${label}: ${method} write failed: ${error.message}`));
      });
    });
    return Object.assign(promise, { id });
  }

  async function result(method, params, timeoutMs) {
    const message = await request(method, params, timeoutMs);
    if (message.error) {
      throw new Error(`${label}: ${method}: ${message.error.message ?? JSON.stringify(message.error)}`);
    }
    return message.result;
  }

  function notify(method, params) {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  function forget(id) {
    const waiter = pending.get(id);
    if (!waiter) return;
    clearTimeout(waiter.timer);
    pending.delete(id);
  }

  function killTree(force) {
    if (!child.pid) return;
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", ...(force ? ["/F"] : [])], {
        stdio: "ignore",
      });
      return;
    }
    try {
      process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM");
    } catch {
      /* already gone */
    }
  }

  async function stop() {
    const exitedEarly = exit;
    for (const [id, waiter] of pending) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(`${label}: ${waiter.method} still pending at shutdown`));
      pending.delete(id);
    }
    if (!spawnError && !exit) {
      killTree(false);
      let terminated = await Promise.race([exitPromise.then(() => true), delay(2_000).then(() => false)]);
      if (!terminated) {
        killTree(true);
        terminated = await Promise.race([exitPromise.then(() => true), delay(3_000).then(() => false)]);
      }
      if (!terminated) problems.push(`${label}: child ${child.pid} did not terminate`);
    }
    await Promise.race([closePromise, delay(2_000)]);
    if (exitedEarly && exitedEarly.code !== 0) {
      problems.push(
        `${label}: child exited early with code ${exitedEarly.code} signal ${exitedEarly.signal}`,
      );
    }
    if (buffer.length > 0) problems.push(`${label}: trailing partial stdout: ${buffer.slice(0, 160)}`);
    if (!closed) problems.push(`${label}: stdio did not close`);
    const blocks = stderr
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.includes(GUARD_MARKER));
    if (blocks.length > 0) problems.push(`${label}: blocked egress: ${blocks.join(" | ")}`);
    if (/server error|background index failed|background self-update failed/.test(stderr)) {
      problems.push(`${label}: server stderr reported an error: ${stderr.slice(0, 240)}`);
    }
    if (problems.length > 0) throw new Error(problems.join("; "));
  }

  return { request, result, notify, forget, stop, responded, get stderr() { return stderr; } };
}

function textJson(message) {
  const text = (message.result?.content ?? []).find((block) => block.type === "text")?.text;
  assert(typeof text === "string", "tool result has no text block");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`tool result text is not JSON: ${text.slice(0, 160)}`);
  }
}

function toolText(message) {
  return (message.result?.content ?? []).find((block) => block.type === "text")?.text ?? "";
}

export function assertSuccess(message, label) {
  assert(!message.error, `${label}: JSON-RPC error: ${message.error?.message ?? "unknown"}`);
  const result = message.result;
  assert(result && typeof result === "object", `${label}: missing result`);
  assert(result.isError !== true, `${label}: isError true: ${toolText(message).slice(0, 160)}`);
  assert(Array.isArray(result.content) && result.content.length > 0, `${label}: success has no content`);
  for (const block of result.content) {
    assert(block && typeof block === "object", `${label}: success content block is not an object`);
    if (block.type === "text") {
      assert(typeof block.text === "string", `${label}: text block has no text`);
    } else if (block.type === "image") {
      assert(
        typeof block.data === "string" && typeof block.mimeType === "string",
        `${label}: image block is missing data or mimeType`,
      );
    } else {
      assert(false, `${label}: unknown content block type ${String(block.type)}`);
    }
  }
  // A truncation notice is a recovery envelope for a discarded result, never a
  // successful answer, even for tools without an advertised outputSchema.
  const text = toolText(message);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  assert(!(parsed && parsed.truncated === true), `${label}: truncation notice passed as a success`);
  return result;
}

export function assertToolError(message, label) {
  assert(!message.error, `${label}: JSON-RPC error: ${message.error?.message ?? "unknown"}`);
  assert(message.result?.isError === true, `${label}: expected isError true`);
  assert(message.result.structuredContent === undefined, `${label}: error result carried structuredContent`);
  const blocks = message.result.content;
  assert(Array.isArray(blocks) && blocks.length > 0, `${label}: error has no content`);
  assert(blocks.every((block) => block?.type === "text" && typeof block.text === "string"), `${label}: error content is not text-only`);
  return toolText(message);
}

function requestMeta(era) {
  return era === "modern" ? META : {};
}

// The compatibility surface is the ordered tool catalog: names, annotation
// hints and whether an output schema is advertised. Descriptions are prose and
// are checked by documentation tests, not pinned here.
export function projectCatalog(tools) {
  return tools.map((tool) => ({
    name: tool.name,
    annotations: Object.fromEntries(ANNOTATIONS.map((hint) => [hint, tool.annotations?.[hint] ?? null])),
    outputSchema: tool.outputSchema !== undefined,
  }));
}

function firstCatalogDifference(actual, expected) {
  const length = Math.max(actual.length, expected.length);
  for (let index = 0; index < length; index++) {
    const left = actual[index];
    const right = expected[index];
    if (JSON.stringify(left) === JSON.stringify(right)) continue;
    return `index ${index}: ${JSON.stringify(left)} != ${JSON.stringify(right)}`;
  }
  return "";
}

export function assertCatalog(actual, expected, label) {
  assert(Array.isArray(actual), `${label}: catalog is not an array`);
  assert(Array.isArray(expected), `${label}: baseline catalog is not an array`);
  assert(actual.length === expected.length, `${label}: expected ${expected.length} tools, got ${actual.length}`);
  const names = actual.map((tool) => tool.name);
  assert(new Set(names).size === names.length, `${label}: duplicate tool names`);
  const difference = firstCatalogDifference(actual, expected);
  assert(difference === "", `${label}: catalog drifted at ${difference}`);
}

export function assertCacheableResultMetadata(result, era, label) {
  if (era === "modern") {
    assert(result?.resultType === "complete", `${label}: modern resultType=${JSON.stringify(result?.resultType)}`);
    assert(Number.isSafeInteger(result.ttlMs) && result.ttlMs >= 0, `${label}: ttlMs=${JSON.stringify(result.ttlMs)}`);
    assert(
      result.cacheScope === "public" || result.cacheScope === "private",
      `${label}: cacheScope=${JSON.stringify(result.cacheScope)}`,
    );
  } else {
    for (const key of ["resultType", "ttlMs", "cacheScope"]) {
      assert(!Object.hasOwn(result ?? {}, key), `${label}: legacy result unexpectedly carries ${key}`);
    }
  }
}

export function assertCallResultType(result, era, label) {
  if (era === "modern") {
    assert(result?.resultType === "complete", `${label}: tool result must be resultType complete`);
  } else {
    assert(!Object.hasOwn(result ?? {}, "resultType"), `${label}: legacy tool result must not carry resultType`);
  }
}

export function assertNoTaskCapability(capabilities, label) {
  for (const key of ["tasks", "progress"]) {
    assert(!Object.hasOwn(capabilities ?? {}, key), `${label}: server advertises ${key}`);
  }
}

const TYPE_NAME = (value) => (value === null ? "null" : Array.isArray(value) ? "array" : typeof value);

function matchesSchemaType(value, type) {
  switch (type) {
    case "object":
      return value !== null && typeof value === "object" && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "integer":
      return Number.isInteger(value);
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "null":
      return value === null;
    default:
      return typeof value === type;
  }
}

// Small structural validator for the JSON Schema subset the SDK emits from Zod
// (type, required, properties, items, anyOf/oneOf/allOf, local $ref, enum,
// numeric bounds). It is a gate on serialized output, not a general JSON
// Schema implementation; external $refs are rejected rather than ignored.
export function schemaErrors(value, schema, path = "$", root = schema) {
  if (!schema || typeof schema !== "object") return [];
  if (typeof schema.$ref === "string") {
    if (!schema.$ref.startsWith("#/")) return [`${path}: unsupported external $ref`];
    const target = schema.$ref
      .slice(2)
      .split("/")
      .reduce((node, key) => node?.[key.replace(/~1/g, "/").replace(/~0/g, "~")], root);
    if (target === undefined) return [`${path}: unresolved $ref ${schema.$ref}`];
    return schemaErrors(value, target, path, root);
  }
  const errors = [];
  if (Array.isArray(schema.allOf)) {
    for (const branch of schema.allOf) errors.push(...schemaErrors(value, branch, path, root));
  }
  const matching = (branches) =>
    branches.filter((branch) => schemaErrors(value, branch, path, root).length === 0).length;
  if (Array.isArray(schema.anyOf) && matching(schema.anyOf) === 0) {
    errors.push(`${path}: no anyOf branch matched`);
  }
  if (Array.isArray(schema.oneOf)) {
    // JSON Schema oneOf is exclusive: overlapping branches are invalid.
    const matched = matching(schema.oneOf);
    if (matched !== 1) errors.push(`${path}: expected exactly one oneOf branch, matched ${matched}`);
  }
  if (Object.hasOwn(schema, "const") && value !== schema.const) {
    errors.push(`${path}: expected const ${JSON.stringify(schema.const)}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => Object.is(item, value))) {
    errors.push(`${path}: value is not in enum`);
  }
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length > 0 && !types.some((type) => matchesSchemaType(value, type))) {
    return [...errors, `${path}: expected ${types.join("|")}, got ${TYPE_NAME(value)}`];
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) errors.push(`${path}: below minimum`);
    if (typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum) errors.push(`${path}: at or below exclusiveMinimum`);
    if (typeof schema.maximum === "number" && value > schema.maximum) errors.push(`${path}: above maximum`);
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) errors.push(`${path}.${key}: required`);
    }
    const properties = schema.properties ?? {};
    for (const [key, childSchema] of Object.entries(properties)) {
      if (Object.hasOwn(value, key)) {
        errors.push(...schemaErrors(value[key], childSchema, `${path}.${key}`, root));
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(properties, key)) errors.push(`${path}.${key}: unexpected property`);
      }
    }
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) =>
      errors.push(...schemaErrors(item, schema.items, `${path}[${index}]`, root)),
    );
  }
  return errors;
}

function assertStructuredOutput(message, result, schema, label) {
  assert(result.structuredContent && typeof result.structuredContent === "object", `${label}: missing structuredContent`);
  const errors = schemaErrors(result.structuredContent, schema, "$");
  assert(errors.length === 0, `${label}: structuredContent violates outputSchema: ${errors[0]}`);
  const fallback = textJson(message);
  assert(
    JSON.stringify(fallback) === JSON.stringify(result.structuredContent),
    `${label}: text fallback does not match structuredContent`,
  );
}

function assertSurface(tools, profile, era) {
  const label = `${profile} ${era}`;
  const names = tools.map((tool) => tool.name);
  assert(names.length === SURFACES[profile], `${label}: expected ${SURFACES[profile]} tools, got ${names.length}`);
  assert(new Set(names).size === names.length, `${label}: duplicate tool names`);
  for (const tool of tools) {
    for (const hint of ANNOTATIONS) {
      assert(typeof tool.annotations?.[hint] === "boolean", `${label}: ${tool.name} missing boolean ${hint}`);
    }
  }
  const atlasPresent = ATLAS_FLAT.filter((name) => names.includes(name));
  if (profile === "core" || !ATLAS) {
    assert(atlasPresent.length === 0, `${label}: unexpected Atlas tools ${atlasPresent.join(", ")}`);
  } else if (profile === "full") {
    assert(atlasPresent.length === ATLAS_FLAT.length, `${label}: missing Atlas tool(s)`);
  } else {
    assert(
      atlasPresent.length === 1 && atlasPresent[0] === "export_evidence_pack",
      `${label}: v2 flag-on Atlas surface should add only export_evidence_pack`,
    );
  }
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  if (profile !== "core") {
    const statusTool = profile === "v2" ? "get_index" : "get_index_status";
    assert(byName.get(statusTool)?.outputSchema, `${label}: ${statusTool} has no advertised outputSchema`);
  }
  if (ATLAS && profile === "full") {
    for (const name of ["search_atlas", "get_atlas"]) {
      assert(byName.get(name)?.annotations?.readOnlyHint === true, `${label}: ${name} must be read-only`);
      assert(byName.get(name)?.annotations?.openWorldHint === false, `${label}: ${name} must be closed-world`);
    }
    assert(byName.get("capture_atlas")?.annotations?.openWorldHint === true, `${label}: capture_atlas must be open-world`);
    assert(byName.get("capture_atlas")?.annotations?.idempotentHint === false, `${label}: capture_atlas must not be idempotent`);
    assert(byName.get("export_evidence_pack")?.annotations?.idempotentHint === true, `${label}: export_evidence_pack must be idempotent`);
  }
  if (profile === "v2") {
    assert(byName.get("capture_page")?.annotations?.readOnlyHint === false, `${label}: capture_page must not be read-only`);
  }
  return names;
}

async function handshake(client, era) {
  if (era === "legacy") {
    const init = await client.result("initialize", {
      protocolVersion: LEGACY,
      capabilities: {},
      clientInfo: { name: "protocol-smoke", version: "1" },
    });
    assert(init.protocolVersion === LEGACY, `legacy initialize: negotiated ${init.protocolVersion}`);
    assert(init.serverInfo?.name === "awwwards-mcp", "legacy initialize: serverInfo missing");
    assert(init.capabilities?.tools, "legacy initialize: tools capability missing");
    assertNoTaskCapability(init.capabilities, "legacy initialize");
    client.notify("notifications/initialized", {});
    return;
  }
  const discover = await client.result("server/discover", META);
  assert(
    Array.isArray(discover.supportedVersions) && discover.supportedVersions.includes(MODERN),
    `modern discover: supportedVersions=${JSON.stringify(discover.supportedVersions)}`,
  );
  assert(discover.capabilities?.tools, "modern discover: tools capability missing");
  assertNoTaskCapability(discover.capabilities, "modern discover");
  assertCacheableResultMetadata(discover, "modern", "modern discover");
}

async function stackSuccess(client, profile, era) {
  const meta = requestMeta(era);
  const url = `${fixtureBase}/stack`;
  const message =
    profile === "v2"
      ? await client.request("tools/call", {
          name: "inspect_page",
          arguments: { request: { kind: "stack", url, timeoutMs: 3000 } },
          ...meta,
        })
      : await client.request("tools/call", {
          name: "analyze_stack",
          arguments: { url, timeoutMs: 3000 },
          ...meta,
        });
  assertSuccess(message, `${profile} ${era}: stack call`);
  assertCallResultType(message.result, era, `${profile} ${era}: stack call`);
  const data = textJson(message);
  assert(data.framework === "next", `${profile} ${era}: stack framework=${data.framework}`);
}

async function outputSchemaSuccess(client, profile, era, finishedAt, tools) {
  if (profile === "core") return;
  const meta = requestMeta(era);
  const name = profile === "v2" ? "get_index" : "get_index_status";
  const message =
    profile === "v2"
      ? await client.request("tools/call", {
          name,
          arguments: { request: { kind: "status" } },
          ...meta,
        })
      : await client.request("tools/call", { name, arguments: {}, ...meta });
  const label = `${profile} ${era}: status call`;
  const result = assertSuccess(message, label);
  assertCallResultType(result, era, label);
  const schema = tools.find((tool) => tool.name === name)?.outputSchema;
  assert(schema, `${profile} ${era}: ${name} advertised no outputSchema`);
  assertStructuredOutput(message, result, schema, label);
  const data = textJson(message);
  assert(data.lastSuccessfulFinishAt === finishedAt, `${profile} ${era}: status read the wrong cache`);
  assert(
    result.structuredContent.lastSuccessfulFinishAt === finishedAt,
    `${profile} ${era}: structuredContent read the wrong cache`,
  );
  assert(result.structuredContent.sitesCount === 0, `${profile} ${era}: unexpected seeded site count`);
  return result;
}

// Core's only advertised output schema is verify_build. One identical
// reference/build pair per era proves the schema and text fallback agree; the
// call needs Chromium, which the release workflow installs before any suite.
async function coreSchemaSuccess(client, profile, era, tools) {
  if (profile !== "core") return;
  const label = `${profile} ${era}: verify_build`;
  const message = await client.request(
    "tools/call",
    {
      name: "verify_build",
      arguments: {
        referenceUrl: `${fixtureBase}/verify`,
        buildUrl: `${fixtureBase}/verify`,
        waitStrategy: "load",
      },
      ...requestMeta(era),
    },
    CORE_VERIFY_TIMEOUT_MS,
  );
  const result = assertSuccess(message, label);
  assertCallResultType(result, era, label);
  const schema = tools.find((tool) => tool.name === "verify_build")?.outputSchema;
  assert(schema, `${profile} ${era}: verify_build advertised no outputSchema`);
  assertStructuredOutput(message, result, schema, label);
  assert(
    result.structuredContent.referenceUrl === `${fixtureBase}/verify`,
    `${label}: structuredContent read the wrong reference`,
  );
  assert(
    ["pass", "warn", "fail"].includes(result.structuredContent.verdict),
    `${label}: verdict=${JSON.stringify(result.structuredContent.verdict)}`,
  );
  return result;
}

async function typedFailures(client, profile, era) {
  const meta = requestMeta(era);
  const invalid =
    profile === "v2"
      ? await client.request("tools/call", {
          name: "inspect_page",
          arguments: { request: { kind: "stack" } },
          ...meta,
        })
      : await client.request("tools/call", { name: "get_site_details", arguments: { slug: "" }, ...meta });
  const invalidText = assertToolError(invalid, `${profile} ${era}: validation`);
  assertCallResultType(invalid.result, era, `${profile} ${era}: validation`);
  assert(
    invalidText.startsWith("Input validation error:"),
    `${profile} ${era}: validation text=${invalidText.slice(0, 160)}`,
  );
  assert(
    invalidText.includes(profile === "v2" ? "inspect_page" : "get_site_details"),
    `${profile} ${era}: validation text does not name the tool`,
  );

  const badSchema =
    profile === "v2"
      ? await client.request("tools/call", {
          name: "get_index",
          arguments: { request: { kind: "status", extra: true } },
          ...meta,
        })
      : await client.request("tools/call", { name: "verify_build", arguments: {}, ...meta });
  assertToolError(badSchema, `${profile} ${era}: error result without structuredContent`);
  assertCallResultType(badSchema.result, era, `${profile} ${era}: schema error`);

  const unknown = await client.request("tools/call", {
    name: "__protocol_smoke_missing__",
    arguments: {},
    ...meta,
  });
  assert(unknown.error?.code === -32602, `${profile} ${era}: unknown tool should return -32602, got ${JSON.stringify(unknown.error)}`);
}

async function atlasChecks(client, profile, era) {
  const meta = requestMeta(era);
  if (!ATLAS) {
    if (profile !== "v2") return;
    const disabled = await client.request("tools/call", {
      name: "get_index",
      arguments: { request: { kind: "atlas_status" } },
      ...meta,
    });
    const result = disabled.result;
    assert(result?.isError === true, "v2 flag-off: atlas_status should fail");
    assertCallResultType(result, era, "v2 flag-off: atlas_status");
    const text = result.content?.find((block) => block.type === "text")?.text ?? "";
    assert(text.includes("FEATURE_DISABLED"), `v2 flag-off: atlas_status text=${text.slice(0, 160)}`);
    assert(result.structuredContent === undefined, "v2 flag-off: atlas_status carried structuredContent");
    return;
  }

  const status =
    profile === "v2"
      ? await client.request("tools/call", {
          name: "get_index",
          arguments: { request: { kind: "atlas_status" } },
          ...meta,
        })
      : profile === "full"
        ? await client.request("tools/call", { name: "get_atlas", arguments: { kind: "status" }, ...meta })
        : null;
  if (status) {
    const result = assertSuccess(status, `${profile} ${era}: Atlas status`);
    assertCallResultType(result, era, `${profile} ${era}: Atlas status`);
    const data = textJson(status);
    assert(data.schemaVersion === "awwwards-atlas-v1", `${profile} ${era}: Atlas status envelope missing`);
    assert(result.structuredContent?.schemaVersion === "awwwards-atlas-v1", `${profile} ${era}: Atlas status structuredContent`);
  }

  if (profile === "core") return;
  const pack = await client.request("tools/call", {
    name: "export_evidence_pack",
    arguments: { regionIds: ["0".repeat(64)] },
    ...meta,
  });
  const error = assertToolError(pack, `${profile} ${era}: export_evidence_pack`);
  assertCallResultType(pack.result, era, `${profile} ${era}: export_evidence_pack`);
  const parsed = JSON.parse(error);
  assert(parsed.error?.code === "INVALID_SELECTION", `${profile} ${era}: Atlas typed error=${parsed.error?.code}`);
}

export async function cancellation(
  client,
  profile,
  era,
  url = `${fixtureBase}/hang`,
  settleMs = CANCEL_SETTLE_MS,
) {
  if (profile === "core") return;
  const meta = requestMeta(era);
  const cancelled =
    profile === "v2"
      ? client.request("tools/call", {
          name: "inspect_page",
          arguments: { request: { kind: "stack", url, timeoutMs: CANCELLED_CALL_TIMEOUT_MS } },
          ...meta,
        })
      : client.request("tools/call", {
          name: "analyze_stack",
          arguments: { url, timeoutMs: CANCELLED_CALL_TIMEOUT_MS },
          ...meta,
        });
  client.notify("notifications/cancelled", { requestId: cancelled.id, reason: "protocol-smoke" });
  await delay(settleMs);
  assert(!client.responded.has(cancelled.id), `${profile} ${era}: cancelled request still returned a response`);
  client.forget(cancelled.id);
  const after =
    profile === "v2"
      ? await client.request("tools/call", { name: "get_index", arguments: { request: { kind: "status" } }, ...meta })
      : await client.request("tools/call", { name: "get_index_status", arguments: {}, ...meta });
  assertSuccess(after, `${profile} ${era}: call after cancellation`);
}

function loadBaseline() {
  const document = JSON.parse(readFileSync(CATALOG_BASELINE, "utf8"));
  const surfaces = document.surfaces?.[ATLAS ? "on" : "off"];
  assert(surfaces, `${CATALOG_BASELINE} has no ${ATLAS ? "on" : "off"} surface catalog`);
  return surfaces;
}

async function runSession(profile, era, expected) {
  const label = `${profile} ${era}`;
  const { dir, finishedAt } = prepareCache(`${profile}-${era}`);
  try {
    await seedCache(dir, finishedAt);
    const client = startClient({ dir, profile, label });
    try {
      await handshake(client, era);
      // The catalog is listed twice before any tool call: the first response
      // must match the pinned 1.20 surface, and the second must reproduce it
      // exactly (ordering, annotations, output-schema advertisement).
      const first = await client.result("tools/list", era === "modern" ? META : {});
      assert(Array.isArray(first.tools), `${label}: tools/list missing tools`);
      assertSurface(first.tools, profile, era);
      assertCacheableResultMetadata(first, era, `${label}: tools/list`);
      const baselineCatalog = projectCatalog(first.tools);
      assertCatalog(baselineCatalog, expected, `${label}: baseline catalog`);
      const repeatedCatalog = await client.result("tools/list", era === "modern" ? META : {});
      assert(Array.isArray(repeatedCatalog.tools), `${label}: second tools/list missing tools`);
      assertCacheableResultMetadata(repeatedCatalog, era, `${label}: second tools/list`);
      assertCatalog(projectCatalog(repeatedCatalog.tools), baselineCatalog, `${label}: repeated catalog`);
      await stackSuccess(client, profile, era);
      await outputSchemaSuccess(client, profile, era, finishedAt, first.tools);
      await coreSchemaSuccess(client, profile, era, first.tools);
      await typedFailures(client, profile, era);
      await atlasChecks(client, profile, era);
      await cancellation(client, profile, era);
    } finally {
      await client.stop();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    const index = tempDirs.indexOf(dir);
    if (index >= 0) tempDirs.splice(index, 1);
  }
}

// One real stdio call per era with a deliberately tiny ceiling: the guard must
// replace the seeded status payload with the fixed error notice, not a success.
async function overBudgetSession(era) {
  const label = `budget ${era}`;
  const { dir, finishedAt } = prepareCache(`budget-${era}`);
  try {
    await seedCache(dir, finishedAt);
    const client = startClient({
      dir,
      profile: "full",
      label,
      extraEnv: { AWWWARDS_MCP_MAX_RESPONSE_BYTES: String(BUDGET) },
    });
    try {
      await handshake(client, era);
      const message = await client.request("tools/call", {
        name: "get_index_status",
        arguments: {},
        ...requestMeta(era),
      });
      const notice = assertToolError(message, label);
      assertCallResultType(message.result, era, label);
      const parsed = JSON.parse(notice);
      assert(parsed.truncated === true, `${label}: missing truncated:true`);
      assert(parsed.tool === "get_index_status", `${label}: tool=${JSON.stringify(parsed.tool)}`);
      assert(Number.isSafeInteger(parsed.bytes) && parsed.bytes > BUDGET, `${label}: bytes=${JSON.stringify(parsed.bytes)}`);
      assert(parsed.limit === BUDGET, `${label}: limit=${JSON.stringify(parsed.limit)}`);
      assert(typeof parsed.note === "string" && parsed.note.includes("AWWWARDS_MCP_MAX_RESPONSE_BYTES"), `${label}: note`);
      assert(
        Object.keys(parsed).sort().join(",") === "bytes,limit,note,tool,truncated",
        `${label}: recovery envelope leaked ${Object.keys(parsed).join(",")}`,
      );
      assert(message.result.content.length === 1, `${label}: recovery content is not one block`);
      assert(!notice.includes("lastSuccessfulFinishAt") && !notice.includes("sitesCount"), `${label}: evidence survived truncation`);
    } finally {
      await client.stop();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    const index = tempDirs.indexOf(dir);
    if (index >= 0) tempDirs.splice(index, 1);
  }
}

// Baseline-catalog maintenance: list only, once per era, and require both eras
// to return the same catalog. The file is generated from this checkout; the
// normal run never writes it.
async function dumpCatalog() {
  const state = ATLAS ? "on" : "off";
  let document;
  try {
    document = JSON.parse(readFileSync(DUMP_PATH, "utf8"));
  } catch {
    document = { surfaces: {} };
  }
  // Always record the candidate's identity. `??=` preserved a stale 1.20
  // label when the fixture was regenerated from a newer checkout.
  document.package = (() => {
    try {
      const cliPkg = JSON.parse(readFileSync(resolve(CLI, "..", "..", "package.json"), "utf8"));
      return `${cliPkg.name}@${cliPkg.version}`;
    } catch {
      return `cli:${CLI}`;
    }
  })();
  document.surfaces ??= {};
  const surfaces = (document.surfaces[state] ??= {});
  for (const profile of ["full", "core", "v2"]) {
    const catalogs = [];
    for (const era of ["legacy", "modern"]) {
      const label = `dump ${state} ${profile} ${era}`;
      const { dir } = prepareCache(`dump-${profile}-${era}`);
      try {
        // The cache module is this checkout's; the CLI may be a baseline build.
        await seedCache(dir, Date.now());
        const client = startClient({ dir, profile, label });
        try {
          await handshake(client, era);
          const list = await client.result("tools/list", era === "modern" ? META : {});
          assert(Array.isArray(list.tools), `${label}: tools/list missing tools`);
          assertSurface(list.tools, profile, era);
          assertCacheableResultMetadata(list, era, `${label}: tools/list`);
          catalogs.push(projectCatalog(list.tools));
        } finally {
          await client.stop();
        }
      } finally {
        rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        const index = tempDirs.indexOf(dir);
        if (index >= 0) tempDirs.splice(index, 1);
      }
    }
    assertCatalog(catalogs[1], catalogs[0], `${profile} dump: legacy vs modern`);
    surfaces[profile] = catalogs[0];
    console.log(`protocol-smoke: dumped ${state} ${profile} ${catalogs[0].length} tools`);
  }
  // Temp + rename keeps a crashed dump from truncating the checked-in fixture.
  const temporary = `${DUMP_PATH}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`);
  renameSync(temporary, DUMP_PATH);
  console.log(`protocol-smoke: catalog written to ${DUMP_PATH}`);
}

async function startFixture() {
  fixtureServer = createServer((request, response) => {
    if (request.url === "/hang") return;
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    if (request.url === "/verify") {
      response.end(
        "<!doctype html><html><head><title>verify fixture</title><style>" +
          "html,body{margin:0}header{height:80px;background:#333}" +
          "section{height:600px}.a{background:#111}.b{background:#eee}" +
          "footer{height:80px;background:#000}</style></head><body>" +
          "<header></header><section class=\"a\"></section><section class=\"b\"></section>" +
          "<footer></footer></body></html>",
      );
      return;
    }
    response.end(
      '<!doctype html><html><head><title>protocol smoke</title></head><body><div id="__next"></div>' +
        '<script id="__NEXT_DATA__" type="application/json">{}</script></body></html>',
    );
  });
  await new Promise((done, fail) => {
    fixtureServer.once("error", fail);
    fixtureServer.listen(0, "127.0.0.1", done);
  });
  fixtureBase = `http://127.0.0.1:${fixtureServer.address().port}`;
}

async function closeFixture() {
  if (!fixtureServer) return;
  await new Promise((done) => fixtureServer.close(() => done()));
  fixtureServer = undefined;
}

async function main() {
  try {
    if (DUMP_PATH) {
      await startFixture();
      await dumpCatalog();
      return;
    }
    const baseline = loadBaseline();
    await startFixture();
    for (const profile of ["full", "core", "v2"]) {
      for (const era of ["legacy", "modern"]) {
        await runSession(profile, era, baseline[profile]);
      }
      console.log(
        `protocol-smoke: ${profile} ${ATLAS ? "on" : "off"} ${SURFACES[profile]} tools, ` +
          "legacy 2025-06-18 + modern 2026-07-28 PASS",
      );
    }
    for (const era of ["legacy", "modern"]) await overBudgetSession(era);
    console.log(
      `protocol-smoke: PASS (${ATLAS ? "Atlas on" : "Atlas off"}; surfaces ${SURFACES.full}/${SURFACES.core}/${SURFACES.v2}; ` +
        "baseline catalog, clean stdout, over-budget errors, cancelled requests stayed cancelled, temp caches removed)",
    );
  } catch (error) {
    console.error(`protocol-smoke: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    await closeFixture();
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
