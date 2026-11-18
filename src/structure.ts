import { attachPage, closeAttached, validateCdpEndpoint, ATTACH_ENV } from "./browser.js";
import { CAPTURE_INSTALL_HINT, waitForOverlays } from "./capture.js";
import { resolveViewport, type ViewportName, type ViewportProfile } from "./viewport.js";

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

/** How the page scrolls; inferred from layout, never a replay guarantee. */
export type ScrollMode = "document" | "element" | "virtual" | "canvas";

export interface PageStructure {
  url: string;
  finalUrl?: string;
  title: string;
  totalHeight: number;
  bands: PageBand[];
  /** Detected inner scroll container (`tag#id.class`); absent when no element scroller was found (document, virtual or canvas pages). */
  scrollRoot?: string;
  /** Inferred scroll mode; absent on scans produced before this field existed. */
  scrollMode?: ScrollMode;
  /** Diagnostic wrapper label (`tag#id.class`) only with scrollMode "virtual"; not a guaranteed unique selector and never a replay root. */
  virtualRoot?: string;
  /** Short explanation for non-document modes (e.g. canvas-only pages). */
  note?: string;
  /** Mobile-only element evidence; absent unless the capture asked for it. */
  responsive?: ResponsiveReport;
  /** Additive marker: this scan ran on an attached page and never navigated. */
  attached?: boolean;
}

/** Raw element evidence serialized out of the page (selector parts are innermost-first). */
export interface RawResponsiveElement {
  parts: string[];
  x: number;
  y: number;
  w: number;
  h: number;
  detail: string;
}

/** Raw mobile scan. `counts` are pre-cap totals; arrays are capped in the page. */
export interface RawResponsiveScan {
  innerWidth: number;
  scrollWidth: number;
  counts: { overflow: number; smallText: number; smallTapTarget: number };
  overflow: RawResponsiveElement[];
  smallText: RawResponsiveElement[];
  smallTapTarget: RawResponsiveElement[];
}

export interface ResponsiveIssue {
  kind: "overflow" | "small-text" | "small-tap-target";
  selector: string;
  rect: { x: number; y: number; w: number; h: number };
  detail: string;
}

export interface ResponsiveReport {
  measuredAt: "mobile";
  viewport: { width: number; height: number; dpr: number };
  pageOverflow: { horizontal: boolean; scrollWidth: number; innerWidth: number };
  issues: ResponsiveIssue[];
  counts: { overflow: number; smallText: number; smallTapTarget: number };
  truncated: boolean;
}

/** What page.evaluate(SCAN_SNIPPET) serializes back from the page. */
export interface ScanResult {
  title: string;
  totalHeight: number;
  candidates: RawBand[];
  /** Detected inner scroll container (`tag#id.class`); absent for document, virtual and canvas pages. */
  scrollRoot?: string;
  /** Inferred scroll mode; always set by the current snippet. */
  scrollMode?: ScrollMode;
  /** Diagnostic virtual wrapper label; only with scrollMode "virtual". */
  virtualRoot?: string;
  /** Short explanation for non-document modes (e.g. canvas-only pages). */
  note?: string;
  /** Landmark y-tops (headings + distinct-bg children ≥400px). Omitted when collection threw. */
  landmarks?: number[];
  /** Mobile element evidence; omitted unless the snippet was called with responsive:true. */
  responsive?: RawResponsiveScan;
}

// Runs IN THE PAGE via page.evaluate. Collects full-width, tall, opaque
// elements as band candidates; body is always the base candidate. Gradient
// shorthand backgrounds leave backgroundColor transparent — such sections
// fall through to the nearest opaque ancestor (usually body).
//
// page.evaluate serializes plain data only, so this is a single
// self-contained function returning { title, totalHeight, candidates,
// responsive? } (no closures over module scope; every helper below is a
// function declaration — page.evaluate re-serializes the source, so no
// arrows). The Node tsconfig has no DOM lib, so browser globals are
// reached through globalThis.
//
// The backgroundColor alpha parsing in the visit loop (including the
// modern-color-function fallback) is mirrored in test/structure.test.ts
// ("SCAN_SNIPPET alpha parsing handles space syntax and percentage alphas")
// and must stay in sync.
export const SCAN_SNIPPET = function (args: { responsive?: boolean }): ScanResult {
  const g = globalThis as any;
  const doc = g.document;

  // The real scroll container. Sites that pin body (position:fixed) and scroll
  // an inner div never grow documentElement.scrollHeight, so without this the
  // whole page reads as one viewport-tall band. Only when the document itself
  // does not scroll (otherwise a code block or nav menu would win): largest
  // visible element whose overflow-y auto/scroll actually overflows;
  // body/html never qualify. Mirrored inline in preScroll.
  function findScrollRoot(): any {
    let best: any = null;
    let bestArea = 0;
    try {
      const de = doc.documentElement;
      // Quirks-mode documents report clientHeight as the full content height,
      // so compare the taller of html/body against the real viewport instead.
      const bodyHeight = doc.body ? Number(doc.body.scrollHeight || 0) : 0;
      const viewportHeight = Number(g.innerHeight || de.clientHeight || 0);
      if (Math.max(Number(de.scrollHeight || 0), bodyHeight) > viewportHeight + 100) return null;
      const all = doc.querySelectorAll("*");
      for (let i = 0; i < all.length; i++) {
        const el = all[i];
        if (el === doc.body || el === doc.documentElement) continue;
        if (!(el.scrollHeight > el.clientHeight + 100)) continue;
        const s = g.getComputedStyle(el);
        if (String(s.overflowY) !== "auto" && String(s.overflowY) !== "scroll") continue;
        if (String(s.display) === "none" || String(s.visibility) === "hidden") continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        const area = r.width * r.height;
        if (area > bestArea) {
          bestArea = area;
          best = el;
        }
      }
    } catch {}
    return best;
  }

  // Empty-shape clip proof, mirrored from src/atlas/scan.ts. Only inset(),
  // circle(), ellipse() and legacy rect() can be proven empty; polygon(),
  // path() and url() shapes are never rejected on shape alone.
  function resolveClipLength(token: any, base: number): number | null {
    const match = /^(-?\d*\.?\d+)(px|%)?$/.exec(String(token ?? ""));
    if (!match) return null;
    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) return null;
    if (match[2] === "%") return (amount / 100) * base;
    // Unitless lengths are only valid as zero.
    return match[2] === undefined && amount !== 0 ? null : amount;
  }
  function insetClipRegion(
    value: any,
    rect: any,
  ): { left: number; top: number; right: number; bottom: number } | null {
    const text = String(value ?? "").trim().toLowerCase();
    if (text.includes("round")) return null;
    const inner = /^inset\(([\s\S]*)\)$/.exec(text)?.[1];
    if (inner === undefined) return null;
    const tokens = inner.split(/[\s,]+/).filter(Boolean);
    if (tokens.length === 0 || tokens.length > 4) return null;
    const width = Number(rect.width || 0);
    const height = Number(rect.height || 0);
    const topToken = tokens[0];
    const rightToken = tokens[1] ?? topToken;
    const bottomToken = tokens[2] ?? topToken;
    const leftToken = tokens[3] ?? rightToken;
    const top = resolveClipLength(topToken, height);
    const right = resolveClipLength(rightToken, width);
    const bottom = resolveClipLength(bottomToken, height);
    const left = resolveClipLength(leftToken, width);
    if (top === null || right === null || bottom === null || left === null) return null;
    return {
      left: rect.left + left,
      top: rect.top + top,
      right: rect.right - right,
      bottom: rect.bottom - bottom,
    };
  }
  // Rectangular inset for affirmative visibility. Rounded corners cannot be
  // resolved to area here, so `round` is not an accepted rectangle.
  function insetClipRect(
    value: any,
    rect: any,
  ): { left: number; top: number; right: number; bottom: number } | null {
    const text = String(value ?? "").trim().toLowerCase();
    if (text.includes("round")) return null;
    const inner = /^inset\(([\s\S]*)\)$/.exec(text)?.[1];
    if (inner === undefined) return null;
    return insetClipRegion(`inset(${inner})`, rect);
  }

  // Legacy `clip: rect(top, right, bottom, left)` for canvas area. Offsets
  // are relative to the border box; `auto` resolves to that box's edge, and
  // anything else non-px is unresolved.
  function legacyClipRect(
    value: any,
    rect: any,
  ): { left: number; top: number; right: number; bottom: number } | null {
    const text = String(value ?? "").trim().toLowerCase();
    const match = /^rect\(([^)]*)\)$/.exec(text);
    if (!match) return null;
    const parts = String(match[1] ?? "").split(/[\s,]+/).filter(Boolean);
    if (parts.length !== 4) return null;
    const edges: number[] = [];
    const autoEdges = [0, rect.width, rect.height, 0];
    for (let i = 0; i < 4; i++) {
      const part = parts[i]!;
      if (part === "auto") {
        edges.push(Number(autoEdges[i] || 0));
        continue;
      }
      const m = /^(-?\d*\.?\d+)(px)?$/.exec(part);
      if (!m) return null;
      edges.push(Number(m[1]));
    }
    return {
      left: rect.left + edges[3]!,
      top: rect.top + edges[0]!,
      right: rect.left + edges[1]!,
      bottom: rect.top + edges[2]!,
    };
  }
  // All-zero inset: a no-op clip, so it cannot be the reason a canvas is
  // rejected under a transform chain.
  function zeroInsetClip(value: any): boolean {
    const text = String(value ?? "").trim().toLowerCase();
    if (text.includes("round")) return false;
    const inner = /^inset\(([\s\S]*)\)$/.exec(text)?.[1];
    if (inner === undefined) return false;
    const tokens = inner.split(/[\s,]+/).filter(Boolean);
    if (tokens.length === 0 || tokens.length > 4) return false;
    for (const token of tokens) {
      const match = /^(-?\d*\.?\d+)(px|%)?$/.exec(token);
      if (!match || Number(match[1]) !== 0) return false;
    }
    return true;
  }
  // `zoom` scales layout and local clip geometry like a transform.
  function hasNonDefaultZoom(value: any): boolean {
    const text = String(value ?? "").trim().toLowerCase();
    if (!text || text === "normal") return false;
    const amount = parseFloat(text);
    if (!Number.isFinite(amount)) return true;
    return text.indexOf("%") >= 0 ? amount !== 100 : amount !== 1;
  }
  // Individual transform properties (scale/rotate/translate) compose with
  // `transform`; zoom scales too. Any non-default one makes local clip
  // geometry unmappable.
  function hasTransformLike(style: any): boolean {
    return (
      String(style.transform || "none") !== "none" ||
      String(style.scale || "none") !== "none" ||
      String(style.rotate || "none") !== "none" ||
      String(style.translate || "none") !== "none" ||
      hasNonDefaultZoom(style.zoom)
    );
  }
  function hasTransformChain(node: any): boolean {
    let cur = node;
    let depth = 0;
    while (cur && cur.nodeType === 1 && depth < 100) {
      if (hasTransformLike(g.getComputedStyle(cur))) return true;
      cur = cur.parentElement;
      depth++;
    }
    return false;
  }
  // `width`/`height` are fractional layout dimensions when untransformed.
  // Under a transform they are transformed client dimensions, so only
  // percentage sums >= 100% (or zero shapes) can prove emptiness; local px
  // insets cannot be mapped through an unknown transform.
  function clipPathEmpty(
    value: any,
    width: number,
    height: number,
    transformed: boolean,
  ): boolean {
    const text = String(value ?? "").trim().toLowerCase();
    if (!text || text === "none") return false;
    const call = /^([a-z-]+)\(([\s\S]*)\)$/.exec(text);
    if (!call) return false;
    const kind = call[1];
    const tokens = String(call[2] ?? "")
      .split(" round ")[0]!
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean);
    if (kind === "inset") {
      if (transformed) {
        if (!(width > 0 && height > 0)) return true; // zero-size box
        if (tokens.length === 0 || tokens.length > 4) return false;
        const topToken = tokens[0];
        const rightToken = tokens[1] ?? topToken;
        const bottomToken = tokens[2] ?? topToken;
        const leftToken = tokens[3] ?? rightToken;
        // Percent-equivalent value, or null when a nonzero px/unknown unit
        // cannot be resolved without the untransformed layout box.
        function percent(token: any): number | null {
          const match = /^(-?\d*\.?\d+)(px|%)?$/.exec(String(token ?? ""));
          if (!match) return null;
          const amount = Number(match[1]);
          if (!Number.isFinite(amount)) return null;
          if (match[2] === "%") return amount;
          return amount === 0 ? 0 : null;
        }
        const top = percent(topToken);
        const right = percent(rightToken);
        const bottom = percent(bottomToken);
        const left = percent(leftToken);
        return (
          (top !== null && bottom !== null && top + bottom >= 100) ||
          (left !== null && right !== null && left + right >= 100)
        );
      }
      // Rounding only shrinks the region, so the rectangle decides emptiness.
      const region = insetClipRegion(
        `inset(${String(call[2] ?? "").split(" round ")[0]!})`,
        { left: 0, top: 0, right: width, bottom: height, width, height },
      );
      return (
        region !== null && (!(region.right > region.left) || !(region.bottom > region.top))
      );
    }
    if (kind === "circle") {
      if (transformed) {
        const match = /^(-?\d*\.?\d+)(px|%)?$/.exec(tokens[0] ?? "");
        return !!match && Number(match[1]) === 0;
      }
      const radius = resolveClipLength(tokens[0], Math.hypot(width, height) / Math.SQRT2);
      return radius !== null && radius <= 0;
    }
    if (kind === "ellipse") {
      if (transformed) {
        if (tokens.length < 2) return false;
        for (let ti = 0; ti < 2; ti++) {
          const match = /^(-?\d*\.?\d+)(px|%)?$/.exec(tokens[ti] ?? "");
          if (match && Number(match[1]) === 0) return true;
        }
        return false;
      }
      const rx = resolveClipLength(tokens[0], width);
      const ry = resolveClipLength(tokens[1], height);
      return rx !== null && ry !== null && (rx <= 0 || ry <= 0);
    }
    // polygon()/path()/url() shapes are not proven empty here.
    return false;
  }
  function legacyClipEmpty(style: any, transformed: boolean): boolean {
    const position = String(style.position || "");
    if (position !== "absolute" && position !== "fixed") return false;
    const value = String(style.clip || "").trim().toLowerCase();
    if (!value || value === "auto") return false;
    const match = /^rect\(([^)]*)\)$/.exec(value);
    if (!match) return false;
    const parts = String(match[1] ?? "").split(/[\s,]+/).filter(Boolean);
    if (parts.length !== 4) return false;
    const lengths: number[] = [];
    for (const part of parts) {
      if (part === "auto") return false;
      const amount = Number.parseFloat(part);
      if (!Number.isFinite(amount)) return false;
      lengths.push(amount);
    }
    // A transformed px rect can only prove emptiness when it is all zeros;
    // other empty rects are local px and cannot be mapped.
    if (transformed) {
      return lengths.every(function (length) {
        return length === 0;
      });
    }
    return lengths[0]! >= lengths[2]! || lengths[3]! >= lengths[1]!;
  }
  function emptyShapeClip(node: any, style: any): boolean {
    if (String(style.display || "") === "contents") return false;
    const clipPath = String(style.clipPath || "none");
    const clipPosition = String(style.position || "");
    const legacyClip = String(style.clip || "").trim().toLowerCase();
    const hasLegacyClip =
      (clipPosition === "absolute" || clipPosition === "fixed") &&
      !!legacyClip &&
      legacyClip !== "auto";
    // Only clipping nodes pay for the transform-chain walk.
    const transformed =
      clipPath !== "none" || hasLegacyClip ? hasTransformChain(node) : false;
    if (clipPath !== "none") {
      const rect = node.getBoundingClientRect();
      const width = Number(rect.width || 0);
      const height = Number(rect.height || 0);
      if (clipPathEmpty(clipPath, width, height, transformed)) return true;
    }
    return legacyClipEmpty(style, transformed);
  }

  // Conservative visibility/fixed/clip walk for virtual-root and canvas
  // candidates. body/html are exempt from the fixed and overflow vetoes: a
  // pinned body is the page shell on smooth-scroll sites, not an overlay.
  // Opacity does not inherit, so every ancestor is walked. An empty clip-path
  // or legacy clip proves no paint anywhere, so it applies to roots too.
  // Mirrored inline in preScroll.
  function ancestry(el: any): {
    hidden: boolean;
    fixed: boolean;
    clipped: boolean;
    clipEmpty: boolean;
  } {
    let hidden = false;
    let fixed = false;
    let clipped = false;
    let clipEmpty = false;
    let cur = el;
    let depth = 0;
    while (cur && cur.nodeType === 1 && depth < 100) {
      const s = g.getComputedStyle(cur);
      const isRoot = cur === doc.body || cur === doc.documentElement;
      if (
        String(s.display) === "none" ||
        String(s.visibility) === "hidden" ||
        String(s.visibility) === "collapse" ||
        String(s.contentVisibility || "") === "hidden" ||
        parseFloat(String(s.opacity || "1")) === 0 ||
        /(?:^|\s)opacity\(\s*0(?:\.0+)?%?\s*\)/.test(String(s.filter || "").toLowerCase())
      ) {
        hidden = true;
      }
      if (!isRoot && String(s.position) === "fixed") fixed = true;
      if (!isRoot && (String(s.overflowY) === "hidden" || String(s.overflowY) === "clip")) {
        clipped = true;
      }
      if (emptyShapeClip(cur, s)) clipEmpty = true;
      if (isRoot) break;
      cur = cur.parentElement;
      depth++;
    }
    return { hidden: hidden, fixed: fixed, clipped: clipped, clipEmpty: clipEmpty };
  }

  // A body that is itself the scroll container (html pinned, body
  // overflow-y:auto|scroll) has tall in-flow content, not translated content.
  // Treating a section as a virtual wrapper there both invents a mode and
  // truncates totalHeight, so it is vetoed separately from overflow roots.
  function bodyOverflows(): boolean {
    try {
      const body = doc.body;
      if (!body) return false;
      const s = g.getComputedStyle(body);
      const overflowY = String(s.overflowY || "");
      if (overflowY !== "auto" && overflowY !== "scroll") return false;
      const clientHeight = Number(body.clientHeight || 0);
      // Any real overflow counts: a 950px body in a 900px viewport is still
      // the page's scroll container, not a one-viewport document.
      return clientHeight > 0 && Number(body.scrollHeight || 0) > clientHeight;
    } catch {
      return false;
    }
  }

  // Virtual-scroll fallback (Lenis/Locomotive-style transform scrolling): the
  // document never scrolls and no element has overflow auto/scroll, but a
  // wide in-flow wrapper is laid out far taller than the viewport and gets
  // moved by transform. Tallest wins; DOM order makes the outermost win ties.
  // This is bounded layout evidence, NOT proof of a working scroll controller.
  // Mirrored inline in preScroll.
  function findVirtualRoot(): any {
    let best: any = null;
    let bestHeight = 0;
    try {
      const de = doc.documentElement;
      const scrolling = doc.scrollingElement;
      // The document's real scroll extent. body.scrollHeight is not it: a
      // pinned body still reports clipped/translated content height.
      const rootHeight = Number(
        (scrolling && scrolling.scrollHeight !== undefined
          ? scrolling.scrollHeight
          : de.scrollHeight) || 0,
      );
      const viewportHeight = Number(g.innerHeight || de.clientHeight || 0);
      if (rootHeight > viewportHeight + 100) return null;
      if (bodyOverflows()) return null;
      const bodyWidth = doc.body.getBoundingClientRect().width || 1;
      const all = doc.querySelectorAll("*");
      for (let i = 0; i < all.length && i < 20000; i++) {
        const el = all[i];
        if (el === doc.body || el === doc.documentElement) continue;
        // A tall canvas is scene content, not a translated DOM wrapper.
        if (String(el.tagName || "").toLowerCase() === "canvas") continue;
        const r = el.getBoundingClientRect();
        if (!(r.width >= 0.6 * bodyWidth) || !(r.height > viewportHeight + 100)) continue;
        if (!(r.height > bestHeight)) continue;
        const a = ancestry(el);
        if (a.hidden || a.fixed || a.clipped || a.clipEmpty) continue;
        bestHeight = r.height;
        best = el;
      }
    } catch {}
    return best;
  }

  // Canvas-only page: neither the viewport/body overflow root nor a virtual
  // root is taller than the viewport, but one visible canvas covers >= 80% of
  // the viewport area. Visibility matters: a display:none / hidden /
  // transparent canvas is not a scene. Clip/overflow matter too: a 100x100
  // overflow:hidden hole or a deep clip-path inset can leave only a sliver of
  // a big canvas, while a full-size shell still shows the whole canvas. Only
  // provable rectangular insets, resolvable legacy rect() clips and
  // non-visible overflow are intersected. Any other clip-path shape (circle,
  // ellipse, polygon, path, url, calc, rounded inset) or unresolvable legacy
  // clip leaves dominance unknown and declines the canvas; it never counts
  // the unclipped rect.
  function hasViewportCanvas(): boolean {
    try {
      const vw = Number(g.innerWidth || 0);
      const vh = Number(g.innerHeight || 0);
      if (!(vw > 0 && vh > 0)) return false;
      const canvases = doc.querySelectorAll("canvas");
      for (let i = 0; i < canvases.length; i++) {
        const canvas = canvases[i];
        const a = ancestry(canvas);
        if (a.hidden || a.clipEmpty) continue;
        // Under a transform chain, local clip lengths and ancestor boxes
        // cannot be mapped into client space. Any real clipping then leaves
        // dominance unknown: only none/all-zero insets are neutral.
        const transformed = hasTransformChain(canvas);
        let unknownClip = false;
        const r = canvas.getBoundingClientRect();
        let left = Math.max(r.left, 0);
        let top = Math.max(r.top, 0);
        let right = Math.min(r.right, vw);
        let bottom = Math.min(r.bottom, vh);
        // The canvas's own clip-path and every ancestor's inset clip-path clip
        // painting; overflow on ancestors clips descendants. Intersect with
        // border-box rects (borders ignored).
        let cur = canvas;
        let depth = 0;
        while (cur && cur.nodeType === 1 && depth < 100) {
          const s = g.getComputedStyle(cur);
          if (String(s.display || "") !== "contents") {
            const clipPath = String(s.clipPath || "none");
            if (clipPath !== "none") {
              if (transformed) {
                if (!zeroInsetClip(clipPath)) unknownClip = true;
              } else {
                const clipRect = cur === canvas ? r : cur.getBoundingClientRect();
                const region = insetClipRect(clipPath, clipRect);
                if (region) {
                  left = Math.max(left, region.left);
                  top = Math.max(top, region.top);
                  right = Math.min(right, region.right);
                  bottom = Math.min(bottom, region.bottom);
                } else {
                  // Unresolved shape cannot prove >= 80% visible area.
                  unknownClip = true;
                }
              }
            }
            const clipPosition = String(s.position || "");
            const legacyClip = String(s.clip || "").trim().toLowerCase();
            if (
              (clipPosition === "absolute" || clipPosition === "fixed") &&
              legacyClip &&
              legacyClip !== "auto"
            ) {
              if (transformed) {
                unknownClip = true;
              } else {
                const clipRect = cur === canvas ? r : cur.getBoundingClientRect();
                const region = legacyClipRect(legacyClip, clipRect);
                if (region) {
                  left = Math.max(left, region.left);
                  top = Math.max(top, region.top);
                  right = Math.min(right, region.right);
                  bottom = Math.min(bottom, region.bottom);
                } else {
                  unknownClip = true;
                }
              }
            }
          }
          if (cur !== canvas) {
            const clipsX = String(s.overflowX || "visible") !== "visible";
            const clipsY = String(s.overflowY || "visible") !== "visible";
            if (clipsX || clipsY) {
              if (transformed) {
                unknownClip = true;
              } else {
                // Overflow clips to the padding box, not the border box: a
                // 300px border must not count as visible canvas area.
                const box = cur.getBoundingClientRect();
                const clientWidth = Number(cur.clientWidth || 0);
                const clientHeight = Number(cur.clientHeight || 0);
                if (clientWidth > 0 && clientHeight > 0) {
                  const clientLeft = Number(cur.clientLeft || 0);
                  const clientTop = Number(cur.clientTop || 0);
                  left = Math.max(left, box.left + clientLeft);
                  top = Math.max(top, box.top + clientTop);
                  right = Math.min(right, box.left + clientLeft + clientWidth);
                  bottom = Math.min(bottom, box.top + clientTop + clientHeight);
                } else {
                  unknownClip = true;
                }
              }
            }
          }
          cur = cur.parentElement;
          depth++;
        }
        if (unknownClip) continue;
        const w = right - left;
        const h = bottom - top;
        if (!(w > 0 && h > 0) || (w * h) / (vw * vh) < 0.8) continue;
        return true;
      }
    } catch {}
    return false;
  }

  function cssEscape(value: any): string {
    const css = g.CSS;
    if (css && typeof css.escape === "function") return String(css.escape(String(value)));
    // shortcut: fallback for old engines/fake pages without CSS.escape — it
    // covers the punctuation this label uses, not every CSS ident edge case.
    return String(value).replace(/[^A-Za-z0-9_\u00A0-\uFFFF-]/g, "\\$&");
  }

  function scrollRootLabel(el: any): string {
    const tag = String(el.tagName || "").toLowerCase();
    const id = el.id ? "#" + cssEscape(el.id) : "";
    const cls = el.classList && el.classList.length ? "." + cssEscape(el.classList[0]) : "";
    return tag + id + cls;
  }

  const scroller = findScrollRoot();
  const bodyOverflow = bodyOverflows();
  const virtualRoot = scroller ? null : findVirtualRoot();
  const virtualRect = virtualRoot ? virtualRoot.getBoundingClientRect() : null;
  const virtualTop = virtualRect ? virtualRect.top : 0;
  const scrollerRect = scroller ? scroller.getBoundingClientRect() : null;
  const scrollerTop = scrollerRect ? scrollerRect.top : 0;
  const scrollerScrollTop = scroller ? scroller.scrollTop || 0 : 0;
  const scrollingRoot = doc.scrollingElement;
  // Virtual/canvas gates ask whether the viewport itself scrolls, so they use
  // the scrolling element. Document totalHeight needs the body fallback: when
  // body is the actual overflow container, its content is the page height.
  // A pinned/hidden body's scrollHeight only reports clipped or transformed
  // overflow, which must not inflate a document page.
  const rootHeight = Number(
    (scrollingRoot && scrollingRoot.scrollHeight !== undefined
      ? scrollingRoot.scrollHeight
      : doc.documentElement.scrollHeight) || 0,
  );
  const bodyHeight = doc.body ? Number(doc.body.scrollHeight || 0) : 0;
  const documentHeight = bodyOverflow ? Math.max(rootHeight, bodyHeight) : rootHeight;
  const totalHeight = Math.round(
    scroller ? scroller.scrollHeight : virtualRect ? virtualRect.height : documentHeight,
  );

  // Only the translated wrapper's own subtree is virtual content space. Fixed
  // chrome and siblings outside it stay viewport-anchored, so a fixed header
  // does not inherit the wrapper's negative top.
  function inVirtual(el: any): boolean {
    let cur = el;
    let depth = 0;
    while (cur && cur.nodeType === 1 && depth < 100) {
      if (cur === virtualRoot) return true;
      cur = cur.parentElement;
      depth++;
    }
    return false;
  }

  // Content y in the scanned scroll container's coordinates: the document
  // root adds window scroll; an element scroller subtracts its viewport top
  // and adds its own scrollTop; a virtual wrapper subtracts its own translated
  // top for its whole subtree. Fixed descendants of the transformed wrapper
  // are virtual content too: the transform makes the wrapper their containing
  // block, so their rect already carries the translation. Only siblings
  // outside the subtree stay viewport-anchored. The pure coordinateY helper
  // covers the document and element branches only.
  function coordY(r: any, el?: any): number {
    if (virtualRect) {
      if (el && !inVirtual(el)) return Math.round(r.top);
      return Math.round(r.top - virtualTop);
    }
    return Math.round(scrollerRect ? r.top - scrollerTop + scrollerScrollTop : r.top + g.scrollY);
  }

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
          top: coordY(r, el),
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
      tops.push(coordY(h.getBoundingClientRect(), h));
    }
    let walked = 0;
    function walkLandmarks(el: any, depth: number): void {
      if (depth > 6 || walked >= 600) return;
      walked++;
      if (el !== doc.body && el.parentElement) {
        const r = el.getBoundingClientRect();
        const bg = g.getComputedStyle(el).backgroundColor;
        if (r.height >= 400 && bg !== g.getComputedStyle(el.parentElement).backgroundColor) {
          tops.push(coordY(r, el));
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
          secTops.push(coordY(secs[i].getBoundingClientRect(), secs[i]));
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
  if (scroller) {
    out.scrollRoot = scrollRootLabel(scroller);
    out.scrollMode = "element";
  } else if (virtualRoot) {
    out.scrollMode = "virtual";
    // Diagnostic only: never reuse this as scrollRoot / replay identity.
    out.virtualRoot = scrollRootLabel(virtualRoot);
  } else if (!bodyOverflow && rootHeight <= Number(g.innerHeight || 0) + 100 && hasViewportCanvas()) {
    out.scrollMode = "canvas";
    out.note =
      "A visible canvas covers the viewport; DOM bands cannot describe content drawn inside it and additional DOM UI may still exist. Use motion recording or 3D scene capture for canvas motion/scene evidence.";
  } else {
    out.scrollMode = "document";
  }
  if (landmarks) out.landmarks = landmarks;
  // Responsive evidence, mobile captures only. One pass in document
  // coordinates; every rule is independent and the whole block degrades to no
  // responsive key if anything throws, so band scanning never fails because of
  // it. Counts are pre-cap totals; arrays keep at most 10.
  if (args && args.responsive === true) {
    try {
      // Emulated mobile widens window.innerWidth to the content width, so
      // overflow is measured against the layout client width instead.
      const viewportWidth = doc.documentElement.clientWidth || g.innerWidth;
      const scrollWidth = doc.documentElement.scrollWidth;
      const counts = { overflow: 0, smallText: 0, smallTapTarget: 0 };
      const overflow: RawResponsiveElement[] = [];
      const smallText: RawResponsiveElement[] = [];
      const smallTapTarget: RawResponsiveElement[] = [];
      const all = doc.querySelectorAll("*");

      function isVisible(el: any, r: any): boolean {
        if (r.width <= 0 || r.height <= 0) return false;
        const s = g.getComputedStyle(el);
        if (s.display === "none" || s.visibility === "hidden" || s.visibility === "collapse") {
          return false;
        }
        if (parseFloat(String(s.opacity || "1")) === 0) return false;
        // sr-only boxes (1x1 + clip / clip-path: inset(50%)) have a rect but
        // are not visible; clip without percentages normalizes to this form.
        const clip = String(s.clip || "");
        const clipPath = String(s.clipPath || "");
        if (clip === "rect(0px, 0px, 0px, 0px)" || clipPath === "inset(50%)") return false;
        return true;
      }

      // Same rule as a11y.ts selectorFor: id stops the walk, classList[0]
      // only, at most 4 parts (self + 3 ancestors).
      function selectorParts(el: any): string[] {
        const parts: string[] = [];
        let cur = el;
        let depth = 0;
        while (cur && cur.nodeType === 1 && depth < 4) {
          const tag = String(cur.tagName || "").toLowerCase();
          if (cur.id) {
            parts.push(tag + "#" + String(cur.id));
            break;
          }
          let part = tag;
          const cls = cur.classList && cur.classList.length ? String(cur.classList[0]) : "";
          if (cls && /^[A-Za-z0-9_-]+$/.test(cls)) part += "." + cls;
          parts.push(part);
          cur = cur.parentElement;
          depth++;
        }
        return parts;
      }

      function snapshot(el: any, detail: string): RawResponsiveElement {
        const r = el.getBoundingClientRect();
        return {
          parts: selectorParts(el),
          x: Math.round(r.left + g.scrollX),
          y: coordY(r, el),
          w: Math.round(r.width),
          h: Math.round(r.height),
          detail: detail,
        };
      }

      function hasDirectText(el: any): boolean {
        const nodes = el.childNodes;
        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i];
          if (node.nodeType === 3 && String(node.textContent || "").trim() !== "") return true;
        }
        return false;
      }

      function insideScroller(el: any): boolean {
        let cur = el.parentElement;
        let depth = 0;
        // Walk to the document root; 100 is only a hostile-DOM safety bound.
        while (cur && cur.nodeType === 1 && depth < 100) {
          // A clip/transform on body or html is page-wide: it would mask every
          // offender, so only a descendant ancestor may exclude an element.
          const isRoot = cur === doc.body || cur === doc.documentElement;
          const s = g.getComputedStyle(cur);
          if (s.overflowX === "auto" || s.overflowX === "scroll") return true;
          if (s.overflowX === "hidden" && !isRoot) return true;
          if (hasTransformLike(s) && !isRoot) return true;
          cur = cur.parentElement;
          depth++;
        }
        return false;
      }

      // Overflow offenders: document right edge past the viewport, not inside
      // a horizontal scroller or transformed ancestor; keep the widest 10.
      const overflowCandidates: Array<{ el: any; over: number }> = [];
      for (let i = 0; i < all.length; i++) {
        const el = all[i];
        const r = el.getBoundingClientRect();
        if (r.width > 0) {
          const right = r.left + g.scrollX + r.width;
          if (right > viewportWidth + 1 && !insideScroller(el)) {
            counts.overflow++;
            overflowCandidates.push({ el: el, over: right - viewportWidth });
          }
        }
      }
      overflowCandidates.sort(function (a, b): number { return b.over - a.over; });
      for (let i = 0; i < overflowCandidates.length && overflow.length < 10; i++) {
        const item = overflowCandidates[i];
        if (item) {
          overflow.push(snapshot(item.el, "overflows viewport by " + Math.round(item.over) + "px"));
        }
      }

      // Small text: a direct non-empty text node below the 12px floor.
      for (let i = 0; i < all.length; i++) {
        const el = all[i];
        if (!hasDirectText(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || !isVisible(el, r)) continue;
        const size = parseFloat(String(g.getComputedStyle(el).fontSize || ""));
        if (!(size < 12)) continue;
        counts.smallText++;
        if (smallText.length < 10) {
          smallText.push(snapshot(el, "font-size " + Math.round(size * 10) / 10 + "px < 12px"));
        }
      }

      // Small tap targets: interactive elements under 24px in either axis.
      // Inline prose links are excluded — their click box is the text run.
      const taps = doc.querySelectorAll("a[href], button, input, select, textarea, [role=button]");
      for (let i = 0; i < taps.length; i++) {
        const el = taps[i];
        const r = el.getBoundingClientRect();
        if (!isVisible(el, r)) continue;
        const isInlineLink =
          String(el.tagName || "").toLowerCase() === "a" &&
          g.getComputedStyle(el).display === "inline";
        if (isInlineLink) continue;
        if (r.width >= 24 && r.height >= 24) continue;
        counts.smallTapTarget++;
        if (smallTapTarget.length < 10) {
          smallTapTarget.push(
            snapshot(el, Math.round(r.width) + "×" + Math.round(r.height) + "px < 24px"),
          );
        }
      }

      out.responsive = {
        innerWidth: viewportWidth,
        scrollWidth: scrollWidth,
        counts: counts,
        overflow: overflow,
        smallText: smallText,
        smallTapTarget: smallTapTarget,
      };
    } catch {
      // responsive stays undefined — the band scan is never failed by this
    }
  }
  return out;
};

// PURE: content y for the document and element scroller branches. Document
// scrolling adds window.scrollY to the viewport rect; an inner scroller
// subtracts its own viewport top and adds its scrollTop. SCAN_SNIPPET mirrors
// these two branches inline and adds a scan-local virtual branch here.
export function coordinateY(
  rectTop: number,
  docScrollY: number,
  scroller?: { top: number; scrollTop: number } | null,
): number {
  return Math.round(scroller ? rectTop - scroller.top + scroller.scrollTop : rectTop + docScrollY);
}

// PURE: joins raw selector parts (innermost-first) into a readable path.
// The page snippet collects the parts because page.evaluate cannot import the
// a11y selectorFor helper; the 160-char cap matches it.
export function selectorFromParts(parts: string[]): string {
  return parts.slice().reverse().join(" > ").slice(0, 160);
}

// PURE: classifies a raw mobile scan into the public report. Per-kind order is
// overflow → small-text → small-tap-target; each kind is defensively capped at
// 10 again. counts stay the page's pre-cap totals, and truncated is true when a
// cap hid anything.
export function buildResponsiveReport(
  raw: RawResponsiveScan,
  viewport: ViewportProfile = resolveViewport("mobile"),
): ResponsiveReport {
  const issues: ResponsiveIssue[] = [];
  function add(kind: ResponsiveIssue["kind"], els: RawResponsiveElement[]): void {
    for (const el of els.slice(0, 10)) {
      issues.push({
        kind,
        selector: selectorFromParts(el.parts),
        rect: { x: el.x, y: el.y, w: el.w, h: el.h },
        detail: el.detail,
      });
    }
  }
  add("overflow", raw.overflow);
  add("small-text", raw.smallText);
  add("small-tap-target", raw.smallTapTarget);
  return {
    measuredAt: "mobile",
    // The capture profile, not a literal: a different phone profile (or a
    // desktop capture that requested evidence) must report what it measured.
    viewport: {
      width: viewport.width,
      height: viewport.height,
      dpr: viewport.deviceScaleFactor ?? 1,
    },
    pageOverflow: {
      horizontal: raw.scrollWidth > raw.innerWidth + 1,
      scrollWidth: raw.scrollWidth,
      innerWidth: raw.innerWidth,
    },
    issues,
    counts: { ...raw.counts },
    truncated:
      raw.counts.overflow > Math.min(raw.overflow.length, 10) ||
      raw.counts.smallText > Math.min(raw.smallText.length, 10) ||
      raw.counts.smallTapTarget > Math.min(raw.smallTapTarget.length, 10),
  };
}

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
  const norm = (s: string): string => s.trim().toLowerCase();
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
  /** Mobile only: collect overflow, small-text and small-tap-target evidence. */
  responsive?: boolean;
  /** Attach to a loopback CDP endpoint (requires AWWWARDS_MCP_ATTACH=1); never navigates, scrolls, clicks or creates tabs. */
  cdpEndpoint?: string;
  /** Route every launched-browser connection through this loopback guard proxy. */
  proxyServer?: string;
}

/** What preScroll measured after its walk. `scrollRoot` is the detected inner scroller label; null when no element scroller was found (document, virtual or canvas pages). */
export interface PreScrollInfo {
  scrollRoot: string | null;
  scrollHeight: number;
  clientHeight: number;
  /** Diagnostic layout height of a credible virtual wrapper; no scrolling is possible or implied. */
  virtualHeight?: number;
}

// tsx (esbuild keepNames) injects __name()/__defProp helpers at module scope;
// page.evaluate serializes only the snippet function body, so those helper
// references would be undefined in the page (tsc dist never injects them).
// Install a no-op shim before navigation so tsx-run captures behave like
// compiled ones. Only snippets serialized via page.evaluate need this.
export const SNIPPET_SHIM_SOURCE =
  `globalThis.__name = globalThis.__name || ((target, name) => { try { Object.defineProperty(target, "name", { value: name, configurable: true }); } catch {} return target; });`;

export async function installSnippetShims(page: any): Promise<void> {
  if (typeof page.addInitScript !== "function") return; // fake pages in tests
  await page.addInitScript(SNIPPET_SHIM_SOURCE);
}

// Attached pages are already loaded, so addInitScript never runs for them.
// One-shot string evaluate installs the same no-op shim before the scan:
// harmless on compiled builds, required when the server runs under tsx.
export async function installAttachedShim(page: any): Promise<void> {
  if (typeof page.evaluate !== "function") return; // fake pages in tests
  await page.evaluate(SNIPPET_SHIM_SOURCE);
}

// Hard caps for one preScroll walk. The in-page function cannot close over
// module scope (page.evaluate re-serializes it), so the same literals are
// repeated below and pinned by test/structure.test.ts — keep them in sync.
export const MAX_PRESCROLL_STEPS = 80;
export const PRE_SCROLL_DEADLINE_MS = 8_000;

// Scroll through the page so lazy-rendered sections have layout before a
// screenshot or band scan (spec requirement; 450px steps, brief settle, back
// to top). Shared by captureLiveSite and analyzePageStructure — this is the
// ONE implementation; capture.ts imports it. Scrolls the detected inner
// scroll container when the page has one (body-pinned sites), else window.
// Both walks stop at MAX_PRESCROLL_STEPS/8s even when scrollHeight keeps
// growing, and always reset to the top. Returns the detected inner scroller
// label + final metrics so capture can re-query it; existing callers ignore it.
// scrollMode/virtualRoot/note live on the scan, not here. A virtual wrapper
// only contributes a diagnostic virtualHeight: scrollRoot stays null, so no
// caller mistakes it for a replayable element scroller.
export async function preScroll(page: any): Promise<PreScrollInfo> {
  return page.evaluate(async function () {
    const g = globalThis as any;
    const doc = g.document;
    // The real document scroller; body.scrollHeight includes clipped and
    // transformed overflow and cannot answer whether the document scrolls.
    const scrollingRoot =
      doc.scrollingElement && doc.scrollingElement.scrollHeight !== undefined
        ? doc.scrollingElement
        : doc.documentElement;
    const step = 450;
    const maxSteps = 80; // MAX_PRESCROLL_STEPS
    const deadlineMs = 8000; // PRE_SCROLL_DEADLINE_MS
    const started = Date.now();
    // Mirror of SCAN_SNIPPET's findScrollRoot, kept inline (no nested named
    // function): this evaluate can run before the tsx __name shim is installed.
    let scroller: any = null;
    let bestArea = 0;
    try {
      const de = doc.documentElement;
      // Quirks-mode documents report clientHeight as the content height, so
      // compare html/body height against the real viewport (mirrors scan).
      const bodyHeight = doc.body ? Number(doc.body.scrollHeight || 0) : 0;
      const viewportHeight = Number(g.innerHeight || de.clientHeight || 0);
      if (!(Math.max(Number(de.scrollHeight || 0), bodyHeight) > viewportHeight + 100)) {
        const all = doc.querySelectorAll("*");
        for (let i = 0; i < all.length; i++) {
          const el = all[i];
          if (el === doc.body || el === doc.documentElement) continue;
          if (!(el.scrollHeight > el.clientHeight + 100)) continue;
          const s = g.getComputedStyle(el);
          if (String(s.overflowY) !== "auto" && String(s.overflowY) !== "scroll") continue;
          if (String(s.display) === "none" || String(s.visibility) === "hidden") continue;
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) continue;
          const area = r.width * r.height;
          if (area > bestArea) {
            bestArea = area;
            scroller = el;
          }
        }
      }
    } catch {}
    // Same tag#id.class[0] label SCAN_SNIPPET emits, escaped the same way
    // (inlined: this evaluate can run before the tsx __name shim, so it may
    // declare no named helpers).
    const css = g.CSS;
    let scrollRoot: string | null = null;
    if (scroller) {
      const id = scroller.id
        ? "#" +
          (css && typeof css.escape === "function"
            ? String(css.escape(String(scroller.id)))
            : String(scroller.id).replace(/[^A-Za-z0-9_\u00A0-\uFFFF-]/g, "\\$&"))
        : "";
      const cls =
        scroller.classList && scroller.classList.length
          ? "." +
            (css && typeof css.escape === "function"
              ? String(css.escape(String(scroller.classList[0])))
              : String(scroller.classList[0]).replace(/[^A-Za-z0-9_\u00A0-\uFFFF-]/g, "\\$&"))
          : "";
      scrollRoot = String(scroller.tagName || "").toLowerCase() + id + cls;
    }
    if (scroller) {
      // A scroll-behavior:smooth container animates each assignment, so a walk
      // without this pin would advance while the browser is still scrolling.
      const inlineBehavior = scroller.style
        ? scroller.style.getPropertyValue("scroll-behavior")
        : "";
      const inlinePriority = scroller.style
        ? scroller.style.getPropertyPriority("scroll-behavior")
        : "";
      let y = 0;
      let steps = 0;
      try {
        if (scroller.style) scroller.style.setProperty("scroll-behavior", "auto", "important");
        while (steps < maxSteps && Date.now() - started < deadlineMs && y < scroller.scrollHeight) {
          scroller.scrollTop = y;
          await new Promise((r) => setTimeout(r, 40));
          y += step;
          steps++;
        }
        scroller.scrollTop = 0;
      } finally {
        if (scroller.style) {
          if (inlineBehavior) scroller.style.setProperty("scroll-behavior", inlineBehavior, inlinePriority);
          else scroller.style.removeProperty("scroll-behavior");
        }
      }
      await new Promise((r) => setTimeout(r, 150));
      return {
        scrollRoot: scrollRoot,
        scrollHeight: Math.round(scroller.scrollHeight || 0),
        clientHeight: Math.round(scroller.clientHeight || 0),
      };
    }
    let y = 0;
    let steps = 0;
    while (
      steps < maxSteps &&
      Date.now() - started < deadlineMs &&
      y <
        Math.max(
          Number(doc.documentElement.scrollHeight || 0),
          doc.body ? Number(doc.body.scrollHeight || 0) : 0,
        )
    ) {
      g.window.scrollTo({ left: 0, top: y, behavior: "instant" });
      await new Promise((r) => setTimeout(r, 40));
      y += step;
      steps++;
    }
    g.window.scrollTo({ left: 0, top: 0, behavior: "instant" });
    await new Promise((r) => setTimeout(r, 150));
    // Measure after the walk and reset: lazy pages append sections or grow
    // wrappers while scrolling, and the gates plus returned metrics must
    // describe the final layout the scan will see, not the pre-walk one.
    // Body-as-scroller: tall in-flow content, not a translated wrapper.
    let bodyOverflow = false;
    try {
      const body = doc.body;
      if (body) {
        const s = g.getComputedStyle(body);
        const overflowY = String(s.overflowY || "");
        const clientHeight = Number(body.clientHeight || 0);
        bodyOverflow =
          (overflowY === "auto" || overflowY === "scroll") &&
          clientHeight > 0 &&
          Number(body.scrollHeight || 0) > clientHeight;
      }
    } catch {}
    const rootHeight = Number(scrollingRoot ? scrollingRoot.scrollHeight || 0 : 0);
    const bodyHeight = doc.body ? Number(doc.body.scrollHeight || 0) : 0;
    // Mirror of SCAN_SNIPPET's findVirtualRoot negatives, inline: the document
    // did not scroll, so report the wrapper's layout height as a diagnostic.
    // Clipped/fixed/hidden/narrow wrappers never qualify, and no scrolling of
    // the wrapper is attempted.
    let virtualHeight = 0;
    try {
      const de = doc.documentElement;
      const viewportHeight = Number(g.innerHeight || de.clientHeight || 0);
      if (!bodyOverflow && !(rootHeight > viewportHeight + 100)) {
        const bodyWidth = doc.body.getBoundingClientRect().width || 1;
        const all = doc.querySelectorAll("*");
        for (let i = 0; i < all.length && i < 20000; i++) {
          const el = all[i];
          if (el === doc.body || el === doc.documentElement) continue;
          if (String(el.tagName || "").toLowerCase() === "canvas") continue;
          const r = el.getBoundingClientRect();
          if (!(r.width >= 0.6 * bodyWidth) || !(r.height > viewportHeight + 100)) continue;
          if (!(r.height > virtualHeight)) continue;
          let rejected = false;
          let cur = el;
          let depth = 0;
          while (cur && cur.nodeType === 1 && depth < 100) {
            const s = g.getComputedStyle(cur);
            const isRoot = cur === doc.body || cur === doc.documentElement;
            if (
              String(s.display) === "none" ||
              String(s.visibility) === "hidden" ||
              String(s.visibility) === "collapse" ||
              String(s.contentVisibility || "") === "hidden" ||
              parseFloat(String(s.opacity || "1")) === 0 ||
              /(?:^|\s)opacity\(\s*0(?:\.0+)?%?\s*\)/.test(String(s.filter || "").toLowerCase()) ||
              (!isRoot && String(s.position) === "fixed") ||
              (!isRoot && (String(s.overflowY) === "hidden" || String(s.overflowY) === "clip"))
            ) {
              rejected = true;
              break;
            }
            // Empty clip-path / legacy clip proves the subtree paints nothing.
            // The shape parser is inlined (no nested named helpers here) and
            // mirrors SCAN_SNIPPET / src/atlas/scan.ts: inset, circle, ellipse
            // and legacy rect only; polygon/path/url are not proof. Fractional
            // rect geometry is used, and under a transform only zero shapes or
            // percentage sums >= 100% prove emptiness.
            if (String(s.display || "") !== "contents") {
              const clipPath = String(s.clipPath || "none");
              const clipPosition = String(s.position || "");
              const legacyClip = String(s.clip || "").trim().toLowerCase();
              const hasLegacyClip =
                (clipPosition === "absolute" || clipPosition === "fixed") &&
                !!legacyClip &&
                legacyClip !== "auto";
              const transformed =
                clipPath !== "none" || hasLegacyClip
                  ? (function (node: any): boolean {
                      let t = node;
                      let td = 0;
                      while (t && t.nodeType === 1 && td < 100) {
                        const ts = g.getComputedStyle(t);
                        if (
                          String(ts.transform || "none") !== "none" ||
                          String(ts.scale || "none") !== "none" ||
                          String(ts.rotate || "none") !== "none" ||
                          String(ts.translate || "none") !== "none" ||
                          (function (value: any): boolean {
                            const text = String(value ?? "").trim().toLowerCase();
                            if (!text || text === "normal") return false;
                            const amount = parseFloat(text);
                            if (!Number.isFinite(amount)) return true;
                            return text.indexOf("%") >= 0 ? amount !== 100 : amount !== 1;
                          })(ts.zoom)
                        ) {
                          return true;
                        }
                        t = t.parentElement;
                        td++;
                      }
                      return false;
                    })(cur)
                  : false;
              if (clipPath !== "none") {
                const clipRect = cur.getBoundingClientRect();
                const clipWidth = Number(clipRect.width || 0);
                const clipHeight = Number(clipRect.height || 0);
                const shapeEmpty = (function (
                  value: any,
                  width: number,
                  height: number,
                  underTransform: boolean,
                ): boolean {
                  const text = String(value ?? "").trim().toLowerCase();
                  if (!text || text === "none") return false;
                  const call = /^([a-z-]+)\(([\s\S]*)\)$/.exec(text);
                  if (!call) return false;
                  const kind = call[1];
                  const tokens = String(call[2] ?? "")
                    .split(" round ")[0]!
                    .trim()
                    .split(/[\s,]+/)
                    .filter(Boolean);
                  if (kind === "inset") {
                    if (underTransform) {
                      if (!(width > 0 && height > 0)) return true;
                      if (tokens.length === 0 || tokens.length > 4) return false;
                      const topToken = tokens[0];
                      const rightToken = tokens[1] ?? topToken;
                      const bottomToken = tokens[2] ?? topToken;
                      const leftToken = tokens[3] ?? rightToken;
                      const percent = (token: any): number | null => {
                        const m = /^(-?\d*\.?\d+)(px|%)?$/.exec(String(token ?? ""));
                        if (!m) return null;
                        const amount = Number(m[1]);
                        if (!Number.isFinite(amount)) return null;
                        if (m[2] === "%") return amount;
                        return amount === 0 ? 0 : null;
                      };
                      const top = percent(topToken);
                      const right = percent(rightToken);
                      const bottom = percent(bottomToken);
                      const left = percent(leftToken);
                      return (
                        (top !== null && bottom !== null && top + bottom >= 100) ||
                        (left !== null && right !== null && left + right >= 100)
                      );
                    }
                    if (tokens.length === 0 || tokens.length > 4) return false;
                    const topToken = tokens[0];
                    const rightToken = tokens[1] ?? topToken;
                    const bottomToken = tokens[2] ?? topToken;
                    const leftToken = tokens[3] ?? rightToken;
                    const sides = [topToken, rightToken, bottomToken, leftToken];
                    const bases = [height, width, height, width];
                    const vals: Array<number | null> = [];
                    for (let si = 0; si < 4; si++) {
                      const m = /^(-?\d*\.?\d+)(px|%)?$/.exec(sides[si] ?? "");
                      if (!m) {
                        vals.push(null);
                        continue;
                      }
                      const amount = Number(m[1]);
                      if (!Number.isFinite(amount)) {
                        vals.push(null);
                        continue;
                      }
                      const base = bases[si]!;
                      vals.push(
                        m[2] === "%"
                          ? (amount / 100) * base
                          : m[2] === undefined && amount !== 0
                            ? null
                            : amount,
                      );
                    }
                    if (
                      vals[0] === null ||
                      vals[1] === null ||
                      vals[2] === null ||
                      vals[3] === null
                    ) {
                      return false;
                    }
                    return vals[0] + vals[2] >= height || vals[1] + vals[3] >= width;
                  }
                  if (kind === "circle") {
                    if (underTransform) {
                      const m = /^(-?\d*\.?\d+)(px|%)?$/.exec(tokens[0] ?? "");
                      return !!m && Number(m[1]) === 0;
                    }
                    const m = /^(-?\d*\.?\d+)(px|%)?$/.exec(tokens[0] ?? "");
                    if (!m) return false;
                    const amount = Number(m[1]);
                    if (!Number.isFinite(amount)) return false;
                    const radius =
                      m[2] === "%"
                        ? ((amount / 100) * Math.hypot(width, height)) / Math.SQRT2
                        : m[2] === undefined && amount !== 0
                          ? null
                          : amount;
                    return radius !== null && radius <= 0;
                  }
                  if (kind === "ellipse") {
                    if (tokens.length < 2) return false;
                    if (underTransform) {
                      for (let ti = 0; ti < 2; ti++) {
                        const m = /^(-?\d*\.?\d+)(px|%)?$/.exec(tokens[ti] ?? "");
                        if (m && Number(m[1]) === 0) return true;
                      }
                      return false;
                    }
                    const vals: Array<number | null> = [];
                    for (let ti = 0; ti < 2; ti++) {
                      const m = /^(-?\d*\.?\d+)(px|%)?$/.exec(tokens[ti]);
                      if (!m) {
                        vals.push(null);
                        continue;
                      }
                      const amount = Number(m[1]);
                      if (!Number.isFinite(amount)) {
                        vals.push(null);
                        continue;
                      }
                      const base = ti === 0 ? width : height;
                      vals.push(
                        m[2] === "%"
                          ? (amount / 100) * base
                          : m[2] === undefined && amount !== 0
                            ? null
                            : amount,
                      );
                    }
                    return (
                      vals[0] !== null &&
                      vals[1] !== null &&
                      (vals[0] <= 0 || vals[1] <= 0)
                    );
                  }
                  return false;
                })(clipPath, clipWidth, clipHeight, transformed);
                if (shapeEmpty) {
                  rejected = true;
                  break;
                }
              }
              if (hasLegacyClip) {
                const match = /^rect\(([^)]*)\)$/.exec(legacyClip);
                if (match) {
                  const parts = String(match[1] ?? "")
                    .split(/[\s,]+/)
                    .filter(Boolean);
                  if (parts.length === 4) {
                    let valid = true;
                    let hasAuto = false;
                    const nums: number[] = [];
                    for (let pi = 0; pi < 4; pi++) {
                      if (parts[pi] === "auto") {
                        hasAuto = true;
                        break;
                      }
                      const amount = Number.parseFloat(String(parts[pi] ?? ""));
                      if (!Number.isFinite(amount)) {
                        valid = false;
                        break;
                      }
                      nums.push(amount);
                    }
                    if (valid && !hasAuto) {
                      if (transformed) {
                        // Local px rects cannot be mapped; only all-zero
                        // rects prove emptiness under a transform.
                        if (nums.every((n) => n === 0)) {
                          rejected = true;
                          break;
                        }
                      } else if (nums[0]! >= nums[2]! || nums[3]! >= nums[1]!) {
                        rejected = true;
                        break;
                      }
                    }
                  }
                }
              }
            }
            if (isRoot) break;
            cur = cur.parentElement;
            depth++;
          }
          if (!rejected) virtualHeight = r.height;
        }
      }
    } catch {}
    return {
      scrollRoot: null,
      ...(virtualHeight > 0 ? { virtualHeight: Math.round(virtualHeight) } : {}),
      scrollHeight: Math.round(bodyOverflow ? Math.max(rootHeight, bodyHeight) : rootHeight),
      clientHeight: Math.round(
        Number(
          (scrollingRoot && scrollingRoot.clientHeight) ||
            g.innerHeight ||
            doc.documentElement.clientHeight ||
            0,
        ),
      ),
    };
  });
}

// Additive diagnostics: omitted entirely when an older/partial scan lacks
// them, so legacy records keep their exact shape.
function scrollModeFields(raw: ScanResult): Pick<PageStructure, "scrollMode" | "virtualRoot" | "note"> {
  return {
    ...(raw.scrollMode ? { scrollMode: raw.scrollMode } : {}),
    ...(raw.virtualRoot ? { virtualRoot: raw.virtualRoot } : {}),
    ...(raw.note ? { note: raw.note } : {}),
  };
}

export async function analyzePageStructure(
  url: string,
  loader: () => Promise<any> = () => import("playwright" as string),
  maxBands?: number,
  opts?: WaitOpts,
): Promise<PageStructure | { error: string }> {
  const endpoint = opts?.cdpEndpoint;
  if (endpoint !== undefined) {
    if (process.env[ATTACH_ENV] !== "1") {
      return {
        error:
          `Attach is disabled. Set ${ATTACH_ENV}=1 in the MCP server's environment and restart it, then retry with cdpEndpoint. ` +
          "Attach connects to a loopback browser you started, scans one already-open page without navigating, scrolling, clicking or creating tabs, and disconnects without closing it.",
      };
    }
    const valid = validateCdpEndpoint(endpoint);
    if ("error" in valid) return valid;
    // The attached page owns its viewport and scroll position: only scan as-is.
    if (opts?.viewport !== undefined && opts.viewport !== "desktop") {
      return {
        error:
          "cdpEndpoint attaches to an already-open page, so a custom viewport is unavailable. Omit viewport (the page's own viewport is used).",
      };
    }
    if (opts?.responsive === true) {
      return {
        error:
          "cdpEndpoint never scrolls the attached page, so responsive evidence is unavailable. Drop responsive, or run a launched compare without cdpEndpoint.",
      };
    }
  }
  let chromium: any;
  try {
    ({ chromium } = await loader());
  } catch {
    return { error: CAPTURE_INSTALL_HINT };
  }
  if (endpoint !== undefined) {
    const attached = await attachPage(async () => ({ chromium }), endpoint, url);
    if ("error" in attached) return attached;
    try {
      // No goto, no settle, no preScroll: attach only reads the user's tab.
      await installAttachedShim(attached.page);
      const raw = (await attached.page.evaluate(SCAN_SNIPPET, {
        responsive: false,
      })) as ScanResult;
      return {
        url,
        title: raw.title,
        totalHeight: raw.totalHeight,
        bands: splitCollapsedBands(collapseBands(raw.candidates, raw.totalHeight, maxBands ?? 40), raw.landmarks ?? []),
        ...(raw.scrollRoot ? { scrollRoot: raw.scrollRoot } : {}),
        ...scrollModeFields(raw),
        attached: true,
      };
    } finally {
      await closeAttached(attached.browser);
    }
  }
  let browser: any;
  try {
    browser = await chromium.launch(
      opts?.proxyServer
        ? {
            proxy: { server: opts.proxyServer, bypass: "<-loopback>" },
            args: ["--force-webrtc-ip-handling-policy=disable_non_proxied_udp"],
          }
        : {},
    );
  } catch {
    return { error: CAPTURE_INSTALL_HINT };
  }
  try {
    const waitStrategy: WaitStrategy = opts?.waitStrategy ?? "load";
    // Viewport profile split: width/height fill playwright's `viewport` key;
    // the mobile-profile flags (deviceScaleFactor/isMobile/hasTouch) are
    // sibling context options. The desktop profile resolves to no extra
    // fields, so the default call shape is unchanged.
    const profile = resolveViewport(opts?.viewport);
    const { width, height, ...contextOpts } = profile;
    const page = await browser.newPage({ viewport: { width, height }, ...contextOpts });
    await installSnippetShims(page);
    await page.goto(url, { waitUntil: waitStrategy, timeout: 45_000 });
    // "load" can fire before late XHRs settle, so give the page a fixed
    // settle window; networkidle already means the network went quiet.
    if (waitStrategy === "load") await page.waitForTimeout(3000);
    // Wait out a full-screen preloader before scanning: on body-pinned sites
    // the inner scroller may not exist until the loader has finished.
    await waitForOverlays(page, 15_000);
    await preScroll(page);
    const raw = (await page.evaluate(SCAN_SNIPPET, {
      responsive: opts?.responsive === true,
    })) as ScanResult;
    const structure: PageStructure = {
      url,
      finalUrl: typeof page.url === "function" ? page.url() : url,
      title: raw.title,
      totalHeight: raw.totalHeight,
      bands: splitCollapsedBands(collapseBands(raw.candidates, raw.totalHeight, maxBands ?? 40), raw.landmarks ?? []),
    };
    if (raw.scrollRoot) structure.scrollRoot = raw.scrollRoot;
    Object.assign(structure, scrollModeFields(raw));
    if (raw.responsive) structure.responsive = buildResponsiveReport(raw.responsive, profile);
    return structure;
  } finally {
    try {
      await browser.close();
    } catch {
      /* keep the primary error */
    }
  }
}
