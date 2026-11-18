import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Browser, Page } from "playwright";
import ts from "typescript";
import { buildProject, splitBuild } from "../src/build-project.js";
import { emitNext } from "../src/emit-next.js";

// M3 rendered parity: the source document and the generated page must expose
// the same language/direction/theme state at 1440x900, and no executable
// document attribute may survive. CSS files are not served by this harness, so
// the fixture carries its document styling inline — which is exactly the state
// that must survive conversion.
const REQUIRED = ["AWWARDS_CHROMIUM_SMOKE", "AWWWARDS_CHROMIUM_SMOKE"].some((k) => process.env[k] === "1");

let chromium: typeof import("playwright").chromium | null = null;
let browser: Browser | null = null;
let unavailable = "";
try {
  ({ chromium } = await import("playwright"));
  browser = await chromium.launch();
} catch (err) {
  unavailable = err instanceof Error ? err.message : String(err);
}

afterAll(async () => {
  if (browser) await browser.close();
}, 120_000);

const HTML_ATTRS = `lang='ar' dir='rtl' class="theme-night" id="doc" data-theme="night" data-json='{"a":1}' data-foo.bar="a&amp;b" data-bs.x="C:\\new" data-ml.x="one&#10;two" data-cy.x="&copy;" data-nb.x="&nbsp;" data-cs.x="&Amp;" data-win.x="&#x80;" data-message.text="one  two" data-pad.text=" pad " data-gt.text="a>b" data-after="kept" data-empty.x="" data-valueless.y style='--ink: rgb(1, 2, 3); --色: rgb(7, 7, 7); background-image: url("hero.png"); background-color: rgb(9, 8, 7)'`;
const BODY_ATTRS = `dir="rtl" class="page" id="top" data-page="home" aria-label="Price &#128;5 &amp; &copy; &Amp;" style="color: rgb(4, 5, 6)"`;
// Rebuilt layouts are reconstructed from the allowlist, so the handlers below
// must not survive. A native rehost keeps its captured shell verbatim (the
// document is the page, nothing is transferred), so its fixture is clean.
const REBUILD = `<!doctype html>
<html ${HTML_ATTRS} onclick="window.__pwned = 1">
<head><title>Doc</title></head>
<body ${BODY_ATTRS} onmouseover="window.__pwned = 2">
<section class="c-0"><p class="c-1">stage</p><div data-gt.text="a>b" data-after="kept">gt</div></section>
</body>
</html>`;
const REHOST = `<!doctype html>
<html ${HTML_ATTRS}>
<head><title>Home > About &amp; A < B</title></head>
<body ${BODY_ATTRS}>
<main id="main"><section id="a">A</section><section id="b">B</section><div data-gt.text="a>b" data-after="kept">gt</div></main>
</body>
</html>`;

// Everything the document itself renders: attributes, inherited direction and
// inline-style computed values. __pwned must stay absent in the generated page.
function documentState(page: Page) {
  return page.evaluate(() => {
    const html = document.documentElement;
    const body = document.body;
    const hs = getComputedStyle(html);
    const bs = getComputedStyle(body);
    return {
      lang: html.lang,
      dir: html.dir,
      htmlDirection: hs.direction,
      htmlClass: html.className,
      htmlId: html.id,
      htmlData: html.getAttribute("data-theme"),
      htmlJson: html.getAttribute("data-json"),
      htmlDotted: html.getAttribute("data-foo.bar"),
      htmlBackslash: html.getAttribute("data-bs.x"),
      htmlMultiline: html.getAttribute("data-ml.x"),
      htmlCopy: html.getAttribute("data-cy.x"),
      htmlNbsp: html.getAttribute("data-nb.x"),
      htmlAmpCase: html.getAttribute("data-cs.x"),
      htmlWin: html.getAttribute("data-win.x"),
      htmlSpaces: html.getAttribute("data-message.text"),
      htmlPad: html.getAttribute("data-pad.text"),
      htmlGt: html.getAttribute("data-gt.text"),
      htmlAfter: html.getAttribute("data-after"),
      htmlEmptyDotted: html.getAttribute("data-empty.x"),
      htmlValueless: html.getAttribute("data-valueless.y"),
      htmlBackground: hs.backgroundColor,
      htmlBackgroundImage: hs.backgroundImage,
      ink: hs.getPropertyValue("--ink").replace(/\s+/g, " ").trim(),
      unicodeInk: hs.getPropertyValue("--色").replace(/\s+/g, " ").trim(),
      bodyDir: body.dir,
      bodyDirection: bs.direction,
      bodyClass: body.className,
      bodyId: body.id,
      bodyData: body.getAttribute("data-page"),
      bodyLabel: body.getAttribute("aria-label"),
      bodyColor: bs.color,
      // A captured title is text; the generated document must keep it intact.
      title: document.title,
    };
  });
}

const load = (page: Page, html: string) =>
  page.goto("data:text/html;charset=utf-8," + encodeURIComponent(html), { waitUntil: "domcontentloaded", timeout: 30_000 });

async function buildVitePage(source: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "awwwards-bp-doc-render-"));
  try {
    writeFileSync(join(dir, "index.html"), source);
    const res = await buildProject({ html: join(dir, "index.html"), target: "vite", out: join(dir, "out") });
    if ("error" in res) throw new Error(res.error);
    return readFileSync(join(dir, "out", "index.html"), "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Next output is TSX, so its rendered parity needs a real renderer. The layout
// is transpiled to CommonJS and rendered with react-dom/server; both packages
// are transitive dev tools here (not declared dependencies), so the suite skips
// rather than fails when they are absent. `astro` is not installed at all, so
// the Astro target stays covered by its shared HTML emitter path + pure tests.
type NextRenderer = (layout: string) => string;
let renderNext: NextRenderer | null = null;
// Renders any generated TSX component (layout or section) to static markup.
let renderTsx: NextRenderer | null = null;
try {
  const nodeRequire = createRequire(import.meta.url);
  const React = nodeRequire("react") as typeof import("react");
  const { renderToStaticMarkup } = nodeRequire("react-dom/server") as typeof import("react-dom/server");
  const jsxRuntime = nodeRequire("react/jsx-runtime");
  renderNext = (layout: string): string => {
    const out = ts.transpileModule(layout, {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
      fileName: "layout.tsx",
      reportDiagnostics: true,
    });
    const errors = (out.diagnostics ?? []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    if (errors.length > 0) throw new Error(`generated layout does not transpile: ${errors.join("; ")}`);
    const mod: { exports: { default?: (props: { children?: unknown }) => unknown } } = { exports: {} };
    const shim = (id: string): unknown => {
      if (id === "react") return React;
      if (id === "react/jsx-runtime") return jsxRuntime;
      if (id.endsWith(".css")) return {};
      // Section/SiteScripts imports of a rehost layout render as inert stubs;
      // this harness checks the document shell, not the section markup.
      if (id.startsWith("../components/")) return { __esModule: true, default: () => React.createElement("div", null, id) };
      throw new Error(`unexpected import in generated layout: ${id}`);
    };
    new Function("require", "module", "exports", out.outputText)(shim, mod, mod.exports);
    const Layout = mod.exports.default;
    if (!Layout) throw new Error("generated layout has no default export");
    return renderToStaticMarkup(React.createElement(Layout, null, React.createElement("main", null, "x")) as never);
  };
  // Same pipeline without the layout's `children` argument.
  renderTsx = (source: string): string => {
    const out = ts.transpileModule(source, {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
      fileName: "component.tsx",
      reportDiagnostics: true,
    });
    const errors = (out.diagnostics ?? []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    if (errors.length > 0) throw new Error(`generated component does not transpile: ${errors.join("; ")}`);
    const mod: { exports: { default?: () => unknown } } = { exports: {} };
    const shim = (id: string): unknown => {
      if (id === "react") return React;
      if (id === "react/jsx-runtime") return jsxRuntime;
      if (id.endsWith(".css")) return {};
      // A page-level render imports its section components; this harness checks
      // the markup next to them, so they render as inert stubs.
      if (id.startsWith("../components/")) return { __esModule: true, default: () => React.createElement("div", null, id) };
      throw new Error(`unexpected import in generated component: ${id}`);
    };
    new Function("require", "module", "exports", out.outputText)(shim, mod, mod.exports);
    const Component = mod.exports.default;
    if (!Component) throw new Error("generated component has no default export");
    return renderToStaticMarkup(React.createElement(Component) as never);
  };
} catch {
  // react/react-dom unavailable: the Next render suite skips (see above).
}

if (!browser && REQUIRED) {
  describe("build_project document attribute rendering", () => {
    it("launches Chromium", () => {
      throw new Error(
        `AWWARDS_CHROMIUM_SMOKE=1 but Chromium is unavailable: ${unavailable || "playwright missing"}\n` +
          "Install it with: npm exec -- playwright install chromium",
      );
    });
  });
} else {
  const suite = browser ? describe : describe.skip;
  suite("build_project document attribute rendering", () => {
    for (const [shape, source, rebuilt] of [
      ["rebuild", REBUILD, true],
      ["rehost", REHOST, false],
    ] as const) {
      it(`${shape}: generated page matches the source at 1440x900`, { timeout: 60_000 }, async () => {
        const generated = await buildVitePage(source);
        // Reconstructed document tags never carry handlers; a rehost shell is
        // the captured document itself and stays verbatim.
        if (rebuilt) expect(generated).not.toMatch(/\son[a-z]+=/i);
        const page = await browser!.newPage({ viewport: { width: 1440, height: 900 } });
        try {
          await load(page, source);
          const sourceState = await documentState(page);
          expect(sourceState.lang).toBe("ar");
          expect(sourceState.htmlDirection).toBe("rtl");

          await load(page, generated);
          const generatedState = await documentState(page);
          // A rebuilt document gets its title from the build name (an input,
          // not the captured head), so only the rehost shell carries it.
          if (rebuilt) expect({ ...generatedState, title: sourceState.title }).toEqual(sourceState);
          else expect(generatedState).toEqual(sourceState);

          await page.evaluate(() => {
            document.documentElement.click();
            document.body.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
          });
          expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
        } finally {
          await page.close();
        }
      });
    }

    const nextSuite = renderNext ? describe : describe.skip;
    nextSuite("build_project Next layout rendering", () => {
      it("React-rendered layout matches the source document at 1440x900", { timeout: 60_000 }, async () => {
        const layout = emitNext(splitBuild(REBUILD), "unused", "Doc").files.find((f) => f.path === "app/layout.tsx");
        expect(layout).toBeDefined();
        const markup = `<!doctype html>${renderNext!(layout!.content)}`;
        const page = await browser!.newPage({ viewport: { width: 1440, height: 900 } });
        try {
          await load(page, REBUILD);
          const sourceState = await documentState(page);
          await load(page, markup);
          // This rebuilt layout carries the title through Next metadata, not
          // the document head, so the head title is not part of the comparison.
          expect({ ...(await documentState(page)), title: sourceState.title }).toEqual(sourceState);
          expect(markup).not.toContain("__pwned");
        } finally {
          await page.close();
        }
      });

      it("never turns a style declaration name into an executable key", { timeout: 60_000 }, async () => {
        const source = `<!doctype html><html lang="en" style="[globalThis.__pwned=31337]: 1; *zoom: 1; {color:red}; -:2; 'foo bar:1'; color: blue"><head><title>x</title></head><body><section class="c-1"><p class="c-2">x</p></section></body></html>`;
        const layout = emitNext(splitBuild(source), "unused", "Doc").files.find((f) => f.path === "app/layout.tsx");
        expect(layout).toBeDefined();
        for (const bad of ["globalThis", "__pwned", "*zoom", "{color", "foo bar"]) expect(layout!.content).not.toContain(bad);
        const markup = `<!doctype html>${renderNext!(layout!.content)}`;
        const page = await browser!.newPage({ viewport: { width: 1440, height: 900 } });
        try {
          await load(page, markup);
          expect(await page.evaluate(() => (globalThis as { __pwned?: number }).__pwned)).toBeUndefined();
          // The valid declaration still lands, so the object was not just emptied.
          expect(await page.evaluate(() => getComputedStyle(document.documentElement).color)).toBe("rgb(0, 0, 255)");
        } finally {
          await page.close();
        }
      });

      it("rehost layout renders spread values as data (all attribute decodings)", { timeout: 60_000 }, async () => {
        const layout = emitNext(splitBuild(REHOST), "unused", "Doc").files.find((f) => f.path === "app/layout.tsx");
        expect(layout).toBeDefined();
        const spreadState = (p: Page) =>
          p.evaluate(() => {
            const html = document.documentElement;
            return {
              amp: html.getAttribute("data-foo.bar"),
              backslash: html.getAttribute("data-bs.x"),
              multiline: html.getAttribute("data-ml.x"),
              copy: html.getAttribute("data-cy.x"),
              nbsp: html.getAttribute("data-nb.x"),
              ampCase: html.getAttribute("data-cs.x"),
              windows: html.getAttribute("data-win.x"),
              spaces: html.getAttribute("data-message.text"),
              padded: html.getAttribute("data-pad.text"),
              gt: html.getAttribute("data-gt.text"),
              after: html.getAttribute("data-after"),
              emptyDotted: html.getAttribute("data-empty.x"),
              valueless: html.getAttribute("data-valueless.y"),
              label: document.body.getAttribute("aria-label"),
            };
          });
        const page = await browser!.newPage({ viewport: { width: 1440, height: 900 } });
        try {
          await load(page, REHOST);
          const source = await spreadState(page);
          // The captured document's own values, as a browser reads them.
          expect(source).toEqual({
            amp: "a&b",
            backslash: "C:\\new",
            multiline: "one\ntwo",
            copy: "©",
            nbsp: "\u00a0",
            ampCase: "&Amp;",
            windows: "€",
            spaces: "one  two",
            padded: " pad ",
            gt: "a>b",
            after: "kept",
            emptyDotted: "",
            valueless: "",
            label: "Price €5 & © &Amp;",
          });
          await load(page, `<!doctype html>${renderNext!(layout!.content)}`);
          expect(await spreadState(page)).toEqual(source);
        } finally {
          await page.close();
        }
      });

      it("section markup keeps a > inside a quoted value, and the attributes after it", { timeout: 60_000 }, async () => {
        const gtState = (p: Page) =>
          p.evaluate(() => {
            const el = document.body.querySelector("div[data-after]")!;
            return { gt: el.getAttribute("data-gt.text"), after: el.getAttribute("data-after"), text: el.textContent };
          });
        for (const [shape, source] of [
          ["rebuild", REBUILD],
          ["rehost", REHOST],
        ] as const) {
          // The markup lands in a section component (rebuild) or the page
          // itself (rehost); both are generated from the same tag scan.
          const host = emitNext(splitBuild(source), "unused", "x").files.find(
            (f) => f.content.includes("data-gt.text") && f.content.includes("<div"),
          );
          expect(host, `${shape} file carrying the markup`).toBeDefined();
          const page = await browser!.newPage({ viewport: { width: 1440, height: 900 } });
          try {
            await load(page, source);
            const sourceState = await gtState(page);
            expect(sourceState).toEqual({ gt: "a>b", after: "kept", text: "gt" });
            await load(page, `<!doctype html><html><body>${renderTsx!(host!.content)}</body></html>`);
            expect(await gtState(page), `${shape} rendered ${host!.path}`).toEqual(sourceState);
          } finally {
            await page.close();
          }
        }
      });

      it("normalizes literal CR like the browser, and still restores entity CR", { timeout: 90_000 }, async () => {
        const CR = "\r";
        // Real CR and CRLF bytes in the attribute text, plus one entity CR.
        const source = `<!doctype html><html lang="en" data-lit.x="a${CR}b${CR}\nc" data-ent.y="e&#13;f"><head><title>Doc</title></head><body class="real" data-bbody.z="g${CR}h"><section class="c-0"><p class="c-1">stage</p></section></body></html>`;
        const layout = emitNext(splitBuild(source), "unused", "Doc").files.find((f) => f.path === "app/layout.tsx");
        expect(layout).toBeDefined();
        const crState = (p: Page) =>
          p.evaluate(() => ({
            lit: document.documentElement.getAttribute("data-lit.x"),
            ent: document.documentElement.getAttribute("data-ent.y"),
            body: document.body.getAttribute("data-bbody.z"),
          }));
        const page = await browser!.newPage({ viewport: { width: 1440, height: 900 } });
        try {
          await load(page, source);
          const sourceState = await crState(page);
          // The parser normalizes literal CR/CRLF before entity decoding, so the
          // literal values are LF and only the reference keeps U+000D.
          expect(sourceState).toEqual({ lit: "a\nb\nc", ent: "e\rf", body: "g\nh" });
          await load(page, `<!doctype html>${renderNext!(layout!.content)}`);
          expect(await crState(page), "generated with JS").toEqual(sourceState);
        } finally {
          await page.close();
        }
      });

      it("keeps decoded named references in document and section styles", { timeout: 60_000 }, async () => {
        // Source styles carry named refs; both document style objects and section
        // style objects must match what the browser computes from the source.
        const source = `<!doctype html><html lang="en" style="--copy: &copy;"><head><title>Doc</title></head><body class="real" style="font-family: '&nbsp;Sans'"><section class="c-0"><p class="c-1" style="content: 'A;&copy;B'">stage</p></section></body></html>`;
        const files = emitNext(splitBuild(source), "unused", "Doc").files;
        const layout = files.find((f) => f.path === "app/layout.tsx");
        const section = files.find((f) => f.content.includes("<section"));
        expect(layout).toBeDefined();
        expect(section).toBeDefined();
        const styleState = (p: Page) =>
          p.evaluate(() => ({
            htmlCopy: getComputedStyle(document.documentElement).getPropertyValue("--copy").trim(),
            bodyFont: getComputedStyle(document.body).fontFamily,
          }));
        const page = await browser!.newPage({ viewport: { width: 1440, height: 900 } });
        try {
          await load(page, source);
          const sourceState = await styleState(page);
          expect(sourceState.htmlCopy).toBe("©");
          await load(
            page,
            `<!doctype html>${renderNext!(layout!.content).replace("{children}", renderTsx!(section!.content))}`,
          );
          expect(await styleState(page)).toEqual(sourceState);
        } finally {
          await page.close();
        }
      });

      it("restores a CR document attribute in both layouts, and stays safe without JS", { timeout: 90_000 }, async () => {
        const crMarkup = (shape: "rebuild" | "rehost") =>
          shape === "rebuild"
            ? `<!doctype html><html lang="en" data-cr.x="a&#13;b"><head><title>Doc</title></head><body class="real" data-bcr.y="c&#13;d"><section class="c-0"><p class="c-1">stage</p></section></body></html>`
            : `<!doctype html><html lang="en" data-cr.x="a&#13;b"><head><title>Doc</title></head><body class="real" data-bcr.y="c&#13;d"><main id="main"><section id="a">A</section><section id="b">B</section></main></body></html>`;
        const crState = (p: Page) =>
          p.evaluate(() => ({
            html: document.documentElement.getAttribute("data-cr.x"),
            body: document.body.getAttribute("data-bcr.y"),
          }));
        for (const shape of ["rebuild", "rehost"] as const) {
          const source = crMarkup(shape);
          const layout = emitNext(splitBuild(source), "unused", "Doc").files.find((f) => f.path === "app/layout.tsx");
          expect(layout, `${shape} layout`).toBeDefined();
          const rendered = `<!doctype html>${renderNext!(layout!.content)}`;
          const page = await browser!.newPage({ viewport: { width: 1440, height: 900 } });
          try {
            // The source keeps U+000D: a character reference decodes after the
            // parser's newline normalization.
            await load(page, source);
            const sourceState = await crState(page);
            expect(sourceState).toEqual({ html: "a\rb", body: "c\rd" });
            // The inline script restores the exact value before paint.
            await load(page, rendered);
            expect(await crState(page), `${shape} with JS`).toEqual(sourceState);
          } finally {
            await page.close();
          }
          // No-JS: static markup is still safe and complete — CR simply reads as
          // LF, and the restore script never reaches the document as text.
          const context = await browser!.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
          try {
            const noJs = await context.newPage();
            await load(noJs, rendered);
            const state = await noJs.evaluate(() => ({
              // innerText, not textContent: script source is never rendered text.
              text: document.body.innerText.trim(),
              leaked: document.body.innerText.includes("setAttribute"),
              cr: document.documentElement.getAttribute("data-cr.x"),
            }));
            expect(state.leaked, `${shape} without JS`).toBe(false);
            expect(state.cr, `${shape} without JS`).toBe("a\nb");
            expect(state.text.startsWith("x"), `${shape} renders its children`).toBe(true);
          } finally {
            await context.close();
          }
        }
      });

      it("never lets a CR attribute value close the restore script", { timeout: 60_000 }, async () => {
        const source = `<!doctype html><html lang="en" data-cr.x="x&#13;&lt;/script&gt;&lt;img src=x onerror=window.__pwned=7&gt;"><head><title>Doc</title></head><body class="real"><section class="c-0"><p class="c-1">stage</p></section></body></html>`;
        const layout = emitNext(splitBuild(source), "unused", "Doc").files.find((f) => f.path === "app/layout.tsx");
        expect(layout).toBeDefined();
        const page = await browser!.newPage({ viewport: { width: 1440, height: 900 } });
        try {
          await load(page, `<!doctype html>${renderNext!(layout!.content)}`);
          const state = await page.evaluate(() => ({
            cr: document.documentElement.getAttribute("data-cr.x"),
            pwned: (window as unknown as { __pwned?: number }).__pwned ?? null,
            imgs: document.querySelectorAll("img").length,
          }));
          expect(state.pwned).toBeNull();
          expect(state.imgs).toBe(0);
          // The exact value survives, escaped content included.
          expect(state.cr).toBe("x\r</script><img src=x onerror=window.__pwned=7>");
        } finally {
          await page.close();
        }
      });

      it("rehost layout renders a title with >, < and tag-like text intact", { timeout: 60_000 }, async () => {
        const source = `<!doctype html><html lang="ar"><head><title>Home > About &amp; A < B <body>end</title></head><body class="real"><main id="main"><section id="a">A</section><section id="b">B</section></main></body></html>`;
        const layout = emitNext(splitBuild(source), "unused", "x").files.find((f) => f.path === "app/layout.tsx");
        expect(layout).toBeDefined();
        const page = await browser!.newPage({ viewport: { width: 1440, height: 900 } });
        try {
          await load(page, source);
          const sourceTitle = await page.evaluate(() => document.title);
          expect(sourceTitle).toBe("Home > About & A < B <body>end");
          await load(page, `<!doctype html>${renderNext!(layout!.content)}`);
          expect(await page.evaluate(() => document.title)).toBe(sourceTitle);
        } finally {
          await page.close();
        }
      });
    });
  });
}

// A required run must not pass because react/react-dom are missing from the
// tree: they are transitive dev tools (via playwright/spectorjs), so the
// renderer is checked explicitly rather than silently skipping this suite.
if (REQUIRED && !renderNext) {
  describe("build_project Next layout rendering", () => {
    it("has a renderer available", () => {
      throw new Error(
        "react/react-dom are unavailable, so the generated Next layout cannot be rendered.\n" +
          "This suite is required under AWWARDS_CHROMIUM_SMOKE/AWWWARDS_CHROMIUM_SMOKE=1.",
      );
    });
  });
}
