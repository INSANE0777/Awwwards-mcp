import { installSnippetShims, preScroll, type WaitStrategy } from "./structure.js";
import { resolveViewport, type ViewportName } from "./viewport.js";

/** Where an animation's scroll linkage was detected. */
export type ScrollTriggerSource =
  | "gsap-scrolltrigger"
  | "css-scroll-timeline"
  | "css-view-timeline"
  | "data-attr"
  | "css-keyframe"
  | "smil"
  | "unknown";

/** One sampled keyframe: numeric-ish offset plus a few clamped props. */
export interface KeyframeSample {
  offset: number | null;
  props: Record<string, string>;
}

/** One GSAP ScrollTrigger row: compiled numerics + bounded tween vars. */
export interface GsapTriggerRow {
  selector: string;
  scrub: boolean;
  pin: boolean;
  startPx: number | null;
  endPx: number | null;
  progress: number | null;
  vars: Record<string, string>;
}

/** One per-element animation row, as serialized from the page. */
export interface RawAnim {
  selector: string;
  tag: string;
  props: string[];
  durationMs: number | null;
  delayMs: number | null;
  easing: string | null;
  trigger: ScrollTriggerSource;
  scrub: boolean;
  pin: boolean;
  svgStroke: boolean;
  /** Bounded keyframe matrix — populated for the first ≤60 anim rows only. */
  keyframes?: KeyframeSample[];
}

/** What page.evaluate(SCROLL_CENSUS_SNIPPET) serializes back from the page. */
export interface ScrollScan {
  anims: RawAnim[];
  smilSelectors: string[];
  nativeTimelines: { selector: string; kind: "scroll" | "view" }[];
  /** GSAP ScrollTrigger registry rows — always emitted by the snippet ([] when no GSAP); required so the serialized JSON always carries the key (kit readers see [], never undefined). */
  gsapTriggers: GsapTriggerRow[];
}

export interface ScrollCensus {
  url: string;
  capturedAt: number;
  counts: Record<ScrollTriggerSource, number>;
  anims: RawAnim[];
  svgStrokes: string[];
  nativeScrollTimelines: number;
  /** GSAP deep capture rows — always present ([] when empty; required so the serialized JSON always carries the key); passthrough from the scan, order preserved. */
  gsapTriggers: GsapTriggerRow[];
  reducedMotion: boolean;
}

const TRIGGER_SOURCES: ScrollTriggerSource[] = [
  "gsap-scrolltrigger",
  "css-scroll-timeline",
  "css-view-timeline",
  "data-attr",
  "css-keyframe",
  "smil",
  "unknown",
];

// PURE mirror of the sampleKeyframes helper inside SCROLL_CENSUS_SNIPPET (the
// snippet must stay self-contained for page.evaluate serialization, so it
// keeps an inline copy — keep the two in sync). Exported for unit tests.
export function sampleKeyframes(kfs: any[]): KeyframeSample[] {
  const KP = ["transform", "opacity", "filter", "clip-path", "color", "background-color", "width", "height"];
  const picks = kfs.length <= 4 ? kfs : [kfs[0], kfs[Math.floor(kfs.length / 2)], kfs[kfs.length - 1]];
  const out: KeyframeSample[] = [];
  for (const kf of picks.slice(0, 4)) {
    const props: Record<string, string> = {};
    let n = 0;
    for (const k of KP) {
      if (n >= 4) break;
      try {
        if (kf[k] != null) {
          props[k] = String(kf[k]).slice(0, 40);
          n++;
        }
      } catch {}
    }
    out.push({ offset: typeof kf.offset === "number" ? kf.offset : null, props });
  }
  return out;
}

// Runs IN THE PAGE via page.evaluate. One row per element animation in
// doc.getAnimations(), plus native CSS scroll/view timelines and SMIL
// animations. Must be a plain `function` expression (no arrow — page.evaluate
// re-serializes the source) with zero outer references: helpers live inside
// the body, browser globals go through globalThis (Node tsconfig has no DOM
// lib), and every probe is try/caught so a site whose JS explodes still
// yields a partial census. Mirrors SCAN_SNIPPET (structure.ts) and
// MOTION_SNIPPET (motion-dna.ts).
export const SCROLL_CENSUS_SNIPPET = function (): ScrollScan {
  const g = globalThis as any;
  const doc = g.document;
  const win = g;
  const anims: ScrollScan["anims"] = [];
  const smilSelectors: string[] = [];
  const nativeTimelines: ScrollScan["nativeTimelines"] = [];

  // CSS selector path up to depth 6: tagName lowercase, nth-of-type
  // disambiguation only when same-tag siblings exceed 1.
  function selPath(el: any): string {
    const parts: string[] = [];
    let node = el;
    for (let depth = 0; node && depth < 6; depth++) {
      let part = String(node.tagName || "*").toLowerCase();
      try {
        const parent = node.parentElement;
        if (parent) {
          const same = Array.from(parent.children).filter(function (c: any) {
            return String(c.tagName) === String(node.tagName);
          });
          if (same.length > 1) part += ":nth-of-type(" + (same.indexOf(node) + 1) + ")";
        }
      } catch {}
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(">");
  }

  // Native CSS scroll-driven animation: ScrollTimeline subclass ⇒ "scroll",
  // ViewTimeline ⇒ "view".
  function classifyTimeline(anim: any): "css-scroll-timeline" | "css-view-timeline" | null {
    try {
      const timeline = anim?.timeline;
      if (!timeline || typeof win.ScrollTimeline !== "function") return null;
      if (!(timeline instanceof win.ScrollTimeline)) return null;
      if (typeof win.ViewTimeline === "function" && timeline instanceof win.ViewTimeline) {
        return "css-view-timeline";
      }
      return "css-scroll-timeline";
    } catch {
      return null;
    }
  }

  // GSAP ScrollTrigger atlas, however the site exposed it.
  let stGlobal: any = null;
  try {
    stGlobal = win.ScrollTrigger || win.gsap?.plugins?.ScrollTrigger || null;
  } catch {}

  // Exact/contained registry match for an element.
  function stOf(el: any): any {
    try {
      if (!stGlobal?.getAll) return null;
      const list = stGlobal.getAll().slice(0, 120);
      for (const st of list) {
        const t = st.trigger ?? st.getTrigger?.() ?? null;
        if (t && t.nodeType === 1 && t === el) return st;
      }
      for (const st of list) {
        const t = st.trigger ?? st.getTrigger?.() ?? null;
        if (t && t.nodeType === 1 && el && (t.contains?.(el) || el.contains?.(t))) return st;
      }
    } catch {}
    return null;
  }

  // Classification precedence: native timeline → ScrollTrigger → scroll-cue
  // data attributes → plain css-keyframe.
  function classify(anim: any, target: any): { trigger: ScrollTriggerSource; scrub: boolean; pin: boolean } {
    const tl = classifyTimeline(anim);
    if (tl) return { trigger: tl, scrub: false, pin: false };
    const st = stOf(target);
    if (st) {
      return {
        trigger: "gsap-scrolltrigger",
        scrub: Boolean(st.vars?.scrub),
        pin: Boolean(st.vars?.pin || st.pin),
      };
    }
    try {
      if (target?.closest?.("[data-aos],[data-scroll],[data-animate],[data-sal],[data-reveal]")) {
        return { trigger: "data-attr", scrub: false, pin: false };
      }
    } catch {}
    return { trigger: "css-keyframe", scrub: false, pin: false };
  }

  // Keyframe matrix sampling: first/mid/last ≤4 frames, ≤4 priority props
  // each, values clamped to 40 chars — keeps the serialized scan bounded.
  function sampleKeyframes(kfs: any[]): KeyframeSample[] {
    const KP = ["transform", "opacity", "filter", "clip-path", "color", "background-color", "width", "height"];
    const picks = kfs.length <= 4 ? kfs : [kfs[0], kfs[Math.floor(kfs.length / 2)], kfs[kfs.length - 1]];
    const out: KeyframeSample[] = [];
    for (const kf of picks.slice(0, 4)) {
      const props: Record<string, string> = {};
      let n = 0;
      for (const k of KP) {
        if (n >= 4) break;
        try {
          if (kf[k] != null) {
            props[k] = String(kf[k]).slice(0, 40);
            n++;
          }
        } catch {}
      }
      out.push({ offset: typeof kf.offset === "number" ? kf.offset : null, props });
    }
    return out;
  }

  // Pass 1: element animations from doc.getAnimations().
  try {
    const list = doc.getAnimations ? doc.getAnimations() : [];
    const seen = new Set<unknown>();
    let kfCount = 0; // rows that got a matrix — harvest cap: 60
    for (const a of list.slice(0, 200)) {
      try {
        const effect = a?.effect;
        const target = effect?.target;
        // One row per element: repeated Animation objects (transform + opacity
        // as separate animations on the same node) merge into the first row.
        if (!target || target.nodeType !== 1 || seen.has(target)) continue;
        seen.add(target);
        const keyframes = effect.getKeyframes ? effect.getKeyframes() : [];
        const props: string[] = [];
        for (const kf of keyframes) {
          for (const key of Object.keys(kf)) {
            if (key === "offset" || key === "easing" || key === "composite") continue;
            if (!props.includes(key)) props.push(key);
          }
        }
        if (props.length === 0) continue;
        const timing = effect.getComputedTiming ? effect.getComputedTiming() : null;
        const durationMs = typeof timing?.duration === "number" ? timing.duration : null;
        const delayMs = typeof timing?.delay === "number" ? timing.delay : null;
        const easing = timing?.easing && timing.easing !== "ease" ? String(timing.easing) : null;
        const cls = classify(a, target);
        // Keyframe matrix on the first 60 rows only — reuses the already
        // fetched `keyframes` from the props pass (no second getKeyframes).
        let matrix: KeyframeSample[] | undefined;
        if (kfCount < 60 && keyframes.length > 0) {
          try {
            matrix = sampleKeyframes(keyframes);
            kfCount++;
          } catch {}
        }
        anims.push({
          selector: selPath(target),
          tag: String(target.tagName || "*").toLowerCase(),
          props,
          durationMs,
          delayMs,
          easing,
          trigger: cls.trigger,
          scrub: cls.scrub,
          pin: cls.pin,
          svgStroke: props.some(function (p: string) {
            return p.startsWith("stroke-dash");
          }),
          ...(matrix ? { keyframes: matrix } : {}),
        });
      } catch {}
    }
  } catch {}

  // Pass 2: native scroll/view timelines for the anims classified above.
  try {
    const list = doc.getAnimations ? doc.getAnimations() : [];
    for (const a of list.slice(0, 200)) {
      const kind = classifyTimeline(a);
      if (!kind) continue;
      const target = a?.effect?.target;
      if (!target || target.nodeType !== 1) continue;
      nativeTimelines.push({
        selector: selPath(target),
        kind: kind === "css-view-timeline" ? "view" : "scroll",
      });
    }
  } catch {}

  // Pass 3: SMIL animations — selector of the owning SVG element.
  try {
    const smil = doc.querySelectorAll("animate, animateTransform, animateMotion");
    const smilArr: any[] = Array.from(smil ?? []);
    for (const s of smilArr.slice(0, 80)) {
      const owner = s.ownerSVGElement || s.parentElement;
      if (owner) smilSelectors.push(selPath(owner));
    }
  } catch {}

  // Pass 4: GSAP ScrollTrigger registry — compiled start/end px, live
  // progress, and bounded tween vars (≤20 rows, ≤24 chars per var value,
  // priority keys only; functions/objects skipped). Independent of
  // getAnimations, so it works even when animations are hidden from the Web
  // Animations API.
  const STVARS_KEYS = ["x", "y", "rotate", "scale", "scaleX", "scaleY", "opacity", "autoAlpha", "stagger", "width", "height"];
  const gsapTriggers: GsapTriggerRow[] = [];
  try {
    const stList = stGlobal && stGlobal.getAll ? stGlobal.getAll().slice(0, 120) : [];
    for (const st of stList) {
      if (gsapTriggers.length >= 20) break;
      try {
        const trig = st.trigger ?? st.getTrigger?.() ?? null;
        const vars: Record<string, string> = {};
        const tv = st.animation && st.animation.vars ? st.animation.vars : null;
        if (tv) {
          for (const vk of STVARS_KEYS) {
            try {
              const vv = tv[vk];
              if (vv !== undefined && typeof vv !== "object" && typeof vv !== "function") {
                vars[vk] = String(vv).slice(0, 24);
              }
            } catch {}
          }
        }
        gsapTriggers.push({
          selector: trig && trig.nodeType === 1 ? selPath(trig) : "",
          scrub: Boolean(st.vars?.scrub),
          pin: Boolean(st.vars?.pin || st.pin),
          startPx: typeof st.start === "number" ? st.start : null,
          endPx: typeof st.end === "number" ? st.end : null,
          progress: typeof st.progress === "number" ? st.progress : null,
          vars,
        });
      } catch {}
    }
  } catch {}

  return { anims, smilSelectors, nativeTimelines, gsapTriggers };
};

// PURE: aggregates a raw scan into the census. Counts per trigger source,
// propagates stroke flags (SMIL owners count as strokes), sorts the preview
// list scrub-first then pin-first.
export function reduceScrollCensus(
  url: string,
  scan: ScrollScan,
  now: number,
  reducedMotion = false,
): ScrollCensus {
  const counts = Object.fromEntries(TRIGGER_SOURCES.map(function (k) {
    return [k, 0];
  })) as Record<ScrollTriggerSource, number>;

  const strokes = new Set(scan.smilSelectors);
  for (const a of scan.anims) {
    counts[a.trigger] = (counts[a.trigger] ?? 0) + 1;
    // Trust-borderline scans may carry the prop without the flag set; derive
    // from stroke-dash* props so svgStrokes stays complete.
    a.svgStroke = Boolean(a.svgStroke) || (a.props ?? []).some(function (p) {
      return typeof p === "string" && p.startsWith("stroke-dash");
    });
    if (a.svgStroke) strokes.add(a.selector);
  }
  if (scan.smilSelectors.length > 0) counts.smil = scan.smilSelectors.length;

  const anims = [...scan.anims].sort(function (a, b) {
    if (a.scrub !== b.scrub) return a.scrub ? -1 : 1;
    if (a.pin !== b.pin) return a.pin ? -1 : 1;
    return 0;
  });

  return {
    url,
    capturedAt: now,
    counts,
    anims,
    svgStrokes: [...strokes],
    nativeScrollTimelines: scan.nativeTimelines.length,
    gsapTriggers: scan.gsapTriggers,
    reducedMotion,
  };
}

export async function captureScrollCensus(
  url: string,
  opts?: {
    timeoutMs?: number;
    waitStrategy?: WaitStrategy;
    viewport?: ViewportName;
    reducedMotion?: boolean;
    loader?: () => Promise<any>;
  },
): Promise<ScrollCensus | { error: string }> {
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
      const page = await browser.newPage({
        viewport: { width, height },
        ...contextOpts,
        ...(opts?.reducedMotion ? { reducedMotion: "reduce" as const } : {}),
      });
      await installSnippetShims(page);
      await page.goto(url, {
        waitUntil: opts?.waitStrategy ?? "networkidle",
        timeout: opts?.timeoutMs ?? 45_000,
      });
      await page.waitForTimeout(3000);
      await preScroll(page);
      await page.waitForTimeout(500);
      const scan = (await page.evaluate(SCROLL_CENSUS_SNIPPET)) as ScrollScan;
      return reduceScrollCensus(url, scan, Date.now(), !!opts?.reducedMotion);
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

