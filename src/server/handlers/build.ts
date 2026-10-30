import { existsSync } from "node:fs";
import { buildGsapStub } from "../../gsap-stub.js";
import { scaffoldMotionManifest } from "../../motion-manifest.js";
import type { PoseGrid } from "../../pose3d.js";
import { buildPoseStubHtml, poseSuggestions } from "../../pose-stub.js";
import type { ScrollCensus } from "../../census.js";
import type { HandlerContext } from "../context.js";
import { errorResponse, text } from "../types.js";
import type { ToolResponse } from "../types.js";

export async function build_pose_stub(ctx: HandlerContext, args: {
  poseGrid: PoseGrid;
  scrollCensus?: ScrollCensus;
}): Promise<ToolResponse> {
  try {
    // Snapshot schemas may drift; only grids stamped pose-grid-v1 build.
    if (args.poseGrid?.id !== "pose-grid-v1") {
      return {
        content: [
          text("poseGrid.id must be \"pose-grid-v1\" - re-capture with the pose-capture tool."),
        ],
        isError: true,
      };
    }
    const build =
      ctx.deps.poseStubFn ??
      ((grid: PoseGrid, census?: ScrollCensus) => ({
        stubHtml: buildPoseStubHtml(grid, { scrollCensus: census }),
        notes: [
          `steps=${grid.steps}`,
          `canvas=${grid.canvasW}x${grid.canvasH}`,
          ...(census
            ? (() => {
                const s = poseSuggestions(census);
                return [
                  `suggestions(st)=${s.st}`,
                  `suggestions(pin)=${s.pin}`,
                  `suggestions(ease)=${s.ease.length}`,
                ];
              })()
            : []),
        ],
      }));
    return { content: [text(JSON.stringify(build(args.poseGrid, args.scrollCensus), null, 1))] };
  } catch (err) {
    return errorResponse(err);
  }
}

export async function analyze_stack(ctx: HandlerContext, args: {
  url: string;
  timeoutMs?: number;
}): Promise<ToolResponse> {
  try {
    // Lazy default: the fetch orchestrator is only touched when the tool runs.
    const analyze =
      ctx.deps.stackFn ??
      ((url: string, opts?: { timeoutMs?: number }) =>
        import("../../stack.js").then((m) => m.analyzeStack(url, opts)));
    const result = await analyze(args.url, { timeoutMs: args.timeoutMs });
    if ("error" in result) return { content: [text(result.error)], isError: true };
    return { content: [text(JSON.stringify(result, null, 1))] };
  } catch (err) {
    return errorResponse(err);
  }
}

export async function build_gsap_stub(ctx: HandlerContext, args: {
  scrollCensus: unknown;
  poseGrid?: unknown;
}): Promise<ToolResponse> {
  try {
    const build =
      ctx.deps.gsapStubFn ??
      ((a: { scrollCensus: unknown; poseGrid?: unknown }) => ({
        stubHtml: buildGsapStub(a.poseGrid, a.scrollCensus),
      }));
    return { content: [text(JSON.stringify(build(args), null, 1))] };
  } catch (err) {
    return errorResponse(err);
  }
}

export async function build_motion_manifest(ctx: HandlerContext, args: {
  bands: unknown;
  scrollCensus: unknown;
  sections?: { label: string; selector?: string }[];
}): Promise<ToolResponse> {
  try {
    const result = scaffoldMotionManifest(args);
    if ("error" in result) {
      return { content: [text(JSON.stringify(result))], isError: true };
    }
    return { content: [text(JSON.stringify(result, null, 1))] };
  } catch (err) {
    return errorResponse(err);
  }
}

// build_project: converts a LOCAL single-file rebuild into a runnable
// project tree by delegating to the buildProject core (bin shares it).
export async function build_project(ctx: HandlerContext, args: { htmlPath: string; target: "vite" | "astro" | "next"; out: string; name?: string }): Promise<ToolResponse> {
  try {
    if (!existsSync(args.htmlPath)) {
      return { content: [text(`htmlPath does not exist: ${args.htmlPath}`)], isError: true };
    }
    const build =
      ctx.deps.buildProjectFn ??
      ((a: { html: string; target: "vite" | "astro" | "next"; out: string; name?: string }) =>
        import("../../build-project.js").then((m) => m.buildProject(a)));
    const result = await build({
      html: args.htmlPath,
      target: args.target,
      out: args.out,
      ...(args.name ? { name: args.name } : {}),
    });
    if ("error" in result) return { content: [text(result.error)], isError: true };
    return { content: [text(JSON.stringify(result, null, 1))] };
  } catch (err) {
    return errorResponse(err);
  }
}
