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

import { attributeBlocks, bodyBounds, cssTo, headBounds, nn, packageName, scriptFile } from "./build-project.js";
import type { BodyScript, EmitResult, LoaderScript, RebuildSection, RehostSplit, ScaffoldFile, Split } from "./build-project.js";

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
// contain colons); convertAttr wraps it in {{ }}. Custom properties (--x) need
// quoted keys, and their object then needs a CSSProperties cast for TSX.
const styleToObject = (css: string): { body: string; custom: boolean } => {
  let custom = false;
  const body = css
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const i = d.indexOf(":");
      const key = d.slice(0, i).trim();
      if (key.startsWith("--")) {
        custom = true;
        return `${JSON.stringify(key)}: ${JSON.stringify(stripImportant(d.slice(i + 1).trim()))}`;
      }
      return `${cssKeyToJsx(key)}: ${JSON.stringify(stripImportant(d.slice(i + 1).trim()))}`;
    })
    .join(", ");
  return { body, custom };
};

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
  if (key === "style") {
    const style = styleToObject(value.slice(1, -1));
    return `style={{ ${style.body} }${style.custom ? " as React.CSSProperties" : ""}}`;
  }
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

const REACT_STYLE_CAST = " as React.CSSProperties";
const reactStyleImport = (jsx: string): string =>
  jsx.includes(REACT_STYLE_CAST) ? 'import type React from "react";\n' : "";

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

// Head attribute read (head tags are never rewritten by htmlToJsx before this).
const headAttr = (tag: string, name: string): string =>
  new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag)?.slice(1).find(Boolean) ?? "";

const escapeHtmlText = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const jsxRawScript = (open: string, body: string): string =>
  `${open.replace(/\s*\/?>$/, "")} dangerouslySetInnerHTML={{ __html: ${JSON.stringify(body).replace(/</g, "\\u003c")} }} />`;

// Document head carried into layout.tsx: captured title (fallback --name),
// meta/og/favicon links, and non-JS data scripts (ld+json/importmap). Local
// stylesheets were folded before the split; remote ones are added by the
// caller from headTags. Executable head scripts are handled separately (inline
// stays in head, externals go to SiteScripts).
const rehostHeadLines = (shell: string, name: string): string[] => {
  const { start, end } = headBounds(shell);
  const head = end > start ? shell.slice(start, end) : "";
  const lines: string[] = [];
  let hasTitle = false;
  for (const m of head.matchAll(/<title\b[^>]*>[\s\S]*?<\/title\s*>|<meta\b[^>]*>|<link\b[^>]*>|<script\b[^>]*>[\s\S]*?<\/script\s*>/gi)) {
    const tag = m[0];
    if (/^<title/i.test(tag)) {
      hasTitle = true;
      lines.push(htmlToJsx(tag));
      continue;
    }
    if (/^<meta/i.test(tag)) {
      // Next owns charset/viewport; carrying captured copies duplicates them.
      if (/\bcharset\s*=/i.test(tag) || /\bname\s*=\s*["']?viewport/i.test(tag)) continue;
      lines.push(jsxSelfClose(tag));
      continue;
    }
    if (/^<link/i.test(tag)) {
      if (/rel\s*=\s*["']?stylesheet/i.test(tag)) continue;
      lines.push(jsxSelfClose(rewriteLocalUrlTag(tag)));
      continue;
    }
    const open = /^<script\b[^>]*>/i.exec(tag)?.[0] ?? "";
    const type = headAttr(open, "type").toLowerCase();
    if (JS_SCRIPT_TYPES.has(type)) continue; // executable head scripts handled by headScripts
    const body = /^<script\b[^>]*>([\s\S]*?)<\/script\s*>$/i.exec(tag)?.[1] ?? "";
    lines.push(jsxRawScript(open, body));
  }
  if (!hasTitle) lines.unshift(htmlToJsx(`<title>${escapeHtmlText(name)}</title>`));
  return lines;
};

// Head scripts render as raw SSR tags in captured order. External head scripts
// keep their attributes and point at public/scripts; inline head scripts keep
// nonce/id/type through their captured attribute string.
const headScriptJsx = (entry: LoaderScript): string => {
  if (entry.kind === "external") {
    const url = entry.local ? `/scripts/${scriptFile(entry.src)}` : entry.src;
    return rewriteLocalUrlTag(entry.tag.replace(/(\bsrc\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s>]+)/i, `$1"${url}"`));
  }
  return jsxRawScript(`<script${entry.attrs ? ` ${entry.attrs}` : ""}>`, entry.js);
};

// Rehost layout: document head metadata + head scripts in captured order, one
// client loader for body scripts (see SiteScripts).
const rehostLayout = (headLines: string[], cssImports: string[], headScripts: LoaderScript[]): string =>
  `${cssImports.map((line) => `${line}\n`).join("")}import type { ReactNode } from "react";
import SiteScripts from "../components/SiteScripts";

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>${layoutHeadTags([...headLines, ...headScripts.map(headScriptJsx)])}</head>
      <body>
        {children}
        <SiteScripts />
      </body>
    </html>
  );
}
`;

const rehostBody = (rehost: RehostSplit): string => {
  const { start, end } = bodyBounds(rehost.shell);
  return rehost.shell.slice(start, end);
};

const rehostPage = (rehost: RehostSplit): string => {
  const imports = rehost.sections.map((_, i) => `import ${nn(i)} from "../components/${nn(i)}";`).join("\n");
  const jsx = htmlToJsx(rehostBody(rehost))
    .trim()
    .replace(/<(Section\d+)\/>/g, "<$1 />");
  const styleImport = reactStyleImport(jsx);
  return `${styleImport}${styleImport ? "\n" : ""}${imports}

export default function Page() {
  return (
    <>
${indent(jsx, 6)}
    </>
  );
}
`;
};

const rehostSection = (s: RebuildSection, i: number): { content: string; warning: string } => {
  const header = `// ${nn(i)} — native rehost section #${s.id || "(id-less)"}; real JSX, no slots.\n`;
  // Mustache templates are the remaining bounded-converter gap: `{{…}}` is not
  // valid JSX text. CSS custom properties now convert correctly (quoted keys +
  // CSSProperties cast) and no longer force the opaque path.
  const mustache = /\{\{|\{%/.test(s.innerHtml);
  let jsx: string | null = null;
  if (!mustache) {
    try {
      jsx = htmlToJsx(s.text);
    } catch {
      jsx = null;
    }
  }
  if (jsx !== null) {
    const styleImport = reactStyleImport(jsx);
    return {
      content: `${header}${styleImport}${styleImport ? "\n" : ""}export default function ${nn(i)}() {
  return (
    ${indent(jsx.trim(), 4)}
  );
}
`,
      warning: "",
    };
  }
  const open = htmlToJsx(s.startTag).replace(/\s*\/?>$/, "");
  const styleImport = reactStyleImport(open);
  const html = JSON.stringify(s.innerHtml).replace(/</g, "\\u003c");
  return {
    content: `${header}${styleImport}${styleImport ? "\n" : ""}export default function ${nn(i)}() {
  return (
    ${open} dangerouslySetInnerHTML={{ __html: ${html} }} />
  );
}
`,
    warning: `${nn(i)}: mustache/template syntax — shipped as opaque HTML (dangerouslySetInnerHTML)`,
  };
};

const siteScripts = (rehost: RehostSplit): string => {
  const entries = rehost.scripts
    .map((entry) =>
      entry.kind === "inline"
        ? `  { src: "", js: ${JSON.stringify(entry.js)}, type: ${JSON.stringify(entry.type)} },`
        : `  { src: ${JSON.stringify(entry.local ? `/scripts/${scriptFile(entry.src)}` : entry.src)}, js: "", type: ${JSON.stringify(entry.type)} },`,
    )
    .join("\n");
  return `"use client";

import { useEffect } from "react";

// Captured page scripts in source order. Classic scripts must run as side
// effects from their original globals; ESM imports would change their scope.
// --- site-loader:start
const SCRIPTS: Array<{ src: string; js: string; type: string }> = [
${entries}
];

function mountSiteScripts() {
  // DOM is the source of truth: a previous mount's nodes are cleared here so a
  // StrictMode remount or client navigation always runs the sequence once.
  for (const el of document.querySelectorAll("script[data-site-scripts]")) el.remove();

  let cancelled = false;

  (async () => {
    for (const entry of SCRIPTS) {
      if (cancelled) return;
      await new Promise((resolve) => {
        const el = document.createElement("script");
        el.setAttribute("data-site-scripts", "");
        if (entry.src !== "") {
          el.src = entry.src;
          if (entry.type) el.type = entry.type;
          el.onload = () => resolve(undefined);
          el.onerror = () => resolve(undefined); // a dead CDN must not stall the rest
        } else {
          if (entry.type) el.type = entry.type;
          el.textContent = entry.js;
        }
        document.body.appendChild(el);
        if (entry.src === "") resolve(undefined);
      });
    }
  })();

  return () => {
    cancelled = true;
    for (const el of document.querySelectorAll("script[data-site-scripts]")) el.remove();
  };
}
// --- site-loader:end

export default function SiteScripts() {
  useEffect(() => mountSiteScripts(), []);
  return null;
}
`;
};


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
  if (split.styles.tokensCss) parts.push(cssTo(split.styles.tokensCss, "/"));
  if (split.styles.sharedCss) parts.push(cssTo(split.styles.sharedCss, "/"));
  (split.sections.sections ?? []).forEach((s) => {
    const css = split.styles.perSection.get(s.className) ?? "";
    if (css) parts.push(cssTo(css, "/"));
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
    const styleImport = reactStyleImport(open);
    const html = JSON.stringify(s.innerHtml).replace(/</g, "\\u003c");
    return `${header}${styleImport}${styleImport ? "\n" : ""}export default function ${nn(i)}() {
  return (
    ${open} dangerouslySetInnerHTML={{ __html: ${html} }} />
  );
}
`;
  }
  const jsx = indentBody(sectionJsx(s.text));
  const styleImport = reactStyleImport(jsx);
  if (blocks.length > 0 && hasCdns) {
    // kit samestack nextSection wiring: "use client" + gsap.context + revert
    return `${header}"use client";

${styleImport}import { useEffect } from "react";
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
    return `${header}${styleImport}// ${blocks.length} captured timeline${blocks.length === 1 ? "" : "s"} — no gsap CDN tag in the source; wire manually.
export default function ${nn(i)}() {
  return (
    ${jsx}
  );
}
`;
  }
  return `${header}${styleImport}export default function ${nn(i)}() {
  return (
    ${jsx}
  );
}
`;
};

export function emitNext(split: Split, outDir: string, name: string): EmitResult {
  void outDir; // kept for Task-3 wiring symmetry; emitters are pure
  const files: ScaffoldFile[] = [];
  const warnings: string[] = [];
  const add = (path: string, content: string) => files.push({ path, content });
  const sections = split.sections.sections ?? [];
  const generic = split.sections.detected === "generic";
  const hasCdns = split.scripts.cdns.length > 0;
  const attributed = attributeBlocks(split);
  const headTags = split.headTags.map((t) =>
    t.kind === "inline"
      ? jsxInlineScript(t.js)
      : t.kind === "style"
        ? jsxSelfClose(rewriteLocalUrlTag(t.tag))
        : rewriteLocalUrlTag(t.tag),
  );
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
  const rehost = split.rehost;
  if (rehost) {
    const cssImports: string[] = [];
    if (split.styles.tokensCss) {
      add("styles/tokens.css", cssTo(split.styles.tokensCss, "/"));
      cssImports.push('import "../styles/tokens.css";');
    }
    if (split.styles.siteCss) {
      add("styles/site.css", cssTo(split.styles.siteCss, "/"));
      cssImports.push('import "../styles/site.css";');
    }
    const styleLinks = split.headTags
      .filter((t) => t.kind === "style")
      .map((t) => jsxSelfClose(rewriteLocalUrlTag(t.tag)));
    add("app/layout.tsx", rehostLayout([...rehostHeadLines(rehost.shell, name), ...styleLinks], cssImports, rehost.headScripts));
    add("app/page.tsx", rehostPage(rehost));
    rehost.sections.forEach((s, i) => {
      const section = rehostSection(s, i);
      if (section.warning) warnings.push(section.warning);
      add(`components/${nn(i)}.tsx`, section.content);
    });
    add("components/SiteScripts.tsx", siteScripts(rehost));
    return { files, warnings };
  }

  add("app/layout.tsx", layout(name, headTags, bodyScripts));
  add("app/globals.css", globalsCss(split));
  add("app/page.tsx", page(split, attributed));
  sections.forEach((s, i) => add(`components/${nn(i)}.tsx`, section(s, i, attributed, hasCdns, generic)));
  return { files, warnings };
}
