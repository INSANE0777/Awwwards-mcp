import { installSnippetShims, preScroll } from "./structure.js";
import { resolveViewport, type ViewportName } from "./viewport.js";

/** One captured frame at a scroll step: canvas toDataURL or fallback screenshot. */
export interface PoseFrame {
  label: string;
  dataUrlPng: string;
}

/** One scroll step's pose captures (scrollRatio filled in by reducePose). */
export interface PoseSnapshot {
  step: number;
  scrollY: number;
  scrollRatio: number;
  frames: PoseFrame[];
}

/** Reduced 3D-pose capture grid for one page. */
export interface PoseGrid {
  /** Grid schema version, stamped by reducePose. */
  id: "pose-grid-v1";
  url: string;
  capturedAt: number;
  steps: number;
  canvasSelector: string;
  canvasW: number;
  canvasH: number;
  snapshots: PoseSnapshot[];
  viewport: { width: number; height: number };
}

/** Raw per-page input to reducePose; totalHeight comes from the document. */
export interface PoseGridInput {
  url: string;
  capturedAt: number;
  steps: number;
  canvasSelector: string;
  canvasW: number;
  canvasH: number;
  totalHeight?: number;
  viewport: { width: number; height: number };
  snapshots: { step: number; scrollY: number; frames: PoseFrame[] }[];
}

export interface CapturePose3dOptions {
  timeoutMs?: number;
  viewport?: ViewportName;
  steps?: number;
  loader?: () => Promise<any>;
}

// Bounds for a buildable pose grid. Frames ship inline in one HTML stub, so a
// grid must be a real, finite, PNG-only capture of bounded size.
export const POSE_LIMITS = {
  maxFrames: 120,
  maxFrameBytes: 8 * 1024 * 1024,
  maxTotalBytes: 32 * 1024 * 1024,
  maxDimension: 16384,
  maxSteps: 1000,
  maxScrollY: 1_000_000_000,
} as const;

const PNG_PREFIX = "data:image/png;base64,";
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const BASE64_BODY_RE = /^[A-Za-z0-9+/]+={0,2}$/;

// Decoded size of a `data:image/png;base64,` URL whose bytes start with the
// PNG signature; null for anything else (empty, other MIME, bad base64).
export function pngDataUrlBytes(value: unknown): number | null {
  if (typeof value !== "string" || !value.startsWith(PNG_PREFIX)) return null;
  const body = value.slice(PNG_PREFIX.length);
  if (body === "" || body.length % 4 !== 0 || !BASE64_BODY_RE.test(body)) return null;
  const bytes = Buffer.from(body, "base64");
  if (bytes.length < PNG_MAGIC.length || !bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) return null;
  return bytes.length;
}

// Encoded length above which a body cannot decode within maxBytes; checked
// before Buffer decoding so a hostile payload cannot force a huge allocation.
const maxEncodedLength = (maxBytes: number): number => PNG_PREFIX.length + Math.ceil((maxBytes * 4) / 3) + 4;

export const isPngDataUrl = (value: unknown, maxBytes = POSE_LIMITS.maxFrameBytes): boolean => {
  if (typeof value !== "string" || value.length > maxEncodedLength(maxBytes)) return false;
  const bytes = pngDataUrlBytes(value);
  return bytes !== null && bytes <= maxBytes;
};

const bounded = (value: unknown, min: number, max: number): boolean =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

// Actionable, surface-neutral reason a grid cannot be rendered, or null.
// Numbers must be finite and bounded so JSON anchors can never become
// NaN/Infinity, and every frame must be a bounded PNG data URL.
export function poseGridInputError(grid: PoseGrid): string | null {
  if (!grid || typeof grid !== "object") return "poseGrid must be a pose-grid-v1 object.";
  if (!bounded(grid.steps, 1, POSE_LIMITS.maxSteps))
    return `poseGrid.steps must be a finite number between 1 and ${POSE_LIMITS.maxSteps} - re-capture the pose grid.`;
  if (!bounded(grid.canvasW, 0, POSE_LIMITS.maxDimension) || !bounded(grid.canvasH, 0, POSE_LIMITS.maxDimension))
    return `poseGrid.canvasW/canvasH must be finite sizes between 0 and ${POSE_LIMITS.maxDimension}.`;
  if (!bounded(grid.capturedAt, 0, Number.MAX_SAFE_INTEGER))
    return "poseGrid.capturedAt must be a finite timestamp - re-capture the pose grid.";
  if (!bounded(grid.viewport?.width, 0, POSE_LIMITS.maxDimension) || !bounded(grid.viewport?.height, 0, POSE_LIMITS.maxDimension))
    return `poseGrid.viewport width/height must be finite sizes between 0 and ${POSE_LIMITS.maxDimension}.`;
  if (!Array.isArray(grid.snapshots) || grid.snapshots.length === 0)
    return "poseGrid.snapshots must contain at least one captured step.";
  let frames = 0;
  let totalBytes = 0;
  for (let i = 0; i < grid.snapshots.length; i++) {
    const snap = grid.snapshots[i] as Partial<PoseSnapshot> | null | undefined;
    if (!snap || typeof snap !== "object")
      return `poseGrid.snapshots[${i}] is malformed - re-capture the pose grid.`;
    if (!bounded(snap.scrollRatio, 0, 1))
      return `poseGrid.snapshots[${i}].scrollRatio must be a finite number between 0 and 1.`;
    if (!bounded(snap.scrollY, 0, POSE_LIMITS.maxScrollY))
      return `poseGrid.snapshots[${i}].scrollY must be a finite non-negative number.`;
    if (!bounded(snap.step, 0, POSE_LIMITS.maxSteps))
      return `poseGrid.snapshots[${i}].step must be a finite step index - re-capture the pose grid.`;
    const stepFrames: unknown = snap.frames;
    if (!Array.isArray(stepFrames) || stepFrames.length === 0)
      return `poseGrid.snapshots[${i}].frames must contain at least one captured frame.`;
    for (let k = 0; k < stepFrames.length; k++) {
      const frame = stepFrames[k] as Partial<PoseFrame> | null | undefined;
      const at = `poseGrid.snapshots[${i}].frames[${k}].dataUrlPng`;
      if (!frame || typeof frame !== "object") return `poseGrid.snapshots[${i}].frames[${k}] is malformed - re-capture the pose grid.`;
      const payload = frame.dataUrlPng;
      if (typeof payload !== "string" || !payload.startsWith(PNG_PREFIX))
        return `${at} must be a PNG data URL (data:image/png;base64,...).`;
      if (payload.length > maxEncodedLength(POSE_LIMITS.maxFrameBytes))
        return `${at} exceeds the ${POSE_LIMITS.maxFrameBytes / (1024 * 1024)} MiB per-frame limit.`;
      const bytes = pngDataUrlBytes(payload);
      if (bytes === null) return `${at} must be a PNG data URL (data:image/png;base64,...).`;
      if (bytes > POSE_LIMITS.maxFrameBytes)
        return `${at} exceeds the ${POSE_LIMITS.maxFrameBytes / (1024 * 1024)} MiB per-frame limit.`;
      frames += 1;
      totalBytes += bytes;
      if (frames > POSE_LIMITS.maxFrames)
        return `poseGrid has more than ${POSE_LIMITS.maxFrames} frames - reduce steps or frames per step.`;
      if (totalBytes > POSE_LIMITS.maxTotalBytes)
        return `poseGrid frames exceed the ${POSE_LIMITS.maxTotalBytes / (1024 * 1024)} MiB total limit.`;
    }
  }
  return null;
}

// Runs IN THE PAGE via page.evaluate(POSE_SNIPPET, { canvasSelector }) — ONE
// sample per call; the step loop lives in the orchestrator. Plain `function`
// expression (no arrow — page.evaluate re-serializes the source) with zero
// outer references, browser globals through globalThis (Node tsconfig has no
// DOM lib), every probe try/caught. Mirrors SCROLL_CENSUS_SNIPPET (census.ts)
// and SCAN_SNIPPET (structure.ts). Returns only serializable scalars; totalHeight
// comes from the document so reducePose can compute per-step scroll ratios.
export const POSE_SNIPPET = function (arg: { canvasSelector: string }): {
  canvasW: number;
  canvasH: number;
  dataUrlPng: string;
  selector: string;
  rect: { x: number; y: number; width: number; height: number } | null;
  totalHeight: number;
  scrollY: number;
} {
  const g = globalThis as any;
  const doc = g.document;
  let best: any = null;
  let usedSelector = "";

  // Explicit selector wins when it resolves to a real <canvas>.
  if (arg && arg.canvasSelector) {
    try {
      const el = doc.querySelector(arg.canvasSelector);
      if (el && String(el.tagName).toLowerCase() === "canvas") {
        best = el;
        usedSelector = arg.canvasSelector;
      }
    } catch {}
  }
  if (!best) {
    // Largest visible canvas ≥200x200 (filters pixel-tracker canvases).
    try {
      const canvases = Array.from(doc.querySelectorAll("canvas")) as any[];
      let bestArea = 0;
      for (const c of canvases) {
        try {
          const r = c.getBoundingClientRect();
          const area = r.width * r.height;
          if (area > bestArea && r.width > 200 && r.height > 200) {
            best = c;
            bestArea = area;
            usedSelector = c.id ? "#" + String(c.id) : "canvas";
          }
        } catch {}
      }
    } catch {}
  }
  let totalHeight = 0;
  try {
    totalHeight = Math.round(doc.documentElement.scrollHeight);
  } catch {}
  let scrollY = 0;
  try {
    scrollY = Math.round(g.scrollY) || 0;
  } catch {}
  if (!best) return { canvasW: 0, canvasH: 0, dataUrlPng: "", selector: "", rect: null, totalHeight, scrollY };
  let rect: { x: number; y: number; width: number; height: number } | null = null;
  try {
    const r = best.getBoundingClientRect();
    rect = { x: r.x, y: r.y, width: r.width, height: r.height };
  } catch {}
  let dataUrlPng = "";
  try {
    dataUrlPng = typeof best.toDataURL === "function" ? best.toDataURL("image/png") : "";
  } catch {}
  let canvasW = 0;
  let canvasH = 0;
  try {
    canvasW = best.width || 0;
    canvasH = best.height || 0;
  } catch {}
  return { canvasW, canvasH, dataUrlPng, selector: usedSelector, rect, totalHeight, scrollY };
};

// Runs IN THE PAGE via page.evaluate(SCROLL_TO, y). Plain function expression,
// no outer references — y arrives as the evaluate argument.
const SCROLL_TO = function (y: number): void {
  try {
    (globalThis as any).scrollTo(0, Math.max(0, Math.round(y)));
  } catch {}
};

// PURE: drops steps with zero frames (no canvas and no fallback shot) and
// stamps each kept snapshot with scrollRatio = scrollY / totalHeight. When
// totalHeight is absent (0), ratios stay 0 — downstream audit treats them as
// unmeasured rather than "top of page".
export function reducePose(input: PoseGridInput): PoseGrid {
  const totalHeight = input.totalHeight ?? 0;
  const snapshots: PoseSnapshot[] = [];
  for (const s of input.snapshots) {
    if (!s.frames || s.frames.length === 0) continue;
    snapshots.push({
      step: s.step,
      scrollY: s.scrollY,
      scrollRatio: totalHeight > 0 ? s.scrollY / totalHeight : 0,
      frames: s.frames,
    });
  }
  return {
    id: "pose-grid-v1",
    url: input.url,
    capturedAt: input.capturedAt,
    steps: input.steps,
    canvasSelector: input.canvasSelector,
    canvasW: input.canvasW,
    canvasH: input.canvasH,
    snapshots,
    viewport: input.viewport,
  };
}

// Steps to sample across the page. Default 6, clamped to the MOTION plateau 3..10.
function clampSteps(steps?: number): number {
  return Math.min(10, Math.max(3, steps ?? 6));
}

// Captures a page's WebGL/canvas pose grid: loads the page (shims installed
// after newPage so tsx's __name injection stays shimmed), pre-scrolls for
// lazy layout, then samples POSE_SNIPPET at clampSteps(steps) scroll depths
// scrolling totalHeight/steps between samples with a 400ms settle. The canvas
// dataURL is preferred; a clipped viewport screenshot is the fallback frame
// when toDataURL yields empty (WebGL preserveDrawingBuffer=false and context
// loss both strip it). No canvas found is NOT an error — empty snapshots are
// dropped by reducePose and callers own the audit verdict downstream.
export async function capturePose3d(
  url: string,
  opts?: CapturePose3dOptions,
): Promise<PoseGrid | { error: string }> {
  let chrome: any;
  try {
    // Lazy default: playwright is only touched when the tool actually runs.
    const loader = opts?.loader ?? (() => import("playwright" as string));
    ({ chromium: chrome } = await loader());
    const browser = await chrome.launch();
    try {
      // Viewport profile split as in structure.ts: width/height fill the
      // `viewport` key; mobile-profile flags are sibling context options.
      const { width, height, ...contextOpts } = resolveViewport(opts?.viewport ?? "desktop");
      const page = await browser.newPage({ viewport: { width, height }, ...contextOpts });
      await installSnippetShims(page);
      await page.goto(url, { waitUntil: "load", timeout: opts?.timeoutMs ?? 45_000 });
      // "load" can fire before late XHRs settle; give the page a fixed settle
      // window (same reasoning as analyzePageStructure).
      await page.waitForTimeout(3000);
      await preScroll(page);
      await page.waitForTimeout(500);

      const steps = clampSteps(opts?.steps);
      const canvasSelector = "";
      const snapQueue: PoseGridInput["snapshots"] = [];
      let docHeight = 0;
      let usedSelector = "";
      let canvasW = 0;
      let canvasH = 0;
      for (let step = 0; step < steps; step++) {
        const raw = (await page.evaluate(POSE_SNIPPET, { canvasSelector })) as {
          canvasW: number;
          canvasH: number;
          dataUrlPng: string;
          selector: string;
          rect: { x: number; y: number; width: number; height: number } | null;
          totalHeight: number;
          scrollY: number;
        };
        docHeight = docHeight || raw.totalHeight;
        if (!usedSelector && raw.selector) usedSelector = raw.selector;
        canvasW = canvasW || raw.canvasW;
        canvasH = canvasH || raw.canvasH;
        const frames: PoseFrame[] = [];
        if (isPngDataUrl(raw.dataUrlPng)) {
          frames.push({ label: "canvas", dataUrlPng: raw.dataUrlPng });
        } else if (raw.rect && raw.rect.width > 0 && raw.rect.height > 0) {
          try {
            const shot = (await page.screenshot({ clip: raw.rect })) as Buffer;
            const dataUrlPng = "data:image/png;base64," + shot.toString("base64");
            if (isPngDataUrl(dataUrlPng)) frames.push({ label: "viewport", dataUrlPng });
          } catch {}
        }
        snapQueue.push({ step, scrollY: raw.scrollY, frames });
        if (step < steps - 1 && docHeight > 0) {
          await page.evaluate(SCROLL_TO, ((step + 1) * docHeight) / steps);
          await page.waitForTimeout(400);
        }
      }
      return reducePose({
        url,
        capturedAt: Date.now(),
        steps,
        canvasSelector: usedSelector,
        canvasW,
        canvasH,
        totalHeight: docHeight,
        viewport: { width, height },
        snapshots: snapQueue,
      });
    } finally {
      try {
        await browser.close();
      } catch {
        /* keep the primary error */
      }
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
