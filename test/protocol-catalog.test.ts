import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CANCEL_SETTLE_MS,
  CANCELLED_CALL_TIMEOUT_MS,
  CORE_VERIFY_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
  assertCacheableResultMetadata,
  assertCallResultType,
  assertCatalog,
  assertNoTaskCapability,
  assertSuccess,
  assertToolError,
  cancellation,
  projectCatalog,
  schemaErrors,
} from "../scripts/protocol-smoke.mjs";

type Catalog = ReturnType<typeof projectCatalog>;
const PKG = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { name: string; version: string };
const baseline = JSON.parse(
  readFileSync(new URL("../scripts/fixtures/protocol-catalog.json", import.meta.url), "utf8"),
) as { package: string; surfaces: Record<string, Record<string, Catalog>> };

const hints = ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"];
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

function tool(name: string, overrides: Record<string, unknown> = {}) {
  return {
    name,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    outputSchema: { type: "object" },
    ...overrides,
  };
}

describe("protocol catalog baseline", () => {
  it("pins both Atlas states and all three profile counts", () => {
    expect(baseline.package).toBe(`${PKG.name}@${PKG.version}`);
    expect(Object.keys(baseline.surfaces).sort()).toEqual(["off", "on"]);
    expect(Object.fromEntries(Object.entries(baseline.surfaces.off).map(([k, v]) => [k, v.length]))).toEqual({
      full: 42,
      core: 14,
      v2: 15,
    });
    expect(Object.fromEntries(Object.entries(baseline.surfaces.on).map(([k, v]) => [k, v.length]))).toEqual({
      full: 46,
      core: 14,
      v2: 16,
    });
  });

  it("keeps every baseline entry unique and fully annotated", () => {
    for (const [state, profiles] of Object.entries(baseline.surfaces)) {
      for (const [profile, catalog] of Object.entries(profiles)) {
        const names = catalog.map((entry) => entry.name);
        expect(new Set(names).size, `${state} ${profile}`).toBe(names.length);
        for (const entry of catalog) {
          expect(Object.keys(entry.annotations).sort(), `${state} ${profile} ${entry.name}`).toEqual(
            [...hints].sort(),
          );
          for (const hint of hints) {
            expect(typeof entry.annotations[hint], `${state} ${profile} ${entry.name} ${hint}`).toBe("boolean");
          }
          expect(typeof entry.outputSchema).toBe("boolean");
        }
      }
    }
  });
});

describe("catalog comparison gate", () => {
  const expected = projectCatalog([tool("alpha"), tool("beta", { outputSchema: undefined })]);

  it("accepts an identical catalog", () => {
    expect(() => assertCatalog(clone(expected), expected, "accept")).not.toThrow();
  });

  it("fails a wrong tool count", () => {
    expect(() => assertCatalog(clone(expected).slice(0, 1), expected, "count")).toThrow(/expected 2 tools, got 1/);
    expect(() =>
      assertCatalog([...clone(expected), { name: "extra", annotations: expected[0]!.annotations, outputSchema: false }], expected, "count"),
    ).toThrow(/expected 2 tools, got 3/);
  });

  it("fails duplicate names", () => {
    const duplicate = [clone(expected[0]!), clone(expected[0]!)];
    expect(() => assertCatalog(duplicate, duplicate, "duplicate")).toThrow(/duplicate tool names/);
  });

  it("fails reordered tools", () => {
    expect(() => assertCatalog([clone(expected[1]!), clone(expected[0]!)], expected, "order")).toThrow(
      /catalog drifted at index 0/,
    );
  });

  it("fails a changed annotation", () => {
    const changed = clone(expected);
    changed[0]!.annotations.idempotentHint = false;
    expect(() => assertCatalog(changed, expected, "annotation")).toThrow(/catalog drifted/);
  });

  it("fails a dropped output schema", () => {
    const changed = clone(expected);
    changed[0]!.outputSchema = false;
    expect(() => assertCatalog(changed, expected, "schema")).toThrow(/catalog drifted/);
  });
});

describe("candidate CLI path", () => {
  const repo = fileURLToPath(new URL("..", import.meta.url));
  const script = fileURLToPath(new URL("../scripts/protocol-smoke.mjs", import.meta.url));

  function runSmoke(cliPath: string) {
    return runSmokeArgs([cliPath]);
  }

  function runSmokeArgs(args: string[]) {
    const tmp = mkdtempSync(join(tmpdir(), "awwwards-smoke-path-"));
    try {
      return spawnSync(process.execPath, [script, ...args], {
        cwd: repo,
        encoding: "utf8",
        timeout: 60_000,
        env: {
          ...process.env,
          AWWWARDS_MCP_ATLAS: "",
          AWWWARDS_AUTO_UPDATE: "0",
          TEMP: tmp,
          TMP: tmp,
        },
      });
    } finally {
      rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }

  it("fails a nonexistent candidate path instead of running dist/cli.js", () => {
    const missing = join(tmpdir(), `awwwards-missing-${process.pid}-${Date.now()}.mjs`);
    const result = runSmoke(missing);
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain("protocol-smoke: PASS");
    expect(result.stderr).toContain("protocol-smoke:");
  });

  it("actually launches the candidate path it was given", () => {
    const dir = mkdtempSync(join(tmpdir(), "awwwards-smoke-candidate-"));
    const fake = join(dir, "fake-cli.mjs");
    writeFileSync(fake, "process.exit(7);\n");
    try {
      const result = runSmoke(fake);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/code 7/);
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("dumps a current-package catalog atomically for every off surface", () => {
    const dir = mkdtempSync(join(tmpdir(), "awwwards-smoke-dump-"));
    const out = join(dir, "catalog.json");
    try {
      const result = runSmokeArgs(["dist/cli.js", "--dump-catalog", out]);
      expect(result.status).toBe(0);
      const document = JSON.parse(readFileSync(out, "utf8"));
      expect(document.package).toBe(`${PKG.name}@${PKG.version}`);
      expect(document.surfaces.off.full).toHaveLength(42);
      expect(document.surfaces.off.core).toHaveLength(14);
      expect(document.surfaces.off.v2).toHaveLength(15);
      expect(readdirSync(dir).filter((name) => name.includes(".tmp-"))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
    // Six sequential CLI sessions exceed Vitest's 30 s default on Windows;
    // this still outlives the 60 s spawnSync cap so a hung child fails here.
  }, 120_000);
});

describe("cancellation gate", () => {
  // The cancelled call stays pending for the whole test; only the follow-up
  // call (id 2) resolves, exactly like a server that honoured the notification.
  function fakeClient(respondedIds: number[] = []) {
    let next = 1;
    const client = {
      responded: new Set(respondedIds),
      notified: [] as unknown[],
      forgotten: [] as number[],
      calls: [] as Array<{ method: string; params: unknown }>,
      request(method: string, params: unknown) {
        const id = next++;
        client.calls.push({ method, params });
        const promise =
          id === 2
            ? Promise.resolve({
                result: { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] },
              })
            : new Promise(() => {});
        return Object.assign(promise, { id });
      },
      notify(method: string, params: unknown) {
        client.notified.push([method, params]);
      },
      forget(id: number) {
        client.forgotten.push(id);
      },
    };
    return client;
  }

  it("fails when a server answers a cancelled request anyway", async () => {
    await expect(
      cancellation(fakeClient([1]), "full", "legacy", "http://127.0.0.1:1/hang", 0),
    ).rejects.toThrow(/cancelled request still returned a response/);
  });

  it("continues a full session after an honoured cancellation", async () => {
    const client = fakeClient();
    await expect(
      cancellation(client, "full", "legacy", "http://127.0.0.1:1/hang", 0),
    ).resolves.toBeUndefined();
    expect(client.calls.map((call) => (call.params as { name: string }).name)).toEqual([
      "analyze_stack",
      "get_index_status",
    ]);
    expect(client.notified[0]).toEqual([
      "notifications/cancelled",
      { requestId: 1, reason: "protocol-smoke" },
    ]);
    expect(client.forgotten).toEqual([1]);
  });

  it("maps the v2 branches and skips core", async () => {
    const v2 = fakeClient();
    await cancellation(v2, "v2", "modern", "http://127.0.0.1:1/hang", 0);
    expect(v2.calls.map((call) => (call.params as { name: string }).name)).toEqual([
      "inspect_page",
      "get_index",
    ]);

    const core = fakeClient();
    await expect(
      cancellation(core, "core", "legacy", "http://127.0.0.1:1/hang", 0),
    ).resolves.toBeUndefined();
    expect(core.calls).toEqual([]);
  });
});

describe("protocol era gates", () => {
  it("requires modern list cache metadata and resultType", () => {
    expect(() =>
      assertCacheableResultMetadata({ resultType: "complete", ttlMs: 0, cacheScope: "private" }, "modern", "modern"),
    ).not.toThrow();
    for (const missing of ["resultType", "ttlMs", "cacheScope"]) {
      const result: Record<string, unknown> = { resultType: "complete", ttlMs: 0, cacheScope: "private" };
      delete result[missing];
      expect(() => assertCacheableResultMetadata(result, "modern", "modern"), missing).toThrow(/modern/);
    }
    expect(() =>
      assertCacheableResultMetadata({ resultType: "complete", ttlMs: -1, cacheScope: "private" }, "modern", "modern"),
    ).toThrow(/ttlMs/);
    expect(() =>
      assertCacheableResultMetadata({ resultType: "complete", ttlMs: 0, cacheScope: "shared" }, "modern", "modern"),
    ).toThrow(/cacheScope/);
  });

  it("validates legacy independently: no modern cache fields", () => {
    expect(() => assertCacheableResultMetadata({ tools: [] }, "legacy", "legacy")).not.toThrow();
    for (const extra of ["resultType", "ttlMs", "cacheScope"]) {
      expect(() => assertCacheableResultMetadata({ tools: [], [extra]: 1 }, "legacy", "legacy")).toThrow(
        new RegExp(extra),
      );
    }
    expect(() => assertCallResultType({ content: [] }, "legacy", "legacy")).not.toThrow();
    expect(() => assertCallResultType({ content: [], resultType: "complete" }, "legacy", "legacy")).toThrow(
      /resultType/,
    );
  });

  it("requires resultType complete on modern tool results", () => {
    expect(() => assertCallResultType({ resultType: "complete" }, "modern", "modern")).not.toThrow();
    expect(() => assertCallResultType({}, "modern", "modern")).toThrow(/resultType complete/);
  });

  it("does not advertise Tasks or progress", () => {
    expect(() => assertNoTaskCapability({ tools: {} }, "caps")).not.toThrow();
    expect(() => assertNoTaskCapability({ tools: {}, tasks: {} }, "caps")).toThrow(/tasks/);
    expect(() => assertNoTaskCapability({ tools: {}, progress: {} }, "caps")).toThrow(/progress/);
  });

  it("waits beyond the cancelled operation's own deadline", () => {
    expect(CANCEL_SETTLE_MS).toBeGreaterThan(CANCELLED_CALL_TIMEOUT_MS);
  });

  it("gives core verify_build an explicit bounded budget above the default", () => {
    expect(CORE_VERIFY_TIMEOUT_MS).toBe(120_000);
    expect(CORE_VERIFY_TIMEOUT_MS).toBeGreaterThan(REQUEST_TIMEOUT_MS);
  });
});

describe("stdio success and error envelopes", () => {
  const text = (value: unknown) => ({ type: "text", text: JSON.stringify(value) });

  it("rejects a success with no content", () => {
    expect(() => assertSuccess({ result: { content: [] } }, "empty")).toThrow(/no content/);
    expect(() => assertSuccess({ result: {} }, "missing")).toThrow(/no content/);
  });

  it("rejects a truncation notice posing as a success", () => {
    const message = { result: { content: [text({ truncated: true, tool: "x" })] } };
    expect(() => assertSuccess(message, "truncated")).toThrow(/truncation notice/);
  });

  it("rejects isError and malformed content", () => {
    expect(() => assertSuccess({ result: { isError: true, content: [text("x")] } }, "error")).toThrow(/isError/);
    expect(() => assertSuccess({ result: { content: [{ type: "image", data: "x" }] } }, "image")).toThrow(/mimeType/);
    expect(() => assertSuccess({ result: { content: [{ type: "audio" }] } }, "audio")).toThrow(/content block type/);
  });

  it("accepts a bounded text or image success", () => {
    expect(() => assertSuccess({ result: { content: [text({ ok: true })] } }, "text")).not.toThrow();
    expect(() =>
      assertSuccess({ result: { content: [{ type: "image", data: "AA==", mimeType: "image/png" }] } }, "image"),
    ).not.toThrow();
  });

  it("rejects an error carrying structuredContent or no text", () => {
    expect(() =>
      assertToolError({ result: { isError: true, structuredContent: { ok: true }, content: [text("x")] } }, "error"),
    ).toThrow(/structuredContent/);
    expect(() => assertToolError({ result: { isError: true, content: [] } }, "error")).toThrow(/no content/);
    expect(() => assertToolError({ result: { isError: true, content: [{ type: "image", data: "x", mimeType: "image/png" }] } }, "error")).toThrow(
      /text-only/,
    );
  });
});

describe("output schema validation", () => {
  const schema = {
    type: "object",
    required: ["sitesCount", "progress", "lastError"],
    properties: {
      sitesCount: { type: "integer", minimum: 0 },
      progress: {
        type: "object",
        required: ["pagesDone"],
        properties: { pagesDone: { type: "integer" } },
        additionalProperties: false,
      },
      lastError: { anyOf: [{ type: "string" }, { type: "null" }] },
    },
    additionalProperties: false,
  };

  it("accepts a matching value, including nullable anyOf", () => {
    expect(schemaErrors({ sitesCount: 0, progress: { pagesDone: 1 }, lastError: null }, schema)).toEqual([]);
    expect(schemaErrors({ sitesCount: 2, progress: { pagesDone: 0 }, lastError: "e" }, schema)).toEqual([]);
  });

  it("fails missing required, wrong type and unexpected keys", () => {
    expect(schemaErrors({ progress: { pagesDone: 1 }, lastError: null }, schema)[0]).toMatch(/sitesCount: required/);
    expect(schemaErrors({ sitesCount: "0", progress: { pagesDone: 1 }, lastError: null }, schema)[0]).toMatch(
      /expected integer/,
    );
    expect(schemaErrors({ sitesCount: 0, progress: {}, lastError: null }, schema)[0]).toMatch(/pagesDone: required/);
    expect(schemaErrors({ sitesCount: 0, progress: { pagesDone: 1 }, lastError: null, extra: 1 }, schema)[0]).toMatch(
      /extra: unexpected property/,
    );
  });

  it("fails numeric bounds and invalid enums", () => {
    expect(schemaErrors(-1, { type: "integer", minimum: 0 })[0]).toMatch(/below minimum/);
    expect(schemaErrors(0, { type: "integer", exclusiveMinimum: 0 })[0]).toMatch(/exclusiveMinimum/);
    expect(schemaErrors("x", { enum: ["a", "b"] })[0]).toMatch(/enum/);
    expect(
      schemaErrors({ a: 1 }, { allOf: [{ required: ["a"] }, { required: ["b"] }] })[0],
    ).toMatch(/b: required/);
    expect(schemaErrors(1, { oneOf: [{ type: "string" }, { type: "number" }] })).toEqual([]);
    // oneOf is exclusive: overlapping branches must fail, not pass as anyOf.
    expect(schemaErrors(1, { oneOf: [{ type: "number" }, { type: "integer" }] })[0]).toMatch(
      /exactly one oneOf branch, matched 2/,
    );
    expect(schemaErrors(1.5, { oneOf: [{ type: "number" }, { type: "integer" }] })).toEqual([]);
    expect(
      schemaErrors("ok", { $defs: { text: { type: "string" } }, $ref: "#/$defs/text" }),
    ).toEqual([]);
    expect(
      schemaErrors(7, { $defs: { text: { type: "string" } }, $ref: "#/$defs/text" })[0],
    ).toMatch(/expected string/);
  });
});
