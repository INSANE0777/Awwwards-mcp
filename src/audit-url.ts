/**
 * Standalone audit of an arbitrary live URL: runtime measurement
 * (perf-live.measureRuntime — installed Chrome/Edge over raw CDP, no
 * playwright) plus a static anti-pattern scan (audit-rules.scanAntiPatterns)
 * over the page HTML and up to 8 same-origin CSS/JS assets.
 *
 * Evidence only — nothing here grades the page. Every failure degrades:
 * runtime → `perf: { error }`, static fetch → `antiPatterns.error` + note,
 * and `auditUrl` itself only returns `{ error }` for an unusable URL.
 *
 * Polite bounds (plan W2): ≤8 assets, ≤2MB per response body, one shared
 * 1 req/s limiter for the page + assets, per-request timeout (default 10s).
 */
import { RateLimiter } from "./awwwards.js";
import {
  SEVERITY_WEIGHTS,
  scanAntiPatterns,
  type AntiPatternFinding,
} from "./audit-rules.js";
import {
  measureRuntime,
  type MeasureRuntimeOpts,
  type PerfMeasurement,
} from "./perf-live.js";
import type { ViewportName } from "./viewport.js";

export const AUDIT_UA = "awwwards-mcp audit-url/1.0";

export const MAX_AUDIT_ASSETS = 8;
export const MAX_AUDIT_ASSET_BYTES = 2 * 1024 * 1024;
export const MAX_AUDIT_FINDINGS = 50;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;

export interface AuditAntiPatterns {
  /** Total findings before the output cap (findings[] is bounded). */
  count: number;
  /** Highest-severity rule id (tier rows weigh as INFO), or null. */
  worst: string | null;
  findings: AntiPatternFinding[];
  /** Set when the page or its assets could not be fetched at all. */
  error?: string;
}

export interface AuditUrlResult {
  url: string;
  perf: PerfMeasurement | { error: string };
  antiPatterns: AuditAntiPatterns;
  coverage: { assetsScanned: number; failed: number };
  note: string;
}

type PerfFn = (
  url: string,
  opts?: MeasureRuntimeOpts,
) => Promise<PerfMeasurement | { error: string }>;

export interface AuditUrlOpts {
  viewport?: ViewportName;
  /** Per static request timeout in ms (1000..30000; default 10000). */
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  perfFn?: PerfFn;
  /** DI seam for offline tests; defaults to one 1 req/s limiter per run. */
  limiter?: { acquire(): Promise<void> };
}

const msg = (err: unknown): string =>
  err instanceof Error ? err.message.replace(/\s+/g, " ").trim() : String(err);

const clampTimeout = (n?: number): number =>
  Math.min(MAX_TIMEOUT_MS, Math.max(1000, typeof n === "number" && Number.isFinite(n) ? n : DEFAULT_TIMEOUT_MS));

/** One polite text fetch. Returns null on HTTP error, timeout, or oversize. */
async function fetchText(
  fetchFn: typeof fetch,
  limiter: { acquire(): Promise<void> },
  url: string,
  timeoutMs: number,
  maxBytes: number,
): Promise<string | null> {
  await limiter.acquire();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, {
      signal: ac.signal,
      headers: { "User-Agent": AUDIT_UA },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const declared = Number(res.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
      try {
        await res.body?.cancel();
      } catch {
        /* already closed */
      }
      return null;
    }
    const reader = res.body?.getReader();
    if (!reader) {
      const text = await res.text();
      return Buffer.byteLength(text) > maxBytes ? null : text;
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          /* already closed */
        }
        return null;
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** CSS/JS asset URLs in document order, same-origin only, deduped. */
export function collectAuditAssets(
  html: string,
  baseUrl: string,
): { css: string[]; js: string[] } {
  const base = new URL(baseUrl);
  const seen = new Set<string>();
  const css: string[] = [];
  const js: string[] = [];
  for (const m of html.matchAll(/<(link|script)\b[^>]*>/gi)) {
    if (css.length + js.length >= MAX_AUDIT_ASSETS) break;
    const tag = m[1].toLowerCase();
    const open = m[0];
    let raw: string | undefined;
    if (tag === "link") {
      const rels = (/\srel=["']([^"']+)["']/i.exec(open)?.[1] ?? "").toLowerCase().split(/\s+/);
      if (!rels.includes("stylesheet")) continue;
      raw = /\shref=["']([^"']+)["']/i.exec(open)?.[1];
    } else {
      const type = (/\stype=["']([^"']+)["']/i.exec(open)?.[1] ?? "").toLowerCase();
      if (/ld\+json|importmap|speculationrules/.test(type)) continue;
      raw = /\ssrc=["']([^"']+)["']/i.exec(open)?.[1];
    }
    if (raw === undefined) continue;
    let abs: URL;
    try {
      abs = new URL(raw, base);
    } catch {
      continue; // malformed ref — not fetchable
    }
    if (abs.protocol !== "http:" && abs.protocol !== "https:") continue;
    if (abs.origin !== base.origin) continue; // same-origin assets only
    if (seen.has(abs.href)) continue;
    seen.add(abs.href);
    (tag === "link" ? css : js).push(abs.href);
  }
  return { css, js };
}

function pickWorst(findings: AntiPatternFinding[]): string | null {
  if (findings.length === 0) return null;
  let worst = findings[0];
  for (const f of findings) {
    if (SEVERITY_WEIGHTS[f.severity ?? "INFO"] > SEVERITY_WEIGHTS[worst.severity ?? "INFO"]) {
      worst = f;
    }
  }
  return worst.ruleId;
}

interface StaticScan {
  findings: AntiPatternFinding[];
  coverage: { assetsScanned: number; failed: number };
  error?: string;
}

async function scanStatic(
  pageUrl: string,
  fetchFn: typeof fetch,
  limiter: { acquire(): Promise<void> },
  timeoutMs: number,
): Promise<StaticScan> {
  const empty = { findings: [] as AntiPatternFinding[], coverage: { assetsScanned: 0, failed: 0 } };
  const html = await fetchText(
    fetchFn,
    limiter,
    pageUrl,
    timeoutMs,
    MAX_AUDIT_ASSET_BYTES,
  );
  if (html === null) {
    return {
      ...empty,
      error: "Page HTML could not be fetched (HTTP error, timeout, or over 2MB).",
    };
  }
  const assets = collectAuditAssets(html, pageUrl);
  const css: string[] = [];
  const js: string[] = [];
  let scanned = 0;
  let failed = 0;
  for (const [kind, urls] of [["css", assets.css], ["js", assets.js]] as const) {
    for (const url of urls) {
      const text = await fetchText(fetchFn, limiter, url, timeoutMs, MAX_AUDIT_ASSET_BYTES);
      if (text === null) {
        failed++;
        continue;
      }
      scanned++;
      (kind === "css" ? css : js).push(text);
    }
  }
  return {
    // Concatenated per source: scanAntiPatterns takes one string per input;
    // joining with newlines keeps line numbers relative to the asset bundle,
    // not the original file. Findings carry source + line only (house shape).
    findings: scanAntiPatterns({ html, css: css.join("\n"), js: js.join("\n") }),
    coverage: { assetsScanned: scanned, failed },
  };
}

/**
 * Audit any http(s) URL. Runtime and static acquisition run in parallel; both
 * degrade independently so a missing browser never suppresses static evidence
 * and a blocked page never suppresses runtime numbers.
 */
export async function auditUrl(
  url: string,
  opts: AuditUrlOpts = {},
): Promise<AuditUrlResult | { error: string }> {
  let pageUrl: URL;
  try {
    pageUrl = new URL(url);
  } catch {
    return { error: `Invalid URL: ${url}` };
  }
  if (pageUrl.protocol !== "http:" && pageUrl.protocol !== "https:") {
    return { error: "audit_url only accepts http(s) URLs" };
  }
  const timeoutMs = clampTimeout(opts.timeoutMs);
  const fetchFn = opts.fetchFn ?? fetch;
  const limiter = opts.limiter ?? new RateLimiter(1000);
  const perfFn: PerfFn = opts.perfFn ?? measureRuntime;

  const perfPromise = perfFn(pageUrl.href, { viewport: opts.viewport }).catch(
    (err): { error: string } => ({ error: msg(err) }),
  );
  const staticPromise = scanStatic(pageUrl.href, fetchFn, limiter, timeoutMs).catch(
    (err): StaticScan => ({
      findings: [],
      coverage: { assetsScanned: 0, failed: 0 },
      error: msg(err),
    }),
  );
  const [perf, scan] = await Promise.all([perfPromise, staticPromise]);

  const { coverage, error, ...bounded } = scan;
  const findings = bounded.findings.slice(0, MAX_AUDIT_FINDINGS);
  const notes: string[] = ["Evidence only — not a performance grade."];
  if ("error" in perf) notes.push(`Runtime not measured: ${perf.error}`);
  if (error) notes.push(`Static scan: ${error}`);
  if (coverage.failed > 0) notes.push(`${coverage.failed} asset(s) were skipped.`);

  return {
    url: pageUrl.href,
    perf,
    antiPatterns: {
      count: bounded.findings.length,
      worst: pickWorst(bounded.findings),
      findings,
      ...(error ? { error } : {}),
    },
    coverage,
    note: notes.join(" "),
  };
}
