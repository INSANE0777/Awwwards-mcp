import { describe, expect, it } from "vitest";
import { POSE_SNIPPET, pngDataUrlBytes, reducePose, capturePose3d } from "../src/pose3d.js";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_URL = "data:image/png;base64," + Buffer.concat([PNG_MAGIC, Buffer.from([1, 2, 3])]).toString("base64");

describe("POSE_SNIPPET source contract", () => {
  it("is a plain function expression (no arrows)", () => {
    const src = String(POSE_SNIPPET);
    expect(src).not.toContain("=>");
    expect(src.trimStart().startsWith("function")).toBe(true);
  });
  it("mirrors census capture contract: no direct awwwards references", () => {
    expect(String(POSE_SNIPPET)).not.toMatch(/awwwards/i);
  });
});

describe("pngDataUrlBytes", () => {
  it("accepts only data:image/png;base64 payloads with the PNG signature", () => {
    expect(pngDataUrlBytes(PNG_URL)).toBe(PNG_MAGIC.length + 3);
    expect(pngDataUrlBytes("data:image/jpeg;base64," + PNG_URL.slice("data:image/png;base64,".length))).toBeNull();
    expect(pngDataUrlBytes("data:image/png;base64,AA==")).toBeNull(); // too short for the signature
    expect(pngDataUrlBytes("data:image/png;base64,not base64!!")).toBeNull();
    expect(pngDataUrlBytes("")).toBeNull();
  });
});

describe("reducePose", () => {
  const snap = (scrollY: number, labels: string[]) => ({
    step: scrollY, scrollY,
    frames: labels.map((label) => ({ label, dataUrlPng: PNG_URL })),
  });
  // totalHeight is the reducer's optional extra input (document scrollHeight,
  // measured in-page by the snippet); 1800 keeps the pinned 900/1800 ratio.
  const base = {
    url: "https://example.dev", capturedAt: 5, steps: 4,
    canvasSelector: "#hero-canvas", canvasW: 1920, canvasH: 1080,
    totalHeight: 1800,
    viewport: { width: 1440, height: 900 },
  };
  it("keeps snapshots and computes per-step scroll ratio", () => {
    const grid = reducePose({ ...base, snapshots: [snap(0, ["hero"]), snap(900, ["hero"])] });
    expect(grid.id).toBe("pose-grid-v1");
    expect(grid.snapshots).toHaveLength(2);
    expect(grid.snapshots[1].scrollRatio).toBeCloseTo(0.5); // 900 / (1800 total)
  });
  it("drops empty snapshot steps", () => {
    const grid = reducePose({ ...base, snapshots: [snap(0, ["hero"]), snap(600, [])] });
    expect(grid.snapshots).toHaveLength(1);
  });
  it("defaults scrollRatio to 0 when totalHeight is absent", () => {
    const { totalHeight: _ignored, ...noHeight } = base;
    const grid = reducePose({ ...noHeight, snapshots: [snap(900, ["hero"])] });
    expect(grid.snapshots[0].scrollRatio).toBe(0);
  });
});

// One in-page sample as POSE_SNIPPET returns it (scalar+rect shape only —
// page.evaluate serializes plain data).
const raw = (over: Partial<{
  canvasW: number; canvasH: number; dataUrlPng: string; selector: string;
  rect: { x: number; y: number; width: number; height: number } | null;
  totalHeight: number; scrollY: number;
}>) => ({
  canvasW: 1280, canvasH: 720, dataUrlPng: PNG_URL,
  selector: "canvas#stage", rect: null,
  totalHeight: 5400, scrollY: 0,
  ...over,
});

// Offline orchestrator harness: fake page (snippet evaluate always returns the
// fixture), fake browser handing it out, loader resolving a fake chromium.
// Screenshots are recorded so the toDataURL-failure fallback can be asserted.
function harness(sample: ReturnType<typeof raw>) {
  const screenshots: unknown[] = [];
  const fakePage = {
    addInitScript: async () => {},
    goto: async () => {},
    waitForTimeout: async () => {},
    evaluate: async () => sample,
    screenshot: async (opts: unknown) => {
      screenshots.push(opts);
      return Buffer.concat([PNG_MAGIC, Buffer.from([0x00])]);
    },
  };
  const fakeBrowser = {
    newPage: async () => fakePage,
    close: async () => {},
  };
  const loader = async () => ({
    chromium: { launch: async () => fakeBrowser },
  });
  return { loader, screenshots };
}

describe("capturePose3d", () => {
  it("steps the page and reduces a grid through a fake browser", async () => {
    const { loader } = harness(raw({}));
    const result = await capturePose3d("https://example.com", { loader });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.steps).toBe(6); // default
    expect(result.snapshots).toHaveLength(6);
    expect(result.snapshots[0].frames[0].label).toBe("canvas");
    expect(result.snapshots[0].frames[0].dataUrlPng).toBe(PNG_URL);
    expect(result.canvasSelector).toBe("canvas#stage");
    expect(result.canvasW).toBe(1280);
    expect(result.canvasH).toBe(720);
    expect(result.viewport).toEqual({ width: 1440, height: 900 });
    expect(result.capturedAt).toBeGreaterThan(0);
  });

  it("clamps steps to 3..10", async () => {
    const { loader } = harness(raw({}));
    const hi = await capturePose3d("u", { loader, steps: 99 });
    const lo = await capturePose3d("u", { loader, steps: 1 });
    expect("error" in hi).toBe(false);
    expect("error" in lo).toBe(false);
    if (!("error" in hi) && !("error" in lo)) {
      expect(hi.steps).toBe(10);
      expect(hi.snapshots).toHaveLength(10);
      expect(lo.steps).toBe(3);
      expect(lo.snapshots).toHaveLength(3);
    }
  });

  it("falls back to a clipped viewport frame when the canvas dataURL is empty", async () => {
    const { loader, screenshots } = harness(raw({
      dataUrlPng: "",
      rect: { x: 0, y: 0, width: 1280, height: 720 },
    }));
    const result = await capturePose3d("u", { loader, steps: 3 });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.snapshots).toHaveLength(3);
    for (const s of result.snapshots) {
      expect(s.frames).toHaveLength(1);
      expect(s.frames[0].label).toBe("viewport");
      expect(s.frames[0].dataUrlPng.startsWith("data:image/png;base64,")).toBe(true);
    }
    expect(screenshots).toHaveLength(3);
    expect(screenshots[0]).toEqual({ clip: { x: 0, y: 0, width: 1280, height: 720 } });
  });

  it("ignores a non-PNG toDataURL and falls back to the screenshot", async () => {
    const { loader, screenshots } = harness(raw({
      dataUrlPng: "</script><script>alert(1)</script>",
      rect: { x: 0, y: 0, width: 1280, height: 720 },
    }));
    const result = await capturePose3d("u", { loader, steps: 3 });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    for (const s of result.snapshots) {
      expect(s.frames[0].label).toBe("viewport");
      expect(pngDataUrlBytes(s.frames[0].dataUrlPng)).not.toBeNull();
    }
    expect(screenshots).toHaveLength(3);
  });

  it("returns { error } when the browser fails to launch", async () => {
    const loader = async () => ({
      chromium: {
        launch: async () => {
          throw new Error("boom");
        },
      },
    });
    const result = await capturePose3d("u", { loader });
    expect("error" in result).toBe(true);
    expect(JSON.stringify(result)).toContain("boom");
  });
});
