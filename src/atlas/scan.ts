import type {
  AtlasComponentNode,
  AtlasPageScan,
  AtlasScanComponent,
  AtlasScanSection,
} from "./live-types.js";

/**
 * The single supported native/ARIA mapping the scanner applies. It is passed
 * into the page function because that function is serialized, and it is
 * exported so the mapping audit can test the exact table the scanner uses.
 */
export interface AtlasComponentHintTable {
  native: Readonly<Record<string, string>>;
  aria: Readonly<Record<string, string>>;
  input: Readonly<Record<string, string>>;
}

export const ATLAS_COMPONENT_HINTS: AtlasComponentHintTable = {
  native: {
    a: "link",
    button: "button",
    nav: "navigation",
    form: "form",
    select: "select",
    textarea: "text_input",
    table: "table",
    ul: "list",
    ol: "list",
    video: "media_player",
    audio: "media_player",
    canvas: "canvas",
    progress: "progress",
    details: "disclosure",
    dialog: "dialog",
  },
  aria: {
    link: "link",
    button: "button",
    navigation: "navigation",
    checkbox: "checkbox",
    radio: "radio",
    switch: "switch",
    tablist: "tabs",
    dialog: "dialog",
    alertdialog: "dialog",
    tooltip: "tooltip",
    alert: "alert",
    progressbar: "progress",
    list: "list",
    table: "table",
    form: "form",
    search: "form",
    searchbox: "text_input",
    textbox: "text_input",
    combobox: "combobox",
  },
  input: {
    checkbox: "checkbox",
    radio: "radio",
    submit: "button",
    button: "button",
    reset: "button",
    text: "text_input",
    search: "text_input",
    email: "text_input",
    tel: "text_input",
    url: "text_input",
    password: "text_input",
    number: "text_input",
    "": "text_input",
  },
};

/**
 * Runs inside the guarded page. Reads only DOM, geometry and declared roles;
 * no visual guessing and no speculative WebGL context creation.
 */
export const ATLAS_SECTION_SCAN = function (hints: {
  native: Readonly<Record<string, string>>;
  aria: Readonly<Record<string, string>>;
  input: Readonly<Record<string, string>>;
  /** Checkpoint scans set false: sections only, no component loop or packs. */
  components?: boolean;
}): AtlasPageScan {
  const g = globalThis as any;
  const doc = g.document;
  const win = g.window;
  const selectorFor = (el: any): string => {
    const parts: string[] = [];
    let cur = el;
    let depth = 0;
    while (cur && cur.nodeType === 1 && depth < 8) {
      let part = String(cur.tagName || "").toLowerCase();
      if (cur.id) part += `#${String(cur.id).replace(/[^\w-]/g, "_")}`;
      if (cur.classList && cur.classList.length) {
        part += `.${String(cur.classList[0]).replace(/[^\w-]/g, "_")}`;
      }
      parts.unshift(part);
      cur = cur.parentElement;
      depth += 1;
    }
    return parts.join(" > ").slice(0, 240);
  };
  // Same tag#id.class[0] label preScroll/SCAN_SNIPPET emit, so the collector
  // can compare this scan's root with the element it scrolled.
  const scrollRootLabel = (el: any): string => {
    const css = g.CSS;
    const escapeIdent = (value: any): string =>
      css && typeof css.escape === "function"
        ? String(css.escape(String(value)))
        : String(value).replace(/[^A-Za-z0-9_\u00A0-\uFFFF-]/g, "\\$&");
    const id = el.id ? `#${escapeIdent(el.id)}` : "";
    const cls =
      el.classList && el.classList.length ? `.${escapeIdent(el.classList[0])}` : "";
    return String(el.tagName || "").toLowerCase() + id + cls;
  };
  const clean = (value: unknown): string =>
    String(value ?? "")
      .replace(/\s+/g, " ")
      .trim();
  const directText = (element: any, maxChars = 4_000): string => {
    try {
      const tag = String(element.tagName || "").toUpperCase();
      if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(tag)) return "";
      if (!visibleNode(element)) return "";
      const parts: string[] = [];
      let chars = 0;
      let inspected = 0;
      let child = element.firstChild;
      while (child && chars < maxChars && inspected < 6_000) {
        inspected += 1;
        if (child.nodeType === 3) {
          const remaining = maxChars - chars;
          const value =
            typeof child.substringData === "function"
              ? child.substringData(0, remaining)
              : String(child.nodeValue ?? "").slice(0, remaining);
          parts.push(value);
          chars += value.length;
        }
        child = child.nextSibling;
      }
      return clean(parts.join(" ")).slice(0, maxChars);
    } catch {
      return "";
    }
  };
  const boundedText = (
    node: any,
    maxChars = 4_000,
    boundedNodes: any[] = walked,
  ): string => {
    try {
      const elements = boundedNodes.filter(
        (element: any) => element === node || node.contains(element),
      );
      const parts: string[] = [];
      let chars = 0;
      for (const element of elements) {
        if (chars >= maxChars) break;
        const text = directText(element, maxChars - chars);
        if (!text) continue;
        parts.push(text);
        chars += text.length;
      }
      return clean(parts.join(" ")).slice(0, maxChars);
    } catch {
      return "";
    }
  };
  const closestWithin = (node: any, selector: string, maxDepth = 12): any => {
    let current = node;
    let depth = 0;
    while (current && depth < maxDepth) {
      if (current.matches?.(selector)) return current;
      current = current.parentElement;
      depth += 1;
    }
    return null;
  };
  function visibleNode(node: any): boolean {
    try {
      let current = node;
      let depth = 0;
      while (current && current !== doc.documentElement && depth < 12) {
        const s = win.getComputedStyle(current);
        if (
          String(s.display) === "none" ||
          String(s.visibility) === "hidden" ||
          Number(s.opacity || 1) <= 0
        ) {
          return false;
        }
        current = current.parentElement;
        depth += 1;
      }
      const r = node.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    } catch {
      return false;
    }
  }
  /**
   * Section visual eligibility, separate from text accessibility. A section is
   * drawable when it can paint pixels somewhere in the document; the current
   * viewport is deliberately never consulted, so a normal below-fold section
   * stays eligible and becomes observable at a checkpoint. Only provable
   * causes are rejected: hidden content, a zero-opacity chain, an empty legacy
   * `clip`/`clip-path`, and ancestor overflow that permanently clips the
   * section to zero area. Scrollable overflow is not proof — its content can
   * still scroll into view.
   */
  const pxValue = (value: any): number => {
    const parsed = Number.parseFloat(String(value ?? ""));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const resolveLength = (token: string | undefined, base: number): number | null => {
    const match = /^(-?\d*\.?\d+)(px|%)?$/.exec(String(token ?? ""));
    if (!match) return null;
    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) return null;
    if (match[2] === "%") return (amount / 100) * base;
    // Unitless lengths are only valid as zero.
    return match[2] === undefined && amount !== 0 ? null : amount;
  };
  /** The rectangle an inset() clip-path leaves, in client coordinates. */
  const insetClipRegion = (
    value: any,
    rect: any,
  ): { left: number; top: number; right: number; bottom: number } | null => {
    const text = String(value ?? "").trim().toLowerCase();
    // Rounded insets are not intersected (the rectangle over-approximates); the
    // emptiness check below still strips `round`, since rounding only shrinks.
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
    const top = resolveLength(topToken, height);
    const right = resolveLength(rightToken, width);
    const bottom = resolveLength(bottomToken, height);
    const left = resolveLength(leftToken, width);
    if (top === null || right === null || bottom === null || left === null) return null;
    return {
      left: rect.left + left,
      top: rect.top + top,
      right: rect.right - right,
      bottom: rect.bottom - bottom,
    };
  };
  const clipPathEmpty = (value: any, width: number, height: number): boolean => {
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
      const radius = resolveLength(tokens[0], Math.hypot(width, height) / Math.SQRT2);
      return radius !== null && radius <= 0;
    }
    if (kind === "ellipse") {
      const rx = resolveLength(tokens[0], width);
      const ry = resolveLength(tokens[1], height);
      return rx !== null && ry !== null && (rx <= 0 || ry <= 0);
    }
    // polygon()/path()/url() shapes are not proven empty here.
    return false;
  };
  const zeroLength = (token: string | undefined): boolean => {
    const match = /^([+-]?(?:\d*\.?\d+))(px|%)?$/.exec(String(token ?? "").trim());
    return Boolean(match) && Number(match![1]) === 0;
  };
  /**
   * Under a transform the layout box cannot be measured precisely (client rects
   * are scaled, `offsetWidth`/`offsetHeight` are rounded), so only proofs that
   * do not depend on its size survive: zero-radius shapes and percentages that
   * already consume the box.
   */
  const clipPathProvablyEmptyScaled = (value: any): boolean => {
    const text = String(value ?? "").trim().toLowerCase();
    const call = /^([a-z-]+)\(([\s\S]*)\)$/.exec(text);
    if (!call) return false;
    const kind = call[1];
    const tokens = String(call[2] ?? "")
      .split(" round ")[0]!
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean);
    if (kind === "inset") {
      // Each side is proven only when it is a percentage or an exact zero; the
      // pair then proves the axis empty when it already consumes the box.
      const sides = tokens.map((token) => {
        if (zeroLength(token)) return 0;
        const percent = /^(-?\d*\.?\d+)%$/.exec(token);
        return percent ? Number(percent[1]) : null;
      });
      if (sides.length === 0 || sides.some((side) => side === null)) return false;
      const amount = (index: number): number => sides[index] as number;
      const top = amount(0);
      const right = sides.length > 1 ? amount(1) : top;
      const bottom = sides.length > 2 ? amount(2) : top;
      const left = sides.length > 3 ? amount(3) : right;
      return right + left >= 100 || top + bottom >= 100;
    }
    // Radius tokens precede any `at <position>` clause.
    const atIndex = tokens.indexOf("at");
    const radii = atIndex === -1 ? tokens : tokens.slice(0, atIndex);
    if (kind === "circle") return radii.length >= 1 && zeroLength(radii[0]);
    if (kind === "ellipse") {
      return radii.length >= 2 && (zeroLength(radii[0]) || zeroLength(radii[1]));
    }
    return false;
  };
  const legacyClipEmpty = (style: any): boolean => {
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
    return lengths[0]! >= lengths[2]! || lengths[3]! >= lengths[1]!;
  };
  const clippedOverflow = (value: any): boolean => {
    const overflow = String(value || "");
    return overflow === "hidden" || overflow === "clip";
  };
  // Properties that make an ancestor a containing block for fixed positioning
  // (and, with the ancestor's own position, for absolute positioning).
  const paintContainingBlock = (style: any): boolean => {
    if (String(style.transform || "none") !== "none") return true;
    if (String(style.filter || "none") !== "none") return true;
    if (String(style.backdropFilter || "none") !== "none") return true;
    if (String(style.perspective || "none") !== "none") return true;
    if (/paint|layout|strict|content/.test(String(style.contain || ""))) return true;
    return /transform|filter|perspective|contain/.test(String(style.willChange || ""));
  };
  /**
   * A `visibility:hidden` box can still paint through a descendant that sets
   * `visibility:visible`. That is proof of pixels, so the section stays
   * eligible; the scan does not try to prove the opposite.
   *
   * shortcut: inspection stops after 400 descendants per hidden section
   * (document order, early exit) so a pathological hidden subtree cannot stall
   * the scan. A cutoff is unknown, not proof, so the section is retained;
   * upgrade to an uncapped walk if that over-retention becomes material.
   */
  const paintsVisibleDescendant = (el: any): boolean => {
    try {
      let node = el.firstElementChild;
      let visited = 0;
      while (node && visited < 400) {
        visited += 1;
        const style = win.getComputedStyle(node);
        if (
          String(style.visibility || "") === "visible" &&
          Number(style.opacity ?? 1) > 0
        ) {
          const nodeRect = node.getBoundingClientRect();
          if (nodeRect.width > 0 && nodeRect.height > 0) return true;
        }
        if (node.firstElementChild) {
          node = node.firstElementChild;
          continue;
        }
        while (node && node !== el && !node.nextElementSibling) node = node.parentElement;
        node = node && node !== el ? node.nextElementSibling : null;
      }
      // A budget cutoff leaves the subtree unexamined: unknown is retained.
      if (node) return true;
      return false;
    } catch {
      // Unknown state is retained, never excluded without proof.
      return true;
    }
  };
  const hasDrawablePixels = (el: any, rect: any): boolean => {
    try {
      if (!(rect.width > 0 && rect.height > 0)) return false;
      const position = String(win.getComputedStyle(el).position || "");
      const positioned = position === "absolute" || position === "fixed";
      // An out-of-flow section escapes the overflow of ancestors strictly
      // between itself and its containing block (CSS 2.1 §11.1.1).
      let containingBlock: any = null;
      if (positioned) {
        let ancestor = el.parentElement;
        let scanDepth = 0;
        while (ancestor && ancestor.nodeType === 1 && scanDepth < 64) {
          const ancestorStyle = win.getComputedStyle(ancestor);
          if (
            String(ancestorStyle.display || "") !== "contents" &&
            (paintContainingBlock(ancestorStyle) ||
              (position === "absolute" && String(ancestorStyle.position || "static") !== "static"))
          ) {
            containingBlock = ancestor;
            break;
          }
          ancestor = ancestor.parentElement;
          scanDepth += 1;
        }
      }
      const clipsFrom = (ancestor: any): boolean => {
        if (!positioned) return true;
        // An out-of-flow section is clipped only by its containing block and
        // that block's ancestors, never by boxes between it and the section
        // (CSS 2.1 §11.1.1). No containing block means the viewport holds it,
        // so every ancestor sits between the section and its containing block
        // and none clips: returning false is correct, not a default.
        if (!containingBlock) return false;
        return ancestor === containingBlock || ancestor.contains(containingBlock);
      };
      // Client-space intersections are only valid when no transform stands
      // between the element and the box being intersected. A transform on any
      // ancestor scales local px, so the chain is checked, not just the node.
      const transformedChainCache = new Map<any, boolean>();
      const transformedChain = (node: any): boolean => {
        const cached = transformedChainCache.get(node);
        if (cached !== undefined) return cached;
        let current = node;
        let scanDepth = 0;
        let result = false;
        while (current && current.nodeType === 1 && scanDepth < 64) {
          const chainStyle = win.getComputedStyle(current);
          // Individual transform properties offset geometry exactly like
          // `transform`, and `zoom` scales layout px, so they must be resolved
          // as part of the chain.
          if (
            String(chainStyle.transform || "none") !== "none" ||
            String(chainStyle.scale || "none") !== "none" ||
            String(chainStyle.rotate || "none") !== "none" ||
            String(chainStyle.translate || "none") !== "none" ||
            String(chainStyle.zoom || "1") !== "1"
          ) {
            result = true;
            break;
          }
          current = current.parentElement;
          scanDepth += 1;
        }
        transformedChainCache.set(node, result);
        return result;
      };
      // Nearest scroller wins: once a nearer ancestor scrolls on an axis, an
      // outer clip cannot prove the section never paints on that axis.
      let scrollsX = false;
      let scrollsY = false;
      // A scroll container between the section and a clip box can move the
      // section through that box, so its current position proves nothing.
      let scrolledBelow = false;
      let left = rect.left;
      let top = rect.top;
      let right = rect.right;
      let bottom = rect.bottom;
      let current = el;
      let depth = 0;
      while (current && current.nodeType === 1 && depth < 64) {
        const style = win.getComputedStyle(current);
        if (current !== el && String(style.display || "") === "contents") {
          // No box, so its opacity/clip/overflow cannot hide descendants.
          current = current.parentElement;
          depth += 1;
          continue;
        }
        if (current === el && String(style.visibility || "visible") !== "visible") {
          // visibility inherits, so an ancestor's hidden value is already
          // reflected here unless a descendant overrides it and paints.
          if (!paintsVisibleDescendant(el)) return false;
        }
        if (Number(style.opacity ?? 1) <= 0) return false;
        // On the section itself content-visibility only skips its contents;
        // its box, background and border still paint. Only ancestors hide it.
        if (current !== el && String(style.contentVisibility || "") === "hidden") return false;
        if (legacyClipEmpty(style)) return false;
        const overflowX = String(style.overflowX || "");
        const overflowY = String(style.overflowY || "");
        // `hidden` still scrolls programmatically when its content overflows,
        // so it is scroll-reachable; `clip` never scrolls. Any overflow counts:
        // a single pixel is enough to expose a section with scrollTop.
        const scrollableHiddenX =
          overflowX === "hidden" &&
          Number(current.scrollWidth || 0) > Number(current.clientWidth || 0);
        const scrollableHiddenY =
          overflowY === "hidden" &&
          Number(current.scrollHeight || 0) > Number(current.clientHeight || 0);
        const scrollableBox =
          /auto|scroll|overlay/.test(overflowX) ||
          /auto|scroll|overlay/.test(overflowY) ||
          scrollableHiddenX ||
          scrollableHiddenY;
        const clipPath = String(style.clipPath || "none");
        if (clipPath !== "none") {
          const clipRect = current === el ? rect : current.getBoundingClientRect();
          const chainTransformed = transformedChain(current);
          // clip-path lengths and percentages resolve against the untransformed
          // border box, so a transformed bounding rect would measure them
          // wrongly (e.g. inset(60px) on a scale(.5) 200px box). An untransformed
          // box's client rect is that border box, fractional size included;
          // `offsetWidth` would round 200.4 down and fake an empty inset.
          const layoutWidth = chainTransformed ? 0 : Number(clipRect.width || 0);
          const layoutHeight = chainTransformed ? 0 : Number(clipRect.height || 0);
          // A rectangular inset can be intersected exactly in client space
          // only when nothing can move or scale the boxes since layout.
          // Scrollable content can move through a fixed clip box, so the
          // section's current position proves nothing there.
          if (!chainTransformed && !scrollableBox && !scrolledBelow) {
            const region = insetClipRegion(clipPath, clipRect);
            if (region) {
              left = Math.max(left, region.left);
              right = Math.min(right, region.right);
              top = Math.max(top, region.top);
              bottom = Math.min(bottom, region.bottom);
              if (!(right > left) || !(bottom > top)) return false;
            }
          }
          // Under a transform only scale-invariant proofs survive; under none
          // the exact fractional layout box decides.
          if (chainTransformed) {
            if (clipPathProvablyEmptyScaled(clipPath)) return false;
          } else if (clipPathEmpty(clipPath, layoutWidth, layoutHeight)) {
            return false;
          }
        }
        // A scrolling box moves its content through any outer clip box.
        if (scrollableBox) scrolledBelow = true;
        if (current !== el) {
          if (/auto|scroll|overlay/.test(overflowX) || scrollableHiddenX) scrollsX = true;
          if (/auto|scroll|overlay/.test(overflowY) || scrollableHiddenY) scrollsY = true;
          const clippedX = clippedOverflow(overflowX) && !scrollsX;
          const clippedY = clippedOverflow(overflowY) && !scrollsY;
          if (
            (clippedX || clippedY) &&
            String(style.display || "") !== "inline" &&
            clipsFrom(current)
          ) {
            const box = current.getBoundingClientRect();
            // Border widths are layout px. A transform anywhere in the chain
            // scales them in client space, so subtracting them unscaled would
            // over-clip; keep the whole border box there (an over-approximation
            // is the only safe intersection without resolving the transform).
            const borderless = transformedChain(current);
            // overflow-clip-margin paints outside the clip box; Chromium
            // reports it as a computed length (optionally with a visual box).
            const clipMargin = (() => {
              if (overflowX !== "clip" && overflowY !== "clip") return 0;
              const raw = String(style.overflowClipMargin || "");
              const match = /(-?\d*\.?\d+)px\s*$/.exec(raw);
              return match ? Math.max(0, Number(match[1])) : 0;
            })();
            const marginX = overflowX === "clip" ? clipMargin : 0;
            const marginY = overflowY === "clip" ? clipMargin : 0;
            // A scaled margin cannot be measured in client px; retain instead.
            if (clippedX && marginX > 0 && !borderless) {
              left = Math.max(left, box.left + pxValue(style.borderLeftWidth) - marginX);
              right = Math.min(right, box.right - pxValue(style.borderRightWidth) + marginX);
            } else if (clippedX && marginX === 0) {
              left = Math.max(left, box.left + (borderless ? 0 : pxValue(style.borderLeftWidth)));
              right = Math.min(right, box.right - (borderless ? 0 : pxValue(style.borderRightWidth)));
            }
            if (clippedY && marginY > 0 && !borderless) {
              top = Math.max(top, box.top + pxValue(style.borderTopWidth) - marginY);
              bottom = Math.min(bottom, box.bottom - pxValue(style.borderBottomWidth) + marginY);
            } else if (clippedY && marginY === 0) {
              top = Math.max(top, box.top + (borderless ? 0 : pxValue(style.borderTopWidth)));
              bottom = Math.min(bottom, box.bottom - (borderless ? 0 : pxValue(style.borderBottomWidth)));
            }
            if (!(right > left) || !(bottom > top)) return false;
          }
        }
        current = current.parentElement;
        depth += 1;
      }
      return true;
    } catch {
      // Unexpected style failure is not proof of nonvisual pixels.
      return true;
    }
  };
  /**
   * Effective visibility is browser hit-tested: the viewport-intersected rect
   * is sampled at up to nine points and the topmost element at each point
   * decides. Chromium already resolves transforms, containing blocks, overflow
   * clipping and overlays, so re-deriving that chain here only drifts from it.
   * The element is visible when a sample hits it or one of its descendants;
   * null, an unrelated element (an overlay) or a clipping ancestor means no
   * usable pixels at that point.
   */
  const browserHitVisible = (el: any, rect: any): boolean => {
    try {
      const left = Math.max(rect.left, 0);
      const top = Math.max(rect.top, 0);
      const right = Math.min(rect.right, Number(win.innerWidth || 0));
      const bottom = Math.min(rect.bottom, Number(win.innerHeight || 0));
      if (right <= left || bottom <= top) return false;
      const width = right - left;
      const height = bottom - top;
      const insetX = Math.min(1, width / 4);
      const insetY = Math.min(1, height / 4);
      const samples: Array<[number, number]> = [
        [left + width / 2, top + height / 2],
        [left + width * 0.25, top + height * 0.25],
        [left + width * 0.75, top + height * 0.25],
        [left + width * 0.25, top + height * 0.75],
        [left + width * 0.75, top + height * 0.75],
        [left + insetX, top + insetY],
        [right - insetX, top + insetY],
        [left + insetX, bottom - insetY],
        [right - insetX, bottom - insetY],
      ];
      // A shadow root hit-tests to its host; the host paints the component.
      const rootNode = el.getRootNode?.();
      const shadowHost = rootNode && rootNode.host ? rootNode.host : null;
      for (const [x, y] of samples) {
        const hit = doc.elementFromPoint(x, y);
        if (!hit) continue;
        if (hit === el || el.contains(hit) || hit === shadowHost) return true;
      }
      return false;
    } catch {
      return false;
    }
  };
  const sections: AtlasScanSection[] = [];
  const nodeIds: WeakMap<object, string> =
    win.__atlasNodeIds ?? (win.__atlasNodeIds = new WeakMap<object, string>());
  let nextNodeId = Number(win.__atlasNextNodeId ?? 0);
  function nodeKeyFor(node: any): string {
    const existing = nodeIds.get(node);
    if (existing) return existing;
    const key = `node-${nextNodeId++}`;
    nodeIds.set(node, key);
    win.__atlasNextNodeId = nextNodeId;
    return key;
  }
  const candidateSelector =
    "main, section, article, header, footer, nav, aside, div, [role=region], [role=main], [role=banner], [role=contentinfo], [role=navigation]";
  const structuralMatch = (el: any): boolean => {
    if (!el.matches?.(candidateSelector)) return false;
    if (String(el.tagName || "").toLowerCase() !== "div") return true;
    if (el.getAttribute("role")) return true;
    const children = el.children ?? [];
    const limit = Math.min(Number(children.length || 0), 200);
    for (let index = 0; index < limit; index += 1) {
      if (/^h[1-6]$/i.test(String(children[index]?.tagName || ""))) return true;
    }
    return false;
  };
  let inspectedNodes = 0;
  let nodeBudgetHit = false;
  let overflowCandidate = false;
  const walked: any[] = [];
  const walker = doc.createTreeWalker(doc.documentElement, 1);
  let walkedNode: any = doc.documentElement;
  while (walkedNode) {
    inspectedNodes += 1;
    if (inspectedNodes > 6_000) {
      nodeBudgetHit = true;
      overflowCandidate = structuralMatch(walkedNode);
      break;
    }
    walked.push(walkedNode);
    walkedNode = walker.nextNode();
  }
  // Mirror preScroll: document wins; otherwise use the largest visible inner scroller.
  const root = doc.documentElement;
  let scrollRootEl: any = null;
  const documentHeight = Math.max(
    Number(root?.scrollHeight || 0),
    Number(doc.body?.scrollHeight || 0),
  );
  // Quirks mode reports clientHeight as the content height; compare against
  // the viewport so a real document scroll is not mistaken for an inner root.
  const documentScrolls =
    documentHeight > Number(win.innerHeight || root?.clientHeight || 0) + 100;
  if (!documentScrolls) {
    let bestArea = 0;
    for (const node of walked) {
      if (node === doc.body || node === root) continue;
      if (Number(node.scrollHeight || 0) <= Number(node.clientHeight || 0) + 100) continue;
      const style = win.getComputedStyle(node);
      const overflowY = String(style.overflowY || "");
      if (overflowY !== "auto" && overflowY !== "scroll") continue;
      if (String(style.display) === "none" || String(style.visibility) === "hidden") continue;
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const area = rect.width * rect.height;
      if (area > bestArea) {
        bestArea = area;
        scrollRootEl = node;
      }
    }
  }
  const scrollRootRect = scrollRootEl?.getBoundingClientRect?.() ?? null;
  const structuralCandidates = walked
    .filter((el: any) => structuralMatch(el)) as any[];
  const rawCandidateCount = structuralCandidates.length + (overflowCandidate ? 1 : 0);
  const sectionNodes = structuralCandidates.slice(0, 120) as any[];
  const candidateNodes = new Set(sectionNodes);
  for (const el of sectionNodes) {
    try {
      const rect = el.getBoundingClientRect();
      const style = win.getComputedStyle(el);
      if (rect.width <= 0 || rect.height <= 0) continue;
      const bounded = walked.filter(
        (node: any) => node === el || el.contains(node),
      ) as any[];
      const headingEl = bounded.find((node) =>
        /^h[1-6]$/i.test(String(node.tagName || "")),
      );
      const heading = headingEl ? boundedText(headingEl, 300, bounded) : null;
      const headingLevel = headingEl
        ? Number(String(headingEl.tagName).replace(/[^1-6]/g, ""))
        : null;
      const countTag = (tag: string): number =>
        bounded.filter((node) => String(node.tagName || "").toLowerCase() === tag).length;
      const paragraphs = countTag("p");
      const links = bounded.filter(
        (node) => String(node.tagName || "").toLowerCase() === "a" && node.hasAttribute?.("href"),
      ).length;
      const media = bounded.filter((node) =>
        /^(img|video|canvas|picture)$/i.test(String(node.tagName || "")),
      ).length;
      const items = countTag("li");
      const ordered = bounded.filter(
        (node) =>
          String(node.tagName || "").toLowerCase() === "li" &&
          String(node.parentElement?.tagName || "").toLowerCase() === "ol",
      ).length;
      const quotes = bounded.filter(
        (node) =>
          /^(blockquote|q)$/i.test(String(node.tagName || "")) && visibleNode(node),
      ).length;
      const citations = bounded.filter(
        (node) => String(node.tagName || "").toLowerCase() === "cite" && visibleNode(node),
      ).length;
      const numericPairs = bounded
        .filter((node) => /^(p|li|span|strong)$/i.test(String(node.tagName || "")))
        .filter((node: any) => {
          if (!visibleNode(node)) return false;
          let parent = node.parentElement;
          let depth = 0;
          while (parent && parent !== el && depth < 12) {
            if (/^(P|LI|SPAN|STRONG)$/i.test(String(parent.tagName))) return false;
            parent = parent.parentElement;
            depth += 1;
          }
          return /[$€£¥]?\s*\d[\d,.%]*/.test(directText(node, 200));
        }).length;
      const forms = countTag("form");
      const emails = bounded.filter(
        (node) =>
          String(node.tagName || "").toLowerCase() === "input" &&
          String(node.getAttribute?.("type") || "").toLowerCase() === "email" &&
          visibleNode(node),
      ).length;
      const buttonNodes = bounded.filter(
        (node) =>
          (/^button$/i.test(String(node.tagName || "")) ||
            String(node.getAttribute?.("role") || "").toLowerCase() === "button") &&
          visibleNode(node),
      );
      const buttons = buttonNodes.length;
      const buttonLabels = buttonNodes
        .map((node: any) => directText(node, 80))
        .filter((label: string) => label.length > 0)
        .slice(0, 12);
      const role = el.getAttribute("role");
      const roleValue = role ? String(role).toLowerCase() : null;
      const landmark =
        el.tagName === "HEADER" || roleValue === "banner"
          ? "header"
          : el.tagName === "FOOTER" || roleValue === "contentinfo"
            ? "footer"
            : el.tagName === "NAV" || roleValue === "navigation"
              ? "navigation"
              : el.tagName === "MAIN" || roleValue === "main"
                ? "main"
                : null;
      const parentSection = (() => {
        let parent = el.parentElement;
        let depth = 0;
        while (parent && !candidateNodes.has(parent) && depth < 12) {
          parent = parent.parentElement;
          depth += 1;
        }
        return parent && candidateNodes.has(parent) ? parent : null;
      })();
      sections.push({
        nodeKey: nodeKeyFor(el),
        selector: selectorFor(el),
        tag: String(el.tagName || "").toLowerCase(),
        role: role ? String(role) : null,
        landmark,
        heading,
        headingLevel,
        text: boundedText(el, 4_000, bounded),
        // Drawing eligibility, not text accessibility: segmentation already
        // excludes `visible:false` candidates.
        visible: hasDrawablePixels(el, rect),
        articleNested:
          Boolean(closestWithin(el, "article", 12)) &&
          String(el.tagName || "").toLowerCase() !== "article",
        landmarkNested: Boolean(closestWithin(el.parentElement, "article, section", 12)),
        paragraphCount: paragraphs,
        linkCount: links,
        mediaCount: media,
        repeatedItems: items,
        orderedItems: ordered,
        quoteCount: quotes,
        citationCount: citations,
        numericPairs,
        formCount: forms,
        emailInputCount: emails,
        buttonCount: buttons,
        buttonLabels,
        rect: {
          x: Math.round(
            scrollRootEl && scrollRootEl.contains(el)
              ? rect.x - (scrollRootRect?.left ?? 0) + (scrollRootEl.scrollLeft || 0)
              : rect.x + (win.scrollX || 0),
          ),
          y: Math.round(
            scrollRootEl && scrollRootEl.contains(el)
              ? rect.y - (scrollRootRect?.top ?? 0) + (scrollRootEl.scrollTop || 0)
              : rect.y + (win.scrollY || 0),
          ),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        viewport: {
          width: Math.round(win.innerWidth),
          height: Math.round(win.innerHeight),
        },
        backgroundColor: style && style.backgroundColor ? String(style.backgroundColor) : null,
        fixed: (() => {
          let current = el;
          let depth = 0;
          while (current && current !== doc.documentElement && depth < 12) {
            const currentStyle = win.getComputedStyle(current);
            if (String(currentStyle.position) === "fixed") return true;
            current = current.parentElement;
            depth += 1;
          }
          return String(win.getComputedStyle(doc.documentElement).position) === "fixed";
        })(),
        depth: (() => {
          let d = 0;
          let p = el.parentElement;
          let walkedDepth = 0;
          while (p && walkedDepth < 12) {
            if (/^(MAIN|SECTION|ARTICLE|HEADER|FOOTER|NAV)$/.test(String(p.tagName))) d += 1;
            p = p.parentElement;
            walkedDepth += 1;
          }
          return Math.min(d, 12);
        })(),
        parentKey: parentSection ? nodeKeyFor(parentSection) : null,
        inScrollRoot: scrollRootEl ? scrollRootEl.contains(el) : false,
      });
    } catch {
      /* skip an unreadable node, keep the scan deterministic */
    }
  }
  // --- Component discovery (bounded) -------------------------------------
  const COMPONENT_CAP = 120;
  const COMPONENT_RAW_CAP = 600;
  const COMPONENT_PACK_CAP = 12;
  const PACK_NODE_CAP = 150;
  const PACK_DEPTH_CAP = 12;
  const nativeHints = hints?.native ?? {};
  const roleHints = hints?.aria ?? {};
  const inputHints = hints?.input ?? {};
  // One bounded aria-label feeds both the nav classification and the blind
  // row, so a labeler can reproduce breadcrumb/pagination from the export.
  const boundedAriaLabel = (el: any): string | null => {
    const value = el.getAttribute?.("aria-label");
    if (value == null) return null;
    const bounded = String(value).trim().slice(0, 200);
    return bounded.length > 0 ? bounded : null;
  };
  const componentHint = (
    el: any,
    style: any,
  ): { hint: string; basis: "native_semantics" | "declared_aria" | "rule_derivation" } | null => {
    try {
      const tag = String(el.tagName || "").toLowerCase();
      const role = String(el.getAttribute?.("role") || "").toLowerCase();
      const ariaLabel = boundedAriaLabel(el) ?? "";
      const insideNav = Boolean(closestWithin(el, "nav,[role=navigation]", 12));
      const hasPopup = el.hasAttribute?.("aria-haspopup");
      const expanded = el.getAttribute?.("aria-expanded");
      // A trigger is only a candidate: aria-controls/expanded declare a
      // relationship, they do not prove the controlled surface opens.
      if (
        insideNav &&
        (hasPopup || expanded !== null) &&
        (/^(a|button)$/.test(tag) || role === "button" || role === "link")
      ) {
        return { hint: "navigation_trigger", basis: "declared_aria" };
      }
      const roledescription = String(
        el.getAttribute?.("aria-roledescription") || "",
      ).toLowerCase();
      if (roledescription.includes("carousel")) {
        return { hint: "carousel", basis: "rule_derivation" };
      }
      if (tag === "nav" || role === "navigation") {
        const label = ariaLabel.toLowerCase();
        if (/breadcrumb/.test(label)) return { hint: "breadcrumb", basis: "declared_aria" };
        if (/pag(er|ination)/.test(label)) return { hint: "pagination", basis: "declared_aria" };
      }
      if (role && roleHints[role]) return { hint: roleHints[role]!, basis: "declared_aria" };
      // An explicit role the vocabulary cannot represent must not fall through
      // to the native tag: <table role="grid"> is not a plain table.
      if (role) return null;
      if (tag === "a") {
        return el.hasAttribute?.("href")
          ? { hint: nativeHints.a ?? "link", basis: "native_semantics" }
          : null;
      }
      if (tag === "input") {
        const type = String(el.getAttribute?.("type") || "text").toLowerCase();
        if (type === "hidden") return null;
        const hint = inputHints[type];
        return hint ? { hint, basis: "native_semantics" } : null;
      }
      if (nativeHints[tag]) {
        return { hint: nativeHints[tag]!, basis: "native_semantics" };
      }
      if (tag === "article" || tag === "li") {
        // A card needs a card-like container: a near heading plus a near
        // action/media, or a repeated sibling structure. A long-form article
        // with body paragraphs is editorial content, not a card. Inferred and
        // candidate-only; this never asserts interaction.
        const childrenOf = (node: any): any[] => {
          const list: any[] = [];
          const visit = (current: any, depth: number): void => {
            if (depth > 1) return;
            for (const child of current.children ?? []) {
              list.push(child);
              visit(child, depth + 1);
            }
          };
          visit(node, 0);
          return list;
        };
        const near = childrenOf(el);
        const hasNearHeading = near.some((node) => /^h[1-6]$/i.test(String(node.tagName || "")));
        const hasNearAction = near.some((node) =>
          /^(a|button|img|picture|video)$/i.test(String(node.tagName || "")),
        );
        const hasHeading = Boolean(el.querySelector?.("h1,h2,h3,h4,h5,h6"));
        const hasAction = Boolean(el.querySelector?.("a[href],button,img,picture,video"));
        const paragraphs = Number(el.querySelectorAll?.("p")?.length || 0);
        const longForm =
          tag === "article" &&
          (paragraphs >= 3 || String(el.textContent || "").trim().length > 700);
        const parent = el.parentElement;
        const repeatedSibling = Boolean(
          parent &&
            Array.from(parent.children ?? []).filter(
              (sibling: any) => sibling.tagName === el.tagName,
            ).length >= 2,
        );
        if (
          !longForm &&
          ((hasNearHeading && hasNearAction) ||
            (repeatedSibling && hasHeading && hasAction))
        ) {
          return { hint: "card", basis: "rule_derivation" };
        }
      }
      return null;
    } catch {
      return null;
    }
  };
  const shapeOf = (el: any): string => {
    let parts = 0;
    // Nesting brackets and depth markers keep parent/child boundaries in the
    // key: two trees can share a flattened tag sequence but not a shape.
    const visit = (node: any, depth: number): string => {
      if (depth > 2 || parts >= 40) return "";
      const children = node.children ?? [];
      const limit = Math.min(Number(children.length || 0), 4);
      const encoded: string[] = [];
      for (let index = 0; index < limit; index += 1) {
        if (parts >= 40) break;
        const child = children[index];
        const role = String(child.getAttribute?.("role") || "").toLowerCase();
        parts += 1;
        const childDepth = depth + 1;
        encoded.push(
          `${childDepth}:${String(child.tagName || "").toLowerCase()}${role ? `:${role}` : ""}[${visit(child, childDepth)}]`,
        );
      }
      return encoded.join(",");
    };
    return `[${visit(el, 0)}]`.slice(0, 600);
  };
  const childCountsOf = (el: any): string => {
    const counts: number[] = [];
    let level: any[] = [el];
    for (let depth = 0; depth < 3; depth += 1) {
      let count = 0;
      const next: any[] = [];
      for (const node of level) {
        const children = node.children ?? [];
        const limit = Math.min(Number(children.length || 0), 200);
        count += Number(children.length || 0);
        for (let index = 0; index < limit; index += 1) next.push(children[index]);
      }
      counts.push(count);
      level = next.length > 200 ? next.slice(0, 200) : next;
    }
    return counts.join(",");
  };
  const packFor = (el: any): { nodes: AtlasComponentNode[]; truncated: boolean } => {
    const nodes: AtlasComponentNode[] = [];
    const queue: Array<{ node: any; depth: number }> = [{ node: el, depth: 0 }];
    let truncated = false;
    while (queue.length > 0) {
      if (nodes.length >= PACK_NODE_CAP) {
        truncated = true;
        break;
      }
      const current = queue.shift()!;
      if (current.depth > PACK_DEPTH_CAP) {
        truncated = true;
        continue;
      }
      const children = current.node.children ?? [];
      nodes.push({
        tag: String(current.node.tagName || "").toLowerCase(),
        role: (() => {
          const role = current.node.getAttribute?.("role");
          return role ? String(role).toLowerCase() : null;
        })(),
        depth: current.depth,
        childCount: Number(children.length || 0),
      });
      if (current.depth === PACK_DEPTH_CAP && Number(children.length || 0) > 0) {
        truncated = true;
        continue;
      }
      const limit = Math.min(Number(children.length || 0), 200);
      for (let index = 0; index < limit; index += 1) {
        queue.push({ node: children[index], depth: current.depth + 1 });
      }
    }
    if (queue.length > 0) truncated = true;
    return { nodes, truncated };
  };
  const nodeToSection = (el: any): string | null => {
    let current = el;
    let depth = 0;
    while (current && depth < 12) {
      if (candidateNodes.has(current)) return nodeKeyFor(current);
      current = current.parentElement;
      depth += 1;
    }
    return null;
  };
  const rawCandidates: Array<{
    component: AtlasScanComponent;
    el: any;
    index: number;
    onScreen: number;
    area: number;
    inSection: number;
  }> = [];
  let componentLimitHit = false;
  const includeComponents = hints?.components !== false;
  for (const el of includeComponents ? walked : []) {
    if (rawCandidates.length >= COMPONENT_RAW_CAP) {
      componentLimitHit = true;
      break;
    }
    const style = win.getComputedStyle(el);
    if (!style) continue;
    const semantic = componentHint(el, style);
    if (!semantic) continue;
    try {
      const rect = el.getBoundingClientRect();
      const bounded = walked.filter(
        (node: any) => node === el || el.contains(node),
      ) as any[];
      const tag = String(el.tagName || "").toLowerCase();
      const role = el.getAttribute?.("role");
      const ariaLabel = boundedAriaLabel(el);
      const label = clean(
        ariaLabel || el.getAttribute?.("title") || boundedText(el, 200, bounded),
      ).slice(0, 200);
      const overflowX = String(style.overflowX || "");
      const documentScrollsY = Number(root?.scrollHeight || 0);
      const offscreen =
        rect.width > 0 &&
        rect.height > 0 &&
        (rect.right < 0 ||
          rect.left > Number(win.innerWidth || 0) ||
          rect.bottom < 0 ||
          rect.top > documentScrollsY + Number(win.innerHeight || 0));
      // Off-canvas geometry is a rect entirely outside the viewport. A
      // transform alone (e.g. a centered modal scaled 1.02) is not enough.
      const offCanvas =
        rect.width > 0 &&
        rect.height > 0 &&
        (rect.right <= 0 ||
          rect.left >= Number(win.innerWidth || 0) ||
          rect.bottom <= 0 ||
          rect.top >= Number(win.innerHeight || 0));
      // A control can have a non-zero rect yet no usable pixels (clipped by an
      // ancestor or covered by an overlay). The browser hit test decides.
      const fullyClipped = !browserHitVisible(el, rect);
      const visible = visibleNode(el);
      const sectionNodeKey = nodeToSection(el);
      const area = Math.max(0, Math.round(rect.width)) * Math.max(0, Math.round(rect.height));
      const onScreen = visible && !offscreen && !offCanvas && !fullyClipped;
      const component: AtlasScanComponent = {
        nodeKey: nodeKeyFor(el),
        selector: selectorFor(el),
        tag,
        role: role ? String(role).toLowerCase() : null,
        inputType:
          tag === "input"
            ? String(el.getAttribute?.("type") || "text").toLowerCase()
            : null,
        hint: semantic.hint,
        hintBasis: semantic.basis,
        label,
        visible,
        offscreen,
        offCanvas,
        fullyClipped,
        sectionNodeKey,
        childCount: Number(el.children?.length || 0),
        descendantCount: Math.max(0, bounded.length - 1),
        hasHeading: bounded.some((node) =>
          /^h[1-6]$/i.test(String(node.tagName || "")),
        ),
        hasMedia: bounded.some((node) =>
          /^(img|picture|video|canvas)$/i.test(String(node.tagName || "")),
        ),
        hasIcon: bounded.some((node) =>
          /^(svg|img)$/i.test(String(node.tagName || "")),
        ),
        inNavigation: Boolean(closestWithin(el, "nav,[role=navigation]", 12)),
        ariaHasPopup: el.hasAttribute?.("aria-haspopup") === true,
        ariaExpanded: el.getAttribute?.("aria-expanded") ?? null,
        ariaControlsResolved: (() => {
          const controls = el.getAttribute?.("aria-controls");
          if (!controls) return false;
          const ids = String(controls).split(/\s+/).slice(0, 4);
          return ids.every((id) => Boolean(doc.getElementById?.(id)));
        })(),
        ariaLabel,
        overflowX,
        scrollableX:
          Number(el.scrollWidth || 0) > Number(el.clientWidth || 0) + 1 &&
          (overflowX === "auto" || overflowX === "scroll") &&
          rect.width > 0 &&
          rect.height > 0,
        position: String(style.position || ""),
        transformed: String(style.transform || "none") !== "none",
        shape: shapeOf(el),
        childCounts: childCountsOf(el),
        display: String(style.display || ""),
        gap: String(style.gap || style.columnGap || ""),
        padding: `${style.paddingTop || ""}/${style.paddingRight || ""}/${style.paddingBottom || ""}/${style.paddingLeft || ""}`,
        radius: String(style.borderRadius || ""),
        fontFamily: String(style.fontFamily || ""),
        fontSize: String(style.fontSize || ""),
        fontWeight: String(style.fontWeight || ""),
        lineHeight: String(style.lineHeight || ""),
        rect: {
          x: Math.round(
            scrollRootEl && scrollRootEl.contains(el)
              ? rect.x - (scrollRootRect?.left ?? 0) + (scrollRootEl.scrollLeft || 0)
              : rect.x + (win.scrollX || 0),
          ),
          y: Math.round(
            scrollRootEl && scrollRootEl.contains(el)
              ? rect.y - (scrollRootRect?.top ?? 0) + (scrollRootEl.scrollTop || 0)
              : rect.y + (win.scrollY || 0),
          ),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        depth: (() => {
          let d = 0;
          let parent = el.parentElement;
          let walkedDepth = 0;
          while (parent && walkedDepth < 12) {
            if (/^(MAIN|SECTION|ARTICLE|HEADER|FOOTER|NAV)$/.test(String(parent.tagName))) d += 1;
            parent = parent.parentElement;
            walkedDepth += 1;
          }
          return Math.min(d, 12);
        })(),
        pack: null,
      };
      rawCandidates.push({
        component,
        el,
        index: rawCandidates.length,
        onScreen: onScreen ? 1 : 0,
        area,
        inSection: sectionNodeKey ? 1 : 0,
      });
    } catch {
      /* skip an unreadable component, keep the scan deterministic */
    }
  }
  // DOM order is not importance: rank on-screen, large, section-bound controls
  // before taking the cap, then pack the highest-ranked candidates.
  rawCandidates.sort(
    (left, right) =>
      right.onScreen - left.onScreen ||
      right.area - left.area ||
      right.inSection - left.inSection ||
      left.index - right.index,
  );
  const keptCandidates = rawCandidates.slice(0, COMPONENT_CAP);
  const componentDroppedCount = Math.max(0, rawCandidates.length - keptCandidates.length);
  if (componentDroppedCount > 0) componentLimitHit = true;
  const components: AtlasScanComponent[] = keptCandidates.map((entry, index) => ({
    ...entry.component,
    pack: index < COMPONENT_PACK_CAP ? packFor(entry.el) : null,
  }));

  return {
    title: clean(doc.title),
    url: String(win.location.href),
    totalHeight: scrollRootEl
      ? Number(scrollRootEl.scrollHeight || 0)
      : documentHeight,
    scrollRoot: scrollRootEl ? scrollRootLabel(scrollRootEl) : null,
    scrollRootClientHeight: scrollRootEl ? Number(scrollRootEl.clientHeight || 0) : null,
    scrollRootScrollLeft: scrollRootEl ? Number(scrollRootEl.scrollLeft || 0) : null,
    scrollRootScrollTop: scrollRootEl ? Number(scrollRootEl.scrollTop || 0) : null,
    scrollX: Number(win.scrollX || 0),
    scrollY: Number(win.scrollY || 0),
    sections,
    components,
    sectionLimitHit: rawCandidateCount > 120,
    componentLimitHit,
    componentDroppedCount,
    rawSectionCount: rawCandidateCount,
    nodeBudgetHit,
    technologies: [],
    canvasCount: walked.filter(
      (node: any) => String(node.tagName || "").toLowerCase() === "canvas",
    ).length,
    webglObserved: false,
  };
};
