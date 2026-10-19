import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildMotionSheet } from "../src/motion-sheet.js";
import type { MotionTimeline } from "../src/motion.js";

const dirs: string[] = [];
const tmpDir = () => {
  const d = mkdtempSync(join(tmpdir(), "motion-sheet-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// Deterministic timeline mirroring recordSiteMotion's real shape: two
// goto/preloader dwells, a stepped scroll tour, two hovers + a click,
// return to top. Distinct kind runs: dwell, scroll, hover, click, return.
const TIMELINE: MotionTimeline = {
  t0: 1_000,
  phases: [
    { kind: "dwell", startMs: 0, endMs: 100 },
    { kind: "dwell", startMs: 100, endMs: 4100 },
    { kind: "scroll", startMs: 4100, endMs: 4550, scrollY: 450 },
    { kind: "scroll", startMs: 4550, endMs: 5000, scrollY: 900 },
    { kind: "hover", startMs: 5000, endMs: 5600, targetX: 60, targetY: 300 },
    { kind: "hover", startMs: 5600, endMs: 6200, targetX: 400, targetY: 700 },
    { kind: "click", startMs: 6200, endMs: 6900, targetX: 400, targetY: 700 },
    { kind: "return", startMs: 6900, endMs: 8500 },
  ],
  trail: [
    { tMs: 5000, x: 60, y: 300 },
    { tMs: 5600, x: 400, y: 700 },
  ],
};

// DI fake per the brief: records every arg-list, writes a 1-byte file named
// from the last arg (the output path) — never a real ffmpeg invocation.
const fakeFfmpeg =
  (calls: string[][]) =>
  async (_bin: string, args: string[]): Promise<void> => {
    calls.push(args);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(args[args.length - 1]!, Buffer.from("x"));
  };

const setup = () => {
  const dir = tmpDir();
  const video = join(dir, "rec.webm");
  writeFileSync(video, "fake-webm");
  return { dir, video };
};

describe("buildMotionSheet", () => {
  it("builds keyframes from phase transitions, pairwise diff masks, an onion, md + html", async () => {
    const { dir, video } = setup();
    const calls: string[][] = [];
    const res = await buildMotionSheet(
      video,
      { url: "https://example.com", timeline: TIMELINE },
      { ffmpegPath: "ffmpeg-stub-bin", ffmpegFn: fakeFfmpeg(calls) },
    );

    // One keyframe per distinct phase-kind run (5 runs, under the 9 cap);
    // one difference mask per consecutive pair.
    expect(res.keyframes).toBe(5);
    expect(res.masks).toBe(4);
    expect(res.keyframeFiles).toEqual([
      join(dir, "sheet-kf-0.jpg"),
      join(dir, "sheet-kf-1.jpg"),
      join(dir, "sheet-kf-2.jpg"),
      join(dir, "sheet-kf-3.jpg"),
      join(dir, "sheet-kf-4.jpg"),
    ]);
    expect(res.maskFiles).toEqual([
      join(dir, "sheet-diff-0.jpg"),
      join(dir, "sheet-diff-1.jpg"),
      join(dir, "sheet-diff-2.jpg"),
      join(dir, "sheet-diff-3.jpg"),
    ]);
    for (const f of [...res.keyframeFiles, ...res.maskFiles]) {
      expect(existsSync(f)).toBe(true);
    }

    // Keyframes are per-tile -ss extractions at each run's first frame,
    // scaled to the 720px tile width; the first tile is clamped past the
    // 600ms pre-paint window (run 0 starts at 0 — later runs untouched);
    // grid + onion are single extra calls.
    const tileCalls = calls.filter((a) => a.includes(video));
    expect(tileCalls).toHaveLength(5);
    expect(tileCalls.map((c) => c[2])).toEqual(["0.6", "4.1", "5.0", "6.2", "6.9"]);
    expect(tileCalls[0]).toEqual([
      "-y",
      "-ss",
      "0.6",
      "-i",
      video,
      "-frames:v",
      "1",
      "-vf",
      "scale=720:-2",
      join(dir, "sheet-kf-0.jpg"),
    ]);
    expect(calls.some((a) => a[a.length - 1]!.endsWith("sheet-grid.jpg"))).toBe(true);
    const mask0 = calls.filter((a) => a[a.length - 1]!.endsWith("sheet-diff-0.jpg"));
    expect(mask0).toHaveLength(1);
    expect(mask0[0]).toContain("blend=all_mode=difference");
    const onionCalls = calls.filter((a) => a[a.length - 1]!.endsWith("sheet-onion.jpg"));
    expect(onionCalls).toHaveLength(1);
    expect(onionCalls[0].join(" ")).toContain("blend=all_mode=lighten");
    expect(existsSync(join(dir, "sheet-onion.jpg"))).toBe(true);

    // The md is a video→document: t= captions with phase kinds and scrollY,
    // per-keyframe mask lines, and a trail summary — derived from ctx only.
    const md = readFileSync(res.mdPath, "utf8");
    expect(md).toContain("https://example.com");
    expect(md).toContain("- duration: 8.5s");
    expect(md).toContain("![kf 0](sheet-kf-0.jpg)");
    expect(md).toContain("t=0.6s"); // first keyframe clamped past the pre-paint window
    expect(md).toContain("phase=dwell");
    expect(md).toContain("phase=scroll");
    expect(md).toContain("phase=hover");
    expect(md).toContain("phase=click");
    expect(md).toContain("phase=return");
    expect(md).toContain("scrollY=450px");
    expect(md).toContain("scrollY=900px"); // hover keyframes carry the last scroll offset
    expect(md).toContain("expected:");
    expect(md).toContain("mask 0: visual delta between kf 0 and kf 1 — blank mask ≈ static span");
    expect(md).toContain("trail: 2 points");

    // The html embeds the same images by RELATIVE path only, overlays the
    // cursor trail as an SVG polyline, and renders the pure-CSS timeline
    // strip with per-kind colors and labeled hover targets.
    const html = readFileSync(res.htmlPath, "utf8");
    expect(html).toContain('src="sheet-grid.jpg"');
    expect(html).toContain('src="sheet-onion.jpg"');
    expect(html).not.toMatch(/src="[^"]*[\\/]/); // no absolute paths
    expect(html).not.toContain("<script"); // static: no JS, no CDN
    expect(html).toContain("<polyline");
    expect(html).toContain('<div class="ph ph-dwell"');
    expect(html).toContain('<div class="ph ph-scroll"');
    expect(html).toContain('<div class="ph ph-hover"');
    expect(html).toContain('<div class="ph ph-click"');
    expect(html).toContain('<div class="ph ph-return"');
    expect(html).toContain("#4a90d9"); // kind→color legend
    expect(html).toContain("hover @(60,300)"); // hover target label
    expect(res.mdPath).toBe(join(dir, "motion-sheet.md"));
    expect(res.htmlPath).toBe(join(dir, "sheet.html"));
  });

  it("is deterministic: two runs produce byte-identical md + html", async () => {
    const { video } = setup();
    const res1 = await buildMotionSheet(
      video,
      { url: "https://example.com", timeline: TIMELINE },
      { ffmpegPath: "ffmpeg-stub-bin", ffmpegFn: fakeFfmpeg([]) },
    );
    const md1 = readFileSync(res1.mdPath);
    const html1 = readFileSync(res1.htmlPath);
    const res2 = await buildMotionSheet(
      video,
      { url: "https://example.com", timeline: TIMELINE },
      { ffmpegPath: "ffmpeg-stub-bin", ffmpegFn: fakeFfmpeg([]) },
    );
    expect(readFileSync(res2.mdPath).equals(md1)).toBe(true);
    expect(readFileSync(res2.htmlPath).equals(html1)).toBe(true);
  });

  it("propagates ffmpeg failure so the caller can degrade", async () => {
    const { video } = setup();
    await expect(
      buildMotionSheet(
        video,
        { url: "https://example.com", timeline: TIMELINE },
        {
          ffmpegPath: "ffmpeg-stub-bin",
          ffmpegFn: async () => {
            throw new Error("ffmpeg boom");
          },
        },
      ),
    ).rejects.toThrow("ffmpeg boom");
  });

  it("throws the install hint when no ffmpeg binary is available", async () => {
    const { video } = setup();
    await expect(
      buildMotionSheet(video, { url: "https://example.com", timeline: TIMELINE }, { ffmpegPath: null }),
    ).rejects.toThrow(/ffmpeg-static/);
  });

  it("degrades to a keyframes-only sheet when the timeline is undefined", async () => {
    const { dir, video } = setup();
    const calls: string[][] = [];
    const res = await buildMotionSheet(
      video,
      { url: "https://example.com" },
      { ffmpegPath: "ffmpeg-stub-bin", ffmpegFn: fakeFfmpeg(calls) },
    );
    // Uniform 4s samples (the filmstrip cadence); no masks, no onion, no
    // captions — an honest missing-data note stands in for them.
    expect(res.keyframes).toBe(9);
    expect(res.masks).toBe(0);
    expect(res.maskFiles).toEqual([]);
    const md = readFileSync(res.mdPath, "utf8");
    expect(md).toContain("![kf 0](sheet-kf-0.jpg)");
    expect(md).toContain("collectTimeline");
    expect(md).not.toContain("phase=");
    expect(md).not.toContain("trail:");
    const outs = calls.map((a) => a[a.length - 1]!);
    expect(outs.some((o) => o.includes("sheet-diff-"))).toBe(false);
    expect(outs.some((o) => o.includes("sheet-onion"))).toBe(false);
    const html = readFileSync(res.htmlPath, "utf8");
    expect(html).toContain('src="sheet-kf-0.jpg"');
    expect(html).not.toContain('class="ph ph-scroll"');
    expect(html).not.toContain("<polyline");
  });

  it("omits the trail polyline + note when the timeline has an empty trail", async () => {
    const { dir, video } = setup();
    const res = await buildMotionSheet(
      video,
      { url: "https://example.com", timeline: { ...TIMELINE, trail: [] } },
      { ffmpegPath: "ffmpeg-stub-bin", ffmpegFn: fakeFfmpeg([]) },
    );
    const html = readFileSync(res.htmlPath, "utf8");
    expect(html).not.toContain("<polyline");
    expect(html).not.toContain("cursor trail");
    // Timeline strip still renders.
    expect(html).toContain('<div class="ph ph-dwell"');
  });

  it("clamps only the first keyframe into the pre-paint window; later runs keep their times", async () => {
    const { dir, video } = setup();
    const calls: string[][] = [];
    const tl: MotionTimeline = {
      t0: 0,
      phases: [
        { kind: "dwell", startMs: 0, endMs: 400 },
        { kind: "scroll", startMs: 400, endMs: 900, scrollY: 450 },
        { kind: "return", startMs: 900, endMs: 1400 },
      ],
      trail: [],
    };
    await buildMotionSheet(
      video,
      { url: "https://example.com", timeline: tl },
      { ffmpegPath: "ffmpeg-stub-bin", ffmpegFn: fakeFfmpeg(calls) },
    );
    // dwell 0ms → clamped to 0.6s; scroll 400ms and return 900ms untouched.
    expect(calls.filter((a) => a.includes(video)).map((c) => c[2])).toEqual(["0.6", "0.4", "0.9"]);
  });

  it("scales the trail polyline to the recorded viewport and notes it in the md", async () => {
    const { dir, video } = setup();
    const res = await buildMotionSheet(
      video,
      { url: "https://example.com", timeline: TIMELINE, viewport: { width: 720, height: 450 } },
      { ffmpegPath: "ffmpeg-stub-bin", ffmpegFn: fakeFfmpeg([]) },
    );
    // Hand-computed: a 720×450 canvas on the 720×450 tile scales 1:1, so the
    // raw trail coordinates pass through unchanged.
    const html = readFileSync(res.htmlPath, "utf8");
    expect(html).toContain('points="60.0,300.0 400.0,700.0"');
    const md = readFileSync(res.mdPath, "utf8");
    expect(md).toContain("- viewport: 720×450");
  });

  it("pins the absent-viewport trail scaling: page coords ×0.5 (1440×900 canvas → 720×450 tile)", async () => {
    const { dir, video } = setup();
    const res = await buildMotionSheet(
      video,
      { url: "https://example.com", timeline: TIMELINE },
      { ffmpegPath: "ffmpeg-stub-bin", ffmpegFn: fakeFfmpeg([]) },
    );
    // Byte pin for the no-viewport fallback: {60,300}/{400,700} × 0.5 =
    // (30.0,150.0) (200.0,350.0) — exactly the pre-viewport polyline.
    const html = readFileSync(res.htmlPath, "utf8");
    expect(html).toContain('points="30.0,150.0 200.0,350.0"');
  });
});
