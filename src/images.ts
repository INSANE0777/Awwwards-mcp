import { installSnippetShims, preScroll } from "./structure.js";
import { resolveViewport } from "./viewport.js";
import type { ViewportName } from "./viewport.js";

export interface RawImage {
  currentSrc: string;
  src: string;
  complete: boolean;
  naturalWidth: number;
  naturalHeight: number;
  displayWidth: number;
  displayHeight: number;
  /** width/height attribute values (null when absent); presence drives the missing-attr counts. */
  widthAttr: string | null;
  heightAttr: string | null;
  loadingAttr: string | null;
  srcset: string | null;
  sizes: string | null;
  altAttr: string | null;
  role: string | null;
  ariaHidden: string | null;
}

export interface RawImageScan {
  /** document.images.length before the 500-row scan cap. */
  total: number;
  rows: RawImage[];
}

// Runs IN THE PAGE via page.evaluate: one pass over document.images. The row
// cap is a literal because evaluate re-serializes this function and cannot
// close over module scope. No nested named helpers: tsx injects __name for
// those and the page has no shim for this tool.
export const IMAGE_SCAN_SNIPPET = function (): RawImageScan {
  const g = globalThis as any;
  const doc = g.document;
  const imgs = doc.images;
  const total = imgs.length;
  const cap = Math.min(total, 500);
  const rows: RawImage[] = [];
  for (let i = 0; i < cap; i++) {
    const img = imgs[i];
    const rect = img.getBoundingClientRect();
    rows.push({
      currentSrc: String(img.currentSrc || ""),
      src: String(img.src || ""),
      complete: !!img.complete,
      naturalWidth: Number(img.naturalWidth) || 0,
      naturalHeight: Number(img.naturalHeight) || 0,
      displayWidth: Number(rect.width) || 0,
      displayHeight: Number(rect.height) || 0,
      loadingAttr: img.getAttribute("loading"),
      srcset: img.getAttribute("srcset"),
      sizes: img.getAttribute("sizes"),
      altAttr: img.getAttribute("alt"),
      role: img.getAttribute("role"),
      ariaHidden: img.getAttribute("aria-hidden"),
      widthAttr: img.getAttribute("width"),
      heightAttr: img.getAttribute("height"),
    });
  }
  return { total, rows };
};

export type ImageIssue =
  | "broken"
  | "oversized"
  | "tiny"
  | "missing-alt"
  | "missing-dimensions"
  | "no-srcset";

export interface ImageSample {
  src: string;
  format: string;
  width: number;
  height: number;
  displayWidth: number;
  displayHeight: number;
  issue: ImageIssue;
}

export interface ImageReport {
  total: number;
  scanned: number;
  notLoaded: number;
  byFormat: Array<{ format: string; count: number }>;
  loading: { lazy: number; eager: number; missing: number };
  responsive: { withSrcset: number; withSizes: number; missing: number };
  dimensions: {
    missingWidthAttr: number;
    missingHeightAttr: number;
    oversized: number;
    tiny: number;
    zeroRect: number;
  };
  broken: number;
  alt: { present: number; empty: number; missing: number };
  samples: ImageSample[];
  truncated: boolean;
  notes: string[];
}

const SAMPLE_CAP = 20;

const ISSUE_PRECEDENCE: ImageIssue[] = [
  "broken",
  "oversized",
  "tiny",
  "missing-alt",
  "missing-dimensions",
  "no-srcset",
];

function codePointCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function present(value: string | null): boolean {
  return value !== null && value.trim() !== "";
}

function canonicalFormat(ext: string): string {
  const e = ext.toLowerCase();
  return e === "jpg" || e === "jpe" ? "jpeg" : e;
}

function formatFromMime(mime: string): string {
  const m = /^image\/(.+)$/i.exec(mime);
  if (!m) return "other";
  return canonicalFormat(m[1]!.replace(/\+xml$/i, ""));
}

function pathnameOf(value: string): string {
  try {
    return new URL(value, "http://local.invalid").pathname;
  } catch {
    return value;
  }
}

/** Origin+pathname with query/hash stripped; data URIs collapse to `data:<mime>`. */
function sourceOf(row: RawImage): { src: string; format: string } {
  const raw = (row.currentSrc || row.src).trim();
  if (!raw) return { src: "", format: "other" };

  if (/^data:/i.test(raw)) {
    const mime = /^data:([^;,]*)/i.exec(raw)?.[1]?.trim().toLowerCase() ?? "";
    return { src: mime ? `data:${mime}` : "data:", format: formatFromMime(mime) };
  }

  const cleaned = raw.split(/[?#]/, 1)[0] ?? "";
  const ext = /\.([a-z0-9]+)$/i.exec(pathnameOf(cleaned))?.[1];
  return { src: cleaned, format: ext ? canonicalFormat(ext) : "other" };
}

function isPresentational(row: RawImage): boolean {
  const role = row.role?.trim().toLowerCase();
  return (
    role === "presentation" ||
    role === "none" ||
    row.ariaHidden?.trim().toLowerCase() === "true"
  );
}

function issueFor(row: RawImage): ImageIssue | undefined {
  const loaded = row.complete && row.naturalWidth > 0;
  const zeroRect = row.complete && (row.displayWidth <= 0 || row.displayHeight <= 0);

  if (row.complete && row.naturalWidth === 0) return "broken";
  if (
    loaded &&
    !zeroRect &&
    (row.naturalWidth > 2 * row.displayWidth || row.naturalHeight > 2 * row.displayHeight)
  ) {
    return "oversized";
  }
  if (loaded && !zeroRect && (row.displayWidth < 32 || row.displayHeight < 32)) return "tiny";
  if (!isPresentational(row) && row.altAttr === null) return "missing-alt";
  if (row.complete && (row.widthAttr === null || row.heightAttr === null)) {
    return "missing-dimensions";
  }
  if (!present(row.srcset)) return "no-srcset";
  return undefined;
}

export function summarizeImages(rows: RawImage[], maxImages: number): ImageReport {
  const total = rows.length;
  const cap = Number.isFinite(maxImages) ? Math.max(0, Math.floor(maxImages)) : total;
  const scanned = Math.min(total, cap);

  const formatCounts = new Map<string, number>();
  const loading = { lazy: 0, eager: 0, missing: 0 };
  const responsive = { withSrcset: 0, withSizes: 0, missing: 0 };
  const dimensions = {
    missingWidthAttr: 0,
    missingHeightAttr: 0,
    oversized: 0,
    tiny: 0,
    zeroRect: 0,
  };
  const alt = { present: 0, empty: 0, missing: 0 };
  let notLoaded = 0;
  let broken = 0;

  const candidates: Array<{
    row: RawImage;
    source: { src: string; format: string };
    issue: ImageIssue;
  }> = [];

  for (const row of rows.slice(0, scanned)) {
    const source = sourceOf(row);
    formatCounts.set(source.format, (formatCounts.get(source.format) ?? 0) + 1);

    const loadingAttr = row.loadingAttr?.trim().toLowerCase();
    if (loadingAttr === "lazy") loading.lazy++;
    else if (loadingAttr === "eager") loading.eager++;
    else loading.missing++;

    // Empty attributes are not responsive evidence.
    if (present(row.srcset)) responsive.withSrcset++;
    if (present(row.sizes)) responsive.withSizes++;

    if (!row.complete) notLoaded++;
    if (row.complete && row.naturalWidth === 0) broken++;

    if (row.complete) {
      if (row.widthAttr === null) dimensions.missingWidthAttr++;
      if (row.heightAttr === null) dimensions.missingHeightAttr++;
      if (row.displayWidth <= 0 || row.displayHeight <= 0) dimensions.zeroRect++;
    }

    const loaded = row.complete && row.naturalWidth > 0;
    const zeroRect = row.complete && (row.displayWidth <= 0 || row.displayHeight <= 0);
    if (loaded && !zeroRect) {
      if (
        row.naturalWidth > 2 * row.displayWidth ||
        row.naturalHeight > 2 * row.displayHeight
      ) {
        dimensions.oversized++;
      }
      if (row.displayWidth < 32 || row.displayHeight < 32) dimensions.tiny++;
    }

    if (row.altAttr === null) alt.missing++;
    else if (row.altAttr.trim() === "") alt.empty++;
    else alt.present++;

    const issue = issueFor(row);
    if (issue) candidates.push({ row, source, issue });
  }

  responsive.missing = scanned - responsive.withSrcset;

  const byFormat = [...formatCounts.entries()]
    .map(([format, count]) => ({ format, count }))
    .sort((a, b) => b.count - a.count || codePointCompare(a.format, b.format));

  // Guarantee one sample per issue kind first, then fill in document order.
  const chosen = new Set<number>();
  for (const issue of ISSUE_PRECEDENCE) {
    if (chosen.size >= SAMPLE_CAP) break;
    const index = candidates.findIndex((candidate) => candidate.issue === issue);
    if (index >= 0) chosen.add(index);
  }
  for (let i = 0; i < candidates.length && chosen.size < SAMPLE_CAP; i++) chosen.add(i);

  const samples = [...chosen].map((index) => {
    const candidate = candidates[index]!;
    return {
      src: candidate.source.src,
      format: candidate.source.format,
      width: candidate.row.naturalWidth,
      height: candidate.row.naturalHeight,
      displayWidth: candidate.row.displayWidth,
      displayHeight: candidate.row.displayHeight,
      issue: candidate.issue,
    };
  });

  const samplesCapHit = candidates.length > SAMPLE_CAP;
  const truncated = total > scanned || samplesCapHit;

  const notes = [
    "alt.missing includes presentational images; samples do not flag role=presentation, role=none, or aria-hidden=true as missing-alt; alt is evidence, not a WCAG grade",
  ];
  if (total > scanned) notes.push(`scanned ${scanned} of ${total} images (maxImages=${cap})`);
  if (samplesCapHit) notes.push(`samples capped at ${SAMPLE_CAP} issue-bearing images`);

  return {
    total,
    scanned,
    notLoaded,
    byFormat,
    loading,
    responsive,
    dimensions,
    broken,
    alt,
    samples,
    truncated,
    notes,
  };
}

export interface ScanImagesOptions {
  viewport?: ViewportName;
  timeoutMs?: number;
  loader?: () => Promise<any>;
}

// Browser lifecycle for analyze_images: lazy/injectable loader (same shape as
// captureComponent), load + fixed settle, fonts, shared preScroll so the page's
// own lazy loading fires, then one IMAGE_SCAN_SNIPPET evaluate. No asset
// fetches are initiated here — the page loads its own images.
export async function scanImages(
  url: string,
  opts?: ScanImagesOptions,
): Promise<RawImageScan | { error: string }> {
  let chrome: any;
  try {
    const loader = opts?.loader ?? (() => import("playwright" as string));
    ({ chromium: chrome } = await loader());
    const browser = await chrome.launch();
    try {
      // Viewport profile split as in captureComponent.
      const { width, height, ...contextOpts } = resolveViewport(opts?.viewport ?? "desktop");
      const page = await browser.newPage({ viewport: { width, height }, ...contextOpts });
      await installSnippetShims(page);
      await page.goto(url, { waitUntil: "load", timeout: opts?.timeoutMs ?? 45_000 });
      // "load" can fire before late XHRs settle; fixed settle window.
      await page.waitForTimeout(3000);
      await page.evaluate(function () {
        const g = globalThis as any;
        return g.document && g.document.fonts ? g.document.fonts.ready : undefined;
      });
      await preScroll(page);
      return (await page.evaluate(IMAGE_SCAN_SNIPPET)) as RawImageScan;
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
