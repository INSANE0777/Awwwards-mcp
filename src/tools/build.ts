import { z } from "zod";
import { asMcpResult, type ToolContext } from "./shared.js";

export function registerBuildProject(ctx: ToolContext): void {
  ctx.tool(
    "build_project",
    "Convert a single-file exact rebuild (any local .html, e.g. the rebuild flow's full-page-exact.html) into a runnable Vite, Astro or Next.js project: sections become components, CSS splits per section, gsap timelines re-wire in the framework idiom (useEffect + gsap.context on Next), assets carried. Reads a local file and writes the project dir. The output is source, not a servable site: install and build it (npm install && npm run build) and serve the generated output (Vite/Astro dist, Next .next with next start), not the raw scaffold directory. Pairs with verify_build: build → convert → verify.",
    {
      htmlPath: z.string().describe("Local path to the single-file rebuild html to convert"),
      target: z.enum(["vite", "astro", "next"]).describe("Framework of the generated project"),
      out: z.string().describe("Directory to scaffold the project into (created as needed)"),
      name: z.string().optional().describe("package.json name (default rebuild-site)"),
    },
    // First local-write tool in the suite, on purpose: it reads a local html and
    // scaffolds a project directory — no awwwards.com traffic, nothing remote.
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    (args: any) => asMcpResult(ctx.handlers.build_project(args)),
  );
}

export function registerBuildPoseStub(ctx: ToolContext): void {
  ctx.tool(
    "build_pose_stub",
    "Render a captured pose grid (pose-grid-v1 from capture_pose_3d) as a standalone scroll-scrubbed three.js stub page: frames preloaded inline, camera path interpolated between snapshot scroll ratios, prefers-reduced-motion static fallback, optional census-derived st/pin/ease suggestions. Pure build — no page fetches, no awwwards.com access.",
    {
      poseGrid: z.any().describe("PoseGrid object as returned by capture_pose_3d (id pose-grid-v1)"),
      scrollCensus: z.any().optional()
        .describe("Optional ScrollCensus from analyze_scroll_map — adds suggestion notes + comment hints"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    (args: any) => asMcpResult(ctx.handlers.build_pose_stub(args)),
  );
}

export function registerBuildGsapStub(ctx: ToolContext): void {
  ctx.tool(
    "build_gsap_stub",
    "Generate a runnable GSAP+ScrollTrigger timeline stub from captured motion evidence (scroll census anims + optional pose grid camera anchors) — pure build from provided JSON, no page fetches",
    { scrollCensus: z.any().describe("Full ScrollCensus JSON from analyze_scroll_map (anims[] + gsapTriggers[] required; compact output is rejected)"), poseGrid: z.any().optional().describe("PoseGrid JSON from capture_pose_3d (adds scroll-driven camera module)") },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    (args: any) => asMcpResult(ctx.handlers.build_gsap_stub(args)),
  );
}

export function registerBuildMotionManifest(ctx: ToolContext): void {
  ctx.tool(
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
    (args: any) => asMcpResult(ctx.handlers.build_motion_manifest(args)),
  );
}

export function registerAnalyzeStack(ctx: ToolContext): void {
  ctx.tool(
    "analyze_stack",
    "Fingerprint a page's framework (Next.js/Astro/Nuxt/Remix/SvelteKit/WordPress/Webflow/Framer), CSS framework (Tailwind/Bootstrap), and marker libs from fetched HTML — runs on any URL, one polite request, no browser",
    {
      url: z.string().url().describe("Page URL to fetch and fingerprint"),
      timeoutMs: z.number().int().min(1000).max(30000).optional().describe("Fetch timeout in ms (default 15000)"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    (args: any) => asMcpResult(ctx.handlers.analyze_stack(args)),
  );
}

export function registerGetMotionDna(ctx: ToolContext): void {
  ctx.tool(
    "get_motion_dna",
    "Get the Motion DNA of a website: animation stack, ScrollTrigger/pin/scrub counts, easing vocabulary and duration distribution. Live captures append a `censusSummary` block (per-source scroll-census counts) from the same single launch. Serves the corpus first; live-captures unseen URLs (headless browser required).",
    {
      url: z.string().url().describe("Absolute site URL"),
      recapture: z.boolean().default(false).describe("Force a fresh live capture even if a recent record exists"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    (args: any) => asMcpResult(ctx.handlers.get_motion_dna(args)),
  );
}

export function registerSearchMotion(ctx: ToolContext): void {
  ctx.tool(
    "search_motion",
    "Search captured Motion DNA records: find sites that pin sections, scrub scroll-driven animation, or run a given animation library. Corpus only — live-capture happens via get_motion_dna.",
    {
      lib: z.string().describe("Library token, e.g. 'gsap', 'lenis', 'webgl'").optional(),
      scrubOnly: z.boolean().default(false).describe("Only sites with substantial scroll-scrubbed animation"),
      hasPins: z.boolean().default(false).describe("Only sites that pin sections"),
      limit: z.number().int().min(1).max(50).default(20)
        .describe("Max records to return (1-50, default 20)"),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    (args: any) => asMcpResult(ctx.handlers.search_motion(args)),
  );
}
