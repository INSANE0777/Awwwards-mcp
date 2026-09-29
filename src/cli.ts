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
import { AwwwardsClient } from "./awwwards.js";
import { Cache } from "./cache.js";
import { createHandlers, type ToolResponse } from "./server.js";
import { captureLiveSite } from "./capture.js";
import { runIndexer, shouldAutoIndex } from "./indexer.js";
import { checkForUpdate } from "./version-check.js";

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
const client = new AwwwardsClient();
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

server.tool(
  "search_sites",
  "Search award-winning websites on Awwwards. Returns site cards with inline screenshots, live URLs, awards and tags.",
  {
    query: z.string().describe("Free text matched against site titles and tags").optional(),
    color: z
      .string()
      .regex(/^#?[0-9A-Fa-f]{6}$/)
      .describe("Dominant color hex, e.g. '#404040'")
      .optional(),
    tags: z.array(z.string()).describe("Tag slugs, e.g. ['3d', 'portfolio']").optional(),
    technology: z.string().describe("Technology slug, e.g. 'webgl', 'gsap', 'astro'").optional(),
    award: z.enum(["sotd", "developer", "honorable"]).optional(),
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
  (args) => asMcpResult(handlers.search_sites(args)),
);

server.tool(
  "get_site_details",
  "Get the design DNA of one Awwwards site: color palette, technologies, design elements, awards, description and inline screenshot.",
  {
    slug: z
      .string()
      .regex(/^[\w-]+$/)
      .describe("Site slug from search_sites, e.g. 'l-i-s-a'"),
  },
  (args) => asMcpResult(handlers.get_site_details(args)),
);

server.tool(
  "compare_sites",
  "Compare the design DNA of 2–3 Awwwards sites: titles, live URLs, palettes, technologies, elements, awards and jury scores. Text only; missing details are fetched and cached.",
  {
    slugs: z.array(z.string().regex(/^[\w-]+$/)).min(2).max(3)
      .refine((slugs) => new Set(slugs.map((slug) => slug.toLowerCase())).size === slugs.length, "Site slugs must be distinct")
      .describe("Two or three distinct site slugs from search_sites"),
  },
  (args) => asMcpResult(handlers.compare_sites(args)),
);

server.tool(
  "get_index_status",
  "Read offline index status: cached site count, progress, last successful finish and error, lock state and freshness. No live requests.",
  {},
  () => asMcpResult(handlers.get_index_status()),
);

server.tool(
  "get_site_elements",
  "Get the design-element highlights of one Awwwards site: component-level visuals (3D models, video content, mobile layouts, microcopy) with poster images inline and video URLs.",
  {
    slug: z
      .string()
      .regex(/^[\w-]+$/)
      .describe("Site slug from search_sites, e.g. 'l-i-s-a'"),
  },
  (args) => asMcpResult(handlers.get_site_elements(args)),
);

server.tool(
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
  { readOnlyHint: true },
  (args) => asMcpResult(handlers.search_elements(args)),
);

server.tool(
  "get_element",
  "Get one Awwwards element in full: title, author, built-with stack, media URLs, related elements and the parent award-winning project. Use search_elements first for ids.",
  {
    id: z.string().describe("Element slug from search_elements"),
  },
  { readOnlyHint: true },
  (args) => asMcpResult(handlers.get_element(args)),
);

server.tool(
  "list_categories",
  "List the filter taxonomy available on Awwwards: color hexes and tag/technology slugs usable with search_sites.",
  {},
  () => asMcpResult(handlers.list_categories()),
);

server.tool(
  "capture_live_site",
  "Take a fresh full-page screenshot of a live website URL using a headless browser. Requires the optional playwright dependency.",
  {
    url: z.string().url().describe("Absolute URL of the site to capture"),
    waitStrategy: waitStrategySchema,
    viewport: viewportSchema,
  },
  (args) => asMcpResult(handlers.capture_live_site(args)),
);

server.tool(
  "analyze_page_structure",
  "Extract a page's section band map (tag, label, background color, offset, height per band) via a headless browser. Works on live URLs and file:// paths — use it to compare a reference site's structure against your local build.",
  {
    url: z.string().url().describe("Absolute URL (https:// or file://) of the page to analyze"),
    maxBands: z.number().int().min(5).max(60).default(40).describe("Cap on returned bands"),
    waitStrategy: waitStrategySchema,
    viewport: viewportSchema,
  },
  (args) => asMcpResult(handlers.analyze_page_structure(args)),
);

server.tool(
  "record_site_motion",
  "Record a short motion-through video of a live website — preloader, scroll-triggered and hover/cursor animations — and return an inline filmstrip JPEG plus the .webm path. Requires the optional playwright and ffmpeg-static dependencies.",
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
  (args) => asMcpResult(handlers.record_site_motion(args)),
);

server.tool(
  "get_motion_dna",
  "Get the Motion DNA of a website: animation stack, ScrollTrigger/pin/scrub counts, easing vocabulary and duration distribution. Serves the corpus first; live-captures unseen URLs (headless browser required).",
  {
    url: z.string().url().describe("Absolute site URL"),
    recapture: z.boolean().default(false).describe("Force a fresh live capture even if a recent record exists"),
  },
  { readOnlyHint: true },
  (args) => asMcpResult(handlers.get_motion_dna(args)),
);

server.tool(
  "search_motion",
  "Search captured Motion DNA records: find sites that pin sections, scrub scroll-driven animation, or run a given animation library. Corpus only — live-capture happens via get_motion_dna.",
  {
    lib: z.string().describe("Library token, e.g. 'gsap', 'lenis', 'webgl'").optional(),
    scrubOnly: z.boolean().default(false).describe("Only sites with substantial scroll-scrubbed animation"),
    hasPins: z.boolean().default(false).describe("Only sites that pin sections"),
    limit: z.number().int().min(1).max(50).default(20),
  },
  { readOnlyHint: true },
  (args) => asMcpResult(handlers.search_motion(args)),
);

server.tool(
  "new_winners",
  "Poll today's new Awwwards winners as a delta against the previous poll: new-entrant cards since the last call (first call seeds the baseline and reports no delta). Poll daily for a winners feed; pairs with watch_site for structured monitoring.",
  {
    award: z.enum(["sotd", "developer", "honorable"]).default("sotd")
      .describe("Which winners feed to poll"),
  },
  { readOnlyHint: true },
  (args) => asMcpResult(handlers.new_winners(args)),
);

server.tool(
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

await server.connect(new StdioServerTransport());
