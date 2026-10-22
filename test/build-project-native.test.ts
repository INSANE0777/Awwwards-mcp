import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    expect(rehost.headInline.map((s) => s.js)).toEqual([
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

  it("keeps CDN externals in captured document order", () => {
    const html = `<!doctype html><html><head><script src="https://cdn.test/gsap.min.js"></script><script>window.boot=1</script></head><body><main id="main"><section id="a">A</section><section id="b">B</section></main><script src="app.js"></script></body></html>`;
    const split = splitRehost(html);
    expect(split?.headInline.map((s) => s.js)).toEqual(["window.boot=1"]);
    expect(split?.scripts.map((s) => (s.kind === "inline" ? "inline" : s.src))).toEqual([
      "https://cdn.test/gsap.min.js",
      "app.js",
    ]);
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
    const block = loader.slice(loader.indexOf("// --- site-loader:start"), loader.indexOf("// --- site-loader:end"));
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
        querySelectorAll: () => scripts,
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
    const moduleBlock = moduleLoader.slice(
      moduleLoader.indexOf("// --- site-loader:start"),
      moduleLoader.indexOf("// --- site-loader:end"),
    );
    const moduleMount = new Function("document", `${moduleBlock}\nreturn mountSiteScripts();`) as (
      doc: unknown,
    ) => () => void;
    const moduleDoc = fakeDocument();
    const moduleCleanup = moduleMount(moduleDoc.document);
    await drive(moduleDoc, 1);
    expect(moduleDoc.scripts[0]?.type).toBe("module");
    moduleCleanup();
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
