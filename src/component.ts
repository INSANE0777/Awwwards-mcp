import { installSnippetShims, preScroll } from "./structure.js";
import { resolveViewport, type ViewportName } from "./viewport.js";

/** One node of the serialized component tree (plain data, page-serializable). */
export interface ComponentNode {
  tag: string;
  classes: string[];
  rect: { x: number; y: number; w: number; h: number };
  /** Bounded computed-style subset (resolved STYLE_PROPS keys). */
  styles: Record<string, string>;
  /** Leaf text, ≤200 chars (slot candidate). */
  text?: string;
  imgSrc?: string;
  imgW?: number;
  imgH?: number;
  /** outerHTML for svg elements, ≤20KB. */
  svg?: string;
  /** Element animations ≤10 per node, timing from effect.getTiming(). */
  anims?: { props: string[]; durationMs: number | null; easing: string | null }[];
  children: ComponentNode[];
}

/** Reduced capture pack for one component. */
export interface ComponentPack {
  id: "component-pack-v1";
  url: string;
  selector: string;
  capturedAt: number;
  viewport: { width: number; height: number };
  nodeCount: number;
  root: ComponentNode;
  fonts: string[];
  colors: string[];
}

/** What page.evaluate(COMPONENT_SNIPPET) serializes back from the page. */
export interface RawComponentScan {
  notFound: boolean;
  selector: string;
  nodeCount: number;
  fonts: string[];
  colors: string[];
  root: ComponentNode | null;
}

export interface CaptureComponentOptions {
  selector?: string;
  timeoutMs?: number;
  viewport?: ViewportName;
  loader?: () => Promise<any>;
}

/** Bounded computed-style subset collected per node (brief Step 3 list). */
type StyleProp =
  | "display" | "position" | "flexDirection" | "gridTemplateColumns" | "gap" | "padding"
  | "margin" | "width" | "height" | "background" | "backgroundColor" | "color"
  | "fontFamily" | "fontSize" | "fontWeight" | "lineHeight" | "letterSpacing"
  | "textTransform" | "borderRadius" | "boxShadow" | "border" | "transform"
  | "transition" | "opacity" | "overflow" | "zIndex";

// Runs IN THE PAGE via page.evaluate(COMPONENT_SNIPPET, { selector, maxNodes }).
// Plain `function` expression (no arrow — page.evaluate re-serializes the
// source) with zero outer references, browser globals through globalThis (Node
// tsconfig has no DOM lib), every probe try/caught. Mirrors POSE_SNIPPET
// (pose3d.ts) and SCROLL_CENSUS_SNIPPET (census.ts). Depth-first walk with an
// explicit counter; stops enqueueing children past maxNodes so the returned
// tree is bounded. Fonts/colors collect into Sets at the root during the walk.
export const COMPONENT_SNIPPET = function (arg: { selector: string; maxNodes: number }): RawComponentScan {
  const g = globalThis as any;
  const doc = g.document;
  // Declared INSIDE the snippet: page.evaluate serializes the function source
  // only — module-scope constants would be undefined in the page.
  const STYLE_PROPS: StyleProp[] = [
    "display", "position", "flexDirection", "gridTemplateColumns", "gap", "padding",
    "margin", "width", "height", "background", "backgroundColor", "color",
    "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing",
    "textTransform", "borderRadius", "boxShadow", "border", "transform",
    "transition", "opacity", "overflow", "zIndex",
  ];
  const maxNodes = arg && arg.maxNodes > 0 ? Math.floor(arg.maxNodes) : 400;
  const fonts: string[] = [];
  const colors: string[] = [];
  let count = 0;

  function addFont(v: unknown): void {
    try {
      const s = String(v);
      if (s && fonts.indexOf(s) === -1) fonts.push(s);
    } catch {}
  }
  function addColor(v: unknown): void {
    try {
      const s = String(v);
      if (s && colors.indexOf(s) === -1) colors.push(s);
    } catch {}
  }

  // Bounded computed-style subset; each probe try/caught, undefined skipped.
  function stylesOf(el: any): Record<string, string> {
    const out: Record<string, string> = {};
    let s: any = null;
    try {
      s = g.getComputedStyle(el);
    } catch {}
    if (!s) return out;
    for (let i = 0; i < STYLE_PROPS.length; i++) {
      const p = STYLE_PROPS[i];
      try {
        const v = s[p];
        if (v === undefined || v === null || v === "") continue;
        if (p === "color" || p === "backgroundColor" || p === "background") {
          addColor(v);
          if (v !== "none") out[p] = String(v);
        } else if (p === "fontFamily") {
          addFont(v);
          if (v !== "none") out[p] = String(v);
        } else if (v !== "none") {
          out[p] = String(v);
        }
      } catch {}
    }
    return out;
  }

  // ≤10 element animations per node: props from transitionProperty (transitions)
  // or the animationName flag (keyframes), timing from effect.getTiming().
  function animsOf(el: any): { props: string[]; durationMs: number | null; easing: string | null }[] {
    const rows: { props: string[]; durationMs: number | null; easing: string | null }[] = [];
    try {
      const anims = el.getAnimations ? el.getAnimations({ subtree: false }) : [];
      for (let i = 0; i < anims.length && i < 10; i++) {
        try {
          const a = anims[i];
          const effect = a && a.effect;
          // CSSTransition exposes the animated property on a.propertyName
          // (transitionProperty is not a real accessor); CSSAnimation keeps
          // animationName. Undefined-safe, dropped when both probes miss.
          let props: string[] = [];
          try {
            const tp = a.propertyName ?? a.transitionProperty;
            if (tp && tp !== "all") props = String(tp).split(/\s+/).filter(Boolean);
          } catch {}
          if (props.length === 0) {
            try {
              const an = a.animationName;
              if (an && an !== "none") props = ["animationName"];
            } catch {}
          }
          if (props.length === 0) continue;
          let durationMs: number | null = null;
          let easing: string | null = null;
          try {
            const timing = effect && effect.getTiming ? effect.getTiming() : null;
            if (timing) {
              if (typeof timing.duration === "number") durationMs = timing.duration;
              if (timing.easing) easing = String(timing.easing);
            }
          } catch {}
          rows.push({ props: props, durationMs: durationMs, easing: easing });
        } catch {}
      }
    } catch {}
    return rows;
  }

  function ser(el: any): ComponentNode | null {
    if (count >= maxNodes) return null;
    count++;
    const node: any = { tag: "*", classes: [], rect: { x: 0, y: 0, w: 0, h: 0 }, styles: {}, children: [] };
    try {
      node.tag = String(el.tagName || "*").toLowerCase();
    } catch {}
    try {
      const cl = el.classList;
      if (cl) {
        for (let i = 0; i < cl.length; i++) node.classes.push(String(cl[i]));
      }
    } catch {}
    try {
      const r = el.getBoundingClientRect();
      node.rect = { x: r.x, y: r.y, w: r.width, h: r.height };
    } catch {}
    node.styles = stylesOf(el);
    try {
      if (!el.children || el.children.length === 0) {
        const t = el.textContent;
        if (t && t.trim()) node.text = String(t).trim().slice(0, 200);
      }
    } catch {}
    try {
      if (node.tag === "img") {
        try { node.imgSrc = String(el.currentSrc || el.src || ""); } catch {}
        try { node.imgW = el.naturalWidth; } catch {}
        try { node.imgH = el.naturalHeight; } catch {}
      } else if (node.tag === "svg") {
        try { node.svg = String(el.outerHTML).slice(0, 20000); } catch {}
      }
    } catch {}
    node.anims = animsOf(el);
    return node;
  }

  function walk(el: any): ComponentNode | null {
    const node = ser(el);
    if (!node) return null;
    try {
      if (count < maxNodes) {
        const kids = el.children ? Array.from(el.children) : [];
        for (let i = 0; i < kids.length; i++) {
          if (count >= maxNodes) break;
          const sub = walk(kids[i]);
          if (sub) node.children.push(sub);
        }
      }
    } catch {}
    return node;
  }

  let root: ComponentNode | null = null;
  let usedSelector = arg && arg.selector ? String(arg.selector) : "header";
  try {
    const el = doc.querySelector(usedSelector);
    if (el) root = walk(el);
  } catch {}

  return {
    notFound: !root,
    selector: usedSelector,
    nodeCount: count,
    fonts: fonts,
    colors: colors,
    root: root,
  };
};

// PURE: stamps id/viewport/nodeCount and dedupes+sorts fonts/colors. Truncates
// the raw tree at maxNodes (clamped 50..2000) with a recursive counter so
// nodeCount always equals the nodes actually kept.
export function reduceComponent(
  input: {
    url: string;
    capturedAt: number;
    selector: string;
    viewport: { width: number; height: number };
    scan: RawComponentScan;
  },
  maxNodes = 400,
): ComponentPack | { error: string } {
  const cap = Math.min(2000, Math.max(50, maxNodes));
  if (!input.scan || input.scan.notFound || !input.scan.root) {
    return { error: "selector not found: " + input.selector };
  }
  // Fonts/colors are collected in-page by the snippet; the reducer only
  // dedupes+sorts the scan's collected values.
  const fonts = new Set<string>(input.scan.fonts ?? []);
  const colors = new Set<string>(input.scan.colors ?? []);
  let nodeCount = 0;

  // Keeps `node` plus as much of its subtree as `budget` allows; prunes
  // children lists at the cap (truncation, never a crash). Returns budget left.
  function keep(node: ComponentNode, budget: number): number {
    nodeCount++;
    let rem = budget - 1;
    if (rem <= 0) {
      node.children = [];
      return rem;
    }
    const kept: ComponentNode[] = [];
    for (const child of node.children) {
      if (rem <= 0) break;
      kept.push(child);
      rem = keep(child, rem);
    }
    node.children = kept;
    return rem;
  }

  keep(input.scan.root, cap);
  return {
    id: "component-pack-v1",
    url: input.url,
    selector: input.selector,
    capturedAt: input.capturedAt,
    viewport: input.viewport,
    nodeCount: nodeCount,
    root: input.scan.root,
    fonts: Array.from(fonts).sort(),
    colors: Array.from(colors).sort(),
  };
}

// Captures one component subtree: house lifecycle (shims → goto → settle →
// preScroll → back to top → 500ms so entrance animations land and the
// component is at rest) then one COMPONENT_SNIPPET evaluate. Mirrors
// capturePose3d (pose3d.ts). Not-found is an error contract, not a throw.
export async function captureComponent(
  url: string,
  opts?: CaptureComponentOptions,
): Promise<ComponentPack | { error: string }> {
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
      // "load" can fire before late XHRs settle; fixed settle window.
      await page.waitForTimeout(3000);
      await preScroll(page);
      try {
        await page.evaluate(function () {
          try {
            globalThis.scrollTo(0, 0);
          } catch {}
        });
      } catch {}
      // 500ms after returning to top: entrance animations fire and the
      // component is at rest before serialization.
      await page.waitForTimeout(500);
      const arg = { selector: opts?.selector ?? "header", maxNodes: 400 };
      const scan = (await page.evaluate(COMPONENT_SNIPPET, arg)) as RawComponentScan;
      return reduceComponent(
        { url: url, capturedAt: Date.now(), selector: arg.selector, viewport: { width: width, height: height }, scan: scan },
        arg.maxNodes,
      );
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
