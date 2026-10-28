import { describe, expect, it } from "vitest";
import type { RawImage } from "../src/images.js";
import { IMAGE_SCAN_SNIPPET, summarizeImages } from "../src/images.js";

const CDN = "https://cdn.example.dev/";

const img = (over: Partial<RawImage> = {}): RawImage => ({
  currentSrc: "",
  src: `${CDN}hero.jpg`,
  complete: true,
  naturalWidth: 1200,
  naturalHeight: 800,
  displayWidth: 600,
  displayHeight: 400,
  widthAttr: "1200",
  heightAttr: "800",
  loadingAttr: null,
  srcset: null,
  sizes: null,
  altAttr: "Hero",
  role: null,
  ariaHidden: null,
  ...over,
});

describe("summarizeImages source and format", () => {
  it("prefers currentSrc, strips query/hash and canonicalizes extensions", () => {
    const report = summarizeImages(
      [
        img({
          currentSrc: `${CDN}hero.avif?w=1200#top`,
          src: `${CDN}hero.jpg`,
          naturalWidth: 2400,
        }),
        img({
          src: `${CDN}fallback.jpeg?cache=1#x`,
          naturalWidth: 1600,
          displayWidth: 500,
        }),
      ],
      200,
    );

    expect(report.byFormat).toEqual([
      { format: "avif", count: 1 },
      { format: "jpeg", count: 1 },
    ]);
    expect(report.samples.map((sample) => sample.src)).toEqual([
      `${CDN}hero.avif`,
      `${CDN}fallback.jpeg`,
    ]);
    expect(report.samples.map((sample) => sample.format)).toEqual(["avif", "jpeg"]);
    expect(report.samples.every((sample) => sample.issue === "oversized")).toBe(true);
  });

  it("collapses data URIs to data:<mime> without leaking payload", () => {
    const report = summarizeImages(
      [
        img({
          src: `${CDN}photo.png?w=800#frag`,
          naturalWidth: 1600,
          displayWidth: 500,
        }),
        img({
          src: "data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C/svg%3E",
          naturalWidth: 100,
          naturalHeight: 100,
          displayWidth: 50,
          displayHeight: 50,
        }),
      ],
      200,
    );

    expect(report.byFormat).toEqual([
      { format: "png", count: 1 },
      { format: "svg", count: 1 },
    ]);
    expect(report.samples.map((sample) => sample.src)).toEqual([
      `${CDN}photo.png`,
      "data:image/svg+xml",
    ]);
    expect(JSON.stringify(report)).not.toContain("%3Csvg");
    expect(JSON.stringify(report)).not.toContain("charset");
  });

  it("strips URL userinfo from sample src", () => {
    const report = summarizeImages(
      [
        img({ src: "https://user:p%40ss@cdn.example.dev/hero.png?cache=1#frag" }),
        img({ src: "//user:pass@cdn.example.dev/rel.webp" }),
      ],
      200,
    );

    expect(report.samples.map((sample) => sample.src)).toEqual([
      `${CDN}hero.png`,
      "//cdn.example.dev/rel.webp",
    ]);
  });

  it("falls back to other when the pathname has no extension", () => {
    const report = summarizeImages(
      [img({ src: `${CDN}api/image?id=42`, srcset: "x 1x" })],
      200,
    );
    expect(report.byFormat).toEqual([{ format: "other", count: 1 }]);
  });
});

describe("IMAGE_SCAN_SNIPPET sanitization", () => {
  it("reduces data URIs in both src fields and caps srcset/sizes at 200 chars", () => {
    const attrs: Record<string, string> = {
      srcset: "data:image/png;base64," + "A".repeat(500) + " 1x",
      sizes: "(min-width: 1px) " + "1".repeat(400),
    };
    const image = {
      currentSrc: "data:image/webp;base64," + "B".repeat(1000),
      src: "data:image/svg+xml;charset=utf-8,%3Csvg%3E",
      complete: true,
      naturalWidth: 100,
      naturalHeight: 100,
      getBoundingClientRect: () => ({ width: 50, height: 50 }),
      getAttribute: (name: string) => attrs[name] ?? null,
    };
    const g = globalThis as any;
    const saved = g.document;
    g.document = { images: [image] };
    try {
      const scan = IMAGE_SCAN_SNIPPET();
      expect(scan.rows[0]!.currentSrc).toBe("data:image/webp");
      expect(scan.rows[0]!.src).toBe("data:image/svg+xml");
      expect(scan.rows[0]!.srcset).toHaveLength(200);
      expect(scan.rows[0]!.sizes).toHaveLength(200);
      // Presence survives truncation, so the reducer still counts both.
      const report = summarizeImages(scan.rows, 200);
      expect(report.responsive).toEqual({ withSrcset: 1, withSizes: 1, missing: 0 });
    } finally {
      g.document = saved;
    }
  });
});

describe("summarizeImages attributes", () => {
  it("reads the loading attribute, not the IDL default", () => {
    const report = summarizeImages(
      [
        img({ loadingAttr: "lazy" }),
        img({ loadingAttr: "EAGER" }),
        img({ loadingAttr: "auto" }),
        img({ loadingAttr: "" }),
        img({ loadingAttr: null }),
      ],
      200,
    );
    expect(report.loading).toEqual({ lazy: 1, eager: 1, missing: 3 });
  });

  it("counts only non-empty srcset/sizes attributes", () => {
    const report = summarizeImages(
      [
        img({ srcset: "a.jpg 1x, a@2x.jpg 2x", sizes: "(min-width: 600px) 50vw, 100vw" }),
        img({ srcset: "", sizes: "   " }),
        img({ srcset: null, sizes: null }),
      ],
      200,
    );
    expect(report.responsive).toEqual({ withSrcset: 1, withSizes: 1, missing: 2 });
  });

  it("counts missing width/height attributes only on complete images", () => {
    const report = summarizeImages(
      [
        img({ widthAttr: null }),
        img({ heightAttr: null }),
        img({ widthAttr: null, heightAttr: null }),
        img({
          complete: false,
          naturalWidth: 0,
          naturalHeight: 0,
          widthAttr: null,
          heightAttr: null,
          srcset: "x 1x",
        }),
      ],
      200,
    );

    expect(report.notLoaded).toBe(1);
    expect(report.dimensions.missingWidthAttr).toBe(2);
    expect(report.dimensions.missingHeightAttr).toBe(2);
    expect(report.samples.map((sample) => sample.issue)).toEqual([
      "missing-dimensions",
      "missing-dimensions",
      "missing-dimensions",
    ]);
  });
});

describe("summarizeImages dimensions and load state", () => {
  it("keeps incomplete and broken disjoint and excludes incomplete from size classes", () => {
    const report = summarizeImages(
      [
        img({
          complete: false,
          naturalWidth: 0,
          naturalHeight: 0,
          displayWidth: 10,
          displayHeight: 10,
          srcset: "x 1x",
        }),
        img({ complete: true, naturalWidth: 0, naturalHeight: 0 }),
      ],
      200,
    );

    expect(report.notLoaded).toBe(1);
    expect(report.broken).toBe(1);
    expect(report.dimensions.tiny).toBe(0);
    expect(report.dimensions.oversized).toBe(0);
    expect(report.samples.map((sample) => sample.issue)).toEqual(["broken"]);
  });

  it("counts zero-rect images only in zeroRect and excludes them from tiny/oversized", () => {
    const report = summarizeImages(
      [
        img({ displayWidth: 0, displayHeight: 0, srcset: "x 1x" }),
        img({ displayWidth: 0, displayHeight: 300, srcset: "x 1x" }),
        img({
          naturalWidth: 30,
          naturalHeight: 30,
          displayWidth: 20,
          displayHeight: 20,
          srcset: "x 1x",
        }),
      ],
      200,
    );

    expect(report.dimensions.zeroRect).toBe(2);
    expect(report.dimensions.tiny).toBe(1);
    expect(report.dimensions.oversized).toBe(0);
    expect(report.samples.map((sample) => sample.issue)).toEqual(["tiny"]);
  });

  it("uses strict 2x oversized and 32px tiny boundaries", () => {
    const report = summarizeImages(
      [
        img({ naturalWidth: 1000, naturalHeight: 800, displayWidth: 500, displayHeight: 400, srcset: "x 1x" }),
        img({ naturalWidth: 1001, naturalHeight: 800, displayWidth: 500, displayHeight: 400, srcset: "x 1x" }),
        img({ naturalWidth: 31, naturalHeight: 31, displayWidth: 31, displayHeight: 31, srcset: "x 1x" }),
        img({ naturalWidth: 32, naturalHeight: 32, displayWidth: 32, displayHeight: 32, srcset: "x 1x" }),
      ],
      200,
    );

    expect(report.dimensions.oversized).toBe(1);
    expect(report.dimensions.tiny).toBe(1);
    expect(report.samples.map((sample) => sample.issue)).toEqual(["oversized", "tiny"]);
  });
});

describe("summarizeImages alt policy", () => {
  it("separates present, empty and missing alt without flagging presentational images", () => {
    const report = summarizeImages(
      [
        img({ altAttr: "Logo", srcset: "x 1x" }),
        img({ altAttr: "", srcset: "x 1x" }),
        img({ altAttr: "   ", srcset: "x 1x" }),
        img({ altAttr: null, role: "presentation", srcset: "x 1x" }),
        img({ altAttr: null, role: "none", srcset: "x 1x" }),
        img({ altAttr: null, ariaHidden: "TRUE", srcset: "x 1x" }),
        img({ altAttr: null, srcset: "x 1x" }),
      ],
      200,
    );

    expect(report.alt).toEqual({ present: 1, empty: 2, missing: 4 });
    expect(report.samples).toHaveLength(1);
    expect(report.samples[0]).toMatchObject({ issue: "missing-alt" });
    expect(report.notes.some((note) => note.includes("presentational"))).toBe(true);
  });

  it("returns no samples for a clean image", () => {
    const report = summarizeImages(
      [img({ altAttr: "Hero", srcset: "hero.jpg 1x", sizes: "100vw" })],
      200,
    );
    expect(report.samples).toEqual([]);
    expect(report.truncated).toBe(false);
  });
});

describe("summarizeImages caps and samples", () => {
  it("scans only the first maxImages and reports aggregates over the scanned set", () => {
    const rows = [
      img({ src: `${CDN}a.png`, loadingAttr: "lazy" }),
      img({ src: `${CDN}b.webp`, loadingAttr: "eager" }),
      img({ src: `${CDN}c.gif` }),
      img({ src: `${CDN}d.avif` }),
    ];

    const capped = summarizeImages(rows, 2);
    expect(capped.total).toBe(4);
    expect(capped.scanned).toBe(2);
    expect(capped.byFormat).toEqual([
      { format: "png", count: 1 },
      { format: "webp", count: 1 },
    ]);
    expect(capped.loading).toEqual({ lazy: 1, eager: 1, missing: 0 });
    expect(capped.truncated).toBe(true);

    const full = summarizeImages(rows, 4);
    expect(full.scanned).toBe(4);
    expect(full.truncated).toBe(false);

    const none = summarizeImages(rows, 0);
    expect(none.scanned).toBe(0);
    expect(none.byFormat).toEqual([]);
    expect(none.samples).toEqual([]);
    expect(none.truncated).toBe(true);
  });

  it("uses sample cap as a truncation signal only when a sample is dropped", () => {
    const makeRows = (count: number): RawImage[] =>
      Array.from({ length: count }, (_, i) => img({ src: `${CDN}${i}.png` }));

    const twenty = summarizeImages(makeRows(20), 200);
    expect(twenty.samples).toHaveLength(20);
    expect(twenty.truncated).toBe(false);

    const twentyOne = summarizeImages(makeRows(21), 200);
    expect(twentyOne.samples).toHaveLength(20);
    expect(twentyOne.truncated).toBe(true);
  });

  it("picks one sample per issue kind first, then fills in document order", () => {
    const report = summarizeImages(
      [
        img({ srcset: null }),
        img({ widthAttr: null, heightAttr: null }),
        img({ altAttr: null, srcset: "x 1x" }),
        img({
          naturalWidth: 20,
          naturalHeight: 20,
          displayWidth: 20,
          displayHeight: 20,
          altAttr: null,
          widthAttr: null,
          heightAttr: null,
          srcset: null,
        }),
        img({
          naturalWidth: 1200,
          naturalHeight: 800,
          displayWidth: 500,
          displayHeight: 400,
          altAttr: null,
          widthAttr: null,
          heightAttr: null,
          srcset: null,
        }),
        img({
          complete: true,
          naturalWidth: 0,
          naturalHeight: 0,
          altAttr: null,
          widthAttr: null,
          heightAttr: null,
          srcset: null,
        }),
        img({ srcset: null }),
      ],
      200,
    );

    expect(report.samples.map((sample) => sample.issue)).toEqual([
      "broken",
      "oversized",
      "tiny",
      "missing-alt",
      "missing-dimensions",
      "no-srcset",
      "no-srcset",
    ]);
  });

  it("is deterministic and does not mutate the rows", () => {
    const rows = [
      img({ src: `${CDN}z.webp` }),
      img({ src: `${CDN}a.png` }),
      img({ src: `${CDN}m.jpg` }),
    ];
    const before = JSON.stringify(rows);

    const first = summarizeImages(rows, 200);
    const second = summarizeImages(rows, 200);

    expect(first).toEqual(second);
    expect(JSON.stringify(rows)).toBe(before);
    expect(first.byFormat.map((entry) => entry.format)).toEqual(["jpeg", "png", "webp"]);
    expect(first.samples.map((sample) => sample.src)).toEqual([
      `${CDN}z.webp`,
      `${CDN}a.png`,
      `${CDN}m.jpg`,
    ]);
  });
});
