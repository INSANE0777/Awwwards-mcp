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
// pattern (plan-verbatim): a quoted 4..200
// char body followed by ".js" — its lazy quantifier needs ≥4 non-quote chars
// BEFORE the terminal ".js", so quoted bodies shorter than 7 chars ("/a.js")
// never match. Longer real-world chunk names are the walk's normal diet.
const WALK_CHUNK_CAP = 20;
const WALK_REF_SRC = `["']([^"']{4,200}?\\.js)["']`;

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
    };
  } catch (err) {
    return { error: msg(err) };
  }
}
