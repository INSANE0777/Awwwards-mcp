import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captureBundleForensics } from "../src/bundle-forensics.js";
import { createHandlers } from "../src/server.js";
import { AwwwardsClient } from "../src/awwwards.js";
import { Cache } from "../src/cache.js";

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
const cacheDir = () => {
  const d = mkdtempSync(join(tmpdir(), "awwwards-bf-"));
  cleanup.push(d);
  return d;
};
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
    const rep = await captureBundleForensics(PAGE, { fetchFn, keywords: ["attachLetterSwap"], unpackLoader: async () => null });
    expect("error" in rep).toBe(false);
    if ("error" in rep) return;
    cleanup.push(rep.outDir);
    expect(rep.chunkCount).toBe(3); // 2 external srcs + 1 inline script (now captured)
    expect(rep.totalBytes).toBeGreaterThan(0);
    expect(rep.chunks[0].sha1).toHaveLength(40); // node:crypto sha1, house pattern
    expect(rep.chunks[0].url).toBe(A_JS); // appearance order, absolutized
    expect(rep.chunks[0].path.endsWith("0-a.js")).toBe(true);
    expect(existsSync(rep.chunks[0].path)).toBe(true);
    expect(rep.chunks[2].url).toBe("inline:0"); // inline chunk, unfetched content saved verbatim
    expect(readFileSync(rep.chunks[2].path, "utf8")).toBe("inline()");
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
    // Even with zero modules, unpackedDir is eagerly created and readable.
    expect(rep.unpackedDir).toBeTruthy();
    expect(existsSync(rep.unpackedDir!)).toBe(true);
  });

  it("caps chunks and records a warning beyond maxChunks", async () => {
    const srcs = [0, 1, 2, 3, 4].map((i) => `https://site.test/c${i}.js`);
    const map: Record<string, string> = {
      [PAGE]: `<html>${srcs.map((s) => `<script src="${s}"></script>`).join("")}</html>`,
    };
    for (const s of srcs) map[s] = "var x=1;";
    const rep = await captureBundleForensics(PAGE, { fetchFn: fakeFetchMap(map), maxChunks: 1, unpackLoader: async () => null });
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

  // Page-fetch hardening: the page fetch must carry the same 15s signal as
  // chunk fetches (offline proof = signal is wired; timing is undici's job).
  it("passes an AbortSignal to the page fetch", async () => {
    let sawSignal = false;
    const fetchFn = async (_url: string, init?: RequestInit) => {
      sawSignal = init?.signal instanceof AbortSignal;
      return new Response("<html></html>", { status: 200 });
    };
    const rep = await captureBundleForensics(PAGE, { fetchFn });
    expect("error" in rep).toBe(false);
    if ("error" in rep) return;
    cleanup.push(rep.outDir);
    expect(sawSignal).toBe(true);
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

describe("universal extraction: inline scripts + preload hints", () => {
  it("captures inline scripts, modulepreload and preload-as-script hints in HTML order, deduping shared URLs", async () => {
    const inlineOne = "console.log('one');attachLetterSwapRef();";
    const big = "q".repeat(210_000); // 210KB > 200KB inline cap → skipped with a warning
    const M1 = `${pageOrigin}/m1.js`;
    const DUP = `${pageOrigin}/dup.js`;
    const map: Record<string, string> = {
      [PAGE]: [
        `<script src="/a.js"></script>`,
        `<script>${inlineOne}</script>`,
        `<link rel="modulepreload" href="/m1.js">`,
        `<script src="/dup.js"></script>`, // same URL as preload hint below → one chunk
        `<link rel="preload" as="script" href="/dup.js">`,
        `<script>${big}</script>`,
        `<script>var two=2;</script>`,
        `<link rel="preload" as="style" href="/nope.css">`, // not a script hint
        `<link rel="stylesheet" href="/nope2.css">`,
      ].join(""),
      [A_JS]: "function attachLetterSwap(i,l){}",
      [M1]: "var m1=1;",
      [DUP]: "var dup=1;",
    };
    const rep = await captureBundleForensics(PAGE, {
      fetchFn: fakeFetchMap(map),
      keywords: ["attachLetterSwap"],
      unpackLoader: async () => null,
    });
    expect("error" in rep).toBe(false);
    if ("error" in rep) return;
    cleanup.push(rep.outDir);
    // Appearance order across all sources; dup.js deduped script+preload → 5 chunks, not 6.
    expect(rep.chunks.map((c) => c.url)).toEqual([A_JS, "inline:0", M1, DUP, "inline:1"]);
    expect(rep.chunkCount).toBe(5);
    // Inline chunk content saved to disk verbatim, hash like fetched chunks.
    expect(readFileSync(rep.chunks[1].path, "utf8")).toBe(inlineOne);
    expect(readFileSync(rep.chunks[4].path, "utf8")).toBe("var two=2;");
    expect(rep.chunks[1].sha1).toHaveLength(40);
    // Oversized inline skipped whole, never sliced into the bundle.
    expect(rep.warnings.join("\n")).toContain("exceeds");
    expect(rep.chunks.some((c) => c.bytes === 210_000)).toBe(false);
    // Keyword grep runs against inline chunks too.
    expect(rep.matches.some((mm) => mm.url === "inline:0" && mm.keyword === "attachLetterSwap")).toBe(true);
  });

  it("bounds inline scripts: cap 20 with warning, 200KB skip with warning", async () => {
    const big = "w".repeat(210_000);
    const tags = Array.from({ length: 25 }, (_, i) =>
      i === 4 ? `<script>${big}</script>` : `<script>var i${i}=1;</script>`,
    );
    const rep = await captureBundleForensics(PAGE, {
      fetchFn: fakeFetchMap({ [PAGE]: tags.join("") }),
      unpackLoader: async () => null,
    });
    expect("error" in rep).toBe(false);
    if ("error" in rep) return;
    cleanup.push(rep.outDir);
    expect(rep.chunkCount).toBe(20); // 25 inline, 1 oversized → 20 captured, 4 beyond cap
    expect(rep.chunks.map((c) => c.url)).toEqual(Array.from({ length: 20 }, (_, i) => `inline:${i}`));
    const warns = rep.warnings.join("\n");
    expect(warns).toContain("exceeds"); // 200KB inline skip
    expect(warns).toContain("inline script cap"); // 20-cap
  });

  it("inline bytes count toward maxTotalBytes stop", async () => {
    const B2 = `${pageOrigin}/b.js`;
    const threeK = "z".repeat(3000);
    const rep = await captureBundleForensics(PAGE, {
      fetchFn: fakeFetchMap({
        [PAGE]: `<script>${threeK}</script><script src="/b.js"></script>`,
        [B2]: "y".repeat(5000),
      }),
      maxTotalBytes: 6000,
      unpackLoader: async () => null,
    });
    expect("error" in rep).toBe(false);
    if ("error" in rep) return;
    cleanup.push(rep.outDir);
    expect(rep.chunkCount).toBe(1); // inline (3000B) captured; b.js 5000B would exceed 6000 → stop
    expect(rep.totalBytes).toBe(3000);
    expect(rep.warnings.join("\n")).toContain("maxTotalBytes");
  });
});

describe("analyze_bundle handler", () => {
  it("DI happy path: fake bundleFn report → JSON text with matches + outDir, args passed through", async () => {
    const seen: Array<{ url: string; opts?: { keywords?: string[]; maxChunks?: number } }> = [];
    const report = {
      url: PAGE,
      host: "site.test",
      outDir: join("tmp", "chunks-xyz"),
      chunkCount: 1,
      totalBytes: 10,
      chunks: [{ index: 0, url: A_JS, bytes: 10, sha1: "a".repeat(40), path: join("tmp", "0-a.js") }],
      matches: [
        { chunk: 0, url: A_JS, line: 3, preview: "...attachLetterSwap(i, l)...", keyword: "attachLetterSwap" },
      ],
      warnings: [],
      unpacked: false,
    };
    const h = createHandlers({
      client: new AwwwardsClient(),
      cache: new Cache(cacheDir()),
      bundleFn: async (url, opts) => {
        seen.push({ url, opts });
        return report;
      },
    });
    const res = await h.analyze_bundle({ url: PAGE, keywords: ["attachLetterSwap"], maxChunks: 5 });
    expect(res.isError).toBeUndefined();
    expect(seen).toEqual([{ url: PAGE, opts: { keywords: ["attachLetterSwap"], maxChunks: 5 } }]);
    const parsed = JSON.parse((res.content[0] as any).text);
    expect(parsed.matches).toEqual(report.matches);
    expect(parsed.outDir).toBe(report.outDir);
  });

  it("surfaces a bundleFn { error } as isError text", async () => {
    const h = createHandlers({
      client: new AwwwardsClient(),
      cache: new Cache(cacheDir()),
      bundleFn: async () => ({ error: "HTTP 404 for https://site.test/index.html" }),
    });
    const res = await h.analyze_bundle({ url: PAGE });
    expect(res.isError).toBe(true);
    expect((res.content[0] as any).text).toContain("HTTP 404");
  });
});
