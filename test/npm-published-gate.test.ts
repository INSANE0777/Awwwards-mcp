import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import { classifyRegistryDoc } from "../scripts/npm-published-gate.mjs";

const exec = promisify(execFile);
const script = join(import.meta.dirname, "..", "scripts", "npm-published-gate.mjs");
const root = mkdtempSync(join(tmpdir(), "npm-published-gate-"));

afterAll(() => rmSync(root, { recursive: true, force: true }));

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "release", name), "utf8"));

const registry = fixture("registry-present.json");
const integrity: string = registry.versions["1.16.0"].dist.integrity;

async function withServer(
  respond: (response: ServerResponse) => void,
  run: (url: string) => Promise<void>,
): Promise<void> {
  const server = createServer((_request, response) => respond(response));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}/awwwards-mcp`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

function withRegistry(
  status: number,
  body: string,
  run: (url: string) => Promise<void>,
): Promise<void> {
  return withServer((response) => {
    response.statusCode = status;
    response.setHeader("content-type", "application/json");
    response.end(body);
  }, run);
}

function outputFile(): string {
  const path = join(mkdtempSync(join(root, "case-")), "github-output");
  writeFileSync(path, "");
  return path;
}

function runGate(
  url: string,
  version: string,
  output: string,
  extraEnv: Record<string, string> = {},
) {
  return exec(process.execPath, [script, version], {
    env: { ...process.env, NPM_REGISTRY_URL: url, GITHUB_OUTPUT: output, ...extraEnv },
  });
}

describe("registry document classification", () => {
  it("reports a published version with its registry integrity", () => {
    expect(classifyRegistryDoc(registry, "1.16.0")).toEqual({ published: true, integrity });
  });

  it("reports an absent version as unpublished", () => {
    expect(classifyRegistryDoc(registry, "1.17.0")).toEqual({ published: false });
  });

  it("rejects a present version without dist.integrity", () => {
    expect(() => classifyRegistryDoc(fixture("registry-missing-integrity.json"), "1.16.0")).toThrow(
      /integrity/,
    );
  });

  it("rejects a registry integrity that is not an SRI string", () => {
    const malicious = { versions: { "1.16.0": { dist: { integrity: "sha512-$(id)" } } } };
    expect(() => classifyRegistryDoc(malicious, "1.16.0")).toThrow(/integrity/);
  });

  it("rejects a malformed registry document", () => {
    expect(() => classifyRegistryDoc(fixture("registry-malformed.json"), "1.16.0")).toThrow(
      /versions/,
    );
  });

  it("rejects a version string that is not a single token", () => {
    expect(() => classifyRegistryDoc(registry, "1.16.0\npublished=true")).toThrow(/invalid version/);
  });
});

describe("npm published gate script", () => {
  it("writes published=true and the integrity for a published version", async () => {
    const output = outputFile();
    await withRegistry(200, JSON.stringify(registry), (url) => runGate(url, "1.16.0", output));
    expect(readFileSync(output, "utf8")).toBe(`published=true\nintegrity=${integrity}\n`);
  });

  it("writes published=false when the package exists without that version", async () => {
    const output = outputFile();
    await withRegistry(200, JSON.stringify(registry), (url) => runGate(url, "1.17.0", output));
    expect(readFileSync(output, "utf8")).toBe("published=false\n");
  });

  it("fails closed on a non-200 registry response", async () => {
    const output = outputFile();
    await withRegistry(404, JSON.stringify({ error: "Not found" }), async (url) => {
      await expect(runGate(url, "1.16.0", output)).rejects.toMatchObject({ code: 1 });
    });
    expect(readFileSync(output, "utf8")).toBe("");
  });

  it("fails closed on invalid registry JSON", async () => {
    const output = outputFile();
    await withRegistry(200, "not json", async (url) => {
      await expect(runGate(url, "1.16.0", output)).rejects.toMatchObject({ code: 1 });
    });
  });

  it("fails closed when the registry entry has no integrity", async () => {
    const output = outputFile();
    await withRegistry(200, JSON.stringify(fixture("registry-missing-integrity.json")), async (url) => {
      await expect(runGate(url, "1.16.0", output)).rejects.toMatchObject({ code: 1 });
    });
  });

  it("fails closed without emitting a malicious registry integrity", async () => {
    const output = outputFile();
    const malicious = { versions: { "1.16.0": { dist: { integrity: "sha512-$(id)" } } } };
    await withRegistry(200, JSON.stringify(malicious), async (url) => {
      await expect(runGate(url, "1.16.0", output)).rejects.toMatchObject({ code: 1 });
    });
    expect(readFileSync(output, "utf8")).toBe("");
  });

  it("fails closed when the registry request times out", async () => {
    const output = outputFile();
    await withServer(
      () => {},
      async (url) => {
        const error = await runGate(url, "1.16.0", output, {
          NPM_REGISTRY_TIMEOUT_MS: "100",
        }).catch((failure) => failure);
        expect(error.code).toBe(1);
        expect(error.stderr).toMatch(/registry request failed/);
      },
    );
    expect(readFileSync(output, "utf8")).toBe("");
  });
});
