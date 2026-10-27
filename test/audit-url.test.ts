import { describe, expect, it } from "vitest";
import {
  AUDIT_UA,
  MAX_AUDIT_ASSETS,
  auditUrl,
  collectAuditAssets,
  rankAuditActions,
  type AuditUrlResult,
} from "../src/audit-url.js";
import type { AntiPatternFinding } from "../src/audit-rules.js";
import type { MeasureRuntimeOpts, PerfMeasurement } from "../src/perf-live.js";

const PAGE = "https://example.com/page";

const PERF: PerfMeasurement = {
  seconds: 4,
  frames: 240,
  fps: 60,
  droppedFrames: 1,
  worstFrameMs: 18,
  longTaskCount: 2,
  longTaskMaxMs: 55,
  longAnimationFrameCount: 1,
  longAnimationFrameMaxBlockingMs: 40,
  layoutThrashCount: 3,
  measureBeforeCompositeCount: 4,
  layoutReads: 10,
  styleWrites: 6,
  scrollListeners: [{ type: "scroll", passive: false }],
  animationsAtEnd: 2,
  chromePath: "C:\\fake\\chrome.exe",
};

const fastLimiter = { acquire: async () => {} };

function fakeFetch(map: Record<string, string | number>, calls: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const body = map[url];
    if (typeof body === "number") return new Response("", { status: body });
    if (body === undefined) return new Response("", { status: 404 });
    return new Response(body, { status: 200, headers: { "content-type": "text/plain" } });
  }) as unknown as typeof fetch;
}

const perfOk = async (_url: string, _opts?: MeasureRuntimeOpts) => PERF;

/** Real Response with its read-only url overridden (Node's Response has no URL arg). */
function responseAt(url: string, body: string): Response {
  const res = new Response(body, { status: 200 });
  Object.defineProperty(res, "url", { value: url });
  return res;
}

function finding(ruleId: string, severity?: "HIGH" | "MEDIUM" | "INFO"): AntiPatternFinding {
  return {
    ruleId,
    severity,
    message: ruleId,
    why: "test",
    improvements: "test fix",
    source: "css",
    line: 1,
  };
}

function rule(
  ruleId: string,
  severity: "HIGH" | "MEDIUM" | "INFO" | undefined,
  source: "css" | "html" | "js",
  line: number,
  improvements = "",
): AntiPatternFinding {
  return { ruleId, severity, source, line, message: `m-${ruleId}`, why: "test", improvements };
}

function makeAuditResult(findings: AntiPatternFinding[]): AuditUrlResult {
  return {
    url: PAGE,
    perf: PERF,
    antiPatterns: { count: findings.length, worst: findings[0]?.ruleId ?? null, findings },
    coverage: { assetsScanned: 0, failed: 0 },
    nextActions: [],
    note: "Evidence only",
  };
}

describe("collectAuditAssets", () => {
  it("keeps same-origin stylesheets and scripts only, deduped, in document order", () => {
    const html = `
      <link rel="preload" as="style" href="/preload.css">
      <link rel="stylesheet" href="/a.css">
      <link rel="stylesheet" href="/a.css">
      <link rel="stylesheet" href="https://cdn.other/b.css">
      <link rel="stylesheet" href="https://example.com/c.css">
      <script src="/one.js"></script>
      <script type="application/ld+json">{"a":1}</script>
      <script type="module" src="https://example.com/two.js"></script>
      <script>inline()</script>
    `;
    const assets = collectAuditAssets(html, PAGE);
    expect(assets.css).toEqual(["https://example.com/a.css", "https://example.com/c.css"]);
    expect(assets.js).toEqual(["https://example.com/one.js", "https://example.com/two.js"]);
  });

  it("caps the candidate list at the asset bound", () => {
    const html = Array.from({ length: 20 }, (_, i) => `<script src="/s${i}.js"></script>`).join("");
    const assets = collectAuditAssets(html, PAGE);
    expect(assets.css.length + assets.js.length).toBe(MAX_AUDIT_ASSETS);
  });
});

describe("auditUrl", () => {
  it("combines runtime + static evidence and bounds asset failures", async () => {
    const html = `<html><head>
      <link rel="stylesheet" href="/a.css">
      <link rel="stylesheet" href="https://cdn.other/x.css">
      <script src="/a.js"></script>
      <script src="/missing.js"></script>
      </head><body><div>x</div></body></html>`;
    const calls: string[] = [];
    const result = await auditUrl(PAGE, {
      fetchFn: fakeFetch(
        {
          [PAGE]: html,
          "https://example.com/a.css": "a { transition: all 300ms; filter: blur(20px); }",
          "https://example.com/a.js": "gsap.to(el, { width: 300, opacity: 1 });",
          "https://example.com/missing.js": 404,
        },
        calls,
      ),
      perfFn: perfOk,
      limiter: fastLimiter,
    });
    expect("error" in result).toBe(false);
    if ("error" in result) return;

    expect(result.perf).toEqual(PERF);
    expect(result.coverage).toEqual({ assetsScanned: 2, failed: 1 });
    expect(result.antiPatterns.count).toBeGreaterThan(0);
    expect(result.antiPatterns.worst).toBe("blur-heavy"); // HIGH outranks MEDIUM/INFO
    expect(result.antiPatterns.findings.length).toBeLessThanOrEqual(50);
    expect(result.antiPatterns.findings.some((f) => f.source === "css")).toBe(true);
    expect(result.antiPatterns.findings.some((f) => f.source === "js")).toBe(true);
    expect(result.antiPatterns.findings.some((f) => f.source === "html")).toBe(false);
    expect(result.note).toContain("Evidence only");
    expect(result.note).toContain("1 asset(s) were skipped");
    expect(result.nextActions.length).toBeGreaterThan(0);
    expect(result.nextActions.length).toBeLessThanOrEqual(3);
    expect(result.nextActions[0]).toContain("blur-heavy at css:");

    // Only same-origin candidates are fetched (the cross-origin CDN is never hit).
    expect(calls).toEqual([
      PAGE,
      "https://example.com/a.css",
      "https://example.com/a.js",
      "https://example.com/missing.js",
    ]);
  });

  it("degrades runtime to perf.error while keeping static evidence", async () => {
    const result = await auditUrl(PAGE, {
      fetchFn: fakeFetch({
        [PAGE]: `<link rel="stylesheet" href="/a.css">`,
        "https://example.com/a.css": "@keyframes x { to { opacity: 1 } } h1 { transition: all 1s }",
      }),
      perfFn: async () => ({ error: "No Chrome or Edge found." }),
      limiter: fastLimiter,
    });
    if ("error" in result) throw new Error(result.error);
    expect(result.perf).toEqual({ error: "No Chrome or Edge found." });
    expect(result.antiPatterns.count).toBeGreaterThan(0);
    expect(result.note).toContain("Runtime not measured");
  });

  it("degrades the static scan while keeping runtime numbers", async () => {
    const result = await auditUrl(PAGE, {
      fetchFn: fakeFetch({ [PAGE]: 500 }),
      perfFn: async () => PERF,
      limiter: fastLimiter,
    });
    if ("error" in result) throw new Error(result.error);
    expect(result.perf).toEqual(PERF);
    expect(result.antiPatterns.count).toBe(0);
    expect(result.antiPatterns.worst).toBeNull();
    expect(result.antiPatterns.error).toContain("Page HTML could not be fetched");
    expect(result.coverage).toEqual({ assetsScanned: 0, failed: 0 });
    expect(result.note).toContain("Static scan:");
  });

  it("counts an oversize asset as failed instead of reading it", async () => {
    const page = `<script src="/huge.js"></script>`;
    const fetchFn = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url === PAGE) return new Response(page, { status: 200 });
      return new Response("tiny", {
        status: 200,
        headers: { "content-length": String(3 * 1024 * 1024) },
      });
    }) as unknown as typeof fetch;
    const result = await auditUrl(PAGE, { fetchFn, perfFn: perfOk, limiter: fastLimiter });
    if ("error" in result) throw new Error(result.error);
    expect(result.coverage).toEqual({ assetsScanned: 0, failed: 1 });
  });

  it("passes the viewport through to the runtime measurement", async () => {
    let seen: MeasureRuntimeOpts | undefined;
    const result = await auditUrl(PAGE, {
      viewport: "mobile",
      fetchFn: fakeFetch({ [PAGE]: "<html></html>" }),
      perfFn: async (_url, opts) => {
        seen = opts;
        return PERF;
      },
      limiter: fastLimiter,
    });
    if ("error" in result) throw new Error(result.error);
    expect(seen?.viewport).toBe("mobile");
  });

  it("resolves assets against the final post-redirect page URL", async () => {
    const calls: string[] = [];
    const fetchFn = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url === "https://example.com/start") {
        return responseAt(
          "https://example.com/nested/final",
          '<link rel="stylesheet" href="site.css"><script src="app.js"></script>',
        );
      }
      return responseAt(url, "x");
    }) as unknown as typeof fetch;
    const result = await auditUrl("https://example.com/start", {
      fetchFn,
      perfFn: perfOk,
      limiter: fastLimiter,
    });
    if ("error" in result) throw new Error(result.error);
    expect(calls).toEqual([
      "https://example.com/start",
      "https://example.com/nested/site.css",
      "https://example.com/nested/app.js",
    ]);
    expect(result.coverage).toEqual({ assetsScanned: 2, failed: 0 });
  });

  it("rejects an asset redirect that leaves the final page origin", async () => {
    const calls: string[] = [];
    const fetchFn = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url === PAGE) return responseAt(PAGE, '<link rel="stylesheet" href="/a.css">');
      return responseAt("https://cdn.other.example/a.css", "body { transition: all 1s }");
    }) as unknown as typeof fetch;
    const result = await auditUrl(PAGE, { fetchFn, perfFn: perfOk, limiter: fastLimiter });
    if ("error" in result) throw new Error(result.error);
    expect(calls).toEqual([PAGE, "https://example.com/a.css"]);
    expect(result.coverage).toEqual({ assetsScanned: 0, failed: 1 });
    expect(result.note).toContain("1 asset(s) were skipped");
  });

  it("stops reading a streamed asset at the 2MB cap", async () => {
    let pulls = 0;
    let cancelled = false;
    const chunk = new Uint8Array(512 * 1024).fill(65);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchFn = (async (input: string | URL | Request) => {
      if (String(input) === PAGE) return responseAt(PAGE, '<script src="/big.js"></script>');
      // A real Response over the stream (no content-length: the byte cap must
      // do the work), with its URL pinned to the same-origin asset.
      const res = new Response(stream, { status: 200 });
      Object.defineProperty(res, "url", { value: "https://example.com/big.js" });
      return res;
    }) as unknown as typeof fetch;
    const result = await auditUrl(PAGE, {
      fetchFn,
      perfFn: perfOk,
      limiter: fastLimiter,
    });
    if ("error" in result) throw new Error(result.error);
    expect(result.coverage).toEqual({ assetsScanned: 0, failed: 1 });
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThanOrEqual(7); // not drained to the end
  });

  it("sorts findings by severity before the 50 cap so worst is always present", async () => {
    const many = Array.from({ length: 60 }, (_, i) => finding(`info-${i}`, "INFO"));
    many.push(finding("unique-high", "HIGH"));
    const result = await auditUrl(PAGE, {
      fetchFn: fakeFetch({ [PAGE]: "<html></html>" }),
      perfFn: perfOk,
      limiter: fastLimiter,
      scanFn: () => many,
    });
    if ("error" in result) throw new Error(result.error);
    expect(result.antiPatterns.count).toBe(61);
    expect(result.antiPatterns.findings).toHaveLength(50);
    expect(result.antiPatterns.worst).toBe("unique-high");
    expect(result.antiPatterns.findings[0].ruleId).toBe("unique-high");
  });

  it("rejects unusable URLs without fetching anything", async () => {
    expect(await auditUrl("not a url")).toEqual({ error: "Invalid URL: not a url" });
    expect(await auditUrl("file:///tmp/x.html")).toEqual({
      error: "audit_url only accepts http(s) URLs",
    });
  });

  it("uses the audit UA for every request", async () => {
    const seen: string[] = [];
    const fetchFn = (async (_input: string | URL | Request, init?: RequestInit) => {
      seen.push(String((init?.headers as Record<string, string>)["User-Agent"]));
      return new Response("<html></html>", { status: 200 });
    }) as unknown as typeof fetch;
    await auditUrl(PAGE, { fetchFn, perfFn: perfOk, limiter: fastLimiter });
    expect(seen).toEqual([AUDIT_UA]);
  });
});

describe("rankAuditActions", () => {
  it("orders by severity then source and line", () => {
    const result = makeAuditResult([
      rule("b", "MEDIUM", "css", 2, "fix b"),
      rule("a", "HIGH", "html", 9, "fix a"),
      rule("c", "HIGH", "html", 3),
    ]);
    expect(rankAuditActions(result)).toEqual([
      "c at html:3 — m-c",
      "a at html:9 — fix a",
      "b at css:2 — fix b",
    ]);
  });

  it("treats a missing severity as INFO", () => {
    const result = makeAuditResult([
      rule("tier", undefined, "js", 5),
      rule("info", "INFO", "css", 1, "fix info"),
    ]);
    expect(rankAuditActions(result)).toEqual([
      "info at css:1 — fix info",
      "tier at js:5 — m-tier",
    ]);
  });

  it("returns an empty list when there are no findings", () => {
    expect(rankAuditActions(makeAuditResult([]))).toEqual([]);
  });
});
