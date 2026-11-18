import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import type { Browser, Page } from "playwright";
import {
  analyzePageStructure,
  installAttachedShim,
  preScroll,
  SCAN_SNIPPET,
} from "../src/structure.js";
import type { PreScrollInfo, ScanResult } from "../src/structure.js";

// Real-browser regressions for conservative structure diagnosis: a translated
// wrapper is one viewport tall to the document, clipped/fixed/hidden wrappers
// must not invent a virtual page, fixed chrome must not move into virtual
// content, and invisible canvases are not scenes. Local fixtures only.
//
// Skip cleanly when Chromium is not installed locally; AWWWARDS_CHROMIUM_SMOKE=1
// turns a missing browser into a failure (CI gate). CONTRIBUTING documents the
// AWWARDS_CHROMIUM_SMOKE spelling, so accept both.
const REQUIRED =
  process.env.AWWWARDS_CHROMIUM_SMOKE === "1" || process.env.AWWARDS_CHROMIUM_SMOKE === "1";

let chromium: typeof import("playwright").chromium | null = null;
let browser: Browser | null = null;
let unavailable = "";
try {
  ({ chromium } = await import("playwright"));
  browser = await chromium.launch();
} catch (err) {
  unavailable = err instanceof Error ? err.message : String(err);
}

const dirs: string[] = [];
const openPages: Page[] = [];

afterEach(async () => {
  for (const page of openPages.splice(0)) await page.close().catch(() => undefined);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

afterAll(async () => {
  if (browser) await browser.close();
}, 120_000);

function fixtureUrl(name: string, html: string): string {
  const dir = mkdtempSync(join(tmpdir(), "awwwards-structure-"));
  dirs.push(dir);
  const file = join(dir, `${name}.html`);
  writeFileSync(file, html);
  return pathToFileURL(file).href;
}

async function openPage(html: string): Promise<Page> {
  const page = await browser!.newPage({ viewport: { width: 1440, height: 900 } });
  openPages.push(page);
  // tsx/esbuild keepNames helpers must exist before the serialized snippet ran.
  await installAttachedShim(page);
  await page.setContent(html, { waitUntil: "load" });
  return page;
}

async function scanFixture(html: string): Promise<{ scan: ScanResult; pre: PreScrollInfo }> {
  const page = await openPage(html);
  const pre = await preScroll(page);
  const scan = (await page.evaluate(SCAN_SNIPPET, { responsive: false })) as ScanResult;
  return { scan, pre };
}

const DOCUMENT = `<!doctype html><html><head><style>
html,body{margin:0}
section{display:block;height:2000px}
#a{background:#aa0000}#b{background:#00aa00}#c{background:#0000aa}
</style></head><body>
<section id="a"></section><section id="b"></section><section id="c"></section>
</body></html>`;

const ELEMENT = `<!doctype html><html><head><style>
html,body{margin:0}
body{position:fixed;inset:0;overflow:hidden}
#page{height:100vh;overflow-y:auto}
#page section{display:block;height:2000px}
#a{background:#aa0000}#b{background:#00aa00}
</style></head><body>
<div id="page"><section id="a"></section><section id="b"></section></div>
</body></html>`;

// html pins the viewport and body is the real scroll container: its tall
// sections are in flow, not a transformed virtual wrapper.
const BODY_SCROLLER_2000 = `<!doctype html><html><head><style>
html{height:100%;overflow:hidden}
body{height:100%;margin:0;overflow-y:auto}
section{display:block;height:2000px}
#a{background:#aa0000}#b{background:#00aa00}#c{background:#0000aa}
</style></head><body>
<section id="a"></section><section id="b"></section><section id="c"></section>
</body></html>`;

const BODY_SCROLLER_800 = BODY_SCROLLER_2000.replaceAll("height:2000px", "height:800px");

const bodyScroller = (height: number) => `<!doctype html><html><head><style>
html{height:100%;overflow:hidden}
body{height:100%;margin:0;overflow-y:auto}
section{display:block;height:${height}px;background:#123456}
</style></head><body>
<section id="a"></section>
</body></html>`;

const BODY_SCROLLER_950 = bodyScroller(950);
const BODY_SCROLLER_1000 = bodyScroller(1000);

// Fixed body plus a tall wrapper that paints nothing.
const INVISIBLE_CONTENT = `<!doctype html><html><head><style>
html,body{margin:0;height:100%;overflow:hidden}
#smooth{height:9000px;width:100%;content-visibility:hidden;background:#123456}
</style></head><body>
<div id="smooth"></div>
</body></html>`;

const INVISIBLE_FILTER = INVISIBLE_CONTENT.replace(
  "content-visibility:hidden",
  "filter:opacity(0)",
);

// Lazy layouts grow while preScroll walks; metrics must describe the final
// layout, not the pre-walk snapshot.
const LAZY_APPEND = `<!doctype html><html><head><style>
html,body{margin:0}
section{display:block;height:1000px;background:#123456}
</style></head><body>
<div id="list"><section></section><section></section></div>
<script>
let grown = false;
addEventListener("scroll", () => {
  if (grown) return;
  grown = true;
  const list = document.getElementById("list");
  for (let i = 0; i < 7; i++) {
    const s = document.createElement("section");
    s.style.background = i % 2 ? "#345678" : "#56789a";
    list.appendChild(s);
  }
});
</script>
</body></html>`;

const LAZY_WRAPPER = `<!doctype html><html><head><style>
html,body{margin:0}
#grow{height:950px;background:#123456}
</style></head><body>
<div id="grow"></div>
<script>
let grown = false;
addEventListener("scroll", () => {
  if (grown) return;
  grown = true;
  document.getElementById("grow").style.height = "8550px";
});
</script>
</body></html>`;

// Pinned viewport so the tall wrapper is the only virtual candidate; each
// clip shape provably leaves no paint area.
const CLIP_SELF = `<!doctype html><html><head><style>
html,body{margin:0;height:100%;overflow:hidden}
#smooth{height:9000px;width:100%;clip-path:inset(100%);background:#123456}
</style></head><body>
<div id="smooth"></div>
</body></html>`;

const CLIP_ANCESTOR = `<!doctype html><html><head><style>
html,body{margin:0;height:100%;overflow:hidden}
#outer{height:9000px;width:100%;clip-path:inset(100%)}
#inner{height:9000px;width:100%;background:#123456}
</style></head><body>
<div id="outer"><div id="inner"></div></div>
</body></html>`;

const CLIP_LEGACY = `<!doctype html><html><head><style>
html,body{margin:0;height:100%;overflow:hidden}
#legacy{position:absolute;top:0;left:0;height:9000px;width:100%;clip:rect(0,0,0,0);background:#123456}
</style></head><body>
<div id="legacy"></div>
</body></html>`;

const CLIP_FRACTIONAL = `<!doctype html><html><head><style>
html,body{margin:0;height:100%;overflow:hidden}
#smooth{height:1200.390625px;width:100%;clip-path:inset(600.1px 0);background:#123456}
</style></head><body>
<div id="smooth"></div>
</body></html>`;

// Individual `scale` (not `transform`) also makes local clip geometry
// unmappable: 2400px scaled .5 is 1200px on screen, and inset(650px 0)
// leaves 1100px of local paint.
const CLIP_SCALED = `<!doctype html><html><head><style>
html,body{margin:0;height:100%;overflow:hidden}
#smooth{height:2400px;width:200%;transform-origin:top left;scale:0.5;clip-path:inset(650px 0);background:#123456}
</style></head><body>
<div id="smooth"></div>
</body></html>`;

// `zoom` scales layout; a local px inset cannot be judged against the
// scaled box, so this wrapper still paints a sliver.
const CLIP_ZOOMED = `<!doctype html><html><head><style>
html,body{margin:0;height:100%;overflow:hidden}
#smooth{height:2400px;width:200%;transform-origin:top left;zoom:0.5;clip-path:inset(650px 0);background:#123456}
</style></head><body>
<div id="smooth"></div>
</body></html>`;

const CLIP_CONTROL = `<!doctype html><html><head><style>
html,body{margin:0;height:100%;overflow:hidden}
#smooth{height:9000px;width:100%;clip-path:inset(10%);background:#123456}
</style></head><body>
<div id="smooth"></div>
</body></html>`;

// Locomotive-style: body pinned, wrapper translated, fixed header sibling.
const VIRTUAL = `<!doctype html><html><head><style>
html,body{margin:0}
body{position:fixed;inset:0;overflow:hidden;background:#111}
#smooth{width:100%;transform:translateY(-2400px)}
#smooth section{display:block;height:3000px;width:100%}
#one{background:#aa0000}#two{background:#00aa00}#three{background:#0000aa}
#chrome{position:fixed;top:0;left:0;width:100%;height:140px;background:#eee;z-index:2}
#nav{position:fixed;top:0;left:0;width:100%;height:200px;background:#333;z-index:3}
</style></head><body>
<header id="chrome"></header>
<div id="smooth"><nav id="nav"></nav><section id="one"></section><section id="two"></section><section id="three"></section></div>
</body></html>`;

// The tall child is clipped and cannot be scrolled: not a virtual page.
const CLIPPED = `<!doctype html><html><head><style>
html,body{margin:0}
body{position:fixed;inset:0;overflow:hidden}
#clip{height:9000px;width:100%;overflow:hidden}
#clip section{display:block;height:3000px;background:#aa0000}
</style></head><body>
<div id="clip"><section></section></div>
</body></html>`;

const HOSTILE = `<!doctype html><html><head><style>
html,body{margin:0}
body{position:fixed;inset:0;overflow:hidden}
.tall{height:9000px;width:100%}
#hidden{visibility:hidden}
#zero{opacity:0}
#overlay{position:fixed;top:0;left:0;width:100%;height:9000px}
#narrow{width:200px}
</style></head><body>
<div id="hidden" class="tall"></div>
<div id="zero" class="tall"></div>
<div id="overlay"><div id="inner" class="tall"></div></div>
<div id="narrow" class="tall"></div>
</body></html>`;

const CANVAS = `<!doctype html><html><head><style>
html,body{margin:0;height:100%}
#gl{position:absolute;inset:0;width:1440px;height:900px;display:block}
</style></head><body>
<canvas id="gl" width="1440" height="900"></canvas>
</body></html>`;

const CANVAS_MIXED = `<!doctype html><html><head><style>
html,body{margin:0;height:100%}
#gl{position:absolute;inset:0;width:1440px;height:900px;display:block}
#ui{position:relative;margin:20px;font:16px sans-serif}
</style></head><body>
<canvas id="gl" width="1440" height="900"></canvas>
<p id="ui">Menu</p>
</body></html>`;

// A full-viewport canvas clipped to a 100x100 hole is not a viewport scene,
// even when visible DOM text sits beside it.
// Partial insets on the canvas itself: 49% leaves 0.04% of the viewport area,
// 10% leaves 64%, 5% leaves 81%.
const CANVAS_INSET49 = `<!doctype html><html><head><style>
html,body{margin:0;height:100%}
#gl{position:absolute;inset:0;width:1440px;height:900px;display:block;clip-path:inset(49%)}
</style></head><body>
<canvas id="gl" width="1440" height="900"></canvas>
</body></html>`;

const CANVAS_INSET10 = CANVAS_INSET49.replace("inset(49%)", "inset(10%)");
const CANVAS_INSET5 = CANVAS_INSET49.replace("inset(49%)", "inset(5%)");
const CANVAS_CIRCLE = CANVAS_INSET49.replace(
  "inset(49%)",
  "circle(1px at center)",
);
const CANVAS_ELLIPSE = CANVAS_INSET49.replace(
  "inset(49%)",
  "ellipse(1px 1px at center)",
);
const CANVAS_POLYGON = CANVAS_INSET49.replace(
  "inset(49%)",
  "polygon(0% 0%, 1% 0%, 1% 1%, 0% 1%)",
);
const CANVAS_ROUNDED = CANVAS_INSET49.replace(
  "inset(49%)",
  "inset(5% round 50%)",
);
const CANVAS_LEGACY_TINY = CANVAS_INSET49.replace(
  "clip-path:inset(49%)",
  "clip:rect(0px, 1px, 1px, 0px)",
);
const CANVAS_LEGACY_FULL = CANVAS_INSET49.replace(
  "clip-path:inset(49%)",
  "clip:rect(0px, 1440px, 900px, 0px)",
);

const CANVAS_TRANSFORM_INSET = CANVAS_INSET49.replace(
  "clip-path:inset(49%)",
  "clip-path:inset(49%);transform:translateZ(0)",
);

const CANVAS_TRANSFORM_ZERO = CANVAS_INSET49.replace(
  "clip-path:inset(49%)",
  "clip-path:inset(0);transform:translateZ(0)",
);

const CANVAS_SCALED = `<!doctype html><html><head><style>
html,body{margin:0;height:100%}
#gl{position:absolute;top:0;left:0;width:2880px;height:1800px;display:block;transform-origin:top left;scale:0.5;clip-path:inset(5%)}
</style></head><body>
<canvas id="gl" width="2880" height="1800"></canvas>
</body></html>`;

const CANVAS_ZOOMED = `<!doctype html><html><head><style>
html,body{margin:0;height:100%}
#gl{position:absolute;top:0;left:0;width:720px;height:450px;display:block;zoom:2;clip-path:inset(50px)}
</style></head><body>
<canvas id="gl" width="720" height="450"></canvas>
</body></html>`;

const CANVAS_ZOOMED_NO_CLIP = `<!doctype html><html><head><style>
html,body{margin:0;height:100%}
#gl{position:absolute;top:0;left:0;width:720px;height:450px;display:block;zoom:2}
</style></head><body>
<canvas id="gl" width="720" height="450"></canvas>
</body></html>`;

const CANVAS_TRANSFORM_SHELL = `<!doctype html><html><head><style>
html,body{margin:0;height:100%}
#shell{width:100vw;height:100vh;overflow:hidden;transform:translateZ(0)}
#gl{display:block;width:100%;height:100%}
</style></head><body>
<div id="shell"><canvas id="gl" width="1440" height="900"></canvas></div>
</body></html>`;

// A 300px border is outside the overflow clip box: the canvas is visible only
// in the 840x300 padding box even though the border box covers the viewport.
const CANVAS_BORDERED = `<!doctype html><html><head><style>
html,body{margin:0;height:100%}
#shell{position:relative;width:840px;height:300px;border:300px solid #000;overflow:hidden;box-sizing:content-box}
#gl{position:absolute;top:-300px;left:-300px;width:1440px;height:900px;display:block}
</style></head><body>
<div id="shell"><canvas id="gl" width="1440" height="900"></canvas></div>
</body></html>`;

const CANVAS_CLIPPED = `<!doctype html><html><head><style>
html,body{margin:0;height:100%}
#clip{width:100px;height:100px;overflow:hidden}
#gl{display:block;width:1440px;height:900px}
#ui{position:relative;margin:20px;font:16px sans-serif}
</style></head><body>
<div id="clip"><canvas id="gl" width="1440" height="900"></canvas></div>
<p id="ui">Menu</p>
</body></html>`;

// The shell clips, but the canvas still reaches the whole viewport.
const CANVAS_SHELL = `<!doctype html><html><head><style>
html,body{margin:0;height:100%}
#shell{width:100vw;height:100vh;overflow:hidden}
#gl{display:block;width:100%;height:100%}
</style></head><body>
<div id="shell"><canvas id="gl" width="1440" height="900"></canvas></div>
</body></html>`;

const CANVAS_INVISIBLE = `<!doctype html><html><head><style>
html,body{margin:0;height:100%}
canvas{position:absolute;inset:0;width:1440px;height:900px;display:block}
#hidden{visibility:hidden}
#zero{opacity:0}
#small{width:400px;height:300px}
</style></head><body>
<canvas id="hidden"></canvas><canvas id="zero"></canvas><canvas id="small"></canvas>
</body></html>`;

if (REQUIRED && !browser) {
  describe("structure Chromium", () => {
    it("launches Chromium", () => {
      throw new Error(
        `AWWWARDS_CHROMIUM_SMOKE=1 (or AWWARDS_CHROMIUM_SMOKE=1) but Chromium is unavailable: ${unavailable || "playwright missing"}\n` +
          "Install it with: npm exec -- playwright install chromium",
      );
    });
  });
} else {
  const suite = browser ? describe : describe.skip;

  suite("structure Chromium", () => {
    it(
      "virtual: translated wrapper height, zero-based bands and fixed chrome at 0",
      { timeout: 90_000 },
      async () => {
        const { scan, pre } = await scanFixture(VIRTUAL);
        expect(scan.scrollMode).toBe("virtual");
        expect(scan.virtualRoot).toBe("div#smooth");
        expect(scan.totalHeight).toBe(9000);
        expect(scan.scrollRoot).toBeUndefined();
        expect(pre.virtualHeight).toBe(9000);
        expect(pre.scrollRoot).toBeNull();

        const tops = new Map(scan.candidates.map((c) => [c.label, c.top]));
        expect(tops.get("#one")).toBe(0);
        expect(tops.get("#two")).toBe(3000);
        // The bug shifted fixed chrome by +2400 into the virtual content.
        expect(tops.get("#chrome")).toBe(0);
        // A fixed descendant of the transformed wrapper is content: the
        // transform makes the wrapper its containing block, rect top -2400.
        expect(tops.get("#nav")).toBe(0);

        const url = fixtureUrl("virtual", VIRTUAL);
        const res = await analyzePageStructure(url);
        if ("error" in res) throw new Error(res.error);
        expect(res.scrollMode).toBe("virtual");
        expect(res.virtualRoot).toBe("div#smooth");
        expect(res.totalHeight).toBe(9000);
        expect(res.scrollRoot).toBeUndefined();
        expect(res.bands.find((b) => b.label === "#chrome")?.offsetTop).toBe(0);
        expect(res.bands.find((b) => b.label === "#two")?.offsetTop).toBe(3000);
        expect(res.bands.find((b) => b.label === "#three")?.offsetTop).toBe(6000);
      },
    );

    it(
      "body scroller: body overflow is document content, not a virtual wrapper",
      { timeout: 90_000 },
      async () => {
        const big = await scanFixture(BODY_SCROLLER_2000);
        expect(big.scan.scrollMode).toBe("document");
        expect(big.scan.totalHeight).toBe(6000);
        expect(big.scan.virtualRoot).toBeUndefined();
        expect("virtualHeight" in big.pre).toBe(false);
        expect(big.pre.scrollHeight).toBe(6000);
        expect(new Map(big.scan.candidates.map((c) => [c.label, c.top])).get("#c")).toBe(4000);

        const short = await scanFixture(BODY_SCROLLER_800);
        expect(short.scan.scrollMode).toBe("document");
        expect(short.scan.totalHeight).toBe(2400);
        expect(short.scan.virtualRoot).toBeUndefined();
        expect("virtualHeight" in short.pre).toBe(false);
        expect(short.pre.scrollHeight).toBe(2400);
        expect(new Map(short.scan.candidates.map((c) => [c.label, c.top])).get("#c")).toBe(1600);

        // Short body overflow must not be rounded down to one viewport.
        for (const [fixture, bodyHeight] of [
          [BODY_SCROLLER_950, 950],
          [BODY_SCROLLER_1000, 1000],
        ] as const) {
          const result = await scanFixture(fixture);
          expect(result.scan.scrollMode).toBe("document");
          expect(result.scan.totalHeight).toBe(bodyHeight);
          expect(result.scan.virtualRoot).toBeUndefined();
          expect("virtualHeight" in result.pre).toBe(false);
          expect(result.pre.scrollHeight).toBe(bodyHeight);
        }
      },
    );

    it(
      "virtual: content-visibility and zero-opacity filters do not qualify",
      { timeout: 90_000 },
      async () => {
        for (const fixture of [INVISIBLE_CONTENT, INVISIBLE_FILTER]) {
          const { scan, pre } = await scanFixture(fixture);
          expect(scan.scrollMode).toBe("document");
          expect(scan.totalHeight).toBe(900);
          expect(scan.virtualRoot).toBeUndefined();
          expect("virtualHeight" in pre).toBe(false);
        }
      },
    );

    it(
      "preScroll returns final metrics after lazy growth",
      { timeout: 120_000 },
      async () => {
        const appended = await scanFixture(LAZY_APPEND);
        expect(appended.pre.scrollHeight).toBe(9000);
        expect("virtualHeight" in appended.pre).toBe(false);
        expect(appended.scan.totalHeight).toBe(9000);

        const grown = await scanFixture(LAZY_WRAPPER);
        expect(grown.pre.scrollHeight).toBe(8550);
        expect("virtualHeight" in grown.pre).toBe(false);
        expect(grown.scan.scrollMode).toBe("document");
        expect(grown.scan.totalHeight).toBe(8550);
        expect(grown.scan.virtualRoot).toBeUndefined();
      },
    );

    it(
      "clip shapes: provably empty clip-path and legacy clip are not virtual pages",
      { timeout: 120_000 },
      async () => {
        // A legacy-clipped absolute box still contributes to document scroll
        // overflow (html scrollHeight 9000); what matters is it is not virtual.
        for (const [fixture, total] of [
          [CLIP_SELF, 900],
          [CLIP_ANCESTOR, 900],
          [CLIP_LEGACY, 9000],
        ] as const) {
          const { scan, pre } = await scanFixture(fixture);
          expect(scan.scrollMode).toBe("document");
          expect(scan.totalHeight).toBe(total);
          expect(scan.virtualRoot).toBeUndefined();
          expect("virtualHeight" in pre).toBe(false);
        }

        // A partial inset is not proof of emptiness.
        const control = await scanFixture(CLIP_CONTROL);
        expect(control.scan.scrollMode).toBe("virtual");
        expect(control.scan.virtualRoot).toBe("div#smooth");
        expect(control.pre.virtualHeight).toBe(9000);
      },
    );

    it(
      "clip shapes: fractional px geometry still paints a sliver",
      { timeout: 90_000 },
      async () => {
        // offsetHeight reports 1200, but the real box is 1200.390625 and
        // inset(600.1px 0) leaves 0.190625px of paint.
        const fractional = await scanFixture(CLIP_FRACTIONAL);
        expect(fractional.scan.scrollMode).toBe("virtual");
        expect(fractional.scan.virtualRoot).toBe("div#smooth");
        expect(fractional.scan.totalHeight).toBe(1200);
        expect(fractional.pre.virtualHeight).toBe(1200);

        // `scale` is an individual transform, so inset(650px 0) cannot be
        // judged against the scaled 1200px box.
        const scaled = await scanFixture(CLIP_SCALED);
        expect(scaled.scan.scrollMode).toBe("virtual");
        expect(scaled.scan.virtualRoot).toBe("div#smooth");
        expect(scaled.scan.totalHeight).toBe(1200);
        expect(scaled.pre.virtualHeight).toBe(1200);

        // `zoom` scales layout too, so inset(650px 0) still leaves paint.
        const zoomed = await scanFixture(CLIP_ZOOMED);
        expect(zoomed.scan.scrollMode).toBe("virtual");
        expect(zoomed.scan.virtualRoot).toBe("div#smooth");
        expect(zoomed.scan.totalHeight).toBe(1200);
        expect(zoomed.pre.virtualHeight).toBe(1200);
      },
    );

    it(
      "canvas: unresolved clip shapes cannot establish dominance",
      { timeout: 120_000 },
      async () => {
        for (const fixture of [CANVAS_CIRCLE, CANVAS_ELLIPSE, CANVAS_POLYGON]) {
          const result = await scanFixture(fixture);
          expect(result.scan.scrollMode).toBe("document");
          expect(result.scan.note).toBeUndefined();
        }

        // Rounded corners cannot be reduced to the enclosing rectangle.
        const rounded = await scanFixture(CANVAS_ROUNDED);
        expect(rounded.scan.scrollMode).toBe("document");

        // A nonempty 1x1 legacy clip is intersected, not ignored.
        const legacyTiny = await scanFixture(CANVAS_LEGACY_TINY);
        expect(legacyTiny.scan.scrollMode).toBe("document");

        // A full legacy rect still qualifies.
        const legacyFull = await scanFixture(CANVAS_LEGACY_FULL);
        expect(legacyFull.scan.scrollMode).toBe("canvas");

        // No clip and a resolvable 5% inset still qualify.
        const noClip = await scanFixture(CANVAS);
        expect(noClip.scan.scrollMode).toBe("canvas");

        const inset5 = await scanFixture(CANVAS_INSET5);
        expect(inset5.scan.scrollMode).toBe("canvas");
      },
    );

    it(
      "canvas: transformed clipping cannot establish dominance",
      { timeout: 120_000 },
      async () => {
        const inset = await scanFixture(CANVAS_TRANSFORM_INSET);
        expect(inset.scan.scrollMode).toBe("document");
        expect(inset.scan.note).toBeUndefined();

        // A zero inset is no clipping, so the transformed canvas still counts.
        const zero = await scanFixture(CANVAS_TRANSFORM_ZERO);
        expect(zero.scan.scrollMode).toBe("canvas");

        // Overflow hidden plus a transform is unknown geometry too.
        const shell = await scanFixture(CANVAS_TRANSFORM_SHELL);
        expect(shell.scan.scrollMode).toBe("document");

        // Individual `scale` is just as unmappable as `transform`.
        const scaled = await scanFixture(CANVAS_SCALED);
        expect(scaled.scan.scrollMode).toBe("document");
        expect(scaled.scan.note).toBeUndefined();

        // Zoomed local clip geometry is unmappable; no clip still qualifies.
        const zoomed = await scanFixture(CANVAS_ZOOMED);
        expect(zoomed.scan.scrollMode).toBe("document");
        expect(zoomed.scan.note).toBeUndefined();

        const zoomedNoClip = await scanFixture(CANVAS_ZOOMED_NO_CLIP);
        expect(zoomedNoClip.scan.scrollMode).toBe("canvas");
      },
    );

    it(
      "clipped: a tall overflow:hidden child stays a document page",
      { timeout: 90_000 },
      async () => {
        const { scan, pre } = await scanFixture(CLIPPED);
        expect(scan.scrollMode).toBe("document");
        expect(scan.totalHeight).toBe(900);
        expect(scan.virtualRoot).toBeUndefined();
        expect("virtualHeight" in pre).toBe(false);

        const url = fixtureUrl("clipped", CLIPPED);
        const res = await analyzePageStructure(url);
        if ("error" in res) throw new Error(res.error);
        expect(res.scrollMode).toBe("document");
        expect(res.totalHeight).toBe(900);
        expect(res.virtualRoot).toBeUndefined();
      },
    );

    it(
      "hostile: hidden, transparent, fixed-overlay and narrow candidates do not invent a page",
      { timeout: 90_000 },
      async () => {
        const { scan, pre } = await scanFixture(HOSTILE);
        expect(scan.scrollMode).toBe("document");
        expect(scan.totalHeight).toBe(900);
        expect(scan.virtualRoot).toBeUndefined();
        expect("virtualHeight" in pre).toBe(false);
      },
    );

    it(
      "canvas: only a visible dominant canvas qualifies; mixed DOM keeps a qualified note",
      { timeout: 90_000 },
      async () => {
        const visible = await scanFixture(CANVAS);
        expect(visible.scan.scrollMode).toBe("canvas");
        expect(visible.scan.note).toContain("motion recording");
        expect(visible.scan.note).toContain("3D scene capture");
        expect(visible.scan.note).toContain("DOM bands");

        const mixed = await scanFixture(CANVAS_MIXED);
        expect(mixed.scan.scrollMode).toBe("canvas");
        expect(mixed.scan.note).not.toMatch(/not in the DOM|no DOM content|DOM-free/i);

        const invisible = await scanFixture(CANVAS_INVISIBLE);
        expect(invisible.scan.scrollMode).toBe("document");
        expect(invisible.scan.note).toBeUndefined();
      },
    );

    it(
      "canvas: clipping ancestors bound the visible area; a full-viewport shell still qualifies",
      { timeout: 90_000 },
      async () => {
        const clipped = await scanFixture(CANVAS_CLIPPED);
        expect(clipped.scan.scrollMode).toBe("document");
        expect(clipped.scan.note).toBeUndefined();

        const shell = await scanFixture(CANVAS_SHELL);
        expect(shell.scan.scrollMode).toBe("canvas");
        expect(shell.scan.note).toContain("DOM bands");
        expect(shell.scan.note).toContain("additional DOM UI may still exist");
      },
    );

    it(
      "canvas: partial clip-path reduces dominance before classification",
      { timeout: 120_000 },
      async () => {
        const full = await scanFixture(CANVAS);
        expect(full.scan.scrollMode).toBe("canvas");

        const inset49 = await scanFixture(CANVAS_INSET49);
        expect(inset49.scan.scrollMode).toBe("document");
        expect(inset49.scan.note).toBeUndefined();

        // 10% inset leaves 64% of the viewport area, below the 80% threshold.
        const inset10 = await scanFixture(CANVAS_INSET10);
        expect(inset10.scan.scrollMode).toBe("document");

        // 5% inset leaves 81%, so a mild clip still qualifies.
        const inset5 = await scanFixture(CANVAS_INSET5);
        expect(inset5.scan.scrollMode).toBe("canvas");

        const hole = await scanFixture(CANVAS_CLIPPED);
        expect(hole.scan.scrollMode).toBe("document");

        // Borders are outside the overflow clip box.
        const bordered = await scanFixture(CANVAS_BORDERED);
        expect(bordered.scan.scrollMode).toBe("document");
        expect(bordered.scan.note).toBeUndefined();
      },
    );

    it(
      "controls: ordinary document and element scrolling keep their measurements",
      { timeout: 90_000 },
      async () => {
        const doc = await scanFixture(DOCUMENT);
        expect(doc.scan.scrollMode).toBe("document");
        expect(doc.scan.totalHeight).toBe(6000);
        expect(doc.scan.virtualRoot).toBeUndefined();
        expect(doc.scan.note).toBeUndefined();
        expect("virtualHeight" in doc.pre).toBe(false);
        const docBands = await analyzePageStructure(fixtureUrl("document", DOCUMENT));
        if ("error" in docBands) throw new Error(docBands.error);
        expect(docBands.scrollMode).toBe("document");
        expect(docBands.totalHeight).toBe(6000);
        expect(docBands.bands.find((b) => b.label === "#b")?.offsetTop).toBe(2000);
        expect(docBands.bands.find((b) => b.label === "#c")?.offsetTop).toBe(4000);

        const element = await scanFixture(ELEMENT);
        expect(element.scan.scrollMode).toBe("element");
        expect(element.scan.scrollRoot).toBe("div#page");
        expect(element.scan.totalHeight).toBe(4000);
        expect(element.scan.virtualRoot).toBeUndefined();
        expect(element.pre.scrollRoot).toBe("div#page");
        expect("virtualHeight" in element.pre).toBe(false);
      },
    );
  });
}
