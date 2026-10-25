/**
 * analyze_accessibility: evidence-only accessibility census of a live page.
 *
 * The in-page snippet is self-contained (function declarations + globalThis,
 * no arrow functions) so page.evaluate can re-serialize it; the Node reducer
 * is pure and computes contrast ratios from the raw colors the snippet
 * collects. Nothing here grades the page: the result carries `heuristic: true`
 * and the fixed note "Evidence only — not a WCAG pass/fail". Contrast
 * composites the ancestor background stack for fully opaque chains; a sample
 * with any ancestor opacity group (<0.999) is skipped and counted in
 * `coverage.skippedOpacityGroups`, never approximated. Background images,
 * gradients and pseudo-elements are not modelled either, so contrast stays
 * heuristic wherever those paint the real backing.
 *
 * Bounds (plan W2): ≤200 text samples, ≤300 images, ≤100 focusables for
 * per-element evidence, ≤200 form controls, ≤5000 CSS rules inspected.
 *
 * Playwright stays an optional dependency: it is imported lazily by the
 * default loader and every loader/launch/navigation failure degrades to
 * `{ error }`.
 */
import { installSnippetShims } from "./structure.js";
import { resolveViewport, type ViewportName } from "./viewport.js";

export const A11Y_PLAYWRIGHT_HINT =
  "Accessibility analysis needs Playwright, which is an optional dependency.\n" +
  "Install it where this server runs (globally works for a global install):  npm install -g playwright && npx playwright install chromium\n" +
  "Then retry analyze_accessibility.";

export const A11Y_NOTE = "Evidence only — not a WCAG pass/fail";

export interface RawBackgroundLayer {
  /** Computed backgroundColor, including its own alpha. */
  color: string;
  /** Computed opacity of that ancestor (1 when unset); <0.999 means the whole subtree group is unsupported for ratios. */
  opacity: number;
}

export interface RawTextSample {
  text: string;
  color: string;
  /** Element-first ancestor background stack; reducer composites it bottom-up. */
  backgroundLayers: RawBackgroundLayer[];
  selector: string;
  fontSize: number;
  bold: boolean;
}

export interface RawA11yScan {
  url: string;
  lang: string | null;
  title: string;
  textSamples: RawTextSample[];
  images: {
    total: number;
    scanned: number;
    missingAlt: number;
    emptyAlt: number;
    decorativeOk: number;
  };
  headings: {
    total: number;
    multipleH1: number;
    order: number[];
    skipped: { level: number; previous: number; selector: string }[];
  };
  focus: {
    count: number;
    scanned: number;
    positiveTabindex: number;
    outlineRuleCount: number;
    outlineRules: { selector: string; css: string }[];
    rulesInspected: number;
    sheetsChecked: number;
    sheetsBlocked: number;
  };
  forms: {
    controls: number;
    scanned: number;
    unlabeledCount: number;
    unlabeled: { selector: string; type: string }[];
  };
}

const MAX_TEXT_SAMPLES = 200;
const MAX_WORST_PAIRS = 15;

const clamp = (n: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Number.isFinite(n) ? Math.trunc(n) : min));

/**
 * Runs IN THE PAGE via page.evaluate(A11Y_SNIPPET, { limit }). Serializes
 * plain data only; every probe is try/caught so a hostile page degrades to
 * fewer samples, never an exception.
 */
export const A11Y_SNIPPET = function (args: { limit?: number }): RawA11yScan {
  const g = globalThis as any;
  const doc = g.document;
  const limit = Math.min(200, Math.max(1, Number(args && args.limit) || 100));

  function selectorFor(el: any): string {
    const parts: string[] = [];
    let cur = el;
    let depth = 0;
    while (cur && cur.nodeType === 1 && depth < 4) {
      let part = String(cur.tagName || "").toLowerCase();
      if (cur.id) {
        part = part + "#" + String(cur.id);
        parts.unshift(part);
        break;
      }
      const cls = cur.classList && cur.classList.length ? String(cur.classList[0]) : "";
      if (cls && /^[A-Za-z0-9_-]+$/.test(cls)) part += "." + cls;
      parts.unshift(part);
      cur = cur.parentElement;
      depth++;
    }
    return parts.join(" > ").slice(0, 160);
  }

  function backgroundLayers(el: any): RawBackgroundLayer[] {
    const layers: RawBackgroundLayer[] = [];
    let cur = el;
    let depth = 0;
    while (cur && cur.nodeType === 1 && depth < 20) {
      const st = g.getComputedStyle(cur);
      const opacity = parseFloat(st.opacity);
      layers.push({
        color: String(st.backgroundColor || ""),
        opacity: Number.isFinite(opacity) ? opacity : 1,
      });
      cur = cur.parentElement;
      depth++;
    }
    return layers;
  }

  // ---- contrast samples ----
  const textSamples: RawTextSample[] = [];
  try {
    const walker = doc.createTreeWalker(doc.body || doc.documentElement, 4);
    let node = walker.nextNode();
    while (node && textSamples.length < limit) {
      const parent = node.parentElement;
      const text = String(node.nodeValue || "").replace(/\s+/g, " ").trim();
      if (parent && text) {
        const tag = String(parent.tagName || "").toLowerCase();
        if (tag !== "script" && tag !== "style" && tag !== "noscript" && tag !== "title") {
          try {
            const st = g.getComputedStyle(parent);
            const rect = parent.getBoundingClientRect();
            const fontSize = parseFloat(st.fontSize) || 0;
            if (
              st.display !== "none" &&
              st.visibility !== "hidden" &&
              rect.width > 0 &&
              rect.height > 0 &&
              fontSize >= 1
            ) {
              textSamples.push({
                text: text.slice(0, 80),
                color: String(st.color || ""),
                backgroundLayers: backgroundLayers(parent),
                selector: selectorFor(parent),
                fontSize: Math.round(fontSize * 10) / 10,
                bold: Number(st.fontWeight) >= 600,
              });
            }
          } catch {
            /* one unreadable node never stops the walk */
          }
        }
      }
      node = walker.nextNode();
    }
  } catch {
    /* body unavailable: no contrast samples */
  }

  // ---- images ----
  const images = { total: 0, scanned: 0, missingAlt: 0, emptyAlt: 0, decorativeOk: 0 };
  try {
    const imgs = doc.querySelectorAll("img");
    images.total = imgs.length;
    images.scanned = Math.min(imgs.length, 300);
    for (let i = 0; i < images.scanned; i++) {
      const img = imgs[i];
      try {
        const hasAlt = img.hasAttribute("alt");
        const alt = String(img.getAttribute("alt") || "").trim();
        const role = String(img.getAttribute("role") || "").toLowerCase();
        const hidden = String(img.getAttribute("aria-hidden") || "").toLowerCase() === "true";
        const presentational = role === "presentation" || role === "none";
        if (!hasAlt) {
          if (presentational || hidden) images.decorativeOk++;
          else images.missingAlt++;
        } else if (alt === "") {
          images.emptyAlt++;
          images.decorativeOk++;
        }
      } catch {
        /* skip one unreadable image */
      }
    }
  } catch {
    /* no images */
  }

  // ---- headings ----
  const headings = { total: 0, multipleH1: 0, order: [] as number[], skipped: [] as { level: number; previous: number; selector: string }[] };
  try {
    const hs = doc.querySelectorAll("h1,h2,h3,h4,h5,h6");
    headings.total = hs.length;
    let prev = 0;
    for (let i = 0; i < hs.length; i++) {
      const level = Number(String(hs[i].tagName || "").charAt(1));
      if (!level) continue;
      if (level === 1) headings.multipleH1++;
      if (headings.order.length < 100) headings.order.push(level);
      if (prev > 0 && level > prev + 1 && headings.skipped.length < 10) {
        headings.skipped.push({ level, previous: prev, selector: selectorFor(hs[i]) });
      }
      prev = level;
    }
  } catch {
    /* no headings */
  }

  // ---- focus ----
  const focus = {
    count: 0,
    scanned: 0,
    positiveTabindex: 0,
    outlineRuleCount: 0,
    outlineRules: [] as { selector: string; css: string }[],
    rulesInspected: 0,
    sheetsChecked: 0,
    sheetsBlocked: 0,
  };
  try {
    const FOCUS_SELECTOR =
      "a[href],area[href],button,input,select,textarea,iframe,summary," +
      "audio[controls],video[controls],[tabindex],[contenteditable=''],[contenteditable='true']";
    const focusEls = doc.querySelectorAll(FOCUS_SELECTOR);
    focus.count = focusEls.length;
    focus.scanned = Math.min(focusEls.length, 100);
    for (let i = 0; i < focus.scanned; i++) {
      const t = focusEls[i].getAttribute("tabindex");
      if (t !== null && Number(t) > 0) focus.positiveTabindex++;
    }
  } catch {
    /* no focusables */
  }
  let inspected = 0;
  function collectRules(rules: any, depth: number): void {
    if (!rules || depth > 2) return;
    for (let i = 0; i < rules.length && inspected < 5000; i++) {
      inspected++;
      const rule = rules[i];
      if (!rule) continue;
      if (rule.cssRules) {
        collectRules(rule.cssRules, depth + 1);
        continue;
      }
      const cssText = String(rule.cssText || "");
      if (/outline\s*:\s*(none|0(?:px)?)\s*(?:;|\}|$|!important)/i.test(cssText)) {
        focus.outlineRuleCount++;
        if (focus.outlineRules.length < 25) {
          focus.outlineRules.push({
            selector: String(rule.selectorText || "").slice(0, 120),
            css: cssText.slice(0, 200),
          });
        }
      }
    }
  }
  try {
    const sheets = doc.styleSheets;
    for (let i = 0; i < sheets.length; i++) {
      let rules: any;
      try {
        rules = sheets[i].cssRules;
      } catch {
        focus.sheetsBlocked++; // cross-origin sheet
        continue;
      }
      focus.sheetsChecked++;
      collectRules(rules, 0);
    }
    focus.rulesInspected = inspected;
  } catch {
    /* stylesheet access unavailable */
  }

  // ---- forms ----
  const forms = { controls: 0, scanned: 0, unlabeledCount: 0, unlabeled: [] as { selector: string; type: string }[] };
  try {
    const controls = doc.querySelectorAll("input,select,textarea");
    forms.controls = controls.length;
    forms.scanned = Math.min(controls.length, 200);
    const labelTargets: Record<string, boolean> = {};
    const labelEls = doc.querySelectorAll("label[for]");
    for (let i = 0; i < labelEls.length; i++) {
      const f = labelEls[i].getAttribute("for");
      if (f) labelTargets[f] = true;
    }
    const SKIP_INPUT_TYPES = ["hidden", "submit", "button", "reset", "image"];
    for (let i = 0; i < forms.scanned; i++) {
      const el = controls[i];
      try {
        const tag = String(el.tagName || "").toLowerCase();
        const type = String(el.getAttribute("type") || (tag === "input" ? "text" : tag)).toLowerCase();
        if (tag === "input" && SKIP_INPUT_TYPES.indexOf(type) !== -1) continue;
        let labeled = String(el.getAttribute("aria-label") || "").trim().length > 0;
        if (!labeled) {
          const by = String(el.getAttribute("aria-labelledby") || "").trim();
          if (by) {
            const ids = by.split(/\s+/);
            for (let j = 0; j < ids.length; j++) {
              const ref = doc.getElementById(ids[j]);
              if (ref && String(ref.textContent || "").trim()) {
                labeled = true;
                break;
              }
            }
          }
        }
        if (!labeled) {
          const id = el.getAttribute("id");
          if (id && labelTargets[id]) labeled = true;
        }
        if (!labeled && el.closest) {
          if (el.closest("label")) labeled = true;
        }
        if (!labeled) {
          forms.unlabeledCount++;
          if (forms.unlabeled.length < 10) forms.unlabeled.push({ selector: selectorFor(el), type: type || tag });
        }
      } catch {
        /* skip one unreadable control */
      }
    }
  } catch {
    /* no forms */
  }

  return {
    url: String(doc.location ? doc.location.href : ""),
    lang: String(doc.documentElement.getAttribute("lang") || "").trim() || null,
    title: String(doc.title || "").trim(),
    textSamples,
    images,
    headings,
    focus,
    forms,
  };
};

export interface ContrastPair {
  ratio: number;
  color: string;
  /** Final background after compositing every ancestor layer, as rgb(). */
  background: string;
  selector: string;
  text: string;
  fontSize: number;
  bold: boolean;
}

export interface A11yEvidence {
  contrast: {
    sampled: number;
    unparseable: number;
    worstPairs: ContrastPair[];
  };
  images: RawA11yScan["images"];
  headings: RawA11yScan["headings"];
  focus: RawA11yScan["focus"];
  forms: RawA11yScan["forms"];
  document: { lang: string | null; titlePresent: boolean };
}

export interface AccessibilityResult {
  url: string;
  viewport: ViewportName;
  evidence: A11yEvidence;
  coverage: {
    textNodesSampled: number;
    images: number;
    focusables: number;
    /** Samples under an ancestor opacity group; no ratio is emitted for them. */
    skippedOpacityGroups: number;
  };
  heuristic: true;
  note: string;
}

export interface A11yOpts {
  viewport?: ViewportName;
  /** Text-node sample cap (1..200; default 100). */
  limit?: number;
}

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const clampChannel = (n: number): number => Math.min(255, Math.max(0, n));

/** Parse the rgb()/rgba() forms getComputedStyle serializes (comma or space). */
export function parseCssColor(input: string): Rgba | null {
  const s = String(input || "").trim().toLowerCase();
  if (s === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  if (s === "white") return { r: 255, g: 255, b: 255, a: 1 };
  if (s === "black") return { r: 0, g: 0, b: 0, a: 1 };
  const m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (!m) return null;
  const parts = m[1].replace(/\//g, " ").split(/[\s,]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const channel = (p: string): number =>
    p.endsWith("%") ? (parseFloat(p) / 100) * 255 : parseFloat(p);
  const r = channel(parts[0]);
  const g = channel(parts[1]);
  const b = channel(parts[2]);
  const a = parts.length >= 4
    ? parts[3].endsWith("%")
      ? parseFloat(parts[3]) / 100
      : parseFloat(parts[3])
    : 1;
  if (![r, g, b, a].every((n) => Number.isFinite(n))) return null;
  return { r: clampChannel(r), g: clampChannel(g), b: clampChannel(b), a: Math.min(1, Math.max(0, a)) };
}

/** Alpha-composite fg over an opaque bg. */
function blend(fg: Rgba, bg: Rgba): Rgba {
  const a = fg.a;
  return {
    r: clampChannel(fg.r * a + bg.r * (1 - a)),
    g: clampChannel(fg.g * a + bg.g * (1 - a)),
    b: clampChannel(fg.b * a + bg.b * (1 - a)),
    a: 1,
  };
}

function luminance(c: Rgba): number {
  const chan = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(c.r) + 0.7152 * chan(c.g) + 0.0722 * chan(c.b);
}

/**
 * True when any ancestor in the stack has a CSS opacity group (<0.999).
 * Opacity applies to the whole subtree (text AND backgrounds), so the
 * background-only model here cannot produce an honest ratio for such samples;
 * the reducer counts them as skipped instead of approximating.
 */
export function hasOpacityGroup(layers: RawBackgroundLayer[]): boolean {
  for (const layer of layers) {
    if (Number.isFinite(layer.opacity) && layer.opacity < 0.999) return true;
  }
  return false;
}

/**
 * Composite an element-first background stack bottom-up over the white
 * browser canvas. Callers must reject opacity groups first (`hasOpacityGroup`):
 * this models color alpha layers only. Returns null when a layer color cannot
 * be parsed (for example a modern color function outside rgb()/rgba());
 * transparent layers are skipped. Background images, gradients and
 * pseudo-elements are not modelled — the ratio stays a heuristic for those.
 */
export function compositeBackground(layers: RawBackgroundLayer[]): Rgba | null {
  let bg: Rgba = { r: 255, g: 255, b: 255, a: 1 };
  for (let i = layers.length - 1; i >= 0; i--) {
    const color = parseCssColor(layers[i].color);
    if (!color) return null;
    if (color.a <= 0) continue;
    bg = blend(color, bg);
  }
  return bg;
}

const cssRgb = (c: Rgba): string =>
  `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;

function ratioOn(fg: Rgba, bg: Rgba): number {
  const opaqueFg = blend(fg, bg);
  const l1 = luminance(opaqueFg);
  const l2 = luminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * WCAG contrast ratio of a text color over a composited ancestor stack, or
 * null when the text color or any layer cannot be parsed, or when an ancestor
 * opacity group makes the background-only model unsupported.
 */
export function contrastRatioOverLayers(
  fg: string,
  layers: RawBackgroundLayer[],
): number | null {
  if (hasOpacityGroup(layers)) return null;
  const f = parseCssColor(fg);
  const b = compositeBackground(layers);
  if (!f || !b) return null;
  return ratioOn(f, b);
}

/**
 * WCAG contrast ratio between two CSS colors, or null when either cannot be
 * parsed. Translucent backgrounds composite over the white browser canvas;
 * translucent text composites over the resulting background. For a layered
 * page background use contrastRatioOverLayers.
 */
export function contrastRatio(fg: string, bg: string): number | null {
  const f = parseCssColor(fg);
  const b = parseCssColor(bg);
  if (!f || !b) return null;
  return ratioOn(f, blend(b, { r: 255, g: 255, b: 255, a: 1 }));
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Pure reducer: raw page scan → bounded evidence + coverage. */
export function reduceA11y(
  raw: RawA11yScan,
  limit = 100,
): { evidence: A11yEvidence; coverage: AccessibilityResult["coverage"] } {
  const samples = raw.textSamples.slice(0, clamp(limit, 1, MAX_TEXT_SAMPLES));
  const pairs: ContrastPair[] = [];
  let unparseable = 0;
  let skippedOpacityGroups = 0;
  for (const s of samples) {
    if (hasOpacityGroup(s.backgroundLayers)) {
      skippedOpacityGroups++;
      continue;
    }
    const fg = parseCssColor(s.color);
    const bg = compositeBackground(s.backgroundLayers);
    if (!fg || !bg) {
      unparseable++;
      continue;
    }
    const ratio = ratioOn(fg, bg);
    pairs.push({
      ratio: round2(ratio),
      color: s.color,
      background: cssRgb(bg),
      selector: s.selector,
      text: s.text,
      fontSize: s.fontSize,
      bold: s.bold,
    });
  }
  pairs.sort((a, b) => a.ratio - b.ratio || a.selector.localeCompare(b.selector));
  return {
    evidence: {
      contrast: {
        sampled: pairs.length,
        unparseable,
        worstPairs: pairs.slice(0, MAX_WORST_PAIRS),
      },
      images: raw.images,
      headings: raw.headings,
      focus: raw.focus,
      forms: raw.forms,
      document: { lang: raw.lang, titlePresent: raw.title.length > 0 },
    },
    coverage: {
      textNodesSampled: samples.length,
      images: raw.images.scanned,
      focusables: raw.focus.scanned,
      skippedOpacityGroups,
    },
  };
}

const msg = (err: unknown): string =>
  err instanceof Error ? err.message.replace(/\s+/g, " ").trim() : String(err);

/**
 * Open a page in headless Chromium, run the snippet, reduce. Playwright is
 * lazy/optional; every failure degrades to `{ error }`.
 */
export async function analyzeAccessibility(
  url: string,
  opts: A11yOpts = {},
  loader: () => Promise<any> = () => import("playwright" as string),
): Promise<AccessibilityResult | { error: string }> {
  let pageUrl: URL;
  try {
    pageUrl = new URL(url);
  } catch {
    return { error: `Invalid URL: ${url}` };
  }
  if (pageUrl.protocol !== "http:" && pageUrl.protocol !== "https:") {
    return { error: "analyze_accessibility only accepts http(s) URLs" };
  }
  let chromium: any;
  try {
    ({ chromium } = await loader());
  } catch {
    return { error: A11Y_PLAYWRIGHT_HINT };
  }
  let browser: any;
  try {
    browser = await chromium.launch();
  } catch {
    return { error: A11Y_PLAYWRIGHT_HINT };
  }
  const limit = clamp(opts.limit ?? 100, 1, MAX_TEXT_SAMPLES);
  try {
    const { width, height, ...contextOpts } = resolveViewport(opts.viewport);
    const page = await browser.newPage({ viewport: { width, height }, ...contextOpts });
    await installSnippetShims(page);
    await page.goto(pageUrl.href, { waitUntil: "load", timeout: 45_000 });
    await page.waitForTimeout(3000);
    const raw = (await page.evaluate(A11Y_SNIPPET, { limit })) as RawA11yScan;
    const viewport = opts.viewport ?? "desktop";
    const { evidence, coverage } = reduceA11y(raw, limit);
    return { url: raw.url || pageUrl.href, viewport, evidence, coverage, heuristic: true, note: A11Y_NOTE };
  } catch (err) {
    return { error: msg(err) };
  } finally {
    try {
      await browser.close();
    } catch {
      /* keep the primary error */
    }
  }
}
