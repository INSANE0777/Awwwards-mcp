import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { buildProject, emitAstro, emitVite, parseBuildArgs, splitBuild } from "../src/build-project.js";
import { emitNext } from "../src/emit-next.js";
import { buildMotionManifest, normalizeScrollCensus, type MotionManifest } from "../src/motion-manifest.js";
import type { ScaffoldFile } from "../src/build-project.js";

const FIXTURES = join(__dirname, "fixtures", "build-project");
const sample4 = () => readFileSync(join(FIXTURES, "sample4.html"), "utf8");
const censusRaw = () => JSON.parse(readFileSync(join(FIXTURES, "census.json"), "utf8"));
const byPath = (files: ScaffoldFile[]) => Object.fromEntries(files.map((f) => [f.path, f.content]));
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

const census = () => {
  const parsed = normalizeScrollCensus(censusRaw());
  if ("error" in parsed) throw new Error(parsed.error);
  return parsed.census;
};
const measuredManifest = (): MotionManifest => buildMotionManifest(splitBuild(sample4()), census());

// Default outputs frozen before N2 — skeletons are additive, nothing here may move.
const GOLDEN: Record<string, Record<string, string>> = {
  vite: {
    "package.json": "29171a14baba522b7a578a37b6d866474784882548319a125bf1eb087be2b4e1",
    "vite.config.js": "b79b9f150cb9fabeb2b23c8571f47ce3039b4e3ad262f2c154821547d4b49e97",
    "src/styles/tokens.css": "eea4a1d5879a19b9d2bdff6a5df74f0ea7a0548351094336aa1e256f9bb53da4",
    "src/styles/site.css": "a21acdc364a22de813f948c100a46b603750340aedb66bd1221bd56e3fd375dc",
    "src/main.js": "b9af9e19f83b01077754a2a2011238a606540e5c2ee8d64160d6b98e865fa7df",
    "index.html": "1cc4e74f6f9335f65893e8739daa5e9bf23e99eccf900b5a17e72db063ae0532",
  },
  astro: {
    "package.json": "d685747278c98caf042b0099a62dd38ba00a00ed08abe0195942d11dd23caa45",
    "astro.config.mjs": "119b6b81d073419a4fc0a34c8843dab6f6e4607b9fbbf120b59e8dad7100a0c3",
    "src/styles/tokens.css": "eea4a1d5879a19b9d2bdff6a5df74f0ea7a0548351094336aa1e256f9bb53da4",
    "src/styles/site.css": "a21acdc364a22de813f948c100a46b603750340aedb66bd1221bd56e3fd375dc",
    "src/pages/index.astro": "38892806e090ae2b02c6a2494fb5e3192ea1c9a24091f5cfb0173ae7efd604fe",
    "src/components/Section01.astro": "fa8c820628d3e2ddc976fe2bd621d068615974f448f6475eeb79dbe41ae52f3b",
    "src/components/Section02.astro": "36b5dbb3a1d04423ebbf009052dac74f9377122e9b7fb3295e3bfd3db6cdfa8e",
    "src/components/Section03.astro": "06eb573229eccea771f2d722f9c7de79de5680da89f8189e3caaf2124e7a09e9",
  },
  next: {
    "package.json": "4ffda7cc83dfd644578e802c6ef9fd67927e7a83661030f3349d1f61797bd90e",
    "next.config.mjs": "450f0af4f4c1ecc4c7180f2e364c8a59bfed69dd350fb6b47bce8641c2a37786",
    "tsconfig.json": "642202265069c4b3fce6775871c9cc2f87b23a2e7d37d9c87070c1599a8e3035",
    "styles/tokens.css": "eea4a1d5879a19b9d2bdff6a5df74f0ea7a0548351094336aa1e256f9bb53da4",
    "styles/site.css": "a21acdc364a22de813f948c100a46b603750340aedb66bd1221bd56e3fd375dc",
    "app/layout.tsx": "8ad6e01ddc41c8a94319989b0c8bb0b0d8d1351d3737df97d62d0724d62d71e8",
    "app/page.tsx": "90326db2415d9f05a138f7fd9d83e2eebdf71ababcf0883c2af947555502d5ed",
    "components/Section01.tsx": "966b99f2551ee4287899d5ae6807d937d92c1f351ad47cda3dd22955c654cacd",
    "components/Section02.tsx": "ac4dd3825acc8f1b8ede47695b4214234143cb54ed2a4dbfff42d02bf1ef9cb6",
    "components/Section03.tsx": "ff59556b8159916b561efd3930b695fb8e0f22d02b9a0a19e262d6a70d55b1cf",
    "components/SiteScripts.tsx": "1ac1e624868429f573891036ea22eb4b453ec866299f7441c4057c8bab34b1df",
  },
};

const walk = (dir: string, base = ""): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    return entry.isDirectory() ? walk(join(dir, entry.name), rel) : [rel];
  });

const readTree = (dir: string): Record<string, string> =>
  Object.fromEntries(walk(dir).map((rel) => [rel, readFileSync(join(dir, rel), "utf8")]));

describe("motion census validation", () => {
  it("accepts analyze_scroll_map JSON and a verify_build dump that nests it", () => {
    const direct = normalizeScrollCensus(censusRaw());
    expect("error" in direct).toBe(false);
    if ("error" in direct) return;
    expect(direct.census.anims).toHaveLength(2);
    expect(direct.census.gsapTriggers).toHaveLength(1);
    expect(direct.census.scrubCurves).toHaveLength(1);

    const nested = normalizeScrollCensus({ scrollCensus: censusRaw() });
    expect("error" in nested).toBe(false);
  });

  it("rejects missing required arrays and skips malformed rows with a warning", () => {
    expect(normalizeScrollCensus({ anims: [] })).toEqual({ error: "motion census: gsapTriggers[] is missing" });
    expect(normalizeScrollCensus({ gsapTriggers: [] })).toEqual({ error: "motion census: anims[] is missing" });
    expect(normalizeScrollCensus([])).toEqual({ error: "motion census: expected a JSON object" });
    const parsed = normalizeScrollCensus({ anims: [{ selector: "" }, { selector: ".ok", durationMs: 5 }], gsapTriggers: [] });
    expect("error" in parsed).toBe(false);
    if ("error" in parsed) return;
    expect(parsed.census.anims.map((a) => a.selector)).toEqual([".ok"]);
    expect(parsed.warnings).toContain("motion census: skipped 1 malformed row(s)");
  });
});

describe("motion.manifest.json", () => {
  it("measured manifest is exact for the fixture census", () => {
    expect(measuredManifest()).toEqual({
      version: 1,
      measured: true,
      sections: [
        {
          id: "a",
          component: "Section01",
          measured: true,
          triggers: [
            { selector: "#a .title", start: 0, end: 900, scrub: true, pin: false, durationMs: 1200, ease: "power2.out" },
          ],
          initialHidden: [],
          animatedSelectors: ["#a .title"],
        },
        {
          id: "b",
          component: "Section02",
          measured: true,
          triggers: [
            { selector: "#b .grid", start: null, end: null, scrub: false, pin: false, durationMs: 600, ease: "power1.out" },
          ],
          initialHidden: [],
          animatedSelectors: ["#b .grid"],
        },
        { id: "c", component: "Section03", measured: true, triggers: [], initialHidden: [], animatedSelectors: [] },
      ],
    });
  });

  it("DOM-only manifest scans inline initial states + animation/transition/class hints", () => {
    const html = `<!doctype html><html><body><main id="main">
      <section id="a">
        <h1 class="title reveal" style="opacity:0; transform: translateY(24px)">Alpha</h1>
        <p style="visibility:hidden">Cap</p>
        <div class="fade-in" style="animation: rise 600ms ease">A</div>
      </section>
      <section id="b"><div class="grid" style="transition: opacity 200ms">B</div><span class="slide-up">x</span></section>
    </main></body></html>`;
    expect(buildMotionManifest(splitBuild(html))).toEqual({
      version: 1,
      measured: false,
      sections: [
        {
          id: "a",
          component: "Section01",
          measured: false,
          triggers: [],
          initialHidden: [
            { selector: "#a .title", hint: "opacity:0" },
            { selector: "#a .title", hint: "transform:translate" },
            { selector: "#a p", hint: "visibility:hidden" },
          ],
          animatedSelectors: ["#a .title", "#a .fade-in"],
        },
        {
          id: "b",
          component: "Section02",
          measured: false,
          triggers: [],
          initialHidden: [],
          animatedSelectors: ["#b .grid", "#b .slide-up"],
        },
      ],
    });
  });

  it("attributes an unowned measured selector to no section (never guesses)", () => {
    const parsed = normalizeScrollCensus({
      anims: [{ selector: ".unknown", durationMs: 10, easing: "linear", scrub: false, pin: false }],
      gsapTriggers: [],
    });
    if ("error" in parsed) throw new Error(parsed.error);
    const manifest = buildMotionManifest(splitBuild(sample4()), parsed.census);
    expect(manifest.sections.every((s) => s.triggers.length === 0)).toBe(true);
    expect(manifest.unattributed).toEqual([
      { selector: ".unknown", start: null, end: null, scrub: false, pin: false, durationMs: 10, ease: "linear" },
    ]);
  });
});

describe("motion skeletons", () => {
  const split = splitBuild(sample4());
  const manifest = measuredManifest();

  it("next: guard hook, per-section hooks only for measured sections, ordered MotionRoot", () => {
    const f = byPath(emitNext(split, "", "x", { manifest, authored: false }).files);
    expect(f["hooks/useSectionMotion.ts"]).toContain('"use client"');
    expect(f["hooks/useSectionMotion.ts"]).toContain("prefers-reduced-motion: reduce");
    expect(f["hooks/useSection01Motion.ts"]).toContain("gsap.context");
    expect(f["hooks/useSection02Motion.ts"]).toContain("gsap.context");
    expect(f["hooks/useSection03Motion.ts"]).toBeUndefined();
    for (const hook of ["hooks/useSection01Motion.ts", "hooks/useSection02Motion.ts"]) {
      const text = f[hook] ?? "";
      expect(text).toContain('"use client"');
      expect(text).toContain("prefersReducedMotion()");
      expect(text).toContain("prefers-reduced-motion");
      expect(text).toContain("TODO: author steps");
      expect(text).toContain("ScrollTrigger.refresh()");
      expect(text).not.toContain("app.js");
    }
    const root = f["components/MotionRoot.tsx"] ?? "";
    expect(root.indexOf("useSection01Motion();")).toBeLessThan(root.indexOf("useSection02Motion();"));
    expect(root).toContain("return null;");
  });

  it("vite/astro: one init module per section + ordered registry, inert by default", () => {
    for (const emitted of [emitVite(split, "", "x", { manifest, authored: false }), emitAstro(split, "", "x", { manifest, authored: false })]) {
      const f = byPath(emitted.files);
      for (let i = 1; i <= 3; i++) {
        const text = f[`src/animations/section0${i}.js`] ?? "";
        expect(text).toContain(`export function initSection0${i}()`);
        expect(text).toContain("prefers-reduced-motion: reduce");
      }
      expect(f["src/animations/section01.js"]).toContain("TODO: author steps");
      const registry = f["src/animations/registry.js"] ?? "";
      expect(registry.indexOf("./section01.js")).toBeLessThan(registry.indexOf("./section02.js"));
      expect(registry.indexOf("./section02.js")).toBeLessThan(registry.indexOf("./section03.js"));
      expect(registry).toContain("export function initAnimations()");
      expect(JSON.parse(f["motion.manifest.json"] ?? "{}").measured).toBe(true);
    }
    const vite = byPath(emitVite(split, "", "x", { manifest, authored: false }).files);
    expect(vite["src/main.js"]).not.toContain("initAnimations");
    const astro = byPath(emitAstro(split, "", "x", { manifest, authored: false }).files);
    expect(astro["src/components/Section01.astro"]).not.toContain("animations/");
  });
});

describe("--authored", () => {
  const LIBS = [
    "vendor/gsap.min.js",
    "vendor/ScrollTrigger.min.js",
    "vendor/lenis.min.js",
    "vendor/split-type.min.js",
    "vendor/CircleType.min.js",
    "vendor/lottie.min.js",
  ];
  const order = (text: string, needles: string[]): number[] => needles.map((n) => text.indexOf(n));

  it("keeps the head boot + animation libraries, drops site logic", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awwwards-n2-authored-libs-"));
    try {
      const trees: Record<string, Record<string, string>> = {};
      for (const target of ["vite", "astro", "next"] as const) {
        const out = join(dir, target);
        const res = await buildProject({
          html: join(FIXTURES, "sample5.html"),
          target,
          out,
          motion: join(FIXTURES, "census.json"),
          authored: true,
        });
        if ("error" in res) throw new Error(res.error);
        trees[target] = readTree(out);
      }

      // (a) head inline boot survives pre-paint, after the remote head script.
      const heads: Record<string, string> = {
        next: trees.next?.["app/layout.tsx"] ?? "",
        astro: trees.astro?.["src/pages/index.astro"] ?? "",
        vite: trees.vite?.["index.html"] ?? "",
      };
      for (const [target, head] of Object.entries(heads)) {
        expect(`${target}:${/classList\.add\(\\?"rm\\?"\)/.test(head)}`).toBe(`${target}:true`);
        expect(head.indexOf("https://cdn.test/extra.js")).toBeGreaterThan(-1);
        expect(head.indexOf("https://cdn.test/extra.js")).toBeLessThan(head.indexOf("classList.add"));
        expect(head.indexOf("classList.add")).toBeLessThan(head.indexOf("</head>"));
      }

      // (b) animation libraries keep their file + ordered reference.
      const nextLoader = trees.next?.["components/SiteScripts.tsx"] ?? "";
      expect(nextLoader.indexOf("/scripts/vendor/gsap.min.js")).toBeLessThan(nextLoader.indexOf("/scripts/vendor/ScrollTrigger.min.js"));
      expect(nextLoader.indexOf("/scripts/vendor/ScrollTrigger.min.js")).toBeLessThan(nextLoader.indexOf("/scripts/vendor/lenis.min.js"));
      for (const lib of LIBS) expect(nextLoader).toContain(`/scripts/${lib}`);

      const viteIndex = trees.vite?.["index.html"] ?? "";
      const viteOrder = order(viteIndex, LIBS.map((lib) => `/src/scripts/${lib}`));
      expect(viteOrder.every((at) => at > -1)).toBe(true);
      expect(viteOrder).toEqual([...viteOrder].sort((a, b) => a - b));
      const astroIndex = trees.astro?.["src/pages/index.astro"] ?? "";
      const astroOrder = order(astroIndex, LIBS.map((lib) => `is:inline src="/scripts/${lib}"`));
      expect(astroOrder.every((at) => at > -1)).toBe(true);
      expect(astroOrder).toEqual([...astroOrder].sort((a, b) => a - b));

      for (const [root, scriptRoot] of [
        [join(dir, "next"), join("public", "scripts")],
        [join(dir, "astro"), join("public", "scripts")],
        [join(dir, "vite"), join("src", "scripts")],
      ] as const) {
        for (const lib of LIBS) expect(existsSync(join(root, scriptRoot, lib))).toBe(true);
        expect(existsSync(join(root, scriptRoot, "app.js"))).toBe(false);
        expect(existsSync(join(root, scriptRoot, "neu-ix.js"))).toBe(false);
      }

      // Site logic is gone from every emitted file (vendor bundles are opaque
      // libraries and may contain arbitrary strings).
      for (const [target, tree] of Object.entries(trees)) {
        for (const [path, text] of Object.entries(tree)) {
          if (path.includes("/vendor/")) continue;
          for (const needle of ["app.js", "neu-ix.js", "NEU_IX", "__order", "nativeTail"]) {
            if (text.includes(needle)) throw new Error(`${target}/${path} still references site logic: ${needle}`);
          }
        }
      }

      expect(trees.next?.["app/layout.tsx"]).toContain("<SiteScripts />");
      expect(trees.next?.["app/layout.tsx"]).toContain("<MotionRoot />");
      expect(trees.next?.["components/MotionRoot.tsx"]).toContain("useSection01Motion();");
      expect(trees.vite?.["src/main.js"]).toContain("initAnimations();");
      expect(trees.astro?.["src/components/Section01.astro"]).toContain('from "../animations/section01.js"');
      expect(trees.astro?.["src/components/Section01.astro"]).toContain("initSection01();");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps vendor loaders even without measured triggers; MotionRoot stays absent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awwwards-n2-authored-dom-"));
    try {
      const res = await buildProject({
        html: join(FIXTURES, "sample4.html"),
        target: "next",
        out: join(dir, "next"),
        authored: true,
      });
      if ("error" in res) throw new Error(res.error);
      const tree = readTree(join(dir, "next"));
      expect(tree["app/layout.tsx"]).toContain("<SiteScripts />");
      expect(tree["app/layout.tsx"]).toContain("classList.add");
      expect(tree["app/layout.tsx"]).not.toContain("MotionRoot");
      expect(tree["components/MotionRoot.tsx"]).toBeUndefined();
      expect(tree["components/SiteScripts.tsx"]).toContain("/scripts/vendor/gsap.min.js");
      expect(tree["components/SiteScripts.tsx"]).not.toContain("app.js");
      expect(JSON.parse(tree["motion.manifest.json"] ?? "{}").measured).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("authored Vite skeleton builds", () => {
  const VITE_BIN = join(process.cwd(), "node_modules", "vite", "bin", "vite.js");
  it.skipIf(!existsSync(VITE_BIN))("vite build resolves the ordered registry + gsap skeleton imports", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awwwards-n2-vite-build-"));
    try {
      const out = join(dir, "app");
      const res = await buildProject({
        html: join(FIXTURES, "sample4.html"),
        target: "vite",
        out,
        motion: join(FIXTURES, "census.json"),
        authored: true,
      });
      if ("error" in res) throw new Error(res.error);
      // Offline stand-in for the declared gsap dependency: the build only needs
      // the module surface the skeletons import.
      const gsap = join(out, "node_modules", "gsap");
      mkdirSync(gsap, { recursive: true });
      writeFileSync(
        join(gsap, "package.json"),
        JSON.stringify({ name: "gsap", version: "3.0.0", type: "module", main: "index.js", exports: { ".": "./index.js", "./ScrollTrigger": "./ScrollTrigger.js" } }),
      );
      writeFileSync(join(gsap, "index.js"), "const gsap = { registerPlugin() {}, context(fn) { fn(); return { revert() {} }; } };\nexport default gsap;\nexport { gsap };\n");
      writeFileSync(join(gsap, "ScrollTrigger.js"), "export const ScrollTrigger = { refresh() {} };\n");
      execFileSync(process.execPath, [VITE_BIN, "build", "--logLevel", "warn"], { cwd: out, stdio: "pipe" });
      expect(existsSync(join(out, "dist", "index.html"))).toBe(true);
      expect(existsSync(join(out, "dist", "src", "scripts", "app.js"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("default output stays byte-identical", () => {
  it("adds only motion.manifest.json + skeletons; every pre-N2 file keeps its bytes", () => {
    const split = splitBuild(sample4());
    const emitted = {
      vite: emitVite(split, "", "Native Structure"),
      astro: emitAstro(split, "", "Native Structure"),
      next: emitNext(split, "", "Native Structure"),
    };
    for (const [target, result] of Object.entries(emitted)) {
      const f = byPath(result.files);
      for (const [path, expected] of Object.entries(GOLDEN[target] ?? {})) {
        expect(`${target}:${path}:${hash(f[path] ?? "")}`).toBe(`${target}:${path}:${expected}`);
      }
      expect(f["motion.manifest.json"]).toBeDefined();
    }
    expect(emitted.next.files.some((f) => f.path === "components/SiteScripts.tsx")).toBe(true);
    expect(byPath(emitted.vite.files)["index.html"]).toContain('src="/src/scripts/app.js"');
    expect(byPath(emitted.astro.files)["src/pages/index.astro"]).toContain('is:inline src="/scripts/app.js"');
  });
});

describe("buildProject --motion errors", () => {
  it("missing file and invalid JSON are errors, not partial trees", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awwwards-n2-motion-err-"));
    try {
      const missing = await buildProject({
        html: join(FIXTURES, "sample4.html"),
        target: "vite",
        out: join(dir, "a"),
        motion: join(dir, "gone.json"),
      });
      expect("error" in missing && missing.error).toContain("cannot read motion census");

      const badPath = join(dir, "bad.json");
      writeFileSync(badPath, "{ not json");
      const bad = await buildProject({
        html: join(FIXTURES, "sample4.html"),
        target: "vite",
        out: join(dir, "b"),
        motion: badPath,
      });
      expect("error" in bad && bad.error).toContain("not valid JSON");

      const shapePath = join(dir, "shape.json");
      writeFileSync(shapePath, JSON.stringify({ anims: [] }));
      const shape = await buildProject({
        html: join(FIXTURES, "sample4.html"),
        target: "vite",
        out: join(dir, "c"),
        motion: shapePath,
      });
      expect("error" in shape && shape.error).toContain("gsapTriggers[] is missing");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("CLI flags", () => {
  it("parseBuildArgs accepts --motion (space/=) and --authored; bare --motion is usage", () => {
    expect(parseBuildArgs(["a.html", "--target", "next", "--out", "o", "--motion", "c.json", "--authored"])).toEqual({
      html: "a.html",
      target: "next",
      out: "o",
      motion: "c.json",
      authored: true,
    });
    expect(parseBuildArgs(["a.html", "--target=next", "--out=o", "--motion=c.json"])).toEqual({
      html: "a.html",
      target: "next",
      out: "o",
      motion: "c.json",
    });
    expect(parseBuildArgs(["a.html", "--target", "next", "--out", "o", "--motion"])).toEqual({
      error: expect.stringContaining("usage: awwwards-build-project"),
    });
  });
});

describe("emitted Next tree type-checks under a strict React stub", () => {
  it("hooks + MotionRoot + layout/page/sections compile with strict + noLib stubs", () => {
    const manifest = measuredManifest();
    const tree = byPath(
      emitNext(splitBuild(sample4()), "", "x", { manifest, authored: true }).files,
    );
    const checkFiles: Record<string, string> = {
      "/react.d.ts": `declare module "react" {
  export type ReactNode = unknown;
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
}
`,
      "/gsap.d.ts": `declare module "gsap" {
  const gsap: {
    registerPlugin(plugin: unknown): void;
    context(fn: () => void): { revert(): void };
  };
  export default gsap;
}
declare module "gsap/ScrollTrigger" {
  export const ScrollTrigger: { refresh(): void };
}
`,
      "/globals.d.ts": `declare const window: { matchMedia(query: string): { matches: boolean } };
`,
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
    a: { className?: string; href?: string; children?: unknown };
    div: { className?: string; id?: string; role?: string; "aria-label"?: string; "aria-modal"?: string; "aria-labelledby"?: string; hidden?: boolean; children?: unknown };
    header: { className?: string; children?: unknown };
    b: { className?: string; children?: unknown };
    nav: { className?: string; "aria-label"?: string; children?: unknown };
    button: { "data-go"?: string; children?: unknown };
    section: { className?: string; id?: string; "aria-label"?: string; "data-bg"?: string; children?: unknown };
    h1: { className?: string; children?: unknown };
    h2: { className?: string; id?: string; children?: unknown };
    p: { className?: string; children?: unknown };
    title: { children?: unknown };
    link: { rel?: string; href?: string; type?: string };
    meta: { name?: string; content?: string; property?: string };
    script: { type?: string; dangerouslySetInnerHTML?: { __html: string } };
  }
}
`,
    };
    for (const [path, content] of Object.entries(tree)) {
      if (path === "components/SiteScripts.tsx") continue; // unchanged pre-N2 loader; DOM-faked in native tests
      if (/\.tsx?$/.test(path)) checkFiles[`/${path}`] = content;
    }
    checkFiles["/components/SiteScripts.tsx"] = "export default function SiteScripts() {\n  return null;\n}\n";
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
        const source = checkFiles[ts.normalizePath(name)];
        if (source === undefined) return undefined;
        return ts.createSourceFile(
          name,
          source,
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
  });
});
