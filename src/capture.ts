import { createHash } from "node:crypto";
import { join } from "node:path";
// preScroll lives in structure.ts so there is ONE scroll-through loop for
// both tools; this is an intentional circular import (structure.ts imports
// CAPTURE_INSTALL_HINT from here) — both sides only use the other's bindings
// at call time, which ESM resolves fine.
import { preScroll, type WaitOpts, type WaitStrategy } from "./structure.js";
import { resolveViewport } from "./viewport.js";

export const CAPTURE_INSTALL_HINT =
  "Full-page capture needs Playwright, which is an optional dependency.\n" +
  "Install it where this server runs (globally works for a global install):  npm install -g playwright && npx playwright install chromium\n" +
  "Then retry the capture or structure tool (or restart your agent afterward).";

// Inline previews are base64, ~33% larger than the PNG. Past this budget the
// file is still saved but the preview is omitted so a 30MB retina capture
// cannot blow up the agent's context window.
export const DEFAULT_MAX_INLINE_BYTES = 2_500_000;

export interface CaptureOpts extends WaitOpts {
  /** false omits the base64 preview and keeps only the saved file (default true). */
  inline?: boolean;
  /** Base64 length above which the preview is omitted (default 2_500_000). */
  maxInlineBytes?: number;
  /** false skips waiting for a full-screen preloader overlay to clear (default true). */
  waitForOverlay?: boolean;
}

// Polls until no visible fixed-position element covers ≥90% of the viewport in
// both axes with z-index ≥ 100 — a preloader that would otherwise be the whole
// screenshot. Pages that keep one mounted forever hit the timeout, which is
// swallowed: a late overlay is better than a failed capture. Fake/older pages
// without waitForFunction are treated as overlay-free.
//
// The predicate is helper-free on purpose: tsx's keepNames injects __name()
// around nested named functions, and capture does not install the page shim.
export async function waitForOverlays(page: any, timeoutMs = 10_000): Promise<void> {
  if (typeof page?.waitForFunction !== "function") return;
  try {
    await page.waitForFunction(
      function () {
        const g = globalThis as any;
        const doc = g.document;
        const vw = doc.documentElement.clientWidth || g.innerWidth || 1;
        const vh = doc.documentElement.clientHeight || g.innerHeight || 1;
        const els = doc.querySelectorAll("*");
        for (let i = 0; i < els.length; i++) {
          const s = g.getComputedStyle(els[i]);
          if (String(s.position) !== "fixed") continue;
          const r = els[i].getBoundingClientRect();
          if (r.width < 0.9 * vw || r.height < 0.9 * vh) continue;
          const z = parseInt(String(s.zIndex), 10);
          if (!(z >= 100)) continue;
          const opacity = parseFloat(String(s.opacity ?? "1"));
          if (!(opacity > 0.05)) continue;
          if (String(s.visibility) === "hidden" || String(s.display) === "none") continue;
          return false;
        }
        return true;
      },
      undefined,
      { timeout: timeoutMs, polling: 250 },
    );
  } catch {
    /* overlay never cleared (or page closed): capture what is there */
  }
}

export type CaptureResult = { file: string; base64?: string; inlineOmitted?: boolean } | { error: string };

export async function captureLiveSite(
  url: string,
  imagesDir: string,
  // "as string" keeps Playwright an unresolved optional dependency at compile time;
  // Node resolves it (and may throw) at runtime, which the try/catch below handles.
  loader: () => Promise<any> = () => import("playwright" as string),
  opts?: CaptureOpts,
): Promise<CaptureResult> {
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
    // Same viewport-profile split as analyzePageStructure (structure.ts):
    // width/height fill the `viewport` key, mobile-profile flags spread in as
    // sibling context options. Desktop resolves to no extra fields, so the
    // default call shape is unchanged.
    const { width, height, ...contextOpts } = resolveViewport(opts?.viewport);
    const page = await browser.newPage({ viewport: { width, height }, ...contextOpts });
    await page.goto(url, { waitUntil: waitStrategy, timeout: 45_000 });
    // "load" can fire before late XHRs settle, so give the page a fixed
    // settle window; networkidle already means the network went quiet.
    if (waitStrategy === "load") await page.waitForTimeout(3000);
    await preScroll(page);
    if (opts?.waitForOverlay !== false) await waitForOverlays(page);
    // Viewport goes into the name: the same URL captured at desktop and mobile
    // must keep both files (issue #23). Return the buffer playwright already
    // gave us — re-reading the file races a concurrent capture of the same URL.
    const vp = opts?.viewport ?? "desktop";
    const file = join(
      imagesDir,
      "capture-" + createHash("sha1").update(url).digest("hex").slice(0, 12) + "-" + vp + ".png",
    );
    const buf = (await page.screenshot({ path: file, fullPage: true })) as Buffer;
    // Check inline:false and the size budget from the raw PNG first: base64 is
    // exact at 4*ceil(n/3), so a large capture never pays for the conversion.
    if (opts?.inline === false) return { file, inlineOmitted: true };
    const base64Length = Math.ceil(buf.length / 3) * 4;
    if (base64Length > (opts?.maxInlineBytes ?? DEFAULT_MAX_INLINE_BYTES)) {
      return { file, inlineOmitted: true };
    }
    return { file, base64: buf.toString("base64") };
  } finally {
    try {
      await browser.close();
    } catch {
      /* keep the primary error */
    }
  }
}
