import { afterEach, describe, expect, it, vi } from "vitest";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AwwwardsClient } from "../src/awwwards.js";
import type { AccessibilityResult } from "../src/a11y.js";
import { Cache } from "../src/cache.js";
import type { PageStructure } from "../src/structure.js";
import type { StackFingerprint } from "../src/stack.js";
import type { MotionDna, SiteDetails, SiteSummary } from "../src/types.js";
import { createHandlers } from "../src/server/create-handlers.js";
import { capSearchResults, SHORTLIST_BUDGET_MS } from "../src/server/handlers/shortlist.js";
import type {
  AnalyzeAccessibilityFn,
  AnalyzeFn,
  AuditUrlFn,
  CaptureFn,
  MotionDnaFn,
  StackFn,
  ToolResponse,
} from "../src/server/types.js";
import type { ShortlistInput } from "../src/shortlist/contracts.js";

// Only public destinations get a stub guard; loopback deliberately runs the
// real guard so the refusal path is exercised without leaving the machine.
const guardState = vi.hoisted(() => ({
  blockCaptureOnly: false,
  blockProbeAfterFirstRead: false,
  calls: new Map<string, number>(),
  closes: 0,
}));
vi.mock("../src/public-net.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/public-net.js")>();
  return {
    ...actual,
    startPublicNetworkGuard: async (url: string) => {
      if (url.includes("127.0.0.1") || url.includes("localhost")) {
        return actual.startPublicNetworkGuard(url);
      }
      const call = (guardState.calls.get(url) ?? 0) + 1;
      guardState.calls.set(url, call);
      let reads = 0;
      const blocked =
        url.includes("blocked") || (guardState.blockCaptureOnly && call > 1);
      return {
        proxyUrl: "http://127.0.0.1:9",
        blocked: () => {
          if (blocked) return 1;
          if (guardState.blockProbeAfterFirstRead && call === 1) {
            reads += 1;
            return reads > 1 ? 1 : 0;
          }
          return 0;
        },
        close: async () => {
          guardState.closes += 1;
        },
      };
    },
  };
});

const dirs: string[] = [];

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1,
]);

const tempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "awwwards-shortlist-handler-"));
  dirs.push(dir);
  return dir;
};

afterEach(async () => {
  guardState.blockCaptureOnly = false;
  guardState.blockProbeAfterFirstRead = false;
  guardState.calls.clear();
  guardState.closes = 0;
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

const stack = (over: Partial<StackFingerprint> = {}): StackFingerprint => ({
  id: "stack-fingerprint-v1",
  framework: "static",
  frameworkMarkers: [],
  frameworkConfidence: "low",
  css: "custom",
  cssMarkers: [],
  cssConfidence: "low",
  libs: [],
  ...over,
});

const structure = (over: Partial<PageStructure> = {}): PageStructure => ({
  url: "https://example.com/",
  title: "Example",
  totalHeight: 1200,
  bands: [],
  scrollMode: "document",
  ...over,
});

const dna = (over: Partial<MotionDna> = {}): MotionDna => ({
  url: "https://example.com/",
  stack: { libs: [], render: [], scrollModel: "native" },
  scroll: { triggerCount: 0, scrubCount: 0, pinCount: 0, scrubRatio: 0, sample: [] },
  easingVocab: [],
  durationVocab: null,
  capturedAt: Date.now(),
  ...over,
});

const site = (slug: string, over: Partial<SiteSummary> = {}): SiteSummary => ({
  id: 1,
  slug,
  title: slug,
  createdAt: 1,
  tags: ["portfolio"],
  thumbnailPath: `${slug}.jpg`,
  liveUrl: `https://${slug}.example/`,
  detailPath: `/sites/${slug}`,
  awards: [],
  ...over,
});

const detail = (slug: string, liveUrl: string | null): SiteDetails => ({
  slug,
  title: slug,
  description: null,
  palette: [],
  technologies: [],
  elements: [],
  awards: [],
  nominee: false,
  score: null,
  ogImage: null,
  liveUrl,
});

const listingHtml = (slug: string): string => {
  const model = JSON.stringify({
    id: 7,
    slug,
    title: slug,
    createdAt: 1,
    tags: ["portfolio"],
    images: { thumbnail: `${slug}.jpg` },
  })
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;");
  return (
    `<div data-collectable-model-value="${model}">` +
    `<a href="/sites/${slug}">site</a>` +
    `<a class="figure-rollover__bt" href="https://${slug}.example/">visit</a>` +
    `</div>`
  );
};

const auditResult = () => ({
  url: "https://example.com/",
  perf: { error: "chrome unavailable" },
  antiPatterns: {
    count: 0,
    high: 0,
    medium: 0,
    info: 0,
    worst: null,
    findings: [],
  },
  coverage: { assetsScanned: 0, failed: 0 },
  nextActions: [],
  note: "evidence only",
});

// Two worst pairs are below WCAG AA 4.5:1; the third is not counted.
const a11yResult = (): AccessibilityResult =>
  ({
    url: "https://example.com/",
    viewport: "desktop",
    evidence: {
      contrast: {
        sampled: 3,
        unparseable: 0,
        worstPairs: [
          { ratio: 2.1, selector: ".low", text: "low", color: "#777", background: "#fff", fontSize: 12, bold: false },
          { ratio: 4.4, selector: ".near", text: "near", color: "#767676", background: "#fff", fontSize: 12, bold: false },
          { ratio: 7.1, selector: ".ok", text: "ok", color: "#222", background: "#fff", fontSize: 14, bold: false },
        ],
      },
    },
    coverage: { textNodesSampled: 3, images: 0, focusables: 0, skippedOpacityGroups: 0 },
    heuristic: true,
    note: "evidence only",
  }) as unknown as AccessibilityResult;

const input = (outDir: string, over: Partial<ShortlistInput> = {}): ShortlistInput => ({
  brief: "Portfolio rebuild with fast discovery.",
  criteria: [{ id: "discovery", label: "Fast discovery", kind: "must", query: "portfolio" }],
  constraints: { allow3d: "any", motionBudget: "expressive" },
  limit: 3,
  viewport: "desktop",
  outDir,
  refresh: false,
  ...over,
});

const body = (response: ToolResponse): any => {
  expect(response.isError).toBeUndefined();
  return JSON.parse((response.content[0] as { type: "text"; text: string }).text);
};

const responseText = (response: ToolResponse): string =>
  (response.content[0] as { type: "text"; text: string }).text;

interface FixtureOptions {
  sites?: SiteSummary[];
  details?: SiteDetails[];
  getHtml?: (path: string) => Promise<string>;
  stackFn?: StackFn;
  analyzeFn?: AnalyzeFn;
  motionDnaFn?: MotionDnaFn;
  analyzeAccessibilityFn?: AnalyzeAccessibilityFn;
  /** Simulates a server without the a11y peer (audit_url must not substitute). */
  omitAnalyzeAccessibility?: boolean;
  auditUrlFn?: AuditUrlFn;
  captureFn?: CaptureFn;
  now?: () => number;
}

async function fixture(options: FixtureOptions = {}) {
  const root = await tempDir();
  const cache = new Cache(join(root, "cache"));
  const getHtml = vi.fn(options.getHtml ?? (async () => ""));
  const getThumbnail = vi.fn(async () => Buffer.from("jpeg-thumb"));
  const client = { getHtml, getThumbnail } as unknown as AwwwardsClient;

  cache.upsertSites(options.sites ?? []);
  for (const item of options.details ?? []) {
    cache.setMeta(`detail:${item.slug}`, item);
  }

  let captures = 0;
  const captureFn: CaptureFn =
    options.captureFn ??
    vi.fn(async () => {
      const file = join(cache.imagesDir, `capture-${captures++}.png`);
      await writeFile(file, PNG_BYTES);
      return { file };
    });
  const stackFn: StackFn = options.stackFn ?? vi.fn(async () => stack());
  const analyzeFn: AnalyzeFn = options.analyzeFn ?? vi.fn(async () => structure());
  const motionDnaFn: MotionDnaFn = options.motionDnaFn ?? vi.fn(async () => dna());
  const analyzeAccessibilityFn: AnalyzeAccessibilityFn | undefined =
    options.omitAnalyzeAccessibility
      ? undefined
      : options.analyzeAccessibilityFn ?? vi.fn(async () => a11yResult());

  const handlers = createHandlers({
    client,
    cache,
    stackFn,
    analyzeFn,
    motionDnaFn,
    analyzeAccessibilityFn,
    auditUrlFn: options.auditUrlFn,
    captureFn,
    ...(options.now ? { now: options.now } : {}),
  });

  return {
    handlers,
    cache,
    client,
    getHtml,
    outDir: join(root, "out"),
    stackFn,
    analyzeFn,
    motionDnaFn,
    analyzeAccessibilityFn,
    auditUrlFn: options.auditUrlFn,
    captureFn,
  };
}

describe("shortlist_references handler", () => {
  it("returns ok with recommend candidates and writes the offline artifacts", async () => {
    const f = await fixture({
      sites: [site("alpha"), site("beta"), site("gamma")],
    });
    const response = await f.handlers.shortlist_references(input(f.outDir));
    const data = body(response);

    expect(data.status).toBe("ok");
    expect(data.criteria).toEqual([
      { id: "discovery", label: "Fast discovery", kind: "must", covered: true },
    ]);
    expect(data.candidates).toHaveLength(3);
    expect(data.candidates.every((c: any) => c.decision === "recommend")).toBe(true);
    expect(data.candidates[0].evidence.a11y).toEqual({
      status: "available",
      contrastWorstPairs: 2,
    });
    expect(data.excluded).toEqual([]);
    expect(f.captureFn).toHaveBeenCalledTimes(3);
    expect(data.viewport).toBe("desktop");

    for (const candidate of data.candidates) {
      expect(candidate.artifacts.thumbnail).toMatch(
        /^assets\/[a-z0-9._-]+-desktop-[a-f0-9]{8}\.jpg$/,
      );
      expect(candidate.artifacts.fullPage).toMatch(
        /^assets\/[a-z0-9._-]+-desktop-[a-f0-9]{8}-full\.png$/,
      );
      expect(candidate.artifacts.screenshot).toBeUndefined();
      await expect(
        readFile(join(f.outDir, candidate.artifacts.thumbnail)),
      ).resolves.toBeTruthy();
      await expect(
        readFile(join(f.outDir, candidate.artifacts.fullPage)),
      ).resolves.toBeTruthy();
    }

    await expect(access(data.artifacts.markdown)).resolves.toBeUndefined();
    await expect(access(data.artifacts.html)).resolves.toBeUndefined();
    await expect(access(data.artifacts.json)).resolves.toBeUndefined();
    await expect(access(data.artifacts.decision)).resolves.toBeUndefined();
    const html = await readFile(data.artifacts.html, "utf8");
    expect(html).toContain("assets/");
    expect(html).not.toContain("http://");
  });

  it("returns inconclusive when a must criterion has no candidate", async () => {
    const f = await fixture({ sites: [site("alpha")] });
    const data = body(
      await f.handlers.shortlist_references(
        input(f.outDir, {
          criteria: [{ id: "missing", label: "Missing", kind: "must", query: "zzzz" }],
        }),
      ),
    );

    expect(data.status).toBe("inconclusive");
    expect(data.candidates).toEqual([]);
    expect(data.criteria[0].covered).toBe(false);
  });

  it("marks a failed motion probe as consider with a motion unknown", async () => {
    const f = await fixture({
      sites: [site("alpha")],
      motionDnaFn: vi.fn(async () => {
        throw new Error("no browser");
      }),
    });
    const data = body(await f.handlers.shortlist_references(input(f.outDir)));

    expect(data.status).toBe("partial");
    expect(data.candidates[0].decision).toBe("consider");
    expect(data.candidates[0].evidence.unknowns).toContain("motion");
    expect(data.limitations.some((item: string) => /motion/i.test(item))).toBe(true);
  });

  it("rejects a relative outDir before searching", async () => {
    const f = await fixture({ sites: [site("alpha")] });
    const response = await f.handlers.shortlist_references(input("relative"));

    expect(response.isError).toBe(true);
    expect(responseText(response)).toContain("absolute");
    expect(f.getHtml).not.toHaveBeenCalled();
  });

  it("fetches one listing page when the cache is blank", async () => {
    const f = await fixture({ getHtml: async () => listingHtml("fetched") });
    const data = body(await f.handlers.shortlist_references(input(f.outDir)));

    expect(f.getHtml).toHaveBeenCalledTimes(1);
    expect(data.candidates.map((c: any) => c.siteSlug)).toContain("fetched");
    expect(
      data.limitations.some((item: string) =>
        item.includes("query was not sent to the remote listing fetch"),
      ),
    ).toBe(true);
  });

  it("reports the substring fallback when FTS is unavailable", async () => {
    const f = await fixture({ sites: [site("alpha")] });
    (f.cache as any).searchSites = () => null;

    const data = body(await f.handlers.shortlist_references(input(f.outDir)));

    expect(data.candidates.map((c: any) => c.siteSlug)).toContain("alpha");
    expect(
      data.limitations.some((item: string) =>
        item.includes("full-text search unavailable; substring match used"),
      ),
    ).toBe(true);
  });

  it("uses cached search hits without fetching a listing page", async () => {
    const f = await fixture({ sites: [site("alpha")] });
    body(await f.handlers.shortlist_references(input(f.outDir)));

    expect(f.getHtml).not.toHaveBeenCalled();
  });

  it("reports cards that all fail the criterion filter", async () => {
    const f = await fixture({ getHtml: async () => listingHtml("unmatched") });
    const data = body(
      await f.handlers.shortlist_references(
        input(f.outDir, {
          criteria: [
            { id: "strict", label: "Strict", kind: "must", tags: ["missing-tag"] },
          ],
        }),
      ),
    );

    expect(f.getHtml).toHaveBeenCalledTimes(1);
    expect(
      data.limitations.some((item: string) =>
        item.includes("returned cards but none matched"),
      ),
    ).toBe(true);
  });

  it("reports that a multi-tag search fetched only the first tag", async () => {
    const f = await fixture({ getHtml: async () => listingHtml("tagged") });
    const data = body(
      await f.handlers.shortlist_references(
        input(f.outDir, {
          criteria: [
            {
              id: "multi",
              label: "Multi",
              kind: "must",
              tags: ["portfolio", "minimal"],
            },
          ],
        }),
      ),
    );

    expect(
      data.limitations.some((item: string) =>
        item.includes(
          "fetched first tag only; remaining tags filtered locally",
        ),
      ),
    ).toBe(true);
  });

  it("caps each criterion's search contribution at 50 sites", () => {
    expect(capSearchResults(Array.from({ length: 60 }, (_, i) => i))).toHaveLength(50);
  });

  it("reports and applies the 50-site cap inside the handler", async () => {
    const sites = Array.from({ length: 60 }, (_, index) =>
      site(`cap-${String(index).padStart(2, "0")}`, { tags: ["cap"] }),
    );
    const f = await fixture({ sites });
    const data = body(
      await f.handlers.shortlist_references(
        input(f.outDir, {
          criteria: [{ id: "cap", label: "Cap", kind: "must", tags: ["cap"] }],
        }),
      ),
    );

    expect(
      data.limitations.some(
        (item: string) =>
          item.includes("search-capped") && item.includes("only the first 50"),
      ),
    ).toBe(true);
    expect(f.motionDnaFn).toHaveBeenCalledTimes(20);
  });

  it("does not crash or probe a loopback live URL", async () => {
    const f = await fixture({
      sites: [site("private", { liveUrl: "http://127.0.0.1:8080/" })],
    });
    const data = body(await f.handlers.shortlist_references(input(f.outDir)));

    expect(data.status).toBe("partial");
    expect(data.candidates[0].decision).toBe("consider");
    expect(data.candidates[0].evidence.unknowns).toContain("publicUrl");
    expect(f.stackFn).not.toHaveBeenCalled();
    expect(f.analyzeFn).not.toHaveBeenCalled();
    expect(f.motionDnaFn).not.toHaveBeenCalled();
    expect(f.analyzeAccessibilityFn).not.toHaveBeenCalled();
  });

  it("captures only non-avoid finalists and excludes a 3D site when allow3d is none", async () => {
    const good = site("good", { liveUrl: "https://good.example/" });
    const second = site("second", { liveUrl: "https://second.example/" });
    const bad = site("bad", { liveUrl: "https://bad.example/" });
    const f = await fixture({
      sites: [good, second, bad],
      motionDnaFn: vi.fn(async (url: string) =>
        url.includes("bad")
          ? dna({ url, stack: { libs: [], render: ["three"], scrollModel: "native" } })
          : dna({ url }),
      ),
    });
    const data = body(
      await f.handlers.shortlist_references(
        input(f.outDir, { constraints: { allow3d: "none", motionBudget: "expressive" } }),
      ),
    );

    expect(data.candidates.map((c: any) => c.siteSlug)).toEqual(["good", "second"]);
    expect(data.excluded).toEqual([
      { siteSlug: "bad", reason: expect.stringContaining("3D") },
    ]);
    expect(f.captureFn).toHaveBeenCalledTimes(2);
    const captured = (f.captureFn as any).mock.calls.map((call: any[]) => call[0]);
    expect(captured).toEqual(["https://good.example/", "https://second.example/"]);
    expect(captured).not.toContain("https://bad.example/");
    for (const candidate of data.candidates) {
      expect(candidate.artifacts.fullPage).toBeDefined();
    }
  });

  it("refuses a capture file outside the images directory", async () => {
    const outside = await tempDir();
    const secret = join(outside, "secret.png");
    await writeFile(
      secret,
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]),
    );
    const f = await fixture({
      sites: [site("alpha")],
      captureFn: vi.fn(async () => ({ file: secret })),
    });

    const data = body(await f.handlers.shortlist_references(input(f.outDir)));

    expect(f.captureFn).toHaveBeenCalledTimes(1);
    expect(data.candidates[0].artifacts.fullPage).toBeUndefined();
    expect(
      data.limitations.some((item: string) =>
        item.includes("not a PNG inside the configured images directory"),
      ),
    ).toBe(true);
  });

  it("preserves an existing decision file and writes the .new proposal", async () => {
    const f = await fixture({ sites: [site("alpha")] });
    const first = body(await f.handlers.shortlist_references(input(f.outDir)));
    await writeFile(first.artifacts.decision, JSON.stringify({ approved: ["alpha"] }));

    const second = body(await f.handlers.shortlist_references(input(f.outDir)));

    expect(await readFile(first.artifacts.decision, "utf8")).toContain("approved");
    expect(second.artifacts.decision).toBe(first.artifacts.decision);
    expect(second.artifacts.decisionNew).toBeDefined();
    await expect(access(second.artifacts.decisionNew)).resolves.toBeUndefined();
  });

  it("records the raw-WebGL residual as an unknown and a limitation", async () => {
    const f = await fixture({
      sites: [site("webgl")],
      motionDnaFn: vi.fn(async (url: string) =>
        dna({ url, stack: { libs: [], render: ["webgl"], scrollModel: "native" } }),
      ),
    });
    const data = body(await f.handlers.shortlist_references(input(f.outDir)));

    expect(data.candidates[0].decision).toBe("recommend");
    expect(data.candidates[0].evidence.unknowns).toContain("3d-unverified");
    expect(data.limitations.some((item: string) => /webgl/i.test(item))).toBe(true);
  });

  it("loads an input seed through detail and never lets it cover a must criterion", async () => {
    const f = await fixture({
      details: [detail("chosen", "https://chosen.example/")],
    });
    const data = body(
      await f.handlers.shortlist_references(input(f.outDir, { seeds: ["chosen"] })),
    );

    expect(data.status).toBe("inconclusive");
    expect(data.candidates).toHaveLength(1);
    expect(data.candidates[0]).toMatchObject({
      siteSlug: "chosen",
      decision: "recommend",
      surfacedBy: [],
      seeded: true,
    });
    expect(data.candidates[0].artifacts.thumbnail).toBeUndefined();
    expect(data.candidates[0].artifacts.fullPage).toBeDefined();
    expect(data.candidates[0].evidence.unknowns).not.toContain("seedLookup");
    expect(
      data.limitations.some((item: string) => item.includes("thumbnail")),
    ).toBe(true);
  });

  it("treats a criterion literally named seed as a normal criterion", async () => {
    const f = await fixture({ sites: [site("seed-hit", { tags: ["seed"] })] });
    const data = body(
      await f.handlers.shortlist_references(
        input(f.outDir, {
          criteria: [
            { id: "seed", label: "Seed", kind: "must", query: "seed" },
          ],
        }),
      ),
    );

    expect(data.status).toBe("ok");
    expect(data.criteria).toContainEqual(
      expect.objectContaining({ id: "seed", covered: true }),
    );
    expect(data.candidates[0].surfacedBy).toEqual(["seed"]);
    expect(data.candidates[0].seeded).toBeUndefined();
  });

  it("skips a capture whose guard refused subresources", async () => {
    guardState.blockCaptureOnly = true;
    const f = await fixture({ sites: [site("alpha")] });
    const data = body(await f.handlers.shortlist_references(input(f.outDir)));

    expect(f.captureFn).toHaveBeenCalledTimes(1);
    expect(data.candidates[0].artifacts.fullPage).toBeUndefined();
    expect(data.candidates[0].artifacts.screenshot).toBeUndefined();
    expect(data.candidates[0].screenshotBlocked).toBe(true);
    expect(data.candidates[0].evidence.unknowns).not.toContain("network-blocked");
    expect(
      data.limitations.some((item: string) => item.includes("screenshot-blocked")),
    ).toBe(true);
  });

  it("records a blocked capture alongside a capture error", async () => {
    guardState.blockCaptureOnly = true;
    const f = await fixture({
      sites: [site("alpha")],
      captureFn: vi.fn(async () => ({ error: "chrome crashed" })),
    });
    const data = body(await f.handlers.shortlist_references(input(f.outDir)));

    expect(f.captureFn).toHaveBeenCalledTimes(1);
    expect(data.candidates[0].artifacts.fullPage).toBeUndefined();
    expect(data.candidates[0].screenshotBlocked).toBe(true);
    expect(data.candidates[0].evidence.unknowns).not.toContain("network-blocked");
    expect(
      data.limitations.some((item: string) =>
        item.includes("screenshot: capture failed"),
      ),
    ).toBe(true);
    expect(
      data.limitations.some((item: string) => item.includes("screenshot-blocked")),
    ).toBe(true);
  });

  it("records a blocked guard when capture throws", async () => {
    guardState.blockCaptureOnly = true;
    const f = await fixture({
      sites: [site("alpha")],
      captureFn: vi.fn(async () => {
        throw new Error("browser disconnected");
      }),
    });
    const data = body(await f.handlers.shortlist_references(input(f.outDir)));

    expect(data.candidates[0].screenshotBlocked).toBe(true);
    expect(guardState.closes).toBe(2);
    expect(data.candidates[0].evidence.unknowns).not.toContain("network-blocked");
    expect(
      data.limitations.some(
        (item: string) =>
          item.includes("screenshot: capture failed") &&
          item.includes("browser disconnected"),
      ),
    ).toBe(true);
    expect(
      data.limitations.some((item: string) => item.includes("screenshot-blocked")),
    ).toBe(true);
  });

  it("stops before probes when the budget is pre-exhausted", async () => {
    let tick = 0;
    const f = await fixture({
      sites: [site("alpha")],
      now: () => (tick += SHORTLIST_BUDGET_MS + 1),
    });

    const data = body(await f.handlers.shortlist_references(input(f.outDir)));

    expect(data.status).toBe("inconclusive");
    expect(f.motionDnaFn).not.toHaveBeenCalled();
    expect(
      data.limitations.some((item: string) => item.includes("budget:")),
    ).toBe(true);
  });

  it("records seed-lookup when the seed detail is missing", async () => {
    const f = await fixture({ getHtml: async () => "" });
    const data = body(
      await f.handlers.shortlist_references(input(f.outDir, { seeds: ["ghost"] })),
    );

    expect(data.status).toBe("inconclusive");
    expect(data.candidates).toHaveLength(1);
    expect(data.candidates[0].evidence.unknowns).toEqual(
      expect.arrayContaining(["liveUrl", "seedLookup"]),
    );
    expect(
      data.limitations.some((item: string) => item.includes("seed-lookup")),
    ).toBe(true);
    expect(data.candidates[0].artifacts.thumbnail).toBeUndefined();
    expect(
      data.limitations.some((item: string) => item.includes("thumbnail")),
    ).toBe(true);
  });

  it("uses the accessibility peer and counts worst contrast pairs below 4.5", async () => {
    const analyzeAccessibilityFn = vi.fn(async () => a11yResult());
    const f = await fixture({ sites: [site("alpha")], analyzeAccessibilityFn });
    const data = body(await f.handlers.shortlist_references(input(f.outDir)));

    expect(analyzeAccessibilityFn).toHaveBeenCalledWith({
      url: "https://alpha.example/",
      viewport: "desktop",
      proxyServer: "http://127.0.0.1:9",
    });
    expect(data.candidates[0].evidence.a11y).toEqual({
      status: "available",
      contrastWorstPairs: 2,
    });
    expect(data.candidates[0].evidence.unknowns).not.toContain("a11y");
  });

  it("does not treat audit_url as accessibility evidence", async () => {
    const auditUrlFn = vi.fn(async () => auditResult());
    const f = await fixture({
      sites: [site("alpha")],
      omitAnalyzeAccessibility: true,
      auditUrlFn,
    });
    const data = body(await f.handlers.shortlist_references(input(f.outDir)));

    expect(data.candidates[0].evidence.a11y).toEqual({ status: "unknown" });
    expect(data.candidates[0].evidence.unknowns).toContain("a11y");
    expect(data.limitations).toContain(
      "a11y: not measured (no accessibility peer configured)",
    );
    expect(auditUrlFn).not.toHaveBeenCalled();
  });

  it("marks a11y unknown when the accessibility probe fails", async () => {
    const f = await fixture({
      sites: [site("alpha")],
      analyzeAccessibilityFn: vi.fn(async () => {
        throw new Error("no browser");
      }),
    });
    const data = body(await f.handlers.shortlist_references(input(f.outDir)));

    expect(data.candidates[0].evidence.a11y).toEqual({ status: "unknown" });
    expect(data.candidates[0].evidence.unknowns).toContain("a11y");
  });

  it("stores inner-scroller captures as viewport screenshots, not full pages", async () => {
    let captureDir = "";
    const captureFn: CaptureFn = vi.fn(async () => {
      const file = join(captureDir, "inner.png");
      await writeFile(file, PNG_BYTES);
      return {
        mode: "viewport" as const,
        scrollRoot: "#app",
        file,
        viewport: { width: 390, height: 844 },
      };
    });
    const f = await fixture({ sites: [site("inner")], captureFn });
    captureDir = f.cache.imagesDir;

    const data = body(await f.handlers.shortlist_references(input(f.outDir)));

    expect(data.candidates[0].artifacts.fullPage).toBeUndefined();
    expect(data.candidates[0].artifacts.screenshot).toMatch(
      /^assets\/[a-z0-9._-]+-viewport\.png$/,
    );
    expect(
      data.limitations.some((item: string) => item.includes("screenshot-viewport")),
    ).toBe(true);
    await expect(
      readFile(join(f.outDir, data.candidates[0].artifacts.screenshot)),
    ).resolves.toBeTruthy();
  });

  it("tolerates a sparse cached motion row", async () => {
    const f = await fixture({ sites: [site("alpha")] });
    f.cache.upsertMotionDna({
      url: "https://alpha.example/",
      capturedAt: Date.now(),
    } as MotionDna);

    const data = body(await f.handlers.shortlist_references(input(f.outDir)));

    expect(f.motionDnaFn).not.toHaveBeenCalled();
    expect(data.candidates[0].decision).toBe("consider");
    expect(data.candidates[0].motionLevel).toBe("unknown");
  });

  it("does not downgrade motion when the motion cache write fails", async () => {
    const f = await fixture({ sites: [site("alpha")] });
    vi.spyOn(f.cache, "upsertMotionDna").mockImplementation(() => {
      throw new Error("disk full");
    });

    const data = body(await f.handlers.shortlist_references(input(f.outDir)));

    expect(data.candidates[0].decision).toBe("recommend");
    expect(data.candidates[0].evidence.unknowns).not.toContain("motion");
    expect(
      data.limitations.some((item: string) => item.includes("motion probe failed")),
    ).toBe(false);
  });

  it("always keeps explicit seeds and reports pool truncation", async () => {
    const listed = Array.from(
      { length: 24 },
      (_, index) => `listed-${String(index).padStart(2, "0")}`,
    );
    const f = await fixture({
      details: [detail("zzz-seed", "https://zzz-seed.example/")],
      getHtml: async () => listed.map((slug) => listingHtml(slug)).join(""),
    });
    const data = body(
      await f.handlers.shortlist_references(
        input(f.outDir, { seeds: ["zzz-seed"] }),
      ),
    );

    expect(f.getHtml).toHaveBeenCalledTimes(1);
    const probed = (f.motionDnaFn as any).mock.calls.map((call: any[]) => call[0]);
    expect(probed).toContain("https://zzz-seed.example/");
    expect(probed).toHaveLength(20);
    expect(
      data.limitations.some((item: string) => item.includes("pool-truncated")),
    ).toBe(true);
  });

  it("gives case-colliding slugs distinct flat asset names", async () => {
    const f = await fixture({ sites: [site("Alpha"), site("alpha")] });
    const data = body(await f.handlers.shortlist_references(input(f.outDir)));
    const bySlug = Object.fromEntries(
      data.candidates.map((candidate: any) => [candidate.siteSlug, candidate]),
    );

    expect(data.candidates).toHaveLength(2);
    expect(bySlug.Alpha.artifacts.thumbnail).not.toBe(bySlug.alpha.artifacts.thumbnail);
    expect(bySlug.Alpha.artifacts.fullPage).not.toBe(bySlug.alpha.artifacts.fullPage);
    for (const candidate of [bySlug.Alpha, bySlug.alpha]) {
      await expect(
        readFile(join(f.outDir, candidate.artifacts.thumbnail)),
      ).resolves.toBeTruthy();
      await expect(
        readFile(join(f.outDir, candidate.artifacts.fullPage)),
      ).resolves.toBeTruthy();
    }
  });

  it("selects a must-covering candidate before higher-breadth discoveries", async () => {
    const rankedSites = () => [
      site("alpha", { tags: ["layout", "type"] }),
      site("bravo", { tags: ["layout", "type"] }),
      site("charlie", { tags: ["layout", "type"] }),
      site("aaa-must", { tags: ["mustslug"] }),
      site("delta", { tags: ["misc"] }),
      site("echo", { tags: ["misc"] }),
    ];
    const rankedCriteria: ShortlistInput["criteria"] = [
      { id: "must-x", label: "Must X", kind: "must", query: "mustslug" },
      { id: "layout", label: "Layout", kind: "nice", query: "layout" },
      { id: "type", label: "Type", kind: "nice", query: "type" },
      { id: "misc", label: "Misc", kind: "nice", query: "misc" },
    ];

    const trimmedFixture = await fixture({ sites: rankedSites() });
    const trimmed = body(
      await trimmedFixture.handlers.shortlist_references(
        input(trimmedFixture.outDir, { limit: 3, criteria: rankedCriteria }),
      ),
    );
    expect(trimmed.candidates.map((c: any) => c.siteSlug)).toEqual([
      "alpha",
      "bravo",
      "aaa-must",
    ]);
    expect(trimmed.criteria.find((c: any) => c.id === "must-x")?.covered).toBe(true);
    expect(trimmed.status).toBe("ok");

    const fullFixture = await fixture({ sites: rankedSites() });
    const full = body(
      await fullFixture.handlers.shortlist_references(
        input(fullFixture.outDir, { limit: 5, criteria: rankedCriteria }),
      ),
    );
    expect(full.candidates.map((c: any) => c.siteSlug)).toContain("aaa-must");
    expect(full.criteria.find((c: any) => c.id === "must-x")?.covered).toBe(true);
    expect(full.status).toBe("ok");
  });

  it("reports must-trim when limit cannot fit every must criterion", async () => {
    const f = await fixture({
      sites: [
        site("m1-site", { tags: ["m1"] }),
        site("m2-site", { tags: ["m2"] }),
        site("m3-site", { tags: ["m3"] }),
        site("m4-site", { tags: ["m4"] }),
      ],
    });
    const data = body(
      await f.handlers.shortlist_references(
        input(f.outDir, {
          criteria: ["m1", "m2", "m3", "m4"].map((id) => ({
            id,
            label: id,
            kind: "must" as const,
            tags: [id],
          })),
          limit: 3,
        }),
      ),
    );

    expect(data.candidates).toHaveLength(3);
    expect(
      data.limitations.some(
        (item: string) => item.includes("must-trim") && item.includes("m4"),
      ),
    ).toBe(true);
    expect(data.status).toBe("inconclusive");
  });

  it("bypasses the motion cache only when refresh is set", async () => {
    const f = await fixture({ sites: [site("alpha")] });
    f.cache.upsertMotionDna(dna({ url: "https://alpha.example/" }));

    await f.handlers.shortlist_references(input(f.outDir));
    expect(f.motionDnaFn).not.toHaveBeenCalled();

    await f.handlers.shortlist_references(input(f.outDir, { refresh: true }));
    expect(f.motionDnaFn).toHaveBeenCalledTimes(1);
  });

  it("never reuses a desktop motion cache row for mobile", async () => {
    const motionDnaFn = vi.fn(async () =>
      dna({
        scroll: { triggerCount: 1, scrubCount: 0, pinCount: 0, scrubRatio: 0, sample: [] },
      }),
    );
    const f = await fixture({ sites: [site("alpha")], motionDnaFn });
    f.cache.upsertMotionDna(
      dna({
        url: "https://alpha.example/",
        scroll: { triggerCount: 9, scrubCount: 4, pinCount: 2, scrubRatio: 1, sample: [] },
      }),
    );

    const data = body(
      await f.handlers.shortlist_references(input(f.outDir, { viewport: "mobile" })),
    );

    expect(motionDnaFn).toHaveBeenCalledTimes(1);
    expect(data.candidates[0].evidence.motion.scroll.triggerCount).toBe(1);
    expect(
      f.cache.getMotionDna("https://alpha.example/")?.scroll.triggerCount,
    ).toBe(9);
    expect(
      data.limitations.some((item: string) => item.includes("motion-cache: mobile")),
    ).toBe(true);
  });

  it("does not cache motion captured while the guard was blocking", async () => {
    guardState.blockProbeAfterFirstRead = true;
    const f = await fixture({ sites: [site("alpha")] });

    const first = body(await f.handlers.shortlist_references(input(f.outDir)));
    expect(f.motionDnaFn).toHaveBeenCalledTimes(1);
    expect(
      first.limitations.some((item: string) =>
        item.includes("motion cache write skipped"),
      ),
    ).toBe(true);
    expect(f.cache.getMotionDna("https://alpha.example/")).toBeNull();

    guardState.blockProbeAfterFirstRead = false;
    guardState.calls.clear();
    body(await f.handlers.shortlist_references(input(f.outDir)));
    expect(f.motionDnaFn).toHaveBeenCalledTimes(2);
  });

  it("forwards the guard proxy to every live probe and to capture", async () => {
    const f = await fixture({ sites: [site("alpha")] });
    await f.handlers.shortlist_references(input(f.outDir));

    const proxy = "http://127.0.0.1:9";
    expect(f.stackFn).toHaveBeenCalledWith("https://alpha.example/", {
      proxyServer: proxy,
    });
    expect(f.analyzeFn).toHaveBeenCalledWith(
      "https://alpha.example/",
      undefined,
      expect.objectContaining({
        waitStrategy: "load",
        viewport: "desktop",
        proxyServer: proxy,
      }),
    );
    expect(f.motionDnaFn).toHaveBeenCalledWith(
      "https://alpha.example/",
      expect.objectContaining({ viewport: "desktop", proxyServer: proxy }),
    );
    expect(f.analyzeAccessibilityFn).toHaveBeenCalledWith({
      url: "https://alpha.example/",
      viewport: "desktop",
      proxyServer: proxy,
    });
    expect(f.captureFn).toHaveBeenCalledWith(
      "https://alpha.example/",
      expect.any(String),
      expect.objectContaining({
        inline: true,
        maxInlineBytes: 8_000_000,
        scrollCapture: "viewport",
        proxyServer: proxy,
      }),
    );
  });

  it("returns a short isError when an unexpected failure escapes", async () => {
    const f = await fixture({ sites: [site("alpha")] });
    vi.spyOn(f.cache, "searchSites").mockImplementation(() => {
      throw new Error("db exploded");
    });
    const response = await f.handlers.shortlist_references(input(f.outDir));

    expect(response.isError).toBe(true);
    const message = responseText(response);
    expect(message).toContain("db exploded");
    expect(message).not.toContain("    at ");
  });

  it("reports a search fetch rejection as a limitation, not an error", async () => {
    const f = await fixture({
      getHtml: async () => {
        throw new Error("network offline");
      },
    });
    const data = body(await f.handlers.shortlist_references(input(f.outDir)));

    expect(data.candidates).toEqual([]);
    expect(
      data.limitations.some((item: string) =>
        item.includes("search fetch failed"),
      ),
    ).toBe(true);
  });

  it("reports an empty listing parse instead of implying no matches", async () => {
    const f = await fixture({ getHtml: async () => "<html><body></body></html>" });
    const data = body(await f.handlers.shortlist_references(input(f.outDir)));

    expect(data.candidates).toEqual([]);
    expect(
      data.limitations.some((item: string) =>
        item.includes("search: discovery returned 0 site cards"),
      ),
    ).toBe(true);
  });

  it("closes the guard after the probe and after capture", async () => {
    const f = await fixture({ sites: [site("alpha")] });
    body(await f.handlers.shortlist_references(input(f.outDir)));

    expect(guardState.closes).toBe(2);
  });

  it("lets must-covering discoveries take slots before seeds", async () => {
    const discovered = [
      site("disc1", { tags: ["m1"] }),
      site("disc2", { tags: ["m2"] }),
      site("disc3", { tags: ["m3"] }),
    ];
    const seeds = ["seed1", "seed2", "seed3"].map((slug) =>
      detail(slug, `https://${slug}.example/`),
    );
    const f = await fixture({ sites: discovered, details: seeds });
    const data = body(
      await f.handlers.shortlist_references(
        input(f.outDir, {
          criteria: [
            { id: "m1", label: "M1", kind: "must", tags: ["m1"] },
            { id: "m2", label: "M2", kind: "must", tags: ["m2"] },
            { id: "m3", label: "M3", kind: "must", tags: ["m3"] },
          ],
          seeds: ["seed1", "seed2", "seed3"],
          limit: 3,
        }),
      ),
    );

    expect(data.status).toBe("ok");
    expect(data.candidates.map((candidate: any) => candidate.siteSlug)).toEqual([
      "disc1",
      "disc2",
      "disc3",
    ]);
    for (const seed of ["seed1", "seed2", "seed3"]) {
      expect(
        data.limitations.some(
          (item: string) => item.includes("seed-limit") && item.includes(seed),
        ),
      ).toBe(true);
    }
    expect(data.limitations.some((item: string) => item.includes("must-trim"))).toBe(
      false,
    );
  });

  it("keeps raw WebGL unverified under allow3d none", async () => {
    const f = await fixture({
      sites: [site("raw")],
      stackFn: vi.fn(async () => stack({ libs: ["webgl"] })),
    });
    const data = body(
      await f.handlers.shortlist_references(
        input(f.outDir, { constraints: { allow3d: "none", motionBudget: "expressive" } }),
      ),
    );

    expect(data.candidates[0].decision).toBe("consider");
    expect(data.candidates[0].evidence.unknowns).toContain("3d-unverified");
    expect(data.excluded).toEqual([]);
  });

  it("keeps motion-only raw WebGL unverified under allow3d none", async () => {
    const f = await fixture({
      sites: [site("raw-motion")],
      motionDnaFn: vi.fn(async () =>
        dna({
          stack: { libs: [], render: ["webgl"], scrollModel: "native" },
          scroll: { triggerCount: 1, scrubCount: 0, pinCount: 0, scrubRatio: 0, sample: [] },
        }),
      ),
    });
    const data = body(
      await f.handlers.shortlist_references(
        input(f.outDir, { constraints: { allow3d: "none", motionBudget: "expressive" } }),
      ),
    );

    expect(data.candidates[0].decision).toBe("consider");
    expect(data.candidates[0].evidence.unknowns).toContain("3d-unverified");
    expect(data.candidates[0].reason).toMatch(/unverified/i);
    expect(data.excluded).toEqual([]);
  });

  it("strips control characters from limitation text", async () => {
    const f = await fixture({
      sites: [site("alpha")],
      stackFn: vi.fn(async () => {
        throw new Error("bad \u001b[2mstack");
      }),
    });
    const data = body(await f.handlers.shortlist_references(input(f.outDir)));
    const stackLimitation = data.limitations.find((item: string) =>
      item.includes("stack probe failed"),
    );

    expect(stackLimitation).toBeDefined();
    expect(stackLimitation).not.toContain("\u001b");
    expect(stackLimitation).toContain("[2mstack");
  });

  it("treats an empty error string as a failed stack or structure probe", async () => {
    const f = await fixture({
      sites: [site("alpha")],
      stackFn: vi.fn(async () => ({ error: "" })),
      analyzeFn: vi.fn(async () => ({ error: "" })),
    });
    const data = body(await f.handlers.shortlist_references(input(f.outDir)));

    expect(data.candidates[0].decision).toBe("consider");
    expect(data.candidates[0].evidence.unknowns).toEqual(
      expect.arrayContaining(["stack", "structure"]),
    );
  });

  it("reports capture {error} as a screenshot limitation", async () => {
    const f = await fixture({
      sites: [site("alpha")],
      captureFn: vi.fn(async () => ({ error: "no chrome" })),
    });
    const data = body(await f.handlers.shortlist_references(input(f.outDir)));

    expect(data.candidates[0].artifacts.fullPage).toBeUndefined();
    expect(data.candidates[0].artifacts.screenshot).toBeUndefined();
    expect(
      data.limitations.some((item: string) => item.includes("screenshot")),
    ).toBe(true);
  });

  it("marks a candidate and the result when the guard refused subresources", async () => {
    const f = await fixture({ sites: [site("blocked")] });
    const data = body(await f.handlers.shortlist_references(input(f.outDir)));

    expect(data.candidates[0].decision).toBe("consider");
    expect(data.candidates[0].evidence.unknowns).toContain("network-blocked");
    expect(
      data.limitations.some((item: string) => item.includes("network-blocked")),
    ).toBe(true);
  });

  it("reserves a returned slot for an explicit seed", async () => {
    const f = await fixture({
      sites: [site("alpha"), site("bravo"), site("charlie")],
      details: [detail("zzz-seed", "https://zzz-seed.example/")],
    });
    const data = body(
      await f.handlers.shortlist_references(
        input(f.outDir, { seeds: ["zzz-seed"] }),
      ),
    );

    expect(data.candidates).toHaveLength(3);
    expect(data.candidates.map((c: any) => c.siteSlug)).toContain("zzz-seed");
    expect(
      data.limitations.some((item: string) => item.includes("seed-limit")),
    ).toBe(false);
  });

  it("reports seed-limit when more seeds than returned slots survive", async () => {
    const f = await fixture({
      details: ["s1", "s2", "s3", "s4"].map((slug) => detail(slug, `https://${slug}.example/`)),
    });
    const data = body(
      await f.handlers.shortlist_references(
        input(f.outDir, { seeds: ["s1", "s2", "s3", "s4"] }),
      ),
    );

    expect(data.candidates).toHaveLength(3);
    expect(
      data.limitations.some((item: string) => item.includes("seed-limit")),
    ).toBe(true);
  });

  it("ranks recommend seeds above consider seeds when seeds exceed limit", async () => {
    const f = await fixture({
      details: ["weak", "s1", "s2", "s3"].map((slug) =>
        detail(slug, `https://${slug}.example/`),
      ),
      motionDnaFn: vi.fn(async (url: string) => {
        if (url.includes("weak")) throw new Error("no motion");
        return dna({ url });
      }),
    });
    const data = body(
      await f.handlers.shortlist_references(
        input(f.outDir, { seeds: ["weak", "s1", "s2", "s3"] }),
      ),
    );

    const returned = data.candidates.map((c: any) => c.siteSlug);
    expect(returned).toHaveLength(3);
    expect(returned).not.toContain("weak");
    expect(returned).toEqual(["s1", "s2", "s3"]);
    expect(
      data.limitations.some(
        (item: string) => item.includes("seed-limit") && item.includes("weak"),
      ),
    ).toBe(true);
  });

  it("ranks a recommend above a consider that matched more criteria", async () => {
    const f = await fixture({
      sites: [
        site("clean", { tags: ["a"] }),
        site("broad", { tags: ["a", "b", "c"] }),
      ],
      motionDnaFn: vi.fn(async (url: string) => {
        if (url.includes("broad")) throw new Error("no motion");
        return dna({ url });
      }),
    });
    const data = body(
      await f.handlers.shortlist_references(
        input(f.outDir, {
          criteria: [
            { id: "a", label: "A", kind: "nice", query: "a" },
            { id: "b", label: "B", kind: "nice", query: "b" },
            { id: "c", label: "C", kind: "nice", query: "c" },
          ],
        }),
      ),
    );

    expect(data.candidates[0]).toMatchObject({
      siteSlug: "clean",
      decision: "recommend",
    });
    expect(data.candidates[1]).toMatchObject({
      siteSlug: "broad",
      decision: "consider",
      surfacedBy: ["a", "b", "c"],
    });
  });

  it("stops probing at the overall budget", async () => {
    let calls = 0;
    const f = await fixture({
      sites: [site("alpha")],
      now: () => (calls++ === 0 ? 0 : 200_000),
    });
    const data = body(await f.handlers.shortlist_references(input(f.outDir)));

    expect(data.candidates).toEqual([]);
    expect(f.stackFn).not.toHaveBeenCalled();
    expect(
      data.limitations.some((item: string) => item.includes("budget")),
    ).toBe(true);
  });

  it("stops finalist capture at the overall budget", async () => {
    let calls = 0;
    const f = await fixture({
      sites: [site("alpha")],
      now: () => {
        calls += 1;
        return calls >= 3 ? 200_000 : 0;
      },
    });
    const data = body(await f.handlers.shortlist_references(input(f.outDir)));

    expect(data.candidates).toHaveLength(1);
    expect(f.captureFn).not.toHaveBeenCalled();
    expect(data.candidates[0].artifacts.fullPage).toBeUndefined();
    expect(
      data.limitations.some((item: string) =>
        item.includes("capture stopped before thumbnails/screenshots for alpha"),
      ),
    ).toBe(true);
    expect(
      data.limitations.some((item: string) => item.includes("budget")),
    ).toBe(true);
  });

  it("writes a capture from base64 without reading the file", async () => {
    const f = await fixture({
      sites: [site("alpha")],
      captureFn: vi.fn(async () => ({
        file: "missing-capture.png",
        base64: Buffer.from([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1,
        ]).toString("base64"),
      })),
    });
    const data = body(await f.handlers.shortlist_references(input(f.outDir)));

    expect(data.candidates[0].artifacts.fullPage).toBeDefined();
    await expect(
      readFile(join(f.outDir, data.candidates[0].artifacts.fullPage)),
    ).resolves.toEqual(PNG_BYTES);
  });

  it("refuses an oversized screenshot file without reading it", async () => {
    let cacheDir = "";
    const captureFn: CaptureFn = vi.fn(async () => {
      const file = join(cacheDir, "huge.png");
      await writeFile(file, Buffer.alloc(8_000_001));
      return { file };
    });
    const f = await fixture({ sites: [site("alpha")], captureFn });
    cacheDir = f.cache.imagesDir;
    const data = body(await f.handlers.shortlist_references(input(f.outDir)));

    expect(data.candidates[0].artifacts.fullPage).toBeUndefined();
    expect(
      data.limitations.some((item: string) =>
        item.includes("not a PNG inside the configured images directory"),
      ),
    ).toBe(true);
  });
});
