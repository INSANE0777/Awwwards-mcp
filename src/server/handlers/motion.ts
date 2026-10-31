import { choreographyFromCensus } from "../../choreography.js";
import type { WaitStrategy } from "../../structure.js";
import type { MotionDna } from "../../types.js";
import { compactScrollCensus } from "../../verify-build.js";
import type { ViewportName } from "../../viewport.js";
import type { HandlerContext } from "../context.js";
import { MOTION_DNA_TTL_MS, errorResponse, text } from "../types.js";
import type { ToolResponse } from "../types.js";

export async function analyze_scroll_map(ctx: HandlerContext, args: {
  url: string;
  waitStrategy?: WaitStrategy;
  viewport?: ViewportName;
  reducedMotion?: boolean;
  scrubProbe?: boolean;
  compact?: boolean;
}): Promise<ToolResponse> {
  try {
    // Lazy default: playwright is only touched when the tool actually runs.
    const capture =
      ctx.deps.scrollMapFn ??
      ((url: string, opts?: {
        waitStrategy?: WaitStrategy;
        viewport?: ViewportName;
        reducedMotion?: boolean;
        scrubProbe?: boolean;
      }) =>
        import("../../census.js").then((m) => m.captureScrollCensus(url, opts)));
    const result = await capture(args.url, {
      waitStrategy: args.waitStrategy,
      viewport: args.viewport ?? "desktop",
      reducedMotion: args.reducedMotion,
      scrubProbe: args.scrubProbe,
    });
    if ("error" in result) return { content: [text(result.error)], isError: true };
    // L4 additive key: stagger hints distilled from the census. The census
    // itself is serialized unchanged, wrapped with `choreography` — composed
    // regardless of scrubProbe and reads existing fields only.
    const choreography = choreographyFromCensus(result);
    // C3: compact=true swaps the census payload for the token-diet summary;
    // the handler-composed choreography block still ships (its hints are
    // top-level trigger info the diet keeps).
    const census = args.compact ? compactScrollCensus(result) : result;
    return { content: [text(JSON.stringify({ ...census, choreography }, null, 1))] };
  } catch (err) {
    return errorResponse(err);
  }
}

export async function record_site_motion(ctx: HandlerContext, args: {
  url: string;
  frames?: number;
  waitStrategy?: WaitStrategy;
  viewport?: ViewportName;
}): Promise<ToolResponse> {
  try {
    // Lazy default: playwright/ffmpeg are only touched when the tool runs.
    // The default forwards motionOpts wholesale, so waitStrategy and viewport
    // flow into recordSiteMotion's MotionOpts (which already accepts both).
    const motion =
      ctx.deps.motionFn ??
      ((
        url: string,
        motionOpts: {
          cacheImagesDir: string;
          frames?: number;
          waitStrategy?: WaitStrategy;
          viewport?: ViewportName;
        },
      ) => import("../../motion.js").then((m) => m.recordSiteMotion(url, motionOpts)));
    const result = await motion(args.url, {
      cacheImagesDir: ctx.cache.imagesDir,
      frames: args.frames,
      waitStrategy: args.waitStrategy,
      viewport: args.viewport ?? "desktop",
    });
    if ("error" in result) return { content: [text(result.error)], isError: true };
    // Undefined-checks, not `in`: sheet keys may be present-with-undefined.
    const parts = [`Motion recording saved to ${result.file}`];
    if (result.sheetError !== undefined) {
      parts.push(` (motion sheet failed: ${result.sheetError})`);
    } else if (result.sheet) {
      parts.push(
        ` — motion sheet: ${result.sheet.htmlPath} + ${result.sheet.mdPath} (${result.sheet.keyframes} keyframes, ${result.sheet.masks} masks)`,
      );
    }
    return {
      content: [text(parts.join("")), { type: "image", data: result.base64, mimeType: "image/jpeg" }],
    };
  } catch (err) {
    return errorResponse(err);
  }
}

// Pre-change cache rows (old captureMotionDna, or the first unified summaries)
// carry no censusSummary.gsapRegistryCount; serving one warm would omit the
// new diagnostic, so it counts as a miss and is recaptured once.
function hasCensusRegistryCount(dna: MotionDna): boolean {
  const summary = (dna as { censusSummary?: { gsapRegistryCount?: unknown } }).censusSummary;
  return (
    !!summary &&
    typeof summary.gsapRegistryCount === "number" &&
    Number.isFinite(summary.gsapRegistryCount)
  );
}

export async function get_motion_dna(ctx: HandlerContext, args: { url: string; recapture?: boolean }): Promise<ToolResponse> {
  try {
    const cached = args.recapture ? null : ctx.cache.getMotionDna(args.url);
    if (cached && Date.now() - cached.capturedAt < MOTION_DNA_TTL_MS && hasCensusRegistryCount(cached)) {
      return { content: [text(JSON.stringify(cached, null, 1))] };
    }
    // C2: lazy default switched to the single-launch orchestrator (the old
    // captureMotionDna stays exported for compat / kit callers).
    const capture =
      ctx.deps.motionDnaFn ??
      ((url: string, opts?: { waitStrategy?: WaitStrategy; viewport?: ViewportName; reducedMotion?: boolean }) =>
        import("../../motion-dna.js").then((m) => m.captureMotionDnaUnified(url, opts)));
    const dna = await capture(args.url, { viewport: "desktop" });
    ctx.cache.upsertMotionDna(dna);
    return { content: [text(JSON.stringify(dna, null, 1))] };
  } catch (err) {
    return errorResponse(err);
  }
}

// Compact payloads only: the full record lives in the corpus under its url.
export async function search_motion(ctx: HandlerContext, args: {
  lib?: string;
  scrubOnly?: boolean;
  hasPins?: boolean;
  limit?: number;
}): Promise<ToolResponse> {
  try {
    const hits = ctx.cache
      .searchMotion(args)
      .slice(0, args.limit ?? 20)
      .map((d) => ({
        url: d.url,
        libs: d.stack.libs,
        scrollModel: d.stack.scrollModel,
        triggerCount: d.scroll.triggerCount,
        scrubCount: d.scroll.scrubCount,
        pinCount: d.scroll.pinCount,
        topEasing: d.easingVocab[0]?.token ?? null,
      }));
    return { content: [text(JSON.stringify({ count: hits.length, results: hits }, null, 1))] };
  } catch (err) {
    return errorResponse(err);
  }
}
