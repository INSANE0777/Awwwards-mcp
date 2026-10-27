// Bundle forensics: fetch a page's script chunks — external <script src>,
// inline <script>, and modulepreload / preload-as-script link hints — under
// hard bounds (chunk count, total bytes, per-chunk timeout), save + hash them for
// later forensic passes, and keyword-search the raw chunk text. Chunk
// failures degrade to warnings — a blocked or slow CDN can never fail the
// capture. Optional unpack pass: when
// the "webcrack" package resolves (lazy import or DI loader), chunks are
// de-obfuscated into pretty files + per-module files, still degrading per chunk.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { RateLimiter } from "./awwwards.js";
import { coverageFrom, type EvidenceCoverage } from "./coverage.js";

const BUNDLE_UA = "awwwards-mcp bundle-forensics/1.0";

export const MAX_CHUNKS = 40;

const CHUNK_TIMEOUT_MS = 15_000;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_MATCHES = 40;
// Inline-script bounds: captured whole (never sliced); larger ones and
// everything beyond the cap are skipped with a warning.
const INLINE_CHUNK_MAX = 200 * 1024;
const INLINE_CHUNK_CAP = 20;

const UNPACK_CHUNK_CAP = 10;
const UNPACK_CHUNK_BYTES = 2 * 1024 * 1024; // 2MB

// Deep-walk bounds: ≤20 walk-discovered chunks per run is the walk's OWN cap,
// independent of maxChunks (the shared maxTotalBytes still applies). Ref
// pattern: a quoted body whose final path token — ≥4 chars, no slash, no dot
// — immediately precedes the terminal ".js". The old ≥4-total-char floor
// still matched 1-3-char-stem junk ("../b.js", "chunk.a.js") once d087e53
// made refs resolve chunk-relative; the token floor kills that class while
// real chunk names ("./chunk-b.js", "862.1bd3e00c.js") pass. Quoted bodies
// shorter than "abcd.js" (7 chars) still never match. A ".min.js" ending is
// an alternative acceptance branch (D2): the token floor otherwise kills real
// vendor bundles whose last token is the 3-char "min" ("vendor.min.js"); the
// junk class doesn't end in .min.js and stays excluded.
const WALK_CHUNK_CAP = 20;
const WALK_REF_SRC = `["']([^"']{0,200}?[^/.]{4}\\.js|[^"']{0,200}?\\.min\\.js)["']`;

// Basename sanitized to the portable set; empty → "chunk". A trailing script
// extension is stripped so the ".js" below isn't doubled ("/a.js" → "0-a.js",
// not "0-a.js.js").
const remoteBase = (u: string): string =>
  basename(new URL(u).pathname).replace(/[^a-zA-Z0-9._-]/g, "").replace(/\.(js|mjs|cjs)$/i, "") || "chunk";

export const UNPACK_HINT =
  "npm install -g webcrack — optional; de-obfuscates and unpacks script chunks into per-module files";

// Distinct hint for the "webcrack loaded but nothing unpacked" case — no
// install tone; states the unpack bounds instead.
const UNPACK_NOOP_HINT =
  "webcrack is installed but nothing was unpacked — de-obfuscation covers only the first 10 chunks (2MB each); raw chunks are saved either way";

const msg = (err: unknown): string =>
  err instanceof Error ? err.message.replace(/\s+/g, " ").trim() : String(err);

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---- static import edges (opt-in `edges`) --------------------------------
// Pure per-chunk scan of saved chunk TEXT: no execution, no fetching, no URL
// guessing. `to` stays the verbatim specifier (or numeric-id string); the
// honesty number `unresolved` counts emitted edges that do not land exactly
// on a captured chunk URL — bare specifiers and webpack ids never do.
export type ImportEdgeKind = "esm-import" | "esm-reexport" | "cjs-require" | "webpack-id";

export interface ImportEdge {
  from: number;
  to: string;
  kind: ImportEdgeKind;
  raw: string;
}

// SavedChunk-like input: a captured chunk record joined with its saved text.
export interface EdgeScanChunk {
  index: number;
  url: string;
  text: string;
}

export interface ImportGraph {
  edges: ImportEdge[];
  unresolved: number;
  // True only when a cap actually dropped a unique candidate — an exact-cap
  // graph is complete, not truncated.
  truncated: boolean;
}

export const MAX_EDGES_PER_CHUNK = 20;
export const MAX_EDGES_TOTAL = 400;

// Linear statement scanner. The previous lazy cross-statement regexes both
// backtracked (1MB of "import " took seconds) and, at a 500-char window,
// silently missed real declarations with long binding lists. One pass now
// remembers the latest import/export keyword as the declaration start and
// matches `from` against it, so a declaration can run up to MAX_DECL_SPAN
// chars without rescanning. `;`, quotes, `(` and `)` end a pending declaration
// (the old regex bridge's delimiters); `}` does NOT, because it closes
// `export { ... }` before `from`. Minified single-line bundles still resolve.
const MAX_DECL_SPAN = 8192;
const MAX_EDGE_SPAN = 500; // webpack id prefix / digit-run cap

interface PendingDecl {
  kind: "import" | "export";
  start: number;
}

function isWordCode(c: number): boolean {
  return (
    (c >= 48 && c <= 57) || // 0-9
    (c >= 65 && c <= 90) || // A-Z
    (c >= 97 && c <= 122) || // a-z
    c === 95 // _
  );
}

// Quoted specifier starting exactly at `at`, closed inside [at, limit). Same
// grammar as ["']([^"']+)["']: non-empty, neither quote inside.
function readSpecifier(
  text: string,
  at: number,
  limit: number,
): { to: string; end: number } | null {
  const quote = text[at];
  if (quote !== '"' && quote !== "'") return null;
  for (let i = at + 1; i < limit; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      return ch === quote && i > at + 1 ? { to: text.slice(at + 1, i), end: i + 1 } : null;
    }
  }
  return null;
}

interface EdgeCandidate {
  to: string;
  kind: ImportEdgeKind;
  raw: string;
}

// One text pass, family-major output (imports, bare imports, reexports,
// requires, webpack ids) so dedupe/cap order is unchanged.
function scanEdgeCandidates(text: string): EdgeCandidate[] {
  const len = text.length;
  const imports: EdgeCandidate[] = [];
  const bareImports: EdgeCandidate[] = [];
  const reexports: EdgeCandidate[] = [];
  const requires: EdgeCandidate[] = [];
  const webpackIds: EdgeCandidate[] = [];
  let pending: PendingDecl | null = null;
  let wordStart = -1; // start of the current word run, -1 outside one

  for (let i = 0; i < len; i++) {
    const c = text.charCodeAt(i);
    if (pending !== null && i - pending.start > MAX_DECL_SPAN) pending = null;

    if (!isWordCode(c)) {
      if (c === 46 /* . */) {
        // Webpack module id: `e.i(870178)`. The prefix is the word run ending
        // just before the dot (capped so the raw candidate stays bounded).
        if (text.charCodeAt(i + 1) === 105 && text.charCodeAt(i + 2) === 40 && wordStart >= 0) {
          const prefix = Math.max(wordStart, i - MAX_EDGE_SPAN);
          const digitsAt = i + 3;
          let q = digitsAt;
          const digitLimit = Math.min(len, digitsAt + MAX_EDGE_SPAN);
          while (q < digitLimit && text.charCodeAt(q) >= 48 && text.charCodeAt(q) <= 57) q++;
          if (q - digitsAt >= 4 && text.charCodeAt(q) === 41) {
            webpackIds.push({
              to: text.slice(digitsAt, q),
              kind: "webpack-id",
              raw: text.slice(prefix, q + 1),
            });
          }
        }
        pending = null; // member access cannot be part of a declaration
      } else if (
        c === 59 || // ;
        c === 40 || // (
        c === 41 || // )
        c === 34 || // "
        c === 39 // '
      ) {
        pending = null;
      }
      wordStart = -1;
      continue;
    }

    if (i > 0 && isWordCode(text.charCodeAt(i - 1))) continue; // inside a word
    wordStart = i;

    if (c === 105 && text.startsWith("import", i) && !isWordCode(text.charCodeAt(i + 6))) {
      let p = i + 6;
      while (p < len && text.charCodeAt(p) <= 32) p++;
      const next = text.charCodeAt(p);
      if (next === 34 || next === 39) {
        const spec = readSpecifier(text, p, len);
        if (spec) {
          bareImports.push({ to: spec.to, kind: "esm-import", raw: text.slice(i, spec.end) });
          pending = null;
          i = spec.end - 1;
          wordStart = -1;
          continue;
        }
      }
      // `import.meta` and dynamic `import(` are not static declarations.
      if (next === 46 || next === 40) {
        pending = null;
        continue;
      }
      pending = { kind: "import", start: i };
    } else if (c === 101 && text.startsWith("export", i) && !isWordCode(text.charCodeAt(i + 6))) {
      pending = { kind: "export", start: i };
    } else if (c === 114 && text.startsWith("require", i) && !isWordCode(text.charCodeAt(i + 7))) {
      let p = i + 7;
      while (p < len && text.charCodeAt(p) <= 32) p++;
      if (text.charCodeAt(p) !== 40) continue;
      p++;
      while (p < len && text.charCodeAt(p) <= 32) p++;
      const spec = readSpecifier(text, p, len);
      if (spec) {
        requires.push({ to: spec.to, kind: "cjs-require", raw: text.slice(i, spec.end) });
        pending = null;
        i = spec.end - 1;
        wordStart = -1;
      }
    } else if (c === 102 && text.startsWith("from", i) && !isWordCode(text.charCodeAt(i + 4))) {
      if (pending === null) continue;
      const start = pending.start;
      if (i - start > MAX_DECL_SPAN) {
        pending = null;
        continue;
      }
      let p = i + 4;
      while (p < len && text.charCodeAt(p) <= 32) p++;
      const spec = readSpecifier(text, p, len);
      if (!spec) continue; // a `from` identifier inside the binding list
      const kind: ImportEdgeKind = pending.kind === "import" ? "esm-import" : "esm-reexport";
      const candidate = { to: spec.to, kind, raw: text.slice(start, spec.end) };
      if (kind === "esm-import") imports.push(candidate);
      else reexports.push(candidate);
      pending = null;
      i = spec.end - 1;
      wordStart = -1;
    }
  }
  return [...imports, ...bareImports, ...reexports, ...requires, ...webpackIds];
}

export function extractEdges(chunks: EdgeScanChunk[]): ImportGraph {
  const edges: ImportEdge[] = [];
  const capturedUrls = new Set(chunks.map((c) => c.url));
  const seen = new Set<string>();
  let unresolved = 0;
  let truncated = false;

  // Dedupe happens on pull, so hitting a cap costs one extra candidate (proof
  // something was dropped). The per-chunk family-major list is built once.
  function* candidates(chunk: EdgeScanChunk): Generator<{ to: string; kind: ImportEdgeKind; raw: string }> {
    for (const candidate of scanEdgeCandidates(chunk.text)) {
      const key = `${chunk.index}\u0000${candidate.kind}\u0000${candidate.to}`;
      if (seen.has(key)) continue; // dedupe first-wins
      seen.add(key);
      yield candidate;
    }
  }

  for (const chunk of chunks) {
    let perChunk = 0;
    for (const candidate of candidates(chunk)) {
      if (perChunk >= MAX_EDGES_PER_CHUNK || edges.length >= MAX_EDGES_TOTAL) {
        truncated = true;
        break;
      }
      const { to, kind, raw } = candidate;
      perChunk++;
      edges.push({ from: chunk.index, to, kind, raw });
      // Resolved ONLY by landing exactly on a captured URL; webpack ids are
      // registry numbers that can never be checked — counted unresolved.
      let landed = false;
      if (kind !== "webpack-id") {
        try {
          landed = capturedUrls.has(new URL(to, chunk.url).href);
        } catch {
          landed = false;
        }
      }
      if (!landed) unresolved++;
    }
  }
  return { edges, unresolved, truncated };
}

// ---- opt-in bundle intelligence (`bundleIntel`) ---------------------------
// Presence-only evidence from saved chunk TEXT: quoted route paths, vendor
// signatures, source-map markers and the import graph. No source content, no
// raw source-map values, no fetches. Regex hits are labelled evidence, not
// truth.
export interface BundleRoute {
  method: string | null;
  route: string;
  foundVia: "string" | "fetch" | "axios";
  chunk: number;
}

export interface BundleVendor {
  name: string;
  chunk: number;
}

export interface BundleSourceMap {
  chunk: number;
  inline: boolean;
  path?: string;
}

export interface BundleModuleGraph {
  nodes: number;
  edges: number;
  truncated: boolean;
  externalSpecifiers: string[];
}

export interface BundleIntel {
  routes: BundleRoute[];
  vendors: BundleVendor[];
  sourceMaps: BundleSourceMap[];
  moduleGraph: BundleModuleGraph;
}

const MAX_ROUTES = 30;
const MAX_VENDORS = 20;
const MAX_SOURCE_MAPS = 10;
const MAX_EXTERNAL_SPECIFIERS = 20;
// 200-char method window each side of the quoted route (design §4.2).
const METHOD_WINDOW = 200;

const VENDOR_SIGNATURES: Array<{ name: string; signatures: string[] }> = [
  { name: "react", signatures: ["react.production", "__REACT_DEVTOOLS"] },
  { name: "next", signatures: ["__NEXT_DATA__", "_next/static"] },
  { name: "gsap", signatures: ["gsap.version", "GreenSock"] },
  { name: "three", signatures: ["THREE.REVISION"] },
  { name: "lenis", signatures: ["Lenis"] },
  { name: "swiper", signatures: ["Swiper"] },
  { name: "framer-motion", signatures: ["framer-motion", "motionValue"] },
  { name: "tailwind", signatures: ["tailwindcss"] },
];

const ROUTE_RE = /(["'])(\/[^"'\s]{1,300})\1/g;
const FETCH_METHOD_RE = /\bfetch\s*\([\s\S]{0,200}?\bmethod\s*:\s*["']([A-Za-z]+)["']/;
const AXIOS_METHOD_RE = /\baxios\s*\.\s*(get|post|put|patch|delete|head|options)\b/i;
const SOURCE_MAP_RE = /(?:\/\/#|\/\*#)\s*sourceMappingURL=([^\s*]+)/g;

const methodAt = (text: string, at: number, length: number): Pick<BundleRoute, "method" | "foundVia"> => {
  const window = text.slice(Math.max(0, at - METHOD_WINDOW), at + length + METHOD_WINDOW);
  const fetched = FETCH_METHOD_RE.exec(window);
  if (fetched) return { method: fetched[1].toUpperCase(), foundVia: "fetch" };
  const axios = AXIOS_METHOD_RE.exec(window);
  if (axios) return { method: axios[1].toUpperCase(), foundVia: "axios" };
  return { method: null, foundVia: "string" };
};

export function extractBundleIntel(
  chunks: { index: number; text: string }[],
  graph?: ImportGraph,
): BundleIntel {
  const routes: BundleRoute[] = [];
  const vendors: BundleVendor[] = [];
  const sourceMaps: BundleSourceMap[] = [];
  const routeSeen = new Set<string>();
  const vendorSeen = new Set<string>();
  const sourceMapSeen = new Set<string>();

  for (const chunk of chunks) {
    for (const m of chunk.text.matchAll(ROUTE_RE)) {
      const route = m[2].replace(/[?#].*$/, "");
      if (route.split("/").filter(Boolean).length < 2) continue;
      const how = methodAt(chunk.text, m.index, m[0].length);
      const key = `${chunk.index}|${how.method}|${route}`;
      if (routeSeen.has(key)) continue;
      routeSeen.add(key);
      routes.push({ method: how.method, route, foundVia: how.foundVia, chunk: chunk.index });
    }

    for (const vendor of VENDOR_SIGNATURES) {
      if (!vendor.signatures.some((sig) => chunk.text.includes(sig))) continue;
      // Same vendor in a different chunk is separate evidence; cap 20.
      const key = `${chunk.index}|${vendor.name}`;
      if (vendorSeen.has(key)) continue;
      vendorSeen.add(key);
      vendors.push({ name: vendor.name, chunk: chunk.index });
    }

    for (const m of chunk.text.matchAll(SOURCE_MAP_RE)) {
      const value = m[1];
      const inline = value.startsWith("data:");
      const path = inline ? undefined : value.replace(/[?#].*$/, "").slice(0, 200);
      const key = `${chunk.index}|${inline}|${path ?? ""}`;
      if (sourceMapSeen.has(key)) continue;
      sourceMapSeen.add(key);
      sourceMaps.push(inline ? { chunk: chunk.index, inline } : { chunk: chunk.index, inline, path });
    }
  }

  routes.sort((a, b) => a.chunk - b.chunk || (a.route < b.route ? -1 : a.route > b.route ? 1 : 0));
  vendors.sort((a, b) => a.chunk - b.chunk);

  const scanned = graph ?? extractEdges(chunks.map((c) => ({ index: c.index, url: "", text: c.text })));
  const externalSpecifiers = [
    ...new Set(
      scanned.edges
        .map((e) => e.to)
        .filter((to) => !to.startsWith(".") && !to.startsWith("/") && !/^\d+$/.test(to)),
    ),
  ]
    .sort()
    .slice(0, MAX_EXTERNAL_SPECIFIERS);

  return {
    routes: routes.slice(0, MAX_ROUTES),
    vendors: vendors.slice(0, MAX_VENDORS),
    sourceMaps: sourceMaps.slice(0, MAX_SOURCE_MAPS),
    moduleGraph: {
      nodes: chunks.length,
      edges: scanned.edges.length,
      truncated: scanned.truncated,
      externalSpecifiers,
    },
  };
}

export interface BundleReport {
  url: string;
  host: string;
  outDir: string;
  chunkCount: number;
  totalBytes: number;
  chunks: { index: number; url: string; bytes: number; sha1: string; path: string; deobfuscated?: boolean }[];
  matches: { chunk: number; url: string; line: number; preview: string; keyword: string; source?: "raw" | "pretty" }[];
  warnings: string[];
  unpacked: boolean;
  unpackedDir?: string;
  hint?: string;
  // Opt-in `edges` pass only — default reports are byte-identical to before.
  edges?: ImportEdge[];
  edgeCount?: number;
  unresolved?: number;
  // Opt-in `bundleIntel` pass only — absent keys otherwise.
  routes?: BundleRoute[];
  vendors?: BundleVendor[];
  sourceMaps?: BundleSourceMap[];
  moduleGraph?: BundleModuleGraph;
  evidenceCoverage?: EvidenceCoverage;
}

export interface BundleForensicsOpts {
  keywords?: string[];
  maxChunks?: number;
  maxTotalBytes?: number;
  fetchFn?: (url: string, init?: RequestInit) => Promise<Response>;
  // DI seam for the webcrack unpack pass; when absent the "webcrack" package
  // is lazily imported at call time (optional dep — no hard dependency).
  unpackLoader?: () => Promise<any>;
  outDir?: string;
  // Opt-in deep walk (default false → ZERO extra fetches): after the first
  // pass, follow quoted same-origin .js refs found inside fetched chunk
  // sources and fetch up to 20 newly discovered chunks — the walk's own cap,
  // independent of maxChunks, within the shared byte budget.
  walkChunks?: boolean;
  // Opt-in static import graph (default false → identical report shape, zero
  // extra fetches): the pure extractEdges scan over the saved chunk texts.
  edges?: boolean;
  // Opt-in bundle intelligence (default false → identical report shape, zero
  // extra fetches): routes, vendors, source-map presence and module graph.
  bundleIntel?: boolean;
}

export async function captureBundleForensics(
  url: string,
  opts: BundleForensicsOpts = {},
): Promise<BundleReport | { error: string }> {
  try {
    const fetched = opts.fetchFn ?? fetch;
    const pageUrl = new URL(url).href;
    const host = new URL(url).host;

    // One shared limiter for the page fetch + all chunk fetches; created up
    // front so the page fetch is rate-limited too.
    const limiter = new RateLimiter(1000);

    // Page is the hard precondition: without its HTML there is no capture,
    // so unlike chunk failures this propagates to the { error } contract.
    // Same 15s AbortController timeout as chunks — undici's ~300s default
    // would let one hung page stall the whole capture.
    const pageAc = new AbortController();
    const pageTimer = setTimeout(() => pageAc.abort(), CHUNK_TIMEOUT_MS);
    await limiter.acquire();
    const pageRes = await fetched(pageUrl, { signal: pageAc.signal, headers: { "User-Agent": BUNDLE_UA } })
      .finally(() => clearTimeout(pageTimer));
    if (!pageRes.ok) return { error: `HTTP ${pageRes.status} for ${pageUrl}` };
    const pageText = await pageRes.text();

    // Remote-chunk fetch shared by the first pass and the walk: RateLimiter-
    // gated, 15s AbortController timeout. Errors are handled per call site.
    const fetchChunkText = async (chunkUrl: string): Promise<string> => {
      await limiter.acquire();
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), CHUNK_TIMEOUT_MS);
      try {
        const res = await fetched(chunkUrl, { signal: ac.signal, headers: { "User-Agent": BUNDLE_UA } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.text();
      } finally {
        clearTimeout(timer);
      }
    };

    // One pass over <script>/<link> open tags keeps HTML appearance order
    // across the three sources: script srcs, inline scripts, and
    // modulepreload / preload-as-script hints (how Next/Astro/Remix
    // advertise lazy chunks). Remote candidates share one dedupe set, so a
    // URL advertised both ways becomes a single chunk.
    const seen = new Set<string>();
    const absolutize = (raw: string, base: string = pageUrl): string | null => {
      let abs: URL;
      try {
        abs = new URL(raw, base);
      } catch {
        return null; // malformed ref — not a fetchable script
      }
      if (abs.protocol !== "http:" && abs.protocol !== "https:") return null;
      if (seen.has(abs.href)) return null;
      seen.add(abs.href);
      return abs.href;
    };
    const targets: ({ kind: "remote"; url: string } | { kind: "inline"; code: string })[] = [];
    for (const t of pageText.matchAll(/<(script|link)\b[^>]*>/gi)) {
      const open = t[0];
      const tagEnd = t.index + open.length;
      if (t[1].toLowerCase() === "script") {
        const src = /\ssrc=["']([^"']+)["']/i.exec(open)?.[1];
        if (src !== undefined) {
          const abs = absolutize(src);
          if (abs) targets.push({ kind: "remote", url: abs });
          continue;
        }
        // Inline script: text between this open tag and its closing tag.
        // JSON-data types (ld+json, importmap, speculationrules) are inert
        // data, not runnable bundle code — skipped silently.
        const type = /\stype=["']([^"']+)["']/i.exec(open)?.[1] ?? "";
        if (/ld\+json|importmap|speculationrules/i.test(type)) continue;
        const close = pageText.indexOf("</script", tagEnd);
        if (close !== -1) targets.push({ kind: "inline", code: pageText.slice(tagEnd, close) });
        continue;
      }
      // <link>: only modulepreload, or preload-as-script, is a script hint.
      const href = /\shref=["']([^"']+)["']/i.exec(open)?.[1];
      if (href === undefined) continue;
      const rels = (/\srel=["']([^"']+)["']/i.exec(open)?.[1] ?? "").toLowerCase().split(/\s+/);
      const as = (/\sas=["']([^"']+)["']/i.exec(open)?.[1] ?? "").toLowerCase();
      if (!rels.includes("modulepreload") && !(rels.includes("preload") && as === "script")) continue;
      const abs = absolutize(href);
      if (abs) targets.push({ kind: "remote", url: abs });
    }

    const maxChunks = Math.min(100, Math.max(1, opts.maxChunks ?? MAX_CHUNKS));
    const maxTotalBytes = opts.maxTotalBytes ?? MAX_TOTAL_BYTES;
    const keywords = opts.keywords ?? [];
    const outDir = opts.outDir ?? mkdtempSync(join(tmpdir(), "awwwards-chunks-"));

    const chunks: BundleReport["chunks"] = [];
    const matches: BundleReport["matches"] = [];
    const warnings: string[] = [];
    let totalBytes = 0;

    // One keyword scanner for every text source — raw chunks and webcrack's
    // pretty files alike. `source` records where the hit came from; the
    // MAX_MATCHES cap spans all sources (40 total, unchanged).
    const pushMatches = (text: string, ci: number, label: string, source: "raw" | "pretty"): void => {
      for (const kw of keywords) {
        const re = new RegExp(escapeRegex(kw), "gi");
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null && matches.length < MAX_MATCHES) {
          if (m.index === re.lastIndex) re.lastIndex++; // zero-width guard
          matches.push({
            chunk: ci,
            url: label,
            line: text.slice(0, m.index).split("\n").length,
            preview: text.slice(Math.max(0, m.index - 60), m.index + 60),
            keyword: kw,
            source,
          });
        }
        if (matches.length >= MAX_MATCHES) break;
      }
    };

    // Shared save+hash+grep for every chunk text source (first pass + walk).
    // "over" means the byte budget would be exceeded (warning pushed); callers
    // decide break-vs-continue.
    const saveChunk = (text: string, label: string, base: string): "saved" | "over" | "failed" => {
      try {
        const bytes = Buffer.byteLength(text, "utf8");
        if (bytes > maxTotalBytes - totalBytes) {
          warnings.push(`skipped ${label}: would exceed maxTotalBytes (${maxTotalBytes})`);
          return "over";
        }
        const ci = chunks.length;
        const sha1 = createHash("sha1").update(text).digest("hex");
        const path = join(outDir, `${ci}-${base}.js`);
        writeFileSync(path, text, "utf8");
        chunks.push({ index: ci, url: label, bytes, sha1, path });
        totalBytes += bytes;
        pushMatches(text, ci, label, "raw");
        return "saved";
      } catch (err) {
        warnings.push(`skipped ${label}: ${msg(err)}`);
        return "failed";
      }
    };

    let inlineNext = 0;
    let inlineCapWarned = false;
    for (const cand of targets) {
      if (chunks.length >= maxChunks) {
        warnings.push(
          `skipped ${cand.kind === "remote" ? cand.url : "inline script"}: maxChunks budget (${maxChunks}) reached`,
        );
        continue;
      }
      const remaining = maxTotalBytes - totalBytes;
      if (remaining <= 0) {
        warnings.push(
          `byte budget (${maxTotalBytes} bytes) reached; stopped after ${chunks.length} chunk(s)`,
        );
        break;
      }
      let text: string;
      let label: string;
      let base: string;
      if (cand.kind === "inline") {
        if (inlineNext >= INLINE_CHUNK_CAP) {
          if (!inlineCapWarned) {
            warnings.push(`inline script cap (${INLINE_CHUNK_CAP}) reached; skipping remaining inline scripts`);
            inlineCapWarned = true;
          }
          continue;
        }
        const inlineBytes = Buffer.byteLength(cand.code, "utf8");
        if (inlineBytes > INLINE_CHUNK_MAX) {
          warnings.push(
            `skipped inline script #${inlineNext}: ${inlineBytes}B exceeds ${INLINE_CHUNK_MAX}B inline cap`,
          );
          continue;
        }
        text = cand.code;
        label = `inline:${inlineNext++}`;
        base = "inline";
      } else {
        try {
          text = await fetchChunkText(cand.url);
        } catch (err) {
          warnings.push(`skipped ${cand.url}: ${msg(err)}`);
          continue;
        }
        label = cand.url;
        base = remoteBase(cand.url);
      }
      // Byte budget exhausted — stop the whole pass (walk keeps skipping
      // smaller discoveries instead, so one oversized chunk can't starve it).
      const saved = saveChunk(text, label, base);
      if (saved === "over") break;
    }

    // Candidate targets from the page HTML that did not become saved chunks.
    const baseSaved = chunks.length;

    // Opt-in deep chunk walk (walkChunks): quoted same-origin .js refs inside
    // fetched chunk sources point at lazy-loaded chunks the page HTML never
    // advertised. Discovered chunks join `chunks` (keyword-search + unpack-
    // eligible) through the same limiter and byte budget; the shared `seen`
    // set makes cycles impossible, and ≤20 walk chunks (the walk's own cap,
    // independent of maxChunks) is the hard limit per run.
    let walkCount = 0;
    if (opts.walkChunks === true) {
      const queue: string[] = [];
      const scanForRefs = (text: string, refBase: string): void => {
        for (const m of text.matchAll(new RegExp(WALK_REF_SRC, "g"))) {
          // Resolve against the ref-bearing CHUNK's own URL — Next/Turbopack
          // ship chunk-relative paths ("./456-hash.js") that 404 when
          // absolutized against the page URL.
          const abs = absolutize(m[1], refBase);
          // same origin as the page only; absolutize already deduped via `seen`
          if (abs && new URL(abs).host === host) queue.push(abs);
        }
      };
      // Inline scripts' ref base is the page itself; remote chunks use their
      // own URL (their `url` field is the absolute chunk URL).
      for (const c of chunks) {
        scanForRefs(readFileSync(c.path, "utf8"), c.url.startsWith("inline:") ? pageUrl : c.url);
      }
      while (queue.length > 0 && walkCount < WALK_CHUNK_CAP) {
        // Byte budget is the walk's only shared financial constraint — the
        // 20-chunk walk cap is independent of maxChunks, so the walk still
        // runs even when the base pass consumed the whole chunk budget.
        if (maxTotalBytes - totalBytes <= 0) {
          warnings.push(`walk stopped: byte budget (${maxTotalBytes} bytes) reached`);
          break;
        }
        const walkUrl = queue.shift() as string;
        let text: string;
        try {
          text = await fetchChunkText(walkUrl);
        } catch (err) {
          warnings.push(`skipped walk chunk ${walkUrl}: ${msg(err)}`);
          continue;
        }
        if (saveChunk(text, walkUrl, remoteBase(walkUrl)) === "saved") {
          walkCount++;
          scanForRefs(text, walkUrl); // refs discovered mid-walk join the queue (seen dedupes)
        }
      }
      if (walkCount >= WALK_CHUNK_CAP && queue.length > 0) {
        warnings.push(`walk cap (${WALK_CHUNK_CAP}) reached; ${queue.length} discovered chunk(s) left unfetched`);
      }
    }

    // Opt-in static import graph: pure scan over the saved RAW chunk texts —
    // deliberately before the unpack pass below, whose pretty rewrite
    // replaces c.path, so the graph always describes the captured bundle.
    // `bundleIntel` reuses the SAME extractEdges pass.
    const wantsGraph = opts.edges === true || opts.bundleIntel === true;
    const savedTexts = wantsGraph
      ? chunks.map((c) => ({ index: c.index, url: c.url, text: readFileSync(c.path, "utf8") }))
      : [];
    const graph = wantsGraph ? extractEdges(savedTexts) : undefined;
    const intel = opts.bundleIntel
      ? extractBundleIntel(
          savedTexts.map(({ index, text }) => ({ index, text })),
          graph,
        )
      : undefined;
    // Coverage describes CAPTURE evidence only; unpack warnings stay in the
    // normal warnings field and must not downgrade what was captured.
    const captureWarnings = [...warnings];

    // Optional unpack pass: hard-capped (first 10 QUALIFYING chunks, 2MB each
    // — see the loop), each chunk try/caught — a webcrack crash or odd result
    // shape can never fail the report beyond a warning.
    const m: any = opts.unpackLoader
      ? await opts.unpackLoader().catch(() => null)
      : await import("webcrack" as string).catch(() => null);
    let unpackedDir: string | undefined;
    let unpackedCount = 0;
    const unpackLoaded = !!(m && typeof m.webcrack === "function");
    if (unpackLoaded) {
      // The ≤10 budget is spent only on chunks we actually unpack: oversized
      // chunks and webcrack crashes never consume a slot — later qualifying
      // chunks keep filling until 10 successes or chunks run out.
      for (const c of chunks) {
        if (unpackedCount >= UNPACK_CHUNK_CAP) break;
        if (c.bytes > UNPACK_CHUNK_BYTES) {
          warnings.push(`unpack skipped chunk ${c.index}: ${c.bytes}B exceeds ${UNPACK_CHUNK_BYTES}B limit`);
          continue;
        }
        try {
          const res = await m.webcrack(readFileSync(c.path, "utf8"), {
            unminify: true,
            deobfuscate: true,
            unpack: true,
          });
          if (!res || typeof res.code !== "string") {
            throw new Error(`unexpected webcrack result shape (code: ${typeof res?.code})`);
          }
          const pretty = c.path.replace(/\.js$/, ".pretty.js");
          writeFileSync(pretty, res.code, "utf8");
          c.path = pretty;
          c.deobfuscated = true;
          // The pretty file is a second text source for the keyword scan.
          pushMatches(res.code, c.index, c.url, "pretty");
          unpackedCount++;
          if (!unpackedDir) {
            unpackedDir = join(outDir, "unpacked");
            // Eager mkdir: a chunk with pretty code but no bundle modules
            // (continue below) must still leave unpackedDir readable on disk.
            mkdirSync(unpackedDir, { recursive: true });
          }
          const mods: unknown = res.bundle?.modules;
          const entries: [unknown, any][] =
            mods instanceof Map
              ? [...mods.entries()]
              : Array.isArray(mods)
                ? mods.map((mo: any): [unknown, any] => [mo?.id, mo])
                : [];
          if (entries.length === 0) {
            warnings.push(`chunk ${c.index}: webcrack returned no bundle modules; skipped`);
            continue;
          }
          const dir = join(unpackedDir, String(c.index).padStart(3, "0"));
          mkdirSync(dir, { recursive: true });
          for (const [id, mo] of entries) {
            if (!mo || typeof mo.code !== "string") continue;
            const name =
              (typeof mo.path === "string" ? basename(mo.path) : "").replace(/[^a-zA-Z0-9._-]/g, "") ||
              `${String(id ?? "mod")}.js`;
            writeFileSync(join(dir, name.endsWith(".js") ? name : `${name}.js`), mo.code, "utf8");
          }
        } catch (err) {
          warnings.push(`unpack skipped chunk ${c.index}: ${msg(err)}`);
        }
      }
    }

    const unpacked = unpackedCount > 0;
    return {
      url: pageUrl,
      host,
      outDir,
      chunkCount: chunks.length,
      totalBytes,
      chunks,
      matches,
      warnings,
      unpacked,
      unpackedDir: unpacked ? unpackedDir : undefined,
      hint: unpacked ? undefined : unpackLoaded ? UNPACK_NOOP_HINT : UNPACK_HINT,
      ...(opts.edges && graph
        ? { edges: graph.edges, edgeCount: graph.edges.length, unresolved: graph.unresolved }
        : {}),
      ...(intel
        ? {
            routes: intel.routes,
            vendors: intel.vendors,
            sourceMaps: intel.sourceMaps,
            moduleGraph: intel.moduleGraph,
            evidenceCoverage: coverageFrom({
              collected: chunks.length,
              excluded: Math.max(0, targets.length - baseSaved),
              total: Math.max(targets.length, chunks.length),
              limitations: captureWarnings,
            }),
          }
        : {}),
    };
  } catch (err) {
    return { error: msg(err) };
  }
}
