// Bundle forensics: fetch a page's external <script src> chunks under hard
// bounds (chunk count, total bytes, per-chunk timeout), save + hash them for
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

const UNPACK_CHUNK_CAP = 10;
const UNPACK_CHUNK_BYTES = 2 * 1024 * 1024; // 2MB

export const UNPACK_HINT =
  "npm install -g webcrack — optional; de-obfuscates and unpacks script chunks into per-module files";

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
  matches: { chunk: number; url: string; line: number; preview: string; keyword: string }[];
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

    // External script srcs: absolutize, keep http(s) only, dedupe, appearance
    // order. Inline scripts have no src attribute and never match the regex.
    const seen = new Set<string>();
    const srcs: string[] = [];
    for (const m of pageText.matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/gi)) {
      let abs: URL;
      try {
        abs = new URL(m[1], pageUrl);
      } catch {
        continue; // malformed src — not a fetchable script
      }
      if (abs.protocol !== "http:" && abs.protocol !== "https:") continue;
      if (seen.has(abs.href)) continue;
      seen.add(abs.href);
      srcs.push(abs.href);
    }

    const maxChunks = Math.min(100, Math.max(1, opts.maxChunks ?? MAX_CHUNKS));
    const maxTotalBytes = opts.maxTotalBytes ?? MAX_TOTAL_BYTES;
    const keywords = opts.keywords ?? [];
    const outDir = opts.outDir ?? mkdtempSync(join(tmpdir(), "awwwards-chunks-"));

    const chunks: BundleReport["chunks"] = [];
    const matches: BundleReport["matches"] = [];
    const warnings: string[] = [];
    let totalBytes = 0;

    for (const src of srcs) {
      if (chunks.length >= maxChunks) {
        warnings.push(`skipped ${src}: maxChunks budget (${maxChunks}) reached`);
        continue;
      }
      const remaining = maxTotalBytes - totalBytes;
      if (remaining <= 0) {
        warnings.push(
          `byte budget (${maxTotalBytes} bytes) reached; stopped after ${chunks.length} chunk(s)`,
        );
        break;
      }
      await limiter.acquire();
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), CHUNK_TIMEOUT_MS);
      try {
        const res = await fetched(src, { signal: ac.signal, headers: { "User-Agent": BUNDLE_UA } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const bytes = Buffer.byteLength(text, "utf8");
        if (bytes > remaining) {
          warnings.push(`skipped ${src}: would exceed maxTotalBytes (${maxTotalBytes})`);
          break;
        }
        const ci = chunks.length;
        // basename sanitized to the portable set; empty → "chunk". A trailing
        // script extension is stripped so the ".js" below isn't doubled
        // ("/a.js" → "0-a.js", not "0-a.js.js").
        const base =
          basename(new URL(src).pathname).replace(/[^a-zA-Z0-9._-]/g, "").replace(/\.(js|mjs|cjs)$/i, "") ||
          "chunk";
        const sha1 = createHash("sha1").update(text).digest("hex");
        const path = join(outDir, `${ci}-${base}.js`);
        writeFileSync(path, text, "utf8");
        chunks.push({ index: ci, url: src, bytes, sha1, path });
        totalBytes += bytes;
        for (const kw of keywords) {
          const re = new RegExp(escapeRegex(kw), "gi");
          let m: RegExpExecArray | null;
          while ((m = re.exec(text)) !== null && matches.length < MAX_MATCHES) {
            if (m.index === re.lastIndex) re.lastIndex++; // zero-width guard
            matches.push({
              chunk: ci,
              url: src,
              line: text.slice(0, m.index).split("\n").length,
              preview: text.slice(Math.max(0, m.index - 60), m.index + 60),
              keyword: kw,
            });
          }
          if (matches.length >= MAX_MATCHES) break;
        }
      } catch (err) {
        warnings.push(`skipped ${src}: ${msg(err)}`);
      } finally {
        clearTimeout(timer);
      }
    }

    // Optional unpack pass: hard-capped (first 10 chunks, 2MB each), each
    // chunk try/caught — a webcrack crash or odd result shape can never fail
    // the report beyond a warning.
    const m: any = opts.unpackLoader
      ? await opts.unpackLoader().catch(() => null)
      : await import("webcrack" as string).catch(() => null);
    let unpackedDir: string | undefined;
    let unpackedCount = 0;
    if (m && typeof m.webcrack === "function") {
      for (const c of chunks) {
        if (c.index >= UNPACK_CHUNK_CAP) break;
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
      hint: unpacked ? undefined : UNPACK_HINT,
    };
  } catch (err) {
    return { error: msg(err) };
  }
}
