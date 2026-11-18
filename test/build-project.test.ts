import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";
import {
  FULL_BODY_WARNING,
  headBounds,
  buildProject,
  bodyBounds,
  copyAssets,
  emitAstro,
  emitVite,
  extractScripts,
  isLocalRef,
  parseBuildArgs,
  parseRebuildSections,
  readDocumentAttrs,
  splitBuild,
  splitStyles,
} from "../src/build-project.js";
import { emitNext } from "../src/emit-next.js";
import { buildMotionManifest } from "../src/motion-manifest.js";

const FIXTURES = join(__dirname, "fixtures", "build-project");
const sample = () => readFileSync(join(FIXTURES, "sample.html"), "utf8");
const sample2 = () => readFileSync(join(FIXTURES, "sample2.html"), "utf8");
const sample3 = () => readFileSync(join(FIXTURES, "sample3.html"), "utf8");

// Real-shape variant: band roots may be divs (full-page.mjs renumbering keeps
// class="c-N" on whatever tag the pack root was captured as).
const divRoots = `<!doctype html><html><body>
<!-- band 1: ok -->
<div class="c-0"><p class="c-1">one</p></div>
<div class="c-150"><p class="c-151">two</p></div>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
</body></html>`;

const genericHtml = `<!doctype html>
<html>
<head>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=X&display=swap">
<style>.hero { color: red; } p { margin: 0; }</style>
</head>
<body>
<header class="hero"><h1>Hey</h1></header>
<main><p>Body copy</p></main>
<footer><small>fine print</small></footer>
<script>document.querySelectorAll("h1").forEach(() => {});</script>
</body>
</html>`;

const viteByName = (html: string, name = "Neu Omni 2") => emitVite(splitBuild(html), "unused", name).files;
const astroByName = (html: string, name = "Neu Omni 2") => emitAstro(splitBuild(html), "unused", name).files;
const byPath = (files: Array<{ path: string; content: string }>) =>
  Object.fromEntries(files.map((f) => [f.path, f.content]));

describe("parseRebuildSections", () => {
  it("detects the rebuild shape: ordered roots, verbatim fields, div roots included", () => {
    const parsed = parseRebuildSections(divRoots);
    expect(parsed.detected).toBe("rebuild");
    expect(parsed.sections?.map((s) => s.className)).toEqual(["c-0", "c-150"]);
    expect(parsed.sections?.map((s) => s.tag)).toEqual(["div", "div"]);
    expect(parsed.sections?.[0]?.startTag).toBe('<div class="c-0">');
    expect(parsed.sections?.[0]?.innerHtml).toBe('<p class="c-1">one</p>');
    expect(parsed.sections?.[0]?.text).toBe('<div class="c-0"><p class="c-1">one</p></div>');
    expect(parsed.sections?.[2]).toBeUndefined(); // trailing script never a section
  });

  it("fixture: 3 section roots in order; text === startTag+inner+close verbatim; nested section survives", () => {
    const parsed = parseRebuildSections(sample());
    expect(parsed.detected).toBe("rebuild");
    expect(parsed.sections?.map((s) => s.className)).toEqual(["c-0", "c-12", "c-23"]);
    const s2 = parsed.sections?.[1];
    expect(s2?.startTag).toBe('<section class="c-12">');
    expect(s2?.closeTag).toBe("</section>");
    expect(s2?.text).toBe((s2?.startTag ?? "") + (s2?.innerHtml ?? "") + (s2?.closeTag ?? ""));
    expect(s2?.innerHtml).toContain('<section class="c-15">');
    expect(s2?.innerHtml).toContain("nested keeps depth honest");
  });

  it("skips top-level comments and the trailing script", () => {
    const parsed = parseRebuildSections(sample());
    expect(parsed.sections?.every((s) => s.tag !== "script")).toBe(true);
    expect(parsed.sections?.[0]?.text).not.toContain("attests");
  });

  it("generic fallback: top-level section/header/footer/main tags, any classes", () => {
    const parsed = parseRebuildSections(genericHtml);
    expect(parsed.detected).toBe("generic");
    expect(parsed.sections?.map((s) => s.tag)).toEqual(["header", "main", "footer"]);
    expect(parsed.sections?.[0]?.className).toBe("hero");
  });

  it("no candidate roots at all -> sections null, detected generic", () => {
    const parsed = parseRebuildSections("<!doctype html><html><body><p>solo</p></body></html>");
    expect(parsed.detected).toBe("generic");
    expect(parsed.sections).toBeNull();
  });
});

describe("splitStyles", () => {
  it("hoists :root token blocks verbatim out of the rule stream", () => {
    const styles = splitStyles(sample());
    expect(styles.tokensCss).toContain("--c-1: rgb(20, 20, 20);");
    expect(styles.tokensCss).toContain("--fs-1: 16px;");
    expect(styles.sharedCss).not.toContain("--sp-1");
  });

  it("buckets rules by section class without substring confusion", () => {
    const styles = splitStyles(sample());
    expect(styles.perSection.get("c-0")).toBe(
      ".c-0 { position: relative; display: flex; flex-direction: column; gap: var(--sp-1); }",
    );
    expect(styles.perSection.get("c-12")).toContain(".c-12 { display: grid; }");
    expect(styles.perSection.get("c-12")).toContain(".c-12 .c-13 { font-size: var(--fs-1); }");
    expect(styles.perSection.get("c-12")).toContain(".c-12 h2 { letter-spacing: 0.5px; }");
    expect(styles.perSection.get("c-12")).not.toContain(".c-120");
    // c-1 is not a section root: its rule stays shared (bucketing is organizational only)
    expect(styles.perSection.get("c-1")).toBeUndefined();
    expect(styles.sharedCss).toContain(".c-1 { color: var(--c-1); }");
    expect(styles.sharedCss).toContain(".c-120 { color: #999; }");
  });

  it("shared rules keep the reduced-motion guard; head stylesheet links captured verbatim", () => {
    const styles = splitStyles(sample());
    expect(styles.sharedCss).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles.sharedCss).toContain(".media-slot { background: #e5e5e5; display: block; }");
    expect(styles.headLinks).toEqual([
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Demo+Local&display=swap">',
    ]);
  });

  it("single-arg mode auto-derives section classes from the parsed html", () => {
    expect(splitStyles(sample()).perSection.has("c-23")).toBe(true);
  });

  it("generic html buckets by its own section classes", () => {
    const styles = splitStyles(genericHtml, ["hero"]);
    expect(styles.perSection.get("hero")).toContain(".hero { color: red; }");
    expect(styles.sharedCss).toContain("p { margin: 0; }");
  });
});

describe("extractScripts", () => {
  it("collects gsap CDN tags verbatim and ignores other remote scripts", () => {
    expect(extractScripts(sample()).cdns).toEqual([
      '<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>',
      '<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js"></script>',
    ]);
    const decoy = extractScripts('<html><head><script src="https://x.test/analytics.js"></script></head></html>');
    expect(decoy.cdns).toEqual([]);
  });

  it("inline script captured whole; blocks anchored with the right classes; refresh() tail not swallowed", () => {
    const scripts = extractScripts(sample());
    expect(scripts.inlineJs).toContain("const REDUCED =");
    expect(scripts.timelineBlocks).toHaveLength(3);
    expect(scripts.timelineBlocks[0]?.className).toBe("c-13");
    expect(scripts.timelineBlocks[0]?.js).toContain('gsap.timeline({ scrollTrigger: { trigger: ".c-13"');
    expect(scripts.timelineBlocks[0]?.js).toContain('.from(".c-13", { opacity: 0, y: 40 });');
    expect(scripts.timelineBlocks[1]?.className).toBe("c-23");
    expect(scripts.timelineBlocks[1]?.js).not.toContain("ScrollTrigger.refresh()");
    expect(scripts.timelineBlocks[1]?.js).not.toContain("REDUCED");
    // R1: a function-typed end string and a `;`-bearing onStart callback inside
    // .from( args survive — the block is never silently dropped
    expect(scripts.timelineBlocks[2]?.className).toBe("c-24");
    expect(scripts.timelineBlocks[2]?.js).toContain('end: "function(){ return getMax(); }"');
    expect(scripts.timelineBlocks[2]?.js).toContain("onStart: () => { void 0; }");
  });

  it("non-JS script types (importmap, ld+json) never enter inlineJs", () => {
    const scripts = extractScripts(
      `<html><head>
      <script type="importmap">{ "imports": {} }</script>
      <script type="application/ld+json">{ "@context": "https://schema.org" }</script>
      <script>window.__page = 1;</script>
      </head></html>`,
    );
    expect(scripts.inlineJs).toBe("window.__page = 1;");
  });
});

describe("copyAssets", () => {
  it("copies ./assets/* refs into <out>/<into>/assets shape, deduped, bytes equal", async () => {
    const src = mkdtempSync(join(tmpdir(), "awwwards-bp-src-"));
    const out = mkdtempSync(join(tmpdir(), "awwwards-bp-out-"));
    try {
      mkdirSync(join(src, "assets"));
      writeFileSync(join(src, "assets", "hero-a.png"), Buffer.from([137, 80, 78, 71]));
      const html = '<img src="./assets/hero-a.png"><img src="./assets/hero-a.png"><div style="background-image: url(\'./assets/hero-a.png\')"></div>';
      const result = await copyAssets(html, src, out, { into: "public" });
      expect(result.copied).toEqual(["./assets/hero-a.png"]);
      expect(result.missing).toEqual([]);
      expect([...readFileSync(join(out, "public", "assets", "hero-a.png"))]).toEqual([137, 80, 78, 71]);
    } finally {
      rmSync(src, { recursive: true, force: true });
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("copies social-card meta images, ignoring ordinary meta copy", async () => {
    const src = mkdtempSync(join(tmpdir(), "awwwards-bp-src-"));
    const out = mkdtempSync(join(tmpdir(), "awwwards-bp-out-"));
    try {
      mkdirSync(join(src, "assets"));
      writeFileSync(join(src, "assets", "og.jpg"), Buffer.from([255, 216, 255]));
      const html =
        '<meta property="og:image" content="./assets/og.jpg">' +
        '<meta name="description" content="shipping assets/team.png">' +
        '<meta name="twitter:image" content="./assets/og.jpg">';
      const result = await copyAssets(html, src, out, { into: "public" });
      expect(result.copied).toEqual(["./assets/og.jpg"]);
      expect(existsSync(join(out, "public", "assets", "og.jpg"))).toBe(true);
    } finally {
      rmSync(src, { recursive: true, force: true });
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("missing sources land in missing[]; traversal refs are refused outright", async () => {
    const src = mkdtempSync(join(tmpdir(), "awwwards-bp-src-"));
    const out = mkdtempSync(join(tmpdir(), "awwwards-bp-out-"));
    try {
      const result = await copyAssets('<image src="./assets/gone.webp">', src, out);
      expect(result.copied).toEqual([]);
      expect(result.missing).toEqual(["./assets/gone.webp"]);
      const evil = await copyAssets('<img src="./assets/../escape.txt">', src, out);
      expect(evil.copied).toEqual([]);
      expect(evil.missing).toEqual([]);
    } finally {
      rmSync(src, { recursive: true, force: true });
      rmSync(out, { recursive: true, force: true });
    }
  });
});

describe("splitBuild", () => {
  it("composes parse+split+refs", () => {
    const split = splitBuild(sample());
    expect(split.sections.detected).toBe("rebuild");
    expect(split.scripts.cdns).toHaveLength(2);
    expect(split.styles.tokensCss).toContain("--c-1");
    expect(split.assetRefs).toEqual(["./assets/hero-b.png", "./assets/hero-a.png"]); // document order: style block first
  });
});

describe("rehost shape: external local css/js + inline scripts", () => {
  it("splits every external script tag and keeps section-nested scripts out of the loose list", () => {
    const split = splitBuild(sample2());
    expect(split.sections.detected).toBe("generic");
    expect(split.sections.sections?.map((s) => s.className)).toEqual(["hero", "foot"]);
    expect(split.scripts.externals.map((e) => e.src)).toEqual([
      "https://cdn.example.test/lenis.min.js",
      "https://unpkg.com/split-type",
      "assets/site.js",
    ]);
    expect(split.scripts.headExternal).toEqual(['<script src="https://cdn.example.test/lenis.min.js"></script>']);
    // nested __heroRuns script stays in .hero; only tail + externals are loose
    expect(split.scripts.bodyScripts.map((b) => (b.kind === "external" ? b.src : b.js))).toEqual([
      "https://unpkg.com/split-type",
      "assets/site.js",
      "window.__tailRuns = 1;",
    ]);
    expect(split.assetRefs).toEqual(["assets/site.css", "assets/site.js"]);
    expect(split.styles.headLinks).toEqual(['<link rel="stylesheet" href="assets/site.css" />']);
  });

  it("vite: head link + body scripts verbatim; main.js never re-runs inline scripts", () => {
    const files = viteByName(sample2());
    const f = byPath(files);
    const index = f["index.html"] ?? "";
    expect(index).toContain('<link rel="stylesheet" href="assets/site.css" />');
    expect(index).toContain('<script src="https://cdn.example.test/lenis.min.js"></script>');
    expect(index).toContain('<script src="https://unpkg.com/split-type"></script>');
    expect(index).toContain('<script src="assets/site.js" defer></script>');
    expect(index).toContain("window.__heroRuns");
    expect(index).toContain("window.__tailRuns");
    expect(f["src/main.js"]).not.toContain("__heroRuns");
    expect(f["src/main.js"]).not.toContain("__tailRuns");
    expect(JSON.stringify(files).split("__heroRuns").length - 1).toBe(1);
  });

  it("astro: local css link in head, loose scripts is:inline at page level, nested script once in its section", () => {
    const files = astroByName(sample2());
    const f = byPath(files);
    const index = f["src/pages/index.astro"] ?? "";
    const s1 = f["src/components/Section01.astro"] ?? "";
    expect(index).toContain('<link rel="stylesheet" href="assets/site.css" />');
    expect(index).toContain('<script is:inline src="https://unpkg.com/split-type"></script>');
    expect(index).toContain('<script is:inline src="assets/site.js" defer></script>');
    expect(index).toContain("__tailRuns");
    expect(index).not.toContain("__heroRuns");
    expect(s1).toContain("<Fragment set:html={");
    expect(s1).toContain(".hero > p");
    expect(s1).toContain("<script is:inline>");
    expect(s1).toContain("__heroRuns");
    expect(JSON.stringify(files).split("__heroRuns").length - 1).toBe(1);
  });

  it("buildProject copies local css/js into each target's asset root (remote stays untouched)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awwwards-bp-rehost-"));
    try {
      for (const target of ["vite", "astro", "next"] as const) {
        const out = join(dir, target);
        const res = await buildProject({ html: join(FIXTURES, "sample2.html"), target, out });
        expect(res).toHaveProperty("files");
        if ("error" in res) throw new Error(`unexpected error: ${res.error}`);
        expect(res.warnings).toEqual([]);
        const assets = target === "vite" ? join(out, "assets") : join(out, "public", "assets");
        expect(readFileSync(join(assets, "site.css"), "utf8")).toContain(".hero { color:");
        expect(readFileSync(join(assets, "site.js"), "utf8")).toContain("__siteScriptRan");
        expect(readdirSync(assets).sort()).toEqual(["site.css", "site.js"]);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("root-relative rehost: styles.css + vendor scripts in strict order", () => {
  const order = (text: string, needles: string[]): number[] => needles.map((n) => text.indexOf(n));

  it("collects root-relative css/js and follows their local deps", () => {
    const split = splitBuild(sample3());
    expect(split.sections.detected).toBe("generic");
    expect(split.assetRefs).toEqual([
      "styles.css",
      "vendor/head.js",
      "vendor/gsap.min.js",
      "vendor/ScrollTrigger.min.js",
      "app.js",
    ]);
    expect(split.scripts.headInlineJs[0]).toContain("prefers-reduced-motion");
    expect(split.scripts.bodyScripts.map((b) => (b.kind === "external" ? b.src : b.js))).toEqual([
      "vendor/gsap.min.js",
      "vendor/ScrollTrigger.min.js",
      "app.js",
    ]);
  });

  it("vite: link + classic scripts keep their original order", () => {
    const index = byPath(viteByName(sample3()))["index.html"] ?? "";
    const [css, gsap, st, app] = order(index, [
      'href="styles.css"',
      'src="vendor/gsap.min.js"',
      'src="vendor/ScrollTrigger.min.js"',
      'src="app.js"',
    ]);
    expect(css).toBeGreaterThan(-1);
    expect(gsap).toBeGreaterThan(css);
    expect(st).toBeGreaterThan(gsap);
    expect(app).toBeGreaterThan(st);
    expect(index).toContain("prefers-reduced-motion");
  });

  it("astro: local head script gets is:inline; link + scripts keep source order", () => {
    const index = byPath(astroByName(sample3()))["src/pages/index.astro"] ?? "";
    const [boot, css, head, gsap, st, app] = order(index, [
      "prefers-reduced-motion",
      'href="styles.css"',
      'is:inline src="vendor/head.js"',
      'is:inline src="vendor/gsap.min.js"',
      'is:inline src="vendor/ScrollTrigger.min.js"',
      'is:inline src="app.js"',
    ]);
    expect(boot).toBeGreaterThan(-1);
    expect(css).toBeGreaterThan(boot);
    expect(head).toBeGreaterThan(css);
    expect(gsap).toBeGreaterThan(head);
    expect(st).toBeGreaterThan(gsap);
    expect(app).toBeGreaterThan(st);
    expect(index).toMatch(/<script is:inline>\s*if\(matchMedia/);
    expect(index).not.toContain('<script src="vendor/head.js"');
  });

  it("buildProject copies root css/js, vendor order files and css/js-referenced assets", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awwwards-bp-root-"));
    try {
      for (const target of ["vite", "astro", "next"] as const) {
        const out = join(dir, target);
        const res = await buildProject({ html: join(FIXTURES, "sample3.html"), target, out });
        expect(res).toHaveProperty("files");
        if ("error" in res) throw new Error(`unexpected error: ${res.error}`);
        expect(res.warnings).toEqual([]);
        const base = target === "vite" ? out : join(out, "public");
        for (const ref of ["styles.css", "app.js", "vendor/head.js", "vendor/gsap.min.js", "vendor/ScrollTrigger.min.js"]) {
          expect(existsSync(join(base, ref))).toBe(true);
        }
        // transitive deps: @font-face url() in css, new Audio() in js
        expect(readFileSync(join(base, "assets", "font.woff2"), "utf8")).toContain("fixture-font-bytes");
        expect(readFileSync(join(base, "assets", "audio.mp3"), "utf8")).toContain("fixture-audio-bytes");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("review round: body fallback + head order + asset riders", () => {
  const bodyPage = `<!doctype html><html><head><title>x</title></head><body><h1>Hi</h1><p>Copy</p></body></html>`;

  it("B2: h1/p-only body becomes one full-body section with a warning (all targets)", async () => {
    const split = splitBuild(bodyPage);
    expect(split.sections.detected).toBe("generic");
    expect(split.sections.sections).toHaveLength(1);
    expect(split.warnings).toEqual([FULL_BODY_WARNING]);
    expect(byPath(viteByName(bodyPage))["index.html"]).toContain("<h1>Hi</h1><p>Copy</p>");
    expect(byPath(astroByName(bodyPage))["src/components/Section01.astro"]).toContain("<h1>Hi</h1>");
    const dir = mkdtempSync(join(tmpdir(), "awwwards-bp-b2-"));
    try {
      const out = join(dir, "next");
      writeFileSync(join(dir, "page.html"), bodyPage);
      const ok = await buildProject({ html: join(dir, "page.html"), target: "next", out });
      if ("error" in ok) throw new Error(ok.error);
      expect(ok.warnings).toEqual([FULL_BODY_WARNING]);
      const section = readFileSync(join(out, "components", "Section01.tsx"), "utf8");
      expect(section).toContain("Hi");
      expect(section).toContain("Copy");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("B2: inter-root text nodes force the full-body fallback and are kept", () => {
    const html = `<body><div class="hero">A</div> stray words <div class="foot">B</div><script>window.tail=1</script></body>`;
    const split = splitBuild(html);
    expect(split.sections.sections).toHaveLength(1);
    expect(split.warnings).toEqual([FULL_BODY_WARNING]);
    expect(byPath(viteByName(html))["index.html"]).toContain("stray words");
  });

  it("R1: inline-script-only asset refs copy when present and warn when missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awwwards-bp-r1-"));
    try {
      mkdirSync(join(dir, "assets"), { recursive: true });
      writeFileSync(join(dir, "assets", "clip.mp3"), "clip");
      const html = `<body><script>new Audio("assets/clip.mp3"); new Audio("assets/nope.mp3");</script></body>`;
      const out = join(dir, "out");
      const res = await copyAssets(html, dir, out);
      expect(res.copied).toContain("assets/clip.mp3");
      expect(res.missing).toContain("assets/nope.mp3");
      expect(readFileSync(join(out, "assets", "clip.mp3"), "utf8")).toBe("clip");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("R2: .. and extensionless css deps surface as missing instead of silent skip", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awwwards-bp-r2-"));
    try {
      writeFileSync(join(dir, "styles.css"), `@font-face{src:url(../fonts/x.woff2)}a{background:url(fonts/y)}`);
      const html = `<html><head><link rel="stylesheet" href="styles.css"></head><body><div>x</div></body></html>`;
      const res = await copyAssets(html, dir, join(dir, "out"));
      expect(res.missing).toContain("../fonts/x.woff2");
      expect(res.missing).toContain("fonts/y");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("R3: missing </head> falls back to <body>; tail script never duplicates", () => {
    const frag = `<div>x</div><script>window.tail=1</script>`;
    const split = splitBuild(frag);
    expect(split.scripts.headInlineJs).toEqual([]);
    expect(split.scripts.bodyScripts).toHaveLength(1);
    const index = byPath(viteByName(frag))["index.html"] ?? "";
    expect(index.split("window.tail").length - 1).toBe(1);
  });

  it("R4: isLocalRef rejects Windows-style roots and protocol-relative refs", () => {
    expect(isLocalRef("assets/x.png")).toBe(true);
    expect(isLocalRef("\\\\server\\share\\x.png")).toBe(false);
    expect(isLocalRef("\\assets\\x.png")).toBe(false);
    expect(isLocalRef("//cdn/x.png")).toBe(false);
  });

  it("R5: body-level stylesheet links stay in the body, head links extract once", () => {
    const html = `<html><head><link rel="stylesheet" href="head.css"></head><body><link rel="stylesheet" href="body.css"><div>hi</div></body></html>`;
    expect(splitStyles(html).headLinks).toEqual(['<link rel="stylesheet" href="head.css">']);
    const index = byPath(viteByName(html))["index.html"] ?? "";
    expect(index.split('href="body.css"').length - 1).toBe(1);
    expect(index.split('href="head.css"').length - 1).toBe(1);
    const head = index.slice(0, index.indexOf("</head>"));
    expect(head).toContain("head.css");
    expect(head).not.toContain("body.css");
    const astro = byPath(astroByName(html))["src/pages/index.astro"] ?? "";
    const astroSection = byPath(astroByName(html))["src/components/Section01.astro"] ?? "";
    expect(astroSection).toContain('href="body.css"');
    expect(astro.slice(0, astro.indexOf("</head>"))).not.toContain("body.css");
  });

  it("R6: head tags preserve source interleave (inline before external)", () => {
    const html = `<html><head><script>window.boot=1</script><link rel="stylesheet" href="s.css"><script src="https://cdn.test/x.js"></script></head><body><div>x</div></body></html>`;
    const split = splitBuild(html);
    expect(split.headTags.map((t) => t.kind)).toEqual(["inline", "style", "external"]);
    const index = byPath(astroByName(html))["src/pages/index.astro"] ?? "";
    const [boot, css, ext] = ["window.boot=1", 'href="s.css"', "https://cdn.test/x.js"].map((n) => index.indexOf(n));
    expect(boot).toBeGreaterThan(-1);
    expect(css).toBeGreaterThan(boot);
    expect(ext).toBeGreaterThan(css);
  });
});

describe("parseBuildArgs", () => {
  it("happy path, space and = flag forms, next accepted for Task-3 wiring", () => {
    expect(parseBuildArgs(["site.html", "--target", "vite", "--out", "out/site"])).toEqual({
      html: "site.html",
      target: "vite",
      out: "out/site",
    });
    expect(parseBuildArgs(["--target=astro", "a.html", "--out", "o", "--name", "My Site"])).toEqual({
      html: "a.html",
      target: "astro",
      out: "o",
      name: "My Site",
    });
    expect(parseBuildArgs(["a.html", "--target", "next", "--out", "o", "--name", "x"])).toMatchObject({ target: "next" });
  });

  it("usage errors: missing target/out, wrong target, wrong positional count, dangling flag", () => {
    expect(parseBuildArgs([])).toHaveProperty("error");
    expect(parseBuildArgs(["a.html", "--out", "o"])).toHaveProperty("error");
    expect(parseBuildArgs(["a.html", "--target", "svelte", "--out", "o"])).toHaveProperty("error");
    expect(parseBuildArgs(["a.html", "b.html", "--target", "vite", "--out", "o"])).toHaveProperty("error");
    expect(parseBuildArgs(["a.html", "--target"])).toHaveProperty("error");
  });
});

describe("emitVite", () => {
  const files = viteByName(sample());
  const f = byPath(files);

  it("file tree is exactly the vite scaffold set", () => {
    expect(files.map((x) => x.path).sort()).toEqual(
      [
        "index.html",
        "package.json",
        "vite.config.js",
        "src/main.js",
        "src/styles/tokens.css",
        "src/styles/shared.css",
        "src/styles/section-1.css",
        "src/styles/section-2.css",
        "src/styles/section-3.css",
        "src/animations/page.js",
        "src/animations/section01.js",
        "src/animations/section02.js",
        "src/animations/section03.js",
        "src/animations/registry.js",
        "motion.manifest.json",
      ].sort(),
    );
  });

  it("index.html keeps the body sections verbatim, plus CDN tags and font links, no slots", () => {
    const index = f["index.html"] ?? "";
    const sections = parseRebuildSections(sample()).sections ?? [];
    expect(index).toContain(sections.map((s) => s.text).join("\n"));
    expect(index).toContain('<script type="module" src="/src/main.js"></script>');
    expect(index).toContain('src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"');
    expect(index).toContain('href="https://fonts.googleapis.com/css2?family=Demo+Local&display=swap"');
    // R3: the zero-slot assertion spans the whole emitted tree, not just index.html
    expect(JSON.stringify(files)).not.toContain("{{slot:");
  });

  it("main.js imports every css file then ships the inline script whole", () => {
    const main = f["src/main.js"] ?? "";
    expect(main.startsWith('import "./styles/tokens.css";')).toBe(true);
    expect(main).toContain('import "./styles/section-2.css";');
    expect(main).toContain('.from(".c-13", { opacity: 0, y: 40 });');
    expect(main).toContain("const REDUCED");
    expect(main.endsWith("\n")).toBe(true);
  });

  it("css files land bucketed with re-based url()s; package name npm-safe", () => {
    expect(f["src/styles/section-2.css"]).toContain(".c-12 .c-13 { font-size: var(--fs-1); }");
    expect(f["src/styles/section-3.css"]).toContain('url("../../assets/hero-b.png")');
    expect(f["src/styles/section-3.css"]).not.toContain('url("./assets/');
    expect(f["src/styles/tokens.css"]).toContain(":root");
    const pkg = JSON.parse(f["package.json"] ?? "{}") as { name: string; scripts: Record<string, string>; devDependencies: Record<string, string> };
    expect(pkg.name).toBe("neu-omni-2");
    expect(pkg.scripts.dev).toBe("vite");
    expect(pkg.devDependencies.vite).toBeDefined();
    expect(f["vite.config.js"]).toContain('base: "./"');
  });

  it("determinism: two runs are byte-equal", () => {
    expect(JSON.stringify(viteByName(sample()))).toBe(JSON.stringify(viteByName(sample())));
  });
});

describe("emitAstro", () => {
  const files = astroByName(sample());
  const f = byPath(files);

  it("file tree is exactly the astro scaffold set", () => {
    expect(files.map((x) => x.path).sort()).toEqual(
      [
        "astro.config.mjs",
        "package.json",
        "src/pages/index.astro",
        "src/components/Section01.astro",
        "src/components/Section02.astro",
        "src/components/Section03.astro",
        "src/styles/tokens.css",
        "src/styles/shared.css",
        "src/styles/section-1.css",
        "src/styles/section-2.css",
        "src/styles/section-3.css",
        "src/animations/page.js",
        "src/animations/section01.js",
        "src/animations/section02.js",
        "src/animations/section03.js",
        "src/animations/registry.js",
        "motion.manifest.json",
      ].sort(),
    );
  });

  it("index.astro imports tokens+shared+section css and renders the three components", () => {
    const index = f["src/pages/index.astro"] ?? "";
    expect(index.startsWith("---\n// Generated by awwwards-build-project")).toBe(true);
    expect(index).toContain('import "../styles/tokens.css";');
    expect(index).toContain('import "../styles/shared.css";');
    expect(index).toContain('import "../styles/section-3.css";');
    for (let i = 1; i <= 3; i++) {
      const nn = `Section${String(i).padStart(2, "0")}`;
      expect(index).toContain(`import ${nn} from "../components/${nn}.astro";`);
    }
    expect(index).toContain("    <Section01 />");
    expect(index).toContain("    <Section02 />");
    expect(index).toContain("    <Section03 />");
    expect(index).toContain("<title>Neu Omni 2</title>");
    // rebuild shape: the whole-script skeleton never duplicates at page level
    expect(index).not.toContain("REDUCED");
  });

  it("section components carry their markup verbatim; no {{slot: anywhere", () => {
    const sections = parseRebuildSections(sample()).sections ?? [];
    sections.forEach((s, i) => {
      expect(f[`src/components/Section${String(i + 1).padStart(2, "0")}.astro`]).toContain(s.text);
    });
    expect(JSON.stringify(files)).not.toContain("{{slot:");
  });

  it("inline timelines split per section (subtree class match), each timeline exactly once", () => {
    const s2 = f["src/components/Section02.astro"] ?? "";
    expect(s2).toContain("<script>");
    expect(s2).toContain("gsap.registerPlugin(ScrollTrigger);");
    expect(s2).toContain('if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {');
    expect(s2).toContain('trigger: ".c-13"');
    expect(s2).toContain('.from(".c-13", { opacity: 0, y: 40 });');
    expect(s2).toContain("ScrollTrigger.refresh();");
    const s3 = f["src/components/Section03.astro"] ?? "";
    expect(s3).toContain('trigger: ".c-23"');
    // R1 regression: the `;`-bearing .from block (fixture sample 2) lands in its
    // section whole — function end string and onStart callback intact
    expect(s3).toContain("end: \"function(){ return getMax(); }\"");
    expect(s3).toContain("onStart: () => { void 0; }");
    expect(files.filter((x) => x.content.includes('.from(".c-13"')).map((x) => x.path)).toEqual([
      "src/components/Section02.astro",
    ]);
    const s1 = f["src/components/Section01.astro"] ?? "";
    expect(s1).not.toContain("<script>");
  });

  it("R2: brace/backtick content ships via <Fragment set:html> as an escaped string, not raw interpolation", () => {
    const braces = `<!doctype html><html><body>
<section class="c-30"><p class="c-31">Price: {from} 99\` up</p></section>
<section class="c-40"><p class="c-41">plain copy</p></section>
</body></html>`;
    const f2 = byPath(astroByName(braces));
    const risky = f2["src/components/Section01.astro"] ?? "";
    expect(risky).toContain("<Fragment set:html={");
    // raw interpolation is gone: the quoted attr form only exists escaped inside
    // the string literal (quotes escaped, braces and backtick verbatim)
    expect(risky).not.toContain('<p class="c-31">');
    expect(risky).toContain("<p class=\\\"c-31\\\">Price: {from} 99` up</p>");
    expect(risky).toContain("set:html string (astro would parse { as an expression)");
    const plain = f2["src/components/Section02.astro"] ?? "";
    expect(plain).toContain('<p class="c-41">plain copy</p>');
    expect(plain).not.toContain("Fragment");
  });

  it("css re-based to /assets/ for the public dir; package.json is astro-shaped", () => {
    expect(f["src/styles/section-3.css"]).toContain('url("/assets/hero-b.png")');
    const pkg = JSON.parse(f["package.json"] ?? "{}") as { name: string; scripts: Record<string, string>; dependencies: Record<string, string> };
    expect(pkg.name).toBe("neu-omni-2");
    expect(pkg.dependencies.astro).toBeDefined();
    expect(f["astro.config.mjs"]).toContain("defineConfig");
  });

  it("determinism: two runs are byte-equal", () => {
    expect(JSON.stringify(astroByName(sample()))).toBe(JSON.stringify(astroByName(sample())));
  });

  it("generic html: inline js ships wholesale at page level; classless roots still become components", () => {
    const files2 = astroByName(genericHtml);
    const f2 = byPath(files2);
    const index = f2["src/pages/index.astro"] ?? "";
    expect(index).toContain("document.querySelectorAll");
    expect(index).toContain("<Section01 />");
    expect(f2["src/components/Section01.astro"]).toContain('<header class="hero">');
    expect(files2.map((x) => x.path)).toContain("src/styles/section-1.css");
    expect(f2["src/styles/section-1.css"]).toContain(".hero { color: red; }");
  });

  it("unattributable timeline blocks fall back to the page-level script, never dropped", () => {
    const orphan = `<!doctype html><html><body>
<section class="c-5"><div class="c-6">x</div></section>
<script>
gsap.registerPlugin(ScrollTrigger);

const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
if (!REDUCED) {
  // motion-dna sample 1: section .c-999 animates as a unit
  gsap.timeline({ scrollTrigger: { trigger: ".c-999", start: "top 85%" }, defaults: { duration: 0.7, ease: "power1.out" } })
    .from(".c-999", { opacity: 0, y: 40 });
  ScrollTrigger.refresh();
}
</script>
</body></html>`;
    const f3 = byPath(astroByName(orphan));
    expect(f3["src/pages/index.astro"]).toContain('.from(".c-999"');
    expect(f3["src/components/Section01.astro"]).not.toContain(".from(");
  });
});

describe("document attributes survive conversion (M3)", () => {
  // Rebuild shape (top-level c-N roots) on a non-English, RTL, themed document.
  // Single-quoted html attrs prove the scan is quote-aware; the inline style
  // carries a custom property so the Next path needs its CSSProperties cast.
  const docPage = `<!doctype html>
<html lang='ar' dir='rtl' class="theme-night" id="doc" data-theme="night" style="--ink: rgb(1, 2, 3); background-color: rgb(9, 8, 7)">
<head>
<style>:root { --ink: rgb(1, 2, 3); }</style>
</head>
<body dir="rtl" class="page" id="top" data-page="home" aria-label="Home page" style="color: rgb(4, 5, 6)">
<section class="c-0"><p class="c-1">stage</p></section>
</body>
</html>`;
  const htmlOpen =
    '<html lang="ar" dir="rtl" class="theme-night" id="doc" data-theme="night" style="--ink: rgb(1, 2, 3); background-color: rgb(9, 8, 7)">';
  const bodyOpen =
    '<body dir="rtl" class="page" id="top" data-page="home" aria-label="Home page" style="color: rgb(4, 5, 6)">';

  it("vite + astro rebuilt layout keeps lang/dir/class/id/style/data-*/aria-*", () => {
    const vite = byPath(viteByName(docPage))["index.html"] ?? "";
    expect(vite).toContain(htmlOpen);
    expect(vite).toContain(bodyOpen);
    const astro = byPath(astroByName(docPage))["src/pages/index.astro"] ?? "";
    expect(astro).toContain(htmlOpen);
    expect(astro).toContain(bodyOpen);
  });

  it("next rebuilt layout converts the same attributes to JSX props", () => {
    const layout = byPath(emitNext(splitBuild(docPage), "unused", "Doc").files)["app/layout.tsx"] ?? "";
    expect(layout).toContain(
      '<html lang="ar" dir="rtl" className="theme-night" id="doc" data-theme="night" style={{ "--ink": "rgb(1, 2, 3)", "backgroundColor": "rgb(9, 8, 7)" } as React.CSSProperties}>',
    );
    expect(layout).toContain(
      '<body dir="rtl" className="page" id="top" data-page="home" aria-label="Home page" style={{ "color": "rgb(4, 5, 6)" }}>',
    );
    expect(layout).toContain('import type React from "react";');
  });

  it("full-body fallback keeps the document attributes too", () => {
    const page = `<!doctype html><html lang="ar" dir="rtl" class="theme"><body dir="rtl" class="page"><h1>Hi</h1><p>Copy</p></body></html>`;
    const split = splitBuild(page);
    expect(split.rehost).toBeNull();
    expect(split.warnings).toEqual([FULL_BODY_WARNING]);
    expect(byPath(viteByName(page))["index.html"]).toContain('<html lang="ar" dir="rtl" class="theme">');
    expect(byPath(astroByName(page))["src/pages/index.astro"]).toContain('<body dir="rtl" class="page">');
    const layout = byPath(emitNext(split, "unused", "x").files)["app/layout.tsx"] ?? "";
    expect(layout).toContain('<html lang="ar" dir="rtl" className="theme">');
    expect(layout).toContain('<body dir="rtl" className="page">');
  });

  it("absent lang keeps the en fallback", () => {
    const bare = `<!doctype html><html><body><section class="c-0"><p class="c-1">x</p></section></body></html>`;
    expect(byPath(viteByName(bare))["index.html"]).toContain('<html lang="en">');
    expect(byPath(astroByName(bare))["src/pages/index.astro"]).toContain('<html lang="en">');
    expect(byPath(emitNext(splitBuild(bare), "unused", "x").files)["app/layout.tsx"]).toContain('<html lang="en">');
  });

  it("drops on* handlers and executable styles; keeps the allowlisted safe attrs", () => {    // Quote/closing-tag-like text in values must not break the generated syntax;
    // duplicate attributes follow the browser's first-wins rule.
    const hostile = `<!doctype html>
<html lang="en" lang="ar" onclick="window.__pwned=1" style="width: expression(alert(1))" data-q="a&quot;b" data-json='{"a":1}' data-tag="</html>" data-lt="a<b>c">
<head><title>x</title></head>
<body onload="window.__pwned=2" style="background: url(javascript:alert(1))" data-keep="1">
<section class="c-0"><p class="c-1">x</p></section>
</body></html>`;
    const safeHtml =
      '<html lang="en" data-q="a&quot;b" data-json="{&quot;a&quot;:1}" data-tag="&lt;/html&gt;" data-lt="a&lt;b&gt;c">';
    const safeBody = '<body data-keep="1">';
    const viteIndex = byPath(viteByName(hostile))["index.html"] ?? "";
    expect(viteIndex).toContain(safeHtml);
    expect(viteIndex).toContain(safeBody);
    const astroIndex = byPath(astroByName(hostile))["src/pages/index.astro"] ?? "";
    expect(astroIndex).toContain(safeHtml);
    expect(astroIndex).toContain(safeBody);
    const nextLayout = byPath(emitNext(splitBuild(hostile), "unused", "x").files)["app/layout.tsx"] ?? "";
    // Next hands React decoded JS strings (JSX would decode entities with JSX
    // rules), so the document tag is the decoded value, still free of on*/expr.
    expect(nextLayout).toContain(
      '<html lang="en" data-q={"a\\"b"} data-json={"{\\"a\\":1}"} data-tag={"</html>"} data-lt={"a<b>c"}>',
    );
    expect(nextLayout).toContain(safeBody);
    for (const text of [viteIndex, astroIndex, nextLayout]) {
      for (const bad of ["onclick", "onload", "expression(", "javascript:", "__pwned"]) {
        expect(text).not.toContain(bad);
      }
    }
    // Hostile attribute text still has to be valid JSX, not just a substring.
    const transpiled = ts.transpileModule(nextLayout, {
      compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ESNext },
      fileName: "layout.tsx",
      reportDiagnostics: true,
    });
    expect((transpiled.diagnostics ?? []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"))).toEqual([]);
  });

  it("entity-encoded or comment-split executable styles never reach any target", () => {
    const styles = [
      "width: expression&#40;alert(1)&#41;",
      "background: url(javascript&colon;alert(1))",
      "background: url(javascript&#58;alert(1))",
      "background: url(javascript&#x3a;alert(1))",
      "background: url(java/**/script:alert(1))",
      // Numeric character references without their terminating semicolon.
      "width: expression&#40alert(1&#41",
      "background: url(javascript&#58alert(1))",
      "background: url(javascript&#x3a alert(1))",
    ];
    for (const style of styles) {
      const html = `<!doctype html><html lang="en" style="${style}"><head><title>x</title></head><body style="${style}"><section class="c-1"><p class="c-2">x</p></section></body></html>`;
      const vite = byPath(viteByName(html))["index.html"] ?? "";
      const astro = byPath(astroByName(html))["src/pages/index.astro"] ?? "";
      const next = byPath(emitNext(splitBuild(html), "unused", "x").files)["app/layout.tsx"] ?? "";
      for (const text of [vite, astro, next]) {
        expect(text).toContain('<html lang="en">');
        expect(text).toContain("<body>");
        expect(text).not.toMatch(/style=/i);
      }
    }
  });

  it("document tag scan ignores comments and script bodies", () => {
    const html = `<!-- <html lang="fr" dir="ltr" class="decoy"> -->
<!doctype html>
<html lang="ar" dir="rtl" class="theme">
<head>
<script>const decoy = "<body class='fake' dir='ltr'>";</script>
<title>x</title>
</head>
<!-- <body class="commented"> -->
<body class="real" dir="rtl">
<section class="c-1"><p class="c-2">x</p></section>
</body></html>`;
    const vite = byPath(viteByName(html))["index.html"] ?? "";
    const astro = byPath(astroByName(html))["src/pages/index.astro"] ?? "";
    const next = byPath(emitNext(splitBuild(html), "unused", "x").files)["app/layout.tsx"] ?? "";
    // The scan itself: only the real tags' attributes survive.
    expect(readDocumentAttrs(html)).toEqual({
      html: [
        ["lang", "ar"],
        ["dir", "rtl"],
        ["class", "theme"],
      ],
      body: [
        ["class", "real"],
        ["dir", "rtl"],
      ],
    });
    for (const text of [vite, astro, next]) {
      expect(text).toContain(text === next ? '<html lang="ar" dir="rtl" className="theme">' : '<html lang="ar" dir="rtl" class="theme">');
      expect(text).toContain(text === next ? '<body className="real" dir="rtl">' : '<body class="real" dir="rtl">');
      expect(text).not.toContain('<html lang="fr"');
      expect(text).not.toMatch(/<body[^>]*class="fake"/);
    }
  });

  it("document tag scan ignores raw-text element bodies", () => {
    const html = `<!doctype html>
<html lang="ar" dir="rtl" class="theme">
<head>
<title><html lang="fr"></title>
<style>.a::before { content: "<body class='fake'>"; }</style>
<textarea><body class="fake2"></body></textarea>
</head>
<body class="real" dir="rtl">
<section class="c-1"><p class="c-2">x</p></section>
</body></html>`;
    expect(readDocumentAttrs(html)).toEqual({
      html: [
        ["lang", "ar"],
        ["dir", "rtl"],
        ["class", "theme"],
      ],
      body: [
        ["class", "real"],
        ["dir", "rtl"],
      ],
    });
    const vite = byPath(viteByName(html))["index.html"] ?? "";
    expect(vite).toContain('<html lang="ar" dir="rtl" class="theme">');
    expect(vite).toContain('<body class="real" dir="rtl">');
    const next = byPath(emitNext(splitBuild(html), "unused", "x").files)["app/layout.tsx"] ?? "";
    expect(next).toContain('<html lang="ar" dir="rtl" className="theme">');
    expect(next).toContain('<body className="real" dir="rtl">');
  });

  it("document tags are never read from attribute values or nested text", () => {
    const html = `<!doctype html>
<html lang="ar" dir="rtl" data-x="<body class='attr-fake' dir='ltr'>">
<head>
<meta name="x" content="The <body> element">
<img alt="<body class='img-fake'>">
<noscript><body class="ns-fake" dir="ltr"></noscript>
<template><body class="tpl-fake" dir="ltr"></body></template>
</head>
<body class="real" dir="rtl">
<section class="c-1"><p class="c-2">x</p></section>
</body></html>`;
    expect(readDocumentAttrs(html)).toEqual({
      html: [
        ["lang", "ar"],
        ["dir", "rtl"],
        ["data-x", "<body class='attr-fake' dir='ltr'>"],
      ],
      body: [
        ["class", "real"],
        ["dir", "rtl"],
      ],
    });
    for (const [name, text] of [
      ["vite", byPath(viteByName(html))["index.html"] ?? ""],
      ["astro", byPath(astroByName(html))["src/pages/index.astro"] ?? ""],
      ["next", byPath(emitNext(splitBuild(html), "unused", "x").files)["app/layout.tsx"] ?? ""],
    ] as const) {
      expect(text, name).toMatch(/<body[^>]*class(?:Name)?="real"/);
      expect(text, name).not.toMatch(/(?:class|className)="(?:attr|img|ns|tpl)-fake"/);
    }
  });

  it("body and head bounds are found by the same walk", () => {
    const html = `<html><head><meta content="<body class='fake'>"><title>t</title></head><body class="real"><section class="c-0"><p>X</p></section></body></html>`;
    const open = '<body class="real">';
    expect(bodyBounds(html)).toEqual({ start: html.indexOf(open) + open.length, end: html.indexOf("</body>") });
    const split = splitBuild(html);
    expect(split.sections.sections?.[0]?.className).toBe("c-0");
    for (const target of ["vite", "astro", "next"] as const) {
      const files = byPath(
        target === "vite" ? emitVite(split, "unused", "x").files : target === "astro" ? emitAstro(split, "unused", "x").files : emitNext(split, "unused", "x").files,
      );
      const path = target === "vite" ? "index.html" : target === "astro" ? "src/pages/index.astro" : "app/page.tsx";
      expect(files[path], target).not.toContain("class='fake'");
    }
  });

  it("body lang survives the allowlist", () => {
    const html = `<!doctype html><html lang="ar"><head><title>x</title></head><body lang="fr" dir="rtl"><section class="c-1"><p class="c-2">x</p></section></body></html>`;
    expect(readDocumentAttrs(html).body).toEqual([
      ["lang", "fr"],
      ["dir", "rtl"],
    ]);
    const next = byPath(emitNext(splitBuild(html), "unused", "x").files)["app/layout.tsx"] ?? "";
    expect(next).toContain('<body lang="fr" dir="rtl">');
  });

  it("a duplicate <body> in body text does not extend the body", () => {
    const html = `<!doctype html><html lang="en"><head><title>t</title></head><body class="real"><section class="c-0"><p>x</p></section><p>text <body class="dup" dir="ltr"> more</p></body></html>`;
    const open = '<body class="real">';
    expect(bodyBounds(html)).toEqual({ start: html.indexOf(open) + open.length, end: html.indexOf("</body>") });

    const split = splitBuild(html);
    // The duplicate start tag is page text: content after it is still content,
    // but nothing past the real </body> may be.
    expect(split.sections.sections?.length).toBe(1);

    const vite = byPath(viteByName(html))["index.html"] ?? "";
    // The body ends where the document says it does: no stray </body></html>.
    expect(vite.split("</body>")).toHaveLength(2);
    expect(vite.split("</html>")).toHaveLength(2);
    expect(vite.trimEnd().endsWith("</html>")).toBe(true);

    const astro = byPath(astroByName(html))["src/pages/index.astro"] ?? "";
    expect(astro.trimEnd().endsWith("</html>")).toBe(true);
    expect(astro.split("</html>")).toHaveLength(2);
    const next = byPath(emitNext(split, "unused", "x").files)["app/page.tsx"] ?? "";
    expect(next).not.toContain("class=\"dup\"");
  });

  it("a head script carrying a document shell never becomes document structure", () => {
    const html = `<!doctype html><html lang="en"><head><title>t</title><script type="text/template"><html><head></head><body class="fake" dir="ltr"></body></html></script></head><body class="real"><main id="main"><section id="a">A</section><section id="b">B</section></main></body></html>`;
    // The real </head> is the last one; the decoy sits inside the script.
    expect(headBounds(html)).toEqual({ start: html.indexOf("<head>") + 6, end: html.lastIndexOf("</head>") });

    const split = splitBuild(html);
    expect(split.rehost).not.toBeNull();
    const vite = byPath(viteByName(html))["index.html"] ?? "";
    // The template stays inert data, and the loader lands in the real body.
    expect(vite).toContain('<script type="text/template"><html><head></head><body class="fake" dir="ltr"></body></html></script>');
    expect(vite).toContain('<body class="real">');
    expect(vite.indexOf("/src/main.js")).toBeGreaterThan(vite.indexOf('<body class="real">'));
    expect(vite.split("<body").length - 1).toBe(2);

    const astro = byPath(astroByName(html))["src/pages/index.astro"] ?? "";
    expect(astro).toContain('<script type="text/template"><html><head></head><body class="fake" dir="ltr"></body></html></script>');
    expect(astro).toContain('<body class="real">');
    expect(astro.indexOf("<body class=\"fake\"")).toBeLessThan(astro.indexOf("</script>"));

    const nextFiles = byPath(emitNext(split, "unused", "x").files);
    expect(nextFiles["app/layout.tsx"] ?? "").toContain('<body className="real">');
    expect(nextFiles["app/layout.tsx"] ?? "").not.toContain('className="fake"');
    expect(nextFiles["app/page.tsx"] ?? "").not.toContain("fake");
  });

  it("authored mode keeps document attributes and still drops page scripts", () => {
    const html = `<!doctype html>
<html lang="ar" dir="rtl" class="theme-night"><head><title>x</title>
<link rel="stylesheet" href="https://fonts.test/x.css"></head>
<body dir="rtl" class="page">
<section class="c-0"><p class="c-1">x</p></section>
<script src="https://analytics.test/a.js"></script>
<script>window.__pageLogic = 1;</script>
</body></html>`;
    const split = splitBuild(html);
    const motion = { manifest: buildMotionManifest(split), authored: true };
    const vite = byPath(emitVite(split, "unused", "x", motion).files)["index.html"] ?? "";
    const astro = byPath(emitAstro(split, "unused", "x", motion).files)["src/pages/index.astro"] ?? "";
    const next = byPath(emitNext(split, "unused", "x", motion).files)["app/layout.tsx"] ?? "";
    expect(vite).toContain('<html lang="ar" dir="rtl" class="theme-night">');
    expect(astro).toContain('<body dir="rtl" class="page">');
    expect(next).toContain('<html lang="ar" dir="rtl" className="theme-night">');
    expect(next).toContain('<body dir="rtl" className="page">');
    for (const text of [vite, astro, next]) {
      expect(text).not.toContain("analytics.test");
      expect(text).not.toContain("__pageLogic");
    }
  });
});

describe("buildProject core (bin + MCP handler both call this)", () => {
  it("reads html, writes the tree, copies assets, reports {outDir, target, files, warnings}", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awwwards-bp-run-"));
    try {
      const html = '<!doctype html><html><body><section class="c-1"><img class="c-2" src="./assets/pic.png"></section></body></html>';
      const src = join(dir, "site.html");
      writeFileSync(src, html);
      mkdirSync(join(dir, "assets"));
      writeFileSync(join(dir, "assets", "pic.png"), Buffer.from([1, 2, 3]));
      const out = join(dir, "proj");
      const result = await buildProject({ html: src, target: "vite", out });
      expect(result).toMatchObject({ target: "vite" });
      if ("error" in result) throw new Error(`unexpected error: ${result.error}`);
      expect(resolve(result.outDir)).toBe(resolve(out));
      expect(result.files).toContain("index.html");
      expect(result.warnings).toEqual([]);
      expect(existsSync(join(out, "index.html"))).toBe(true);
      expect(existsSync(join(out, "src", "main.js"))).toBe(true);
      expect([...readFileSync(join(out, "assets", "pic.png"))]).toEqual([1, 2, 3]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("missing html returns {error} (never throws); next target scaffolds app/ + public/assets", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awwwards-bp-out2-"));
    try {
      const err = await buildProject({ html: join(dir, "nope.html"), target: "astro", out: join(dir, "p") });
      expect(err).toHaveProperty("error");
      expect((err as { error: string }).error).toContain("cannot read");
      const htmlPath = join(dir, "site.html");
      writeFileSync(htmlPath, '<!doctype html><html><body><section class="c-1"><p>x</p></section></body></html>');
      const res = await buildProject({ html: htmlPath, target: "next", out: join(dir, "nx") });
      expect(res).toHaveProperty("files");
      if ("error" in res) throw new Error(`unexpected error: ${res.error}`);
      expect(res.files).toContain("app/page.tsx");
      expect(res.files).toContain("components/Section01.tsx");
      expect(existsSync(join(dir, "nx", "app", "page.tsx"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
