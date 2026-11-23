// Conservative R1-R4 scene classification. Missing evidence never upgrades a
// class: R1 needs an available Three adapter with BOTH a scene and a camera,
// and spector evidence is deliberately ignored because it proves a frame was
// drawn, not that a graph is reachable.
import { join } from "node:path";
import {
  SCENE_LIMITS,
  redactSceneUrl,
  sceneCapabilityReasons,
  type SceneCoverage,
  type SceneEvidenceV2,
  type SceneFrameworkHints,
  type SceneResource,
  type SceneSpectorEvidence,
  type SceneThreeEvidence,
  type SceneThreeNode,
} from "./scene-capture.js";

export type SceneClass = "R1" | "R2" | "R3" | "R4";

export interface SceneClassInput {
  three?: SceneThreeEvidence | null;
  spector?: SceneSpectorEvidence | null;
  frameworkHints: SceneFrameworkHints;
  canvasCount: number;
  rendererApi?: "webgl" | "webgl2" | "webgpu" | "unknown";
  resources: Array<Pick<SceneResource, "url">>;
  scriptUrls: string[];
}

export function classifyScene(input: SceneClassInput): { class: SceneClass; reasons: string[] } {
  for (const resource of input.resources) {
    if (/\.(?:splinecode|riv)$/i.test(resource.url)) {
      return { class: "R3", reasons: [`declarative scene file ${resource.url}`] };
    }
  }
  for (const script of input.scriptUrls) {
    if (/\/spline|splinecode|\/rive|\.riv/i.test(script)) {
      return { class: "R3", reasons: [`declarative runtime script ${script}`] };
    }
  }
  const three = input.three;
  if (three?.available && three.scene && three.camera) {
    return { class: "R1", reasons: ["reachable Three scene", "camera present"] };
  }
  if (input.rendererApi === "webgpu") {
    return { class: "R4", reasons: ["WebGPU without hooks"] };
  }
  if (input.canvasCount > 0 || input.frameworkHints.canvasCount > 0) {
    return { class: "R2", reasons: ["canvas present; no reachable scene/camera"] };
  }
  return { class: "R4", reasons: ["no canvas and no reachable scene"] };
}

export type SceneShaderStage = "vertex" | "fragment" | "compute" | "unknown";

export interface SceneShaderRef {
  id: string;
  stage: SceneShaderStage;
  source: string;
  length: number;
  truncated: boolean;
  origin: "engine-stock" | "custom" | "unknown";
}

// Three.js prefixes generated programs with these defines. Matching is
// case-sensitive on purpose: lower-case page text is not a stock preamble.
const ENGINE_STOCK_TOKENS = [
  "STANDARD",
  "PHYSICAL",
  "LAMBERT",
  "BASIC",
  "SHADOWMAP",
  "ENVMAP",
  "SKINNING",
  "USE_",
] as const;

function shaderStageOf(type: unknown): SceneShaderStage {
  const value = typeof type === "string" ? type.toLowerCase() : "";
  if (value.includes("vertex")) return "vertex";
  if (value.includes("fragment")) return "fragment";
  if (value.includes("compute")) return "compute";
  return "unknown";
}

/**
 * Bounded, deduplicated shader references from one spector frame. Source is
 * untrusted page text: it is returned as data, never executed or rewritten.
 * The pack's own limits are honored but never above the adapter's absolute caps.
 */
export function shaderRefsFromSpector(
  spector: SceneSpectorEvidence | null | undefined,
): SceneShaderRef[] | { status: "unavailable"; reason: string } {
  if (!spector) {
    return { status: "unavailable", reason: "spector adapter was not requested or did not run" };
  }
  if (spector.available !== true) {
    const why =
      typeof spector.reason === "string" && spector.reason.length > 0
        ? spector.reason.slice(0, SCENE_LIMITS.maxSpectorReasonChars)
        : "no reason recorded";
    return {
      status: "unavailable",
      reason: `the spector adapter did not capture a frame: ${why}`,
    };
  }
  const limit = (value: unknown, fallback: number): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : fallback;
  };
  const limits = spector.limits;
  const maxPrograms = Math.min(
    limit(limits?.maxPrograms, SCENE_LIMITS.maxSpectorPrograms),
    SCENE_LIMITS.maxSpectorPrograms,
  );
  const maxShaders = Math.min(
    limit(limits?.maxShaders, SCENE_LIMITS.maxSpectorShaders),
    SCENE_LIMITS.maxSpectorShaders,
  );
  const maxShaderChars = Math.min(
    limit(limits?.maxShaderChars, SCENE_LIMITS.maxSpectorShaderChars),
    SCENE_LIMITS.maxSpectorShaderChars,
  );
  const maxTotalChars = Math.min(
    limit(limits?.maxTotalShaderChars, SCENE_LIMITS.maxSpectorTotalShaderChars),
    SCENE_LIMITS.maxSpectorTotalShaderChars,
  );

  const refs: SceneShaderRef[] = [];
  const seen = new Set<string>();
  let totalChars = 0;
  const programs = Array.isArray(spector.programs)
    ? spector.programs.slice(0, maxPrograms)
    : [];
  for (const program of programs) {
    const shaders = Array.isArray(program?.shaders) ? program.shaders : [];
    for (const shader of shaders) {
      if (refs.length >= maxShaders) break;
      if (typeof shader?.source !== "string") continue;
      const full = shader.source;
      // Identity is the full source: a length+head/tail key lets two same-sized
      // shaders with different bodies collide.
      if (seen.has(full)) continue;
      seen.add(full);
      const packLength =
        typeof shader.length === "number" && Number.isFinite(shader.length) && shader.length >= 0
          ? Math.trunc(shader.length)
          : full.length;
      // The pack's length is untrusted metadata; the returned source is the
      // only authority. A disagreeing pack value is evidence of truncation, not
      // a number to copy.
      const length = full.length;
      const remaining = maxTotalChars - totalChars;
      if (remaining <= 0) break;
      const cutAt = Math.min(maxShaderChars, remaining);
      const kept = full.length > cutAt ? full.slice(0, cutAt) : full;
      totalChars += kept.length;
      refs.push({
        id: `shader-${refs.length + 1}`,
        stage: shaderStageOf(shader.type),
        source: kept,
        length,
        truncated:
          shader.truncated === true || packLength !== full.length || kept.length < full.length,
        origin: ENGINE_STOCK_TOKENS.some((token) => full.includes(token))
          ? "engine-stock"
          : "custom",
      });
    }
    if (refs.length >= maxShaders) break;
  }
  return refs;
}

export const SCENE_DOSSIER_LIMITS = {
  maxClassReasonChars: 300,
  maxBlindSpots: 20,
  maxBlindSpotChars: 200,
  maxMarkdownChars: 2 * 1024 * 1024,
} as const;

export const SCENE_DOSSIER_BLIND_SPOTS = {
  workers: "workers are not inspected",
  offscreen: "OffscreenCanvas is not inspected",
  webgpu: "WebGPU without hooks",
} as const;

export const SCENE_PASSES_UNAVAILABLE_REASON = "ordered pass topology is not captured in 1.22";

export const SCENE_DOSSIER_LIMITATIONS = {
  workers:
    "workers are not inspected: shader and render work inside Web Workers is outside this dossier.",
  offscreen:
    "OffscreenCanvas is not inspected: offscreen render targets and their contexts are outside this dossier.",
  shaderSource:
    "Shader source is untrusted page text stored as data, never executed; shader execution, uniform values and draw ordering are not observed.",
  assetRights:
    "Asset rights are unknown: inventory rows list observed URLs only, and no asset body is downloaded during capture or dossier assembly.",
  passes:
    "Ordered render-pass topology is not captured in 1.22, so renderer.passes is unavailable.",
  rendererApi:
    'Capture does not probe the renderer API: renderer.api is usually "unknown"; captured WebGPU pages with a canvas and no reachable scene classify R2, and unhookedWebGPU stays false.',
  blindSpotTrim:
    "Blind spots were trimmed to 20 entries of at most 200 characters for this dossier.",
} as const;

export type SceneRuntimeEngine =
  | "three"
  | "babylon"
  | "playcanvas"
  | "spline"
  | "rive"
  | "unknown";

export interface SceneDossierRuntime {
  engine: SceneRuntimeEngine;
  version: string | null;
  via: "adapter" | "global" | "resource" | "none";
  confidence: "high" | "low";
}

export interface SceneDossierRenderer {
  api: "webgl" | "webgl2" | "webgpu" | "unknown";
  dpr: number | null;
  toneMapping: string | null;
  colorSpace: string | null;
  passes: { status: "unavailable"; reason: string };
}

export interface SceneDossierAsset {
  assetId: string;
  url: string;
  mime: string;
  bytes: number | null;
  classification: string;
  license: "unknown";
}

export interface SceneDossierCoverage extends SceneCoverage {
  blindSpots: string[];
  workersInspected: false;
  offscreenInspected: false;
  truncatedDraws: boolean;
  unhookedWebGPU: boolean;
}

export interface SceneDossier extends SceneEvidenceV2 {
  class: SceneClass;
  classReasons: string[];
  runtime: SceneDossierRuntime;
  renderer: SceneDossierRenderer;
  graph: { nodes: SceneThreeNode[]; truncated: boolean; total: number } | null;
  assets: SceneDossierAsset[];
  shaders: SceneShaderRef[] | { status: "unavailable"; reason: string };
  coverage: SceneDossierCoverage;
  paths: SceneEvidenceV2["paths"] & { dossier: string };
}

/** Caps page-derived blind spots without dropping a proven one silently. */
export function capBlindSpots(input: unknown): { blindSpots: string[]; trimmed: boolean } {
  if (!Array.isArray(input)) return { blindSpots: [], trimmed: false };
  const max = SCENE_DOSSIER_LIMITS.maxBlindSpots;
  const maxChars = SCENE_DOSSIER_LIMITS.maxBlindSpotChars;
  // Truncation happens before dedupe, so two long rows that differ only past
  // the cap collapse to one. The Set bounds membership checks; iteration stops
  // on the first distinct row past the cap.
  const seen = new Set<string>();
  const blindSpots: string[] = [];
  let trimmed = false;
  for (const row of input) {
    if (typeof row !== "string") {
      trimmed = true;
      continue;
    }
    const collapsed = row.replace(/\s+/g, " ").trim();
    if (!collapsed) {
      trimmed = true;
      continue;
    }
    const text = collapsed.slice(0, maxChars);
    if (collapsed.length > text.length) trimmed = true;
    if (seen.has(text)) continue;
    seen.add(text);
    if (blindSpots.length >= max) {
      trimmed = true;
      break;
    }
    blindSpots.push(text);
  }
  return { blindSpots, trimmed };
}

function classReasonText(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SCENE_DOSSIER_LIMITS.maxClassReasonChars);
}

function redactedResourceUrl(raw: string): string {
  return redactSceneUrl(raw);
}

function detectRuntime(
  evidence: SceneEvidenceV2,
  three: SceneThreeEvidence | undefined,
  sceneClass: SceneClass,
): SceneDossierRuntime {
  const hints = evidence.frameworkHints;
  if (sceneClass === "R3") {
    // Only observed resource rows can identify a declarative runtime; framework
    // script hints never choose the engine for a dossier.
    for (const resource of evidence.resources) {
      const url = redactedResourceUrl(resource.url);
      if (/\.splinecode(?:$|[?#])|splinecode|\/spline/i.test(url)) {
        return { engine: "spline", version: null, via: "resource", confidence: "low" };
      }
      if (/\.riv(?:$|[?#])|\/rive/i.test(url)) {
        return { engine: "rive", version: null, via: "resource", confidence: "low" };
      }
    }
  }
  if (three?.available === true) {
    return {
      engine: "three",
      version: three.revision ?? hints?.three?.version ?? null,
      via: "adapter",
      confidence: sceneClass === "R1" ? "high" : "low",
    };
  }
  if (hints?.three?.detected) {
    return {
      engine: "three",
      version: hints.three.version ?? null,
      via: "global",
      confidence: "low",
    };
  }
  if (hints?.babylon?.detected) {
    return {
      engine: "babylon",
      version: hints.babylon.version ?? null,
      via: "global",
      confidence: "low",
    };
  }
  if (hints?.playcanvas?.detected) {
    return {
      engine: "playcanvas",
      version: hints.playcanvas.version ?? null,
      via: "global",
      confidence: "low",
    };
  }
  return { engine: "unknown", version: null, via: "none", confidence: "low" };
}

/**
 * Pure assembly of the v2 dossier from one captured pack. It adds no probe and
 * fetches nothing: runtime, renderer, passes, assets and blind spots are copied
 * or derived only from evidence the capture already holds.
 */
export function buildSceneDossier(
  evidence: SceneEvidenceV2,
  input: SceneClassInput,
): SceneDossier {
  const three = evidence.three ?? input.three ?? undefined;
  const spector = evidence.spector ?? input.spector ?? undefined;
  const frameworkHints = evidence.frameworkHints ?? input.frameworkHints;
  const canvasCount = Number.isFinite(evidence.canvas?.canvases)
    ? evidence.canvas.canvases
    : input.canvasCount;
  // Capture always passes "unknown"; a direct caller may supply a known API.
  const rendererApi = input.rendererApi ?? "unknown";
  // R3 is decided only by observed resource rows (including rows classified as
  // scripts), never by frameworkHints.scripts.
  const observedResources = evidence.resources.map((resource) => ({
    url: redactedResourceUrl(resource.url),
  }));
  const scriptUrls = evidence.resources
    .filter((resource) => resource.classification === "script")
    .map((resource) => redactedResourceUrl(resource.url));
  const classified = classifyScene({
    three,
    spector,
    frameworkHints,
    canvasCount,
    rendererApi,
    resources: observedResources,
    scriptUrls,
  });
  const classReasons = classified.reasons.map(classReasonText);

  const firstCheckpoint = evidence.checkpoints[0];
  const rawDpr = Number(firstCheckpoint?.canvas?.dpr);
  const dpr = Number.isFinite(rawDpr) && rawDpr > 0 ? rawDpr : null;
  const renderer: SceneDossierRenderer = {
    api: rendererApi,
    dpr,
    toneMapping: null,
    colorSpace: null,
    passes: { status: "unavailable", reason: SCENE_PASSES_UNAVAILABLE_REASON },
  };

  const graph = three?.scene
    ? {
        nodes: three.scene.nodes,
        truncated: three.scene.truncated,
        total: three.scene.total,
      }
    : null;

  const assets: SceneDossierAsset[] = evidence.resources.map((resource) => ({
    assetId: resource.assetId,
    url: redactedResourceUrl(resource.url),
    mime: resource.mime,
    bytes: typeof resource.bytes === "number" && Number.isFinite(resource.bytes)
      ? resource.bytes
      : null,
    classification: resource.classification,
    license: "unknown",
  }));
  // Defense in depth for direct callers: capture already redacts, and
  // redacting an already-redacted URL is idempotent.
  const redactedResources = evidence.resources.map((resource) => ({
    ...resource,
    url: redactedResourceUrl(resource.url),
  }));

  const runtime = detectRuntime(evidence, three, classified.class);
  const coverageBase = evidence.coverage ?? {
    status: "unknown",
    collected: 0,
    excluded: 0,
    limitations: [],
  };
  const rawBlindSpots = (coverageBase as unknown as { blindSpots?: unknown }).blindSpots;
  const existingBlindSpots = Array.isArray(rawBlindSpots)
    ? rawBlindSpots.filter((row): row is string => typeof row === "string")
    : [];
  // WebGPU is only unhooked when no Three adapter reached a scene; an R1 page
  // with a webgpu rendererApi is still a reachable Three scene.
  const unhookedWebGPU = renderer.api === "webgpu" && three?.available !== true;
  const blindSpotRows = [
    SCENE_DOSSIER_BLIND_SPOTS.workers,
    SCENE_DOSSIER_BLIND_SPOTS.offscreen,
    ...(unhookedWebGPU ? [SCENE_DOSSIER_BLIND_SPOTS.webgpu] : []),
    ...existingBlindSpots,
  ];
  const cappedBlindSpots = capBlindSpots(blindSpotRows);
  // Reuse the captured capabilities, refreshing only the groups an adapter
  // actually observed.
  const adjustedCapabilities = sceneCapabilityReasons(three, spector);
  const capabilities = {
    ...(coverageBase.capabilities ?? adjustedCapabilities),
    ...(three
      ? {
          scene: adjustedCapabilities.scene,
          camera: adjustedCapabilities.camera,
          controls: adjustedCapabilities.controls,
          geometry: adjustedCapabilities.geometry,
        }
      : {}),
    ...(spector ? { shaders: adjustedCapabilities.shaders } : {}),
  };
  const coverageLimitations = Array.isArray(coverageBase.limitations)
    ? [...coverageBase.limitations]
    : [];
  if (cappedBlindSpots.trimmed) coverageLimitations.push(SCENE_DOSSIER_LIMITATIONS.blindSpotTrim);
  const coverage: SceneDossierCoverage = {
    ...coverageBase,
    capabilities,
    blindSpots: cappedBlindSpots.blindSpots,
    workersInspected: false,
    offscreenInspected: false,
    truncatedDraws: false,
    unhookedWebGPU,
    limitations: coverageLimitations,
  };

  const limitations = Array.isArray(evidence.limitations) ? [...evidence.limitations] : [];
  const addLimitation = (line: string): void => {
    if (!limitations.includes(line)) limitations.push(line);
  };
  addLimitation(SCENE_DOSSIER_LIMITATIONS.workers);
  addLimitation(SCENE_DOSSIER_LIMITATIONS.offscreen);
  addLimitation(SCENE_DOSSIER_LIMITATIONS.shaderSource);
  addLimitation(SCENE_DOSSIER_LIMITATIONS.assetRights);
  addLimitation(SCENE_DOSSIER_LIMITATIONS.passes);
  addLimitation(SCENE_DOSSIER_LIMITATIONS.rendererApi);
  if (cappedBlindSpots.trimmed) addLimitation(SCENE_DOSSIER_LIMITATIONS.blindSpotTrim);

  return {
    ...evidence,
    url: redactedResourceUrl(evidence.url),
    resources: redactedResources,
    class: classified.class,
    classReasons,
    runtime,
    renderer,
    graph,
    assets,
    shaders: shaderRefsFromSpector(spector),
    coverage,
    paths: { ...evidence.paths, dossier: join(evidence.paths.dir, "dossier.md") },
    limitations,
  };
}

function markdownCell(value: unknown, max = 300): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\\/g, "\\\\")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/`/g, "\\`")
    .replace(/\|/g, "\\|")
    .slice(0, max);
}

/** Operator summary. Shader source and asset bodies never appear here. */
export function renderSceneDossierMarkdown(dossier: SceneDossier): string {
  const lines: string[] = [];
  lines.push("# Scene dossier", "");
  lines.push(`- Capture: ${markdownCell(dossier.captureId, 128)}`);
  lines.push(
    `- URL: ${markdownCell(
      redactSceneUrl(dossier.url),
      SCENE_LIMITS.maxResourceUrlChars,
    )}`,
  );
  lines.push(`- Class: ${markdownCell(dossier.class, 32)}`);
  lines.push(`- Clock: ${markdownCell(dossier.clock, 16)}`);
  lines.push(
    `- Runtime: ${markdownCell(
      `${dossier.runtime.engine}${dossier.runtime.version ? ` ${dossier.runtime.version}` : ""} ` +
        `(via ${dossier.runtime.via}, confidence ${dossier.runtime.confidence})`,
      200,
    )}`,
  );
  lines.push(
    `- Renderer: api ${markdownCell(dossier.renderer.api, 32)}, ` +
      `dpr ${markdownCell(dossier.renderer.dpr ?? "unknown", 32)}, ` +
      `toneMapping ${markdownCell(dossier.renderer.toneMapping ?? "unknown", 64)}, ` +
      `colorSpace ${markdownCell(dossier.renderer.colorSpace ?? "unknown", 64)}`,
  );
  lines.push(
    `- Passes: ${markdownCell(dossier.renderer.passes.status, 32)} ` +
      `(${markdownCell(dossier.renderer.passes.reason, 500)})`,
  );

  lines.push("", "## Class reasons", "");
  if (dossier.classReasons.length === 0) lines.push("- none");
  for (const reason of dossier.classReasons) {
    lines.push(`- ${markdownCell(reason, SCENE_DOSSIER_LIMITS.maxClassReasonChars)}`);
  }

  lines.push("", "## Keyframes", "");
  lines.push("| # | scrollRatio | camera | frame hash | stable |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const keyframe of dossier.keyframes) {
    lines.push(
      `| ${markdownCell(keyframe.index, 20)} | ${markdownCell(keyframe.scrollRatio, 32)} | ` +
        `${markdownCell(keyframe.camera?.type ?? "none", 64)} | ` +
        `${markdownCell(keyframe.frameHash.slice(0, 8), 8)} | ` +
        `${keyframe.stable ? "yes" : "no"} |`,
    );
  }

  lines.push("", "## Graph", "");
  lines.push(
    dossier.graph
      ? `- ${dossier.graph.nodes.length} of ${dossier.graph.total} nodes` +
          `${dossier.graph.truncated ? " (truncated)" : ""}`
      : "- unavailable: no reachable three scene graph",
  );

  lines.push("", "## Assets", "");
  lines.push(`- ${dossier.assets.length} inventory rows; no asset bodies were downloaded.`);
  const byClassification = new Map<string, number>();
  for (const asset of dossier.assets) {
    byClassification.set(asset.classification, (byClassification.get(asset.classification) ?? 0) + 1);
  }
  if (byClassification.size > 0) {
    lines.push(
      `- Classification: ${[...byClassification]
        .map(([name, count]) => `${markdownCell(name, 32)} ${count}`)
        .join(", ")}`,
    );
  }

  lines.push("", "## Shaders", "");
  if (Array.isArray(dossier.shaders)) {
    const origins = { "engine-stock": 0, custom: 0, unknown: 0 };
    const stages = { vertex: 0, fragment: 0, compute: 0, unknown: 0 };
    for (const shader of dossier.shaders) {
      origins[shader.origin] += 1;
      stages[shader.stage] += 1;
    }
    lines.push(
      `- ${dossier.shaders.length} shader refs; origins: engine-stock ${origins["engine-stock"]}, ` +
        `custom ${origins.custom}, unknown ${origins.unknown}; stages: vertex ${stages.vertex}, ` +
        `fragment ${stages.fragment}, compute ${stages.compute}, unknown ${stages.unknown}.`,
    );
  } else {
    lines.push(`- unavailable: ${markdownCell(dossier.shaders.reason, 500)}`);
  }

  lines.push("", "## Blind spots", "");
  if (dossier.coverage.blindSpots.length === 0) lines.push("- none");
  for (const blindSpot of dossier.coverage.blindSpots) {
    lines.push(`- ${markdownCell(blindSpot, SCENE_DOSSIER_LIMITS.maxBlindSpotChars)}`);
  }

  lines.push("", "## Limitations", "");
  if (dossier.limitations.length === 0) lines.push("- none");
  for (const limitation of dossier.limitations) {
    lines.push(`- ${markdownCell(limitation, 500)}`);
  }

  const text = `${lines.join("\n")}\n`;
  return text.length > SCENE_DOSSIER_LIMITS.maxMarkdownChars
    ? text.slice(0, SCENE_DOSSIER_LIMITS.maxMarkdownChars)
    : text;
}
