import { CAPTURE_INSTALL_HINT } from "./capture.js";
import { SCROLL_CENSUS_SNIPPET, reduceScrollCensus, type ScrollScan } from "./census.js";
import { normalizeEasing, quartiles } from "./easings.js";
import { installSnippetShims, preScroll, type WaitStrategy } from "./structure.js";
import { resolveViewport, type ViewportName } from "./viewport.js";
import type { MotionDna } from "./types.js";

export type { MotionDna };

/** captureMotionDnaUnified's return: MotionDna + additive scroll-census summary. */
export interface UnifiedMotionDna extends MotionDna {
  censusSummary?: {
    /** Census counts object verbatim (reduceScrollCensus's per-source tallies).
     *  Runtime scrub/pin truth lives in dna.scroll; censusSummary.counts is census-time. */
    counts: Record<string, number>;
    /** Census-time GSAP registry row count (ScrollCensus.gsapRegistryCount). */
    gsapRegistryCount: number;
  };
}

/** What page.evaluate(MOTION_SNIPPET) serializes back from the page. */
export interface MotionScan {
  libs: string[]; // gsap, scrolltrigger, lenis, locomotive, framer, lottie, matter, barba, swiper, aos
  render: string[]; // "webgl", "three", "pixi", "babylon", "rive"
  scrollTrigger: {
    count: number;
    scrubCount: number;
    pinCount: number;
    sample: {
      start: string | null;
      end: string | null;
      scrub: boolean;
      pin: boolean;
      duration: number | null; // seconds (gsap convention)
      ease: string | null;
    }[];
  };
  tweens: { durations: number[]; easeTokens: string[] }; // durations in seconds
  cssBeziers: string[]; // cubic-bezier easing strings seen in getAnimations()
  lenisConfigured: boolean;
}

// Runs IN THE PAGE via page.evaluate. Detects animation libraries, render
// engines, ScrollTrigger stats, tween durations/eases and CSS transition
// curves. Must be a plain `function` expression (no arrow — page.evaluate
// re-serializes the source) with zero outer references: everything goes
// through globalThis because the Node tsconfig has no DOM lib, and every
// probe is try/caught so a site whose JS explodes still yields a partial
// scan. Mirrors SCAN_SNIPPET (structure.ts).
export const MOTION_SNIPPET = function (): MotionScan {
  const g = globalThis as any;
  const libs: string[] = [];
  function add(s: string): void {
    if (!libs.includes(s)) libs.push(s);
  }

  // ScrollTrigger registry, however the site exposed it. Same preference as
  // SCROLL_CENSUS_SNIPPET: the window global wins when present at all, the
  // gsap plugin registry is only a fallback — so a stray window.ScrollTrigger
  // cannot make DNA and census read different registries.
  let st: any = null;
  try {
    st = g.ScrollTrigger || g.gsap?.plugins?.ScrollTrigger || null;
  } catch {}

  try {
    if (g.gsap || g.TweenMax || g.TweenLite) add("gsap");
    if (st?.getAll) add("scrolltrigger");
    if (g.lenis || g.document?.documentElement?.classList?.contains("lenis")) add("lenis");
    if (g.LocomotiveScroll || g.document?.querySelector?.("[data-scroll-container]")) add("locomotive");
    if (g.document?.querySelector?.("[data-aos]")) add("aos");
    if (g.Swiper || g.document?.querySelector?.(".swiper")) add("swiper");
    if (g.document?.querySelector?.("[data-framer-appear], [data-projection-id]")) add("framer");
    if (g.Lottie || g.lottie || g.document?.querySelector?.("lottie-player, dotlottie-wc")) add("lottie");
    if (g.Matter || g.document?.querySelector?.("canvas[data-engine*='matter']")) add("matter");
    if (g.Barba) add("barba");
  } catch {}

  const render: string[] = [];
  try {
    const canvases = g.document ? [...g.document.querySelectorAll("canvas")] : [];
    for (const c of canvases) {
      const engine = (c.getAttribute?.("data-engine") || "").toLowerCase();
      if (engine.includes("three") && !render.includes("three")) render.push("three");
      if (engine.includes("babylon") && !render.includes("babylon")) render.push("babylon");
      if (engine.includes("pixi") && !render.includes("pixi")) render.push("pixi");
    }
    if (g.THREE && !render.includes("three")) render.push("three");
    if (g.PIXI && !render.includes("pixi")) render.push("pixi");
    if (g.BABYLON && !render.includes("babylon")) render.push("babylon");
    if (g.document?.querySelector?.("[class*='rive']") && !render.includes("rive")) render.push("rive");
    if ((render.length > 0 || canvases.length > 0) && !render.includes("webgl")) render.push("webgl");
  } catch {}

  const scrollTrigger = {
    count: 0,
    scrubCount: 0,
    pinCount: 0,
    sample: [] as MotionScan["scrollTrigger"]["sample"],
  };
  const tweenDurations: number[] = [];
  const easeTokens: string[] = [];
  try {
    if (st?.getAll) {
      const sts = st.getAll();
      scrollTrigger.count = sts.length;
      for (const st of sts) {
        const anim = st.animation;
        const dur = anim ? (typeof anim.duration === "function" ? anim.duration() : (anim.vars?.duration ?? null)) : null;
        const ease = anim?.vars?.ease != null ? String(anim.vars.ease) : null;
        const scrub = Boolean(st.vars?.scrub);
        const pin = Boolean(st.vars?.pin);
        if (scrub) scrollTrigger.scrubCount++;
        if (pin) scrollTrigger.pinCount++;
        if (scrollTrigger.sample.length < 20) {
          scrollTrigger.sample.push({
            start: st.vars?.start != null ? String(st.vars.start) : null,
            end: st.vars?.end != null ? String(st.vars.end) : null,
            scrub,
            pin,
            duration: typeof dur === "number" ? dur : null,
            ease,
          });
        }
        if (typeof dur === "number") tweenDurations.push(dur);
        if (ease) easeTokens.push(ease);
      }
    }
    // Non-scroll tweens: walk the gsap global timeline (timeline-lens pattern)
    // when the site exposes gsap at window level.
    const kids = g.gsap?.globalTimeline?.getChildren?.(true, true, true) ?? [];
    for (const k of kids.slice(0, 100)) {
      try {
        const d = typeof k.duration === "function" ? k.duration() : k.vars?.duration;
        if (typeof d === "number") tweenDurations.push(d);
        if (k.vars?.ease) easeTokens.push(String(k.vars.ease));
      } catch {}
    }
  } catch {}

  const cssBeziers: string[] = [];
  try {
    const anims = g.document?.getAnimations?.() ?? [];
    for (const a of anims.slice(0, 200)) {
      const f = a?.effect;
      const timing = f?.getComputedTiming?.();
      const ease = timing?.easing ? String(timing.easing) : null;
      if (ease && ease.includes("bezier")) cssBeziers.push(ease);
      if (typeof timing?.duration === "number") tweenDurations.push(timing.duration / 1000);
    }
  } catch {}

  return {
    libs,
    render,
    scrollTrigger,
    tweens: { durations: tweenDurations, easeTokens },
    cssBeziers,
    lenisConfigured: libs.includes("lenis"),
  };
};

export function reduceScan(url: string, scan: MotionScan, now: number): MotionDna {
  const scrollModel: MotionDna["stack"]["scrollModel"] =
    scan.libs.includes("lenis") ? "lenis"
    : scan.libs.includes("locomotive") ? "locomotive"
    : scan.libs.length > 0 ? "native"
    : "unknown";

  // Mixing vocabulary over tween ease tokens and CSS beziers. Sample eases are
  // deliberately excluded: scrub-trigger eases are usually gsap defaults
  // ("none"), so the tween/transition sources carry the style signal. Tokens
  // key on their raw string so unknown spellings still count; bezier values
  // are resolved through the Task 6 table (normalizeEasing).
  const agg = new Map<string, { token: string; bezier: number[] | null; uses: number }>();
  for (const raw of scan.tweens.easeTokens) {
    if (raw === "none" || raw === "linear") continue; // scrub defaults carry no style signal
    const n = normalizeEasing(raw);
    const entry = agg.get(raw) ?? { token: raw, bezier: n.kind === "bezier" ? n.value : null, uses: 0 };
    entry.uses++;
    agg.set(raw, entry);
  }
  for (const b of scan.cssBeziers) {
    const n = normalizeEasing(b);
    const entry = agg.get(b) ?? { token: b, bezier: n.kind === "bezier" ? n.value : null, uses: 0 };
    entry.uses++;
    agg.set(b, entry);
  }

  return {
    url,
    stack: { libs: scan.libs, render: scan.render, scrollModel },
    scroll: {
      triggerCount: scan.scrollTrigger.count,
      scrubCount: scan.scrollTrigger.scrubCount,
      pinCount: scan.scrollTrigger.pinCount,
      scrubRatio: scan.scrollTrigger.count > 0 ? scan.scrollTrigger.scrubCount / scan.scrollTrigger.count : 0,
      sample: scan.scrollTrigger.sample,
    },
    easingVocab: [...agg.values()]
      .sort((a, b) => b.uses - a.uses)
      .slice(0, 15),
    // Durations arrive in seconds (gsap/getAnimations); the vocab reports
    // milliseconds: [0.4, 0.7, 1.2]s -> { p25: 550, median: 700, p75: 950 }ms.
    durationVocab: quartiles(scan.tweens.durations.map((d) => d * 1000)),
    capturedAt: now,
  };
}

export async function captureMotionDna(
  url: string,
  opts: {
    timeoutMs?: number;
    viewport?: ViewportName;
    // "as string" keeps Playwright an unresolved optional dependency at compile
    // time; Node resolves it (and may throw) at runtime — same trick capture.ts/
    // structure.ts use.
    loader?: () => Promise<any>;
  } = {},
): Promise<MotionDna> {
  let chromium: any;
  try {
    ({ chromium } = await (opts.loader ?? (() => import("playwright" as string)))());
  } catch {
    throw new Error(CAPTURE_INSTALL_HINT);
  }
  let browser: any;
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    throw new Error(CAPTURE_INSTALL_HINT);
  }
  try {
    // Same call sequence as analyzePageStructure/captureLiveSite: profile
    // viewport split, "load" + fixed settle (45s timeout, no retry), then the
    // scroll-through so lazy sections and ScrollTrigger registrations exist.
    const { width, height, ...contextOpts } = resolveViewport(opts.viewport);
    const page = await browser.newPage({ viewport: { width, height }, ...contextOpts });
    await installSnippetShims(page);
    await page.goto(url, { waitUntil: "load", timeout: opts.timeoutMs ?? 45_000 });
    // "load" can fire before late XHRs settle (see structure.ts).
    await page.waitForTimeout(3000);
    await preScroll(page);
    // Extra settle so scrub/pin ScrollTriggers settle back at scrollTop 0
    // before getAnimations samples real states.
    await page.waitForTimeout(500);
    const scan = (await page.evaluate(MOTION_SNIPPET)) as MotionScan;
    return reduceScan(url, scan, Date.now());
  } finally {
    try {
      await browser.close();
    } catch {
      /* keep the primary error */
    }
  }
}

/**
 * Single-launch motion capture (plan Task C2): ONE browser launch/page runs
 * MOTION_SNIPPET then SCROLL_CENSUS_SNIPPET (imported from census.js — both
 * snippets already satisfy the plain-function/no-arrow rule) and reduces
 * both. Trade-off vs the old double-launch pattern (captureMotionDna +
 * captureScrollCensus separately): two evaluates in one launch halve the
 * cold-start cost and pin both scans to the same page state; the price is a
 * longer-lived page. Throws exactly like captureMotionDna (the handler's
 * catch turns it into the unchanged {error} response); the old fn stays
 * exported for compat.
 */
export async function captureMotionDnaUnified(
  url: string,
  opts: {
    timeoutMs?: number;
    waitStrategy?: WaitStrategy;
    viewport?: ViewportName;
    reducedMotion?: boolean;
    loader?: () => Promise<any>;
  } = {},
): Promise<UnifiedMotionDna> {
  let chromium: any;
  try {
    ({ chromium } = await (opts.loader ?? (() => import("playwright" as string)))());
  } catch {
    throw new Error(CAPTURE_INSTALL_HINT);
  }
  let browser: any;
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    throw new Error(CAPTURE_INSTALL_HINT);
  }
  try {
    // Same call sequence as captureMotionDna (load + fixed settle + scroll
    // through + settle) with the census capture's waitStrategy/reducedMotion
    // opts (see captureScrollCensus).
    const { width, height, ...contextOpts } = resolveViewport(opts.viewport ?? "desktop");
    const page = await browser.newPage({
      viewport: { width, height },
      ...contextOpts,
      ...(opts.reducedMotion ? { reducedMotion: "reduce" as const } : {}),
    });
    await installSnippetShims(page);
    await page.goto(url, {
      waitUntil: opts.waitStrategy ?? "load",
      timeout: opts.timeoutMs ?? 45_000,
    });
    await page.waitForTimeout(3000);
    await preScroll(page);
    // "load" can fire before late XHRs settle (see structure.ts).
    await page.waitForTimeout(500);
    // Motion scan first, while the settled page still sits at scrollTop 0
    // (ScrollTriggers sample their rest state); the census reads the same
    // DOM right after.
    const scan = (await page.evaluate(MOTION_SNIPPET)) as MotionScan;
    const censusScan = (await page.evaluate(SCROLL_CENSUS_SNIPPET)) as ScrollScan;
    const dna = reduceScan(url, scan, Date.now());
    const census = reduceScrollCensus(url, censusScan, Date.now(), !!opts.reducedMotion);
    // Runtime scrub/pin truth lives in dna.scroll; censusSummary is census-time.
    return {
      ...dna,
      censusSummary: { counts: census.counts, gsapRegistryCount: census.gsapRegistryCount },
    };
  } finally {
    try {
      await browser.close();
    } catch {
      /* keep the primary error */
    }
  }
}
