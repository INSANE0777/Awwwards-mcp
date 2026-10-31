/**
 * Standalone audit of an arbitrary live URL: runtime measurement
 * (perf-live.measureRuntime — installed Chrome/Edge over raw CDP, no
 * playwright) plus a static anti-pattern scan (audit-rules.scanAntiPatterns)
 * over the page HTML and up to 8 same-origin CSS/JS assets. The final
 * post-redirect page URL is the asset base; an asset redirect that leaves the
 * final page origin is rejected. Assets use MANUAL redirects: every hop is
 * protocol- and origin-checked before its request is sent (max 5 hops), so a
 * redirect that leaves the origin is rejected without contacting the target
 * — even when the chain would return. Findings are severity-sorted (worst
 * first) before the output cap.
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
  type Severity,
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
/** Asset redirects followed per request; the 6th Location is never requested. */
const MAX_ASSET_REDIRECTS = 5;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

export interface AuditAntiPatterns {
  /** Total findings before the output cap (findings[] is bounded). */
  count: number;
  /** Pre-cap totals across all findings; they can exceed findings.length. */
  high: number;
  medium: number;
  info: number;
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
  nextActions: string[];
  note: string;
}

/** Token-diet audit: finding bodies collapse to severity counts + ranked actions. */
export interface AuditCompact {
  url: string;
  /** Reduced on purpose: chromePath and scrollListeners stay in the full payload. */
  perf: {
    fps: number;
    droppedFrames: number;
    longTasks: number;
    layoutThrashing: number;
  } | { error: string };
  antiPatterns: {
    count: number;
    worst: string | null;
    high: number;
    medium: number;
    info: number;
    error?: string;
  };
  coverage: { assetsScanned: number; failed: number };
  nextActions: string[];
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
  /** DI seam for offline tests; defaults to scanAntiPatterns. */
  scanFn?: (inputs: { css?: string; html?: string; js?: string }) => AntiPatternFinding[];
  /** DI seam for offline tests; defaults to one 1 req/s limiter per run. */
  limiter?: { acquire(): Promise<void> };
}

const msg = (err: unknown): string =>
  err instanceof Error ? err.message.replace(/\s+/g, " ").trim() : String(err);

const clampTimeout = (n?: number): number =>
  Math.min(MAX_TIMEOUT_MS, Math.max(1000, typeof n === "number" && Number.isFinite(n) ? n : DEFAULT_TIMEOUT_MS));

async function cancelBody(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    /* already closed */
  }
}

interface FetchedText {
  text: string;
  /** URL after redirects (falls back to the request URL). */
  finalUrl: string;
}

/** http(s) + exact allowed origin, or null. Called BEFORE every asset request. */
function allowedHref(raw: string, allowedOrigin: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.origin === allowedOrigin ? u.href : null;
  } catch {
    return null;
  }
}

function originOf(raw: string): string {
  try {
    return new URL(raw).origin;
  } catch {
    return "";
  }
}

/**
 * One polite text fetch. Returns null on HTTP error, timeout, oversize body,
 * or — when `allowedOrigin` is set — a redirect that leaves that origin.
 * Asset requests use `redirect: "manual"` and walk the chain here, so each
 * hop is validated before its request is sent: a chain that leaves and
 * returns is rejected at the first leave.
 */
async function fetchText(
  fetchFn: typeof fetch,
  limiter: { acquire(): Promise<void> },
  url: string,
  timeoutMs: number,
  maxBytes: number,
  allowedOrigin?: string,
): Promise<FetchedText | null> {
  let current = url;
  let hops = 0;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (allowedOrigin !== undefined) {
      const href = allowedHref(current, allowedOrigin);
      if (href === null) return null;
      current = href;
    }
    await limiter.acquire();
    const remaining = deadline - Date.now();
    if (remaining <= 0) return null;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), remaining);
    try {
      const res = await fetchFn(current, {
        signal: ac.signal,
        headers: { "User-Agent": AUDIT_UA },
        redirect: allowedOrigin === undefined ? "follow" : "manual",
      });
      if (
        allowedOrigin !== undefined &&
        (REDIRECT_STATUS.has(res.status) || res.type === "opaqueredirect")
      ) {
        const location = res.headers.get("location");
        await cancelBody(res);
        // No Location, or the hop cap is spent: the next target is never requested.
        if (!location || hops >= MAX_ASSET_REDIRECTS) return null;
        hops++;
        current = new URL(location, current).href; // throws on garbage → caught below
        continue;
      }
      if (!res.ok) {
        await cancelBody(res);
        return null;
      }
      const finalUrl = res.url || current;
      // Defense in depth: a redirect-capable runtime must not hand back a
      // response whose URL left the allowed origin.
      if (allowedOrigin !== undefined && originOf(finalUrl) !== allowedOrigin) {
        await cancelBody(res);
        return null;
      }
      const declared = Number(res.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > maxBytes) {
        await cancelBody(res);
        return null;
      }
      const reader = res.body?.getReader();
      if (!reader) {
        const text = await res.text();
        return Buffer.byteLength(text) > maxBytes ? null : { text, finalUrl };
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
      return { text: Buffer.concat(chunks).toString("utf8"), finalUrl };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
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

function sortBySeverity(findings: AntiPatternFinding[]): AntiPatternFinding[] {
  // Stable sort: severity desc, original scan order within a severity.
  return [...findings].sort(
    (a, b) =>
      SEVERITY_WEIGHTS[b.severity ?? "INFO"] - SEVERITY_WEIGHTS[a.severity ?? "INFO"],
  );
}

/**
 * The first three findings worth fixing: severity desc (missing = INFO), then
 * source, then line. Findings carry no selector, so none is claimed here.
 */
export function rankAuditActions(result: AuditUrlResult): string[] {
  return [...result.antiPatterns.findings]
    .sort((a, b) => {
      const bySeverity =
        SEVERITY_WEIGHTS[b.severity ?? "INFO"] - SEVERITY_WEIGHTS[a.severity ?? "INFO"];
      if (bySeverity !== 0) return bySeverity;
      const bySource = a.source.localeCompare(b.source);
      if (bySource !== 0) return bySource;
      return (a.line ?? 0) - (b.line ?? 0);
    })
    .slice(0, 3)
    .map((f) => {
      // Spec format is source:line; findings without a derivable line pin 0.
      const where = `${f.source}:${f.line ?? 0}`;
      return `${f.ruleId} at ${where} — ${f.improvements.trim() || f.message}`;
    });
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
  scanFn: (inputs: { css?: string; html?: string; js?: string }) => AntiPatternFinding[],
): Promise<StaticScan> {
  const empty = { findings: [] as AntiPatternFinding[], coverage: { assetsScanned: 0, failed: 0 } };
  const page = await fetchText(
    fetchFn,
    limiter,
    pageUrl,
    timeoutMs,
    MAX_AUDIT_ASSET_BYTES,
  );
  if (page === null) {
    return {
      ...empty,
      error: "Page HTML could not be fetched (HTTP error, timeout, or over 2MB).",
    };
  }
  // Relative asset refs resolve against where the page ENDED, not where the
  // audit started; the final page origin is also the redirect boundary for
  // every asset fetch below.
  const pageOrigin = new URL(page.finalUrl).origin;
  const assets = collectAuditAssets(page.text, page.finalUrl);
  const css: string[] = [];
  const js: string[] = [];
  let scanned = 0;
  let failed = 0;
  for (const [kind, urls] of [["css", assets.css], ["js", assets.js]] as const) {
    for (const url of urls) {
      const fetched = await fetchText(
        fetchFn,
        limiter,
        url,
        timeoutMs,
        MAX_AUDIT_ASSET_BYTES,
        pageOrigin,
      );
      if (fetched === null) {
        failed++;
        continue;
      }
      scanned++;
      (kind === "css" ? css : js).push(fetched.text);
    }
  }
  return {
    // Concatenated per source: scanAntiPatterns takes one string per input;
    // joining with newlines keeps line numbers relative to the asset bundle,
    // not the original file. Findings carry source + line only (house shape).
    findings: scanFn({ html: page.text, css: css.join("\n"), js: js.join("\n") }),
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
    return { error: "The page audit only accepts http(s) URLs" };
  }
  const timeoutMs = clampTimeout(opts.timeoutMs);
  const fetchFn = opts.fetchFn ?? fetch;
  const limiter = opts.limiter ?? new RateLimiter(1000);
  const perfFn: PerfFn = opts.perfFn ?? measureRuntime;

  const perfPromise = perfFn(pageUrl.href, { viewport: opts.viewport }).catch(
    (err): { error: string } => ({ error: msg(err) }),
  );
  const staticPromise = scanStatic(
    pageUrl.href,
    fetchFn,
    limiter,
    timeoutMs,
    opts.scanFn ?? scanAntiPatterns,
  ).catch(
    (err): StaticScan => ({
      findings: [],
      coverage: { assetsScanned: 0, failed: 0 },
      error: msg(err),
    }),
  );
  const [perf, scan] = await Promise.all([perfPromise, staticPromise]);

  const { coverage, error, ...bounded } = scan;
  const sorted = sortBySeverity(bounded.findings);
  const findings = sorted.slice(0, MAX_AUDIT_FINDINGS);
  // Pre-cap severity totals: findings[] is capped, these are not.
  const severityCount = (severity: Severity) =>
    sorted.filter((f) => (f.severity ?? "INFO") === severity).length;
  const notes: string[] = ["Evidence only — not a performance grade."];
  if ("error" in perf) notes.push(`Runtime not measured: ${perf.error}`);
  if (error) notes.push(`Static scan: ${error}`);
  if (coverage.failed > 0) notes.push(`${coverage.failed} asset(s) were skipped.`);

  const result: AuditUrlResult = {
    url: pageUrl.href,
    perf,
    antiPatterns: {
      count: sorted.length,
      high: severityCount("HIGH"),
      medium: severityCount("MEDIUM"),
      info: severityCount("INFO"),
      worst: sorted[0]?.ruleId ?? null,
      findings,
      ...(error ? { error } : {}),
    },
    coverage,
    nextActions: [],
    note: notes.join(" "),
  };
  return { ...result, nextActions: rankAuditActions(result) };
}
