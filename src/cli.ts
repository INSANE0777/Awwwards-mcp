#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { AwwwardsClient, SHARED_RATE_LIMITER } from "./awwwards.js";
import { Cache } from "./cache.js";
import { createHandlers, type ToolResponse } from "./server.js";
import { detailArgsSchema } from "./detail-schema.js";
import { verifyFlowArgsSchema } from "./verify-flow.js";
import { captureLiveSite } from "./capture.js";
import { runIndexer, shouldAutoIndex } from "./indexer.js";
import { checkForUpdate } from "./version-check.js";
import { checkEnvironment } from "./env-check.js";
import { registerGuarded } from "./tool-profile.js";

// The handlers return ToolResponse, which is structurally identical to the
// SDK's CallToolResult at runtime ({ content, isError? }). CallToolResult's
// schema additionally carries a [k: string]: unknown index signature that a
// TypeScript interface cannot satisfy implicitly, so a cast bridges the two.
const asMcpResult = (p: Promise<ToolResponse>): Promise<CallToolResult> =>
  p as unknown as Promise<CallToolResult>;

// Shared by capture_live_site, analyze_page_structure and record_site_motion.
const waitStrategySchema = z
  .enum(["load", "networkidle"])
  .default("load")
  .describe("'load' + settle works on heavy sites; 'networkidle' waits for total quiet");

const viewportSchema = z
  .enum(["desktop", "mobile"])
  .default("desktop")
  .describe(
    "desktop = 1440x900 (default); mobile = 390x844 iPhone-class with deviceScaleFactor 3, isMobile + hasTouch",
  );

const cacheRoot = process.env.AWWWARDS_CACHE_DIR ?? join(homedir(), ".awwwards-mcp");
let cache: Cache;
try {
  cache = new Cache(cacheRoot);
} catch (err) {
  console.error(
    `awwwards-mcp: cannot initialize cache at ${cacheRoot}: ${
      err instanceof Error ? err.message : String(err)
    }`,
  );
  process.exit(1);
}
const client = new AwwwardsClient({ rateLimiter: SHARED_RATE_LIMITER });
const handlers = createHandlers({
  client,
  cache,
  // captureLiveSite's third positional is the injectable playwright loader,
  // so the CaptureFn-shaped (url, dir, opts) call is adapted to land opts
  // in the function's fourth (opts) position.
  captureFn: (url, imagesDir, opts) => captureLiveSite(url, imagesDir, undefined, opts),
});

// Version must match package.json; reading it at runtime makes drift impossible.
const pkgJson = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf8"),
) as { version: string };
const server = new McpServer({ name: "awwwards-mcp", version: pkgJson.version });

// Every registration goes through the guard: AWWWARDS_MCP_PROFILE=core skips
// non-core tools, AWWWARDS_MCP_MAX_RESPONSE_BYTES caps text+image payloads, and
// AWWWARDS_MCP_DEBUG_MEMORY=1 logs one JSON line per call on stderr. The
// legacy AWARDS_MCP_* names are accepted as a one-release fallback.
const tool = ((...args: any[]) =>
  registerGuarded(server, "tool", args)) as unknown as McpServer["tool"];
const registerTool = ((...args: any[]) =>
  registerGuarded(server, "registerTool", args)) as unknown as McpServer["registerTool"];

tool(
  "search_sites",
  "Search award-winning websites on Awwwards — the site index with filters. Returns site cards with inline screenshots, live URLs, awards and tags.",
  {
    query: z.string().describe("Free text matched against site titles and tags").optional(),
    color: z
      .string()
      .regex(/^#?[0-9A-Fa-f]{6}$/)
      .describe("Dominant color hex, e.g. '#404040'")
      .optional(),
    tags: z.array(z.string()).describe("Tag slugs, e.g. ['3d', 'portfolio']").optional(),
    technology: z.string().describe("Technology slug, e.g. 'webgl', 'gsap', 'astro'").optional(),
    award: z
      .enum([
        "sotd", "sotm", "soty", "nominees", "developer", "honorable",
        "ecommerce", "portfolio", "product", "typography", "businessServices", "noCode",
      ])
      .optional()
      .describe(
        "Award collection: sotd | developer | honorable | sotm | soty | nominees, or an annual winner category: ecommerce | portfolio | product | typography | businessServices | noCode",
      ),
    sortBy: z
      .enum(["score", "newest"])
      .default("newest")
      .describe(
        "Sort results: by Awwwards jury score (details previously fetched) or newest first",
      ),
    responseMode: z.enum(["full", "compact"]).default("full")
      .describe("full (default) returns all inline previews; compact returns concise cards and at most two page previews"),
    count: z.number().int().min(1).max(12).default(6),
    page: z.number().int().min(1).default(1),
  },
  { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  (args) => asMcpResult(handlers.search_sites(args)),
);

registerTool(
  "get_site_details",
  {
    description:
      "Get the design DNA of one Awwwards site: color palette, technologies, design elements, awards, description and inline screenshot. compact=true returns a token-diet summary. Batch: pass slugs (1–10, no images) for ordered compact details per slug with cached/fetched/error status; compact is ignored in batch mode (batch output is always compact). Provide exactly one of slug or slugs.",
    inputSchema: detailArgsSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  (args) => asMcpResult(handlers.get_site_details(args)),
);

tool(
  "compare_sites",
  "Compare the design DNA of 2–3 Awwwards sites: titles, live URLs, palettes, technologies, elements, awards and jury scores. Text only; missing details are fetched and cached. For your own build vs a reference, use verify_build instead.",
  {
    slugs: z.array(z.string().regex(/^[\w-]+$/)).min(2).max(3)
      .refine((slugs) => new Set(slugs.map((slug) => slug.toLowerCase())).size === slugs.length, "Site slugs must be distinct")
      .describe("Two or three distinct site slugs from search_sites"),
  },
  { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  (args) => asMcpResult(handlers.compare_sites(args)),
);

tool(
  "create_design_brief",
  "Synthesize a cited design direction from 2–5 Awwwards references",
  {
    slugs: z.array(z.string().regex(/^[\w-]+$/)).min(2).max(5).refine((slugs) => new Set(slugs.map((slug) => slug.toLowerCase())).size === slugs.length, "slugs must be distinct"),
    goal: z.string().trim().min(1).max(2000),
    audience: z.string().trim().min(1).max(1000).optional(),
    constraints: z.array(z.string().trim().min(1).max(1000)).max(20).optional(),
    includeStructure: z.boolean().default(false),
    viewport: viewportSchema,
    waitStrategy: waitStrategySchema,
    maxBands: z.number().int().min(5).max(60).default(12),
  },
  { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  (args) => asMcpResult(handlers.create_design_brief(args)),
);

tool(
  "get_index_status",
  "Read offline index status: cached site count, progress, last successful finish and error, lock state and freshness. No live requests.",
  {},
  { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  () => asMcpResult(handlers.get_index_status()),
);

tool(
  "get_index_stats",
  "Aggregate metrics over the LOCAL cache only (zero network). ALL-TIME: site count, element count and technology/tag frequency. WINDOWED by windowDays (default 90, 1-3650): cached details, palette colour frequency and jury score stats from at most the 500 most recently fetched detail rows, plus Motion DNA library frequency. Each metric carries coverage labelled 'locally cached subset'; windowDays/detailsCached/detailParseCap appear only on windowed metrics (sites/elements/technologies are explicitly all-time). top caps each frequency list (default 10, 1-50). Aggregates only - no site slugs or titles. Personal, non-commercial use.",
  {
    windowDays: z
      .number()
      .int()
      .min(1)
      .max(3650)
      .default(90)
      .describe("Window for detail-derived metrics only (details, colours, scores, motion DNA); sites/elements/technologies are all-time"),
    top: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(10)
      .describe("Max rows per frequency list (technologies, colours, motion libs)"),
  },
  { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  (args) => asMcpResult(handlers.get_index_stats(args)),
);

tool(
  "get_site_elements",
  "Get the design-element highlights of one Awwwards site: component-level visuals (3D models, video content, mobile layouts, microcopy) with poster images inline and video URLs.",
  {
    slug: z
      .string()
      .regex(/^[\w-]+$/)
      .describe("Site slug from search_sites, e.g. 'l-i-s-a'"),
  },
  { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  (args) => asMcpResult(handlers.get_site_elements(args)),
);

tool(
  "search_elements",
  "Search Awwwards' curated element gallery — award-grade UI components (footers, menus, loaders, transitions, micro-interactions…). " +
    "Usage: pass query text and at most one of category/stack; every result links back to its source element page and parent project.",
  {
    query: z.string().describe("Free text: what the component is or does").optional(),
    category: z
      .string()
      .describe("Category id from the gallery taxonomy, e.g. 'footer', 'menu', 'cta', 'loading', 'mouse_interaction', '404_page'")
      .optional(),
    stack: z.array(z.string()).describe("Built-with tokens, e.g. ['gsap', 'webgl']").optional(),
    limit: z.number().int().min(1).max(20).default(8),
  },
  { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  (args) => asMcpResult(handlers.search_elements(args)),
);

tool(
  "get_element",
  "Get one Awwwards element in full: title, author, built-with stack, media URLs, related elements and the parent award-winning project. Use search_elements first for ids.",
  {
    id: z.string().describe("Element slug from search_elements"),
  },
  { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  (args) => asMcpResult(handlers.get_element(args)),
);

tool(
  "list_categories",
  "List the filter taxonomy available on Awwwards: award collections, color hexes, tag/technology slugs usable with search_sites, and the annual winner categories.",
  {},
  { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  () => asMcpResult(handlers.list_categories()),
);

tool(
  "get_annual_categories",
  "List the official Awwwards Annual Awards categories (Site of the Year, Agency of the Year, …) with nominee counts. Annual Awards only: this is not the daily site index. Annual data comes from Awwwards' official public read-only API for personal, non-commercial inspiration use; nominee details are hydrated on request. Media URLs are reference-only — nothing is downloaded.",
  {},
  { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  () => asMcpResult(handlers.get_annual_categories()),
);

tool(
  "get_annual_nominees",
  "Annual Awards only: list nominees in one official Awwwards Annual Awards category, hydrated on demand at 1 request/second (default 10, max 20 per call). Site summaries carry siteSlug and inLocalIndex, so an agent can jump to get_site_details when the daily index has the site. Personal, non-commercial inspiration use only; media URLs are reference-only and are never downloaded.",
  {
    category: z
      .string()
      .min(1)
      .describe("Category slug from get_annual_categories, e.g. 'site-of-the-year'"),
    limit: z.number().int().min(1).max(20).default(10)
      .describe("Nominees to hydrate in this call (max 20)"),
    offset: z.number().int().min(0).default(0)
      .describe("Zero-based nominee offset within the category"),
    hydrate: z.boolean().default(true)
      .describe("Hydrate uncached nominees (1 req/s); false returns cached entries plus id stubs"),
  },
  { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  (args) => asMcpResult(handlers.get_annual_nominees(args)),
);

tool(
  "get_annual_nominee",
  "Annual Awards only: get one official Awwwards Annual Awards nominee in full: site entries carry date, description, designBy, country, image/video URLs; agency entries carry location, avatar, award tag counts and featured projects. Pass id (a UUID or full /api/annual/nominees/... path) or category+slug; category+slug may hydrate up to 20 uncached nominees at 1 request/second (~20s worst case), so prefer id when known. Personal, non-commercial inspiration use only; media URLs are reference-only and nothing is downloaded.",
  {
    id: z
      .string()
      .min(1)
      .optional()
      .describe("Nominee UUID or full /api/annual/nominees/sites|users/<uuid> path"),
    category: z.string().min(1).optional().describe("Category slug, for slug-based lookup"),
    slug: z.string().min(1).optional().describe("Nominee slug, paired with category"),
  },
  { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  (args) => asMcpResult(handlers.get_annual_nominee(args)),
);

tool(
  "get_collections",
  "Browse Awwwards' curated thematic moodboards, not a search index. Without a slug, lists collections (paginated); with a slug, returns that collection's first page of site cards. Curated slugs look like 'brutalism'; member collections need 'owner/slug'. One page per call, 7-day local cache. Personal, non-commercial inspiration use.",
  {
    slug: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe("Collection slug: 'brutalism' (curated) or 'owner/slug' for a member collection"),
    page: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(1)
      .describe(
        "Collections index page (1-4 live; page > 4 is rejected). With a slug, page N of that collection",
      ),
  },
  { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  (args) => asMcpResult(handlers.get_collections(args)),
);

tool(
  "search_directory",
  "Search the Awwwards directory of agencies/studios, not sites. Filters are path-based, so one of country/category/budget applies per request; query is matched client-side over the fetched page. Returns public profile cards (name, slug, location, website, award counts) — contact details are stripped. One page per call, 7-day local cache. Personal, non-commercial inspiration use.",
  {
    query: z
      .string()
      .max(200)
      .optional()
      .describe("Free text matched client-side against name, location and website"),
    country: z
      .string()
      .max(100)
      .optional()
      .describe("Canonical country name, case-sensitive, e.g. 'United States' or 'United Kingdom'"),
    category: z
      .string()
      .max(100)
      .optional()
      .describe("Category or type slug/label, e.g. 'web-design', 'Agency & Studio', 'freelance'"),
    budget: z
      .string()
      .max(100)
      .optional()
      .describe("Budget filter slug or label, e.g. 'over_hundred_thousand' or 'Over $100,000'"),
    page: z.number().int().min(1).max(100).default(1).describe("Directory page"),
  },
  { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  (args) => asMcpResult(handlers.search_directory(args)),
);

tool(
  "audit_url",
  "Audit any live page as evidence, not a grade: runtime frame/long-task/layout-thrash measurement via an installed Chrome/Edge over raw CDP (no playwright), plus static animation anti-patterns scanned over the page HTML and up to 8 same-origin CSS/JS assets (bounded: 8 assets, 2MB each, 1 request/second shared limiter, default 10s timeouts). Asset refs resolve against the final post-redirect page URL; asset redirects leaving that origin are rejected. Findings are severity-sorted before the 50-item cap, so `worst` is always present. `nextActions` ranks the first three fixes. compact=true returns the url, a reduced perf block (fps, droppedFrames, longTasks, layoutThrashing), pre-cap antiPatterns counts (count, worst, high, medium, info), coverage, nextActions and note; omit it for the full findings and full perf. Degrades honestly - perf carries {error} when no browser is available and the static scan reports its own error; neither suppresses the other. Personal, non-commercial use; audit only URLs you are authorised to inspect.",
  {
    url: z.string().url().describe("Absolute http(s) URL of the page to audit"),
    viewport: z
      .enum(["desktop", "mobile"])
      .default("desktop")
      .describe("Runtime measurement geometry: desktop = 1280x800 (aegon baseline); mobile = 390x844"),
    timeoutMs: z
      .number()
      .int()
      .min(1000)
      .max(30000)
      .default(10000)
      .describe("Per static request timeout in ms (page HTML + each asset)"),
    compact: z
      .boolean()
      .optional()
      .describe("compact=true returns the url, reduced perf, pre-cap antiPatterns counts, coverage, nextActions and note; omit for full findings and full perf"),
  },
  { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  (args) => asMcpResult(handlers.audit_url(args)),
);

tool(
  "analyze_accessibility",
  "Collect accessibility EVIDENCE from a live page — an evidence census, not a compliance audit. Samples up to `limit` (default 100, max 200) visible text nodes with computed colour and a background composited bottom-up from the ancestor stack (colour alpha layers), then the contrast ratio (worst pairs with selector paths). Samples under any ancestor opacity group (<1) are excluded from ratios and counted in coverage.skippedOpacityGroups, never approximated; background images, gradients and pseudo-elements are not composited either, so contrast stays heuristic there. Also: image alt coverage; heading ladder (skipped levels, multiple h1); focusable/positive-tabindex counts plus outline:none stylesheet rules; unlabeled form controls; document lang/title. Result carries coverage and heuristic:true. http(s) URLs only; requires the optional playwright dependency and degrades to {error}. Personal, non-commercial use.",
  {
    url: z.string().url().describe("Absolute http(s) URL of the page to inspect"),
    viewport: viewportSchema,
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .default(100)
      .describe("Text-node sample cap (1-200)"),
  },
  { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  (args) => asMcpResult(handlers.analyze_accessibility(args)),
);

tool(
  "capture_live_site",
  "Take a fresh full-page screenshot of a live website URL using a headless browser. Requires the optional playwright dependency.",
  {
    url: z.string().url().describe("Absolute URL of the site to capture"),
    waitStrategy: waitStrategySchema,
    viewport: viewportSchema,
    inline: z
      .boolean()
      .optional()
      .describe(
        "false omits the inline base64 preview (file is still saved); previews over 2.5MB are omitted automatically",
      ),
  },
  { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  (args) => asMcpResult(handlers.capture_live_site(args)),
);

tool(
  "analyze_page_structure",
  "Extract a page's section band map (tag, label, background color, offset, height per band) via a headless browser. Works on live URLs and file:// paths — use it to compare a reference site's structure against your local build. compare:\"mobile\" also captures at 390×844 and returns mobileBands + diff {heightDelta, bandsAdded, bandsRemoved, reordered} plus responsive evidence: horizontal overflow, small text and small tap targets. cdpEndpoint instead attaches to a browser you started (AWWWARDS_MCP_ATTACH=1) and scans the already-open matching page: it never navigates, scrolls, clicks or creates tabs.",
  {
    url: z.string().url().describe("Absolute URL (https:// or file://) of the page to analyze"),
    maxBands: z.number().int().min(5).max(60).default(40).describe("Cap on returned bands"),
    waitStrategy: waitStrategySchema,
    viewport: viewportSchema,
    compare: z
      .enum(["mobile"])
      .optional()
      .describe("Also capture at 390×844 (mobile): adds mobileBands + diff; if the mobile capture fails you still get the desktop result plus mobileError; absent keeps the desktop response unchanged"),
    cdpEndpoint: z
      .string()
      .optional()
      .describe("Attach to a browser YOU started (requires AWWWARDS_MCP_ATTACH=1): loopback CDP endpoint (http://127.0.0.1:9222, http://[::1]:9222, or ws://127.0.0.1:9222/devtools/browser/<id>; an http endpoint is resolved via /json/version and its ws URL re-validated before connecting). Selects an already-open page whose URL matches exactly — never navigates, scrolls, clicks or creates tabs — and disconnects without closing it. Not available with compare or a non-desktop viewport"),
  },
  { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  (args) => asMcpResult(handlers.analyze_page_structure(args)),
);

tool(
  "record_site_motion",
  "Record a short motion-through video of a live website — preloader, scroll-triggered and hover/cursor animations — and return an inline filmstrip JPEG plus the .webm path. Requires the optional playwright and ffmpeg-static dependencies. Also writes a Motion Evidence Sheet (keyframes with census-stamped captions, diff masks, cursor-trail overlay, timeline strip) beside the filmstrip.",
  {
    url: z.string().url().describe("Absolute URL of the site to record"),
    frames: z
      .number()
      .int()
      .min(4)
      .max(36)
      .default(16)
      .describe("Filmstrip tile count (default 16 → a 4x4 grid)"),
    waitStrategy: waitStrategySchema,
    viewport: viewportSchema,
  },
  { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  (args) => asMcpResult(handlers.record_site_motion(args)),
);

tool(
  "get_motion_dna",
  "Get the Motion DNA of a website: animation stack, ScrollTrigger/pin/scrub counts, easing vocabulary and duration distribution. Live captures append a `censusSummary` block (per-source scroll-census counts) from the same single launch. Serves the corpus first; live-captures unseen URLs (headless browser required).",
  {
    url: z.string().url().describe("Absolute site URL"),
    recapture: z.boolean().default(false).describe("Force a fresh live capture even if a recent record exists"),
  },
  { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  (args) => asMcpResult(handlers.get_motion_dna(args)),
);

tool(
  "analyze_scroll_map",
  "Per-element motion census of a live page: what animates, its CSS properties, duration, delay, easing, and what triggered it (GSAP ScrollTrigger, native CSS scroll()/view() timelines, data attributes, SMIL/SVG). Includes svgStrokes list for stroke draw-in effects. Runs on any URL you give it (builds, references) — does not fetch awwwards.com. Run twice (with reducedMotion) to audit prefers-reduced-motion degradation. Optional scrubProbe drives the page and returns real progress curves per scrubbed trigger. compact=true returns a token-diet summary. Every payload also carries a `choreography` block: stagger hints (hint selector/value/source, groups) distilled from GSAP tween vars and stepped delays across sibling animations.",
  {
    url: z.string().url().describe("Absolute page URL to census"),
    waitStrategy: z.enum(["load", "networkidle"]).optional(),
    viewport: viewportSchema,
    reducedMotion: z.boolean().default(false)
      .describe("Emulate prefers-reduced-motion: reduce for this capture"),
    scrubProbe: z.boolean().optional()
      .describe("drive the page through up to 8 scroll steps and sample each scrubbed trigger's progress curve (adds seconds)"),
    compact: z.boolean().optional()
      .describe("token-diet summary: keyframes/props/durations and scrubCurves replaced by counts; all numerics and triggers stay"),
  },
  { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  (args) => asMcpResult(handlers.analyze_scroll_map(args)),
);

tool(
  "analyze_hover_census",
  ":hover interaction census of a live page: counts hover rules, samples up to 20 interactive elements, and reports which CSS properties change on hover with transition duration and easing. Use it to reproduce micro-interactions and verify interaction-state coverage. On mobile the hover loop is skipped and a note is returned. compact=true returns a token-diet summary. Runs on any URL — does not fetch awwwards.com.",
  {
    url: z.string().url().describe("Absolute page URL to census"),
    // Inline optional enum, not waitStrategySchema: that schema's .default("load")
    // would shadow captureHoverCensus's own networkidle default.
    waitStrategy: z.enum(["load", "networkidle"]).optional(),
    viewport: viewportSchema,
    reducedMotion: z.boolean().default(false)
      .describe("Emulate prefers-reduced-motion: reduce for this capture"),
    compact: z.boolean().optional()
      .describe("token-diet summary: sample style bodies become a selector list + count"),
  },
  { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  (args) => asMcpResult(handlers.analyze_hover_census(args)),
);

tool(
  "analyze_bundle",
  "Bundle forensics for a live page: fetch it once, download its script chunks (script tags, inline scripts, and modulepreload/preload-as-script hints; bounded: ≤40 chunks, 10MB, 1 request/second), save them locally, optionally de-obfuscate with webcrack if installed, and grep keywords across the code. Returns chunk paths + match lines so an agent can read the actual animation mechanism instead of guessing. Opt-in bundleIntel adds route, vendor, source-map presence and module-graph evidence; source maps are detected but never fetched, and default output keys are unchanged. Runs on URLs you are authorized to analyze — does not fetch awwwards.com.",
  {
    url: z.string().url(),
    keywords: z.array(z.string().min(1)).max(20).optional().describe("grep these strings across chunks (e.g. class names, effect names)"),
    maxChunks: z.number().int().min(1).max(100).optional().describe("default 40"),
    walkChunks: z.boolean().optional()
      .describe("after the first pass, follow quoted same-origin .js refs inside fetched chunks and fetch up to 20 newly discovered ones (same budgets; adds seconds)"),
    edges: z.boolean().default(false)
      .describe("static import graph over captured chunks"),
    bundleIntel: z.boolean().default(false)
      .describe("opt-in: quoted routes, vendor signatures, source-map presence (never fetched) and module graph; default output keys unchanged"),
  },
  { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  (args) => asMcpResult(handlers.analyze_bundle(args))
);

tool(
  "analyze_network_capture",
  "Offline API-surface evidence from a local HAR 1.2 file (browser devtools export): groups requests by method + origin + path template (ISO dates, versions, UUIDs, hex ids and numbers templated; emails, tokens and long high-entropy segments redacted), with counts, statuses, content types and query names only. Reads the file only — never fetches recorded URLs, never returns bodies, headers or query values. No network.",
  {
    path: z.string().min(1).describe("Local path to a HAR 1.2 file"),
    top: z.number().int().min(1).max(200).optional()
      .describe("Max groups after sorting (default 50, max 200)"),
  },
  { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  (args) => asMcpResult(handlers.analyze_network_capture(args)),
);

registerTool(
  "verify_flow",
  {
    description:
      "Step-aligned comparison of interaction flows: runs the same 1–6 scroll/click/wait steps on a build and a reference page (two fresh headless launches, desktop or mobile), then compares path, scroll delta, skeleton hash, text hash and element count after each step. A step is same only when both sides are complete and untruncated; truncated or failed states are unknown. No screenshots: hashes are evidence, not visual truth. A click can still trigger client-side mutations. Runs on URLs you are authorized to inspect.",
    inputSchema: verifyFlowArgsSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  (args) => asMcpResult(handlers.verify_flow(args)),
);

tool(
  "build_project",
  "Convert a single-file exact rebuild (any local .html, e.g. the rebuild flow's full-page-exact.html) into a runnable Vite, Astro or Next.js project: sections become components, CSS splits per section, gsap timelines re-wire in the framework idiom (useEffect + gsap.context on Next), assets carried. Reads a local file and writes the project dir. Pairs with verify_build: build → convert → verify.",
  {
    htmlPath: z.string().describe("Local path to the single-file rebuild html to convert"),
    target: z.enum(["vite", "astro", "next"]).describe("Framework of the generated project"),
    out: z.string().describe("Directory to scaffold the project into (created as needed)"),
    name: z.string().optional().describe("package.json name (default rebuild-site)"),
  },
  // First local-write tool in the suite, on purpose: it reads a local html and
  // scaffolds a project directory — no awwwards.com traffic, nothing remote.
  { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  (args) => asMcpResult(handlers.build_project(args)),
);

tool(
  "verify_build",
  "Compare a built site against a reference (an Awwwards winner, a client's old site, any URL): band-structure match + motion fingerprint similarity, with a pass/warn/fail verdict and evidence lines. compact=true returns the verdict, overall and band scores, band counts (matched, refOnly, buildOnly) and motion score; omit it for evidence lines. Closes the design loop: build → verify → fix → re-verify. Reference can be an award site found via search_sites, compared read-only via compare_sites.",
  {
    buildUrl: z.string().url().describe("URL of the build to verify"),
    referenceUrl: z.string().url().describe("URL of the reference site to match"),
    // Inline optional enum, not waitStrategySchema: that schema's .default("load")
    // would shadow the orchestrator's networkidle scroll-census default.
    waitStrategy: z.enum(["load", "networkidle"]).optional(),
    viewport: viewportSchema,
    domDiff: z.boolean().default(false)
      .describe("body-subtree structural diff between reference and build"),
    compact: z
      .boolean()
      .optional()
      .describe("compact=true returns the verdict, overall and band scores, band counts and motion score; omit for evidence lines"),
  },
  { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  (args) => asMcpResult(handlers.verify_build(args)),
);

tool(
  "capture_component",
  "Serialize a page component (structure, computed-style tokens, animations) into a portable pack for rebuild tooling. Adds typography usage summaries (families/sizes/weights/line-heights/letter-spacings, top 12 each + sampled node count) and paletteSummary (colour counts from node styles + pack colors, transparent/rgba(0,0,0,0)/none filtered, top 24). compact=true returns a token-diet summary and omits both. Runs on any URL — does not fetch awwwards.com.",
  {
    url: z.string().url().describe("Absolute page URL whose component to serialize"),
    selector: z
      .string()
      .min(1)
      .optional()
      .describe("CSS selector of the component root (default 'header')"),
    maxNodes: z.number().int().min(50).max(2000).optional()
      .describe("Max DOM nodes to serialize (default 400, clamp 50-2000)"),
    viewport: viewportSchema,
    compact: z.boolean().optional()
      .describe("token-diet summary: node styles/text/svg/anims and the typography/paletteSummary blocks are dropped; the {tag, classes, rect} tree, fonts and colors stay"),
  },
  { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  (args) => asMcpResult(handlers.capture_component(args)),
);

tool(
  "capture_pose_3d",
  "Capture a page's WebGL/canvas 3D pose grid: samples the largest canvas (toDataURL, viewport-screenshot fallback) at up to 10 scroll steps with per-step scroll ratios, for reconstructing scroll-driven 3D camera paths. Runs on any URL — does not fetch awwwards.com. Requires the optional playwright dependency.",
  {
    url: z.string().url().describe("Absolute page URL to capture (https:// or file://)"),
    steps: z.number().int().min(3).max(10).optional()
      .describe("Scroll samples across the page (default 6)"),
    viewport: viewportSchema,
  },
  { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  (args) => asMcpResult(handlers.capture_pose_3d(args)),
);

tool(
  "build_pose_stub",
  "Render a captured pose grid (pose-grid-v1 from capture_pose_3d) as a standalone scroll-scrubbed three.js stub page: frames preloaded inline, camera path interpolated between snapshot scroll ratios, prefers-reduced-motion static fallback, optional census-derived st/pin/ease suggestions. Pure build — no page fetches, no awwwards.com access.",
  {
    poseGrid: z.any().describe("PoseGrid object as returned by capture_pose_3d (id pose-grid-v1)"),
    scrollCensus: z.any().optional()
      .describe("Optional ScrollCensus from analyze_scroll_map — adds suggestion notes + comment hints"),
  },
  { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  (args) => asMcpResult(handlers.build_pose_stub(args)),
);

tool(
  "analyze_stack",
  "Fingerprint a page's framework (Next.js/Astro/Nuxt/Remix/SvelteKit/WordPress/Webflow/Framer), CSS framework (Tailwind/Bootstrap), and marker libs from fetched HTML — runs on any URL, one polite request, no browser",
  {
    url: z.string().url().describe("Page URL to fetch and fingerprint"),
    timeoutMs: z.number().int().min(1000).max(30000).optional().describe("Fetch timeout in ms (default 15000)"),
  },
  { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  (args) => asMcpResult(handlers.analyze_stack(args)),
);

tool(
  "build_gsap_stub",
  "Generate a runnable GSAP+ScrollTrigger timeline stub from captured motion evidence (scroll census anims + optional pose grid camera anchors) — pure build from provided JSON, no page fetches",
  { scrollCensus: z.any().describe("ScrollCensus JSON from analyze_scroll_map"), poseGrid: z.any().optional().describe("PoseGrid JSON from capture_pose_3d (adds scroll-driven camera module)") },
  { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  (args) => asMcpResult(handlers.build_gsap_stub(args)),
);

tool(
  "build_motion_manifest",
  "Build a motion.manifest.json scaffold from measured evidence: an analyze_page_structure result (bands) + an analyze_scroll_map census, with optional section overrides. Sections are mapped best-effort from each band's tag + first #id/.class token in its label (or sections[].selector) — no markup is available, so DOM initial-state hints are empty; census triggers still attribute to sections by those tokens. Returns { manifest, measured:false, censusAnims, warnings, note }; manifest.measured stays false when the census has no anims/triggers/curves. Never throws ({ error } on invalid input). Pure/offline — no page fetches.",
  {
    bands: z.any().describe("analyze_page_structure result object (must carry bands[])"),
    scrollCensus: z.any().describe("analyze_scroll_map result object (anims[] + gsapTriggers[] required)"),
    sections: z
      .array(z.object({ label: z.string().min(1), selector: z.string().optional() }))
      .max(60)
      .optional()
      .describe("Optional section overrides in build order; selector supplies the #id/.class tokens instead of the band label"),
  },
  { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  (args) => asMcpResult(handlers.build_motion_manifest(args)),
);

tool(
  "search_motion",
  "Search captured Motion DNA records: find sites that pin sections, scrub scroll-driven animation, or run a given animation library. Corpus only — live-capture happens via get_motion_dna.",
  {
    lib: z.string().describe("Library token, e.g. 'gsap', 'lenis', 'webgl'").optional(),
    scrubOnly: z.boolean().default(false).describe("Only sites with substantial scroll-scrubbed animation"),
    hasPins: z.boolean().default(false).describe("Only sites that pin sections"),
    limit: z.number().int().min(1).max(50).default(20),
  },
  { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  (args) => asMcpResult(handlers.search_motion(args)),
);

tool(
  "new_winners",
  "Poll today's new Awwwards winners as a delta against the previous poll: new-entrant cards since the last call (first call seeds the baseline and reports no delta). Poll daily for a winners feed; pairs with watch_site for structured monitoring.",
  {
    award: z.enum(["sotd", "developer", "honorable"]).default("sotd")
      .describe("Which winners feed to poll"),
  },
  // Writes the poll baseline, so results change the next call — not idempotent.
  { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  (args) => asMcpResult(handlers.new_winners(args)),
);

tool(
  "watch_site",
  "Longitudinal watchlist over Awwwards listings: track a studio (e.g. 'ToyFight'), a tag/technology slug (e.g. 'webgl'), or a site URL-slug for changes and new entries. add/list/remove; the delta is reported by watch_site list after new_winners or search_sites refreshes the listing.",
  {
    action: z.enum(["add", "list", "remove"]),
    kind: z.enum(["studio", "tag", "url"]).optional()
      .describe("studio = creator name from listing cards; tag = tag/technology slug; url = a /sites/<slug> site-slug"),
    pattern: z.string().optional().describe("What to watch (name/slug per kind)"),
    award: z.enum(["sotd", "developer", "honorable"]).optional()
      .describe("Restrict a watch to one award feed"),
    note: z.string().optional().describe("Why you're watching (free text)"),
  },
  // add/remove mutate the watchlist, so the tool as a whole is not read-only.
  { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  (args) => asMcpResult(handlers.watch_site(args)),
);

// Auto-refresh: if the index is stale (or absent) and no crawl is running,
// re-index in the background. Serving is never blocked; errors are stderr-only.
if (shouldAutoIndex(cache)) {
  void runIndexer({ client, cache, log: (m) => console.error(m) }).catch((err) => {
    console.error(
      `awwwards-mcp: background index failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  });
}

// Update notice: once a day, compare against the npm registry; stderr-only,
// never blocks serving. AWWWARDS_AUTO_UPDATE=1 opts into background install.
checkForUpdate(pkgJson.version);

// Environment notice: once a day, verify playwright/ffmpeg are usable from
// the server's own install (a real chromium launch, not just an import) and
// hint at the optional webcrack bundle-de-obfuscation dep; stderr-only,
// never blocks serving.
checkEnvironment();

await server.connect(new StdioServerTransport());
