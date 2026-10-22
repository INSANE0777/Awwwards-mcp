// build_project core (v1.12, local-only): a single-file exact rebuild (the
// kit's full-page-exact.html shape) -> runnable Vite/Astro project files.
// The builder converts, never invents: section markup, css and timelines ship
// verbatim; no {{slot:*}} marker exists anywhere in this flow. Only asset
// paths move: css url()s are re-based to their new home (src/styles vs
// project root); markup bytes are never touched.
//
// Emitters are PURE (files arrays) so trees stay byte-deterministic and
// testable offline; disk writing + the CLI loop are Task-3 wiring. The outDir
// params exist for that wiring's call symmetry and are deliberately unused
// here. Exit-code law lives in parseBuildArgs: 0 ok / 2 bad args (returned as
// {error}) / 3 io (thrown upstream) — the Task-3 bin mirrors verify-cli's
// mapping. No console.* in this module: all user-visible output is returned.

import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
// Call-time-only cycle (house precedent: capture.ts/structure.ts) — the
// vite/next emit dispatch below and emit-next's cssTo/nn/attributeBlocks both
// resolve at invocation, never at module eval.
import { emitNext } from "./emit-next.js";

export interface RebuildSection {
  tag: string;
  className: string; // first class token of the root ("" when classless); rebuild roots are `c-N`
  startTag: string; // verbatim opening tag
  innerHtml: string; // verbatim between opening and closing tag
  closeTag: string; // verbatim closing tag
  text: string; // startTag + innerHtml + closeTag — the whole element
}

export interface ParsedSections {
  sections: RebuildSection[] | null;
  detected: "rebuild" | "generic";
}

export interface SplitStyles {
  tokensCss: string; // verbatim :root block(s), "" when none
  headLinks: string[]; // verbatim <link rel=stylesheet> tags (font services ship; content urls never)
  perSection: Map<string, string>; // className -> rules whose selectors mention it (class-safe match)
  sharedCss: string; // all other top-level rules, incl. shared @media guards
}

export interface TimelineBlock {
  className: string; // section class the block animates ("" when unattributable)
  js: string; // comment + timeline, lines trimmed
}

export interface ExternalScript {
  tag: string; // verbatim <script ...>...</script>
  src: string;
  local: boolean; // relative local ref (no scheme, //, / or #)
  head: boolean;
}

export type BodyScript =
  | { kind: "external"; tag: string; src: string; local: boolean }
  | { kind: "inline"; js: string };

export interface ExtractedScripts {
  cdns: string[]; // verbatim gsap/ScrollTrigger <script src> tags (dependency law)
  externals: ExternalScript[]; // every external script tag, document order
  inlineJs: string; // all JS-typed inline <script> bodies, trim-joined
  inlineBlocks: Array<{ js: string; head: boolean }>; // same bodies with placement
  headInlineJs: string[]; // inline JS bodies that sat in <head>
  headExternal: string[]; // external tags that sat in <head>
  bodyScripts: BodyScript[]; // body scripts outside section roots, document order
  timelineBlocks: TimelineBlock[];
}

export interface ScaffoldFile {
  path: string;
  content: string;
}

export interface Split {
  html: string;
  sections: ParsedSections;
  styles: SplitStyles;
  scripts: ExtractedScripts;
  assetRefs: string[]; // unique local refs in document order
}

// Generic rehost pages (e.g. a Webflow export) carry nav/loader/utility as
// top-level divs. Treating only semantic tags as roots silently dropped them.
const GENERIC_CONTAINERS = new Set(["section", "header", "footer", "main", "nav", "aside", "article", "div", "form"]);
const REBUILD_ROOT_CLASS = /^c-\d+$/;
const CDN_SRC = /(gsap|scrolltrigger)/i;
const SCRIPT_RE = /(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi;
const JS_TYPES = new Set([
  "",
  "module",
  "text/javascript",
  "application/javascript",
  "text/ecmascript",
  "application/ecmascript",
]);
const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

// Class-safe mention: ".c-12" must not bucket onto section ".c-1".
const mentions = (selector: string, cls: string): boolean =>
  new RegExp(`(?:^|[^\\w-])${cls.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(selector);

const attr = (startTag: string, name: string): string => {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(startTag);
  return m ? (m[1] ?? m[2] ?? m[3] ?? "") : "";
};

// Index of the `>` that closes the tag opened at `start` (quote-aware so
// attribute values containing ">" cannot truncate it).
const tagEnd = (html: string, start: number): number => {
  let q: string | null = null;
  for (let i = start + 1; i < html.length; i++) {
    const c = html[i];
    if (q !== null) {
      if (c === q) q = null;
    } else if (c === '"' || c === "'") {
      q = c;
    } else if (c === ">") {
      return i;
    }
  }
  return -1;
};

// Index of the matching close for the element opened before `from`, or -1.
// Depth-counts the same tag; comments and script bodies are skipped whole so
// commented-out markup or inline JS can never fake a close.
const findClose = (html: string, from: number, tag: string): number => {
  const re = new RegExp(`<!--|<script\\b|</script\\s*>|<${tag}(?=[\\s/>])|</${tag}\\s*>`, "gi");
  re.lastIndex = from;
  let depth = 1;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const t = m[0].toLowerCase();
    if (t === "<!--") {
      const j = html.indexOf("-->", m.index + 4);
      if (j === -1) return -1;
      re.lastIndex = j + 3;
    } else if (t.startsWith("<script")) {
      const sc = /<\/script\s*>/gi;
      sc.lastIndex = m.index;
      const end = sc.exec(html);
      if (!end) return -1;
      re.lastIndex = end.index + end[0].length;
    } else if (t.startsWith("</")) {
      depth -= 1;
      if (depth === 0) return m.index;
    } else {
      depth += 1;
    }
  }
  return -1;
};

const walkTopLevel = (body: string): RebuildSection[] => {
  const roots: RebuildSection[] = [];
  let i = 0;
  while (i < body.length) {
    if (body.startsWith("<!--", i)) {
      const j = body.indexOf("-->", i + 4);
      i = j === -1 ? body.length : j + 3;
      continue;
    }
    if (body[i] !== "<") {
      i += 1;
      continue;
    }
    const m = /^<([a-zA-Z][a-zA-Z0-9-]*)(?=[\s/>])/.exec(body.slice(i, i + 60));
    if (!m) {
      i += 1;
      continue;
    }
    const tag = m[1].toLowerCase();
    const gt = tagEnd(body, i);
    if (gt === -1) break;
    const start = i;
    const startTag = body.slice(start, gt + 1);
    i = gt + 1;
    if (VOID_TAGS.has(tag) || /\/\s*>$/.test(startTag)) continue;
    const close = findClose(body, i, tag);
    if (close === -1) continue; // unterminated container: skip the tag, keep scanning
    const closeEnd = body.indexOf(">", close) + 1;
    roots.push({
      tag,
      className: attr(startTag, "class").trim().split(/\s+/)[0] ?? "",
      startTag,
      innerHtml: body.slice(gt + 1, close),
      closeTag: body.slice(close, closeEnd),
      text: body.slice(start, closeEnd),
    });
    i = closeEnd;
  }
  return roots;
};

// Primary shape: the kit's rebuild output, whose TOP-LEVEL body children are
// the per-band roots <tag class="c-N"> — div roots included (real captures
// emit section AND div band roots; keying on the c-N class, not the tag,
// keeps every band). Fallback: top-level section/header/footer/main tags.
export function parseRebuildSections(html: string): ParsedSections {
  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html;
  const roots = walkTopLevel(body);
  const rebuild = roots.filter((r) => r.className !== "" && REBUILD_ROOT_CLASS.test(r.className));
  const generic = roots.filter((r) => GENERIC_CONTAINERS.has(r.tag));
  const chosen = rebuild.length ? rebuild : generic;
  return {
    sections: chosen.length ? chosen : null,
    detected: rebuild.length ? "rebuild" : "generic",
  };
}

const autoSectionClasses = (html: string): string[] =>
  parseRebuildSections(html).sections?.map((s) => s.className) ?? [];

// Top-level rule split by brace depth; comments are skipped whole (their
// braces must not split rules) and nested at-rule bodies (the reduced-motion
// guard) stay inside one rule.
const parseRules = (css: string): string[] => {
  const rules: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    if (css.startsWith("/*", i)) {
      const j = css.indexOf("*/", i + 2);
      i = j === -1 ? css.length : j + 1;
      continue;
    }
    const ch = css[i];
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0) {
        const rule = css.slice(start, i + 1).trim();
        if (rule) rules.push(rule);
        start = i + 1;
      }
    }
  }
  return rules;
};

export function splitStyles(html: string, classNames: string[] = autoSectionClasses(html)): SplitStyles {
  const allCss = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n");
  const rootRe = /:root\s*\{[^{}]*\}/g;
  const tokens = [...allCss.matchAll(rootRe)].map((m) => m[0]);
  const rest = allCss.replace(rootRe, "");
  const headLinks: string[] = [];
  for (const m of html.matchAll(/<link\s[^>]*rel\s*=\s*["']?stylesheet["']?[^>]*>/gi)) {
    if (!headLinks.includes(m[0])) headLinks.push(m[0]);
  }
  const buckets = new Map<string, string[]>();
  const shared: string[] = [];
  for (const rule of parseRules(rest)) {
    const selector = rule.slice(0, Math.max(0, rule.indexOf("{")));
    const owner = classNames.find((cls) => cls !== "" && mentions(selector, cls));
    if (owner) {
      const bucket = buckets.get(owner) ?? [];
      bucket.push(rule);
      buckets.set(owner, bucket);
    } else {
      shared.push(rule);
    }
  }
  const perSection = new Map<string, string>();
  for (const [cls, bucket] of buckets) perSection.set(cls, bucket.join("\n"));
  return {
    tokensCss: tokens.join("\n"),
    headLinks,
    perSection,
    sharedCss: shared.join("\n"),
  };
}

// Rebuild-shape anim block: a `// captured anim` / `// motion-dna sample`
// comment line anchors one gsap.timeline(...) whose final call is `.from(...);`
// — the same terminating shape the kit emits. The `.from(` args are walked
// with a quote-aware balanced-paren scan, not a `[^;]*` regex: real captions
// carry semicolon-bearing callbacks (`onStart: () => { mark(); }`) and
// function-typed scrollTrigger ends (`end: "function(){ return x; }"`), and a
// semicolon-terminated pattern would silently drop the whole block (no
// component wiring, no page-level fallback).
const TIMELINE_BLOCK_RE = /\/\/ (?:captured anim|motion-dna sample)[^\n]*\n/g;

// Index just past the `;` that terminates the first `.from(...)` at/after
// `from`, or -1 when parens never balance (generator output always ends the
// final call with `;`, so a missing `;` stays a non-block).
const fromCallEnd = (js: string, from: number): number => {
  const open = js.indexOf(".from(", from);
  if (open === -1) return -1;
  let depth = 1;
  let q: string | null = null;
  for (let i = open + 6; i < js.length; i++) {
    const c = js[i];
    if (q !== null) {
      if (c === "\\") i += 1;
      else if (c === q) q = null;
    } else if (c === '"' || c === "'" || c === "`") {
      q = c;
    } else if (c === "(") {
      depth += 1;
    } else if (c === ")") {
      depth -= 1;
      if (depth === 0) return js[i + 1] === ";" ? i + 2 : -1;
    }
  }
  return -1;
};

const collectTimelineBlocks = (js: string): TimelineBlock[] => {
  const blocks: TimelineBlock[] = [];
  for (const m of js.matchAll(TIMELINE_BLOCK_RE)) {
    const end = fromCallEnd(js, m.index + m[0].length);
    if (end === -1) continue;
    const text = js.slice(m.index, end);
    blocks.push({
      className: /\.c-\d+/.exec(text)?.[0].slice(1) ?? "",
      js: text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .join("\n"),
    });
  }
  return blocks;
};

// A relative local ref: no scheme, no protocol-relative, no root-absolute, no anchor.
export const isLocalRef = (ref: string): boolean =>
  ref !== "" && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i.test(ref);

const headEnd = (html: string): number => {
  const m = /<\/head\s*>/i.exec(html);
  return m ? m.index : -1;
};

export function extractScripts(html: string): ExtractedScripts {
  const cdns: string[] = [];
  const externals: ExternalScript[] = [];
  const inline: string[] = [];
  const inlineBlocks: Array<{ js: string; head: boolean }> = [];
  const bodyScripts: BodyScript[] = [];
  const hEnd = headEnd(html);
  for (const m of html.matchAll(SCRIPT_RE)) {
    const tag = (m[1] ?? "") + (m[2] ?? "") + (m[3] ?? "");
    const head = hEnd === -1 || (m.index ?? 0) < hEnd;
    const src = attr(m[1] ?? "", "src");
    if (src !== "") {
      const local = isLocalRef(src);
      externals.push({ tag, src, local, head });
      if (!head) bodyScripts.push({ kind: "external", tag, src, local });
      if (CDN_SRC.test(src)) cdns.push(tag);
      continue;
    }
    // importmap/ld+json modules are data, not page JS
    if (!JS_TYPES.has(attr(m[1] ?? "", "type").toLowerCase().trim())) continue;
    const js = (m[2] ?? "").trim();
    inline.push(js);
    inlineBlocks.push({ js, head });
    if (!head) bodyScripts.push({ kind: "inline", js });
  }
  const timelineBlocks = inline.flatMap(collectTimelineBlocks);
  return {
    cdns,
    externals,
    inlineJs: inline.join("\n\n"),
    inlineBlocks,
    headInlineJs: inlineBlocks.filter((b) => b.head).map((b) => b.js),
    headExternal: externals.filter((e) => e.head).map((e) => e.tag),
    bodyScripts,
    timelineBlocks,
  };
}

// Local refs in markup (asset-ish tags + url()) in document order. Remote
// URLs, root-absolute paths and refs containing ".." never enter the list, so
// copies can never climb out of the output dir.
const ASSET_REF_RE =
  /<(?:link|script|img|image|source|video|audio|track)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["'][^>]*>|url\(\s*["']?([^)"'\s]+)["']?\s*\)/gi;

const collectAssetRefs = (html: string): string[] => {
  const seen = new Set<string>();
  const refs: string[] = [];
  for (const m of html.matchAll(ASSET_REF_RE)) {
    const ref = m[1] ?? m[2];
    if (!ref || ref.includes("..") || !isLocalRef(ref)) continue;
    const key = ref.replace(/^\.\//, "");
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(ref);
  }
  return refs;
};

export interface CopyAssetsResult {
  copied: string[];
  missing: string[];
}

// Copies every local ref into <outDir>/<into>/<ref path>, preserving the
// source's relative shape (assets/css/js keep resolving next to their page).
// A missing source is a warning (missing[]), never a hard failure.
export async function copyAssets(html: string, srcDir: string, outDir: string, opts: { into?: string } = {}): Promise<CopyAssetsResult> {
  const root = join(resolve(outDir), opts.into ?? "");
  const copied: string[] = [];
  const missing: string[] = [];
  for (const ref of collectAssetRefs(html)) {
    const to = join(root, ref.replace(/^\.\//, ""));
    const from = resolve(srcDir, ref);
    try {
      await mkdir(dirname(to), { recursive: true });
      await copyFile(from, to);
      copied.push(ref);
    } catch {
      missing.push(ref);
    }
  }
  return { copied, missing };
}

const bodyInner = (html: string): string => /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html;

export function splitBuild(html: string): Split {
  const sections = parseRebuildSections(html);
  const scripts = extractScripts(html);
  // Scripts inside a section root stay in that markup; only loose body
  // scripts are re-emitted at page level (dedupe law: never execute twice).
  const roots = sections.sections ?? [];
  scripts.bodyScripts = scripts.bodyScripts.filter((b) =>
    b.kind === "external" ? !roots.some((s) => s.text.includes(b.tag)) : !roots.some((s) => s.text.includes(b.js)),
  );
  return {
    html,
    sections,
    styles: splitStyles(html),
    scripts,
    assetRefs: collectAssetRefs(html),
  };
}

export interface BuildProjectArgs {
  html: string;
  target: "vite" | "astro" | "next";
  out: string;
  name?: string;
}

export const BUILD_ARGS_USAGE = "usage: awwwards-build-project <html> --target vite|astro|next --out <dir> [--name pkg]";

// Pure arg model for the (Task-3) bin: parse here, map exit codes there.
export function parseBuildArgs(argv: string[]): BuildProjectArgs | { error: string } {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const inline = /^(--target|--out|--name)=(.*)$/.exec(argv[i]);
    if (inline) {
      flags.set((inline[1] ?? "").slice(2), inline[2] ?? "");
      continue;
    }
    if (argv[i] === "--target" || argv[i] === "--out" || argv[i] === "--name") {
      if (i + 1 >= argv.length) return { error: BUILD_ARGS_USAGE };
      flags.set(argv[i].slice(2), argv[i + 1] ?? "");
      i += 1;
      continue;
    }
    positional.push(argv[i]);
  }
  const target = flags.get("target");
  const out = flags.get("out");
  if (positional.length !== 1 || !target || !out) return { error: BUILD_ARGS_USAGE };
  if (target !== "vite" && target !== "astro" && target !== "next") return { error: BUILD_ARGS_USAGE };
  const name = flags.get("name");
  return { html: positional[0] ?? "", target, out, ...(name ? { name } : {}) };
}

export const packageName = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-._]+|[-._]+$/g, "") || "rebuild-site";

const indent = (text: string, n: number): string =>
  text
    .split("\n")
    .map((l) => (l ? " ".repeat(n) + l : l))
    .join("\n");

// css ships into src/styles/, so ./assets url()s re-base (vite ../../assets,
// astro /assets, next /assets); quoted and bare url() forms both covered.
export const cssTo = (css: string, assetsBase: string): string => {
  const out = css.replace(/url\(\s*(["']?)\.\/assets\//g, `url($1${assetsBase}`);
  return out.endsWith("\n") ? out : out + "\n";
};

const sectionsBodyHtml = (split: Split): string => (split.sections.sections ?? []).map((s) => s.text).join("\n");

const j = (obj: object): string => JSON.stringify(obj, null, 2) + "\n";

// Anim blocks land with their section: exact root-class match first, else the
// ONE section whose subtree mentions the class (kit renumbering makes a class
// name at most one section). Ambiguous blocks fall back to the page-level
// script so no captured timeline is ever dropped.
export const attributeBlocks = (split: Split): { perSection: Map<string, string[]>; pageLevel: string[] } => {
  const sections = split.sections.sections ?? [];
  const classSet = new Set(sections.map((s) => s.className));
  const perSection = new Map<string, string[]>();
  const pageLevel: string[] = [];
  for (const b of split.scripts.timelineBlocks) {
    let target = classSet.has(b.className) ? b.className : undefined;
    if (!target && b.className !== "") {
      const hits = sections.filter((s) => mentions(s.text, b.className));
      target = hits.length === 1 ? hits[0]?.className : undefined;
    }
    if (target !== undefined) {
      const list = perSection.get(target) ?? [];
      list.push(b.js);
      perSection.set(target, list);
    } else {
      pageLevel.push(b.js);
    }
  }
  return { perSection, pageLevel };
};

// Mirrors the kit's astroSection script shape: bundle-safe module, CDN globals,
// reduced-motion guard identical to the source rebuild.
const timelineScript = (blocks: string[]): string =>
  `<script>
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    gsap.registerPlugin(ScrollTrigger);
${blocks.map((b) => indent(b, 4)).join("\n\n")}
    ScrollTrigger.refresh();
  }
</script>
`;

// Astro bundles every <script> in a component by default (module, deferred);
// `is:inline` keeps captured page scripts byte-verbatim and parse-time.
const astroInlineTags = (html: string): string => html.replace(/<script\b/gi, "<script is:inline");

export const nn = (i: number): string => `Section${String(i + 1).padStart(2, "0")}`;

export function emitAstro(split: Split, outDir: string, name: string): { files: ScaffoldFile[] } {
  void outDir; // params kept for Task-3 wiring symmetry; emitters are pure
  const files: ScaffoldFile[] = [];
  const add = (path: string, content: string) => files.push({ path, content });
  const sections = split.sections.sections ?? [];
  const attributed = attributeBlocks(split);
  const cssBase = "/assets/"; // astro serves public/assets at the site root

  add(
    "package.json",
    j({
      name: packageName(name),
      private: true,
      version: "0.1.0",
      type: "module",
      scripts: { dev: "astro dev", build: "astro build", preview: "astro preview" },
      dependencies: { astro: "^5" },
    }),
  );
  add("astro.config.mjs", 'import { defineConfig } from "astro/config";\n\nexport default defineConfig({});\n');

  const imports: string[] = [];
  if (split.styles.tokensCss) add("src/styles/tokens.css", cssTo(split.styles.tokensCss, cssBase));
  if (split.styles.tokensCss) imports.push('import "../styles/tokens.css";');
  if (split.styles.sharedCss) add("src/styles/shared.css", cssTo(split.styles.sharedCss, cssBase));
  if (split.styles.sharedCss) imports.push('import "../styles/shared.css";');
  sections.forEach((s, i) => {
    const css = split.styles.perSection.get(s.className) ?? "";
    if (css === "") return;
    add(`src/styles/section-${i + 1}.css`, cssTo(css, cssBase));
    imports.push(`import "../styles/section-${i + 1}.css";`);
  });
  // astro resolves <SectionNN /> only via frontmatter imports; without these the
  // build fails with "Section01 is not defined" at static-route render time.
  sections.forEach((_, i) => imports.push(`import ${nn(i)} from "../components/${nn(i)}.astro";`));

  const generic = split.sections.detected === "generic";
  const headTags = [
    ...split.scripts.headExternal,
    ...split.styles.headLinks,
    ...(generic ? split.scripts.headInlineJs.map((js) => `<script is:inline>\n${js}\n</script>`) : []),
  ];
  const bodyTags = (generic
    ? split.scripts.bodyScripts
    : split.scripts.bodyScripts.filter((b): b is Extract<BodyScript, { kind: "external" }> => b.kind === "external"))
    .map((b) =>
      b.kind === "external"
        ? b.tag.replace(/^<script\b/i, "<script is:inline")
        : `<script is:inline>\n${b.js}\n</script>`,
    )
    .join("\n");
  // Generic rehost bodies keep their inline scripts in place (section markup +
  // loose body tags), so no whole-script copy is hoisted here. Rebuild shape
  // keeps the kit's attributed timelines as before.
  const pageLevelScript =
    generic || attributed.pageLevel.length === 0 ? "" : `\n${timelineScript(attributed.pageLevel)}`;
  add(
    "src/pages/index.astro",
    `---
// Generated by awwwards-build-project — exact rebuild, real content, no slots.
${imports.join("\n")}
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${name}</title>
${headTags.map((t) => indent(t, 4)).join("\n")}
  </head>
  <body>
${sections.map((_, i) => `    <${nn(i)} />`).join("\n")}
${bodyTags ? `${indent(bodyTags, 4)}\n` : ""}${pageLevelScript}  </body>
</html>
`,
  );

  // Astro parses `{` in template text as an expression start, and real copy
  // can carry literal braces — risky sections ship via <Fragment set:html>
  // with the verbatim markup packed into an escaped string literal instead of
  // raw interpolation. The raw path keeps its old guarantee: content starts
  // with the section's own start tag, so a `---` line can never sit adjacent
  // to the frontmatter fence.
  const braceRisk = /[{`]/;
  sections.forEach((s, i) => {
    const blocks = attributed.perSection.get(s.className) ?? [];
    const raw = astroInlineTags(s.text);
    const risky = braceRisk.test(s.innerHtml);
    const content = risky ? `<Fragment set:html={${JSON.stringify(raw)}} />` : raw;
    add(
      `src/components/${nn(i)}.astro`,
      `---
// ${nn(i)} — exact rebuild of root .${s.className || "(classless)"}; markup verbatim, no slots.${risky ? "\n// braces present: content ships as a set:html string (astro would parse { as an expression)" : ""}
---
${content}
${blocks.length ? timelineScript(blocks) : ""}`,
    );
  });
  return { files };
}

export function emitVite(split: Split, outDir: string, name: string): { files: ScaffoldFile[] } {
  void outDir; // params kept for Task-3 wiring symmetry; emitters are pure
  const files: ScaffoldFile[] = [];
  const add = (path: string, content: string) => files.push({ path, content });
  const sections = split.sections.sections ?? [];
  const generic = split.sections.detected === "generic";
  const cssBase = "../../assets/"; // css lives in src/styles/; assets at the project root

  add(
    "package.json",
    j({
      name: packageName(name),
      private: true,
      version: "0.1.0",
      type: "module",
      scripts: { dev: "vite", build: "vite build", preview: "vite preview" },
      devDependencies: { vite: "^7" },
    }),
  );
  // Root assets keep their verbatim refs in dev; `vite build` bundles the
  // stylesheet link but cannot bundle classic (non-module) rehost scripts, so
  // the plugin copies assets/ into dist where those src paths still resolve.
  add(
    "vite.config.js",
    `import { cpSync, existsSync } from "node:fs";

export default {
  base: "./",
  plugins: [
    {
      name: "copy-classic-assets",
      closeBundle() {
        if (existsSync("assets")) cpSync("assets", "dist/assets", { recursive: true });
      },
    },
  ],
};
`,
  );

  // Generic rehost shape: the body already carries its own inline scripts,
  // nested w-scripts and body-end CDN/local tags — ship it byte-verbatim so
  // each runs in place once. Rebuild shape keeps the kit's section assembly.
  const body = generic ? bodyInner(split.html).trim() : sectionsBodyHtml(split);
  const headTags = [
    ...split.scripts.headExternal,
    ...split.styles.headLinks,
    ...(generic ? split.scripts.headInlineJs.map((js) => `<script>\n${js}\n</script>`) : []),
  ];
  const bodyTags = generic
    ? ""
    : split.scripts.bodyScripts
        .filter((b): b is Extract<BodyScript, { kind: "external" }> => b.kind === "external")
        .map((b) => b.tag)
        .join("\n");
  add(
    "index.html",
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${name}</title>
${headTags.join("\n")}
</head>
<body>
${body}
${bodyTags ? `${bodyTags}\n` : ""}<script type="module" src="/src/main.js"></script>
</body>
</html>
`,
  );

  const imports: string[] = [];
  if (split.styles.tokensCss) {
    add("src/styles/tokens.css", cssTo(split.styles.tokensCss, cssBase));
    imports.push('import "./styles/tokens.css";');
  }
  if (split.styles.sharedCss) {
    add("src/styles/shared.css", cssTo(split.styles.sharedCss, cssBase));
    imports.push('import "./styles/shared.css";');
  }
  sections.forEach((s, i) => {
    const css = split.styles.perSection.get(s.className) ?? "";
    if (css === "") return;
    add(`src/styles/section-${i + 1}.css`, cssTo(css, cssBase));
    imports.push(`import "./styles/section-${i + 1}.css";`);
  });
  // Plan: no js split for vite — the rebuild inline script (register + REDUCED
  // guard + all timelines) ships whole in the module, loaded deferred so the
  // CDN classic scripts have already run. Generic bodies keep their scripts in
  // place, so main.js is css-only there.
  const inline = !generic && split.scripts.inlineJs ? `${split.scripts.inlineJs}\n` : "";
  const js = imports.length || inline ? `${imports.join("\n")}\n${inline}` : "";
  add("src/main.js", js);
  return { files };
}

export interface BuildProjectResult {
  outDir: string;
  target: "vite" | "astro" | "next";
  files: string[];
  warnings: string[];
}

// The full-build contract shared by the bin and the MCP handler dep slot.
export type BuildProjectFn = (args: BuildProjectArgs) => Promise<BuildProjectResult | { error: string }>;

// Full local build used by BOTH the bin (build-project-cli.ts) and the MCP
// handler: read the html, split, emit, copy assets, write files. Returns
// values only — never throws — so callers stay in control of exit codes and
// error shapes.
export async function buildProject(args: BuildProjectArgs): Promise<BuildProjectResult | { error: string }> {
  const src = resolve(args.html);
  let html: string;
  try {
    html = await readFile(src, "utf8");
  } catch (err) {
    return { error: `cannot read ${src}: ${err instanceof Error ? err.message : String(err)}` };
  }
  const name = args.name ?? "rebuild-site";
  const split = splitBuild(html);
  const emitted =
    args.target === "vite"
      ? emitVite(split, args.out, name)
      : args.target === "astro"
        ? emitAstro(split, args.out, name)
        : emitNext(split, args.out, name);
  // assets per target: vite preserves ref paths at the project root (dev-served,
  // and `vite build` rewrites refs); astro and next serve public/ at the site
  // root — matching each emitter's css re-basing and local link/script hrefs.
  const outDir = resolve(args.out);
  const { missing } = await copyAssets(html, dirname(src), outDir, args.target === "vite" ? {} : { into: "public" });
  try {
    for (const f of emitted.files) {
      const to = join(outDir, f.path);
      await mkdir(dirname(to), { recursive: true });
      await writeFile(to, f.content, "utf8");
    }
  } catch (err) {
    return { error: `cannot write project to ${outDir}: ${err instanceof Error ? err.message : String(err)}` };
  }
  return {
    outDir,
    target: args.target,
    files: emitted.files.map((f) => f.path),
    warnings: missing.map((ref) => `asset not found: ${ref}`),
  };
}
