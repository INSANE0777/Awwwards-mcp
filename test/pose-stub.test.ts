import { describe, expect, it } from "vitest";
import { buildPoseStubHtml } from "../src/pose-stub.js";
import { createHandlers } from "../src/server.js";
import type { PoseGrid } from "../src/pose3d.js";
import type { ScrollCensus } from "../src/census.js";
import type { AwwwardsClient } from "../src/awwwards.js";
import type { Cache } from "../src/cache.js";

const DATA_URL = (i: number) =>
  "data:image/png;base64," + Buffer.from("frame-" + i).toString("base64");

// Minimal well-formed grid: 6 steps × 1 frame each, ascending scroll ratios.
function grid(): PoseGrid {
  return {
    id: "pose-grid-v1",
    url: "https://example.com",
    capturedAt: 0,
    steps: 6,
    canvasSelector: "#scene",
    canvasW: 1920,
    canvasH: 1080,
    viewport: { width: 1440, height: 900 },
    snapshots: Array.from({ length: 6 }, (_, i) => ({
      step: i,
      scrollY: i * 200,
      scrollRatio: i / 5,
      frames: [{ label: "canvas", dataUrlPng: DATA_URL(i) }],
    })),
  };
}

function census(): ScrollCensus {
  return {
    url: "https://example.com",
    capturedAt: 0,
    counts: {
      "gsap-scrolltrigger": 3,
      "css-scroll-timeline": 0,
      "css-view-timeline": 0,
      "data-attr": 0,
      "css-keyframe": 0,
      smil: 0,
      unknown: 0,
    },
    anims: [
      { selector: "a", tag: "a", props: ["transform"], durationMs: 1, delayMs: 0, easing: "power2.out", trigger: "gsap-scrolltrigger", scrub: true, pin: true, svgStroke: false },
      { selector: "b", tag: "b", props: ["opacity"], durationMs: 1, delayMs: 0, easing: null, trigger: "gsap-scrolltrigger", scrub: false, pin: true, svgStroke: false },
      { selector: "c", tag: "c", props: ["transform"], durationMs: 1, delayMs: 0, easing: "linear", trigger: "gsap-scrolltrigger", scrub: true, pin: false, svgStroke: false },
    ],
    svgStrokes: [],
    nativeScrollTimelines: 0,
    gsapTriggers: [],
    reducedMotion: false,
  };
}

// createHandlers needs client+cache typed slots, but every test here injects
// pose fns that never touch them — dummies keep the file offline and fs-free.
const deps = (extra: object) =>
  ({
    client: null as unknown as AwwwardsClient,
    cache: null as unknown as Cache,
    ...extra,
  }) as Parameters<typeof createHandlers>[0];

describe("buildPoseStubHtml", () => {
  it("returns a standalone HTML document (doctype first)", () => {
    expect(buildPoseStubHtml(grid())).toMatch(/^<!doctype html>/);
  });

  it("imports three.js and gsap as ES modules", () => {
    const html = buildPoseStubHtml(grid());
    expect(html).toContain("import * as THREE from");
    expect(html).toContain("import { gsap } from");
  });

  it("embeds one base64 dataURL per snapshot frame (count ≥ steps)", () => {
    const html = buildPoseStubHtml(grid());
    const count = (html.match(/data:image\/png;base64,/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(grid().steps);
  });

  it("interpolates camera.position between snapshot scrollRatios", () => {
    expect(buildPoseStubHtml(grid())).toContain("camera.position.lerpVectors");
  });

  it("guards prefers-reduced-motion with a static first frame", () => {
    const html = buildPoseStubHtml(grid());
    expect(html).toContain("prefers-reduced-motion");
    expect(html).toContain("showFrame(0)");
  });

  it("contains no eval(", () => {
    expect(buildPoseStubHtml(grid())).not.toContain("eval(");
  });

  it("emits census suggestions as comment header lines", () => {
    const html = buildPoseStubHtml(grid(), { scrollCensus: census() });
    expect(html).toContain("// SUGGESTION(st) from reference census");
    expect(html).toContain("// SUGGESTION(pin) from reference census");
    expect(html).toContain("// SUGGESTION(ease) from reference census");
  });

  it("omits suggestion lines when no census is given", () => {
    expect(buildPoseStubHtml(grid())).not.toContain("SUGGESTION(");
  });
});

describe("pose handlers", () => {
  it("capture_pose_3d returns the injected grid as JSON", async () => {
    const h = createHandlers(deps({ pose3dFn: async () => grid() }));
    const res = await h.capture_pose_3d({ url: "https://example.com", steps: 6, viewport: "desktop" });
    expect(res.isError).toBeUndefined();
    const parsed = JSON.parse((res.content[0] as any).text);
    expect(parsed.id).toBe("pose-grid-v1");
    expect(parsed.steps).toBe(6);
    expect(parsed.url).toBe("https://example.com");
  });

  it("capture_pose_3d forwards capture errors as isError", async () => {
    const h = createHandlers(deps({ pose3dFn: async () => ({ error: "install playwright" }) }));
    const res = await h.capture_pose_3d({ url: "https://example.com" });
    expect(res.isError).toBe(true);
    expect((res.content[0] as any).text).toContain("install playwright");
  });

  it("build_pose_stub rejects a grid whose id is not pose-grid-v1", async () => {
    const h = createHandlers(deps({}));
    const res = await h.build_pose_stub({
      poseGrid: { ...grid(), id: "legacy-v9" } as unknown as PoseGrid,
    });
    expect(res.isError).toBe(true);
    expect((res.content[0] as any).text).toContain("pose-grid-v1");
  });

  it("build_pose_stub rejects an empty snapshot list", async () => {
    const h = createHandlers(deps({}));
    const res = await h.build_pose_stub({
      poseGrid: { ...grid(), snapshots: [] },
    });
    expect(res.isError).toBe(true);
    expect((res.content[0] as any).text).toContain("poseGrid has no captured frames");
  });

  it("build_pose_stub rejects snapshots whose frames are all empty", async () => {
    const h = createHandlers(deps({}));
    const empty = grid();
    const res = await h.build_pose_stub({
      poseGrid: { ...empty, snapshots: empty.snapshots.map((s) => ({ ...s, frames: [] })) },
    });
    expect(res.isError).toBe(true);
    expect((res.content[0] as any).text).toContain("build a GSAP stub from the scroll census instead");
  });

  it("build_pose_stub rejects undefined frames and blank frame URLs", async () => {
    const h = createHandlers(deps({}));
    const empty = grid();
    for (const frames of [undefined, [{ label: "canvas", dataUrlPng: "" }]]) {
      const res = await h.build_pose_stub({
        poseGrid: {
          ...empty,
          snapshots: empty.snapshots.map((s) => ({ ...s, frames: frames as any })),
        },
      });
      expect(res.isError).toBe(true);
      expect((res.content[0] as any).text).toContain("poseGrid has no captured frames");
    }
  });

  it("build_pose_stub rejects a mixed null snapshot", async () => {
    const h = createHandlers(deps({}));
    const valid = grid();
    const res = await h.build_pose_stub({
      poseGrid: {
        ...valid,
        snapshots: [valid.snapshots[0]!, null as any, ...valid.snapshots.slice(1)],
      },
    });
    expect(res.isError).toBe(true);
    expect((res.content[0] as any).text).toContain("poseGrid has no captured frames");
  });

  it("build_pose_stub accepts a full census without gsapTriggers", async () => {
    const h = createHandlers(deps({}));
    const { gsapTriggers, ...partial } = census();
    const res = await h.build_pose_stub({
      poseGrid: grid(),
      scrollCensus: partial as ScrollCensus,
    });
    expect(res.isError).toBeUndefined();
    expect((res.content[0] as any).text).toContain("suggestions(st)=3");
  });

  it("build_pose_stub unwraps a full census nested under scrollCensus", async () => {
    const h = createHandlers(deps({}));
    const res = await h.build_pose_stub({
      poseGrid: grid(),
      scrollCensus: { scrollCensus: census() } as unknown as ScrollCensus,
    });
    expect(res.isError).toBeUndefined();
    const parsed = JSON.parse((res.content[0] as any).text);
    expect(parsed.notes).toContain("suggestions(st)=3");
  });

  it("build_pose_stub rejects a compact census instead of crashing poseSuggestions", async () => {
    const h = createHandlers(deps({}));
    const res = await h.build_pose_stub({
      poseGrid: grid(),
      scrollCensus: { counts: {}, animCount: 0 } as unknown as ScrollCensus,
    });
    expect(res.isError).toBe(true);
    expect((res.content[0] as any).text).toContain("scrollCensus is a compact summary");
  });

  it("build_pose_stub returns stubHtml with deterministic notes", async () => {
    const h = createHandlers(deps({}));
    const res = await h.build_pose_stub({ poseGrid: grid(), scrollCensus: census() });
    expect(res.isError).toBeUndefined();
    const parsed = JSON.parse((res.content[0] as any).text);
    expect(parsed.stubHtml).toContain("<!doctype html>");
    expect(parsed.notes).toEqual([
      "steps=6",
      "canvas=1920x1080",
      "suggestions(st)=3",
      "suggestions(pin)=2",
      "suggestions(ease)=2",
    ]);
  });
});
