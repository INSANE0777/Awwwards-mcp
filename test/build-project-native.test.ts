import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import ts from "typescript";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProject, emitAstro, emitVite, splitBuild, splitRehost } from "../src/build-project.js";
import { emitNext } from "../src/emit-next.js";

const FIXTURES = join(__dirname, "fixtures", "build-project");
const sample4 = () => readFileSync(join(FIXTURES, "sample4.html"), "utf8");
const byPath = (files: Array<{ path: string; content: string }>) =>
  Object.fromEntries(files.map((f) => [f.path, f.content]));
const order = (text: string, needles: string[]): number[] => needles.map((n) => text.indexOf(n));

describe("splitRehost: content container -> ordered sections + chrome shell", () => {
  it("finds main, turns id/section children into sections, keeps chrome in the shell", () => {
    const rehost = splitRehost(sample4());
    expect(rehost).not.toBeNull();
    if (!rehost) return;
    expect(rehost.container).toBe("main#main");
    expect(rehost.sections.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(rehost.sections.map((s) => s.tag)).toEqual(["section", "section", "section"]);
    expect(rehost.sections[0]?.startTag).toContain('id="a"');
    // chrome survives around the markers, section content does not
    expect(rehost.shell).toContain('<a class="skip-link" href="#main">');
    expect(rehost.shell).toContain('<header class="top">');
    expect(rehost.shell).toContain('<div class="ruler" id="ruler"');
    expect(rehost.shell).toContain('<div class="scroll-space" id="space">');
    expect(rehost.shell).toContain("<Section01 />");
    expect(rehost.shell).toContain("<Section02 />");
    expect(rehost.shell).toContain("<Section03 />");
    expect(rehost.shell).not.toContain("First band.");
    expect(rehost.shell).not.toContain('<div class="grid">');
  });

  it("collects loader scripts in captured order; head inline stays in head; styles/scripts leave the shell", () => {
    const rehost = splitRehost(sample4());
    if (!rehost) throw new Error("expected rehost split");
    expect(rehost.headScripts.map((s) => (s.kind === "inline" ? s.js : s.src))).toEqual([
      'if (matchMedia("(prefers-reduced-motion: reduce)").matches) document.documentElement.classList.add("rm");',
    ]);
    expect(rehost.scripts.map((s) => (s.kind === "inline" ? "inline" : s.src))).toEqual([
      "vendor/gsap.min.js",
      "app.js",
      "inline",
    ]);
    expect(rehost.shell).not.toContain("<script>if (matchMedia");
    expect(rehost.shell).not.toContain("<style>");
    // non-JS head data is not page JS and stays in the shell
    expect(rehost.shell).toContain('type="application/ld+json"');
  });

  it("falls back to the legacy generic split when main has no id/section children", () => {
    const html = "<!doctype html><html><body><main><p>plain</p></main></body></html>";
    expect(splitRehost(html)).toBeNull();
    const split = splitBuild(html);
    expect(split.rehost).toBeNull();
    expect(split.sections.sections?.map((s) => s.tag)).toEqual(["main"]);
  });

  it("accepts [role=main] and a single multi-id wrapper as content containers", () => {
    const role = `<!doctype html><html><body><div role="main"><section id="a">A</section><div id="b">B</div></div></body></html>`;
    const roleSplit = splitRehost(role);
    expect(roleSplit?.container).toBe("div");
    expect(roleSplit?.sections.map((s) => s.id)).toEqual(["a", "b"]);

    const wrapper = `<!doctype html><html><body><div id="app"><div id="a">A</div><div id="b">B</div></div><script>window.tail=1</script></body></html>`;
    const wrapped = splitRehost(wrapper);
    expect(wrapped?.container).toBe("div#app");
    expect(wrapped?.sections.map((s) => s.id)).toEqual(["a", "b"]);
    expect(wrapped?.sections).toHaveLength(2);
  });

  it("keeps head + body scripts in captured order, split by location", () => {
    const html = `<!doctype html><html><head><script src="https://cdn.test/gsap.min.js"></script><script>window.boot=1</script></head><body><main id="main"><section id="a">A</section><section id="b">B</section></main><script src="app.js"></script></body></html>`;
    const split = splitRehost(html);
    expect(split?.headScripts.map((s) => (s.kind === "inline" ? s.js : s.src))).toEqual([
      "https://cdn.test/gsap.min.js",
      "window.boot=1",
    ]);
    expect(split?.scripts.map((s) => (s.kind === "inline" ? "inline" : s.src))).toEqual(["app.js"]);
  });

  it("matches role=main exactly (main-navigation is not a content container)", () => {
    const html = `<!doctype html><html><body><nav role="main-navigation"><a href="#x">x</a></nav><div role="main"><section id="a">A</section><section id="b">B</section></div></body></html>`;
    const split = splitRehost(html);
    expect(split?.container).toBe("div");
    expect(split?.sections.map((s) => s.id)).toEqual(["a", "b"]);
  });
});

describe("splitBuild: native rehost css split + warnings", () => {
  it("three sections, tokens/site css split, warnings empty", () => {
    const split = splitBuild(sample4());
    expect(split.sections.detected).toBe("generic");
    expect(split.sections.sections).toHaveLength(3);
    expect(split.rehost).not.toBeNull();
    expect(split.warnings).toEqual([]);
    expect(split.styles.tokensCss).toContain("--ink: rgb(17, 17, 17);");
    expect(split.styles.tokensCss).not.toContain(".layer");
    expect(split.styles.siteCss).toContain(".layer { min-height: 100vh; }");
    expect(split.styles.siteCss).toContain("#b .grid");
    expect(split.styles.siteCss).not.toContain(":root");
  });
});

describe("next: native rehost tree", () => {
  const split = splitBuild(sample4());
  const f = byPath(emitNext(split, "unused", "Native Structure").files);

  it("page is the shell in JSX with SectionNN in place; chrome and marker order kept", () => {
    const page = f["app/page.tsx"] ?? "";
    expect(page).not.toContain('"use client"');
    expect(page).toContain('<a className="skip-link" href="#main">');
    expect(page).toContain('<header className="top">');
    expect(page).toContain('<main id="main">');
    expect(page).toContain('<div className="ruler" id="ruler"');
    const positions = order(page, ["<Section01 />", "<Section02 />", "<Section03 />"]);
    expect(positions.every((p) => p > -1)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(page).not.toContain("First band.");
  });

  it("section components are real JSX: zero raw HTML, zero script tags", () => {
    for (let i = 1; i <= 3; i++) {
      const s = f[`components/Section${String(i).padStart(2, "0")}.tsx`] ?? "";
      expect(s).not.toContain("dangerouslySetInnerHTML");
      expect(s).not.toContain("<script");
      expect(s).not.toContain('class="');
    }
    expect(f["components/Section01.tsx"]).toContain('<h1 className="title">Alpha</h1>');
    expect(f["components/Section02.tsx"]).toContain('<div className="grid"><p>Beta</p></div>');
  });

  it("layout carries document head: title, description, og, favicon, ld+json", () => {
    const layout = f["app/layout.tsx"] ?? "";
    expect(layout).toContain("<title>Native Structure</title>");
    expect(layout).toContain('<meta name="description" content="Native shell fixture" />');
    expect(layout).toContain('<meta property="og:title" content="Native Structure" />');
    expect(layout).toContain('<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml" />');
    expect(layout).toContain('<script type="application/ld+json" dangerouslySetInnerHTML={{ __html:');
    expect(layout).toContain("@type");
    // Next owns charset/viewport; captured copies are deduped
    expect(layout).not.toContain("<meta charset");
    expect(layout).not.toContain('name="viewport"');
  });

  it("head tags go through ATTR_MAP and type-check under a strict JSX stub", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awwwards-bp-headjsx-"));
    try {
      const src = join(dir, "site");
      mkdirSync(src);
      writeFileSync(
        join(src, "index.html"),
        `<!doctype html><html><head>
<link rel="preconnect" href="https://fonts.test" crossorigin>
<link rel="preload" as="font" href="https://fonts.test/f.woff2" type="font/woff2" crossorigin fetchpriority="high">
<link rel="alternate" hreflang="en" href="https://example.test/en">
<meta itemprop="name" content="Head fixture">
<script src="https://cdn.test/a.js" integrity="sha384-x" crossorigin="anonymous" defer referrerpolicy="no-referrer" nomodule></script>
<script nonce="abc" id="boot">window.__boot = 1;</script>
</head><body><main id="main"><section id="a">A</section><section id="b">B</section></main></body></html>`,
      );
      const res = await buildProject({ html: join(src, "index.html"), target: "next", out: join(dir, "out") });
      if ("error" in res) throw new Error(res.error);
      const out = join(dir, "out");
      const layout = readFileSync(join(out, "app", "layout.tsx"), "utf8");
      expect(layout).toContain("crossOrigin");
      expect(layout).toContain('referrerPolicy="no-referrer"');
      expect(layout).toContain("noModule");
      expect(layout).toContain('fetchPriority="high"');
      expect(layout).toContain('hrefLang="en"');
      expect(layout).toContain('itemProp="name"');
      expect(layout).not.toContain("crossorigin");
      expect(layout).not.toContain("referrerpolicy");
      expect(layout).not.toContain("nomodule");
      expect(layout).not.toContain("fetchpriority");
      expect(layout).not.toContain("hreflang");
      expect(layout).not.toContain("itemprop");

      // Strict JSX stub: only real props exist, no permissive index signature.
      // In-process TypeScript program (independent of the build's own tsc run).
      const checkFiles: Record<string, string> = {
        "/app/layout.tsx": layout,
        "/components/SiteScripts.tsx": "export default function SiteScripts() {\n  return null;\n}\n",
        "/react.d.ts": 'declare module "react" {\n  export type ReactNode = unknown;\n}\n',
        "/jsx.d.ts": `type Readonly<T> = T;
interface Function {}
interface IArguments {}
interface NewableFunction {}
interface Number {}
interface Object {}
interface RegExp {}
interface String {}
interface Boolean {}
interface CallableFunction {}
interface Array<T> { readonly length: number; }
interface ReadonlyArray<T> { readonly length: number; }
declare namespace JSX {
  interface Element {}
  interface IntrinsicElements {
    html: { lang?: string; children?: unknown };
    head: { children?: unknown };
    body: { children?: unknown };
    main: { id?: string; children?: unknown };
    section: { id?: string; className?: string; children?: unknown };
    title: { children?: unknown };
    link: { rel?: string; href?: string; type?: string; as?: string; crossOrigin?: string; fetchPriority?: string; hrefLang?: string };
    meta: { name?: string; content?: string; property?: string; charSet?: string; itemProp?: string; itemScope?: boolean; itemType?: string; itemId?: string; itemRef?: string };
    script: {
      src?: string;
      integrity?: string;
      crossOrigin?: string;
      defer?: boolean;
      async?: boolean;
      referrerPolicy?: string;
      noModule?: boolean;
      type?: string;
      nonce?: string;
      id?: string;
      dangerouslySetInnerHTML?: { __html: string };
      children?: unknown;
    };
  }
}
`,
      };
      const options: ts.CompilerOptions = {
        target: ts.ScriptTarget.ES2017,
        strict: true,
        noEmit: true,
        noLib: true,
        skipLibCheck: true,
        jsx: ts.JsxEmit.Preserve,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        types: [],
      };
      const host: ts.CompilerHost = {
        getSourceFile: (name, languageVersion) => {
          const text = checkFiles[ts.normalizePath(name)];
          if (text === undefined) return undefined;
          return ts.createSourceFile(
            name,
            text,
            languageVersion,
            true,
            name.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
          );
        },
        getDefaultLibFileName: () => "/lib.d.ts",
        writeFile: () => {},
        getCurrentDirectory: () => "/",
        getDirectories: () => [],
        fileExists: (name) => checkFiles[ts.normalizePath(name)] !== undefined,
        readFile: (name) => checkFiles[ts.normalizePath(name)],
        getCanonicalFileName: (name) => name,
        useCaseSensitiveFileNames: () => true,
        getNewLine: () => "\n",
      };
      const program = ts.createProgram(Object.keys(checkFiles), options, host);
      const messages = ts.getPreEmitDiagnostics(program).map((d) => {
        const where = d.file?.fileName ?? "ts";
        return `${where}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`;
      });
      expect(messages).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("one SiteScripts loader appends body scripts in captured order; head boot stays in head", () => {
    const loader = f["components/SiteScripts.tsx"] ?? "";
    expect(loader.startsWith('"use client";')).toBe(true);
    expect(loader).toContain("useEffect");
    expect(loader).toContain("return () => {");
    expect(loader).toContain("el.remove()");
    expect(loader).toContain('document.querySelectorAll("script[data-site-scripts]")');
    expect(loader).not.toContain("prefers-reduced-motion");
    const [gsap, app, tail] = order(loader, [
      "/scripts/vendor/gsap.min.js",
      "/scripts/app.js",
      "__order",
    ]);
    expect(gsap).toBeGreaterThan(-1);
    expect(app).toBeGreaterThan(gsap);
    expect(tail).toBeGreaterThan(app);
    const layout = f["app/layout.tsx"] ?? "";
    expect(layout).toContain("prefers-reduced-motion");
    expect(layout.indexOf("prefers-reduced-motion")).toBeLessThan(layout.indexOf("</head>"));
    expect(layout).toContain("<SiteScripts />");
  });

  it("StrictMode remount + navigation re-run: DOM-driven loader, no module guard, module type kept", async () => {
    const loader = f["components/SiteScripts.tsx"] ?? "";
    expect(loader).not.toContain("let started");
    const block = loader
      .slice(loader.indexOf("// --- site-loader:start"), loader.indexOf("// --- site-loader:end"))
      .replace(/const SCRIPTS: Array<\{[^}]*\}> =/, "const SCRIPTS =");
    const mount = new Function("document", `${block}\nreturn mountSiteScripts();`) as (doc: unknown) => () => void;

    type FakeScript = {
      src: string;
      type: string;
      textContent: string;
      onload?: () => void;
      onerror?: () => void;
      attrs: Record<string, string>;
      removed: boolean;
      loaded?: boolean;
      setAttribute: (k: string, v: string) => void;
      remove: () => void;
    };
    const fakeDocument = () => {
      const scripts: FakeScript[] = [];
      const document = {
        body: {
          appendChild: (el: FakeScript) => {
            scripts.push(el);
          },
        },
        createElement: () => {
          const el = {
            src: "",
            type: "",
            textContent: "",
            attrs: {} as Record<string, string>,
            removed: false,
            setAttribute(k: string, v: string) {
              el.attrs[k] = v;
            },
            remove() {
              el.removed = true;
              const i = scripts.indexOf(el);
              if (i >= 0) scripts.splice(i, 1);
            },
          };
          return el;
        },
        querySelectorAll: () => scripts.slice(),
      };
      return { document, scripts };
    };
    const drive = async (doc: ReturnType<typeof fakeDocument>, total: number) => {
      for (let i = 0; i < 200 && doc.scripts.length < total; i++) {
        const last = doc.scripts[doc.scripts.length - 1];
        if (last && last.onload && !last.loaded) {
          last.loaded = true;
          last.onload();
        }
        await Promise.resolve();
      }
    };
    const orderOf = (scripts: FakeScript[]) => scripts.map((s) => s.src || s.textContent);

    const doc = fakeDocument();
    const cleanup = mount(doc.document);
    expect(doc.scripts).toHaveLength(1);
    await drive(doc, 3);
    expect(orderOf(doc.scripts)).toEqual([
      "/scripts/vendor/gsap.min.js",
      "/scripts/app.js",
      'window.__order = (window.__order || []).concat("nativeTail");',
    ]);
    // sequential: exactly one pending external until its onload fires
    expect(doc.scripts.every((s) => s.attrs["data-site-scripts"] === "")).toBe(true);

    cleanup();
    expect(doc.scripts).toEqual([]);
    // StrictMode simulated unmount -> remount: DOM cleared, full sequence re-runs
    const cleanup2 = mount(doc.document);
    await drive(doc, 3);
    expect(orderOf(doc.scripts)).toEqual([
      "/scripts/vendor/gsap.min.js",
      "/scripts/app.js",
      'window.__order = (window.__order || []).concat("nativeTail");',
    ]);
    cleanup2();
    expect(doc.scripts).toEqual([]);

    const moduleHtml = `<!doctype html><html><body><main id="main"><section id="a">A</section><section id="b">B</section></main><script type="module">window.__m = 1;</script></body></html>`;
    const moduleLoader = byPath(emitNext(splitBuild(moduleHtml), "unused", "x").files)["components/SiteScripts.tsx"] ?? "";
    expect(moduleLoader).toContain('type: "module"');
    const moduleBlock = moduleLoader
      .slice(
        moduleLoader.indexOf("// --- site-loader:start"),
        moduleLoader.indexOf("// --- site-loader:end"),
      )
      .replace(/const SCRIPTS: Array<\{[^}]*\}> =/, "const SCRIPTS =");
    const moduleMount = new Function("document", `${moduleBlock}\nreturn mountSiteScripts();`) as (
      doc: unknown,
    ) => () => void;
    const moduleDoc = fakeDocument();
    const moduleCleanup = moduleMount(moduleDoc.document);
    await drive(moduleDoc, 1);
    expect(moduleDoc.scripts[0]?.type).toBe("module");
    moduleCleanup();
  });

  it("emits a typed SCRIPTS array even when the page has zero scripts", () => {
    const html = `<!doctype html><html><body><main id="main"><section id="a">A</section><section id="b">B</section></main></body></html>`;
    const loader = byPath(emitNext(splitBuild(html), "unused", "x").files)["components/SiteScripts.tsx"] ?? "";
    expect(loader).toContain("const SCRIPTS: Array<{ src: string; js: string; type: string }> = [");
    expect(loader).not.toContain("const added");
  });

  it("tokens.css + site.css imported once from the layout; ordered css kept", () => {
    expect(f["styles/tokens.css"]).toContain("--ink: rgb(17, 17, 17);");
    expect(f["styles/site.css"]).toContain(".layer { min-height: 100vh; }");
    expect(f["styles/site.css"]).not.toContain(":root");
    const layout = f["app/layout.tsx"] ?? "";
    const [tokens, site] = order(layout, ['import "../styles/tokens.css";', 'import "../styles/site.css";']);
    expect(tokens).toBeGreaterThan(-1);
    expect(site).toBeGreaterThan(tokens);
    expect(layout.split('import "../styles/site.css";').length - 1).toBe(1);
  });
});

describe("astro: native rehost tree", () => {
  const split = splitBuild(sample4());
  const f = byPath(emitAstro(split, "unused", "Native Structure").files);

  it("page is the shell with imports and Section markers; components hold verbatim HTML", () => {
    const page = f["src/pages/index.astro"] ?? "";
    expect(page).toContain('import Section01 from "../components/Section01.astro";');
    expect(page).toContain("<Section01 />");
    expect(page).toContain('<header class="top">');
    expect(page).toContain('<div class="ruler" id="ruler"');
    expect(page).toContain('<link rel="stylesheet" href="styles.css">');
    const section = f["src/components/Section01.astro"] ?? "";
    expect(section).toContain('<section class="layer is-first" id="a"');
    expect(section).toContain('<h1 class="title">Alpha</h1>');
    expect(section).not.toContain("<script");
  });

  it("one ordered is:inline loader sequence; head boot stays in head; no script tags in sections", () => {
    const page = f["src/pages/index.astro"] ?? "";
    expect(page).toMatch(/<script is:inline[^>]*>if \(matchMedia/);
    expect(page.indexOf("prefers-reduced-motion")).toBeLessThan(page.indexOf("</head>"));
    const [boot, gsap, app, tail] = order(page, [
      "prefers-reduced-motion",
      'is:inline src="/scripts/vendor/gsap.min.js"',
      'is:inline src="/scripts/app.js"',
      "__order",
    ]);
    expect(boot).toBeGreaterThan(-1);
    expect(gsap).toBeGreaterThan(boot);
    expect(app).toBeGreaterThan(gsap);
    expect(tail).toBeGreaterThan(app);
    expect(page.slice(page.indexOf("</head>"))).not.toContain("prefers-reduced-motion");
    // inline body JS stays byte-exact: no indentation injected into the script
    expect(page).toContain('<script is:inline>window.__order = (window.__order || []).concat("nativeTail");</script>');
    for (let i = 1; i <= 3; i++) {
      const s = f[`src/components/Section${String(i).padStart(2, "0")}.astro`] ?? "";
      expect(s).not.toContain("<script");
    }
  });

  it("tokens + site css imported once", () => {
    const page = f["src/pages/index.astro"] ?? "";
    const [tokens, site] = order(page, ['import "../styles/tokens.css";', 'import "../styles/site.css";']);
    expect(tokens).toBeGreaterThan(-1);
    expect(site).toBeGreaterThan(tokens);
    expect(f["src/styles/tokens.css"]).toContain("--ink");
    expect(f["src/styles/site.css"]).toContain(".layer");
  });
});

describe("vite: native rehost tree", () => {
  const split = splitBuild(sample4());
  const f = byPath(emitVite(split, "unused", "Native Structure").files);

  it("index.html keeps the shell + inline section markup, chrome intact", () => {
    const index = f["index.html"] ?? "";
    expect(index).toContain('<header class="top">');
    expect(index).toContain('<main id="main">');
    expect(index).toContain('<section class="layer is-first" id="a"');
    expect(index).toContain('<h1 class="title">Alpha</h1>');
    expect(index).toContain('<div class="ruler" id="ruler"');
    expect(index).not.toContain("<Section01 />");
  });

  it("ordered classic script tags point at src/scripts; module main.js only imports css", () => {
    const index = f["index.html"] ?? "";
    const [boot, gsap, app, tail, main] = order(index, [
      "prefers-reduced-motion",
      'src="/src/scripts/vendor/gsap.min.js"',
      'src="/src/scripts/app.js"',
      "__order",
      'type="module" src="/src/main.js"',
    ]);
    expect(boot).toBeGreaterThan(-1);
    expect(gsap).toBeGreaterThan(boot);
    expect(app).toBeGreaterThan(gsap);
    expect(tail).toBeGreaterThan(app);
    expect(main).toBeGreaterThan(tail);
    expect(index.indexOf("prefers-reduced-motion")).toBeLessThan(index.indexOf("</head>"));
    const js = f["src/main.js"] ?? "";
    expect(js).toContain('import "./styles/tokens.css";');
    expect(js).toContain('import "./styles/site.css";');
    expect(js).not.toContain("__order");
    expect(f["src/styles/site.css"]).not.toContain(":root");
    // built copy: the captured /src/scripts URLs must resolve from dist
    expect(f["vite.config.js"]).toContain('cpSync("src/scripts", "dist/src/scripts"');
  });
});

describe("head scripts keep captured order in <head> (not the loader)", () => {
  const html = `<!doctype html><html><head>
<script src="https://cdn.test/gsap.min.js"></script>
<script nonce="abc" id="boot">gsap.registerPlugin(ScrollTrigger);</script>
</head><body>
<main id="main"><section id="a">A</section><section id="b">B</section></main>
<script src="app.js"></script>
<script>window.__tail = 1;</script>
</body></html>`;
  const headOrder = (text: string): number[] =>
    order(text, ["https://cdn.test/gsap.min.js", "gsap.registerPlugin(ScrollTrigger);"]);
  const assertHead = (text: string) => {
    const [cdn, inline] = headOrder(text);
    expect(cdn).toBeGreaterThan(-1);
    expect(inline).toBeGreaterThan(cdn);
    expect(inline).toBeLessThan(text.indexOf("</head>"));
  };

  it("keeps a data script between executable head scripts in every target", () => {
    const mixed = `<!doctype html><html><head>
<script src="https://cdn.test/first.js"></script>
<script type="application/ld+json">{"@type":"Thing","name":"Between"}</script>
<script src="https://cdn.test/second.js"></script>
</head><body><main id="main"><section id="a">A</section><section id="b">B</section></main><script src="app.js"></script></body></html>`;
    const orderOf = (text: string) =>
      order(text, ["https://cdn.test/first.js", "application/ld+json", "https://cdn.test/second.js"]);
    const assertBetween = (text: string) => {
      const [first, data, second] = orderOf(text);
      expect(first).toBeGreaterThan(-1);
      expect(data).toBeGreaterThan(first);
      expect(second).toBeGreaterThan(data);
      expect(text).toContain("Between");
    };
    const next = byPath(emitNext(splitBuild(mixed), "unused", "x").files);
    assertBetween(next["app/layout.tsx"] ?? "");
    const astro = byPath(emitAstro(splitBuild(mixed), "unused", "x").files);
    assertBetween(astro["src/pages/index.astro"] ?? "");
    const vite = byPath(emitVite(splitBuild(mixed), "unused", "x").files);
    assertBetween(vite["index.html"] ?? "");
  });

  it("next: layout head cdn -> inline; SiteScripts only body scripts", () => {
    const f = byPath(emitNext(splitBuild(html), "unused", "x").files);
    const layout = f["app/layout.tsx"] ?? "";
    assertHead(layout);
    expect(layout).toContain('nonce="abc"');
    expect(layout).toContain('id="boot"');
    const loader = f["components/SiteScripts.tsx"] ?? "";
    expect(loader).not.toContain("gsap.registerPlugin");
    expect(loader).not.toContain("cdn.test");
    expect(order(loader, ["/scripts/app.js", "__tail"])).toEqual([
      loader.indexOf("/scripts/app.js"),
      loader.indexOf("__tail"),
    ].sort((a, b) => a - b));
  });

  it("astro: head is:inline cdn -> inline; body loader unchanged", () => {
    const page = byPath(emitAstro(splitBuild(html), "unused", "x").files)["src/pages/index.astro"] ?? "";
    assertHead(page);
    expect(page).toContain('nonce="abc"');
    expect(page).toContain('id="boot"');
    expect(order(page, ['/scripts/app.js', "__tail"])).toEqual([
      page.indexOf("/scripts/app.js"),
      page.indexOf("__tail"),
    ].sort((a, b) => a - b));
  });

  it("vite: head cdn -> inline; body loader unchanged", () => {
    const index = byPath(emitVite(splitBuild(html), "unused", "x").files)["index.html"] ?? "";
    assertHead(index);
    expect(index).toContain('nonce="abc"');
    expect(index).toContain('id="boot"');
    expect(order(index, ['/src/scripts/app.js', "__tail"])).toEqual([
      index.indexOf("/src/scripts/app.js"),
      index.indexOf("__tail"),
    ].sort((a, b) => a - b));
  });
});

describe("buildProject: local stylesheet folding + css url rebasing", () => {
  it("folds local links in source order, extracts :root, drops the link, rebases urls", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awwwards-bp-cssfold-"));
    try {
      mkdirSync(join(dir, "images"));
      writeFileSync(join(dir, "images", "one.png"), "one");
      writeFileSync(join(dir, "images", "inline.png"), "inline");
      writeFileSync(
        join(dir, "a.css"),
        ':root { --a: 1px; }\nbody { margin: 0; }\n.a { background: url(images/one.png); }\n',
      );
      writeFileSync(join(dir, "b.css"), ".b { color: red; }\n");
      writeFileSync(
        join(dir, "index.html"),
        `<!doctype html><html><head>
<link rel="stylesheet" href="a.css">
<link rel="stylesheet" href="b.css">
<link rel="stylesheet" href="https://cdn.test/remote.css">
<style>.c { background: url(images/inline.png); }</style>
</head><body><main id="main"><section id="a">A</section><section id="b">B</section></main></body></html>`,
      );
      for (const target of ["next", "vite"] as const) {
        const out = join(dir, target);
        const res = await buildProject({ html: join(dir, "index.html"), target, out });
        if ("error" in res) throw new Error(res.error);
        expect(res.warnings).toEqual([]);
        const stylesRoot = target === "next" ? join(out, "styles") : join(out, "src", "styles");
        const tokens = readFileSync(join(stylesRoot, "tokens.css"), "utf8");
        const site = readFileSync(join(stylesRoot, "site.css"), "utf8");
        expect(tokens).toContain("--a: 1px;");
        expect(site).toContain("body { margin: 0; }");
        expect(site.indexOf("body { margin: 0; }")).toBeLessThan(site.indexOf(".b { color: red; }"));
        const prefix = target === "next" ? "/" : "../../";
        expect(site).toContain(`url(${prefix}images/one.png)`);
        expect(site).toContain(`url(${prefix}images/inline.png)`);
        const head = target === "next"
          ? readFileSync(join(out, "app", "layout.tsx"), "utf8")
          : readFileSync(join(out, "index.html"), "utf8");
        expect(head).toContain("https://cdn.test/remote.css");
        expect(head).not.toContain('href="/a.css"');
        expect(head).not.toContain('href="a.css"');
        const publicRoot = target === "next" ? join(out, "public") : out;
        expect(existsSync(join(publicRoot, "images", "one.png"))).toBe(true);
        expect(existsSync(join(publicRoot, "images", "inline.png"))).toBe(true);
        expect(existsSync(join(publicRoot, "a.css"))).toBe(false);
        expect(existsSync(join(publicRoot, "b.css"))).toBe(false);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("refuses ../ stylesheet folds and neutralizes </style in embedded CSS", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awwwards-bp-csssafe-"));
    try {
      const site = join(dir, "site");
      mkdirSync(site);
      writeFileSync(join(dir, "secret.css"), ".secret { color: red; }\n");
      writeFileSync(
        join(site, "index.html"),
        `<!doctype html><html><head>
<link rel="stylesheet" href="../secret.css">
<link rel="stylesheet" href="https://cdn.test/../remote.css">
</head><body><main id="main"><section id="a">A</section><section id="b">B</section></main></body></html>`,
      );
      const res = await buildProject({ html: join(site, "index.html"), target: "next", out: join(site, "out") });
      if ("error" in res) throw new Error(res.error);
      expect(res.warnings.some((w) => w.includes("unsafe path"))).toBe(true);
      expect(res.warnings.some((w) => w.includes("https://cdn.test/../remote.css"))).toBe(false);
      const layout = readFileSync(join(site, "out", "app", "layout.tsx"), "utf8");
      expect(layout).not.toContain("secret { color: red");
      expect(layout).not.toContain("secret.css");
      expect(layout).toContain("https://cdn.test/../remote.css");
      expect(existsSync(join(site, "out", "public", "secret.css"))).toBe(false);

      writeFileSync(join(site, "a.css"), '.x { content: "</style>"; }\n');
      writeFileSync(
        join(site, "safe.html"),
        `<!doctype html><html><head><link rel="stylesheet" href="a.css"></head><body><main id="main"><section id="a">A</section><section id="b">B</section></main></body></html>`,
      );
      const safe = await buildProject({ html: join(site, "safe.html"), target: "next", out: join(site, "safe-out") });
      if ("error" in safe) throw new Error(safe.error);
      const siteCss = readFileSync(join(site, "safe-out", "styles", "site.css"), "utf8");
      expect(siteCss).toContain("<\\/style");
      expect(siteCss).not.toContain("</style");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("folds nested local @imports once and guards cycles", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awwwards-bp-cssimport-"));
    try {
      writeFileSync(join(dir, "a.css"), '@import "b.css";\n.a { color: red; }\n');
      writeFileSync(join(dir, "b.css"), '@import "c.css";\n.b { color: blue; }\n');
      writeFileSync(join(dir, "c.css"), ".c { color: green; }\n");
      writeFileSync(
        join(dir, "index.html"),
        `<!doctype html><html><head><link rel="stylesheet" href="a.css"></head><body><main id="main"><section id="a">A</section><section id="b">B</section></main></body></html>`,
      );
      const res = await buildProject({ html: join(dir, "index.html"), target: "next", out: join(dir, "out") });
      if ("error" in res) throw new Error(res.error);
      expect(res.warnings).toEqual([]);
      const site = readFileSync(join(dir, "out", "styles", "site.css"), "utf8");
      expect(site.split(".c { color: green; }").length - 1).toBe(1);
      expect(site.split(".b { color: blue; }").length - 1).toBe(1);
      expect(site.split(".a { color: red; }").length - 1).toBe(1);
      expect(site.indexOf(".c {")).toBeLessThan(site.indexOf(".b {"));
      expect(site.indexOf(".b {")).toBeLessThan(site.indexOf(".a {"));

      writeFileSync(join(dir, "cyc-a.css"), '@import "cyc-b.css";\n.cyc-a { color: red; }\n');
      writeFileSync(join(dir, "cyc-b.css"), '@import "cyc-a.css";\n.cyc-b { color: blue; }\n');
      writeFileSync(
        join(dir, "cycle.html"),
        `<!doctype html><html><head><link rel="stylesheet" href="cyc-a.css"></head><body><main id="main"><section id="a">A</section><section id="b">B</section></main></body></html>`,
      );
      const cycle = await buildProject({ html: join(dir, "cycle.html"), target: "next", out: join(dir, "cycle-out") });
      if ("error" in cycle) throw new Error(cycle.error);
      expect(cycle.warnings.some((w) => w.includes("cycle"))).toBe(true);
      const cycleCss = readFileSync(join(dir, "cycle-out", "styles", "site.css"), "utf8");
      expect(cycleCss.split(".cyc-a {").length - 1).toBe(1);
      expect(cycleCss.split(".cyc-b {").length - 1).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("hoists a late local @import to the top with a warning", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awwwards-bp-csslate-"));
    try {
      writeFileSync(join(dir, "a.css"), 'body { margin: 0; }\n@import "b.css";\n');
      writeFileSync(join(dir, "b.css"), ".b { color: blue; }\n");
      writeFileSync(
        join(dir, "index.html"),
        `<!doctype html><html><head><link rel="stylesheet" href="a.css"></head><body><main id="main"><section id="a">A</section><section id="b">B</section></main></body></html>`,
      );
      const res = await buildProject({ html: join(dir, "index.html"), target: "next", out: join(dir, "out") });
      if ("error" in res) throw new Error(res.error);
      expect(res.warnings.some((w) => w.includes("late CSS @import hoisted"))).toBe(true);
      const site = readFileSync(join(dir, "out", "styles", "site.css"), "utf8");
      expect(site.indexOf(".b {")).toBeGreaterThan(-1);
      expect(site.indexOf(".b {")).toBeLessThan(site.indexOf("body {"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("warns and drops a missing local @import", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awwwards-bp-cssmiss-"));
    try {
      writeFileSync(join(dir, "a.css"), '@import "gone.css";\nbody { margin: 0; }\n');
      writeFileSync(
        join(dir, "index.html"),
        `<!doctype html><html><head><link rel="stylesheet" href="a.css"></head><body><main id="main"><section id="a">A</section><section id="b">B</section></main></body></html>`,
      );
      const res = await buildProject({ html: join(dir, "index.html"), target: "next", out: join(dir, "out") });
      if ("error" in res) throw new Error(res.error);
      expect(res.warnings.some((w) => w.includes("not found") && w.includes("gone.css"))).toBe(true);
      const site = readFileSync(join(dir, "out", "styles", "site.css"), "utf8");
      expect(site).toContain("body { margin: 0; }");
      expect(site).not.toContain("gone.css");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not resurrect an @import inside a CSS comment", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awwwards-bp-csscomment-"));
    try {
      writeFileSync(join(dir, "b.css"), ".b { color: blue; }\n");
      writeFileSync(
        join(dir, "index.html"),
        `<!doctype html><html><head><style>/* @import "b.css"; */\n.x { color: red; content: "/* keep */"; }</style></head><body><main id="main"><section id="a">A</section><section id="b">B</section></main></body></html>`,
      );
      const res = await buildProject({ html: join(dir, "index.html"), target: "next", out: join(dir, "out") });
      if ("error" in res) throw new Error(res.error);
      expect(res.warnings).toEqual([]);
      const site = readFileSync(join(dir, "out", "styles", "site.css"), "utf8");
      expect(site).toContain('.x { color: red; content: "/* keep */"; }');
      expect(site).not.toContain(".b { color: blue; }");
      expect(site).not.toContain("@import");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("preserves @import layer()/supports() semantics", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awwwards-bp-csscond-"));
    try {
      writeFileSync(join(dir, "b.css"), ".b { display: grid; }\n");
      writeFileSync(
        join(dir, "a.css"),
        '@import "b.css" layer(base) supports(display: grid);\n.a { color: red; }\n',
      );
      writeFileSync(
        join(dir, "index.html"),
        `<!doctype html><html><head><link rel="stylesheet" href="a.css"></head><body><main id="main"><section id="a">A</section><section id="b">B</section></main></body></html>`,
      );
      const res = await buildProject({ html: join(dir, "index.html"), target: "next", out: join(dir, "out") });
      if ("error" in res) throw new Error(res.error);
      expect(res.warnings).toEqual([]);
      const site = readFileSync(join(dir, "out", "styles", "site.css"), "utf8");
      expect(site).toContain("@layer base");
      expect(site).toContain("@supports (display: grid)");
      expect(site.indexOf("@layer base")).toBeLessThan(site.indexOf("@supports (display: grid)"));
      expect(site.indexOf("@supports (display: grid)")).toBeLessThan(site.indexOf(".b { display: grid; }"));

      writeFileSync(join(dir, "nested.css"), '@import "b.css" supports(not (display: grid));\n.n { color: blue; }\n');
      writeFileSync(
        join(dir, "nested.html"),
        `<!doctype html><html><head><link rel="stylesheet" href="nested.css"></head><body><main id="main"><section id="a">A</section><section id="b">B</section></main></body></html>`,
      );
      const nested = await buildProject({ html: join(dir, "nested.html"), target: "next", out: join(dir, "nested-out") });
      if ("error" in nested) throw new Error(nested.error);
      expect(nested.warnings).toEqual([]);
      const nestedCss = readFileSync(join(dir, "nested-out", "styles", "site.css"), "utf8");
      expect(nestedCss).toContain("@supports (not (display: grid))");
      expect(nestedCss).toContain(".b { display: grid; }");
      expect(nestedCss).not.toContain("@media (display: grid)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("folds an inline <style>@import and copies its assets", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awwwards-bp-cssinline-"));
    try {
      mkdirSync(join(dir, "images"));
      writeFileSync(join(dir, "images", "b.png"), "b");
      writeFileSync(join(dir, "b.css"), ".b { background: url(images/b.png); }\n");
      writeFileSync(
        join(dir, "index.html"),
        `<!doctype html><html><head><style>@import "b.css";\n.x { color: red; }</style></head><body><main id="main"><section id="a">A</section><section id="b">B</section></main></body></html>`,
      );
      const res = await buildProject({ html: join(dir, "index.html"), target: "next", out: join(dir, "out") });
      if ("error" in res) throw new Error(res.error);
      expect(res.warnings).toEqual([]);
      const site = readFileSync(join(dir, "out", "styles", "site.css"), "utf8");
      expect(site).toContain(".b { background: url(/images/b.png); }");
      expect(site).toContain(".x { color: red; }");
      expect(existsSync(join(dir, "out", "public", "images", "b.png"))).toBe(true);
      expect(site).not.toContain("@import");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("buildProject: rehost scripts move to the target script dir", () => {
  it("next/astro public/scripts and vite src/scripts, no warnings", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awwwards-bp-native-"));
    try {
      for (const target of ["vite", "astro", "next"] as const) {
        const out = join(dir, target);
        const res = await buildProject({ html: join(FIXTURES, "sample4.html"), target, out });
        if ("error" in res) throw new Error(res.error);
        expect(res.warnings).toEqual([]);
        const scriptRoot = target === "vite" ? join(out, "src", "scripts") : join(out, "public", "scripts");
        expect(existsSync(join(scriptRoot, "vendor", "gsap.min.js"))).toBe(true);
        expect(existsSync(join(scriptRoot, "app.js"))).toBe(true);
        expect(readFileSync(join(scriptRoot, "app.js"), "utf8")).toContain("__order");
        // moved, not duplicated: the original script paths stay empty
        const originalRoot = target === "vite" ? out : join(out, "public");
        expect(existsSync(join(originalRoot, "vendor", "gsap.min.js"))).toBe(false);
        expect(existsSync(join(originalRoot, "app.js"))).toBe(false);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("JSX fallback: template braces keep a raw path + warning", () => {
  it("a mustache section ships as opaque HTML with a warning, other sections stay JSX", () => {
    const html = `<!doctype html><html><body><main id="main">
      <section id="a"><h1>{{ title }}</h1></section>
      <section id="b"><p>plain</p></section>
    </main></body></html>`;
    const split = splitBuild(html);
    const emitted = emitNext(split, "unused", "x");
    const f = byPath(emitted.files);
    const risky = f["components/Section01.tsx"] ?? "";
    expect(risky).toContain("dangerouslySetInnerHTML");
    expect(f["components/Section02.tsx"]).not.toContain("dangerouslySetInnerHTML");
    expect(emitted.warnings.some((w) => w.includes("mustache"))).toBe(true);
    // emitters are pure: the split model is never mutated
    expect(split.warnings).toEqual([]);
  });

  it("CSS custom properties convert to quoted keys + React.CSSProperties cast, no raw fallback", () => {
    const html = `<!doctype html><html><body><main id="main">
      <section id="a"><div style="--x: 9%; --y: 21%; color: red">A</div></section>
      <section id="b"><p>plain</p></section>
    </main></body></html>`;
    const split = splitBuild(html);
    const emitted = emitNext(split, "unused", "x");
    const f = byPath(emitted.files);
    const s1 = f["components/Section01.tsx"] ?? "";
    expect(s1).not.toContain("dangerouslySetInnerHTML");
    expect(s1).toContain('style={{ "--x": "9%", "--y": "21%", color: "red" } as React.CSSProperties}');
    expect(s1.startsWith('// Section01')).toBe(true);
    expect(s1).toContain('import type React from "react";');
    expect(f["components/Section02.tsx"]).not.toContain("dangerouslySetInnerHTML");
    expect(emitted.warnings).toEqual([]);
  });

  it("custom properties on a section ROOT and on page shell chrome also cast cleanly", () => {
    const html = `<!doctype html><html><body><header style="--brand: 2px"><b>Chrome</b></header><main id="main">
      <section id="a" style="--x: 9%"><p>A</p></section>
      <section id="b"><p>B</p></section>
    </main></body></html>`;
    const split = splitBuild(html);
    const f = byPath(emitNext(split, "unused", "x").files);
    expect(f["components/Section01.tsx"]).toContain('as React.CSSProperties');
    expect(f["components/Section01.tsx"]).toContain('import type React from "react";');
    expect(f["app/page.tsx"]).toContain('"--brand": "2px"');
    expect(f["app/page.tsx"]).toContain('as React.CSSProperties');
    expect(f["app/page.tsx"]).toContain('import type React from "react";');
  });
});
