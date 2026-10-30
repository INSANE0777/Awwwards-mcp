import { describe, expect, it, vi } from "vitest";
import type { ToolResponse } from "../src/server.js";
import {
  buildMotionInputSchema,
  buildMotionRequestSchema,
  registerBuildMotion,
  runBuildMotion,
} from "../src/v2/build-motion.js";

const okResponse: ToolResponse = { content: [{ type: "text", text: "ok" }] };

function fakeHandlers() {
  return {
    build_pose_stub: vi.fn().mockResolvedValue(okResponse),
    build_gsap_stub: vi.fn().mockResolvedValue(okResponse),
    build_motion_manifest: vi.fn().mockResolvedValue(okResponse),
  };
}

describe("buildMotionRequestSchema", () => {
  it("parses each valid branch", () => {
    expect(
      buildMotionRequestSchema.parse({ kind: "pose_stub", poseGrid: { id: "pose-grid-v1" } }),
    ).toEqual({ kind: "pose_stub", poseGrid: { id: "pose-grid-v1" } });

    expect(
      buildMotionRequestSchema.parse({
        kind: "pose_stub",
        poseGrid: {},
        scrollCensus: { anims: [] },
      }),
    ).toEqual({ kind: "pose_stub", poseGrid: {}, scrollCensus: { anims: [] } });

    expect(
      buildMotionRequestSchema.parse({ kind: "gsap_stub", scrollCensus: { anims: [] } }),
    ).toEqual({ kind: "gsap_stub", scrollCensus: { anims: [] } });

    expect(
      buildMotionRequestSchema.parse({
        kind: "gsap_stub",
        scrollCensus: {},
        poseGrid: { id: "pose-grid-v1" },
      }),
    ).toEqual({ kind: "gsap_stub", scrollCensus: {}, poseGrid: { id: "pose-grid-v1" } });

    expect(
      buildMotionRequestSchema.parse({
        kind: "manifest",
        bands: { bands: [] },
        scrollCensus: { anims: [], gsapTriggers: [] },
        sections: [{ label: "Hero", selector: "#hero" }, { label: "Work" }],
      }),
    ).toEqual({
      kind: "manifest",
      bands: { bands: [] },
      scrollCensus: { anims: [], gsapTriggers: [] },
      sections: [{ label: "Hero", selector: "#hero" }, { label: "Work" }],
    });
  });

  it("rejects cross-branch fields on otherwise-valid branches", () => {
    const pose = buildMotionRequestSchema.safeParse({
      kind: "pose_stub",
      poseGrid: {},
      bands: {},
    });
    expect(pose.success).toBe(false);
    if (!pose.success) {
      expect(pose.error.issues.some((issue) => issue.code === "unrecognized_keys")).toBe(true);
    }

    const manifest = buildMotionRequestSchema.safeParse({
      kind: "manifest",
      bands: {},
      scrollCensus: {},
      poseGrid: {},
    });
    expect(manifest.success).toBe(false);
    if (!manifest.success) {
      expect(manifest.error.issues.some((issue) => issue.code === "unrecognized_keys")).toBe(true);
    }
  });

  it("rejects an unknown field", () => {
    expect(
      buildMotionRequestSchema.safeParse({
        kind: "gsap_stub",
        scrollCensus: {},
        extra: true,
      }).success,
    ).toBe(false);
  });

  it("rejects a missing required field", () => {
    expect(buildMotionRequestSchema.safeParse({ kind: "pose_stub" }).success).toBe(false);
    expect(buildMotionRequestSchema.safeParse({ kind: "gsap_stub" }).success).toBe(false);
    expect(buildMotionRequestSchema.safeParse({ kind: "manifest", bands: {} }).success).toBe(false);
  });

  it("rejects an array of operations, a missing request and an extra top-level key", () => {
    expect(
      buildMotionInputSchema.safeParse({
        request: [
          { kind: "pose_stub", poseGrid: {} },
          { kind: "gsap_stub", scrollCensus: {} },
        ],
      }).success,
    ).toBe(false);
    expect(buildMotionInputSchema.safeParse({}).success).toBe(false);
    expect(
      buildMotionInputSchema.safeParse({
        request: { kind: "gsap_stub", scrollCensus: {} },
        extra: true,
      }).success,
    ).toBe(false);
  });
});

describe("runBuildMotion", () => {
  it("dispatches pose_stub to only its handler and omits undefined optionals", async () => {
    const handlers = fakeHandlers();
    const request = buildMotionRequestSchema.parse({ kind: "pose_stub", poseGrid: { a: 1 } });

    const result = await runBuildMotion(handlers as any, request);

    expect(handlers.build_pose_stub).toHaveBeenCalledTimes(1);
    expect(handlers.build_pose_stub).toHaveBeenCalledWith({ poseGrid: { a: 1 } });
    expect(handlers.build_gsap_stub).not.toHaveBeenCalled();
    expect(handlers.build_motion_manifest).not.toHaveBeenCalled();
    expect(result).toBe(okResponse);
  });

  it("passes pose_stub scrollCensus when present", async () => {
    const handlers = fakeHandlers();
    const request = buildMotionRequestSchema.parse({
      kind: "pose_stub",
      poseGrid: { a: 1 },
      scrollCensus: { anims: [] },
    });

    await runBuildMotion(handlers as any, request);

    expect(handlers.build_pose_stub).toHaveBeenCalledWith({
      poseGrid: { a: 1 },
      scrollCensus: { anims: [] },
    });
  });

  it("dispatches gsap_stub to only its handler and omits undefined poseGrid", async () => {
    const handlers = fakeHandlers();
    const request = buildMotionRequestSchema.parse({
      kind: "gsap_stub",
      scrollCensus: { anims: [] },
    });

    const result = await runBuildMotion(handlers as any, request);

    expect(handlers.build_gsap_stub).toHaveBeenCalledTimes(1);
    expect(handlers.build_gsap_stub).toHaveBeenCalledWith({ scrollCensus: { anims: [] } });
    expect(handlers.build_pose_stub).not.toHaveBeenCalled();
    expect(handlers.build_motion_manifest).not.toHaveBeenCalled();
    expect(result).toBe(okResponse);
  });

  it("passes gsap_stub poseGrid when present", async () => {
    const handlers = fakeHandlers();
    const request = buildMotionRequestSchema.parse({
      kind: "gsap_stub",
      scrollCensus: {},
      poseGrid: { id: "pose-grid-v1" },
    });

    await runBuildMotion(handlers as any, request);

    expect(handlers.build_gsap_stub).toHaveBeenCalledWith({
      scrollCensus: {},
      poseGrid: { id: "pose-grid-v1" },
    });
  });

  it("dispatches manifest to only its handler and omits undefined sections", async () => {
    const handlers = fakeHandlers();
    const request = buildMotionRequestSchema.parse({
      kind: "manifest",
      bands: { bands: [] },
      scrollCensus: { anims: [], gsapTriggers: [] },
    });

    const result = await runBuildMotion(handlers as any, request);

    expect(handlers.build_motion_manifest).toHaveBeenCalledTimes(1);
    expect(handlers.build_motion_manifest).toHaveBeenCalledWith({
      bands: { bands: [] },
      scrollCensus: { anims: [], gsapTriggers: [] },
    });
    expect(handlers.build_pose_stub).not.toHaveBeenCalled();
    expect(handlers.build_gsap_stub).not.toHaveBeenCalled();
    expect(result).toBe(okResponse);
  });

  it("passes manifest sections when present", async () => {
    const handlers = fakeHandlers();
    const request = buildMotionRequestSchema.parse({
      kind: "manifest",
      bands: { bands: [] },
      scrollCensus: {},
      sections: [{ label: "Hero", selector: "#hero" }],
    });

    await runBuildMotion(handlers as any, request);

    expect(handlers.build_motion_manifest).toHaveBeenCalledWith({
      bands: { bands: [] },
      scrollCensus: {},
      sections: [{ label: "Hero", selector: "#hero" }],
    });
  });
});

describe("registerBuildMotion", () => {
  it("registers build_motion with read-only annotations and dispatches through the callback", async () => {
    const ctx = { handlers: fakeHandlers(), tool: vi.fn(), registerTool: vi.fn() } as any;

    registerBuildMotion(ctx);

    expect(ctx.tool).toHaveBeenCalledTimes(1);
    const [name, description, schema, annotations, callback] = ctx.tool.mock.calls[0];

    expect(name).toBe("build_motion");
    expect(description).toContain("exactly one");
    expect(description).toContain("offline");
    expect(description).toContain("build_project");
    expect(schema).toBe(buildMotionInputSchema);
    expect(typeof schema.safeParse).toBe("function");
    expect(annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(typeof callback).toBe("function");
    expect(schema.safeParse({ request: { kind: "gsap_stub", scrollCensus: {} } }).success).toBe(
      true,
    );
    expect(
      schema.safeParse({ request: { kind: "pose_stub", poseGrid: {}, bands: {} } }).success,
    ).toBe(false);

    const result = await callback({ request: { kind: "gsap_stub", scrollCensus: { anims: [] } } });
    expect(ctx.handlers.build_gsap_stub).toHaveBeenCalledWith({ scrollCensus: { anims: [] } });
    expect(result).toBe(okResponse);
  });
});
