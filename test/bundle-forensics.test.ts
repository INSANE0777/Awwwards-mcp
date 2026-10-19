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
        source: "raw",
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
      webcrack: async (_code: string) => ({
        code: "/* pretty */\n" + "function attach(){}", // pretty carries the keyword; the raw chunk does not
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
    // The keyword exists ONLY in the pretty content — the union-scan found it
    // there and labeled it "pretty" (raw chunks scan as "raw" elsewhere).
    expect(rep.matches).toEqual([
      {
        chunk: 0,
        url: A_JS,
        line: 2, // after "/* pretty */" — the keyword is on the pretty file's second line
        preview: expect.stringContaining("attach"),
        keyword: "attach",
        source: "pretty",
      },
    ]);
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

  it("shows the installed-but-nothing-unpacked hint when webcrack loads but unpacks zero chunks", async () => {
    const unpackLoader = async () => ({
      webcrack: async () => {
        throw new Error("boom");
      },
    });
    const rep = await captureBundleForensics(PAGE, { fetchFn: unpackFetch, unpackLoader });
    expect("error" in rep).toBe(false);
    if ("error" in rep) return;
    cleanup.push(rep.outDir);
    expect(rep.unpacked).toBe(false);
    // Distinct wording, no install tone; the unpack bounds are spelled out.
    expect(rep.hint).toContain("installed but nothing was unpacked");
    expect(rep.hint).toContain("first 10 chunks");
    expect(rep.hint).toContain("2MB");
    expect(rep.hint).not.toContain("npm install");
    expect(rep.warnings.join("\n")).toContain("unpack skipped chunk 0: boom");
  });

  it("unpack cap consumes only qualifying chunks: 2 oversized + 10 small → 10 unpacked", async () => {
    const srcs = Array.from({ length: 12 }, (_, i) => `${pageOrigin}/k${i}.js`);
    const map: Record<string, string> = {
      [PAGE]: `<html>${srcs.map((s) => `<script src="${s}"></script>`).join("")}</html>`,
    };
    for (let i = 0; i < srcs.length; i++) map[srcs[i]!] = i < 2 ? "x".repeat(2_500_000) : "var q=1;";
    const unpackLoader = async () => ({
      webcrack: async (code: string) => ({
        code: "/* pretty */\n" + code,
        bundle: { modules: new Map([[1, { id: 1, code: "const y = 1;", path: "1.js" }]]) },
      }),
    });
    const rep = await captureBundleForensics(PAGE, { fetchFn: fakeFetchMap(map), unpackLoader });
    expect("error" in rep).toBe(false);
    if ("error" in rep) return;
    cleanup.push(rep.outDir);
    expect(rep.unpacked).toBe(true);
    const deobfuscated = rep.chunks.filter((c) => c.deobfuscated).length;
    expect(deobfuscated).toBe(10); // slots filled by qualifying chunks, not positions
    expect(rep.warnings.filter((w) => w.includes("unpack skipped")).length).toBe(2); // the 2 oversized
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

  it("silently skips inline JSON-data scripts (ld+json/importmap/speculationrules); other non-JS types stay captured", async () => {
    const map: Record<string, string> = {
      [PAGE]: [
        `<script type="application/ld+json">{"name":"x"}</script>`,
        `<script type="importmap">{"imports":{}}</script>`,
        `<script type="speculationrules">{"prefetch":[]}</script>`,
        `<script type="text/template">tpl()</script>`, // not one of the JSON-data types → still a chunk
        `<script>real()</script>`,
      ].join(""),
    };
    const rep = await captureBundleForensics(PAGE, { fetchFn: fakeFetchMap(map), unpackLoader: async () => null });
    expect("error" in rep).toBe(false);
    if ("error" in rep) return;
    cleanup.push(rep.outDir);
    // Only the two runnable inline scripts survive; inert JSON data is not bundle.
    expect(rep.chunks.map((c) => c.url)).toEqual(["inline:0", "inline:1"]);
    expect(readFileSync(rep.chunks[0].path, "utf8")).toBe("tpl()");
    expect(readFileSync(rep.chunks[1].path, "utf8")).toBe("real()");
    expect(rep.warnings).toEqual([]); // the JSON-data skips are silent
  });
});

describe("walkChunks (B3: opt-in deep chunk walk)", () => {
  const B2_JS = `${pageOrigin}/b.js`;
  const C_JS = `${pageOrigin}/c.js`;
  // a.js references itself (already-fetched → no refetch) and two more chunks;
  // b.js points back at a.js (cycle → seen-set) and on to c.js. Ref bodies
  // stay ≥7 chars — the plan-pinned lazy regex can't see shorter ones.
  const walkMap: Record<string, string> = {
    [PAGE]: `<html><script src="/a.js"></script></html>`,
    [A_JS]: `var self = "${A_JS}"; var next = "../b.js";`,
    [B2_JS]: `var back = "${A_JS}"; var deeper = "../c.js";`,
    [C_JS]: `terminal-marker(1);`,
  };
  const countingFetch = (map: Record<string, string>, calls: string[]) =>
    async (url: string) => {
      calls.push(url);
      return fakeFetchMap(map)(url);
    };

  it("walks quoted same-origin refs once; self-refs and cycles stay safe; walk chunks are keyword-searched", async () => {
    const calls: string[] = [];
    const rep = await captureBundleForensics(PAGE, {
      fetchFn: countingFetch(walkMap, calls),
      keywords: ["terminal-marker"],
      walkChunks: true,
      unpackLoader: async () => null,
    });
    expect("error" in rep).toBe(false);
    if ("error" in rep) return;
    cleanup.push(rep.outDir);
    // page + first pass, then exactly one extra fetch per discovered chunk
    expect(calls).toEqual([PAGE, A_JS, B2_JS, C_JS]);
    expect(rep.chunks.map((c) => c.url)).toEqual([A_JS, B2_JS, C_JS]);
    // walk bytes are keyword-searched like the rest
    expect(rep.matches.some((m) => m.url === C_JS && m.keyword === "terminal-marker")).toBe(true);
    expect(rep.warnings).toEqual([]);
  });

  it("walkChunks absent → zero extra fetches (pin)", async () => {
    const calls: string[] = [];
    const rep = await captureBundleForensics(PAGE, {
      fetchFn: countingFetch(walkMap, calls),
      unpackLoader: async () => null,
    });
    expect("error" in rep).toBe(false);
    if ("error" in rep) return;
    cleanup.push(rep.outDir);
    expect(calls).toEqual([PAGE, A_JS]); // page + html-advertised chunks only
    expect(rep.chunkCount).toBe(1);
  });

  it("walk cap is 20 discovered chunks per run", async () => {
    // 2-digit padding keeps every ref body ≥7 chars (regex minimum above)
    const wUrls = Array.from({ length: 25 }, (_, i) => `${pageOrigin}/w${String(i).padStart(2, "0")}.js`);
    const map: Record<string, string> = {
      [PAGE]: `<html><script src="/a.js"></script></html>`,
      [A_JS]: Array.from({ length: 25 }, (_, i) => `var p${i}="/w${String(i).padStart(2, "0")}.js";`).join(""),
    };
    for (const u of wUrls) map[u] = "z".repeat(60);
    const rep = await captureBundleForensics(PAGE, {
      fetchFn: fakeFetchMap(map),
      walkChunks: true,
      unpackLoader: async () => null,
    });
    expect("error" in rep).toBe(false);
    if ("error" in rep) return;
    cleanup.push(rep.outDir);
    expect(rep.chunkCount).toBe(21); // 1 first-pass + hard cap 20
    expect(rep.warnings.join("\n")).toContain("walk cap (20)");
    expect(rep.warnings.join("\n")).toContain("5 discovered chunk(s) left unfetched");
  });

  it("walk fetches stay under maxTotalBytes (oversized discoveries skip with a walk-marked warning)", async () => {
    const map: Record<string, string> = {
      [PAGE]: `<html><script src="/a.js"></script></html>`,
      [A_JS]: "y".repeat(5000) + `var next="../b.js";`,
      [B2_JS]: "z".repeat(5000),
    };
    const rep = await captureBundleForensics(PAGE, {
      fetchFn: fakeFetchMap(map),
      maxTotalBytes: 6000,
      walkChunks: true,
      unpackLoader: async () => null,
    });
    expect("error" in rep).toBe(false);
    if ("error" in rep) return;
    cleanup.push(rep.outDir);
    expect(rep.chunkCount).toBe(1);
    expect(rep.warnings.join("\n")).toContain("/b.js: would exceed maxTotalBytes");
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

  it("passes walkChunks through to bundleFn opts", async () => {
    let seenOpts: { keywords?: string[]; maxChunks?: number; walkChunks?: boolean } | undefined;
    const h = createHandlers({
      client: new AwwwardsClient(),
      cache: new Cache(cacheDir()),
      bundleFn: async (_url, opts) => {
        seenOpts = opts;
        return { error: "short-circuit" };
      },
    });
    await h.analyze_bundle({ url: PAGE, walkChunks: true, maxChunks: 3 });
    expect(seenOpts).toEqual({ maxChunks: 3, walkChunks: true });
  });
});
