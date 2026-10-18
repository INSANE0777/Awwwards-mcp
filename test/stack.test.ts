import { describe, expect, it, vi } from "vitest";
import {
  analyzeStack,
  buildStack,
  collectLibs,
  detectCss,
  detectFramework,
} from "../src/stack.js";

// Fixtures: minimal marker-bearing HTML per framework. Markers are exact
// substring tests, so one marker per fixture suffices; density fixtures
// control the CSS arbitration ladder instead.
const NEXT_HTML = `<div id="__next"><script src="/_next/static/chunk.js"></script>`;
const ASTRO_HTML = `<astro-island uid="a"><div data-astro-cid="x"></div></astro-island>`;
const STATIC_HTML = `<html><body><h1>Static site</h1></body></html>`;
const TAILWIND_HTML =
  `<div class="flex flex-col"><div class="grid grid-cols-2 bg-slate-100">` +
  `<span class="text-[#ff0000]"></span><span class="flex"></span><span class="bg-black"></span></div></div>`;
const BOOTSTRAP_HTML = `<nav class="navbar-dark"><div class="btn-primary col-md-6"></div></nav>`;

describe("detectFramework", () => {
  it("detects Next.js markers with high confidence", () => {
    const fw = detectFramework(NEXT_HTML);
    expect(fw.framework).toBe("next");
    expect(fw.markers).toContain("/_next/");
    expect(fw.confidence).toBe("high");
  });

  it("detects Astro", () => {
    const fw = detectFramework(ASTRO_HTML);
    expect(fw.framework).toBe("astro");
    expect(fw.confidence).toBe("high");
  });

  it("falls back to static/low for unknown HTML", () => {
    const fw = detectFramework(STATIC_HTML);
    expect(fw.framework).toBe("static");
    expect(fw.markers).toEqual([]);
    expect(fw.confidence).toBe("low");
  });

  it("uses table-order precedence: next beats a page that also mentions astro", () => {
    const fw = detectFramework(ASTRO_HTML + `/_next/static/x.js`);
    expect(fw.framework).toBe("next");
  });
});

describe("detectCss", () => {
  it("requires density >= 8 utility matches within class attributes only", () => {
    // 8 distinct matches: flex, flex-col, grid, grid-cols-2, bg-slate-100,
    // text-[#ff0000], flex (repeat still counts toward density), plus none
    // outside classes.
    expect(detectCss(TAILWIND_HTML)).toEqual({
      css: "tailwind", markers: expect.any(Array), confidence: "high",
    });
    // Prose mentioning "flex" outside a class attribute must not count.
    const prose = `<p>flex grid bg layout</p>`.repeat(3);
    expect(detectCss(prose)).toEqual({ css: "custom", markers: [], confidence: "low" });
  });

  it("requires >= 2 bootstrap markers for high confidence, 1 for medium", () => {
    expect(detectCss(BOOTSTRAP_HTML)).toEqual({
      css: "bootstrap",
      markers: ["btn-", "col-md-", "navbar-"],
      confidence: "high",
    });
    expect(detectCss(`<div class="btn-primary"></div>`)).toEqual({
      css: "bootstrap", markers: ["btn-"], confidence: "medium",
    });
  });

  it("keeps the arbitration ladder: tw>=8 > bs>=2 > tw>=3 > bs=1 > custom", () => {
    // tw >= 8 beats bs >= 2 (8 utility matches vs 3 bootstrap markers).
    const both = `<div class="flex flex-col grid grid-cols-2 bg-white text-[#111] bg-black flex-row">${BOOTSTRAP_HTML}`;
    expect(detectCss(both).css).toBe("tailwind");
    // tw >= 3 (medium) beats a single bootstrap marker.
    const tw3 = `<div class="flex grid bg-black"><div class="btn-primary"></div>`;
    expect(detectCss(tw3)).toEqual({
      css: "tailwind", markers: expect.any(Array), confidence: "medium",
    });
  });
});

describe("collectLibs", () => {
  it("merges stack.libs + stack.render lowercase with dedupe", () => {
    expect(collectLibs({ stack: { libs: ["GSAP", "gsap"], render: ["WebGL"] } }))
      .toEqual(["gsap", "webgl"]);
  });

  it("tolerates missing dna entirely", () => {
    expect(collectLibs(undefined)).toEqual([]);
    expect(collectLibs({})).toEqual([]);
  });
});

describe("buildStack", () => {
  it("produces the versioned stack-fingerprint-v1 payload", () => {
    const s = buildStack({ html: NEXT_HTML });
    expect(s.id).toBe("stack-fingerprint-v1");
    expect(s.framework).toBe("next");
    expect(s.css).toBe("custom");
    expect(s.libs).toEqual([]);
  });

  it("merges motionDna libs", () => {
    const s = buildStack({ html: NEXT_HTML, motionDna: { stack: { libs: ["GSAP"], render: ["webgl"] } } });
    expect(s.libs).toEqual(["gsap", "webgl"]);
  });

  it("is deterministic: two calls are JSON-equal", () => {
    const a = JSON.stringify(buildStack({ html: TAILWIND_HTML }));
    const b = JSON.stringify(buildStack({ html: TAILWIND_HTML }));
    expect(a).toBe(b);
  });
});

describe("analyzeStack", () => {
  it("fetches via fetchFn, fingerprints the HTML, stamps stack-fingerprint-v1", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(NEXT_HTML, { status: 200 }),
    ) as unknown as typeof fetch;
    const result = await analyzeStack("https://example.com", { fetchFn });
    expect(!("error" in result)).toBe(true);
    if (!("error" in result)) {
      expect(result.id).toBe("stack-fingerprint-v1");
      expect(result.framework).toBe("next");
    }
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("surfaces a thrown fetch as { error } containing the message", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const result = await analyzeStack("https://example.com", { fetchFn });
    expect(result).toEqual({ error: expect.stringContaining("ECONNREFUSED") });
  });

  it("maps non-ok responses to { error: 'HTTP <status> fetching <url>' }", async () => {
    const fetchFn = vi.fn(async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
    const result = await analyzeStack("https://example.com/page", { fetchFn });
    expect(result).toEqual({ error: "HTTP 404 fetching https://example.com/page" });
  });

  it("source-locks the polite UA string and the AbortController timeout", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/stack.ts", import.meta.url), "utf8");
    expect(src).toContain("stack-fingerprint/1.0 (research tooling)");
    expect(src).toContain("new AbortController()");
  });
});
