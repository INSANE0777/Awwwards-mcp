/**
 * Static animation anti-pattern scanner — pure, synchronous, deterministic.
 * Maps every animated declaration to a performance tier (S compositor-only,
 * A main-thread JS frames, B measure-before-composite flag, C paint,
 * D layout, F thrashing) and matches the anti-pattern rule table.
 * Zero dependencies; no fs, no network, no console.
 *
 * Ported from aegon-mcp (MIT) — A:\Motion (src/rules.ts + the CSS/JS scanning
 * core of src/audit.ts). Adaptations from the aegon originals:
 * - audit.ts's outer layers are NOT ported: file/directory walking, URL
 *   crawling and per-file-path ranking (its scan.ts), JSONL history,
 *   fix-prompt generation (fixPrompt / buildFixPrompts), text report
 *   rendering (renderReport / bar) and the 0-100 score/rank aggregation
 *   (rankFor / rankAtLeast / TIER_WEIGHTS and the contain:/position:
 *   score modifiers) — verify_build consumes findings only.
 * - `auditAnimation(code: string)` → `scanAntiPatterns({ css?, html?, js? })`:
 *   the optional inputs are each scanned INDEPENDENTLY (aegon scanned one
 *   file's code string at a time), so cross-input signals are not correlated
 *   (a reduced-motion override in js does not veto animations in css —
 *   identical to aegon's per-file scanning) and rule occurrence counts
 *   (will-change…) are per-input. Deterministic order: css, html, js; within
 *   an input: the thrash flag first, then anti-pattern rules in aegon's
 *   table order (one finding per rule, aegon's break-on-first-match), then
 *   animated-property tier findings in declaration order.
 * - Field renames (aegon → here), documented once: AntiPatternRule.id →
 *   finding.ruleId; what → message. The line number moved out of the `what`
 *   text ("… — line N") into a `line` field, and findings gained `source`
 *   ("css" | "html" | "js"). Animated-property findings carry tier + driver
 *   but no severity (aegon's report printed the tier for them);
 *   anti-pattern findings carry severity. The `impact` score text is dropped
 *   with the score layer. thrashFlag gained a rule id ("layout-thrash") and
 *   a derived line (the scroll-listener registration).
 * - Never throws: every rule match and every per-input scan is try/caught —
 *   hostile or empty input yields fewer findings, never an exception.
 * - Everything else is verbatim aegon: tier tables, rule regexes, veto
 *   logic, ids, severities, why/improvement text, and the quirky strictness
 *   that came with them (e.g. the scroll-nonpassive veto accepts any
 *   `passive:` within 300 chars, even `passive: false`; the preferred-driver
 *   order is gsap > waapi > css and ignores rAF).
 */

export type Tier = "S" | "A" | "B" | "C" | "D" | "F";
export type Driver = "css" | "waapi" | "gsap" | "rAF";

export const SEVERITY_WEIGHTS = { HIGH: 12, MEDIUM: 5, INFO: 1 } as const;
export type Severity = keyof typeof SEVERITY_WEIGHTS;

/** Which provided input a finding came from. */
export type AuditSource = "css" | "html" | "js";

export interface AntiPatternFinding {
  /** aegon AntiPatternRule.id; "animated-property" for tier findings, "layout-thrash" for the F flag. */
  ruleId: string;
  /** Severity letter for anti-pattern findings (undefined on tier findings, as in aegon). */
  severity?: Severity;
  /** Tier letter: S/A/B/C/D for animated properties, F for the thrash flag. */
  tier?: Tier;
  /** What drives the animation: css | waapi | gsap | rAF (tier findings only). */
  driver?: Driver;
  /** aegon rule.what, without the "— line N" suffix. */
  message: string;
  why: string;
  improvements: string;
  source: AuditSource;
  /** 1-based line within that input, when derivable. */
  line?: number;
}

/** Compositor-only properties (tier S). GSAP/rAF drivers demote effective tier to A. */
const S: string[] = [
  "transform", "translate", "rotate", "scale",
  "opacity", "filter", "clip-path",
  // GSAP transform aliases (x, y, scaleX…) share the S machinery.
  "x", "y", "scalex", "scaley", "rotation",
];

/** Paint-triggering properties (tier C). */
const C: string[] = [
  "color", "background-color", "border-color", "outline-color", "text-decoration-color",
  "fill", "stroke", "stroke-dashoffset", "stop-color",
  "box-shadow", "text-shadow", "drop-shadow",
  "mask", "mask-image", "backdrop-filter",
  "border-radius", "background-position", "background-size", "background-image",
  "object-position",
];

/** Layout-triggering properties (tier D). */
const D: string[] = [
  "width", "height", "min-width", "max-width", "min-height", "max-height",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "top", "right", "bottom", "left", "inset",
  "font-size", "line-height", "letter-spacing", "word-spacing", "text-indent",
  "border-width", "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
  "gap", "row-gap", "column-gap",
  "flex-basis", "flex-grow", "flex-shrink",
  "grid-template-columns", "grid-template-rows",
  "column-count", "column-width", "columns",
];

const PROPERTY_TIERS: Record<string, Tier> = Object.fromEntries([
  ...S.map((p) => [p, "S" as Tier]),
  ...C.map((p) => [p, "C" as Tier]),
  ...D.map((p) => [p, "D" as Tier]),
]);

const TIER_WHY: Record<Tier, string> = {
  S: "Animates only compositor-friendly properties; the browser can run this on the GPU without the main thread.",
  A: "Runs on the main thread (JS-driven frames); smooth on modern devices but stalls when the main thread is busy.",
  B: "Measure-before-composite patterns (FLIP) cannot be judged without running the page — defer to runtime profiling.",
  C: "Triggers repaint every frame: the browser repaints pixels even when geometry is unchanged.",
  D: "Triggers layout every frame: geometry of the element (and often its subtree) is recomputed before paint.",
  F: "Interleaves reads and writes to layout, forcing the browser to synchronously reflow every frame.",
};

const TIER_IMPROVEMENTS: Record<Tier, string> = {
  S: "No change needed.",
  A: "Prefer a CSS transition/animation or WAAPI over JS frames so eligible properties stay on the compositor.",
  B: "Profile at runtime; static analysis cannot rank these.",
  C: "Repaint costs are hidden by composition — check if the visual change can be a transform/opacity (e.g. use clip-path instead of border-radius reveals).",
  D: "Never animate layout: replace width/height/top/left animations with transform: scale/translate, or use discrete state changes.",
  F: "Batch reads before writes, or move the effect to a compositor-only property / CSS scroll-driven animation.",
};

interface AntiPatternRule {
  id: string;
  severity: Severity;
  pattern: RegExp;
  /** Extra veto: return true to ignore this match (e.g. passive listeners). */
  veto?: (code: string, match: RegExpExecArray) => boolean;
  what: string;
  why: string;
  improvements: string;
}

const ANTI_PATTERNS: AntiPatternRule[] = [
  {
    id: "blur-heavy",
    severity: "HIGH",
    pattern: /filter\s*:\s*blur\(\s*([\d.]+)px/g,
    veto: (code, m) => !(parseFloat(m[1]) >= 10),
    what: "Heavy blur filter (>10px)",
    why: "Large blur radii are the single most expensive GPU filter in audit telemetry (~90% of filter-related issues); every animated frame re-composites the blurred layer.",
    improvements: "Keep blurs under 10px, pre-render the blur into an asset, or animate opacity/transform of an already-blurred layer instead of animating the blur radius.",
  },
  {
    id: "scroll-nonpassive",
    severity: "HIGH",
    pattern: /addEventListener\(\s*(['"])scroll\1\s*,/g,
    veto: (code, m) => /passive\s*:/.test(code.slice(m.index, m.index + 300)),
    what: "Scroll listener without { passive: true }",
    why: "Without passive:true the browser must wait for your handler before it can scroll (found on ~52% of audited sites), adding main-thread latency to every wheel/touch frame.",
    improvements: "Pass { passive: true } unless you call preventDefault(); move work out of the handler; prefer CSS scroll-driven animations.",
  },
  {
    id: "will-change-overuse",
    severity: "MEDIUM",
    pattern: /will-change\s*:/g,
    veto: (code) => (code.match(/will-change\s*:/g) ?? []).length <= 5,
    what: "Excessive will-change promotion",
    why: "Each declaration promotes a compositor layer; over-promoting wastes GPU memory, and stale layers linger (~74% of sites carry at least one stale will-change).",
    improvements: "Set will-change only just before animating and remove it afterwards; never set it as a blanket optimization.",
  },
  {
    id: "infinite-animation",
    severity: "MEDIUM",
    pattern: /animation(?:-iteration-count)?\s*:[^;}]*\binfinite\b/g,
    what: "Infinite animation (possibly off-screen)",
    why: "Infinite animations keep the compositor/CPU busy even when nothing is visible (~60% of sites run at least one); off-screen playback is pure waste.",
    improvements: "Pause with IntersectionObserver, add content-visibility: auto to containers, or drive from a scroll timeline so off-screen = paused.",
  },
  {
    id: "css-var-keyframes",
    severity: "HIGH",
    pattern: /@keyframes[\s\S]{0,600}?--[\w-]+\s*:/g,
    what: "Animating inherited CSS custom properties",
    why: "A custom property that animates and inherits invalidates style for every descendant each frame — an inheritance bomb for large trees.",
    improvements: "Register it: @property --x { syntax: \"<number>\"; inherits: false; initial-value: 0 } so the browser can treat it as a leaf value.",
  },
  {
    id: "transition-all",
    severity: "MEDIUM",
    pattern: /transition\s*:[^;{}]*\ball\b/g,
    what: "transition: all",
    why: '"all" animates every changed property, silently promoting layout-triggering changes (padding, width…) into frame-by-frame reflows.',
    improvements: "List the properties explicitly and keep them compositor-only (transform, opacity).",
  },
  {
    id: "reduced-motion-missing",
    severity: "INFO",
    pattern: /(@keyframes\b|animation\s*:)/g,
    veto: (code) => /prefers-reduced-motion/.test(code),
    what: "No prefers-reduced-motion handling",
    why: "Large ambient animations without a reduced-motion override harm vestibular-sensitive users; the OS preference is free to honor.",
    improvements: "Add @media (prefers-reduced-motion: reduce) { … { animation: none } } or gate JS animation behind matchMedia.",
  },
];

/** Static heuristic for main-thread thrashing (tier F): scroll work that reads then writes layout. */
const THRASH_READ = /getBoundingClientRect|offsetWidth|offsetHeight|offsetLeft|offsetTop|clientWidth|clientHeight|scrollTop|scrollLeft|getComputedStyle/;
const THRASH_WRITE = /style\.(width|height|top|left|right|bottom|margin|padding|marginLeft|marginTop)\b\s*=/;
const SCROLL_LISTENER = /addEventListener\(\s*(['"])scroll\1/;

/** Declarations in CSS and JS object literals (gsap config objects share the `prop: value` shape). */
/** Stops at commas so JS object literals (`x: 100, width: 300`) split per property. */
const DECL_RE = /([a-z-]+|--[\w-]+)\s*:\s*([^;{},]+)/g;

function detectDrivers(code: string): Driver[] {
  const d: Driver[] = [];
  if (/\bgsap\.(to|from|fromTo|set|timeline)\b|\bnew\s+gsap\.timeline/.test(code)) d.push("gsap");
  if (/\.animate\(\s*\{/.test(code)) d.push("waapi");
  if (/\brequestAnimationFrame\b/.test(code)) d.push("rAF");
  if (/\banimation\s*:|@keyframes\b|transition\s*:/.test(code)) d.push("css");
  return d;
}

function effectiveTier(tier: Tier, driver: Driver): Tier {
  // JS main-thread drivers run compositor-property animation on the main thread → A.
  if (tier === "S" && (driver === "gsap" || driver === "rAF")) return "A";
  return tier;
}

function lineAt(code: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < code.length; i++) if (code[i] === "\n") line++;
  return line;
}

interface Decl {
  prop: string;
  tier: Tier;
  driver: Driver;
  line: number;
}

function scanDeclarations(code: string): Decl[] {
  const drivers = detectDrivers(code);
  const prefer: Driver = drivers.includes("gsap") ? "gsap" : drivers.includes("waapi") ? "waapi" : "css";
  const out: Decl[] = [];
  const seen = new Set<string>();
  const push = (prop: string, line: number) => {
    const tier = PROPERTY_TIERS[prop];
    if (!tier) return; // unknown properties are ignored, not guessed
    const key = prop + ":" + prefer;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ prop, tier, driver: prefer, line });
  };
  DECL_RE.lastIndex = 0;
  for (let m = DECL_RE.exec(code); m; m = DECL_RE.exec(code)) {
    const prop = m[1].toLowerCase();
    if (prop === "transition" || prop === "transition-property") {
      // Shorthand values name the animated properties ("transition: transform 300ms").
      for (const token of m[2].toLowerCase().split(/[\s,]+/)) push(token, lineAt(code, m.index));
      continue;
    }
    push(prop, lineAt(code, m.index));
  }
  return out;
}

function propertyFindings(code: string, source: AuditSource): AntiPatternFinding[] {
  return scanDeclarations(code).map(({ prop, tier, driver, line }) => ({
    ruleId: "animated-property",
    tier: effectiveTier(tier, driver),
    driver,
    message: `Animates "${prop}" (${driver})`,
    why: TIER_WHY[tier],
    improvements: TIER_IMPROVEMENTS[tier],
    source,
    line,
  }));
}

function matchAntiPatternRules(code: string, source: AuditSource): AntiPatternFinding[] {
  const found: AntiPatternFinding[] = [];
  for (const rule of ANTI_PATTERNS) {
    try {
      rule.pattern.lastIndex = 0;
      let matched = false;
      for (let m = rule.pattern.exec(code); m && !matched; m = rule.pattern.exec(code)) {
        if (rule.veto && rule.veto(code, m)) continue;
        matched = true;
        found.push({
          ruleId: rule.id,
          severity: rule.severity,
          message: rule.what,
          why: rule.why,
          improvements: rule.improvements,
          source,
          line: lineAt(code, m.index),
        });
      }
    } catch {
      /* one broken rule must not kill the scan for this input */
    }
  }
  return found;
}

function thrashFinding(code: string, source: AuditSource): AntiPatternFinding | null {
  try {
    const listener = SCROLL_LISTENER.exec(code);
    if (listener && THRASH_READ.test(code) && THRASH_WRITE.test(code)) {
      return {
        ruleId: "layout-thrash",
        severity: "HIGH",
        tier: "F",
        message: "Layout thrashing risk (scroll handler reads and writes layout)",
        why: "Interleaving layout reads (offsetWidth, getBoundingClientRect…) with style writes inside a scroll handler forces a synchronous reflow every frame — the most expensive single pattern in the methodology.",
        improvements: "Batch reads before writes, cache measurements, or move the effect to transform/opacity or a CSS scroll-driven animation.",
        source,
        line: lineAt(code, listener.index),
      };
    }
  } catch {
    /* hostile code, no flag */
  }
  return null;
}

const SOURCES: AuditSource[] = ["css", "html", "js"];

/**
 * Static scan of the provided inputs. Pure, sync, deterministic; every
 * per-input scan is try/caught so hostile input degrades to fewer findings.
 */
export function scanAntiPatterns(
  inputs: { css?: string; html?: string; js?: string } = {},
): AntiPatternFinding[] {
  const out: AntiPatternFinding[] = [];
  for (const source of SOURCES) {
    const code = inputs[source];
    if (typeof code !== "string" || code.length === 0) continue;
    try {
      const thrash = thrashFinding(code, source);
      if (thrash) out.push(thrash);
      out.push(...matchAntiPatternRules(code, source));
    } catch {
      /* rule layer failed for this input — keep going */
    }
    try {
      out.push(...propertyFindings(code, source));
    } catch {
      /* tier layer failed for this input — keep going */
    }
  }
  return out;
}
