import { describe, expect, it } from "vitest";
import { htmlToJsx, emitNext } from "../src/emit-next.js";
import { parseRebuildSections, splitBuild } from "../src/build-project.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const FIXTURES = join(__dirname, "fixtures", "build-project");
const sample = () => readFileSync(join(FIXTURES, "sample.html"), "utf8");
const sample2 = () => readFileSync(join(FIXTURES, "sample2.html"), "utf8");
const sample3 = () => readFileSync(join(FIXTURES, "sample3.html"), "utf8");

const nextByName = (html: string, name = "Neu Omni 2") => emitNext(splitBuild(html), "unused", name).files;
const byPath = (files: Array<{ path: string; content: string }>) =>
  Object.fromEntries(files.map((f) => [f.path, f.content]));

// Generated TSX must parse, not merely contain the expected substring.
const transpileErrors = (source: string, fileName = "layout.tsx"): string[] => {
  const out = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ESNext },
    fileName,
    reportDiagnostics: true,
  });
  return (out.diagnostics ?? []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
};

// ---- htmlToJsx: kit jsx.test.ts ports (tricky-attr fidelity law) ----

describe("htmlToJsx: attr renames (kit ports)", () => {
  it("class → className", () => {
    expect(htmlToJsx('<div class="c-0">x</div>')).toBe('<div className="c-0">x</div>');
  });

  it("for → htmlFor", () => {
    expect(htmlToJsx('<label for="q">Q</label>')).toBe('<label htmlFor="q">Q</label>');
  });

  it("className passes through unchanged (no double conversion)", () => {
    expect(htmlToJsx('<div className="c-0">x</div>')).toBe('<div className="c-0">x</div>');
  });

  it("lowercase video attrs map to JSX names (playsinline → playsInline)", () => {
    expect(htmlToJsx('<video playsinline muted></video>')).toBe('<video playsInline muted></video>');
  });
});

describe("htmlToJsx: svg attr table (kit ports)", () => {
  it("camelCases the known dashed svg attrs, keeps xmlns, converts xlink:href", () => {
    const out = htmlToJsx(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><path d="M0 0" stroke-width="3" fill-rule="evenodd" stroke-linecap="round" xlink:href="#a" data-note="keep-me"/></svg>',
    );
    expect(out).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><path d="M0 0" strokeWidth="3" fillRule="evenodd" strokeLinecap="round" xlinkHref="#a" data-note="keep-me"/></svg>',
    );
  });

  it("unknown dashed attrs are left as-is", () => {
    expect(htmlToJsx('<circle my-attr="1"/>')).toBe('<circle my-attr="1"/>');
  });

  it("converts rebuild-generated media svg verbatim", () => {
    const out = htmlToJsx(
      '<svg width="100%" height="100%" viewBox="0 0 400 300" preserveAspectRatio="none" role="img" aria-label="Your image 1"><rect width="400" height="300" fill="#f3f3f3"/><rect x="160" y="100" width="80" height="60" rx="6" fill="none" stroke="#9a9a9a" stroke-width="3"/><circle cx="182" cy="118" r="7" fill="#9a9a9a"/><path d="M164 152 L192 124 L206 138 L218 128 L236 152 Z" fill="#9a9a9a"/><text x="200" y="200" text-anchor="middle" fill="#666" font-family="sans-serif" font-size="22">Your image 1</text></svg>',
    );
    expect(out).toContain('strokeWidth="3"');
    expect(out).toContain('textAnchor="middle"');
    expect(out).toContain('fontFamily="sans-serif"');
    expect(out).toContain('fontSize="22"');
    expect(out).toContain('aria-label="Your image 1"');
  });
});

describe("htmlToJsx: void tags (kit ports)", () => {
  it("self-closes void tags and converts attrs inside them", () => {
    expect(htmlToJsx('<img src="a.png" class="c-1">')).toBe('<img src="a.png" className="c-1"/>');
    expect(htmlToJsx("line one<br>line two<hr>end")).toBe("line one<br/>line two<hr/>end");
  });

  it("drops a void tag's paired close tag (rebuild emits </br> for captured <br>)", () => {
    expect(htmlToJsx('<h3><br class="c-1"></br>after</h3>')).toBe('<h3><br className="c-1"/>after</h3>');
  });

  it("already self-closed void tags stay stable", () => {
    expect(htmlToJsx('<img src="a.png"/>')).toBe('<img src="a.png"/>');
  });
});

describe("htmlToJsx: style attr (kit ports)", () => {
  it("converts style to an object literal, values as strings, quoted camelCase keys", () => {
    expect(
      htmlToJsx('<div class="c-2" style="aspect-ratio: 400/300; border: 1px dashed #999; background: #f3f3f3;">x</div>'),
    ).toBe('<div className="c-2" style={{ "aspectRatio": "400/300", "border": "1px dashed #999", "background": "#f3f3f3" }}>x</div>');
  });

  it("quotes every key (custom properties too) and casts the style object to React.CSSProperties", () => {
    expect(htmlToJsx('<div style="--x: 9%; --y: calc(100% - 2px); color: red">x</div>')).toBe(
      '<div style={{ "--x": "9%", "--y": "calc(100% - 2px)", "color": "red" } as React.CSSProperties}>x</div>',
    );
    expect(htmlToJsx('<div style="color: red">x</div>')).not.toContain("as React.CSSProperties");
  });

  it("drops keys that are not plain CSS property names (no computed keys in JSX)", () => {
    const jsx = htmlToJsx(`<div style="[globalThis.__pwned=31337]: 1; *zoom: 1; {color: red}; -: 2; 'foo bar: 1'; color: blue">x</div>`);
    expect(jsx).toBe('<div style={{ "color": "blue" }}>x</div>');
    for (const bad of ["globalThis", "__pwned", "*zoom", "{color", "'foo bar", "-:"]) {
      expect(jsx).not.toContain(bad);
    }
  });

  it("maps head-tag attributes React types as camelCase strings", () => {
    expect(htmlToJsx('<meta charset="utf-8">')).toContain('charSet="utf-8"');
    expect(htmlToJsx('<link rel="preconnect" crossorigin>')).toContain('crossOrigin="anonymous"');
    expect(htmlToJsx('<script nomodule fetchpriority="high"></script>')).toContain("noModule");
    expect(htmlToJsx('<script nomodule fetchpriority="high"></script>')).toContain('fetchPriority="high"');
    expect(htmlToJsx('<link rel="alternate" hreflang="en">')).toContain('hrefLang="en"');
    expect(htmlToJsx('<meta itemprop="name" itemscope itemtype="https://schema.org/Thing">')).toContain('itemProp="name"');
    expect(htmlToJsx('<meta itemprop="name" itemscope itemtype="https://schema.org/Thing">')).toContain("itemScope");
    expect(htmlToJsx('<meta itemprop="name" itemscope itemtype="https://schema.org/Thing">')).toContain('itemType="https://schema.org/Thing"');
  });

  it("uses the first colon only (url values with colons survive)", () => {
    expect(htmlToJsx('<span style="color: red"></span>')).toBe('<span style={{ "color": "red" }}></span>');
  });

  it("strips !important suffixes from style values", () => {
    expect(htmlToJsx('<svg style="visibility: visible !important; opacity: 1 !important; transform: translate(0px, 0px)">')).toBe(
      '<svg style={{ "visibility": "visible", "opacity": "1", "transform": "translate(0px, 0px)" }}>',
    );
  });

  it("-ms- vendor prefix maps to lowercase ms (React types: msTransform)", () => {
    expect(htmlToJsx('<div style="-ms-transform: none; -webkit-transform: none"></div>')).toContain(
      '"msTransform": "none", "WebkitTransform": "none"',
    );
  });
});

describe("htmlToJsx: captured-svg JSX legality (kit ports)", () => {
  it("lowercased svg tags from HTML parsing remap to camelCase JSX elements", () => {
    const out = htmlToJsx('<svg><defs><clippath id="a"><rect width="1" height="1"/></clippath><lineargradient id="b"/></defs></svg>');
    expect(out).toContain("<clipPath");
    expect(out).toContain("</clipPath>");
    expect(out).toContain("<linearGradient");
    expect(out).not.toContain("<clippath");
  });

  it("namespaced attrs (xmlns:*, xml:*) are dropped, xlink:href becomes xlinkHref", () => {
    const out = htmlToJsx(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve"><image xlink:href="#p"/></svg>',
    );
    expect(out).not.toContain("xmlns:xlink");
    expect(out).not.toContain("xml:space");
    expect(out).toContain('xlinkHref="#p"');
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"');
  });
});

describe("htmlToJsx: comments, entities, determinism (kit ports)", () => {
  it("strips HTML comments", () => {
    expect(htmlToJsx("a<!-- hidden note -->b<!-- fonts auto-linked -->")).toBe("ab");
  });

  it("preserves html entities as-is", () => {
    expect(htmlToJsx("<p>Tom &amp; Jerry &lt;3 &copy; 2026</p>")).toBe("<p>Tom &amp; Jerry &lt;3 &copy; 2026</p>");
  });

  it("is deterministic — same input, byte-equal output", () => {
    const html = '<section class="c-0" data-slot="text-1"><svg viewBox="0 0 1 1" stroke-width="1"/><img style="aspect-ratio: 4/3;"></section>';
    expect(htmlToJsx(html)).toBe(htmlToJsx(html));
    expect(htmlToJsx(html)).toBe(
      '<section className="c-0" data-slot="text-1"><svg viewBox="0 0 1 1" strokeWidth="1"/><img style={{ "aspectRatio": "4/3" }}/></section>',
    );
  });
});

describe("htmlToJsx: text-brace escaping (port add-on — the next-side twin of the astro set:html guard)", () => {
  it("escapes braces in text nodes as JSX-safe entities", () => {
    expect(htmlToJsx("<p>Price: {from} 99</p>")).toBe("<p>Price: &#123;from&#125; 99</p>");
  });

  it("attribute values keep verbatim braces (they are string literals in JSX)", () => {
    expect(htmlToJsx('<div data-json=\'{"a":1}\'>x</div>')).toBe('<div data-json=\'{"a":1}\'>x</div>');
  });

  it("strips CSS comments before splitting declarations", () => {
    expect(htmlToJsx('<div style="color: /* note */ red; /* a;b */ background: url(a/*x*/b)">x</div>')).toBe(
      '<div style={{ "color": "red", "background": "url(ab)" }}>x</div>',
    );
    // A comment inside a quoted value is data, not a comment.
    expect(htmlToJsx('<div style="content: \'/* keep */\'; color: red">x</div>')).toBe(
      '<div style={{ "content": "\'/* keep */\'", "color": "red" }}>x</div>',
    );
  });

  it("keeps Unicode custom-property names (quoted keys stay safe)", () => {
    expect(htmlToJsx('<div style="--色: red; color: var(--色)">x</div>')).toBe(
      '<div style={{ "--色": "red", "color": "var(--色)" } as React.CSSProperties}>x</div>',
    );
    expect(htmlToJsx('<div style="--主色-2: rgb(1, 2, 3)">x</div>')).toBe(
      '<div style={{ "--主色-2": "rgb(1, 2, 3)" } as React.CSSProperties}>x</div>',
    );
    // A name that is not a custom property or a plain property is still dropped.
    expect(htmlToJsx('<div style="--: 1; --a b: 2; color: blue">x</div>')).toBe('<div style={{ "color": "blue" }}>x</div>');
  });

  it("a Unicode custom property reaches the layout and transpiles", () => {
    const html = `<!doctype html><html lang="zh" style="--色: red; --主色: rgb(1, 2, 3)"><head><title>x</title></head><body style="color: var(--色)"><section class="c-1"><p class="c-2">x</p></section></body></html>`;
    const text = byPath(nextByName(html))["app/layout.tsx"] ?? "";
    expect(text).toContain('"--色": "red", "--主色": "rgb(1, 2, 3)"');
    expect(text).toContain('"color": "var(--色)"');
    expect(transpileErrors(text)).toEqual([]);
  });

  it("attribute names that are not JSX identifiers pass through a quoted spread", () => {
    expect(htmlToJsx('<div data-foo.bar="ok" data-a:b="1" data-plain="2">x</div>')).toBe(
      '<div {...{"data-foo.bar": "ok"}} {...{"data-a:b": "1"}} data-plain="2">x</div>',
    );
    // Bare (valueless) exotic names are "" in the DOM, never `true`.
    expect(htmlToJsx('<div data-x.y>x</div>')).toBe('<div {...{"data-x.y": ""}}>x</div>');
    expect(htmlToJsx('<div data-e.z="">x</div>')).toBe('<div {...{"data-e.z": ""}}>x</div>');
    expect(transpileErrors(`const a = ${htmlToJsx('<div data-foo.bar="ok">x</div>')};`)).toEqual([]);
  });

  it("spread values are JS literals decoded like a browser attribute", () => {
    const jsx = htmlToJsx(
      '<div data-a.b="a&amp;b" data-c.d="C:\\new" data-e.f="one&#10;two" data-g.h="&copy;" data-i.j="&nbsp;" data-k.l="&Amp;" data-m.n="&#x80;">x</div>',
    );
    // A JSX string would decode entities itself; the JS literal must be decoded
    // here instead, and must not turn \n into a newline or break across lines.
    expect(jsx).toBe(
      '<div {...{"data-a.b": "a&b"}} {...{"data-c.d": "C:\\\\new"}} {...{"data-e.f": "one\\ntwo"}} ' +
        `{...{"data-g.h": "©"}} {...{"data-i.j": "\u00a0"}} {...{"data-k.l": "&Amp;"}} {...{"data-m.n": "€"}}>x</div>`,
    );
    expect(transpileErrors(`const a = ${jsx};`)).toEqual([]);
  });

  it("a document attribute with entities, a backslash and a newline spreads as data", () => {
    const html = `<!doctype html><html lang="en" data-a.b="x&amp;y" data-c.d="C:\\new" data-cy.x="&copy;" data-cs.x="&Amp;" data-win.x="&#x80;"><head><title>x</title></head><body><section class="c-1"><p class="c-2">x</p></section></body></html>`;
    const text = byPath(nextByName(html))["app/layout.tsx"] ?? "";
    expect(text).toContain('{...{"data-a.b": "x&y"}}');
    expect(text).toContain('{...{"data-c.d": "C:\\\\new"}}');
    expect(text).toContain('{...{"data-cy.x": "©"}}');
    expect(text).toContain('{...{"data-cs.x": "&Amp;"}}');
    expect(text).toContain('{...{"data-win.x": "€"}}');
    expect(text).not.toContain("&amp;");
    expect(transpileErrors(text)).toEqual([]);
  });

  it("a dotted data attribute on the document reaches the layout as a quoted spread", () => {
    const html = `<!doctype html><html lang="en" data-foo.bar="ok"><head><title>x</title></head><body class="real" data-x:y="1"><section class="c-1"><p class="c-2">x</p></section></body></html>`;
    const text = byPath(nextByName(html))["app/layout.tsx"] ?? "";
    expect(text).toContain('{...{"data-foo.bar": "ok"}}');
    expect(text).toContain('{...{"data-x:y": "1"}}');
    expect(transpileErrors(text)).toEqual([]);
  });

  it("keeps repeated and edge spaces inside quoted values, normalizes only separators", () => {
    expect(htmlToJsx('<div data-m.text="one  two" data-p.x=" pad " class="a  b">x</div>')).toBe(
      '<div {...{"data-m.text": "one  two"}} {...{"data-p.x": " pad "}} className="a  b">x</div>',
    );
    // Attribute separators (and a dropped attribute) still collapse to one space.
    expect(htmlToJsx('<div    class="a"    xmlns:foo="x"   id="b">x</div>')).toBe('<div className="a" id="b">x</div>');
  });

  it("a > inside a quoted value does not end the tag", () => {
    expect(htmlToJsx('<div data-gt.text="a>b" class="c" id="d">x</div>')).toBe(
      '<div {...{"data-gt.text": "a>b"}} className="c" id="d">x</div>',
    );
    expect(htmlToJsx('<div title="a>b" class="c">x</div>')).toBe('<div title="a>b" className="c">x</div>');
    expect(htmlToJsx('<img alt="1>0" src="x.png"/>')).toBe('<img alt="1>0" src="x.png"/>');
    // Text that is not a tag is untouched.
    expect(htmlToJsx('<p>a < b</p>')).toBe('<p>a < b</p>');
  });

  it("ordinary attributes decode entities with HTML rules, not JSX rules", () => {
    // JSX turns &#128; into U+0080; a browser (and Vite/Astro) give €.
    expect(htmlToJsx('<div aria-label="Price &#128;5">x</div>')).toBe('<div aria-label={"Price €5"}>x</div>');
    expect(htmlToJsx('<div aria-label="a &amp; b &copy;">x</div>')).toBe('<div aria-label={"a & b ©"}>x</div>');
    // Unchanged by the HTML decoder: keep the bare literal shape.
    expect(htmlToJsx('<div aria-label="&Amp;">x</div>')).toBe('<div aria-label="&Amp;">x</div>');
    expect(htmlToJsx('<div data-u="a&display=swap">x</div>')).toBe('<div data-u="a&display=swap">x</div>');
    expect(htmlToJsx('<div aria-label="plain">x</div>')).toBe('<div aria-label="plain">x</div>');
  });

  it("restores CR document attributes with one inline script, only when needed", () => {
    const withCr = `<!doctype html><html lang="en" data-cr.x="a&#13;b" data-crlt.x="x&#13;&lt;/script&gt;"><head><title>x</title></head><body class="real" data-bcr.y="c&#13;d"><section class="c-1"><p class="c-2">x</p></section></body></html>`;
    const text = byPath(nextByName(withCr))["app/layout.tsx"] ?? "";
    // <html> CR restores first in head, <body> CR as the first body child.
    expect(text).toContain('<head><script dangerouslySetInnerHTML={{ __html: "(()=>{const e=document.documentElement');
    expect(text).toContain("const e=document.body");
    expect(text).toContain('\\"data-cr.x\\":\\"a\\\\rb\\"');
    expect(text).toContain('\\"data-bcr.y\\":\\"c\\\\rd\\"');
    // `<` is escaped in the payload, so a value can never close the script.
    const payloads = [...text.matchAll(/__html: ("(?:[^"\\]|\\.)*")/g)].map((m) => JSON.parse(m[1]!) as string);
    expect(payloads).toHaveLength(2);
    for (const js of payloads) {
      expect(js).not.toContain("<");
      expect(js).toContain("\\r"); // JSON-style CR escape, not a raw CR/LF
    }
    expect(transpileErrors(text)).toEqual([]);

    // A document without CR keeps the plain layout.
    const plain = `<!doctype html><html lang="en" data-x.y="1"><head><title>x</title></head><body class="real"><section class="c-1"><p class="c-2">x</p></section></body></html>`;
    const plainText = byPath(nextByName(plain))["app/layout.tsx"] ?? "";
    expect(plainText).not.toContain("setAttribute");
    expect(plainText).not.toContain("dangerouslySetInnerHTML");
  });

  it("literal CR/CRLF is newline-normalized before decoding; only entities make CR", () => {
    const CR = "\r";
    // Ordinary and dotted attributes with real CR and CRLF bytes.
    expect(htmlToJsx(`<div title="a${CR}b${CR}\nc" data-x.y="d${CR}e">x</div>`)).toBe(
      '<div title={"a\\nb\\nc"} {...{"data-x.y": "d\\ne"}}>x</div>',
    );
    // A character reference decodes *after* normalization, so it keeps U+000D.
    expect(htmlToJsx('<div title="a&#13;b" data-x.y="c&#13;d">x</div>')).toBe(
      '<div title={"a\\rb"} {...{"data-x.y": "c\\rd"}}>x</div>',
    );
    expect(htmlToJsx('<div title="a&#xD;b">x</div>')).toBe('<div title={"a\\rb"}>x</div>');
  });

  it("restores a CR document attribute only from an entity, never from literal CR", () => {
    const CR = "\r";
    const doc = (htmlAttrs: string) =>
      `<!doctype html><html lang="en" ${htmlAttrs}><head><title>x</title></head><body class="real"><section class="c-1"><p class="c-2">x</p></section></body></html>`;
    const literal = byPath(nextByName(doc(`data-lit.x="a${CR}b${CR}\nc" data-ent.y="e&#13;f"`)))["app/layout.tsx"] ?? "";
    // The literal CR is data only as LF, so it must not reach the restore map.
    const payloads = [...literal.matchAll(/__html: ("(?:[^"\\]|\\.)*")/g)].map((m) => JSON.parse(m[1]!) as string);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toContain('"data-ent.y"');
    expect(payloads[0]).not.toContain("data-lit.x");
    expect(literal).toContain('{...{"data-lit.x": "a\\nb\\nc"}}');
    // Nothing at all when every CR was literal.
    const onlyLiteral = byPath(nextByName(doc(`data-lit.x="a${CR}b"`)))["app/layout.tsx"] ?? "";
    expect(onlyLiteral).not.toContain("dangerouslySetInnerHTML");
    expect(onlyLiteral).toContain('{...{"data-lit.x": "a\\nb"}}');
  });

  it("decodes named references in styles before splitting declarations", () => {
    // Document and section styles go through the same converter.
    const html = `<!doctype html><html lang="en" style="content: '&copy;'"><head><title>x</title></head><body class="real" style="font-family: '&nbsp;Sans'; --amp: '&Amp;'"><section class="c-1" style="content: 'A;&copy;B'; color: red"><p class="c-2">x</p></section></body></html>`;
    const text = byPath(nextByName(html))["app/layout.tsx"] ?? "";
    expect(text).toContain(`"content": "'©'"`);
    expect(text).toContain(`"fontFamily": "'${"\u00a0"}Sans'"`);
    expect(text).toContain(`"--amp": "'&Amp;'"`);
    expect(transpileErrors(text)).toEqual([]);

    const section = emitNext(splitBuild(html), "unused", "x").files.find((f) => f.content.includes("<section"));
    // `;` inside the now-decoded quoted value does not split the declaration.
    expect(section?.content).toContain(`"content": "'A;©B'"`);
    expect(section?.content).toContain('"color": "red"');
  });

  it("still drops executable styles that hide behind a named reference", () => {
    const html = `<!doctype html><html lang="en" style="background: url(javascript&colon;alert(1))"><head><title>x</title></head><body class="real"><section class="c-1"><p class="c-2">x</p></section></body></html>`;
    const text = byPath(nextByName(html))["app/layout.tsx"] ?? "";
    expect(text).not.toContain("javascript");
    expect(text).toContain('<html lang="en">');
  });

  it("braces inside style object values survive (quoted JS strings there)", () => {
    const out = htmlToJsx('<span style="content: \'{ok}\'; color: red">y</span>');
    expect(out).toContain('"content": "\'{ok}\'"');
    expect(out).not.toContain("&#123;'ok}");
  });
});

// ---- emitNext tree ----

describe("emitNext", () => {
  const files = nextByName(sample());
  const f = byPath(files);

  it("file tree is exactly the next scaffold set", () => {
    expect(files.map((x) => x.path).sort()).toEqual(
      [
        "package.json",
        "next.config.mjs",
        "tsconfig.json",
        "app/layout.tsx",
        "app/globals.css",
        "app/page.tsx",
        "components/Section01.tsx",
        "components/Section02.tsx",
        "components/Section03.tsx",
        "hooks/usePageMotion.ts",
        "hooks/useSectionMotion.ts",
        "motion.manifest.json",
      ].sort(),
    );
  });

  it("package.json: next/react, gsap only when cdns; type deps because tsx ships", () => {
    const pkg = JSON.parse(f["package.json"] ?? "{}") as {
      name: string;
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.name).toBe("neu-omni-2");
    expect(pkg.scripts.build).toBe("next build");
    expect(pkg.dependencies.next).toBe("^15");
    expect(pkg.dependencies.react).toBe("^19");
    expect(pkg.dependencies["react-dom"]).toBe("^19");
    expect(pkg.dependencies.gsap).toBe("^3");
    expect(pkg.devDependencies.typescript).toBeDefined();
    expect(JSON.parse(f["tsconfig.json"] ?? "{}")).toMatchObject({ compilerOptions: { jsx: "preserve" } });
  });

  it("layout: metadata title, globals import, font link self-closed", () => {
    const layout = f["app/layout.tsx"] ?? "";
    expect(layout).toContain('import "./globals.css";');
    expect(layout).toContain('title: "Neu Omni 2"');
    expect(layout).toContain('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Demo+Local&display=swap" />');
    expect(layout).not.toContain("/ />"); // M1: already self-closed links stay single-slash
  });

  it("page: SectionNN composition, use client when inlineJs exists, no page-level effect when all blocks attribute", () => {
    const page = f["app/page.tsx"] ?? "";
    expect(page.startsWith('"use client";')).toBe(true);
    expect(page).toContain('import Section01 from "../components/Section01";');
    expect(page).toContain("<Section01 />");
    expect(page).toContain("<Section02 />");
    expect(page).toContain("<Section03 />");
    expect(page).toContain("<main>");
    expect(page).not.toContain("useEffect");
    expect(page).not.toContain("from \"gsap\"");
  });

  it("globals.css: tokens + shared + section buckets, urls re-based to /assets/", () => {
    const css = f["app/globals.css"] ?? "";
    expect(css).toContain("--c-1: rgb(20, 20, 20);");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain(".c-12 { display: grid; }");
    expect(css).toContain('url("/assets/hero-b.png")');
    expect(css).not.toContain('url("./assets/');
  });

  it("wired sections: use client + useEffect + gsap.context + revert, blocks whole (incl. ; args)", () => {
    const s2 = f["components/Section02.tsx"] ?? "";
    expect(s2).toContain('"use client";');
    expect(s2).toContain('import gsap from "gsap";');
    expect(s2).toContain('import { ScrollTrigger } from "gsap/ScrollTrigger";');
    expect(s2).toContain("const ctx = gsap.context(() => {");
    expect(s2).toContain('if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;');
    expect(s2).toContain('.from(".c-13", { opacity: 0, y: 40 });');
    expect(s2).toContain("return () => ctx.revert();");
    const s3 = f["components/Section03.tsx"] ?? "";
    expect(s3).toContain("end: \"function(){ return getMax(); }\"");
    expect(s3).toContain("onStart: () => { void 0; }");
  });

  it("jsx conversion fidelity in components: className, style object, svg attrs; comments stripped", () => {
    const s1 = f["components/Section01.tsx"] ?? "";
    expect(s1).toContain('<div className="c-2">Crafted digital work</div>');
    const s2 = f["components/Section02.tsx"] ?? "";
    expect(s2).toContain('<img className="c-14" src="./assets/hero-a.png" alt="" style={{ "aspectRatio": "4/3" }}/>');
    // markup ships converted — raw class=/style= never survives into tsx
    expect(s2).not.toContain('class="');
    const s3 = f["components/Section03.tsx"] ?? "";
    expect(s3).toContain('<div className="c-24">Pricing</div>');
  });

  it("plain section stays a server component; text braces are entity-escaped in tsx", () => {
    const braces = `<!doctype html><html><body>
<section class="c-1"><p class="c-2">Price: {from} 99</p></section>
</body></html>`;
    const f2 = byPath(nextByName(braces));
    const s1 = f2["components/Section01.tsx"] ?? "";
    expect(s1).not.toContain('"use client"');
    expect(s1).not.toContain("useEffect");
    expect(s1).not.toContain("{from}");
    expect(s1).toContain("&#123;from&#125;");
  });

  it("generic html: loose inline script ships once as raw body-end SSR HTML", () => {
    const generic = `<!doctype html>
<html><head><style>.hero { color: red; }</style></head>
<body>
<header class="hero"><h1>Hey</h1></header>
<script>document.querySelectorAll("h1").forEach(() => {});</script>
</body></html>`;
    const f3 = byPath(nextByName(generic));
    const page = f3["app/page.tsx"] ?? "";
    const layout = f3["app/layout.tsx"] ?? "";
    expect(page).not.toContain('"use client"');
    expect(page).not.toContain("useEffect");
    expect(page).not.toContain("querySelectorAll");
    expect(layout).toContain("dangerouslySetInnerHTML");
    expect(layout).toContain("querySelectorAll(\\\"h1\\\")");
    expect(JSON.stringify(f3).split("querySelectorAll").length - 1).toBe(1);
  });

  it("blocks without any gsap cdn are recorded, never wired (kit reconcile law)", () => {
    const noCdn = `<!doctype html><html><body>
<section class="c-1"><div class="c-2">x</div></section>
<script>
// captured anim: .c-2 | props: opacity
gsap.timeline({ scrollTrigger: { trigger: ".c-2", start: "top 80%" } })
  .from(".c-2", { opacity: 0 });
</script>
</body></html>`;
    const f4 = byPath(nextByName(noCdn));
    const s1 = f4["components/Section01.tsx"] ?? "";
    expect(s1).not.toContain('"use client"');
    expect(s1).not.toContain('from "gsap"');
    expect(s1).toContain("1 captured timeline — no gsap CDN tag in the source; wire manually.");
  });

  it("unattributable rebuild blocks run in a page-level gsap effect, never dropped", () => {
    const orphan = `<!doctype html><html><head>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/ScrollTrigger.min.js"></script>
</head><body>
<section class="c-5"><div class="c-6">x</div></section>
<script>
// captured anim: .c-999 animates as a unit
gsap.timeline({ scrollTrigger: { trigger: ".c-999", start: "top 85%" } })
  .from(".c-999", { opacity: 0 });
</script>
</body></html>`;
    const f5 = byPath(nextByName(orphan));
    const page = f5["app/page.tsx"] ?? "";
    expect(page).toContain('import gsap from "gsap";');
    expect(page).toContain("gsap.registerPlugin(ScrollTrigger);");
    expect(page).toContain(".from(\".c-999\", { opacity: 0 });");
    expect(f5["components/Section01.tsx"]).not.toContain("useEffect");
  });

  it("rehost shape: local css/js carried as public paths; section + loose scripts run once in place", () => {
    const files = nextByName(sample2());
    const f = byPath(files);
    const layout = f["app/layout.tsx"] ?? "";
    const s1 = f["components/Section01.tsx"] ?? "";
    const page = f["app/page.tsx"] ?? "";
    expect(layout).toContain('<link rel="stylesheet" href="/assets/site.css" />');
    expect(layout).not.toContain("/ />"); // M1: self-closed input must not double-slash
    expect(layout).toContain('<script src="https://cdn.example.test/lenis.min.js"></script>');
    expect(layout).toContain('<script src="https://unpkg.com/split-type"></script>');
    expect(layout).toContain('<script src="/assets/site.js" defer></script>');
    expect(layout).toContain("__tailRuns");
    expect(s1).toContain("dangerouslySetInnerHTML");
    expect(s1).toContain("__heroRuns");
    expect(s1).toContain(".hero > p");
    expect(page).not.toContain("__heroRuns");
    expect(files.map((x) => x.path)).not.toContain("components/SiteScripts.tsx");
    expect(JSON.stringify(files).split("__heroRuns").length - 1).toBe(1);
  });

  it("root-relative rehost: public paths + strict vendor order, head bootstrap kept", () => {
    const files = nextByName(sample3());
    const f = byPath(files);
    const layout = f["app/layout.tsx"] ?? "";
    expect(layout).toContain('<link rel="stylesheet" href="/styles.css" />');
    const [css, head, gsap, st, app] = ['href="/styles.css"', '<script src="/vendor/head.js">', '<script src="/vendor/gsap.min.js">', '<script src="/vendor/ScrollTrigger.min.js">', '<script src="/app.js">'].map((n) => layout.indexOf(n));
    expect(css).toBeGreaterThan(-1);
    expect(head).toBeGreaterThan(css);
    expect(gsap).toBeGreaterThan(head);
    expect(st).toBeGreaterThan(gsap);
    expect(app).toBeGreaterThan(st);
    expect(layout).toContain("prefers-reduced-motion");
    expect(f["components/Section01.tsx"]).toContain('<div className="stage" id="stage" dangerouslySetInnerHTML');
    expect(f["components/Section02.tsx"]).toContain('<div className="scroll-space" id="space" dangerouslySetInnerHTML');
  });

  it("determinism: two runs are byte-equal", () => {
    expect(JSON.stringify(nextByName(sample()))).toBe(JSON.stringify(nextByName(sample())));
  });

  it("fixture sections survive conversion verbatim-in-spirit (start/close tags kept, converted)", () => {
    const sections = parseRebuildSections(sample()).sections ?? [];
    const s1 = f["components/Section01.tsx"] ?? "";
    expect(s1).toContain('<section className="c-0">');
    expect(s1).toContain("</section>");
    // original inner whitespace preserved, indentBody lifts every line but the
    // first by one level (kit nextSection's return-( shape)
    expect(s1).toContain('        <div className="c-1">' + "\n" + '          <div className="c-2">Crafted digital work</div>');
    expect(s1).not.toContain('class="');
    expect(sections.map((s) => s.className)).toEqual(["c-0", "c-12", "c-23"]);
  });
});

describe("emitNext: document attributes (M3)", () => {
  const themed = `<!doctype html>
<html lang='ar' dir='rtl' class="theme-night" data-theme="night" style="--ink: 1px">
<head><title>x</title></head>
<body dir="rtl" class="page" data-page="home" aria-label="Home page">
<section class="c-1"><p class="c-2">x</p></section>
</body></html>`;

  it("layout html/body carry converted document props and the JSX still parses", () => {
    const text = byPath(nextByName(themed))["app/layout.tsx"] ?? "";
    expect(text).toContain(
      '<html lang="ar" dir="rtl" className="theme-night" data-theme="night" style={{ "--ink": "1px" } as React.CSSProperties}>',
    );    expect(text).toContain('<body dir="rtl" className="page" data-page="home" aria-label="Home page">');
    const transpiled = ts.transpileModule(text, {
      compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ESNext },
      fileName: "layout.tsx",
      reportDiagnostics: true,
    });
    const diagnostics = (transpiled.diagnostics ?? []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    expect(diagnostics).toEqual([]);
  });

  it("input without document attributes keeps the en fallback and a bare body", () => {
    const bare = `<!doctype html><html><body><section class="c-1"><p class="c-2">x</p></section></body></html>`;
    const text = byPath(nextByName(bare))["app/layout.tsx"] ?? "";
    expect(text).toContain('<html lang="en">');
    expect(text).toContain("<body>");
  });

  it("inline styles with quotes, entities and semicolons stay valid JSX with their real values", () => {
    // Raw quotes inside a single-quoted attribute, escaped quotes in a
    // double-quoted one, and `;`s that live inside a quoted CSS value.
    const html = `<!doctype html>
<html lang='ar' style='background-image: url("hero.png"); font-family: "My Font"'>
<head><title>x</title></head>
<body style="background: url(&quot;hero.png&quot;); --label: &quot;A;B&quot;">
<section class="c-1"><p class="c-2">x</p></section>
</body></html>`;
    const text = byPath(nextByName(html))["app/layout.tsx"] ?? "";
    expect(text).toContain('"backgroundImage": "url(\\"hero.png\\")"');
    expect(text).toContain('"fontFamily": "\\"My Font\\""');
    expect(text).toContain('"background": "url(\\"hero.png\\")"');
    expect(text).toContain('"--label": "\\"A;B\\""');
    expect(text).toContain("as React.CSSProperties");
    expect(transpileErrors(text)).toEqual([]);

    // A `;` inside url("…") must not split the declaration either.
    const url = `<!doctype html><html lang="en" style='background-image: url("hero;art.png"); color: red'><head><title>x</title></head><body><section class="c-1"><p class="c-2">x</p></section></body></html>`;
    const urlLayout = byPath(nextByName(url))["app/layout.tsx"] ?? "";
    expect(urlLayout).toContain('"backgroundImage": "url(\\"hero;art.png\\")"');
    expect(urlLayout).toContain('"color": "red"');
    expect(transpileErrors(urlLayout)).toEqual([]);
  });

  it("a computed or invalid declaration name never becomes an executable object key", () => {
    const html = `<!doctype html><html lang="en" style="[globalThis.__pwned=31337]: 1; *zoom: 1; {color:red}; -:2; 'foo bar:1'; color: blue"><head><title>x</title></head><body><section class="c-1"><p class="c-2">x</p></section></body></html>`;
    const text = byPath(nextByName(html))["app/layout.tsx"] ?? "";
    expect(text).toContain('style={{ "color": "blue" }}');
    for (const bad of ["globalThis", "__pwned", "*zoom", "{color", "'foo bar", "-:"]) {
      expect(text).not.toContain(bad);
    }
    expect(transpileErrors(text)).toEqual([]);
  });

  it("a style fragment that is not a declaration never emits invalid JSX", () => {
    const html = `<!doctype html><html lang="en" style="color: red; not-a-declaration; background: blue"><head><title>x</title></head><body><section class="c-1"><p class="c-2">x</p></section></body></html>`;
    const text = byPath(nextByName(html))["app/layout.tsx"] ?? "";
    expect(text).toContain('"color": "red"');
    expect(text).toContain('"background": "blue"');
    expect(text).not.toContain("not-a-declaration");
    expect(transpileErrors(text)).toEqual([]);

    // Entirely unparseable: no empty style object is emitted at all.
    const junk = `<!doctype html><html lang="en" style="expression(alert(1))"><head><title>x</title></head><body style="nonsense"><section class="c-1"><p class="c-2">x</p></section></body></html>`;
    const junkText = byPath(nextByName(junk))["app/layout.tsx"] ?? "";
    expect(junkText).toContain('<html lang="en">');
    expect(junkText).toContain("<body>");
    expect(junkText).not.toContain("style={{");
  });
});
