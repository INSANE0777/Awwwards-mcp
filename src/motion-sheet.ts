// Evidence sheet for a motion recording (consumes recordSiteMotion's
// `timeline`): keyframes at phase-kind transitions, pairwise difference
// masks, an onion composite, a video→document (motion-sheet.md) and a static
// HTML sheet with a pure-CSS timeline strip. All ffmpeg goes through an
// injected fn (default: generic arg-list spawn below); failure throws so the
// caller can degrade to the already-returned filmstrip.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { MOTION_FFMPEG_HINT, type MotionTimeline } from "./motion.js";

export interface SheetCtx {
  url: string;
  // collectTimeline:false recordings carry `timeline: undefined` — always
  // undefined-check, never `in` (Task 1 note).
  timeline?: MotionTimeline;
  totalHeight?: number;
}

export interface SheetOpts {
  // Generic arg-list ffmpeg invocation; default spawns the real binary
  // (runFfmpegArgs below) with the house 60s deadline.
  ffmpegFn?: (bin: string, args: string[]) => Promise<void>;
  // Explicit ffmpeg binary path; null → throws the install hint. Default:
  // dynamic import("ffmpeg-static")'s default-export binary path.
  ffmpegPath?: string | null;
  outDir?: string; // default: same dir as the video
}

export interface SheetResult {
  htmlPath: string;
  mdPath: string;
  keyframes: number;
  masks: number;
  keyframeFiles: string[];
  maskFiles: string[];
}

type PhaseKind = MotionTimeline["phases"][number]["kind"];

const FFMPEG_TIMEOUT_MS = 60_000;
const MAX_KEYFRAMES = 9;
const SAMPLE_S = 4; // undefined-timeline cadence: the filmstrip's fps=1/4
const TILE_W = 720;
// Tile-cell height GUESS: the desktop recording canvas is 1440×900, so a
// 720-wide tile is 450 tall. Trail/overlay math assumes it (stated in the md).
const TILE_H = 450;

const EXPECTED: Record<PhaseKind, string> = {
  dwell: "entrance / idle",
  scroll: "scroll-triggered section",
  hover: "hover transition on target",
  click: "click feedback",
  return: "scroll-back to top",
};
const KIND_COLOR: Record<PhaseKind, string> = {
  dwell: "#4a90d9",
  scroll: "#43a35f",
  hover: "#d99a3d",
  click: "#d94f4f",
  return: "#8f6ad9",
};

// Default ffmpeg invocation: the house spawn+deadline pattern from
// motion.ts's runFfmpeg, generalized to any arg-list. A hung ffmpeg (wedged
// pipe, dead filesystem) is killed so the tool call never hangs forever.
export async function runFfmpegArgs(bin: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, { stdio: "ignore", windowsHide: true });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`ffmpeg timed out after ${FFMPEG_TIMEOUT_MS / 1000}s`));
    }, FFMPEG_TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err); // spawn failure (missing binary, ...)
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`));
    });
  });
}

// Collapse the phase list into kind-runs (consecutive same-kind phases merge —
// goto+preloader produce two dwells back-to-back) and track the scroll offset
// at each run's first frame (scrolls update it; the return pass resets to 0).
interface Run {
  kind: PhaseKind;
  startMs: number;
  scrollY: number;
  // Last scrollY inside a scroll run — where the page ends up (drives the
  // offset inherited by following runs; `scrollY` itself stays the first
  // phase's target, which is what the run's first keyframe shows).
  endScrollY: number;
  target: { x: number; y: number } | null;
}

function collapseRuns(tl: MotionTimeline): Run[] {
  const runs: Run[] = [];
  for (const p of tl.phases) {
    const last = runs[runs.length - 1];
    if (last && last.kind === p.kind) {
      if (p.scrollY !== undefined) last.endScrollY = p.scrollY;
    } else {
      runs.push({
        kind: p.kind,
        startMs: p.startMs,
        scrollY: p.scrollY ?? 0,
        endScrollY: p.scrollY ?? 0,
        target: p.targetX !== undefined && p.targetY !== undefined ? { x: p.targetX, y: p.targetY } : null,
      });
    }
  }
  let cur = 0;
  for (const r of runs) {
    if (r.kind === "scroll") cur = r.endScrollY;
    else if (r.kind === "return") cur = 0;
    else r.scrollY = cur;
  }
  return runs;
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function buildMotionSheet(video: string, ctx: SheetCtx, opts: SheetOpts = {}): Promise<SheetResult> {
  let bin: string | null = null;
  if (opts.ffmpegPath !== undefined) {
    bin = opts.ffmpegPath;
  } else {
    try {
      // "as string" keeps ffmpeg-static an unresolved optional dependency at
      // compile time (mirrors motion.ts); Node resolves it at runtime.
      const mod: any = await import("ffmpeg-static" as string);
      bin = mod?.default ?? mod;
    } catch {
      bin = null;
    }
  }
  if (!bin) throw new Error(MOTION_FFMPEG_HINT);

  const ffmpeg = opts.ffmpegFn ?? runFfmpegArgs;
  const outDir = opts.outDir ?? dirname(video);
  mkdirSync(outDir, { recursive: true });

  const tl = ctx.timeline;
  // Keyframe targets: first frame of each phase-kind run, capped at 9
  // (evenly spaced across the runs when over the cap). Without a timeline
  // the video is sampled at the filmstrip cadence (every 4s) — honest
  // fallback, capped the same way.
  const runs = tl ? collapseRuns(tl) : [];
  const indices =
    runs.length <= MAX_KEYFRAMES
      ? runs.map((_, i) => i)
      : Array.from({ length: MAX_KEYFRAMES }, (_, i) => Math.round((i * (runs.length - 1)) / (MAX_KEYFRAMES - 1)));
  const times = tl
    ? indices.map((i) => (runs[i]!.startMs / 1000).toFixed(1))
    : Array.from({ length: MAX_KEYFRAMES }, (_, i) => (i * SAMPLE_S).toFixed(1));
  if (!tl) indices.push(...times.map((_, i) => i));

  // Row 1: per-tile extraction (`-ss <t>` per tile — single-output calls, so
  // the injected fn's "last arg is the output" contract holds).
  const keyframeFiles: string[] = [];
  for (let i = 0; i < times.length; i++) {
    const out = join(outDir, `sheet-kf-${keyframeFiles.length}.jpg`);
    try {
      await ffmpeg(bin, ["-y", "-ss", times[i]!, "-i", video, "-frames:v", "1", "-vf", `scale=${TILE_W}:-2`, out]);
    } catch (err) {
      // Past-EOF samples only happen on the undefined-timeline path (no
      // duration to clamp to): skip them honestly instead of failing the
      // whole sheet. shortcut: a partial file left by a failed encode is
      // kept as-is; upgrade if corrupt tiles ever surface downstream.
      if (!tl && keyframeFiles.length > 0) continue;
      throw err;
    }
    if (existsSync(out)) keyframeFiles.push(out);
  }
  if (keyframeFiles.length === 0) {
    throw new Error("motion sheet: no keyframes could be extracted from the video");
  }

  // Full tile grid over the keyframes (house ceil(sqrt) grid).
  const n = keyframeFiles.length;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const gridPath = join(outDir, "sheet-grid.jpg");
  await ffmpeg(bin, [
    "-y",
    "-framerate",
    "1",
    "-start_number",
    "0",
    "-i",
    join(outDir, "sheet-kf-%d.jpg"),
    "-vf",
    `tile=${cols}x${rows}`,
    "-frames:v",
    "1",
    gridPath,
  ]);

  // Row 2: difference mask per consecutive keyframe pair (blank mask ≈
  // static span). Keyframes are capped at 9, so masks stay ≤ 8.
  const maskFiles: string[] = [];
  if (tl) {
    for (let i = 0; i + 1 < n; i++) {
      const out = join(outDir, `sheet-diff-${i}.jpg`);
      await ffmpeg(bin, [
        "-y",
        "-i",
        keyframeFiles[i]!,
        "-i",
        keyframeFiles[i + 1]!,
        "-filter_complex",
        "blend=all_mode=difference",
        "-frames:v",
        "1",
        out,
      ]);
      maskFiles.push(out);
    }
    // Row 3: onion = all masks folded with chained lighten (cumulative
    // maximum-intensity composite) into one image.
    if (maskFiles.length > 0) {
      const onionPath = join(outDir, "sheet-onion.jpg");
      const m = maskFiles.length;
      if (m === 1) {
        await ffmpeg(bin, ["-y", "-i", maskFiles[0]!, "-frames:v", "1", onionPath]);
      } else {
        const chain: string[] = [];
        let prev = "0";
        for (let k = 1; k < m; k++) {
          const lbl = k === m - 1 ? "bo" : `b${k}`;
          chain.push(`[${k}][${prev}]blend=all_mode=lighten[${lbl}]`);
          prev = lbl;
        }
        await ffmpeg(bin, [
          "-y",
          ...maskFiles.flatMap((f) => ["-i", f]),
          "-filter_complex",
          chain.join(";"),
          "-map",
          "[bo]",
          "-frames:v",
          "1",
          onionPath,
        ]);
      }
    }
  }

  // The document: captions derive from ctx only (no clocks) → two runs are
  // byte-identical. Missing timeline → keyframes-only md with a note.
  const durationMs = tl ? Math.max(...tl.phases.map((p) => p.endMs)) : null;
  const durS = durationMs !== null ? `${(durationMs / 1000).toFixed(1)}s` : null;
  const mdParts: string[] = [`# Motion sheet — ${ctx.url}`, ""];
  mdParts.push(`- duration: ${durS ?? "unknown"}`);
  if (tl) {
    mdParts.push(`- phases: ${tl.phases.length} (${runs.length} kind-runs → ${n} keyframes)`);
  } else {
    mdParts.push("- timeline not collected (collectTimeline:false) — captions unavailable; keyframes are uniform 4s samples.");
  }
  if (ctx.totalHeight !== undefined) mdParts.push(`- page height: ${ctx.totalHeight}px`);
  mdParts.push("- viewport: not recorded — trail/overlay math assumes a 1440×900 desktop canvas (720×450 tiles)");
  if (tl && tl.trail.length > 0) {
    const xs = tl.trail.map((p) => p.x);
    const ys = tl.trail.map((p) => p.y);
    mdParts.push(
      `- trail: ${tl.trail.length} points, bbox (${Math.min(...xs)},${Math.min(...ys)})–(${Math.max(...xs)},${Math.max(...ys)})`,
    );
  }
  mdParts.push("");
  indices.forEach((runIdx, i) => {
    if (i >= n) return; // skipped past-EOF tiles have no section
    const r = runs[runIdx]!;
    const t = times[i]!;
    mdParts.push(
      tl
        ? `## kf ${i} — t=${t}s · phase=${r.kind} · scrollY=${r.scrollY}px · expected: ${EXPECTED[r.kind]}${
            r.target ? ` @(${r.target.x},${r.target.y})` : ""
          }`
        : `## kf ${i} — t=${t}s (uniform sample)`,
    );
    mdParts.push("");
    mdParts.push(`![kf ${i}](sheet-kf-${i}.jpg)`);
    mdParts.push("");
    if (tl && maskFiles[i]) {
      mdParts.push(
        `changed: mask ${i}: visual delta between kf ${i} and kf ${i + 1} — blank mask ≈ static span → sheet-diff-${i}.jpg`,
      );
      mdParts.push("");
    }
  });
  const mdPath = join(outDir, "motion-sheet.md");
  writeFileSync(mdPath, mdParts.join("\n"), "utf8");

  // The static sheet: relative image refs only, no JS, no CDN; the cursor
  // trail is an SVG polyline over the grid's first cell; the timeline strip
  // is pure CSS (phase blocks positioned on a seconds axis).
  const trailSvg = tl
    ? `<svg viewBox="0 0 ${TILE_W} ${TILE_H}" preserveAspectRatio="none"><polyline points="${tl.trail
        .map((p) => `${(p.x * 0.5).toFixed(1)},${(p.y * 0.5).toFixed(1)}`)
        .join(" ")}"/></svg><p class="note">cursor trail (scaled to tile cell, shown over cell 0)</p>`
    : "";
  const kinds = tl ? [...new Set(tl.phases.map((p) => p.kind))] : [];
  const strip = tl
    ? `<div class="legend">${kinds
        .map((k) => `<span class="sw" style="background:${KIND_COLOR[k]}"></span>${k}`)
        .join("")}</div>
<div class="axis"><span>0s</span><span>${durS}s</span></div>
<div class="strip">${tl.phases
        .map((p) => {
          const left = ((p.startMs / durationMs!) * 100).toFixed(2);
          const width = (((p.endMs - p.startMs) / durationMs!) * 100).toFixed(2);
          const label = `${p.kind}${
            p.targetX !== undefined && p.targetY !== undefined ? ` @(${p.targetX},${p.targetY})` : ""
          } · ${(p.startMs / 1000).toFixed(1)}s–${(p.endMs / 1000).toFixed(1)}s`;
          return `<div class="ph ph-${p.kind}" style="left:${left}%;width:${width}%" title="${label}"></div>`;
        })
        .join("")}</div>`
    : `<p class="note">timeline not collected — no strip</p>`;
  const htmlParts: string[] = [
    "<!doctype html>",
    "<html>",
    "<head>",
    '<meta charset="utf-8">',
    `<title>Motion sheet — ${esc(ctx.url)}</title>`,
    "<style>",
    "body{font:14px/1.5 system-ui,sans-serif;margin:24px;color:#222}",
    "h1{font-size:18px}h2{font-size:14px;margin:22px 0 6px}",
    "img{max-width:100%;display:block;border:1px solid #ddd}",
    ".kfrow{display:flex;flex-wrap:wrap;gap:6px}.kfrow img{width:220px}",
    ".wrap{position:relative;width:720px;max-width:100%}",
    ".wrap svg{position:absolute;left:0;top:0;width:" + ((100 / cols) | 0 ? (100 / cols).toFixed(2) : "100") + "%;height:" + (100 / rows).toFixed(2) + "%}",
    "svg polyline{fill:none;stroke:#e33;stroke-width:3;stroke-linejoin:round;stroke-linecap:round}",
    ".strip{position:relative;height:36px;background:#f2f2f2;border:1px solid #ddd}",
    ".ph{position:absolute;top:0;bottom:0;opacity:.85}",
    `.ph-dwell{background:${KIND_COLOR.dwell}}.ph-scroll{background:${KIND_COLOR.scroll}}.ph-hover{background:${KIND_COLOR.hover}}.ph-click{background:${KIND_COLOR.click}}.ph-return{background:${KIND_COLOR.return}}`,
    ".legend span{display:inline-block;width:10px;height:10px;margin:0 4px 0 12px;vertical-align:middle}",
    ".axis{display:flex;justify-content:space-between;color:#777;font-size:12px}",
    ".note{color:#777;font-size:12px}",
    "</style>",
    "</head>",
    "<body>",
    `<h1>Motion sheet — ${esc(ctx.url)}</h1>`,
    `<p>duration ${durS ?? "unknown"} · ${n} keyframes · ${
      tl ? `${tl.phases.length} phases` : "timeline not collected"
    }</p>`,
    "<h2>Keyframes</h2>",
    `<div class="kfrow">${keyframeFiles.map((_, i) => `<img src="sheet-kf-${i}.jpg" alt="kf ${i}">`).join("")}</div>`,
    "<h2>Tile grid</h2>",
    `<div class="wrap"><img src="sheet-grid.jpg" alt="tile grid">${trailSvg}</div>`,
  ];
  if (maskFiles.length > 0) {
    htmlParts.push(
      "<h2>Difference masks</h2>",
      `<div class="kfrow">${maskFiles.map((_, i) => `<img src="sheet-diff-${i}.jpg" alt="mask ${i}">`).join("")}</div>`,
    );
  }
  if (tl && maskFiles.length > 0) {
    htmlParts.push("<h2>Onion (masks, lighten)</h2>", `<img src="sheet-onion.jpg" alt="onion" width="720">`);
  }
  htmlParts.push("<h2>Timeline</h2>", strip, "</body>", "</html>");
  const htmlPath = join(outDir, "sheet.html");
  writeFileSync(htmlPath, htmlParts.join("\n"), "utf8");

  return {
    htmlPath,
    mdPath,
    keyframes: n,
    masks: maskFiles.length,
    keyframeFiles,
    maskFiles,
  };
}
