// emit-next (v1.12, local-only): Next.js (App Router) tree for build_project.
// htmlToJsx is a port of the kit's src/jsx.mjs — a BOUNDED converter whose
// input MUST be HTML our own generator produced (class/data-slot attrs, inline
// svg, no scripts); arbitrary third-party HTML is out of scope (kit header
// law). Port addition: literal { } in text nodes are entity-escaped — JSX
// would parse a stray { as an expression start (the next-side twin of the astro
// emitter's set:html brace guard); attr values are untouched.
//
// Emitters are PURE (files arrays) so trees stay byte-deterministic. gsap
// wiring follows the kit's reconcile law: a `gsap` dependency is emitted iff
// the source shipped gsap CDN tags, and no gsap import is ever emitted without
// that dependency behind it. Import cycle with build-project.ts is
// intentional and call-time-only (house precedent: capture.ts/structure.ts).

import { attributeBlocks, cssTo, nn, packageName } from "./build-project.js";
import type { BodyScript, RebuildSection, ScaffoldFile, Split } from "./build-project.js";

// Dashed HTML/SVG attrs → JSX camelCase. Dashed-but-unlisted (data-*, aria-*,
// unknown) stays as-is; class is a plain rename; style is special-cased in
// convertAttr (value → object literal).
const ATTR_MAP = new Map(Object.entries({
  "accesskey": "accessKey",
  "accept-charset": "acceptCharset",
  "allowfullscreen": "allowFullScreen",
  "autocomplete": "autoComplete",
  "autofocus": "autoFocus",
  "autoplay": "autoPlay",
  "class": "className",
  "clip-path": "clipPath",
  "clip-rule": "clipRule",
  "colspan": "colSpan",
  "contenteditable": "contentEditable",
  "crossorigin": "crossOrigin",
  "datetime": "dateTime",
  "dominant-baseline": "dominantBaseline",
  "enctype": "encType",
  "fill-opacity": "fillOpacity",
  "fill-rule": "fillRule",
  "font-family": "fontFamily",
  "font-size": "fontSize",
  "font-weight": "fontWeight",
  "for": "htmlFor",
  "http-equiv": "httpEquiv",
  "inputmode": "inputMode",
  "letter-spacing": "letterSpacing",
  "maxlength": "maxLength",
  "minlength": "minLength",
  "novalidate": "noValidate",
  "playsinline": "playsInline",
  "readonly": "readOnly",
  "referrerpolicy": "referrerPolicy",
  "rowspan": "rowSpan",
  "spellcheck": "spellCheck",
  "srcset": "srcSet",
  "stroke-dasharray": "strokeDasharray",
  "stroke-dashoffset": "strokeDashoffset",
  "stroke-linecap": "strokeLinecap",
  "stroke-linejoin": "strokeLinejoin",
  "stroke-miterlimit": "strokeMiterlimit",
  "stroke-opacity": "strokeOpacity",
  "stroke-width": "strokeWidth",
  "tabindex": "tabIndex",
  "text-anchor": "textAnchor",
  "usemap": "useMap",
  "vector-effect": "vectorEffect",
  "word-spacing": "wordSpacing",
}));
// Namespaced attrs (lowercase lookup): xlink:href→xlinkHref per kit brief.
const NAMESPACED = new Map([["xlink:href", "xlinkHref"], ["xml:lang", "xmlLang"], ["xml:space", "xmlSpace"]]);
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

// SVG elements whose HTML-parser DOM name differs from the JSX/camelCase name
// — <clippath> from lowercased captures is a compile error in TSX.
const SVG_TAG_FIXES = new Map(Object.entries({
  clippath: "clipPath",
  lineargradient: "linearGradient",
  radialgradient: "radialGradient",
  gradienttransform: "gradientTransform",
  textpath: "textPath",
  fecolormatrix: "feColorMatrix",
  fecomposite: "feComposite",
  fegaussianblur: "feGaussianBlur",
  feblend: "feBlend",
  feoffset: "feOffset",
  femerge: "feMerge",
  femergenode: "feMergeNode",
  floodcolor: "floodColor",
  floodopacity: "floodOpacity",
}));

// JSX forbids namespaced attributes — capture packs' verbatim svg strings
// carry them, so strip to local name or map to jsxHref.
const NAMESPACED_DROP = /^(?:xmlns|xlink|xml):/i;

// kebab-case css property → camelCase style key; the `-ms-` vendor prefix is
// the one React types spell lowercase (`msTransform`, not `MsTransform`).
const cssKeyToJsx = (k: string): string => {
  const key = k.trim();
  const normalized = key.toLowerCase().startsWith("-ms-") ? `ms-${key.slice(4)}` : key;
  return normalized.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
};

// React CSSProperties rejects "!important" suffixes; live inline styles carry them.
const stripImportant = (v: string): string => v.replace(/\s*!important\s*$/i, "");

// style="a: 1; b: 2" → object-literal body (split ; then FIRST : — url values
// contain colons); convertAttr wraps it in {{ }}.
const styleToObject = (css: string): string =>
  css
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const i = d.indexOf(":");
      return `${cssKeyToJsx(d.slice(0, i))}: ${JSON.stringify(stripImportant(d.slice(i + 1).trim()))}`;
    })
    .join(", ");

// One attribute: rename per table; style's value becomes an object literal;
// className / data-* / aria-* / unknown attrs pass through unchanged.
const convertAttr = (attr: string): string => {
  const m = attr.match(/^([^\s=]+)(\s*=\s*)("[^"]*"|'[^']*')$/);
  if (!m) return ATTR_MAP.get(attr.toLowerCase()) ?? attr; // bare attr (`defer`, `playsinline`)
  const key = (m[1] ?? "").toLowerCase();
  const eq = m[2] ?? "";
  const value = m[3] ?? "";
  if (NAMESPACED_DROP.test(key)) {
    // xlink:href carries the reference — keep it as JSX's xlinkHref; other
    // namespaced attrs (xmlns:*, xml:*) are inert in React and get dropped.
    return key === "xlink:href" ? `xlinkHref${eq}${value}` : "";
  }
  if (key === "style") return `style={{ ${styleToObject(value.slice(1, -1))} }}`;
  const name = ATTR_MAP.get(key) ?? NAMESPACED.get(key) ?? m[1];
  return `${name}${eq}${value}`;
};

// Escapes JSX-expression braces in TEXT spans only — tag spans (open, close,
// self-closed) pass through byte-identically so attribute values keep verbatim
// braces. Quote-less tag scanning mirrors the kit's own tag regex limit.
const escapeJsxBraces = (html: string): string => {
  let out = "";
  let start = 0;
  for (let i = 0; i < html.length; i++) {
    if (html[i] !== "<") continue;
    out += html.slice(start, i).replace(/\{/g, "&#123;").replace(/\}/g, "&#125;");
    const end = html.indexOf(">", i);
    if (end === -1) return out + html.slice(i);
    out += html.slice(i, end + 1);
    start = end + 1;
    i = end;
  }
  return out + html.slice(start);
};

/**
 * Pure + deterministic: generator HTML → JSX text (kit jsx.mjs port).
 */
export function htmlToJsx(html: string): string {
  // comments first so their contents can never look like markup
  const noComments = String(html ?? "").replace(/<!--[\s\S]*?-->/g, "");
  const braced = escapeJsxBraces(noComments);
  // rewrite attrs + tag names on open AND close tags, preserving original spacing
  return braced.replace(/<(\/?)([a-zA-Z][^>\s]*)([^>]*?)(\/?)>/g, (tag, slash, name, body, selfSlash) => {
    const selfClosed = Boolean(selfSlash);
    const converted = String(body)
      .replace(/[^\s=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*))?/g, convertAttr)
      .replace(/ {2,}/g, " ")
      .trim();
    const fixed = SVG_TAG_FIXES.get(String(name).toLowerCase()) ?? name;
    if (slash) return VOID_TAGS.has(String(fixed).toLowerCase()) ? "" : `</${fixed}>`;
    return `<${fixed}${converted ? " " + converted : ""}${selfClosed || VOID_TAGS.has(String(fixed).toLowerCase()) ? "/>" : ">"}`;
  });
}

const j = (obj: object): string => JSON.stringify(obj, null, 2) + "\n";

const indent = (text: string, n: number): string =>
  text
    .split("\n")
    .map((l) => (l ? " ".repeat(n) + l : l))
    .join("\n");

// section bodies are html-indented; lift them one level to sit under `return (`
const indentBody = (body: string): string =>
  body
    .split("\n")
    .map((l, i) => (i === 0 ? l : "  " + l))
    .join("\n");

// Head stylesheet links / external tags ship verbatim in layout's head; void
// links are explicitly self-closed for JSX. The old `>`→` />` rewrite turned an
// already self-closed `<link ... />` into `<link ... / />` (D2-review M1).
const jsxSelfClose = (tag: string): string => tag.replace(/\s*\/?>$/, " />");

// Local public refs (`assets/x`, `./assets/x`) must be root-absolute in the
// Next layout; remote URLs and already-absolute paths stay untouched.
const rewriteLocalUrlTag = (tag: string): string =>
  tag.replace(
    /(\b(?:src|href)\s*=\s*["'])(?!https?:|\/\/|\/|#|data:)([^"']+)/gi,
    (_, prefix: string, url: string) => `${prefix}/${url.replace(/^\.\//, "")}`,
  );

const JS_SCRIPT_TYPES = new Set([
  "",
  "module",
  "text/javascript",
  "application/javascript",
  "text/ecmascript",
  "application/ecmascript",
]);

const scriptSrc = (open: string): string => /\bsrc\s*=\s*["']([^"']*)["']/i.exec(open)?.[1] ?? "";

// SSR-safe inline script for rebuild sections/head; generic rehost output keeps
// its scripts raw inside section HTML or at body end.
const jsxInlineScript = (js: string): string =>
  `<script dangerouslySetInnerHTML={{ __html: ${JSON.stringify(js).replace(/</g, "\\u003c")} }} />`;

// Inline scripts/styles nested inside a section survive conversion as
// executable/raw SSR tags. Token passes keep their bodies out of htmlToJsx's
// text escaping (CSS `>` selectors and JS would otherwise break JSX parsing).
const sectionJsx = (html: string): string => {
  const scripts: string[] = [];
  const styles: string[] = [];
  const marked = html
    .replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi, (full, open: string, body: string) => {
      if (scriptSrc(open) !== "") return rewriteLocalUrlTag(full);
      const type = (/\btype\s*=\s*["']([^"']*)["']/i.exec(open)?.[1] ?? "").toLowerCase().trim();
      if (!JS_SCRIPT_TYPES.has(type)) return full;
      scripts.push(body.trim());
      return `@@AW_INLINE_${scripts.length - 1}@@`;
    })
    .replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (_, body: string) => {
      styles.push(body);
      return `@@AW_STYLE_${styles.length - 1}@@`;
    });
  let out = htmlToJsx(marked);
  scripts.forEach((js, i) => {
    out = out.replace(`@@AW_INLINE_${i}@@`, jsxInlineScript(js));
  });
  styles.forEach((css, i) => {
    out = out.replace(`@@AW_STYLE_${i}@@`, jsxInlineScript(css).replace("<script", "<style"));
  });
  return out;
};

const layoutHeadTags = (tags: string[]): string =>
  tags.length ? `\n${tags.map((t) => indent(t, 8)).join("\n")}\n      ` : "";

const layoutBodyScripts = (scripts: BodyScript[]): string =>
  scripts.length
    ? `\n      ${scripts
        .map((b) => (b.kind === "external" ? rewriteLocalUrlTag(b.tag) : jsxInlineScript(b.js)))
        .join("\n      ")}`
    : "";

const layout = (name: string, headTags: string[], bodyScripts: BodyScript[]): string =>
  `import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: ${JSON.stringify(name)},
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>${layoutHeadTags(headTags)}</head>
      <body>{children}${layoutBodyScripts(bodyScripts)}</body>
    </html>
  );
}
`;

// tokens + shared + per-section rules all land in globals.css (the plan's one
// css home for next); urls re-base to /assets/ because assets copy to public/.
const globalsCss = (split: Split): string => {
  const parts: string[] = [];
  if (split.styles.tokensCss) parts.push(cssTo(split.styles.tokensCss, "/assets/"));
  if (split.styles.sharedCss) parts.push(cssTo(split.styles.sharedCss, "/assets/"));
  (split.sections.sections ?? []).forEach((s) => {
    const css = split.styles.perSection.get(s.className) ?? "";
    if (css) parts.push(cssTo(css, "/assets/"));
  });
  return parts.join("\n");
};

// Page-level effect body. Kit samestack pattern ported verbatim where possible:
// registerPlugin → gsap.context → reduced-motion static frame → refresh, with
// ctx.revert() cleanup (unwinds tweens+triggers and the timers they queue, so
// unmount/StrictMode remounts stay safe).
const gsapEffect = (bodies: string[], pad: number): string =>
  `useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return; // static first frame
${bodies.map((b) => indent(b, pad)).join("\n\n")}
      ScrollTrigger.refresh();
    });
    return () => ctx.revert();
  }, [])`;

interface Attribution {
  perSection: Map<string, string[]>;
  pageLevel: string[];
}

const page = (split: Split, attributed: Attribution): string => {
  const sections = split.sections.sections ?? [];
  const hasCdns = split.scripts.cdns.length > 0;
  const generic = split.sections.detected === "generic";
  const imports = sections.map((_, i) => `import ${nn(i)} from "../components/${nn(i)}";`).join("\n");
  const renders = sections.map((_, i) => indent(`<${nn(i)} />`, 6)).join("\n");

  // generic rehost: sections are opaque SSR HTML and scripts ship raw, so the
  // page renders no effect copy. rebuild: unattributable timeline blocks run
  // only behind a gsap dependency, else they compile against a dep the project
  // doesn't have.
  const payload = generic ? [] : attributed.pageLevel;
  const runnable = hasCdns ? payload : [];
  const unwired = !generic && payload.length > 0 && runnable.length === 0;
  const client = !generic && split.scripts.inlineJs !== "";
  const effect = (() => {
    if (runnable.length > 0) return `  ${gsapEffect(runnable, 6)};\n`;
    if (unwired)
      return `  // ${payload.length} unattributed captured timeline${payload.length === 1 ? "" : "s"} — no gsap CDN tag in the source; wire manually.\n`;
    return "";
  })();
  const gsapImports = runnable.length > 0 ? `\nimport gsap from "gsap";\nimport { ScrollTrigger } from "gsap/ScrollTrigger";\n` : "";
  const reactImport = runnable.length > 0 ? `import { useEffect } from "react";\n` : "";

  return `${client ? '"use client";\n\n' : ""}${imports}${reactImport ? `\n${reactImport}` : ""}${gsapImports}
export default function Page() {
${effect}
  return (
    <main>
${renders}
    </main>
  );
}
`;
};

const section = (s: RebuildSection, i: number, attributed: Attribution, hasCdns: boolean, raw: boolean): string => {
  const blocks = attributed.perSection.get(s.className) ?? [];
  const header = `// ${nn(i)} — exact rebuild of root .${s.className || "(classless)"}; markup verbatim, no slots.\n`;
  if (raw) {
    // Generic rehost: React owns only the root shell; the captured subtree is
    // one opaque SSR HTML string, so parse-time scripts/styles run in place and
    // their DOM mutations cannot trip hydration.
    const open = htmlToJsx(s.startTag).replace(/\s*\/?>$/, "");
    const html = JSON.stringify(s.innerHtml).replace(/</g, "\\u003c");
    return `${header}export default function ${nn(i)}() {
  return (
    ${open} dangerouslySetInnerHTML={{ __html: ${html} }} />
  );
}
`;
  }
  const jsx = indentBody(sectionJsx(s.text));
  if (blocks.length > 0 && hasCdns) {
    // kit samestack nextSection wiring: "use client" + gsap.context + revert
    return `${header}"use client";

import { useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

export default function ${nn(i)}() {
  ${gsapEffect(blocks, 6)};

  return (
    ${jsx}
  );
}
`;
  }
  if (blocks.length > 0) {
    // kit reconcile law: anims without the dep are recorded, never wired —
    // no import is emitted without its dependency behind it
    return `${header}// ${blocks.length} captured timeline${blocks.length === 1 ? "" : "s"} — no gsap CDN tag in the source; wire manually.
export default function ${nn(i)}() {
  return (
    ${jsx}
  );
}
`;
  }
  return `${header}export default function ${nn(i)}() {
  return (
    ${jsx}
  );
}
`;
};

export function emitNext(split: Split, outDir: string, name: string): { files: ScaffoldFile[] } {
  void outDir; // kept for Task-3 wiring symmetry; emitters are pure
  const files: ScaffoldFile[] = [];
  const add = (path: string, content: string) => files.push({ path, content });
  const sections = split.sections.sections ?? [];
  const generic = split.sections.detected === "generic";
  const hasCdns = split.scripts.cdns.length > 0;
  const attributed = attributeBlocks(split);
  const headTags = [
    ...split.scripts.headExternal.map(rewriteLocalUrlTag),
    ...split.styles.headLinks.map((t) => jsxSelfClose(rewriteLocalUrlTag(t))),
    ...split.scripts.headInlineJs.map(jsxInlineScript),
  ];
  // Generic: every loose body script (external + inline) stays raw at body end.
  // Section-nested scripts already ship inside the raw section HTML, so they
  // are not in bodyScripts (no double execution). Rebuild keeps externals only.
  const bodyScripts = generic
    ? split.scripts.bodyScripts
    : split.scripts.bodyScripts.filter((b): b is Extract<BodyScript, { kind: "external" }> => b.kind === "external");

  // kit samestack package.json shape (tsx sources ship, so the type deps must
  // too or `next dev` stalls); gsap only when the source's CDN tags say gsap.
  add(
    "package.json",
    j({
      name: packageName(name),
      private: true,
      version: "0.1.0",
      scripts: { dev: "next dev", build: "next build", start: "next start" },
      dependencies: {
        next: "^15",
        react: "^19",
        "react-dom": "^19",
        ...(hasCdns ? { gsap: "^3" } : {}),
      },
      devDependencies: { typescript: "^5", "@types/react": "^19", "@types/node": "^22" },
    }),
  );
  add("next.config.mjs", "export default {};\n");
  add(
    "tsconfig.json",
    j({
      compilerOptions: {
        target: "ES2017",
        lib: ["dom", "dom.iterable", "esnext"],
        allowJs: true,
        skipLibCheck: true,
        strict: true,
        noEmit: true,
        esModuleInterop: true,
        module: "esnext",
        moduleResolution: "bundler",
        resolveJsonModule: true,
        isolatedModules: true,
        jsx: "preserve",
        incremental: true,
        plugins: [{ name: "next" }],
      },
      include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
      exclude: ["node_modules"],
    }),
  );
  add("app/layout.tsx", layout(name, headTags, bodyScripts));
  add("app/globals.css", globalsCss(split));
  add("app/page.tsx", page(split, attributed));
  sections.forEach((s, i) => add(`components/${nn(i)}.tsx`, section(s, i, attributed, hasCdns, generic)));
  return { files };
}
