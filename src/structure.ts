import { CAPTURE_INSTALL_HINT } from "./capture.js";
import { resolveViewport, type ViewportName } from "./viewport.js";

export interface RawBand {
  tag: string;
  label: string;
  bg: string;
  top: number;
  height: number;
  textStart: string;
}

export interface PageBand {
  index: number;
  tag: string;
  label: string;
  background: string;
  offsetTop: number;
  height: number;
  textStart: string;
}

export interface PageStructure {
  url: string;
  title: string;
  totalHeight: number;
  bands: PageBand[];
}

/** What page.evaluate(SCAN_SNIPPET) serializes back from the page. */
export interface ScanResult {
  title: string;
  totalHeight: number;
  candidates: RawBand[];
  /** Landmark y-tops (headings + distinct-bg children ≥400px). Omitted when collection threw. */
  landmarks?: number[];
}

// Runs IN THE PAGE via page.evaluate. Collects full-width, tall, opaque
// elements as band candidates; body is always the base candidate. Gradient
// shorthand backgrounds leave backgroundColor transparent — such sections
// fall through to the nearest opaque ancestor (usually body).
//
// page.evaluate serializes plain data only, so this is a single
// self-contained function returning { title, totalHeight, candidates,
// landmarks? } (no closures over module scope; every helper below is a
// function declaration — page.evaluate re-serializes the source, so no
// arrows). The Node tsconfig has no DOM lib, so browser globals are
// reached through globalThis.
//
// The backgroundColor alpha parsing in the visit loop (including the
// modern-color-function fallback) is mirrored in test/structure.test.ts
// ("SCAN_SNIPPET alpha parsing handles space syntax and percentage alphas")
// and must stay in sync.
export const SCAN_SNIPPET = function (): ScanResult {
  const g = globalThis as any;
  const doc = g.document;
  const totalHeight = Math.round(doc.documentElement.scrollHeight);
  const bodyW = doc.body.getBoundingClientRect().width || 1;
  const bodyBg = g.getComputedStyle(doc.body).backgroundColor;
  const candidates: RawBand[] = [
    {
      tag: "body",
      label: "body",
      bg: bodyBg,
      top: 0,
      height: totalHeight,
      textStart: "",
    },
  ];
  const seen = new Set<unknown>();
  function visit(el: any, depth: number): void {
    if (depth > 6 || candidates.length >= 300 || seen.has(el)) return;
    seen.add(el);
    const r = el.getBoundingClientRect();
    if (el !== doc.body && r.width >= 0.6 * bodyW && r.height >= 120) {
      const s = g.getComputedStyle(el);
      const color = s.backgroundColor;
      // Alpha parse tolerant of legacy comma syntax and CSS Color 4
      // space syntax: rgb(r g b / a), rgb(r, g, b, a), and percentage alphas.
      // A rgba?() miss falls back by color function: modern opaque functions
      // (oklch/oklab/lab/lch/hwb/color) count as opaque (alpha 1); anything
      // else (gradients, keywords) stays conservative at alpha 0.
      const m = /rgba?\(([^)]+)\)/.exec(color);
      let alpha = 0;
      if (m) {
        const parts = m[1].replace(/\//g, " ").trim().split(/[\s,]+/).filter(Boolean);
        const aRaw = parts.length >= 4 ? parts[3] : "1";
        alpha = aRaw.endsWith("%") ? parseFloat(aRaw) / 100 : parseFloat(aRaw);
        if (Number.isNaN(alpha)) alpha = 0;
      } else if (/^(oklch|oklab|lab|lch|hwb|color)\(/.test(color.trim())) {
        alpha = 1;
      }
      if (alpha > 0) {
        candidates.push({
          tag: el.tagName.toLowerCase(),
          label: (el.id ? "#" + el.id : "") + (el.classList.length ? "." + String(el.classList[0]) : ""),
          bg: s.backgroundColor,
          top: Math.round(r.top + g.scrollY),
          height: Math.round(r.height),
          textStart: (el.textContent ?? "").trim().slice(0, 60),
        });
      }
    }
    for (const child of el.children) visit(child, depth + 1);
  }
  visit(doc.body, 0);
  // Landmark tops for band-split v2 (splitCollapsedBands filters per band at
  // match time, so the page ships ONE full-page list): heading tops plus the
  // tops of distinct-background children (computed background-color differs
  // from their parent's) at least 400px tall. Exact-deduped, sorted asc,
  // capped at 200; the walk is bounded like the candidate walk (depth ≤6,
  // ≤600 elements). try/caught: a page that throws here must still return
  // candidates with no landmarks.
  let landmarks: number[] | undefined;
  try {
    const tops: number[] = [];
    for (const h of doc.querySelectorAll("h1,h2,h3,h4,h5,h6")) {
      tops.push(Math.round(h.getBoundingClientRect().top + g.scrollY));
    }
    let walked = 0;
    function walkLandmarks(el: any, depth: number): void {
      if (depth > 6 || walked >= 600) return;
      walked++;
      if (el !== doc.body && el.parentElement) {
        const r = el.getBoundingClientRect();
        const bg = g.getComputedStyle(el).backgroundColor;
        if (r.height >= 400 && bg !== g.getComputedStyle(el.parentElement).backgroundColor) {
          tops.push(Math.round(r.top + g.scrollY));
        }
      }
      for (const child of el.children) walkLandmarks(child, depth + 1);
    }
    walkLandmarks(doc.body, 0);
    // D2 residual densify: <section>/<article>/[role=main] rect tops join the
    // landmarks — a giant band holding exactly ONE structural element is the
    // class that used to stay whole (the splitter required several in-range
    // marks). Capped at 12 so heading landmarks stay dominant in the
    // combined ≤200 list; same dedupe+sort as everything else below.
    const secTops: number[] = [];
    try {
      const secs = doc.querySelectorAll("section, article, [role=main]");
      for (let i = 0; i < secs.length && secTops.length < 12; i++) {
        try {
          secTops.push(Math.round(secs[i].getBoundingClientRect().top + g.scrollY));
        } catch {}
      }
    } catch {}
    for (let i = 0; i < secTops.length; i++) tops.push(secTops[i]);
    const unique = [...new Set(tops)];
    unique.sort(function (a: number, b: number): number { return a - b; });
    landmarks = unique.slice(0, 200);
  } catch {
    // landmarks stays undefined — the scan degrades to candidates only
  }
  const out: ScanResult = { title: doc.title, totalHeight, candidates };
  if (landmarks) out.landmarks = landmarks;
  return out;
};

// PURE: reduces raw candidates to the page's visible horizontal band map.
// Sweeps y in 8px steps; at each y the effective background is the covering
// candidate with the SMALLEST height (most specific wins). Consecutive
// same-background runs merge (first label wins); bands < 40px are absorbed
// into the previous band; the count is capped by merging the smallest band
// into its previous neighbor. Uncovered y (gaps) never emit a band.
export function collapseBands(cands: RawBand[], totalHeight: number, maxBands = 40): PageBand[] {
  // Round candidate geometry up front: the sweep samples integer y and the
  // emitted coordinates must be rounded (top 0.4 must yield a band at 0).
  const usable = cands
    .map((c) => ({ ...c, top: Math.round(c.top), height: Math.round(c.height) }))
    .filter((c) => c.height > 0);
  const STEP = 8;
  const bgAt = (y: number): RawBand | null => {
    let best: RawBand | null = null;
    for (const c of usable) {
      if (c.top <= y && y < c.top + c.height) {
        if (!best || c.height < best.height) best = c;
      }
    }
    return best;
  };
  const runs: { cand: RawBand; top: number; height: number }[] = [];
  let y = 0;
  let current: { cand: RawBand; top: number } | null = null;
  while (y < totalHeight) {
    const c = bgAt(y);
    if (current && c && c.bg === current.cand.bg) {
      // same run continues
    } else {
      if (current) runs.push({ cand: current.cand, top: current.top, height: y - current.top });
      current = c ? { cand: c, top: y } : null;
      if (!c) {
        // no candidate covers y (gap): nothing is emitted; when coverage
        // resumes the merge pass below re-joins same-bg neighbors.
      }
    }
    y += STEP;
  }
  if (current) runs.push({ cand: current.cand, top: current.top, height: totalHeight - current.top });
  // Merge adjacent same-bg runs (first label wins), absorb tiny slivers.
  // Absorbing a sliver seals the seam so a same-bg run after the sliver
  // stays its own band instead of bleeding across it.
  const merged: { cand: RawBand; top: number; height: number; sealed?: boolean }[] = [];
  for (const r of runs) {
    const prev = merged[merged.length - 1];
    if (prev && !prev.sealed && prev.cand.bg === r.cand.bg) prev.height = r.top + r.height - prev.top;
    else if (r.height < 40 && prev) {
      prev.height = r.top + r.height - prev.top;
      prev.sealed = true;
    } else merged.push({ ...r });
  }
  // Cap: merge the smallest band into its previous neighbor until <= maxBands.
  while (merged.length > maxBands && merged.length > 1) {
    let idx = 1;
    for (let i = 1; i < merged.length; i++) if (merged[i].height < merged[idx].height) idx = i;
    merged[idx - 1].height = merged[idx - 1].height + merged[idx].height;
    merged.splice(idx, 1);
  }
  return merged.map((r, i) => ({
    index: i,
    tag: r.cand.tag,
    label: r.cand.label,
    background: r.cand.bg,
    offsetTop: Math.round(r.top),
    height: Math.round(r.height),
    textStart: r.cand.textStart,
  }));
}

// PURE: band-split v2 — subdivides collapsed giant bands at landmark tops so
// a 20,000px background run stops reading as one band. A band only splits
// when it is a real giant (height ≥ 3000px) with at least one in-range
// landmark that stands ≥ 200px from both edges (no sub-band born under the
// 200px floor the merge rule enforces anyway). Several valid cuts subdivide
// at all of them; a single valid cut — the residual giants whose only mark
// is one section/article/[role=main] top (scan now records those) — splits
// ONCE into two parts. Sub-band heights are the deltas between cuts, and a
// delta < 200px merges into the previous sub-band (that landmark sits too
// close to its neighbor to stand alone); the last sub takes the remainder,
// so sub heights always sum to the parent height. Sub 0 keeps the parent's
// tag/label/bg/textStart; later subs keep tag/bg but take empty
// label/textStart — the parent's label and text describe the giant's top,
// not where those subs begin. The maxBands guard SKIPS the whole split
// instead of truncating: dropping sub-bands mid-split would fabricate
// coverage the landmarks disprove.
export function splitCollapsedBands(bands: PageBand[], landmarks: number[], maxBands = 60): PageBand[] {
  const marks = [...new Set(landmarks.filter(Number.isFinite))].sort((a, b) => a - b);
  if (!marks.length) return bands; // no landmarks: byte-identical passthrough
  const out: PageBand[] = [];
  for (const band of bands) {
    const top = band.offsetTop;
    const bottom = top + band.height;
    const inRange = marks.filter((lm) => lm > top && lm < bottom);
    const validCuts = inRange.filter((lm) => lm - top >= 200 && bottom - lm >= 200);
    const heights: number[] = [];
    if (band.height >= 3000 && validCuts.length) {
      let prev = top;
      for (const cut of [...validCuts, bottom]) {
        const delta = cut - prev;
        if (heights.length && delta < 200) heights[heights.length - 1] += delta;
        else heights.push(delta);
        prev = cut;
      }
    }
    // Running maxBands guard: a split either fits entirely or not at all.
    if (!heights.length || out.length + heights.length > maxBands) {
      out.push(band);
      continue;
    }
    let offset = top;
    for (let i = 0; i < heights.length; i++) {
      out.push({
        index: 0, // renumbered below
        tag: band.tag,
        label: i === 0 ? band.label : "",
        background: band.background,
        offsetTop: offset,
        height: heights[i],
        textStart: i === 0 ? band.textStart : "",
      });
      offset += heights[i];
    }
  }
  return out.map((b, i) => ({ ...b, index: i }));
}

/** Desktop→mobile band diff: mobile-only, desktop-only and order-changed labels. */
export interface BandDiff {
  heightDelta: number;
  bandsAdded: string[];
  bandsRemoved: string[];
  reordered: string[];
}

// PURE: compares two band maps by normalized label with the same greedy
// first-match pool as verify-build's compareBands (one other-side band can
// absorb only one base band). `heightDelta` is other − base. A label whose
// rank among greedily matched bands changes is reported once per matched pair.
export function diffBands(base: PageStructure, other: PageStructure): BandDiff {
  const norm = (s: string): string => s.trim().toLowerCase().slice(0, 24);
  const show = (s: string): string => s.trim() || "(unlabeled)";
  const pool = other.bands.map((b) => ({ key: norm(b.label), label: show(b.label), used: false }));
  const pairs: { label: string; index: number }[] = [];
  const removed: string[] = [];
  for (const band of base.bands) {
    const key = norm(band.label);
    const index = pool.findIndex((p) => !p.used && p.key === key);
    if (index === -1) {
      removed.push(show(band.label));
      continue;
    }
    pool[index]!.used = true;
    pairs.push({ label: show(band.label), index });
  }
  const added = pool.filter((p) => !p.used).map((p) => p.label);
  // Rank each matched pair by its order on the other side; a rank that moved
  // from its base position means the common bands are not in the same order.
  const otherOrder = pairs.map((_, i) => i).sort((a, b) => pairs[a]!.index - pairs[b]!.index);
  const reordered = pairs.filter((_, i) => otherOrder.indexOf(i) !== i).map((p) => p.label);
  return {
    heightDelta: Math.round(other.totalHeight - base.totalHeight),
    bandsAdded: added.slice(0, 60),
    bandsRemoved: removed.slice(0, 60),
    reordered: reordered.slice(0, 60),
  };
}

/** Wait strategy for page.goto: "load" (default, plus a fixed settle) or "networkidle". */
export type WaitStrategy = "load" | "networkidle";

export interface WaitOpts {
  waitStrategy?: WaitStrategy;
  /** Page creation profile: "desktop" (default, 1440x900) or "mobile" (390x844 @ DPR 3, touch). */
  viewport?: ViewportName;
}

// tsx (esbuild keepNames) injects __name()/__defProp helpers at module scope;
// page.evaluate serializes only the snippet function body, so those helper
// references would be undefined in the page (tsc dist never injects them).
// Install a no-op shim before navigation so tsx-run captures behave like
// compiled ones. Only snippets serialized via page.evaluate need this.
export async function installSnippetShims(page: any): Promise<void> {
  if (typeof page.addInitScript !== "function") return; // fake pages in tests
  await page.addInitScript(
    `globalThis.__name = (target, name) => { try { Object.defineProperty(target, "name", { value: name, configurable: true }); } catch {} return target; };`,
  );
}

// Scroll through the page so lazy-rendered sections have layout before a
// screenshot or band scan (spec requirement; 450px steps, brief settle, back
// to top). Shared by captureLiveSite and analyzePageStructure — this is the
// ONE implementation; capture.ts imports it.
export async function preScroll(page: any): Promise<void> {
  await page.evaluate(async () => {
    const step = 450;
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 40));
    }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 150));
  });
}

export async function analyzePageStructure(
  url: string,
  loader: () => Promise<any> = () => import("playwright" as string),
  maxBands?: number,
  opts?: WaitOpts,
): Promise<PageStructure | { error: string }> {
  let chromium: any;
  try {
    ({ chromium } = await loader());
  } catch {
    return { error: CAPTURE_INSTALL_HINT };
  }
  let browser: any;
  try {
    browser = await chromium.launch();
  } catch {
    return { error: CAPTURE_INSTALL_HINT };
  }
  try {
    const waitStrategy: WaitStrategy = opts?.waitStrategy ?? "load";
    // Viewport profile split: width/height fill playwright's `viewport` key;
    // the mobile-profile flags (deviceScaleFactor/isMobile/hasTouch) are
    // sibling context options. The desktop profile resolves to no extra
    // fields, so the default call shape is unchanged.
    const { width, height, ...contextOpts } = resolveViewport(opts?.viewport);
    const page = await browser.newPage({ viewport: { width, height }, ...contextOpts });
    await installSnippetShims(page);
    await page.goto(url, { waitUntil: waitStrategy, timeout: 45_000 });
    // "load" can fire before late XHRs settle, so give the page a fixed
    // settle window; networkidle already means the network went quiet.
    if (waitStrategy === "load") await page.waitForTimeout(3000);
    await preScroll(page);
    const raw = (await page.evaluate(SCAN_SNIPPET)) as ScanResult;
    return {
      url,
      title: raw.title,
      totalHeight: raw.totalHeight,
      bands: splitCollapsedBands(collapseBands(raw.candidates, raw.totalHeight, maxBands ?? 40), raw.landmarks ?? []),
    };
  } finally {
    try {
      await browser.close();
    } catch {
      /* keep the primary error */
    }
  }
}
