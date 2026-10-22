import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  buildProject,
  copyAssets,
  emitAstro,
  emitVite,
  extractScripts,
  parseBuildArgs,
  parseRebuildSections,
  splitBuild,
  splitStyles,
} from "../src/build-project.js";

const FIXTURES = join(__dirname, "fixtures", "build-project");
const sample = () => readFileSync(join(FIXTURES, "sample.html"), "utf8");
const sample2 = () => readFileSync(join(FIXTURES, "sample2.html"), "utf8");

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
