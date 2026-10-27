import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The 50 MB guard is asserted through stat, so the cap test never allocates a
// 50 MB fixture. A negative value falls through to the real stat.
const mockedFileSize = vi.hoisted(() => ({ value: -1 }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    stat: async (...args: any[]) => {
      const result = await (actual.stat as any)(...args);
      return mockedFileSize.value < 0 ? result : { ...result, size: mockedFileSize.value };
    },
  };
});

import { analyzeNetworkCapture, MAX_ENTRIES, MAX_HAR_BYTES } from "../src/network-capture.js";
import { createHandlers } from "../src/server.js";

const FIXTURES = join(__dirname, "fixtures", "har");
const validPath = join(FIXTURES, "valid.har");

const dirs: string[] = [];
function tempHar(body: unknown, name = "capture.har"): string {
  const dir = mkdtempSync(join(tmpdir(), "awwwards-har-"));
  dirs.push(dir);
  const path = join(dir, name);
  writeFileSync(path, typeof body === "string" ? body : JSON.stringify(body));
  return path;
}
afterEach(() => {
  mockedFileSize.value = -1;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function har(entries: unknown[]): unknown {
  return {
    log: { version: "1.2", creator: { name: "awwwards-mcp-test", version: "1.0" }, entries },
  };
}

function entry(
  url: string,
  method = "GET",
  status = 200,
  mimeType = "application/json",
): unknown {
  return {
    request: { method, url },
    response: { status, content: { mimeType } },
  };
}

describe("analyzeNetworkCapture", () => {
  it("groups by method + origin + template, dedupes, and sorts by count desc", async () => {
    const res = await analyzeNetworkCapture(validPath);
    expect("error" in res).toBe(false);
    if ("error" in res) return;

    expect(res.file).toBe(validPath);
    expect(res.evidenceCoverage).toEqual({
      status: "complete",
      collected: 6,
      excluded: 0,
      limitations: [],
    });
    expect(res.groups).toEqual([
      {
        method: "GET",
        origin: "https://api.example.com",
        pathTemplate: "/api/users/{id}",
        count: 3,
        statuses: [200, 404],
        contentTypes: ["application/json", "application/problem+json"],
        queryNames: ["limit", "page"],
      },
      {
        method: "GET",
        origin: "https://cdn.example.com",
        pathTemplate: "/assets/logo.png",
        count: 2,
        statuses: [0, 200],
        contentTypes: ["image/png"],
        queryNames: [],
      },
      {
        method: "POST",
        origin: "https://api.example.com",
        pathTemplate: "/api/users/{id}",
        count: 1,
        statuses: [201],
        contentTypes: ["text/plain"],
        queryNames: ["page"],
      },
    ]);
    expect(res.templatedGroups).toBe(2);
    expect(res.note).toMatch(/bodies/i);
    expect(res.note).toMatch(/query values/i);

    // Query names only: values never reach the output.
    const json = JSON.stringify(res);
    expect(json).not.toContain("page=2");
    expect(json).not.toContain("limit=10");
  });

  it("templates ISO dates, versions, UUIDs, hex ids and numbers in order", async () => {
    const path = tempHar(har([
      entry(
        "https://api.example.com/2024-05-01/v2/550E8400-E29B-41D4-A716-446655440000/" +
          "A1B2C3D4E5F6A7B8C9D0E1F2A3B4C5D6/42",
      ),
    ]));
    const res = await analyzeNetworkCapture(path);
    if ("error" in res) throw new Error(res.error);
    expect(res.groups[0].pathTemplate).toBe("/{date}/{version}/{uuid}/{hex}/{id}");
    expect(res.templatedGroups).toBe(1);
  });

  it("orders equal counts by method, then origin, then template", async () => {
    const path = tempHar(har([
      entry("https://b.test/z", "POST"),
      entry("https://b.test/a", "GET"),
      entry("https://a.test/z", "GET"),
    ]));
    const res = await analyzeNetworkCapture(path);
    if ("error" in res) throw new Error(res.error);
    expect(res.groups.map((g) => `${g.method} ${g.origin} ${g.pathTemplate}`)).toEqual([
      "GET https://a.test /z",
      "GET https://b.test /a",
      "POST https://b.test /z",
    ]);
  });

  it("redacts email, JWT and reset-token path segments; keeps query names only", async () => {
    const res = await analyzeNetworkCapture(join(FIXTURES, "secrets.har"));
    if ("error" in res) throw new Error(res.error);

    expect(res.groups.map((g) => g.pathTemplate)).toEqual([
      "/reset/{redacted}",
      "/session/{redacted}",
      "/users/{redacted}/profile",
    ]);
    expect(res.templatedGroups).toBe(3);
    expect(res.groups[0].queryNames).toEqual(["email", "token"]);
    expect(res.groups[1].queryNames).toEqual(["key"]);
    expect(res.groups[2].queryNames).toEqual([]);

    const json = JSON.stringify(res);
    for (const secret of [
      "alice@example.com",
      "alice%40example.com",
      "eyJhbGciOiJIUzI1NiJ9",
      "reset-token-value-123",
      "secret-key-value",
    ]) {
      expect(json).not.toContain(secret);
    }
  });

  it("caps content types and query names at 20", async () => {
    const query = Array.from({ length: 25 }, (_, i) => `q${i}=value-${i}`).join("&");
    const entries = Array.from({ length: 21 }, (_, i) =>
      entry(`https://cap.test/items/7?${query}`, "GET", 200, `Application/X-${i}; charset=utf-8`),
    );
    const res = await analyzeNetworkCapture(tempHar(har(entries)));
    if ("error" in res) throw new Error(res.error);
    expect(res.groups).toHaveLength(1);
    expect(res.groups[0].contentTypes).toHaveLength(20);
    expect(res.groups[0].queryNames).toHaveLength(20);
    expect(res.groups[0].contentTypes[0]).toBe("application/x-0");
    expect(JSON.stringify(res)).not.toContain("value-0");
  });

  it("applies top after sorting and clamps it to 1..200", async () => {
    const one = await analyzeNetworkCapture(validPath, { top: 1 });
    if ("error" in one) throw new Error(one.error);
    expect(one.groups).toHaveLength(1);
    expect(one.groups[0].count).toBe(3);
    expect(one.templatedGroups).toBe(1);
    expect(one.evidenceCoverage.status).toBe("complete");

    const all = await analyzeNetworkCapture(validPath, { top: 999 });
    if ("error" in all) throw new Error(all.error);
    expect(all.groups).toHaveLength(3);
  });

  it("counts invalid entries and reports partial coverage", async () => {
    const res = await analyzeNetworkCapture(join(FIXTURES, "three-entries-one-invalid.har"));
    if ("error" in res) throw new Error(res.error);
    expect(res.groups).toHaveLength(2);
    expect(res.evidenceCoverage).toEqual({
      status: "partial",
      collected: 2,
      excluded: 1,
      limitations: ["1 invalid entries were excluded"],
    });
  });

  it("is unknown when a non-empty HAR has no usable entries", async () => {
    const path = tempHar(har([{}, { request: { url: "ftp://files.test/x" } }, "nope"]));
    const res = await analyzeNetworkCapture(path);
    if ("error" in res) throw new Error(res.error);
    expect(res.groups).toEqual([]);
    expect(res.evidenceCoverage.status).toBe("unknown");
    expect(res.evidenceCoverage.collected).toBe(0);
    expect(res.evidenceCoverage.excluded).toBe(3);
  });

  it("rejects malformed JSON and objects without log.entries", async () => {
    expect(await analyzeNetworkCapture(join(FIXTURES, "malformed.har"))).toEqual({
      error: "not a HAR 1.2 file",
    });
    expect(await analyzeNetworkCapture(tempHar({ log: { version: "1.2" } }))).toEqual({
      error: "not a HAR 1.2 file",
    });
    expect(await analyzeNetworkCapture(tempHar(har([])))).toMatchObject({
      evidenceCoverage: { status: "complete", collected: 0, excluded: 0 },
    });
  });

  it("reports a missing file instead of throwing", async () => {
    expect(await analyzeNetworkCapture(join(FIXTURES, "does-not-exist.har"))).toEqual({
      error: "cannot read HAR file",
    });
  });

  it("analyzes only the first 2000 entries and excludes the rest", async () => {
    const entries = Array.from({ length: MAX_ENTRIES + 1 }, () =>
      entry("https://cap.test/ping"),
    );
    const res = await analyzeNetworkCapture(tempHar(har(entries)));
    if ("error" in res) throw new Error(res.error);
    expect(res.groups).toHaveLength(1);
    expect(res.groups[0].count).toBe(MAX_ENTRIES);
    expect(res.evidenceCoverage.status).toBe("partial");
    expect(res.evidenceCoverage.collected).toBe(MAX_ENTRIES);
    expect(res.evidenceCoverage.excluded).toBe(1);
    expect(res.evidenceCoverage.limitations).toContain(
      `only the first ${MAX_ENTRIES} entries were analyzed`,
    );
  });

  it("rejects files above the 50 MB cap before reading", async () => {
    mockedFileSize.value = MAX_HAR_BYTES + 1;
    expect(await analyzeNetworkCapture(validPath)).toEqual({
      error: "HAR file exceeds the 50 MB cap",
    });
  });

  it("handler returns the report and flags malformed files as errors", async () => {
    const handlers = createHandlers({ client: null as never, cache: null as never });
    const ok = await handlers.analyze_network_capture({ path: validPath });
    expect(ok.isError).toBeUndefined();
    const body = JSON.parse((ok.content[0] as { text: string }).text);
    expect(body.groups).toHaveLength(3);
    expect(body.evidenceCoverage.status).toBe("complete");

    const bad = await handlers.analyze_network_capture({
      path: join(FIXTURES, "malformed.har"),
    });
    expect(bad.isError).toBe(true);
    expect((bad.content[0] as { text: string }).text).toBe("not a HAR 1.2 file");
  });
});
