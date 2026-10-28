import { describe, expect, it } from "vitest";
import type { ComponentNode, ComponentPack } from "../src/component.js";
import { exportDesignTokens } from "../src/tokens.js";

const ALL = ["colors", "typography", "spacing", "radii", "shadows", "borders"] as const;

const node = (
  styles: Record<string, string>,
  children: ComponentNode[] = [],
  over: Partial<ComponentNode> = {},
): ComponentNode => ({
  tag: "div",
  classes: [],
  rect: { x: 0, y: 0, w: 10, h: 10 },
  styles,
  children,
  ...over,
});

const count = (n: ComponentNode): number => 1 + n.children.reduce((a, c) => a + count(c), 0);

const packOf = (root: ComponentNode, over: Partial<ComponentPack> = {}): ComponentPack => ({
  id: "component-pack-v1",
  url: "https://example.dev/",
  selector: "body",
  capturedAt: 1_700_000_000_000,
  viewport: { width: 1440, height: 900 },
  nodeCount: count(root),
  root,
  fonts: [],
  colors: [],
  ...over,
});

// Covers duplicate/junk/transparent colours, a background url that must not
// leak, normal/bold weights, "normal" line-height, multi-value shorthands and
// a zero-width/none border.
const fixture = (): ComponentPack => {
  const grandchild = node({
    color: "rgb(255, 0, 0)",
    backgroundColor: "#00FF00",
    fontFamily: "Inter, sans-serif",
    fontSize: "16px",
    fontWeight: "400",
    margin: "10px",
  });
  const childOne = node(
    {
      color: "#FF0000",
      backgroundColor: "#00ff00",
      background: "url(https://cdn.example.dev/hero.jpg) center / cover",
      fontFamily: "Inter, sans-serif",
      fontSize: "32px",
      fontWeight: "bold",
      lineHeight: "24px",
      letterSpacing: "0.5px",
      margin: "0px",
      padding: "8px",
      border: "0px none rgb(0, 0, 0)",
    },
    [grandchild],
  );
  const childTwo = node({
    color: "transparent",
    backgroundColor: "rgba(0, 0, 0, 0)",
    background: "url(/img/x.jpg) #123456",
    fontFamily: "Georgia, serif",
    fontSize: "medium",
    fontWeight: "700",
    lineHeight: "1.5",
    margin: "auto",
    gap: "8px",
    borderRadius: "50%",
    border: "2px dashed #fff",
  });
  return packOf(
    node(
      {
        color: "rgb(255, 0, 0)",
        backgroundColor: "rgba(0, 0, 0, 0)",
        background: "url(https://cdn.example.dev/bg.png)",
        fontFamily: "Inter, sans-serif",
        fontSize: "16px",
        fontWeight: "400",
        lineHeight: "normal",
        letterSpacing: "normal",
        margin: "0px 15px 10px",
        padding: "10px 20px",
        gap: "8px",
        borderRadius: "4px 8px",
        boxShadow: "0px 1px 2px rgba(0, 0, 0, 0.2)",
        border: "1px solid rgb(0, 0, 0)",
      },
      [childOne, childTwo],
      { tag: "body" },
    ),
  );
};

const opts = { maxNodes: 800 };

describe("exportDesignTokens colours", () => {
  it("normalizes, dedupes and ranks colours without leaking background urls", () => {
    const result = exportDesignTokens(fixture(), opts);

    expect(result.tokens.colors).toEqual([
      { name: "--color-1", value: "#ff0000", count: 3 },
      { name: "--color-2", value: "#00ff00", count: 2 },
    ]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("url(");
    expect(serialized).not.toContain("cdn.example.dev");
    expect(serialized).not.toContain("#123456");
    expect(serialized).not.toContain("transparent");
    expect(serialized).not.toContain("rgba(0, 0, 0, 0)");
    expect(result.css).not.toContain("url(");
  });

  it("orders equal counts by code point", () => {
    const root = node({}, [
      node({ color: "#ffffff" }),
      node({ color: "#ffffff" }),
      node({ color: "#ff0000" }),
      node({ color: "#ff0000" }),
      node({ color: "#000000" }),
      node({ color: "#000000" }),
      node({ color: "#000000" }),
    ]);
    const result = exportDesignTokens(packOf(root), opts);
    expect(result.tokens.colors.map((c) => c.value)).toEqual(["#000000", "#ff0000", "#ffffff"]);
  });
});

describe("exportDesignTokens typography", () => {
  it("cross-tabs family weights, sizes, line heights and letter spacing", () => {
    const result = exportDesignTokens(fixture(), opts);
    const families = result.tokens.typography.families;
    expect(families.map((f) => f.family)).toEqual(["Inter, sans-serif", "Georgia, serif"]);
    expect(families[0]).toEqual({
      family: "Inter, sans-serif",
      weights: ["400", "bold"],
      sizes: [16, 32],
      lineHeights: ["24px", "normal"],
      letterSpacings: ["0.5px", "normal"],
      count: 3,
    });
    expect(families[1]).toEqual({
      family: "Georgia, serif",
      weights: ["700"],
      sizes: [],
      lineHeights: ["1.5"],
      letterSpacings: [],
      count: 1,
    });
    expect(result.tokens.typography.sizes).toEqual([
      { px: 16, count: 2 },
      { px: 32, count: 1 },
    ]);
    expect(result.notes.some((n) => n.includes("fontSize"))).toBe(true);
  });
});

describe("exportDesignTokens spacing, radii, shadows and borders", () => {
  it("splits shorthands, skips non-positive values and ranks numerically", () => {
    const result = exportDesignTokens(fixture(), opts);
    expect(result.tokens.spacing).toEqual([
      { name: "--space-1", px: 8, count: 3 },
      { name: "--space-2", px: 10, count: 3 },
      { name: "--space-3", px: 15, count: 1 },
      { name: "--space-4", px: 20, count: 1 },
    ]);
    expect(result.tokens.radii).toEqual([
      { name: "--radius-1", px: 4, count: 1 },
      { name: "--radius-2", px: 8, count: 1 },
    ]);
    expect(result.tokens.shadows).toEqual([
      { name: "--shadow-1", value: "0px 1px 2px rgba(0, 0, 0, 0.2)", count: 1 },
    ]);
    expect(result.tokens.borders).toEqual([
      { name: "--border-1", widthPx: 1, style: "solid", count: 1 },
      { name: "--border-2", widthPx: 2, style: "dashed", count: 1 },
    ]);
    expect(result.tokens.borders.every((b) => b.widthPx > 0 && b.style !== "none")).toBe(true);
  });

  it("escapes values that could break out of the CSS block", () => {
    const root = node({ boxShadow: "0 0 1px red; } body { color: red" });
    const result = exportDesignTokens(packOf(root), opts);
    expect(result.css).not.toContain("; } body");
    expect(result.css).toContain("\\;");
    expect(result.css).toContain("\\}");
  });
});

describe("exportDesignTokens css and tailwind", () => {
  it("emits ordinal custom properties and matching tailwind keys", () => {
    const result = exportDesignTokens(fixture(), opts);
    expect(result.css).toContain("--color-1: #ff0000;");
    expect(result.css).toContain("--font-1: Inter, sans-serif;");
    expect(result.css).toContain("--font-size-1: 16px;");
    expect(result.css).toContain("--space-1: 8px;");
    expect(result.css).toContain("--radius-1: 4px;");
    expect(result.css).toContain("--shadow-1: 0px 1px 2px rgba(0, 0, 0, 0.2);");
    expect(result.css).toContain("--border-1: 1px solid;");

    expect(result.tailwind.colors).toEqual({ "color-1": "#ff0000", "color-2": "#00ff00" });
    expect(result.tailwind.fontFamily).toEqual({
      "font-1": ["Inter, sans-serif"],
      "font-2": ["Georgia, serif"],
    });
    expect(result.tailwind.fontSize).toEqual({ "font-size-1": "16px", "font-size-2": "32px" });
    expect(result.tailwind.spacing).toEqual({
      "space-1": "8px",
      "space-2": "10px",
      "space-3": "15px",
      "space-4": "20px",
    });
    expect(result.tailwind.borderRadius).toEqual({ "radius-1": "4px", "radius-2": "8px" });
    expect(result.tailwind.boxShadow).toEqual({
      "shadow-1": "0px 1px 2px rgba(0, 0, 0, 0.2)",
    });
    expect(result.tailwind.borderWidth).toEqual({ "border-1": "1px", "border-2": "2px" });
  });
});

describe("exportDesignTokens determinism", () => {
  it("is a pure function of the pack (no timestamp, deep equal across runs)", () => {
    const first = exportDesignTokens(fixture(), opts);
    const second = exportDesignTokens({ ...fixture(), capturedAt: 1 }, opts);
    expect(second).toEqual(first);
    expect(JSON.stringify(first)).not.toMatch(/generatedAt|capturedAt/);
  });
});

describe("exportDesignTokens caps, truncation and include", () => {
  it("caps colours, sets truncated and names the reason", () => {
    const children = Array.from({ length: 30 }, (_, i) =>
      node({ color: `#${i.toString(16).padStart(6, "0")}` }),
    );
    const result = exportDesignTokens(packOf(node({}, children)), opts);
    expect(result.tokens.colors).toHaveLength(24);
    expect(result.tokens.colors[0]).toEqual({ name: "--color-1", value: "#000000", count: 1 });
    expect(result.tokens.colors[23]).toEqual({ name: "--color-24", value: "#000017", count: 1 });
    expect(result.truncated).toBe(true);
    expect(result.notes.some((n) => n.includes("token caps hit: colors"))).toBe(true);
    expect(result.coverage.nodesTruncated).toBe(false);
  });

  it("treats nodeCount >= maxNodes as conservative truncation", () => {
    const result = exportDesignTokens(packOf(node({ color: "#000000" }), { nodeCount: 800 }), {
      maxNodes: 800,
    });
    expect(result.coverage.nodesScanned).toBe(800);
    expect(result.coverage.nodesTruncated).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.notes.some((n) => n.includes("maxNodes"))).toBe(true);
  });

  it("filters categories by include and reports only those sources", () => {
    const result = exportDesignTokens(fixture(), { maxNodes: 800, include: ["typography", "colors"] });
    expect(result.coverage.sources).toEqual(["colors", "typography"]);
    expect(result.tokens.colors).toHaveLength(2);
    expect(result.tokens.typography.families).toHaveLength(2);
    expect(result.tokens.spacing).toEqual([]);
    expect(result.tokens.radii).toEqual([]);
    expect(result.tokens.shadows).toEqual([]);
    expect(result.tokens.borders).toEqual([]);
    expect(result.css).toContain("--color-1");
    expect(result.css).toContain("--font-size-1");
    expect(result.css).not.toContain("--space-1");
    expect(result.tailwind.colors).not.toEqual({});
    expect(result.tailwind.spacing).toEqual({});
    expect(result.tailwind.boxShadow).toEqual({});
  });

  it("treats an explicit empty include as no categories", () => {
    const result = exportDesignTokens(fixture(), { maxNodes: 800, include: [] });
    expect(result.coverage.sources).toEqual([]);
    expect(result.tokens.colors).toEqual([]);
    expect(result.tailwind.colors).toEqual({});
    expect(result.truncated).toBe(false);
  });

  it("reports every category when include is omitted", () => {
    const result = exportDesignTokens(fixture(), opts);
    expect(result.coverage.sources).toEqual([...ALL]);
  });
});
