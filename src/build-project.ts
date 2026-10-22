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
  id: string; // "" when the root is classless/id-less (rebuild roots are `c-N`)
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
  siteCss: string; // every non-:root rule in original source order (rehost cascade-safe home)
}

export type LoaderScript =
  | { kind: "external"; src: string; local: boolean; tag: string; type: string }
  | { kind: "inline"; js: string };

// Native generic shape: the document keeps its chrome, its content container's
// id/section children become components, and all page JS moves to one ordered
// loader (classic scripts keep their captured order instead of becoming ESM).
export interface RehostSplit {
  shell: string; // whole document with section nodes replaced by <SectionNN /> markers
  container: string; // tag#id label of the content container (e.g. main#main)
  sections: RebuildSection[];
  scripts: LoaderScript[];
  warnings: string[];
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

export type HeadTag =
  | { kind: "external"; tag: string }
  | { kind: "inline"; js: string }
  | { kind: "style"; tag: string };

export interface Split {
  html: string;
  sections: ParsedSections;
  styles: SplitStyles;
  scripts: ExtractedScripts;
  headTags: HeadTag[]; // head scripts/stylesheet links in source order
  warnings: string[];
  assetRefs: string[]; // unique local refs in document order
  rehost: RehostSplit | null; // native generic split when a content container was proven
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

interface WalkedSection extends RebuildSection {
  start: number; // offset in the walked string
  end: number; // just past the close tag
}

const walkSpans = (body: string): WalkedSection[] => {
  const roots: WalkedSection[] = [];
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
      id: attr(startTag, "id"),
      className: attr(startTag, "class").trim().split(/\s+/)[0] ?? "",
      startTag,
      innerHtml: body.slice(gt + 1, close),
      closeTag: body.slice(close, closeEnd),
      text: body.slice(start, closeEnd),
      start,
      end: closeEnd,
    });
    i = closeEnd;
  }
  return roots;
};

const walkTopLevel = (body: string): RebuildSection[] => walkSpans(body);

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
  const { start: hStart, end: hEnd } = headBounds(html);
  const headHtml = hEnd > hStart ? html.slice(hStart, hEnd) : "";
  for (const m of headHtml.matchAll(/<link\s[^>]*rel\s*=\s*["']?stylesheet["']?[^>]*>/gi)) {
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
    siteCss: rest.trim(),
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

// A relative local ref: no scheme, no protocol-relative, no root-absolute
// (forward or Windows backslash), no anchor.
export const isLocalRef = (ref: string): boolean =>
  ref !== "" && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|\\|#)/i.test(ref);

// `</head>` may be absent in hand-built fragments. Fall back to <body> so
// scripts after the body opener are never misclassified as head scripts; with
// neither marker nothing is confidently head.
export const headBounds = (html: string): { start: number; end: number } => {
  const open = /<head\b[^>]*>/i.exec(html);
  const start = open ? open.index + open[0].length : 0;
  const close = /<\/head\s*>/i.exec(html);
  if (close) return { start, end: close.index };
  const body = /<body\b[^>]*>/i.exec(html);
  return { start, end: body ? body.index : start };
};

export function extractScripts(html: string): ExtractedScripts {
  const cdns: string[] = [];
  const externals: ExternalScript[] = [];
  const inline: string[] = [];
  const inlineBlocks: Array<{ js: string; head: boolean }> = [];
  const bodyScripts: BodyScript[] = [];
  const { start: hStart, end: hEnd } = headBounds(html);
  for (const m of html.matchAll(SCRIPT_RE)) {
    const tag = (m[1] ?? "") + (m[2] ?? "") + (m[3] ?? "");
    const at = m.index ?? 0;
    const head = at >= hStart && at < hEnd;
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

// Head scripts and stylesheet links in source order. Emitters used to regroup
// externals/styles/inline, which reordered a bootstrap inline script that ran
// before an external dependency in the source.
export const collectHeadTags = (html: string): HeadTag[] => {
  const { start, end } = headBounds(html);
  if (end <= start) return [];
  const head = html.slice(start, end);
  const tags: HeadTag[] = [];
  for (const m of head.matchAll(/<link\b[^>]*>|<script\b[^>]*>[\s\S]*?<\/script\s*>/gi)) {
    const tag = m[0];
    if (/^<link/i.test(tag)) {
      if (/rel\s*=\s*["']?stylesheet/i.test(tag)) tags.push({ kind: "style", tag });
      continue;
    }
    const open = /^<script\b[^>]*>/i.exec(tag)?.[0] ?? "";
    if (attr(open, "src") !== "") {
      tags.push({ kind: "external", tag });
      continue;
    }
    if (!JS_TYPES.has(attr(open, "type").toLowerCase().trim())) continue;
    const js = /^<script\b[^>]*>([\s\S]*?)<\/script\s*>$/i.exec(tag)?.[1]?.trim() ?? "";
    tags.push({ kind: "inline", js });
  }
  return tags;
};

// Local refs in markup (asset-ish tags + url()) in document order. Remote
// URLs, root-absolute paths and refs containing ".." never enter the list, so
// copies can never climb out of the output dir.
const ASSET_REF_RE =
  /<(?:link|script|img|image|source|video|audio|track|a)\b[^>]*?\b(?:src|href)\s*=\s*["']([^"']+)["'][^>]*>|url\(\s*["']?([^)"'\s]+)["']?\s*\)/gi;

const ASSET_EXT =
  /\.(?:css|js|mjs|woff2?|ttf|otf|eot|mp3|mp4|webm|ogg|wav|m4a|jpg|jpeg|png|webp|avif|gif|svg|pdf|json)$/i;
const TEXT_ASSET = /\.(?:css|js|mjs)$/i;
const JS_TEXT_ASSET = /\.(?:js|mjs)$/i;
// Vendor bundles are compiled libraries: scanning their string table yields
// thousands of false asset paths. Only first-party page scripts are scanned.
const VENDOR_JS = /(?:\.min\.js$|[\\/](?:vendor|node_modules|lib|libs)[\\/])/i;
const ASSET_ROOT = /^(?:\.{1,2}\/|(?:assets|static|public|vendor|fonts|images|img|audio|video|media|css|js|scripts|files)\/)/i;
const CSS_URL_RE = /url\(\s*["']?([^)"'\s]+)["']?\s*\)/g;
const JS_STRING_RE = /["'`]([^"'`\s]+)["'`]/g;

const isAssetRef = (ref: string): boolean =>
  ASSET_EXT.test(ref) || ref.replace(/^\.\//, "").startsWith("assets/");

const collectAssetRefs = (html: string): string[] => {
  const seen = new Set<string>();
  const refs: string[] = [];
  for (const m of html.matchAll(ASSET_REF_RE)) {
    const ref = m[1] ?? m[2];
    if (!ref || ref.includes("..") || !isLocalRef(ref) || !isAssetRef(ref)) continue;
    const key = ref.replace(/^\.\//, "");
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push(ref);
  }
  return refs;
};

// Dependencies of a copied css/js file (fonts, audio, images). Local refs with
// a file extension are followed; `..` and extensionless path-like refs are
// returned as rejected so the caller can surface them instead of 404ing.
// In JS, a bare `"cover.jpg"` is usually a runtime label, so require a path
// separator there (css url() refs stay unrestricted).
interface TextAssetRefs {
  refs: string[];
  rejected: string[];
}

export const collectTextAssetRefs = (text: string, js: boolean): TextAssetRefs => {
  const refs: string[] = [];
  const rejected: string[] = [];
  for (const m of text.matchAll(js ? JS_STRING_RE : CSS_URL_RE)) {
    const ref = m[1];
    if (!ref || !isLocalRef(ref)) continue;
    if (/^%23/i.test(ref)) continue; // url(%23id) nested inside a css data URI
    if (/[<>{}()\s]/.test(ref)) continue; // markup/template fragments are not paths
    if (js && !ref.includes("/")) continue;
    if (ref.includes("..") || !ASSET_EXT.test(ref)) {
      // css url() is always a dependency; in JS only path-like strings warn,
      // so labels like "Europe/Warsaw" stay silent.
      if (!js || ref.includes("..") || ASSET_ROOT.test(ref)) rejected.push(ref);
      continue;
    }
    refs.push(ref);
  }
  return { refs, rejected };
};

// Asset paths that only exist inside inline page JS (e.g. new Audio("assets/…")).
export const collectInlineScriptAssetRefs = (html: string): TextAssetRefs => {
  const refs: string[] = [];
  const rejected: string[] = [];
  for (const m of html.matchAll(SCRIPT_RE)) {
    if (attr(m[1] ?? "", "src") !== "") continue;
    if (!JS_TYPES.has(attr(m[1] ?? "", "type").toLowerCase().trim())) continue;
    const found = collectTextAssetRefs(m[2] ?? "", true);
    refs.push(...found.refs);
    rejected.push(...found.rejected);
  }
  return { refs, rejected };
};

export interface CopyAssetsResult {
  copied: string[];
  missing: string[];
}

// Copies every local ref into <outDir>/<into>/<ref path>, preserving the
// source's relative shape (assets/css/js keep resolving next to their page).
// Copied css/js files are scanned for their own local deps (fonts, audio,
// images), so a stylesheet or app script cannot 404 its children. A missing
// source is a warning (missing[]), never a hard failure.
export async function copyAssets(html: string, srcDir: string, outDir: string, opts: { into?: string; skip?: string[] } = {}): Promise<CopyAssetsResult> {
  const root = join(resolve(outDir), opts.into ?? "");
  const srcRoot = resolve(srcDir);
  const skip = new Set(opts.skip ?? []);
  const copied: string[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  const missingSeen = new Set<string>();
  const addMissing = (ref: string) => {
    if (missingSeen.has(ref)) return;
    missingSeen.add(ref);
    missing.push(ref);
  };
  const inlineRefs = collectInlineScriptAssetRefs(html);
  inlineRefs.rejected.forEach(addMissing);
  const seed = [...collectAssetRefs(html), ...inlineRefs.refs];
  const jobs = seed.map((ref) => ({
    from: resolve(srcRoot, ref),
    to: join(root, ref.replace(/^\.\//, "")),
    label: ref,
  }));
  while (jobs.length > 0) {
    const job = jobs.shift()!;
    const dest = resolve(job.to);
    if (seen.has(dest)) continue;
    seen.add(dest);
    // skip: the file moves to its own project folder later; still scan it for
    // dependencies so those keep resolving from their original page-relative base.
    if (!skip.has(job.label)) {
      try {
        await mkdir(dirname(job.to), { recursive: true });
        await copyFile(job.from, job.to);
        copied.push(job.label);
      } catch {
        addMissing(job.label);
        continue;
      }
    }
    if (!TEXT_ASSET.test(job.from)) continue;
    if (JS_TEXT_ASSET.test(job.from) && VENDOR_JS.test(job.from)) continue;
    try {
      const text = await readFile(job.from, "utf8");
      const found = collectTextAssetRefs(text, JS_TEXT_ASSET.test(job.from));
      found.rejected.forEach(addMissing);
      for (const ref of found.refs) {
        jobs.push({
          from: resolve(dirname(job.from), ref),
          to: join(dirname(job.to), ref.replace(/^\.\//, "")),
          label: ref,
        });
      }
    } catch {
      // unreadable text asset: the copy itself already succeeded
    }
  }
  return { copied, missing };
}

const bodyInner = (html: string): string => /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html;

// All JS in document order, including scripts that sat inside a section. The
// rehost loader runs this exact sequence; inline bodies keep their slots.
const collectLoaderScripts = (html: string): LoaderScript[] => {
  const scripts: LoaderScript[] = [];
  for (const m of html.matchAll(SCRIPT_RE)) {
    const open = m[1] ?? "";
    const src = attr(open, "src");
    if (src !== "") {
      scripts.push({
        kind: "external",
        src,
        local: isLocalRef(src),
        tag: (m[1] ?? "") + (m[2] ?? "") + (m[3] ?? ""),
        type: attr(open, "type").toLowerCase().trim(),
      });
      continue;
    }
    if (!JS_TYPES.has(attr(open, "type").toLowerCase().trim())) continue;
    const js = (m[2] ?? "").trim();
    if (js !== "") scripts.push({ kind: "inline", js });
  }
  return scripts;
};

// Section components never carry script/style tags: JS goes to the one loader,
// CSS to tokens/site. (A data script inside a section is lost here, matching
// the generated-page law that sections are markup only.)
const stripSectionAssets = (html: string): string =>
  html.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "").replace(SCRIPT_RE, "");

// The shell keeps non-JS data scripts (ld+json/importmap) because they are
// document metadata; executable/page scripts all move to the loader.
const stripShellAssets = (html: string): string =>
  html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "")
    .replace(SCRIPT_RE, (full: string, open: string) => (attr(open, "src") !== "" || JS_TYPES.has(attr(open, "type").toLowerCase().trim()) ? "" : full));

interface RehostContainer {
  start: number; // inner start in the document
  end: number; // inner end in the document
  label: string;
}

const mainContainer = (html: string): RehostContainer | null => {
  const open = /<main\b[^>]*>/i.exec(html);
  if (!open) return null;
  const gt = tagEnd(html, open.index);
  if (gt === -1) return null;
  const close = findClose(html, gt + 1, "main");
  if (close === -1) return null;
  const id = attr(open[0], "id");
  return { start: gt + 1, end: close, label: `main${id ? `#${id}` : ""}` };
};

const roleMainContainer = (html: string): RehostContainer | null => {
  const open = /<([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*\brole\s*=\s*["']?main\b[^>]*>/i.exec(html);
  if (!open) return null;
  const tag = (open[1] ?? "").toLowerCase();
  const gt = tagEnd(html, open.index);
  if (gt === -1) return null;
  const close = findClose(html, gt + 1, tag);
  if (close === -1) return null;
  const id = attr(open[0], "id");
  return { start: gt + 1, end: close, label: `${tag}${id ? `#${id}` : ""}` };
};

// No semantic main: a single body-level wrapper is the container only when its
// own element children prove a multi-band page (>=2 id-bearing children).
const wrapperContainer = (html: string): RehostContainer | null => {
  const bodyOpen = /<body\b[^>]*>/i.exec(html);
  const offset = bodyOpen ? bodyOpen.index + bodyOpen[0].length : 0;
  const bodyEnd = /<\/body\s*>/i.exec(html)?.index ?? html.length;
  const roots = walkSpans(html.slice(offset, bodyEnd)).filter((r) => r.tag !== "script" && r.tag !== "style");
  if (roots.length !== 1) return null;
  const root = roots[0];
  if (!root || root.tag === "script") return null;
  const kids = walkSpans(root.innerHtml).filter((k) => k.id !== "");
  if (kids.length < 2) return null;
  return {
    start: offset + root.start + root.startTag.length,
    end: offset + root.start + root.startTag.length + root.innerHtml.length,
    label: `${root.tag}${root.id ? `#${root.id}` : ""}`,
  };
};

/**
 * Native generic split: shell (whole document, section nodes replaced by
 * `<SectionNN />` markers) + sections + one ordered script list. Returns null
 * when no content container can be proven, so the caller keeps the legacy
 * generic path (no silent rewrite).
 */
export function splitRehost(html: string): RehostSplit | null {
  const container = mainContainer(html) ?? roleMainContainer(html) ?? wrapperContainer(html);
  if (!container) return null;
  const inner = html.slice(container.start, container.end);
  const children = walkSpans(inner);
  const chosen = children.filter((c) => c.id !== "" || c.tag === "section");
  if (chosen.length === 0) return null;

  const sections: RebuildSection[] = chosen.map((c) => {
    const innerHtml = stripSectionAssets(c.innerHtml);
    return {
      tag: c.tag,
      id: c.id,
      className: c.className,
      startTag: c.startTag,
      innerHtml,
      closeTag: c.closeTag,
      text: c.startTag + innerHtml + c.closeTag,
    };
  });

  // Replace back-to-front so earlier offsets stay valid; markers are the exact
  // component names both astro and JSX resolve (vite swaps the HTML back in).
  let rehosted = inner;
  for (let i = chosen.length - 1; i >= 0; i--) {
    const node = chosen[i];
    if (!node) continue;
    rehosted = rehosted.slice(0, node.start) + `<${nn(i)} />` + rehosted.slice(node.end);
  }
  const shell = stripShellAssets(html.slice(0, container.start) + rehosted + html.slice(container.end));

  return {
    shell,
    container: container.label,
    sections,
    scripts: collectLoaderScripts(html),
    warnings: [],
  };
}

// Offset-safe body inner bounds for emitters that need the body only.
export const bodyBounds = (html: string): { start: number; end: number } => {
  const open = /<body\b[^>]*>/i.exec(html);
  const start = open ? open.index + open[0].length : 0;
  const close = /<\/body\s*>/i.exec(html);
  return { start, end: close ? close.index : html.length };
};

// Fallback when the section model cannot cover the body: h1/p-only pages have
// no container root, and text between roots has no home. One synthetic root
// carries the whole body so no target can silently drop content.
const fullBodySection = (body: string): RebuildSection => ({
  tag: "div",
  id: "",
  className: "",
  startTag: "<div>",
  innerHtml: body,
  closeTag: "</div>",
  text: `<div>${body}</div>`,
});

// Body markup that no chosen root owns. Scripts/styles/comments are separate
// channels (head/body scripts and splitStyles), so they do not count as
// leftover content; a body-level <link> does, because only head links are
// extracted.
const residualBodyContent = (body: string, chosen: RebuildSection[]): string => {
  let rest = body;
  for (const s of chosen) {
    const at = rest.indexOf(s.text);
    if (at !== -1) rest = rest.slice(0, at) + rest.slice(at + s.text.length);
  }
  return rest
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "")
    .trim();
};

export const FULL_BODY_WARNING =
  "body content outside recognised section roots; emitted as a single full-body block";

export function splitBuild(html: string): Split {
  const parsed = parseRebuildSections(html);
  const body = bodyInner(html);
  const parsedRoots = parsed.sections ?? [];
  // Generic pages with a proven content container split natively before the
  // residual-content check: chrome outside main (skip links, dialogs) is shell,
  // not leftovers that force a full-body block.
  const rehost = parsed.detected === "generic" ? splitRehost(html) : null;
  const fallback = rehost === null && (parsedRoots.length === 0 || residualBodyContent(body, parsedRoots) !== "");
  const sections: ParsedSections = rehost
    ? { sections: rehost.sections, detected: "generic" }
    : fallback
      ? { sections: [fullBodySection(body)], detected: "generic" }
      : parsed;
  const scripts = extractScripts(html);
  // Scripts inside a section root stay in that markup; only loose body
  // scripts are re-emitted at page level (dedupe law: never execute twice).
  // Rehost moves every script to the one loader, so no body tags remain here.
  const roots = sections.sections ?? [];
  scripts.bodyScripts = rehost
    ? []
    : scripts.bodyScripts.filter((b) =>
        b.kind === "external" ? !roots.some((s) => s.text.includes(b.tag)) : !roots.some((s) => s.text.includes(b.js)),
      );
  return {
    html,
    sections,
    styles: splitStyles(html, fallback ? [] : parsedRoots.map((s) => s.className)),
    scripts,
    headTags: collectHeadTags(html),
    warnings: [...(fallback ? [FULL_BODY_WARNING] : []), ...(rehost?.warnings ?? [])],
    assetRefs: collectAssetRefs(html),
    rehost,
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

// Local script refs move under the target's scripts dir; queries/fragments are
// runtime-only and never part of the copied file path.
export const scriptFile = (src: string): string => (src.split(/[?#]/)[0] ?? "").replace(/^\.\//, "");

const withSrc = (tag: string, src: string): string =>
  tag.replace(/(\bsrc\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s>]+)/i, (_m, prefix: string) => `${prefix}"${src}"`);

const rehostScriptUrl = (entry: Extract<LoaderScript, { kind: "external" }>, dir: string): string =>
  entry.local ? `/${dir}/${scriptFile(entry.src)}` : entry.src;

const rehostLoaderTag = (entry: LoaderScript, dir: string): string =>
  entry.kind === "inline" ? `<script>\n${entry.js}\n</script>` : withSrc(entry.tag, rehostScriptUrl(entry, dir));

const astroRehostLoaderTag = (entry: LoaderScript): string =>
  entry.kind === "inline"
    ? `<script is:inline>\n${entry.js}\n</script>`
    : astroInlineTags(withSrc(entry.tag, rehostScriptUrl(entry, "scripts")));

// One ordered block at the end of the shell (the single loader for this page).
const withLoader = (doc: string, block: string): string => {
  if (block === "") return doc;
  return /<\/body\s*>/i.test(doc)
    ? doc.replace(/<\/body\s*>/i, () => `${block}\n</body>`)
    : `${doc}\n${block}\n`;
};

const inlineShell = (rehost: RehostSplit): string => {
  let doc = rehost.shell;
  rehost.sections.forEach((s, i) => {
    doc = doc.replace(`<${nn(i)} />`, () => s.text);
  });
  return doc;
};

// Astro parses `{` as an expression start; sections with literal braces ship as
// a set:html string (same guard as the legacy emitter).
const astroSection = (s: RebuildSection, i: number): { content: string; risky: boolean } => {
  const risky = /[{`]/.test(s.innerHtml);
  return { risky, content: risky ? `<Fragment set:html={${JSON.stringify(s.text)}} />` : s.text };
};

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

  const rehost = split.rehost;
  if (rehost) {
    const imports: string[] = [];
    if (split.styles.tokensCss) {
      add("src/styles/tokens.css", cssTo(split.styles.tokensCss, cssBase));
      imports.push('import "../styles/tokens.css";');
    }
    if (split.styles.siteCss) {
      add("src/styles/site.css", cssTo(split.styles.siteCss, cssBase));
      imports.push('import "../styles/site.css";');
    }
    rehost.sections.forEach((_, i) => imports.push(`import ${nn(i)} from "../components/${nn(i)}.astro";`));
    const loader = rehost.scripts.map(astroRehostLoaderTag).join("\n");
    add(
      "src/pages/index.astro",
      `---
// Generated by awwwards-build-project — native shell, real sections, one ordered loader.
${imports.join("\n")}
---
${withLoader(rehost.shell, loader ? indent(loader, 2) : "")}`,
    );
    rehost.sections.forEach((s, i) => {
      const { content, risky } = astroSection(s, i);
      if (risky) split.warnings.push(`${nn(i)}: literal braces/backticks — shipped via set:html`);
      add(
        `src/components/${nn(i)}.astro`,
        `---
// ${nn(i)} — section #${s.id || "(id-less)"}; markup verbatim, no slots.${risky ? "\n// braces present: content ships as a set:html string (astro would parse { as an expression)" : ""}
---
${content}
`,
      );
    });
    return { files };
  }

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
  const headTags = split.headTags
    .filter((t) => generic || t.kind !== "inline")
    .map((t) =>
      t.kind === "inline" ? `<script is:inline>\n${t.js}\n</script>` : astroInlineTags(t.tag),
    );
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
  // Root inputs keep their verbatim refs in dev; `vite build` bundles the
  // stylesheet/images but cannot bundle classic (non-module) rehost scripts.
  // The plugin copies every non-project input (assets/, vendor/, app.js, ...)
  // into dist so those src paths still resolve after build.
  add(
    "vite.config.js",
    `import { cpSync, readdirSync } from "node:fs";

const PROJECT = new Set(["index.html", "package.json", "package-lock.json", "node_modules", "src", "dist", "public", "vite.config.js"]);

export default {
  base: "./",
  plugins: [
    {
      name: "copy-classic-assets",
      closeBundle() {
        for (const name of readdirSync(".")) {
          if (PROJECT.has(name) || name.startsWith(".")) continue;
          cpSync(name, \`dist/\${name}\`, { recursive: true });
        }
      },
    },
  ],
};
`,
  );

  const rehost = split.rehost;
  if (rehost) {
    // Vite has no component tree: the shell keeps section markup inline (no
    // marker + client render step), while css and classic scripts get real
    // project folders. The module entry is css-only; every page script keeps
    // its captured order in the html.
    const imports: string[] = [];
    if (split.styles.tokensCss) {
      add("src/styles/tokens.css", cssTo(split.styles.tokensCss, cssBase));
      imports.push('import "./styles/tokens.css";');
    }
    if (split.styles.siteCss) {
      add("src/styles/site.css", cssTo(split.styles.siteCss, cssBase));
      imports.push('import "./styles/site.css";');
    }
    add("src/main.js", imports.length ? `${imports.join("\n")}\n` : "");
    const loader = [
      rehost.scripts.map((s) => rehostLoaderTag(s, "src/scripts")).join("\n"),
      '<script type="module" src="/src/main.js"></script>',
    ]
      .filter(Boolean)
      .join("\n");
    add("index.html", withLoader(inlineShell(rehost), loader));
    return { files };
  }

  // Generic rehost shape: the body already carries its own inline scripts,
  // nested w-scripts and body-end CDN/local tags — ship it byte-verbatim so
  // each runs in place once. Rebuild shape keeps the kit's section assembly.
  const body = generic ? bodyInner(split.html).trim() : sectionsBodyHtml(split);
  const headTags = split.headTags
    .filter((t) => generic || t.kind !== "inline")
    .map((t) => (t.kind === "inline" ? `<script>\n${t.js}\n</script>` : t.tag));
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
  const rehostScripts =
    split.rehost?.scripts.filter((s): s is Extract<LoaderScript, { kind: "external" }> => s.kind === "external" && s.local) ?? [];
  const { missing } = await copyAssets(html, dirname(src), outDir, {
    ...(args.target === "vite" ? {} : { into: "public" }),
    ...(rehostScripts.length ? { skip: rehostScripts.map((s) => s.src) } : {}),
  });
  // Rehost scripts load from one folder per target; copyAssets skipped their
  // original copies above and this is the path the single loader points at.
  const missingScripts: string[] = [];
  if (split.rehost) {
    const into = args.target === "vite" ? join("src", "scripts") : join("public", "scripts");
    for (const entry of rehostScripts) {
      const rel = scriptFile(entry.src);
      if (rel === "" || rel.includes("..")) continue;
      try {
        const to = join(outDir, into, rel);
        await mkdir(dirname(to), { recursive: true });
        await copyFile(resolve(dirname(src), rel), to);
      } catch {
        missingScripts.push(entry.src);
      }
    }
  }
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
    warnings: [
      ...split.warnings,
      ...missing.map((ref) => `asset not found: ${ref}`),
      ...missingScripts.map((ref) => `asset not found: ${ref}`),
    ],
  };
}
