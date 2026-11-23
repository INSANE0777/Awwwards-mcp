import { describe, expect, it } from "vitest";
import type { SceneEvidenceV2, SceneSpectorEvidence, SceneThreeEvidence } from "../src/scene-capture.js";
import {
  SCENE_DOSSIER_LIMITATIONS,
  SCENE_DOSSIER_LIMITS,
  buildSceneDossier,
  capBlindSpots,
  classifyScene,
  renderSceneDossierMarkdown,
  shaderRefsFromSpector,
  type SceneClassInput,
} from "../src/scene-dossier.js";

const base = (): SceneClassInput => ({
  frameworkHints: {
    three: { detected: false, version: null, scripts: [] },
    babylon: { detected: false, version: null, scripts: [] },
    playcanvas: { detected: false, version: null, scripts: [] },
    canvasCount: 1,
  },
  canvasCount: 1,
  rendererApi: "webgl2",
  resources: [],
  scriptUrls: [],
});

describe("classifyScene", () => {
  it("classifies a reachable Three scene and camera as R1", () => {
    const input = base();
    input.three = {
      id: "three-adapter-v1",
      available: true,
      reason: "ok",
      revision: "170",
      scene: { nodes: [{ type: "scene" } as any], truncated: false, total: 1 },
      camera: { type: "PerspectiveCamera", fov: 50, near: 0.1, far: 100, matrixWorld: [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1] },
      cameras: [],
      lights: [],
      controls: null,
      coverage: { scene: true, geometry: true, camera: true, controls: false, lights: false, materials: false },
    };
    expect(classifyScene(input)).toEqual({
      class: "R1",
      reasons: expect.arrayContaining([expect.stringMatching(/three/i), expect.stringMatching(/camera/i)]),
    });
  });

  it("classifies canvas-only evidence as R2", () => {
    expect(classifyScene(base()).class).toBe("R2");
  });

  it("does not call a Three adapter without a camera R1", () => {
    const input = base();
    input.three = { ...({ available: true, scene: { nodes: [], total: 0, truncated: false }, camera: null } as any) };
    expect(classifyScene(input).class).toBe("R2");
  });

  it("classifies a .splinecode resource as R3", () => {
    const input = base();
    input.resources = [{ url: "https://cdn.example.com/scene.splinecode" }];
    expect(classifyScene(input).class).toBe("R3");
  });

  it("classifies a .riv script as R3", () => {
    const input = base();
    input.scriptUrls = ["https://cdn.example.com/rive/app.riv"];
    expect(classifyScene(input).class).toBe("R3");
  });

  it("classifies no canvas and no graph as R4 with a reason", () => {
    const input = base();
    input.canvasCount = 0;
    input.frameworkHints.canvasCount = 0;
    const result = classifyScene(input);
    expect(result.class).toBe("R4");
    expect(result.reasons.join(" ")).toMatch(/no canvas|no reachable/i);
  });

  it("classifies an unhooked WebGPU page with no graph as R4", () => {
    const input = base();
    input.rendererApi = "webgpu";
    input.canvasCount = 1;
    expect(classifyScene(input).class).toBe("R4");
  });

  it("classifies a reachable Three scene with a .splinecode resource as R3", () => {
    const input = base();
    input.three = {
      id: "three-adapter-v1",
      available: true,
      reason: "ok",
      revision: "170",
      scene: { nodes: [], truncated: false, total: 0 },
      camera: { type: "PerspectiveCamera", fov: 50, near: 0.1, far: 100, matrixWorld: [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1] },
      cameras: [],
      lights: [],
      controls: null,
      coverage: { scene: true, geometry: true, camera: true, controls: false, lights: false, materials: false },
    };
    input.resources = [{ url: "https://cdn.example.com/scene.splinecode" }];
    expect(classifyScene(input).class).toBe("R3");
  });

  it("does not mutate its input", () => {
    const input = base();
    const snapshot = JSON.stringify(input);
    classifyScene(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe("shaderRefsFromSpector", () => {
  const limits = {
    maxPrograms: 10,
    maxShaders: 20,
    maxShaderChars: 1_000,
    maxTotalShaderChars: 10_000,
    maxCommandNames: 20,
    programsTruncated: false,
    shadersTruncated: false,
  };
  const spector = (overrides: Record<string, unknown> = {}): any => ({
    id: "spector-adapter-v1",
    available: true,
    reason: "ok",
    version: "1.0",
    canvas: { width: 100, height: 100 },
    context: null,
    commands: {
      total: 0,
      drawCalls: 0,
      byName: [],
      statuses: { unknown: 0, unused: 0, disabled: 0, redundant: 0, valid: 0, deprecated: 0 },
    },
    programs: [],
    analyses: [],
    limits,
    ...overrides,
  });
  const program = (...shaders: any[]) => ({
    programStatus: { LINK_STATUS: true, VALIDATE_STATUS: true, infoLog: null },
    shaders,
  });
  const shader = (type: string, source: string, length = source.length) => ({
    type,
    source,
    length,
    truncated: false,
  });

  it("tags known Three shader preambles as engine-stock and unknown code as custom", () => {
    const refs = shaderRefsFromSpector(
      spector({
        programs: [
          program(shader("vertex", "#define STANDARD\nvoid main(){}", 30)),
          program(shader("fragment", "void main(){gl_FragColor=vec4(1.0);}", 36)),
        ],
      }),
    );
    if (!Array.isArray(refs)) throw new Error(refs.reason);
    expect(refs[0]!.origin).toBe("engine-stock");
    expect(refs[1]!.origin).toBe("custom");
    expect(refs[0]).toMatchObject({ id: "shader-1", stage: "vertex", length: 30, truncated: false });
    expect(refs[1]).toMatchObject({ id: "shader-2", stage: "fragment", length: 36 });
  });

  it("returns unavailable when Spector did not run", () => {
    expect(shaderRefsFromSpector(null)).toHaveProperty("status", "unavailable");
    expect(shaderRefsFromSpector(undefined)).toHaveProperty("status", "unavailable");
    expect(
      shaderRefsFromSpector(spector({ available: false, reason: "not installed" })),
    ).toHaveProperty("status", "unavailable");
  });

  it("dedupes identical shaders and never exceeds the total source cap", () => {
    const refs = shaderRefsFromSpector(
      spector({
        programs: [
          program(shader("vertex", "dupe"), shader("vertex", "dupe")),
          program(
            shader("vertex", "x".repeat(40)),
            shader("vertex", "y".repeat(40)),
            shader("vertex", "z".repeat(10)),
          ),
        ],
        limits: { ...limits, maxShaders: 10, maxShaderChars: 64, maxTotalShaderChars: 60 },
      }),
    );
    if (!Array.isArray(refs)) throw new Error(refs.reason);
    expect(refs.map((ref) => ref.id)).toEqual(["shader-1", "shader-2", "shader-3"]);
    expect(refs.reduce((sum, ref) => sum + ref.source.length, 0)).toBe(60);
    expect(refs.at(-1)).toMatchObject({ truncated: true, length: 40 });
    expect(refs.at(-1)!.source).toHaveLength(16);
  });

  it("returns an empty list when the adapter ran with no programs", () => {
    expect(shaderRefsFromSpector(spector({ programs: [] }))).toEqual([]);
  });

  it("is case-sensitive for engine-stock tokens and maps compute/unknown stages", () => {
    const refs = shaderRefsFromSpector(
      spector({
        programs: [
          program(
            shader("compute", "#define standard\nvoid main(){}"),
            shader("VERTEX_SHADER", "#define USE_SKINNING\nvoid main(){}"),
            shader("geometry", "void main(){}"),
          ),
        ],
      }),
    );
    if (!Array.isArray(refs)) throw new Error(refs.reason);
    expect(refs[0]).toMatchObject({ stage: "compute", origin: "custom" });
    expect(refs[1]).toMatchObject({ stage: "vertex", origin: "engine-stock" });
    expect(refs[2]).toMatchObject({ stage: "unknown", origin: "custom" });
  });

  it("truncates one shader at maxShaderChars and keeps its original length", () => {
    const source = "s".repeat(50);
    const refs = shaderRefsFromSpector(
      spector({
        programs: [program(shader("fragment", source, 50))],
        limits: { ...limits, maxShaderChars: 10, maxTotalShaderChars: 1_000 },
      }),
    );
    if (!Array.isArray(refs)) throw new Error(refs.reason);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ source: "s".repeat(10), length: 50, truncated: true });
  });

  it("stops at the pack's program cap", () => {
    const refs = shaderRefsFromSpector(
      spector({
        programs: [
          program(shader("vertex", "a"), shader("fragment", "b")),
          program(shader("vertex", "c")),
          program(shader("vertex", "d")),
        ],
        limits: { ...limits, maxPrograms: 1, maxShaders: 10 },
      }),
    );
    if (!Array.isArray(refs)) throw new Error(refs.reason);
    expect(refs.map((ref) => ref.source)).toEqual(["a", "b"]);
  });

  it("stops at the pack's shader cap", () => {
    const refs = shaderRefsFromSpector(
      spector({
        programs: [
          program(shader("vertex", "a")),
          program(shader("vertex", "b")),
        ],
        limits: { ...limits, maxPrograms: 10, maxShaders: 1 },
      }),
    );
    if (!Array.isArray(refs)) throw new Error(refs.reason);
    expect(refs.map((ref) => ref.source)).toEqual(["a"]);
  });
});

// ---- buildSceneDossier ---------------------------------------------------

const CAMERA = {
  type: "PerspectiveCamera",
  fov: 50,
  near: 0.1,
  far: 100,
  matrixWorld: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 5, 1],
};

const CAPABILITIES = {
  scene: { status: "unavailable" as const, reason: "passive" },
  camera: { status: "unavailable" as const, reason: "passive" },
  controls: { status: "unavailable" as const, reason: "passive" },
  shaders: { status: "unavailable" as const, reason: "passive" },
  geometry: { status: "unavailable" as const, reason: "passive" },
};

const checkpoint = () => ({
  index: 0,
  requestedScrollRatio: 0,
  requestedScrollTop: 0,
  actualScrollTop: 0,
  scrollRange: 1000,
  scrollRoot: "window",
  scrollRootFound: true,
  pointer: null,
  pointerPx: null,
  waitMs: 0,
  elapsedMs: 1,
  canvas: {
    rect: { x: 0, y: 0, width: 800, height: 600 },
    backing: { width: 1600, height: 1200 },
    dpr: 2,
  },
  stable: true,
  files: { canvas: "/tmp/frame-01-canvas.png" },
});

const keyframe = (index = 0) => ({
  index,
  scrollRatio: index,
  pointer: null,
  camera: CAMERA,
  nodes: [],
  frameHash: "a".repeat(64),
  stable: true,
  files: { canvas: `/tmp/frame-${index + 1}-canvas.png` },
});

const threeEvidence = (
  overrides: Partial<SceneThreeEvidence> = {},
): SceneThreeEvidence => ({
  id: "three-adapter-v1",
  available: true,
  reason: "ok",
  revision: "170",
  scene: {
    nodes: [
      {
        type: "mesh",
        name: "blade",
        uuid: "u1",
        visible: true,
        position: [0, 0, 0],
        quaternion: [0, 0, 0, 1],
        scale: [1, 1, 1],
        childCount: 0,
        geometry: null,
        material: null,
        camera: null,
        light: null,
      },
    ],
    truncated: false,
    total: 1,
  },
  camera: CAMERA,
  cameras: [CAMERA],
  lights: [],
  controls: null,
  coverage: {
    scene: true,
    geometry: true,
    camera: true,
    controls: false,
    lights: false,
    materials: false,
  },
  ...overrides,
});

const resource = (url: string, classification = "script", bytes: number | null = null) => ({
  assetId: "asset-1",
  url,
  origin: new URL(url).origin,
  mime: "text/javascript",
  bytes,
  resourceType: "script",
  classification,
  discovery: "response" as const,
  assetOrigin: false,
  download: { status: "skipped" as const, reason: "test" },
});

const evidenceV2 = (overrides: Record<string, unknown> = {}): SceneEvidenceV2 =>
  ({
    id: "scene-evidence-v2",
    url: "https://example.com/work",
    captureId: "scene-test-0123abcd",
    capturedAt: 1,
    viewport: { name: "desktop", width: 1440, height: 900 },
    canvas: { requestedSelector: null, usedSelector: "canvas", canvases: 1 },
    frameworkHints: {
      three: { detected: false, version: null, scripts: [] },
      babylon: { detected: false, version: null, scripts: [] },
      playcanvas: { detected: false, version: null, scripts: [] },
      canvasCount: 1,
    },
    checkpoints: [checkpoint()],
    keyframes: [keyframe()],
    clock: "real",
    resources: [],
    resourceTotal: 0,
    resourcesTruncated: false,
    blockedRequests: { count: 0, samples: [] },
    assetOrigins: [],
    paths: {
      dir: "/tmp/scene-capture",
      evidence: "/tmp/scene-capture/evidence.json",
      framesDir: "/tmp/scene-capture",
    },
    coverage: {
      status: "partial",
      collected: 1,
      excluded: 0,
      limitations: [],
      capabilities: CAPABILITIES,
    },
    limitations: ["a pre-existing limitation"],
    ...overrides,
  }) as SceneEvidenceV2;

const classInput = (overrides: Partial<SceneClassInput> = {}): SceneClassInput => ({
  frameworkHints: {
    three: { detected: false, version: null, scripts: [] },
    babylon: { detected: false, version: null, scripts: [] },
    playcanvas: { detected: false, version: null, scripts: [] },
    canvasCount: 1,
  },
  canvasCount: 1,
  rendererApi: "webgl2",
  resources: [],
  scriptUrls: [],
  ...overrides,
});

const dossierOf = (overrides: Record<string, unknown> = {}) =>
  buildSceneDossier(evidenceV2(overrides), classInput());

describe("buildSceneDossier", () => {
  it("always records the honest inspection boundary and unavailable passes", () => {
    for (const overrides of [
      {},
      { canvas: { requestedSelector: null, usedSelector: "canvas", canvases: 0 } },
      { three: threeEvidence() },
      { resources: [resource("https://cdn.test/app.riv")] },
    ]) {
      const dossier = dossierOf(overrides);
      expect(dossier.coverage.workersInspected).toBe(false);
      expect(dossier.coverage.offscreenInspected).toBe(false);
      expect(dossier.coverage.truncatedDraws).toBe(false);
      expect(dossier.coverage.blindSpots).toEqual(
        expect.arrayContaining([
          "workers are not inspected",
          "OffscreenCanvas is not inspected",
        ]),
      );
      expect(dossier.renderer.passes).toEqual({
        status: "unavailable",
        reason: "ordered pass topology is not captured in 1.22",
      });
      expect(dossier.limitations.join(" ")).toMatch(/workers are not inspected/i);
      expect(dossier.limitations.join(" ")).toMatch(/OffscreenCanvas is not inspected/i);
      expect(dossier.limitations.join(" ")).toMatch(/untrusted page text/i);
      expect(dossier.limitations.join(" ")).toMatch(/Asset rights are unknown/i);
      expect(dossier.limitations.join(" ")).toMatch(/render-pass topology/i);
      expect(dossier.limitations).toContain(SCENE_DOSSIER_LIMITATIONS.rendererApi);
      expect(SCENE_DOSSIER_LIMITATIONS.rendererApi).toMatch(/^Capture does not probe/);
      expect(dossier.limitations).toContain("a pre-existing limitation");
    }
  });

  it("assembles R2 renderer, assets, runtime and paths from evidence only", () => {
    const dossier = buildSceneDossier(
      evidenceV2({
        resources: [resource("https://cdn.test/model.glb", "model", 1234)],
      }),
      classInput(),
    );
    expect(dossier.class).toBe("R2");
    expect(dossier.renderer).toEqual({
      // A direct caller's rendererApi is honored; capture itself passes unknown.
      api: "webgl2",
      dpr: 2,
      toneMapping: null,
      colorSpace: null,
      passes: {
        status: "unavailable",
        reason: "ordered pass topology is not captured in 1.22",
      },
    });
    expect(dossier.runtime).toEqual({
      engine: "unknown",
      version: null,
      via: "none",
      confidence: "low",
    });
    expect(dossier.graph).toBeNull();
    expect(dossier.assets).toEqual([
      {
        assetId: "asset-1",
        url: "https://cdn.test/model.glb",
        mime: "text/javascript",
        bytes: 1234,
        classification: "model",
        license: "unknown",
      },
    ]);
    expect(JSON.stringify(dossier.assets)).not.toMatch(/base64|body|data:/);
    expect(dossier.paths.dossier).toBe("/tmp/scene-capture/dossier.md");
    expect(dossier.paths.dossier.endsWith("dossier.md")).toBe(true);
  });

  it("re-redacts the pack url and resource rows for direct callers", () => {
    const dossier = buildSceneDossier(
      evidenceV2({
        url: "https://user:pass@example.com/work?token=secret#frag",
        resources: [resource("https://cdn.test/app.js?token=secret#frag", "script")],
      }),
      classInput(),
    );
    expect(dossier.url).toBe("https://example.com/work");
    expect(dossier.resources[0]?.url).toBe("https://cdn.test/app.js");
    // The derived asset row is redacted from the same source.
    expect(dossier.assets[0]?.url).toBe("https://cdn.test/app.js");
    expect(JSON.stringify(dossier)).not.toContain("token=secret");
    expect(JSON.stringify(dossier)).not.toContain("user:pass");
  });

  it("keeps the R1 three graph and reports high-confidence adapter runtime", () => {
    const dossier = buildSceneDossier(
      evidenceV2({ three: threeEvidence() }),
      classInput(),
    );
    expect(dossier.class).toBe("R1");
    expect(dossier.runtime).toEqual({
      engine: "three",
      version: "170",
      via: "adapter",
      confidence: "high",
    });
    expect(dossier.graph).toMatchObject({ truncated: false, total: 1 });
    expect(dossier.graph?.nodes).toHaveLength(1);
  });

  it("sources R3 from a resource row classified script, not frameworkHints.scripts", () => {
    const resourceUrl = "https://cdn.test/rive/hero.riv";
    const fromResource = buildSceneDossier(
      evidenceV2({
        three: threeEvidence(),
        resources: [resource(resourceUrl, "script")],
      }),
      classInput(),
    );
    expect(fromResource.class).toBe("R3");
    expect(fromResource.classReasons.join(" ")).toContain(resourceUrl);
    expect(fromResource.runtime).toEqual({
      engine: "rive",
      version: null,
      via: "resource",
      confidence: "low",
    });

    const hintsOnly = buildSceneDossier(
      evidenceV2({
        three: threeEvidence(),
        frameworkHints: {
          three: { detected: true, version: "170", scripts: [resourceUrl] },
          babylon: { detected: false, version: null, scripts: [] },
          playcanvas: { detected: false, version: null, scripts: [] },
          canvasCount: 1,
        },
      }),
      classInput({ scriptUrls: [resourceUrl] }),
    );
    expect(hintsOnly.class).toBe("R1");
    expect(hintsOnly.runtime.engine).toBe("three");
  });

  it("uses only the script-classification filter for an extensionless rive URL", () => {
    const url = "https://cdn.test/rive/hero";
    const frameworkHints = {
      three: { detected: false, version: null, scripts: ["https://cdn.test/other.js"] },
      babylon: { detected: false, version: null, scripts: [] },
      playcanvas: { detected: false, version: null, scripts: [] },
      canvasCount: 1,
    };
    const fromScriptRow = buildSceneDossier(
      evidenceV2({ resources: [resource(url, "script")], frameworkHints }),
      classInput({ scriptUrls: [url] }),
    );
    expect(fromScriptRow.class).toBe("R3");
    expect(fromScriptRow.classReasons.join(" ")).toContain("declarative runtime script");
    expect(fromScriptRow.classReasons.join(" ")).toContain(url);
    expect(fromScriptRow.runtime).toMatchObject({ engine: "rive", via: "resource" });

    // The same URL in a non-script row is not R3, even when the caller passes
    // it via input.scriptUrls: only observed script rows are consulted.
    const fromOtherRow = buildSceneDossier(
      evidenceV2({ resources: [resource(url, "other")], frameworkHints }),
      classInput({ scriptUrls: [url] }),
    );
    expect(fromOtherRow.class).toBe("R2");
  });

  it("classifies a .splinecode row as spline and a .riv row as rive", () => {
    const spline = dossierOf({
      resources: [resource("https://cdn.test/scene.splinecode", "script")],
    });
    expect(spline.class).toBe("R3");
    expect(spline.runtime.engine).toBe("spline");
    expect(spline.runtime.via).toBe("resource");

    const rive = dossierOf({ resources: [resource("https://cdn.test/app.riv", "script")] });
    expect(rive.class).toBe("R3");
    expect(rive.runtime.engine).toBe("rive");
  });

  it("caps redacted class reasons at 300 characters", () => {
    const dossier = dossierOf({
      resources: [
        resource(
          `https://cdn.test/${"a".repeat(420)}.splinecode?token=secret#frag`,
          "script",
        ),
      ],
    });
    expect(dossier.class).toBe("R3");
    expect(dossier.classReasons.length).toBeGreaterThan(0);
    for (const reason of dossier.classReasons) {
      expect(reason.length).toBeLessThanOrEqual(SCENE_DOSSIER_LIMITS.maxClassReasonChars);
      expect(reason).not.toContain("token");
      expect(reason).not.toContain("secret");
      expect(reason).not.toContain("?");
    }
  });

  it("carries bounded spector shader refs but never renders their source", () => {
    const spector = {
      id: "spector-adapter-v1",
      available: true,
      reason: "ok",
      version: "1.0",
      canvas: { width: 100, height: 100 },
      context: null,
      commands: {
        total: 0,
        drawCalls: 0,
        byName: [],
        statuses: { unknown: 0, unused: 0, disabled: 0, redundant: 0, valid: 0, deprecated: 0 },
      },
      programs: [
        {
          programStatus: { LINK_STATUS: true, VALIDATE_STATUS: true, infoLog: null },
          shaders: [
            {
              type: "VERTEX_SHADER",
              source: "SECRET_SHADER_SOURCE",
              length: 20,
              truncated: false,
            },
          ],
        },
      ],
      analyses: [],
      limits: {
        maxPrograms: 10,
        maxShaders: 20,
        maxShaderChars: 1000,
        maxTotalShaderChars: 10_000,
        maxCommandNames: 20,
        programsTruncated: false,
        shadersTruncated: false,
      },
    } satisfies SceneSpectorEvidence;
    const dossier = buildSceneDossier(
      evidenceV2({
        spector,
        url: "https://example.com/work?token=secret",
        limitations: ["line one | piped\nline two", "backslash \\| pipe"],
      }),
      classInput(),
    );
    expect(Array.isArray(dossier.shaders)).toBe(true);
    if (!Array.isArray(dossier.shaders)) throw new Error(dossier.shaders.reason);
    expect(dossier.shaders[0]?.source).toBe("SECRET_SHADER_SOURCE");

    const markdown = renderSceneDossierMarkdown(dossier);
    expect(markdown).not.toContain("SECRET_SHADER_SOURCE");
    expect(markdown).toContain("| # | scrollRatio | camera | frame hash | stable |");
    expect(markdown).toContain("line one \\| piped line two");
    // A page-derived backslash-pipe cannot escape into a live table cell.
    expect(markdown).toContain("backslash \\\\\\| pipe");
    expect(markdown).not.toContain("backslash \\| pipe");
    expect(markdown).toContain("workers are not inspected");
    expect(markdown).toContain("0 inventory rows; no asset bodies were downloaded");
    expect(markdown).toContain("Class: R2");
    // The operator summary re-redacts the page URL even if a foreign pack did not.
    expect(markdown).not.toContain("token=secret");
    expect(markdown).toContain("https://example.com/work");
  });

  it("escapes live links, images and inline code in the operator summary", () => {
    const hostile = '"><img src=x onerror=alert(1)>';
    const dossier = buildSceneDossier(
      evidenceV2({
        url: `https://x/](https://evil.example)${hostile}`,
        limitations: [hostile, "[link](https://evil.example)", "`inline`"],
      }),
      classInput(),
    );
    const markdown = renderSceneDossierMarkdown(dossier);
    expect(markdown).not.toMatch(/<img\b/i);
    expect(markdown).not.toContain("](http");
    expect(markdown).not.toContain("](");
    expect(markdown).not.toContain("`inline`");
    expect(markdown).toContain("&lt;img");
    expect(markdown).toContain("| # | scrollRatio | camera | frame hash | stable |");
  });

  it("honours a direct caller's rendererApi for the WebGPU branch", () => {
    const dossier = buildSceneDossier(evidenceV2(), classInput({ rendererApi: "webgpu" }));
    expect(dossier.class).toBe("R4");
    expect(dossier.renderer.api).toBe("webgpu");
    expect(dossier.coverage.unhookedWebGPU).toBe(true);
    expect(dossier.coverage.blindSpots).toContain("WebGPU without hooks");
    // The limitation is capture-scoped, so it stays honest for a direct caller.
    expect(dossier.limitations).toContain(SCENE_DOSSIER_LIMITATIONS.rendererApi);
  });

  it("does not mark a reachable Three scene as unhooked WebGPU", () => {
    const dossier = buildSceneDossier(
      evidenceV2({ three: threeEvidence() }),
      classInput({ rendererApi: "webgpu" }),
    );
    expect(dossier.class).toBe("R1");
    expect(dossier.coverage.unhookedWebGPU).toBe(false);
    expect(dossier.coverage.blindSpots).not.toContain("WebGPU without hooks");
  });

  it("detects babylon and playcanvas global runtimes", () => {
    const hints = (engine: "babylon" | "playcanvas", version: string) => ({
      three: { detected: false, version: null, scripts: [] },
      babylon: { detected: engine === "babylon", version: engine === "babylon" ? version : null, scripts: [] },
      playcanvas: {
        detected: engine === "playcanvas",
        version: engine === "playcanvas" ? version : null,
        scripts: [],
      },
      canvasCount: 1,
    });
    const babylon = buildSceneDossier(
      evidenceV2({ frameworkHints: hints("babylon", "7.1.0") }),
      classInput(),
    );
    expect(babylon.runtime).toEqual({
      engine: "babylon",
      version: "7.1.0",
      via: "global",
      confidence: "low",
    });
    const playcanvas = buildSceneDossier(
      evidenceV2({ frameworkHints: hints("playcanvas", "2.4.0") }),
      classInput(),
    );
    expect(playcanvas.runtime).toEqual({
      engine: "playcanvas",
      version: "2.4.0",
      via: "global",
      confidence: "low",
    });
  });

  it("merges pre-existing blind spots and tolerates missing coverage limitations", () => {
    const dossier = buildSceneDossier(
      evidenceV2({
        limitations: undefined,
        coverage: {
          status: "partial",
          collected: 1,
          excluded: 0,
          limitations: undefined,
          capabilities: CAPABILITIES,
          blindSpots: ["custom blind spot", "workers are not inspected"],
        },
      } as any),
      classInput(),
    );
    expect(dossier.coverage.blindSpots).toContain("custom blind spot");
    expect(dossier.coverage.blindSpots).toContain("workers are not inspected");
    expect(dossier.coverage.blindSpots).toContain("OffscreenCanvas is not inspected");
    expect(
      dossier.coverage.blindSpots.filter((row) => row === "workers are not inspected"),
    ).toHaveLength(1);
    expect(dossier.coverage.limitations).toEqual([]);
    expect(dossier.limitations.join(" ")).toContain("workers are not inspected");
  });
});

describe("dossier caps and shader identity", () => {
  it("caps blind spots at 20 entries of 200 characters and flags the trim", () => {
    const capped = capBlindSpots(
      Array.from({ length: 25 }, (_, index) => `${index}:` + "x".repeat(300)),
    );
    expect(capped.trimmed).toBe(true);
    expect(capped.blindSpots).toHaveLength(20);
    expect(capped.blindSpots.every((row) => row.length <= 200)).toBe(true);
    expect(capBlindSpots(["short", 42]).blindSpots).toEqual(["short"]);
  });

  it("caps a huge input quickly without unbounded membership scans", () => {
    const huge = Array.from({ length: 50_000 }, (_, index) => `blind spot ${index}`);
    const started = Date.now();
    const capped = capBlindSpots(huge);
    expect(capped.blindSpots).toHaveLength(20);
    expect(capped.trimmed).toBe(true);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("dedupes after truncation and drops empty strings", () => {
    const shared = "x".repeat(200);
    const capped = capBlindSpots([`${shared}a`, `${shared}b`]);
    expect(capped.blindSpots).toEqual([shared]);
    expect(capped.trimmed).toBe(true);

    const empties = capBlindSpots(["", "   ", "only"]);
    expect(empties.blindSpots).toEqual(["only"]);
    expect(empties.trimmed).toBe(true);
  });

  it("dedupes shaders by full source, not length plus head and tail", () => {
    const limits = {
      maxPrograms: 10,
      maxShaders: 20,
      maxShaderChars: 1_000,
      maxTotalShaderChars: 10_000,
      maxCommandNames: 20,
      programsTruncated: false,
      shadersTruncated: false,
    };
    const head = "h".repeat(64);
    const tail = "t".repeat(64);
    const first = `${head}${"a".repeat(72)}${tail}`;
    const second = `${head}${"b".repeat(72)}${tail}`;
    expect(first).toHaveLength(second.length);
    const refs = shaderRefsFromSpector({
      id: "spector-adapter-v1",
      available: true,
      reason: "ok",
      version: "1.0",
      canvas: null,
      context: null,
      commands: {
        total: 0,
        drawCalls: 0,
        byName: [],
        statuses: { unknown: 0, unused: 0, disabled: 0, redundant: 0, valid: 0, deprecated: 0 },
      },
      programs: [
        {
          programStatus: { LINK_STATUS: true, VALIDATE_STATUS: true, infoLog: null },
          shaders: [
            { type: "vertex", source: first, length: first.length, truncated: false },
            { type: "vertex", source: second, length: second.length, truncated: false },
          ],
        },
      ],
      analyses: [],
      limits,
    });
    if (!Array.isArray(refs)) throw new Error(refs.reason);
    expect(refs.map((ref) => ref.source)).toEqual([first, second]);
  });

  it("recomputes shader length from the source and flags disagreeing pack metadata", () => {
    const limits = {
      maxPrograms: 10,
      maxShaders: 20,
      maxShaderChars: 1_000,
      maxTotalShaderChars: 10_000,
      maxCommandNames: 20,
      programsTruncated: false,
      shadersTruncated: false,
    };
    const refs = shaderRefsFromSpector({
      id: "spector-adapter-v1",
      available: true,
      reason: "ok",
      version: "1.0",
      canvas: null,
      context: null,
      commands: {
        total: 0,
        drawCalls: 0,
        byName: [],
        statuses: { unknown: 0, unused: 0, disabled: 0, redundant: 0, valid: 0, deprecated: 0 },
      },
      programs: [
        {
          programStatus: { LINK_STATUS: true, VALIDATE_STATUS: true, infoLog: null },
          shaders: [
            { type: "vertex", source: "abcdef", length: 2, truncated: false },
            { type: "vertex", source: "ghij", length: 100, truncated: false },
            { type: "vertex", source: "klmn", length: 4, truncated: false },
          ],
        },
      ],
      analyses: [],
      limits,
    });
    if (!Array.isArray(refs)) throw new Error(refs.reason);
    // The pack length never wins: it is either smaller or larger than the
    // returned source, so only full.length is reported and disagreement means
    // the pack's source was truncated.
    expect(refs[0]).toMatchObject({ length: 6, truncated: true });
    expect(refs[1]).toMatchObject({ length: 4, truncated: true });
    expect(refs[2]).toMatchObject({ length: 4, truncated: false });
  });

  it("includes the spector reason when the adapter captured no frame", () => {
    const result = shaderRefsFromSpector({
      id: "spector-adapter-v1",
      available: false,
      reason: "spectorjs is not installed",
      version: null,
      canvas: null,
      context: null,
      commands: {
        total: 0,
        drawCalls: 0,
        byName: [],
        statuses: { unknown: 0, unused: 0, disabled: 0, redundant: 0, valid: 0, deprecated: 0 },
      },
      programs: [],
      analyses: [],
      limits: {
        maxPrograms: 10,
        maxShaders: 20,
        maxShaderChars: 1_000,
        maxTotalShaderChars: 10_000,
        maxCommandNames: 20,
        programsTruncated: false,
        shadersTruncated: false,
      },
    });
    expect(result).toHaveProperty("status", "unavailable");
    if (Array.isArray(result)) throw new Error("expected unavailable");
    expect(result.reason).toContain("spectorjs is not installed");
  });
});
