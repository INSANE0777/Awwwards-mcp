// N2 motion manifest: per-section measured triggers from analyze_scroll_map
// plus the DOM initial-state scan that is always available. Pure data in/out —
// emitters and the CLI never interpret vendor bundle internals here.

import type { RebuildSection, Split } from "./build-project.js";

export interface MotionTrigger {
  selector: string;
  start: number | null; // viewport px from gsapTriggers/scrubCurves, null when unmeasured
  end: number | null;
  scrub: boolean;
  pin: boolean;
  durationMs: number | null;
  ease: string | null;
}

export interface HiddenHint {
  selector: string;
  hint: string; // "opacity:0" | "visibility:hidden" | "transform:translate"
}

export interface SectionMotion {
  id: string;
  component: string; // SectionNN — the emitted skeleton's owner
  measured: boolean;
  triggers: MotionTrigger[];
  initialHidden: HiddenHint[];
  animatedSelectors: string[];
}

export interface MotionManifest {
  version: 1;
  measured: boolean;
  sections: SectionMotion[];
  pageTriggers: MotionTrigger[]; // measured triggers whose selector owned no section
  pageAnimatedSelectors: string[];
}

export interface MotionEmitOptions {
  manifest: MotionManifest;
  authored: boolean;
}

interface CensusAnim {
  selector: string;
  durationMs: number | null;
  easing: string | null;
  scrub: boolean;
  pin: boolean;
}

interface CensusTrigger {
  selector: string;
  scrub: boolean;
  pin: boolean;
  startPx: number | null;
  endPx: number | null;
  durationMs: number | null;
  easing: string | null;
}

interface CensusCurve {
  selector: string;
  startPx: number | null;
  endPx: number | null;
}

export interface NormalizedCensus {
  anims: CensusAnim[];
  gsapTriggers: CensusTrigger[];
  scrubCurves: CensusCurve[];
}

export interface CensusParse {
  census: NormalizedCensus;
  warnings: string[];
}

// Bounded reads: a pathological census must never balloon the manifest.
const MAX_ANIMS = 300;
const MAX_TRIGGERS = 120;
const MAX_CURVES = 60;
const MAX_SECTION_TRIGGERS = 24;
const MAX_HIDDEN = 24;
const MAX_SELECTORS = 32;
const MAX_ELEMENTS = 400;
const MAX_SELECTOR_CHARS = 200;

const asRecord = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const finite = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const text = (v: unknown, max = MAX_SELECTOR_CHARS): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

const bool = (v: unknown): boolean => v === true;

const durationMs = (v: unknown): number | null => {
  const n = finite(v);
  return n === null || n < 0 ? null : n;
};

// GSAP vars carry seconds; a bare numeric duration is the only form we read.
const gsapDurationMs = (vars: Record<string, unknown> | null): number | null => {
  const raw = vars?.duration;
  const n = typeof raw === "string" ? Number(raw) : finite(raw);
  return n === null || !Number.isFinite(n) || n < 0 ? null : Math.round(n * 1000);
};

const unquote = (v: string): string => v.replace(/^["']|["']$/g, "").trim();

const normalizeRows = <T extends { selector: string }>(
  rows: unknown[],
  max: number,
  parse: (row: Record<string, unknown>, selector: string) => T,
): { rows: T[]; skipped: number } => {
  const out: T[] = [];
  let skipped = 0;
  for (const raw of rows) {
    if (out.length >= max) break;
    const row = asRecord(raw);
    const selector = text(row?.selector);
    if (!row || selector === "") {
      skipped += 1;
      continue;
    }
    out.push(parse(row, selector));
  }
  return { rows: out, skipped };
};

/**
 * Validates and normalizes an analyze_scroll_map payload. Missing required
 * arrays are errors; malformed rows are skipped with a warning. A verify_build
 * dump that nests the census under `scrollCensus` is accepted too.
 */
export function normalizeScrollCensus(raw: unknown): CensusParse | { error: string } {
  const root = asRecord(raw);
  if (!root) return { error: "motion census: expected a JSON object" };
  const source = asRecord(root.scrollCensus) ?? root;
  if (!Array.isArray(source.anims)) return { error: "motion census: anims[] is missing" };
  if (!Array.isArray(source.gsapTriggers)) return { error: "motion census: gsapTriggers[] is missing" };
  const curvesRaw = Array.isArray(source.scrubCurves) ? source.scrubCurves : [];

  const anims = normalizeRows(source.anims, MAX_ANIMS, (row, selector) => ({
    selector,
    durationMs: durationMs(row.durationMs),
    easing: unquote(text(row.easing, 80)) || null,
    scrub: bool(row.scrub),
    pin: bool(row.pin),
  }));
  const triggers = normalizeRows(source.gsapTriggers, MAX_TRIGGERS, (row, selector) => {
    const vars = asRecord(row.vars);
    return {
      selector,
      scrub: bool(row.scrub),
      pin: bool(row.pin),
      startPx: finite(row.startPx),
      endPx: finite(row.endPx),
      durationMs: gsapDurationMs(vars),
      easing: unquote(text(vars?.ease, 80)) || null,
    };
  });
  const curves = normalizeRows(curvesRaw, MAX_CURVES, (row, selector) => ({
    selector,
    startPx: finite(row.startPx),
    endPx: finite(row.endPx),
  }));

  const skipped = anims.skipped + triggers.skipped + curves.skipped;
  const warnings: string[] = [];
  if (skipped > 0) warnings.push(`motion census: skipped ${skipped} malformed row(s)`);
  if (anims.rows.length === 0 && triggers.rows.length === 0) {
    warnings.push("motion census: no anims or gsapTriggers — manifest has no measured triggers");
  }
  return {
    census: { anims: anims.rows, gsapTriggers: triggers.rows, scrubCurves: curves.rows },
    warnings,
  };
}

const attr = (tag: string, name: string): string => {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : "";
};

const cssIdent = (v: string): string => v.replace(/[^A-Za-z0-9_-]/g, (c) => `\\${c}`);

interface ScannedElement {
  tag: string;
  id: string;
  classes: string[];
  style: string;
}

const stripComments = (html: string): string => html.replace(/<!--[\s\S]*?-->/g, "");

const scanElements = (section: RebuildSection): ScannedElement[] => {
  const elements: ScannedElement[] = [];
  const push = (tag: string, attrs: string) => {
    if (elements.length >= MAX_ELEMENTS) return;
    elements.push({
      tag,
      id: attr(attrs, "id"),
      classes: attr(attrs, "class").trim().split(/\s+/).filter(Boolean),
      style: attr(attrs, "style"),
    });
  };
  const rootTag = /^<([a-zA-Z][a-zA-Z0-9:-]*)/.exec(section.startTag)?.[1] ?? section.tag;
  push(rootTag.toLowerCase(), section.startTag);
  for (const m of stripComments(section.innerHtml).matchAll(/<([a-zA-Z][a-zA-Z0-9:-]*)\b([^>]*)>/g)) {
    push((m[1] ?? "").toLowerCase(), m[2] ?? "");
  }
  return elements;
};

const SCOPE = (section: RebuildSection): string =>
  section.id ? `#${cssIdent(section.id)}` : section.className ? `.${cssIdent(section.className)}` : "";

const elementSelector = (el: ScannedElement, scope: string): string => {
  if (el.id) return `#${cssIdent(el.id)}`;
  const base = el.classes[0] ? `.${cssIdent(el.classes[0])}` : el.tag;
  return scope ? `${scope} ${base}` : base;
};

// Likely motion class names only — this is a hint list, not a classifier.
const MOTION_CLASS = /(?:^|[-_])(?:anim|animate|animated|reveal|fade|slide|zoom|parallax|stagger|marquee)(?:[-_]|$)/i;

interface DomScan {
  initialHidden: HiddenHint[];
  animatedSelectors: string[];
  tokens: Set<string>; // ids + classes, for census-selector attribution
}

const scanSectionDom = (section: RebuildSection): DomScan => {
  const elements = scanElements(section);
  const scope = SCOPE(section);
  const hidden: HiddenHint[] = [];
  const animated: string[] = [];
  const tokens = new Set<string>();
  const hiddenSeen = new Set<string>();
  const animatedSeen = new Set<string>();
  const addHidden = (selector: string, hint: string) => {
    const key = `${selector}::${hint}`;
    if (hidden.length >= MAX_HIDDEN || hiddenSeen.has(key)) return;
    hiddenSeen.add(key);
    hidden.push({ selector, hint });
  };
  const addAnimated = (selector: string) => {
    if (animated.length >= MAX_SELECTORS || animatedSeen.has(selector)) return;
    animatedSeen.add(selector);
    animated.push(selector);
  };
  for (const el of elements) {
    if (el.id) tokens.add(el.id);
    for (const cls of el.classes) tokens.add(cls);
    const selector = elementSelector(el, scope);
    if (/opacity\s*:\s*0(?:[;\s!]|$)/i.test(el.style)) addHidden(selector, "opacity:0");
    if (/visibility\s*:\s*hidden/i.test(el.style)) addHidden(selector, "visibility:hidden");
    if (/transform\s*:\s*[^;]*\btranslate/i.test(el.style)) addHidden(selector, "transform:translate");
    if (/animation\s*:\s*(?!none\b)[^;]+/i.test(el.style)) addAnimated(selector);
    if (/transition\s*:\s*(?!none\b)[^;]+/i.test(el.style)) addAnimated(selector);
    if (el.classes.some((cls) => MOTION_CLASS.test(cls))) addAnimated(selector);
  }
  return { initialHidden: hidden, animatedSelectors: animated, tokens };
};

const selectorTokens = (selector: string): string[] => {
  const out: string[] = [];
  for (const m of selector.matchAll(/[#.]([A-Za-z_][\w-]*)/g)) {
    const token = m[1];
    if (token && !out.includes(token)) out.push(token);
  }
  return out;
};

// analyze_scroll_map often emits structural paths (`main>section:nth-of-type(2)>h2`)
// with no id/class tokens. The outermost section index is real ownership evidence,
// not a guess; out-of-range and nested-only paths stay unattributed.
const STRUCTURAL_SECTION = /(?:^|[>\s])section:nth-of-type\(\s*(\d+)\s*\)/i;

const structuralOwner = (selector: string, sectionCount: number): number => {
  const n = Number(STRUCTURAL_SECTION.exec(selector)?.[1]);
  return Number.isInteger(n) && n >= 1 && n <= sectionCount ? n - 1 : -1;
};

const sectionId = (section: RebuildSection, i: number): string =>
  section.id || section.className || `section-${i + 1}`;

const pushTrigger = (list: MotionTrigger[], trigger: MotionTrigger): void => {
  if (list.length >= MAX_SECTION_TRIGGERS) return;
  const key = `${trigger.selector}|${trigger.start}|${trigger.end}`;
  const found = list.find((t) => `${t.selector}|${t.start}|${t.end}` === key);
  if (!found) {
    list.push(trigger);
    return;
  }
  // Same target/range measured twice (anim + gsap row): fill gaps, never duplicate.
  if (found.scrub !== trigger.scrub || found.pin !== trigger.pin) return;
  found.durationMs ??= trigger.durationMs;
  found.ease ??= trigger.ease;
};

/**
 * Builds the per-section manifest. Census absent → DOM-only hints and
 * `measured:false`; census present → census triggers attributed to the one
 * section whose id/class tokens the selector names.
 */
export function buildMotionManifest(split: Split, census?: NormalizedCensus): MotionManifest {
  const sections = split.sections.sections ?? [];
  const scans = sections.map(scanSectionDom);
  const measured = census !== undefined;
  const result: SectionMotion[] = sections.map((section, i) => ({
    id: sectionId(section, i),
    component: `Section${String(i + 1).padStart(2, "0")}`,
    measured,
    triggers: [],
    initialHidden: scans[i]?.initialHidden ?? [],
    animatedSelectors: census ? [] : scans[i]?.animatedSelectors ?? [],
  }));

  if (!census) return { version: 1, measured: false, sections: result, pageTriggers: [], pageAnimatedSelectors: [] };

  const owner = (selector: string): number => {
    const tokens = selectorTokens(selector);
    if (tokens.length === 0) return structuralOwner(selector, scans.length);
    let best = 0;
    let hit = -1;
    for (let i = 0; i < scans.length; i++) {
      const found = scans[i];
      if (!found) continue;
      const score = tokens.filter((t) => found.tokens.has(t)).length;
      if (score > best) {
        best = score;
        hit = i;
      } else if (score === best && score > 0) {
        hit = -1; // ambiguous: never guess a section
      }
    }
    return hit;
  };

  const pageTriggers: MotionTrigger[] = [];
  const pageAnimatedSelectors: string[] = [];
  const pageAnimatedSeen = new Set<string>();
  const animatedSeen = new Set<string>();
  const addAnimated = (section: SectionMotion, selector: string) => {
    if (section.animatedSelectors.length >= MAX_SELECTORS || animatedSeen.has(`${section.id}::${selector}`)) return;
    animatedSeen.add(`${section.id}::${selector}`);
    section.animatedSelectors.push(selector);
  };
  const add = (index: number, trigger: MotionTrigger) => {
    if (index === -1) {
      pushTrigger(pageTriggers, trigger);
      if (pageAnimatedSelectors.length < MAX_SELECTORS && !pageAnimatedSeen.has(trigger.selector)) {
        pageAnimatedSeen.add(trigger.selector);
        pageAnimatedSelectors.push(trigger.selector);
      }
      return;
    }
    const section = result[index];
    if (!section) return;
    pushTrigger(section.triggers, trigger);
    addAnimated(section, trigger.selector);
  };

  const usedTriggers = new Set<number>();
  const usedCurves = new Set<number>();
  const seenSelectors = new Set<string>();

  for (const anim of census.anims) {
    seenSelectors.add(anim.selector);
    const triggerIndex = census.gsapTriggers.findIndex((t, i) => !usedTriggers.has(i) && t.selector === anim.selector);
    const trigger = triggerIndex === -1 ? null : census.gsapTriggers[triggerIndex];
    if (triggerIndex !== -1) usedTriggers.add(triggerIndex);
    const curveIndex = census.scrubCurves.findIndex((c, i) => !usedCurves.has(i) && c.selector === anim.selector);
    const curve = curveIndex === -1 ? null : census.scrubCurves[curveIndex];
    if (curveIndex !== -1) usedCurves.add(curveIndex);
    add(owner(anim.selector), {
      selector: anim.selector,
      start: trigger?.startPx ?? curve?.startPx ?? null,
      end: trigger?.endPx ?? curve?.endPx ?? null,
      scrub: trigger?.scrub ?? anim.scrub,
      pin: trigger?.pin ?? anim.pin,
      durationMs: anim.durationMs ?? trigger?.durationMs ?? null,
      ease: anim.easing ?? trigger?.easing ?? null,
    });
  }

  census.gsapTriggers.forEach((trigger, i) => {
    if (usedTriggers.has(i)) return;
    seenSelectors.add(trigger.selector);
    const curveIndex = census.scrubCurves.findIndex((c, ci) => !usedCurves.has(ci) && c.selector === trigger.selector);
    const curve = curveIndex === -1 ? null : census.scrubCurves[curveIndex];
    if (curveIndex !== -1) usedCurves.add(curveIndex);
    add(owner(trigger.selector), {
      selector: trigger.selector,
      start: trigger.startPx ?? curve?.startPx ?? null,
      end: trigger.endPx ?? curve?.endPx ?? null,
      scrub: trigger.scrub,
      pin: trigger.pin,
      durationMs: trigger.durationMs,
      ease: trigger.easing,
    });
  });

  census.scrubCurves.forEach((curve, i) => {
    if (usedCurves.has(i) || seenSelectors.has(curve.selector)) return;
    add(owner(curve.selector), {
      selector: curve.selector,
      start: curve.startPx,
      end: curve.endPx,
      scrub: true,
      pin: false,
      durationMs: null,
      ease: null,
    });
  });

  return {
    version: 1,
    measured: true,
    sections: result,
    pageTriggers,
    pageAnimatedSelectors,
  };
}

export const motionManifestJson = (manifest: MotionManifest): string =>
  `${JSON.stringify(manifest, null, 2)}\n`;
