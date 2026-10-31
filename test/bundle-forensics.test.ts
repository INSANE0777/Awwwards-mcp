import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captureBundleForensics, extractBundleIntel, extractEdges } from "../src/bundle-forensics.js";
import { createHandlers } from "../src/server.js";
import { AwwwardsClient } from "../src/awwwards.js";
import { Cache } from "../src/cache.js";

const PAGE = "https://site.test/index.html";
const pageOrigin = "https://site.test";
// URL constants, not path.join — Windows join() backslashes would break the
// forward-slash absolute URLs the module produces via new URL().
const A_JS = `${pageOrigin}/a.js`;
const B_JS = "https://cdn.x.com/b.js";

const BUNDLE_DIR = join(__dirname, "fixtures", "bundle");
const BUNDLE_PAGE = "https://bundle.test/entry.html";
const BUNDLE_A = "https://bundle.test/chunk-a.js";
const BUNDLE_B = "https://bundle.test/chunk-b.js";
const bundleFixture = (name: string) => readFileSync(join(BUNDLE_DIR, name), "utf8");
// Real fixture chunks + a counting fetch, so "never fetches source maps" is
// provable: the call list must stay page + the two HTML-advertised chunks.
const bundleFetch = () => {
  const calls: string[] = [];
  const map: Record<string, string> = {
    [BUNDLE_PAGE]: bundleFixture("entry.html"),
    [BUNDLE_A]: bundleFixture("chunk-a.js"),
    [BUNDLE_B]: bundleFixture("chunk-b.js"),
  };
  const fetchFn = async (url: string) => {
    calls.push(url);
    const body = map[url];
    return body === undefined ? new Response("not found", { status: 404 }) : new Response(body, { status: 200 });
  };
  return { fetchFn, calls };
};

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

  it("failed initial script fetches consume the maxChunks attempt budget", async () => {
    const srcs = [0, 1, 2].map((i) => `https://site.test/fail${i}.js`);
    const map: Record<string, string> = {
      [PAGE]: `<html>${srcs.map((s) => `<script src="${s}"></script>`).join("")}</html>`,
    };
    const calls: string[] = [];
    const fetchFn = async (url: string) => {
      calls.push(url);
      return fakeFetchMap(map)(url);
    };
    const rep = await captureBundleForensics(PAGE, {
      fetchFn,
      maxChunks: 1,
      unpackLoader: async () => null,
    });
    expect("error" in rep).toBe(false);
    if ("error" in rep) return;
    cleanup.push(rep.outDir);
    expect(rep.chunkCount).toBe(0);
    expect(calls.filter((c) => c !== PAGE)).toEqual([srcs[0]]);
    expect(rep.warnings.join("\n")).toContain("attempt budget (1)");
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
  const ALPHA_JS = `${pageOrigin}/alpha.js`;
  const B2_JS = `${pageOrigin}/bpage.js`;
  const C_JS = `${pageOrigin}/cdepth.js`;
  // D1 walk-regex floor: ref bodies need a ≥4-char final path token before
  // ".js", so fixtures use token-length names (alpha/bpage/cdepth) — the
  // old 1-3-char stems ("../b.js") are exactly the junk class the floor
  // excludes. Pins carried over from the original map: a.js's text refs the
  // already-fetched alpha.js (first-pass seen-dedupe), alpha.js self-refs
  // mid-walk, bpage.js walks back to alpha.js (cycle → seen-set), and
  // cdepth.js carries the keyword.
  const walkMap: Record<string, string> = {
    [PAGE]: `<html><script src="/a.js"></script><script src="${ALPHA_JS}"></script></html>`,
    [A_JS]: `var seen = "./alpha.js"; var next = "../bpage.js";`,
    [ALPHA_JS]: `var backKey = "./alpha.js"; var deeper = "../cdepth.js";`,
    [B2_JS]: `var back = "../alpha.js"; var deeper = "../cdepth.js";`,
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
    expect(calls).toEqual([PAGE, A_JS, ALPHA_JS, B2_JS, C_JS]);
    expect(rep.chunks.map((c) => c.url)).toEqual([A_JS, ALPHA_JS, B2_JS, C_JS]);
    // walk bytes are keyword-searched like the rest
    expect(rep.matches.some((m) => m.url === C_JS && m.keyword === "terminal-marker")).toBe(true);
    expect(rep.warnings).toEqual([]);
  });

  it("rejects a walked chunk redirect that leaves the page origin", async () => {
    const WALKER_JS = `${pageOrigin}/walker.js`;
    const REDIRECT_JS = `${pageOrigin}/redirect.js`;
    const EVIL_JS = "https://evil.test/secret.js";
    const urls: string[] = [];
    const fetchFn = async (url: string, init?: RequestInit) => {
      urls.push(url);
      if (url === PAGE) return new Response(`<script src="/walker.js"></script>`, { status: 200 });
      if (url === WALKER_JS) return new Response(`var ref = "./redirect.js";`, { status: 200 });
      if (url === REDIRECT_JS) {
        return init?.redirect === "manual"
          ? new Response(null, { status: 302, headers: { location: EVIL_JS } })
          : new Response("followed", { status: 200 });
      }
      return new Response("not found", { status: 404 });
    };
    const rep = await captureBundleForensics(PAGE, {
      fetchFn,
      walkChunks: true,
      unpackLoader: async () => null,
    });
    expect("error" in rep).toBe(false);
    if ("error" in rep) return;
    cleanup.push(rep.outDir);
    expect(urls).not.toContain(EVIL_JS);
    expect(rep.warnings.join("\n")).toContain("redirect left the page origin");
    expect(rep.chunks.some((c) => c.url === EVIL_JS)).toBe(false);
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
    expect(calls).toEqual([PAGE, A_JS, ALPHA_JS]); // page + html-advertised chunks only
    expect(rep.chunkCount).toBe(2);
  });

  it("walk cap is 20 discovered chunks per run", async () => {
    // 3-digit padding keeps every ref's final stem ≥4 chars (the D1 floor)
    const wUrls = Array.from({ length: 25 }, (_, i) => `${pageOrigin}/w${String(i).padStart(3, "0")}.js`);
    const map: Record<string, string> = {
      [PAGE]: `<html><script src="/a.js"></script></html>`,
      [A_JS]: Array.from({ length: 25 }, (_, i) => `var p${i}="/w${String(i).padStart(3, "0")}.js";`).join(""),
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
      [A_JS]: "y".repeat(5000) + `var next="../bpage.js";`,
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
    expect(rep.warnings.join("\n")).toContain("/bpage.js: would exceed maxTotalBytes");
  });

  // F1 (dogfood): the base pass eating maxChunks must not starve the walk —
  // discovered chunks are the FEATURE and live under their own 20 cap.
  it("walk runs on its own 20-chunk cap: maxChunks exhaustion doesn't stop discovered chunks", async () => {
    const map: Record<string, string> = {
      [PAGE]: `<html><script src="/a.js"></script></html>`,
      [A_JS]: `var next="../bpage.js";`,
      [B2_JS]: "var b=1;",
    };
    const calls: string[] = [];
    const rep = await captureBundleForensics(PAGE, {
      fetchFn: countingFetch(map, calls),
      maxChunks: 1,
      walkChunks: true,
      unpackLoader: async () => null,
    });
    expect("error" in rep).toBe(false);
    if ("error" in rep) return;
    cleanup.push(rep.outDir);
    expect(rep.chunkCount).toBe(2); // a.js (maxChunks budget) + walk-discovered b.js (own cap)
    expect(calls).toEqual([PAGE, A_JS, B2_JS]);
    expect(rep.warnings).toEqual([]); // no "walk stopped: maxChunks" starvation warning
  });

  // F1 (dogfood): byte budget exhausted by the base pass → walk stops with the
  // existing walk-sourced warning and fetches nothing.
  it("byte budget exhausted by the base pass → walk stops with the walk-sourced byte warning", async () => {
    const REF = 'var next="../bpage.js";';
    const map: Record<string, string> = {
      [PAGE]: `<html><script src="/a.js"></script></html>`,
      [A_JS]: "y".repeat(5000 - REF.length) + REF, // exactly maxTotalBytes
      [B2_JS]: "z".repeat(10),
    };
    const calls: string[] = [];
    const rep = await captureBundleForensics(PAGE, {
      fetchFn: countingFetch(map, calls),
      maxTotalBytes: 5000,
      walkChunks: true,
      unpackLoader: async () => null,
    });
    expect("error" in rep).toBe(false);
    if ("error" in rep) return;
    cleanup.push(rep.outDir);
    expect(rep.chunkCount).toBe(1);
    expect(calls).toEqual([PAGE, A_JS]); // b.js never fetched
    expect(rep.warnings.join("\n")).toContain("walk stopped: byte budget (5000 bytes) reached");
  });

  // F2 (dogfood): Turbopack/Next chunk sources carry chunk-relative paths —
  // they must resolve against the CHUNK's own URL, not the page URL.
  // (Sub-token stems like "./b.js" never pass the D1 token floor — hence the
  // long ref names.)
  it("walk resolves chunk-internal refs against the chunk's own URL; cross-origin skipped", async () => {
    const NEXT_A = `${pageOrigin}/_next/static/chunks/a.js`;
    const NEXT_B = `${pageOrigin}/_next/static/chunks/chunk-b.js`;
    const NEXT_C = `${pageOrigin}/_next/static/shared/mod-c.js`;
    const X_JS = "https://cdn.x.com/remote.js";
    const map: Record<string, string> = {
      [PAGE]: `<html><script src="/_next/static/chunks/a.js"></script></html>`,
      [NEXT_A]: `var b="./chunk-b.js"; var c="../shared/mod-c.js"; var x="${X_JS}";`,
      [NEXT_B]: "var b2=1;",
      [NEXT_C]: "var c2=1;",
    };
    const calls: string[] = [];
    const rep = await captureBundleForensics(PAGE, {
      fetchFn: countingFetch(map, calls),
      walkChunks: true,
      unpackLoader: async () => null,
    });
    expect("error" in rep).toBe(false);
    if ("error" in rep) return;
    cleanup.push(rep.outDir);
    // ./ and ../ refs land under /_next/static/... (chunk URL base), fetched
    // exactly once each; the cross-origin ref never fetches.
    expect(calls).toEqual([PAGE, NEXT_A, NEXT_B, NEXT_C]);
    expect(rep.chunks.map((c) => c.url)).toEqual([NEXT_A, NEXT_B, NEXT_C]);
    expect(rep.warnings).toEqual([]);
  });

  // D1 walk-regex floor regression: 1-3-char stems are the junk class that
  // chunk-relative resolution (d087e53) used to actually fetch ("../b.js",
  // dotted "chunk.a.js"); the ≥4-char token floor must keep them unfetched
  // while a real ≥4-char-stem name still walks.
  it("walk regex floor: short-stem refs stay invisible, long-stem refs still walk", async () => {
    const LONG = `${pageOrigin}/longname.js`;
    const map: Record<string, string> = {
      [PAGE]: `<html><script src="/a.js"></script></html>`,
      [A_JS]: `var j1 = "../b.js"; var j2 = "chunk.a.js"; var j3 = "./x.js"; var real = "./longname.js";`,
      [LONG]: "var real=1;",
    };
    const calls: string[] = [];
    const rep = await captureBundleForensics(PAGE, {
      fetchFn: countingFetch(map, calls),
      walkChunks: true,
      unpackLoader: async () => null,
    });
    expect("error" in rep).toBe(false);
    if ("error" in rep) return;
    cleanup.push(rep.outDir);
    expect(calls).toEqual([PAGE, A_JS, LONG]); // the junk classes never fetch
    expect(rep.chunks.map((c) => c.url)).toEqual([A_JS, LONG]);
    expect(rep.warnings).toEqual([]);
  });

  // D2 grab-bag: the token floor killed "vendor.min.js" because its last
  // token is the 3-char "min" — a ".min.js" ending is now an alternative
  // acceptance branch, while non-min junk keeps needing the floor.
  it("walk regex: .min.js endings are accepted, ../b.js junk still rejected", async () => {
    const VENDOR = `${pageOrigin}/vendor.min.js`;
    const map: Record<string, string> = {
      [PAGE]: `<html><script src="/a.js"></script></html>`,
      [A_JS]: `var v = "./vendor.min.js"; var j = "../b.js"; var j2 = "fake.min.js.txt";`,
      [VENDOR]: "var vendor=1;",
    };
    const calls: string[] = [];
    const rep = await captureBundleForensics(PAGE, {
      fetchFn: countingFetch(map, calls),
      walkChunks: true,
      unpackLoader: async () => null,
    });
    expect("error" in rep).toBe(false);
    if ("error" in rep) return;
    cleanup.push(rep.outDir);
    expect(calls).toEqual([PAGE, A_JS, VENDOR]); // vendor discovered, junk never fetched
    expect(rep.chunks.map((c) => c.url)).toEqual([A_JS, VENDOR]);
    expect(rep.warnings).toEqual([]);
  });
});

describe("captureBundleForensics bounds (Codex review #5)", () => {
  const countingFetch = (map: Record<string, string>, calls: string[]) => async (url: string) => {
    calls.push(url);
    return fakeFetchMap(map)(url);
  };

  it("failed walk attempts consume the 20-attempt cap — no 21st request", async () => {
    const names = Array.from({ length: 25 }, (_, i) => `w${String(i).padStart(3, "0")}.js`);
    // Every ref is real-shaped but the walk URLs all 404: attempts must still
    // spend the cap, so the run stops after 20 walk requests.
    const map: Record<string, string> = {
      [PAGE]: `<html><script src="/a.js"></script></html>`,
      [A_JS]: names.map((n) => `var p="/${n}";`).join(""),
    };
    const calls: string[] = [];
    const rep = await captureBundleForensics(PAGE, {
      fetchFn: countingFetch(map, calls),
      walkChunks: true,
      unpackLoader: async () => null,
    });
    expect("error" in rep).toBe(false);
    if ("error" in rep) return;
    cleanup.push(rep.outDir);
    expect(rep.chunkCount).toBe(1); // only the HTML-advertised chunk
    expect(calls).toHaveLength(2 + 20); // page + a.js + exactly 20 attempts
    expect(calls.filter((u) => u.includes("/w")).length).toBe(20);
    expect(calls).not.toContain(`${pageOrigin}/${names[20]}`);
    expect(rep.warnings.filter((w) => w.startsWith("skipped walk chunk"))).toHaveLength(20);
    expect(rep.warnings.join("\n")).toContain("walk cap (20)");
    expect(rep.warnings.join("\n")).toContain("5 discovered chunk(s) left unfetched");
  });

  it("keeps the chunk deadline through body consumption, not just headers", async () => {
    const stalled = new ReadableStream<Uint8Array>({
      pull: () => new Promise<void>(() => {}), // never enqueues, never closes
    });
    const fetchFn = async (url: string) =>
      url === PAGE
        ? new Response(`<html><script src="/a.js"></script></html>`, { status: 200 })
        : new Response(stalled, { status: 200 });
    const rep = await captureBundleForensics(PAGE, {
      fetchFn,
      timeoutMs: 250,
      unpackLoader: async () => null,
    });
    expect("error" in rep).toBe(false);
    if ("error" in rep) return;
    cleanup.push(rep.outDir);
    expect(rep.chunkCount).toBe(0);
    expect(rep.warnings.join("\n")).toContain("timed out");
  });

  it("cuts an oversized streamed chunk at the byte cap and cancels the body", async () => {
    let pulls = 0;
    let cancelled = false;
    const chunk = new Uint8Array(512).fill(120);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchFn = async (url: string) =>
      url === PAGE
        ? new Response(`<html><script src="/a.js"></script></html>`, { status: 200 })
        : new Response(stream, { status: 200 });
    const rep = await captureBundleForensics(PAGE, {
      fetchFn,
      maxTotalBytes: 1500,
      unpackLoader: async () => null,
    });
    expect("error" in rep).toBe(false);
    if ("error" in rep) return;
    cleanup.push(rep.outDir);
    expect(rep.chunkCount).toBe(0);
    expect(cancelled).toBe(true);
    // 512-byte pulls: the third crosses 1500; no full materialization.
    expect(pulls).toBeLessThanOrEqual(5);
    expect(rep.warnings.join("\n")).toContain("maxTotalBytes");
  });

  it("cuts an oversized streamed HTML body at the byte cap", async () => {
    let pulls = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(new Uint8Array(1024).fill(60));
      },
      cancel() {
        cancelled = true;
      },
    });
    const rep = await captureBundleForensics(PAGE, {
      fetchFn: async () => new Response(stream, { status: 200 }),
      maxTotalBytes: 2048,
      unpackLoader: async () => null,
    });
    expect("error" in rep).toBe(true);
    if (!("error" in rep)) return;
    expect(rep.error).toContain("maxTotalBytes");
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThanOrEqual(5);
  });
});

describe("extractEdges (D1: static import edges)", () => {
  const mk = (index: number, url: string, text: string) => ({ index, url, text });
  const A = `${pageOrigin}/a.js`;

  it("finds all four families over chunk text; specifiers stay verbatim raw strings", () => {
    const g = extractEdges([
      mk(
        0,
        A,
        `import {x} from "react-dom";import"./poly.js";export * from "./helpers.js";var r=require("./cfg.json");e.i(870178);`,
      ),
    ]);
    expect(g.edges).toEqual([
      { from: 0, to: "react-dom", kind: "esm-import", raw: 'import {x} from "react-dom"' },
      { from: 0, to: "./poly.js", kind: "esm-import", raw: 'import"./poly.js"' },
      { from: 0, to: "./helpers.js", kind: "esm-reexport", raw: 'export * from "./helpers.js"' },
      { from: 0, to: "./cfg.json", kind: "cjs-require", raw: 'require("./cfg.json"' },
      { from: 0, to: "870178", kind: "webpack-id", raw: "e.i(870178)" },
    ]);
    // Nothing captured on the horizon → every edge honestly counts unresolved.
    expect(g.unresolved).toBe(5);
  });

  it("counts an edge resolved only when its relative specifier lands on a captured chunk", () => {
    const NA = `${pageOrigin}/_next/static/a.js`;
    const NB = `${pageOrigin}/_next/static/chunk-b.js`;
    const g = extractEdges([
      mk(0, NA, `import {b} from "./chunk-b.js"; import "react"; e.i(870178);`),
      mk(1, NB, "var b=1;"),
    ]);
    expect(g.edges.map((e) => [e.from, e.to, e.kind])).toEqual([
      [0, "./chunk-b.js", "esm-import"],
      [0, "react", "esm-import"],
      [0, "870178", "webpack-id"],
    ]);
    // "react" and the webpack id can't be checked → unresolved; the relative
    // specifier landed exactly on chunk 1 — no URL was guessed, counted vs not.
    expect(g.unresolved).toBe(2);
  });

  it("dedupes first-wins per (chunk, kind, target); cross-chunk repeats stay separate edges", () => {
    const text = `import x from "./once.js"; import y from "./once.js"; export * from "./once.js";`;
    const g = extractEdges([mk(0, A, text), mk(1, `${pageOrigin}/bee.js`, text)]);
    expect(g.edges.map((e) => [e.from, e.kind])).toEqual([
      [0, "esm-import"],
      [0, "esm-reexport"],
      [1, "esm-import"],
      [1, "esm-reexport"],
    ]);
    expect(g.unresolved).toBe(4); // each chunk's two unlanded targets count
  });

  it("caps at 20 unique edges per chunk and 400 total", () => {
    const many = (base: number) => Array.from({ length: 25 }, (_, i) => `var r=require("./m${base + i}.js");`).join("");
    const chunks = Array.from({ length: 25 }, (_, c) => mk(c, `${pageOrigin}/c${c}.js`, many(c * 100)));
    const g = extractEdges(chunks);
    // 20 unique/chunk × 20 chunks fill the 400 total; chunk 23+24 already drop.
    expect(g.edges).toHaveLength(400);
    expect(g.unresolved).toBe(400);
    expect(g.edges.filter((e) => e.from >= 23)).toHaveLength(0);
    expect(g.truncated).toBe(true); // 625 candidates → caps actually dropped edges
  });

  it("exact caps are not truncation: 20/20 per chunk and 400/400 total stay complete", () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `import x${i} from "./m${i}.js";`).join("");
    expect(extractEdges([mk(0, A, twenty)]).truncated).toBe(false);
    const exact = Array.from({ length: 20 }, (_, c) => mk(c, `${pageOrigin}/e${c}.js`, twenty));
    const g = extractEdges(exact);
    expect(g.edges).toHaveLength(400);
    expect(g.truncated).toBe(false); // exactly the cap, nothing dropped
  });

  it("finds long import and reexport declarations, not just 500-char windows", () => {
    // Padding to an exact fixture length; the binding list is one long but
    // syntactically legal identifier, as in bundled vendor chunks.
    const sized = (head: string, tail: string, total: number) =>
      head + "x".repeat(total - head.length - tail.length) + tail;
    const longImport = sized(`import { `, ` } from "./long-import.js";`, 646);
    const longReexport = sized(`export { `, ` } from "./long-reexport.js";`, 1411);
    expect(longImport).toHaveLength(646);
    expect(longReexport).toHaveLength(1411);

    const namedReexport = `export { a as b } from "./named.js";`;
    const g = extractEdges([mk(0, A, longImport + longReexport + namedReexport)]);
    expect(g.edges).toEqual([
      {
        from: 0,
        to: "./long-import.js",
        kind: "esm-import",
        raw: longImport.slice(0, -1),
      },
      {
        from: 0,
        to: "./long-reexport.js",
        kind: "esm-reexport",
        raw: longReexport.slice(0, -1),
      },
      {
        from: 0,
        to: "./named.js",
        kind: "esm-reexport",
        raw: namedReexport.slice(0, -1),
      },
    ]);
    expect(g.truncated).toBe(false); // long declarations are not silently dropped
  });

  it("keeps exactly 20 long imports: the per-chunk cap is not false truncation", () => {
    const sized = (i: number) =>
      `import { ${"x".repeat(620)} } from "./long-${i}.js";`;
    const g = extractEdges([mk(0, A, Array.from({ length: 20 }, (_, i) => sized(i)).join(""))]);
    expect(g.edges).toHaveLength(20);
    expect(g.truncated).toBe(false);
  });

  it("drops declarations beyond the 8KB declaration cap and marks truncated", () => {
    const huge = `import { ${"x".repeat(9000)} } from "./huge.js";`;
    const g = extractEdges([mk(0, A, huge)]);
    expect(g.edges).toEqual([]);
    expect(g.truncated).toBe(true); // dropped by the declaration cap, not silently lost
  });

  it("keeps a declaration pending across dots in comments", () => {
    const source = `import { a } /* x. */ from "./dot.js";`;
    const g = extractEdges([mk(0, A, source)]);
    expect(g.edges).toEqual([
      { from: 0, to: "./dot.js", kind: "esm-import", raw: source.slice(0, -1) },
    ]);
    expect(g.truncated).toBe(false);
  });

  it("stays linear on a 1MB import flood (no cross-statement regex backtracking)", () => {
    // Regression for the old /\bimport\b[^;'"()]*?\bfrom.../ family: with no
    // "from" anywhere, the lazy bridge backtracked over the whole chunk for
    // every keyword. The statement scanner must return no edges promptly.
    const text = "import ".repeat(Math.ceil((1024 * 1024) / 7));
    const started = performance.now();
    const g = extractEdges([mk(0, A, text)]);
    const elapsed = performance.now() - started;
    expect(g.edges).toEqual([]);
    expect(elapsed).toBeLessThan(2000);
  });
});

describe("captureBundleForensics edges (D1: opt-in static import graph)", () => {
  const edgeMap = () => ({
    [PAGE]: `<html><script src="/a.js"></script><script src="/bpage.js"></script></html>`,
    [A_JS]: `import {x} from "./bpage.js"; var r=require("react"); e.i(870178);`,
    [`${pageOrigin}/bpage.js`]: "var bp=1;",
  });

  it("edges: true adds edges + edgeCount + unresolved over the saved raw chunks", async () => {
    const rep = await captureBundleForensics(PAGE, {
      fetchFn: fakeFetchMap(edgeMap()),
      edges: true,
      unpackLoader: async () => null,
    });
    expect("error" in rep).toBe(false);
    if ("error" in rep) return;
    cleanup.push(rep.outDir);
    expect(rep.edges).toEqual([
      { from: 0, to: "./bpage.js", kind: "esm-import", raw: 'import {x} from "./bpage.js"' },
      { from: 0, to: "react", kind: "cjs-require", raw: 'require("react"' },
      { from: 0, to: "870178", kind: "webpack-id", raw: "e.i(870178)" },
    ]);
    expect(rep.edgeCount).toBe(3);
    expect(rep.unresolved).toBe(2); // ./bpage.js landed on a captured chunk; react + id did not
  });

  it("default output is byte-identical: none of the three graph keys ever appear", async () => {
    for (const edges of [undefined, false]) {
      const rep = await captureBundleForensics(PAGE, {
        fetchFn: fakeFetchMap(edgeMap()),
        edges,
        unpackLoader: async () => null,
      });
      expect("error" in rep).toBe(false);
      if ("error" in rep) return;
      cleanup.push(rep.outDir);
      expect("edges" in rep).toBe(false);
      expect("edgeCount" in rep).toBe(false);
      expect("unresolved" in rep).toBe(false);
    }
  });
});

describe("bundle intelligence (opt-in bundleIntel)", () => {
  it("default output is key-identical to the current fixture report", async () => {
    const { fetchFn } = bundleFetch();
    const rep = await captureBundleForensics(BUNDLE_PAGE, { fetchFn, unpackLoader: async () => null });
    expect("error" in rep).toBe(false);
    if ("error" in rep) return;
    cleanup.push(rep.outDir);
    expect(Object.keys(rep).sort()).toEqual([
      "chunkCount",
      "chunks",
      "hint",
      "host",
      "matches",
      "outDir",
      "totalBytes",
      "unpacked",
      "unpackedDir",
      "url",
      "warnings",
    ]);
    for (const key of ["routes", "vendors", "sourceMaps", "moduleGraph", "evidenceCoverage"]) {
      expect(key in rep).toBe(false);
    }
  });

  it("reports exact route, vendor, source-map, module-graph and coverage fields", async () => {
    const { fetchFn } = bundleFetch();
    const rep = await captureBundleForensics(BUNDLE_PAGE, {
      fetchFn,
      bundleIntel: true,
      unpackLoader: async () => null,
    });
    expect("error" in rep).toBe(false);
    if ("error" in rep) return;
    cleanup.push(rep.outDir);
    // Quoted absolute paths only, 2+ segments, query/hash stripped, deduped,
    // fetch > axios > string; the duplicate /api/users collapses.
    expect(rep.routes).toEqual([
      { method: "POST", route: "/api/users", foundVia: "fetch", chunk: 0 },
      { method: null, route: "/blog/post-1", foundVia: "string", chunk: 0 },
      { method: "GET", route: "/api/posts", foundVia: "axios", chunk: 1 },
    ]);
    expect(rep.vendors).toEqual([
      { name: "react", chunk: 0 },
      { name: "gsap", chunk: 1 },
      { name: "three", chunk: 1 },
      { name: "framer-motion", chunk: 1 },
    ]);
    expect(rep.sourceMaps).toEqual([
      { chunk: 0, inline: true },
      { chunk: 1, inline: false, path: "https://cdn.example.com/maps/chunk-b.js.map" },
    ]);
    expect(rep.moduleGraph).toEqual({
      nodes: 2,
      edges: 3,
      truncated: false,
      externalSpecifiers: ["gsap", "lodash"],
    });
    expect(rep.evidenceCoverage).toEqual({
      status: "complete",
      collected: 2,
      excluded: 0,
      limitations: [],
    });
    // Enabled intel adds exactly these five keys — never the `edges` trio.
    expect(Object.keys(rep).sort()).toEqual([
      "chunkCount",
      "chunks",
      "evidenceCoverage",
      "hint",
      "host",
      "matches",
      "moduleGraph",
      "outDir",
      "routes",
      "sourceMaps",
      "totalBytes",
      "unpacked",
      "unpackedDir",
      "url",
      "vendors",
      "warnings",
    ]);
  });

  it("coverage: all candidates failing yields unknown, partial collection yields partial", async () => {
    const fixtureMap = {
      [BUNDLE_PAGE]: bundleFixture("entry.html"),
      [BUNDLE_A]: bundleFixture("chunk-a.js"),
      [BUNDLE_B]: bundleFixture("chunk-b.js"),
    };

    const failed = await captureBundleForensics(BUNDLE_PAGE, {
      fetchFn: fakeFetchMap({ [BUNDLE_PAGE]: bundleFixture("entry.html") }),
      bundleIntel: true,
      unpackLoader: async () => null,
    });
    expect("error" in failed).toBe(false);
    if ("error" in failed) return;
    cleanup.push(failed.outDir);
    // total = 2 HTML-advertised targets, collected = 0 → unknown, not partial.
    expect(failed.evidenceCoverage).toEqual({
      status: "unknown",
      collected: 0,
      excluded: 2,
      limitations: [expect.stringContaining(BUNDLE_A), expect.stringContaining(BUNDLE_B)],
    });

    const partial = await captureBundleForensics(BUNDLE_PAGE, {
      fetchFn: fakeFetchMap({ [BUNDLE_PAGE]: fixtureMap[BUNDLE_PAGE], [BUNDLE_A]: fixtureMap[BUNDLE_A] }),
      bundleIntel: true,
      unpackLoader: async () => null,
    });
    expect("error" in partial).toBe(false);
    if ("error" in partial) return;
    cleanup.push(partial.outDir);
    expect(partial.evidenceCoverage).toEqual({
      status: "partial",
      collected: 1,
      excluded: 1,
      limitations: [expect.stringContaining(BUNDLE_B)],
    });
  });

  it("coverage ignores unpack warnings (capture complete stays complete)", async () => {
    const map = {
      [PAGE]: `<html><script src="/a.js"></script></html>`,
      [A_JS]: "var a=1;",
    };
    const rep = await captureBundleForensics(PAGE, {
      fetchFn: fakeFetchMap(map),
      bundleIntel: true,
      unpackLoader: async () => ({
        webcrack: async () => {
          throw new Error("boom");
        },
      }),
    });
    expect("error" in rep).toBe(false);
    if ("error" in rep) return;
    cleanup.push(rep.outDir);
    expect(rep.warnings.join("\n")).toContain("unpack skipped chunk 0: boom");
    expect(rep.evidenceCoverage).toEqual({
      status: "complete",
      collected: 1,
      excluded: 0,
      limitations: [],
    });
  });

  it("never fetches a source map: fetch calls identical with and without intel", async () => {
    const plain = bundleFetch();
    const plainRep = await captureBundleForensics(BUNDLE_PAGE, { fetchFn: plain.fetchFn, unpackLoader: async () => null });
    if (!("error" in plainRep)) cleanup.push(plainRep.outDir);
    const intel = bundleFetch();
    const intelRep = await captureBundleForensics(BUNDLE_PAGE, {
      fetchFn: intel.fetchFn,
      bundleIntel: true,
      unpackLoader: async () => null,
    });
    if (!("error" in intelRep)) cleanup.push(intelRep.outDir);
    expect("error" in intelRep).toBe(false);
    expect(intel.calls).toEqual(plain.calls);
    expect(intel.calls).toEqual([BUNDLE_PAGE, BUNDLE_A, BUNDLE_B]);
    expect(intel.calls.some((u) => u.endsWith(".map"))).toBe(false);
  });

  it("edges: true output is unchanged by the intel code path", async () => {
    const { fetchFn } = bundleFetch();
    const rep = await captureBundleForensics(BUNDLE_PAGE, { fetchFn, edges: true, unpackLoader: async () => null });
    expect("error" in rep).toBe(false);
    if ("error" in rep) return;
    cleanup.push(rep.outDir);
    expect(rep.edges).toEqual([
      { from: 1, to: "./chunk-a.js", kind: "esm-import", raw: 'import { boot } from "./chunk-a.js"' },
      { from: 1, to: "gsap", kind: "esm-import", raw: 'import gsap from "gsap"' },
      { from: 1, to: "lodash", kind: "esm-import", raw: 'import lodash from "lodash"' },
    ]);
    expect(rep.edgeCount).toBe(3);
    expect(rep.unresolved).toBe(2); // ./chunk-a.js lands on a captured chunk; gsap/lodash do not
    expect("routes" in rep).toBe(false);
    expect("evidenceCoverage" in rep).toBe(false);
  });

  it("caps routes at 30 globally, dedupes by chunk|method|route and sorts chunk then route", () => {
    const routes = Array.from({ length: 35 }, (_, i) => `var r${i}="/api/r${String(i).padStart(2, "0")}";`);
    // Same route twice in one chunk with the same method → one evidence row.
    const intel = extractBundleIntel([{ index: 0, text: routes.join("") + `var again="/api/r00";` }]);
    expect(intel.routes).toHaveLength(30);
    expect(intel.routes[0]).toEqual({ method: null, route: "/api/r00", foundVia: "string", chunk: 0 });
    expect(intel.routes.at(-1)?.route).toBe("/api/r29");
    expect(intel.routes.map((r) => r.route)).toEqual(
      Array.from({ length: 30 }, (_, i) => `/api/r${String(i).padStart(2, "0")}`),
    );
  });

  it("caps vendors at 20, one row per vendor per chunk", () => {
    const chunks = Array.from({ length: 25 }, (_, i) => ({ index: i, text: "react.production" }));
    const intel = extractBundleIntel(chunks);
    expect(intel.vendors).toHaveLength(20);
    expect(intel.vendors[0]).toEqual({ name: "react", chunk: 0 });
    expect(intel.vendors.at(-1)).toEqual({ name: "react", chunk: 19 });
  });

  it("source maps: inline keeps no value, remote strips query/hash and caps at 200", () => {
    const longPath = `https://cdn.test/${"a".repeat(250)}.map?x=1#y`;
    const intel = extractBundleIntel([
      { index: 0, text: `//# sourceMappingURL=${longPath}` },
      { index: 1, text: `/*# sourceMappingURL=data:application/json;base64,AAAA */` },
    ]);
    expect(intel.sourceMaps[0]).toEqual({ chunk: 0, inline: false, path: longPath.replace(/[?#].*$/, "").slice(0, 200) });
    expect(intel.sourceMaps[0]?.path).toHaveLength(200);
    // Inline marker carries presence only — the data URL is never returned.
    expect(intel.sourceMaps[1]).toEqual({ chunk: 1, inline: true });
    expect(JSON.stringify(intel.sourceMaps)).not.toContain("data:");
  });

  it("caps source-map rows at 10 after dedupe", () => {
    const chunks = Array.from({ length: 12 }, (_, i) => ({
      index: i,
      text: `//# sourceMappingURL=/maps/m${i}.map`,
    }));
    // Duplicate markers in the same chunk must not consume cap rows.
    chunks.push({ index: 0, text: "//# sourceMappingURL=/maps/m0.map" });
    const intel = extractBundleIntel(chunks);
    expect(intel.sourceMaps).toHaveLength(10);
    expect(intel.sourceMaps.map((s) => s.chunk)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(intel.sourceMaps.at(-1)?.path).toBe("/maps/m9.map");
  });

  it("module graph filters numeric/relative/absolute specifiers, caps externals at 20, flags the 400-edge cap", () => {
    const first = [
      `import a from "./rel.js";`,
      `import b from "/abs.js";`,
      `import c from "123";`,
      ...Array.from({ length: 3 }, (_, i) => `import x${i} from "pkg-${i}";`),
    ].join("");
    const second = Array.from({ length: 25 }, (_, i) => `import y${i} from "pkg-${i}";`).join("");
    const intel = extractBundleIntel([
      { index: 0, text: first },
      { index: 1, text: second },
    ]);
    expect(intel.moduleGraph.nodes).toBe(2);
    expect(intel.moduleGraph.edges).toBe(26);
    expect(intel.moduleGraph.truncated).toBe(true); // chunk 1's 25 imports hit the per-chunk 20 cap
    expect(intel.moduleGraph.externalSpecifiers).toHaveLength(20);
    expect(intel.moduleGraph.externalSpecifiers).toEqual(
      Array.from({ length: 20 }, (_, i) => `pkg-${i}`).sort(),
    );

    const capped = extractBundleIntel(
      Array.from({ length: 21 }, (_, c) => ({
        index: c,
        text: Array.from({ length: 20 }, (_, i) => `import z${i} from "p${c}-${i}";`).join(""),
      })),
    );
    expect(capped.moduleGraph.edges).toBe(400);
    expect(capped.moduleGraph.truncated).toBe(true);
    expect(capped.moduleGraph.externalSpecifiers).toHaveLength(20);
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

  it("passes edges through to bundleFn opts", async () => {
    let seenOpts: { keywords?: string[]; maxChunks?: number; walkChunks?: boolean; edges?: boolean } | undefined;
    const h = createHandlers({
      client: new AwwwardsClient(),
      cache: new Cache(cacheDir()),
      bundleFn: async (_url, opts) => {
        seenOpts = opts;
        return { error: "short-circuit" };
      },
    });
    await h.analyze_bundle({ url: PAGE, edges: true, maxChunks: 2 });
    expect(seenOpts).toEqual({ maxChunks: 2, edges: true });
  });

  it("passes bundleIntel through and serializes the intel fields", async () => {
    let seenOpts: { bundleIntel?: boolean } | undefined;
    const h = createHandlers({
      client: new AwwwardsClient(),
      cache: new Cache(cacheDir()),
      bundleFn: async (_url, opts) => {
        seenOpts = opts;
        return {
          url: PAGE,
          host: "site.test",
          outDir: join("tmp", "chunks-intel"),
          chunkCount: 1,
          totalBytes: 10,
          chunks: [{ index: 0, url: A_JS, bytes: 10, sha1: "a".repeat(40), path: join("tmp", "0-a.js") }],
          matches: [],
          warnings: [],
          unpacked: false,
          routes: [{ method: "POST", route: "/api/users", foundVia: "fetch", chunk: 0 }],
          vendors: [{ name: "react", chunk: 0 }],
          sourceMaps: [{ chunk: 0, inline: true }],
          moduleGraph: { nodes: 1, edges: 0, truncated: false, externalSpecifiers: [] },
          evidenceCoverage: { status: "complete", collected: 1, excluded: 0, limitations: [] },
        };
      },
    });
    const res = await h.analyze_bundle({ url: PAGE, bundleIntel: true });
    expect(res.isError).toBeUndefined();
    expect(seenOpts).toEqual({ bundleIntel: true });
    const parsed = JSON.parse((res.content[0] as any).text);
    expect(parsed.routes).toEqual([{ method: "POST", route: "/api/users", foundVia: "fetch", chunk: 0 }]);
    expect(parsed.vendors).toEqual([{ name: "react", chunk: 0 }]);
    expect(parsed.sourceMaps).toEqual([{ chunk: 0, inline: true }]);
    expect(parsed.evidenceCoverage.status).toBe("complete");
  });
});
