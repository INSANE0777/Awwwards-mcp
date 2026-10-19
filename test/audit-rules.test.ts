import { describe, expect, it } from "vitest";
import { scanAntiPatterns, type AntiPatternFinding } from "../src/audit-rules.js";

/** IDs of aegon's content rules, asserted verbatim. */
const IDS = {
  blur: "blur-heavy",
  scroll: "scroll-nonpassive",
  willChange: "will-change-overuse",
  infinite: "infinite-animation",
  cssVar: "css-var-keyframes",
  transitionAll: "transition-all",
  reducedMotion: "reduced-motion-missing",
  thrash: "layout-thrash",
} as const;

const ids = (f: AntiPatternFinding) => f.ruleId; // element mapper, used as .map(ids)
const find = (findings: AntiPatternFinding[], ruleId: string) =>
  findings.find((f) => f.ruleId === ruleId);

// aegon's own test fixture (A:\Motion\test\fixtures\janky-demo.html), inlined —
// blur(14px) > 10px, two infinite animations, width keyframes + transform keyframes,
// and a rAF read/write loop in the script.
const JANKY_DEMO_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  .box {
    width: 100px;
    height: 40px;
    background: teal;
    animation: grow 300ms linear infinite alternate;
  }
  .marquee {
    position: absolute;
    white-space: nowrap;
    filter: blur(14px);
    animation: slide 4s linear infinite;
  }
  @keyframes grow { from { width: 100px; } to { width: 260px; } }
  @keyframes slide { from { transform: translateX(0); } to { transform: translateX(400px); } }
</style>
</head>
<body>
  <div class="box"></div>
  <div class="marquee">wide blurry marquee layer</div>
  <script>
    const box = document.querySelector('.box');
    const blur = document.querySelector('.marquee');
    function frame() {
      const w = box.offsetWidth;          // read
      box.style.width = (w + 1) + 'px';   // write -> forced reflow next read
      box.getBoundingClientRect();        // read again: thrash pair
      blur.style.filter = 'blur(' + (14 + Math.sin(Date.now() / 100) * 2) + 'px)';
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  </script>
</body>
</html>`;

describe("scanAntiPatterns — aegon's content rules (css)", () => {
  it("blur(20px) flags HIGH; blur(6px) does not", () => {
    const bad = scanAntiPatterns({ css: ".glow { filter: blur(20px); }" });
    expect(find(bad, IDS.blur)?.severity).toBe("HIGH");
    expect(find(bad, IDS.blur)?.line).toBe(1);
    expect(scanAntiPatterns({ css: ".soft { filter: blur(6px); }" }).map(ids)).not.toContain(
      IDS.blur,
    );
  });

  it("non-passive scroll listener flags; passive one does not; wheel/touchmove are out of scope", () => {
    const bad = scanAntiPatterns({ js: "window.addEventListener('scroll', onScroll);" });
    expect(find(bad, IDS.scroll)?.severity).toBe("HIGH");
    expect(
      scanAntiPatterns({ js: "window.addEventListener('scroll', onScroll, { passive: true });" })
        .map(ids),
    ).not.toContain(IDS.scroll);
    expect(
      scanAntiPatterns({ js: "el.addEventListener('wheel', fn);" }).map(ids),
    ).not.toContain(IDS.scroll);
  });

  it("will-change overuse flags MEDIUM; <=5 uses do not", () => {
    const many = Array.from({ length: 7 }, (_, i) => `.c${i} { will-change: transform; }`).join("\n");
    const few = Array.from({ length: 3 }, (_, i) => `.c${i} { will-change: transform; }`).join("\n");
    expect(find(scanAntiPatterns({ css: many }), IDS.willChange)?.severity).toBe("MEDIUM");
    expect(scanAntiPatterns({ css: few }).map(ids)).not.toContain(IDS.willChange);
  });

  it("infinite animation flags", () => {
    const finding = find(
      scanAntiPatterns({ css: ".s { animation: spin 1s linear infinite; }" }),
      IDS.infinite,
    );
    expect(finding?.severity).toBe("MEDIUM");
    expect(finding?.line).toBe(1);
  });

  it("custom-property keyframes flag the inheritance bomb", () => {
    const finding = find(
      scanAntiPatterns({ css: "@keyframes spin { to { --angle: 360deg; } } .s { animation: spin 1s infinite; }" }),
      IDS.cssVar,
    );
    expect(finding?.severity).toBe("HIGH");
    expect(finding?.line).toBe(1);
  });

  it("transition: all flags; a listed property does not", () => {
    expect(find(scanAntiPatterns({ css: ".a { transition: all 300ms; }" }), IDS.transitionAll)?.severity)
      .toBe("MEDIUM");
    expect(
      scanAntiPatterns({ css: ".a { transition: transform 300ms; }" }).map(ids),
    ).not.toContain(IDS.transitionAll);
  });

  it("reduced-motion-missing INFO fires without prefers-reduced-motion in the same input", () => {
    const without = scanAntiPatterns({ css: "@keyframes pulse { 50% { opacity: 0; } } .p { animation: pulse 2s; }" });
    const rm = find(without, IDS.reducedMotion);
    expect(rm?.severity).toBe("INFO");
    const withOverride = scanAntiPatterns({
      css: "@keyframes pulse { 50% { opacity: 0; } } @media (prefers-reduced-motion: reduce) { .p { animation: none; } }",
    });
    expect(withOverride.map(ids)).not.toContain(IDS.reducedMotion);
  });

  it("scroll handler that reads then writes layout flags tier F thrash; without the read it does not", () => {
    const code = `
      window.addEventListener('scroll', () => {
        const h = el.getBoundingClientRect().height + window.scrollY;
        el.style.height = h + 'px';
      });`;
    const thrash = find(scanAntiPatterns({ js: code }), IDS.thrash);
    expect(thrash?.tier).toBe("F");
    expect(thrash?.severity).toBe("HIGH");
    expect(thrash?.line).toBe(2);

    const writeOnly = "window.addEventListener('scroll', () => { el.style.height = '10px'; });";
    expect(scanAntiPatterns({ js: writeOnly }).map(ids)).not.toContain(IDS.thrash);
  });
});

describe("scanAntiPatterns — animated-property tiers", () => {
  it("width keyframes → D", () => {
    const f = scanAntiPatterns({
      css: "@keyframes grow { from { width: 0; } to { width: 100%; } } .a { animation: grow 1s infinite; }",
    }).find((x) => x.ruleId === "animated-property" && x.message.includes('"width"'));
    expect(f?.tier).toBe("D");
    expect(f?.driver).toBe("css");
  });

  it("transform transition → S", () => {
    const f = scanAntiPatterns({ css: ".box { transition: transform 300ms ease; }" }).find(
      (x) => x.ruleId === "animated-property" && x.message.includes('"transform"'),
    );
    expect(f?.tier).toBe("S");
    expect(f?.driver).toBe("css");
  });

  it("border-radius → C (paint), opacity → S, unknown properties are ignored not guessed", () => {
    const out = scanAntiPatterns({ css: ".x { foo: 1; }" });
    expect(out).toHaveLength(0);

    const out2 = scanAntiPatterns({
      css: "@keyframes pulse { 50% { border-radius: 50%; opacity: 0.5; } } .r { animation: pulse 2s; }",
    }).filter((x) => x.ruleId === "animated-property");
    expect(out2.find((x) => x.message.includes('"border-radius"'))?.tier).toBe("C");
    expect(out2.find((x) => x.message.includes('"opacity"'))?.tier).toBe("S");
  });

  it("gsap compositor props demote S→A; width stays D regardless of driver", () => {
    const out = scanAntiPatterns({ js: "gsap.to('.box', { x: 100, width: 300, duration: 1 });" }).filter(
      (x) => x.ruleId === "animated-property",
    );
    expect(out.find((x) => x.message.includes('"x"'))?.tier).toBe("A");
    expect(out.find((x) => x.message.includes('"x"'))?.driver).toBe("gsap");
    expect(out.find((x) => x.message.includes('"width"'))?.tier).toBe("D");
  });

  it("waapi .animate() drives, compositor props stay S", () => {
    const out = scanAntiPatterns({
      js: "el.animate({ transform: 'translateX(10px)', width: '10px' }, 300);",
    }).filter((x) => x.ruleId === "animated-property");
    expect(out.find((x) => x.message.includes('"transform"'))?.tier).toBe("S");
    expect(out.find((x) => x.message.includes('"transform"'))?.driver).toBe("waapi");
    expect(out.find((x) => x.message.includes('"width"'))?.tier).toBe("D");
  });
});

describe("scanAntiPatterns — inputs, sources, lines, determinism", () => {
  it("aegon's janky-demo.html fires blur-heavy, infinite animations and D/S tiers from the html input", () => {
    const out = scanAntiPatterns({ html: JANKY_DEMO_HTML });
    const blur = find(out, IDS.blur);
    expect(blur?.source).toBe("html");
    expect(blur?.line).toBe(15); // filter: blur(14px);
    expect(find(out, IDS.infinite)?.line).toBe(10); // animation: grow … infinite
    expect(find(out, IDS.reducedMotion)?.source).toBe("html");
    const props = out.filter((x) => x.ruleId === "animated-property");
    expect(props.find((x) => x.message.includes('"width"'))?.tier).toBe("D");
    expect(props.find((x) => x.message.includes('"transform"'))?.tier).toBe("S");
  });

  it("routes each input to its own source and counts lines per input", () => {
    const out = scanAntiPatterns({
      css: ".glow { filter: blur(20px); }",
      js: "el.addEventListener('scroll',\n  fn,\n  {});",
    });
    const blur = find(out, IDS.blur);
    const scroll = find(out, IDS.scroll);
    expect(blur?.source).toBe("css");
    expect(blur?.line).toBe(1);
    expect(scroll?.source).toBe("js");
    expect(scroll?.line).toBe(1);
  });

  it("per-input rule counting matches aegon's per-file behavior (7 in one input, 3 in the other → flags only the 7)", () => {
    const many = Array.from({ length: 7 }, () => ".c { will-change: transform; }").join("\n");
    const few = Array.from({ length: 3 }, () => ".c { will-change: transform; }").join("\n");
    const out = scanAntiPatterns({ css: few, html: few, js: many });
    const flags = out.filter((f) => f.ruleId === IDS.willChange);
    expect(flags).toHaveLength(1);
    expect(flags[0].source).toBe("js");
  });

  it("is deterministic: identical input → identical findings", () => {
    const input = { css: ".a { transition: all 200ms; }", js: JANKY_DEMO_HTML };
    const a = scanAntiPatterns(input);
    const b = scanAntiPatterns(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("scanAntiPatterns — never throws on hostile/empty input", () => {
  it("empty call and empty strings yield no findings", () => {
    expect(scanAntiPatterns()).toEqual([]);
    expect(scanAntiPatterns({ css: "", html: "", js: "" })).toEqual([]);
  });

  it("non-string values are skipped, not cast or thrown on", () => {
    const hostile = { html: undefined, js: null, css: 42 } as unknown as { css?: string; html?: string; js?: string };
    expect(scanAntiPatterns(hostile)).toEqual([]);
  });

  it("regex-hostile and unicode garbage never throws", () => {
    expect(
      scanAntiPatterns({
        css: "((((((((( [[[[[[[ {{" + ":".repeat(500),
        html: "<style>@keyframes \\u0000 \\uFFFF \\x00--[\\w-]+\\s*:</style>".repeat(50),
        js: "\u0000".repeat(100) + "function(()){" + "\\p{L}".repeat(200),
      }),
    ).toEqual(expect.any(Array));
  });

  it("100k of repeated code scans in bulk without throwing", () => {
    const big = "will-change: transform;".repeat(5000);
    const out = scanAntiPatterns({ css: big });
    expect(find(out, IDS.willChange)?.ruleId).toBe(IDS.willChange);
  });
});
