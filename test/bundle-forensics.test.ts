import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captureBundleForensics } from "../src/bundle-forensics.js";

const PAGE = "https://site.test/index.html";
const pageOrigin = "https://site.test";
// URL constants, not path.join — Windows join() backslashes would break the
// forward-slash absolute URLs the module produces via new URL().
const A_JS = `${pageOrigin}/a.js`;
const B_JS = "https://cdn.x.com/b.js";

// Offline fetch: map keyed by URL, missing keys get a plain 404.
const fakeFetchMap = (map: Record<string, string>) => async (url: string) => {
  const body = map[url];
  if (body === undefined) return new Response("not found", { status: 404 });
  return new Response(body, { status: 200 });
};

// Default outDirs are throwaway mkdtemp dirs — remove the ones a report
// actually handed back.
const cleanup: string[] = [];
afterEach(() => {
  for (const d of cleanup.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("captureBundleForensics", () => {
  it("extracts script srcs, fetches bounded chunks, saves + hashes them", async () => {
    const fetchFn = fakeFetchMap({
      [PAGE]: `<html><script src="/a.js"></script><script src="${B_JS}"></script><script>inline()</script></html>`,
      [A_JS]: "function attachLetterSwap(i,l){}",
      [B_JS]: "var bundle={" + "x".repeat(99) + "};",
    });
    const rep = await captureBundleForensics(PAGE, { fetchFn, keywords: ["attachLetterSwap"] });
    expect("error" in rep).toBe(false);
    if ("error" in rep) return;
    cleanup.push(rep.outDir);
    expect(rep.chunkCount).toBe(2); // inline scripts have no src — excluded
    expect(rep.totalBytes).toBeGreaterThan(0);
    expect(rep.chunks[0].sha1).toHaveLength(40); // node:crypto sha1, house pattern
    expect(rep.chunks[0].url).toBe(A_JS); // appearance order, absolutized
    expect(rep.chunks[0].path.endsWith("0-a.js")).toBe(true);
    expect(existsSync(rep.chunks[0].path)).toBe(true);
    expect(rep.matches).toEqual([
      {
        chunk: 0,
        url: A_JS,
        line: 1,
        preview: expect.stringContaining("attachLetterSwap"),
        keyword: "attachLetterSwap",
      },
    ]);
    expect(rep.unpacked).toBe(false);
    expect(rep.warnings).toEqual([]);
  });

  // One-chunk page shared by the webcrack unpack tests.
  const unpackFetch = fakeFetchMap({
    [PAGE]: `<html><script src="/a.js"></script></html>`,
    [A_JS]: "var a=1;",
  });

  it("unpacks with webcrack when the lazy import resolves", async () => {
    const unpackLoader = async () => ({
      webcrack: async (code: string) => ({
        code: "/* pretty */\n" + code,
        bundle: {
          type: "webpack",
          modules: new Map([[870178, { id: 870178, code: "const x = 1;", path: "870178.js" }]]),
        },
      }),
    });
    const rep = await captureBundleForensics(PAGE, {
      fetchFn: unpackFetch,
      keywords: ["attach"],
      unpackLoader,
    });
    expect("error" in rep).toBe(false);
    if ("error" in rep) return;
    cleanup.push(rep.outDir);
    expect(rep.unpacked).toBe(true);
    expect(rep.unpackedDir).toBeTruthy();
    expect(rep.chunks[0].deobfuscated).toBe(true);
    expect(rep.chunks[0].path.endsWith("0-a.pretty.js")).toBe(true);
    expect(readFileSync(rep.chunks[0].path, "utf8").startsWith("/* pretty */")).toBe(true);
    expect(existsSync(join(rep.outDir, "unpacked", "000", "870178.js"))).toBe(true);
  });

  it("degrades to raw chunks + hint when webcrack is missing", async () => {
    const rep = await captureBundleForensics(PAGE, {
      fetchFn: unpackFetch,
      unpackLoader: async () => {
        throw new Error("not installed");
      },
    });
    expect("error" in rep).toBe(false);
    if ("error" in rep) return;
    cleanup.push(rep.outDir);
    expect(rep.unpacked).toBe(false);
    expect(rep.hint).toContain("webcrack");
    expect(rep.warnings).toEqual([]); // missing optional dep is a hint, not a warning
  });

  it("never explodes on unexpected webcrack shapes", async () => {
    const unpackLoader = async () => ({ webcrack: async () => ({ code: "x" }) });
    const rep = await captureBundleForensics(PAGE, { fetchFn: unpackFetch, unpackLoader });
    expect("error" in rep).toBe(false);
    if ("error" in rep) return;
    cleanup.push(rep.outDir);
    expect(rep.unpacked).toBe(true); // pretty code still saved despite no bundle
    expect(rep.chunks[0].deobfuscated).toBe(true);
    expect(rep.warnings.join("\n")).toContain("modules"); // skipped-modules warning
  });

  it("caps chunks and records a warning beyond maxChunks", async () => {
    const srcs = [0, 1, 2, 3, 4].map((i) => `https://site.test/c${i}.js`);
    const map: Record<string, string> = {
      [PAGE]: `<html>${srcs.map((s) => `<script src="${s}"></script>`).join("")}</html>`,
    };
    for (const s of srcs) map[s] = "var x=1;";
    const rep = await captureBundleForensics(PAGE, { fetchFn: fakeFetchMap(map), maxChunks: 1 });
    expect("error" in rep).toBe(false);
    if ("error" in rep) return;
    cleanup.push(rep.outDir);
    expect(rep.chunkCount).toBe(1);
    expect(rep.chunks[0].url).toBe(srcs[0]);
    const skipped = rep.warnings.filter((w) => w.includes("skipped"));
    expect(skipped).toHaveLength(4); // one per chunk beyond the cap
    expect(rep.warnings.join("\n")).toContain("skipped");
  });

  it("returns { error } and no throw when the page fetch fails", async () => {
    const fetchFn = async () => {
      throw new Error("network down");
    };
    const rep = await captureBundleForensics(PAGE, { fetchFn });
    expect("error" in rep).toBe(true);
    if (!("error" in rep)) return;
    expect(rep.error).toContain("network down");
  });

  it("stops and warns when a chunk would exceed maxTotalBytes", async () => {
    const B2 = `${pageOrigin}/b.js`;
    const map: Record<string, string> = {
      [PAGE]: `<html><script src="/a.js"></script><script src="/b.js"></script></html>`,
      [A_JS]: "y".repeat(5000),
      [B2]: "z".repeat(5000),
    };
    // a.js (5000B) fits under 6000; b.js (5000B) would blow the budget → skip + stop.
    const rep = await captureBundleForensics(PAGE, {
      fetchFn: fakeFetchMap(map),
      maxTotalBytes: 6000,
    });
    expect("error" in rep).toBe(false);
    if ("error" in rep) return;
    cleanup.push(rep.outDir);
    expect(rep.chunkCount).toBe(1);
    expect(rep.totalBytes).toBe(5000);
    expect(rep.warnings.join("\n")).toContain("maxTotalBytes");
  });
});
