import type { ComponentNode, ComponentPack } from "./component.js";
import { isJunkColor } from "./component.js";

export type TokenCategory =
  | "colors"
  | "typography"
  | "spacing"
  | "radii"
  | "shadows"
  | "borders";

const ALL: TokenCategory[] = ["colors", "typography", "spacing", "radii", "shadows", "borders"];

const CAPS: Record<TokenCategory, number> = {
  colors: 24,
  typography: 24,
  spacing: 20,
  radii: 12,
  shadows: 8,
  borders: 8,
};

const FAMILY_CAP = 12;

export interface TokenOptions {
  maxNodes: number;
  include?: TokenCategory[];
}

export interface TypographyFamily {
  family: string;
  weights: string[];
  sizes: number[];
  lineHeights: string[];
  letterSpacings: string[];
  count: number;
}

export interface DesignTokens {
  tokens: {
    colors: Array<{ name: string; value: string; count: number }>;
    typography: {
      families: TypographyFamily[];
      sizes: Array<{ px: number; count: number }>;
    };
    spacing: Array<{ name: string; px: number; count: number }>;
    radii: Array<{ name: string; px: number; count: number }>;
    shadows: Array<{ name: string; value: string; count: number }>;
    borders: Array<{ name: string; widthPx: number; style: string; count: number }>;
  };
  css: string;
  tailwind: {
    colors: Record<string, string>;
    fontFamily: Record<string, string[]>;
    fontSize: Record<string, string>;
    spacing: Record<string, string>;
    borderRadius: Record<string, string>;
    boxShadow: Record<string, string>;
    borderWidth: Record<string, string>;
  };
  coverage: {
    nodesScanned: number;
    nodesTruncated: boolean;
    sources: TokenCategory[];
  };
  truncated: boolean;
  notes: string[];
}

function isUrl(value: string): boolean {
  return /url\s*\(/i.test(value);
}

function codePointCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** count desc, then a deterministic tie-break - never localeCompare. */
function rankStrings<T extends { count: number }>(items: T[], key: (item: T) => string): T[] {
  return items.sort((a, b) => b.count - a.count || codePointCompare(key(a), key(b)));
}

function rankNumbers<T extends { count: number }>(items: T[], key: (item: T) => number): T[] {
  return items.sort((a, b) => b.count - a.count || key(a) - key(b));
}

/** `rgb()`/`rgba(...,1)` become lowercase hex; anything else stays as computed. */
function normalizeColor(value: string): string {
  const s = value.trim().toLowerCase();
  const m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (!m) return s;
  const parts = m[1]!.replace(/\//g, " ").split(/[\s,]+/).filter(Boolean);
  if (parts.length < 3) return s;
  const rgb = parts.slice(0, 3).map((p) =>
    p.endsWith("%") ? (parseFloat(p) * 255) / 100 : Number(p),
  );
  if (rgb.some((n) => !Number.isFinite(n))) return s;
  const alphaRaw = parts[3];
  if (alphaRaw !== undefined) {
    const alpha = alphaRaw.endsWith("%") ? parseFloat(alphaRaw) / 100 : Number(alphaRaw);
    // A partial alpha has no lossless 6-digit form; keep the computed string.
    if (!Number.isFinite(alpha) || alpha < 1) return s;
  }
  return (
    "#" +
    rgb
      .map((n) => Math.min(255, Math.max(0, Math.round(n))).toString(16).padStart(2, "0"))
      .join("")
  );
}

/** Whitespace-separated px tokens (including zero/negative); null when absent/url. */
function pxTokens(value: string | undefined): number[] | null {
  if (!value || isUrl(value)) return null;
  const out: number[] = [];
  for (const token of value.trim().split(/\s+/)) {
    const m = /^(-?\d*\.?\d+)px$/i.exec(token);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n)) out.push(n);
    }
  }
  return out;
}

function positiveTokens(value: string | undefined): number[] {
  return (pxTokens(value) ?? []).filter((n) => n > 0);
}

function singlePositivePx(value: string | undefined): number | null {
  const tokens = pxTokens(value);
  return tokens && tokens.length === 1 && tokens[0]! > 0 ? tokens[0]! : null;
}

type Border = { widthPx: number; style: string };

/** Parse a border shorthand; null = intentionally skipped, "invalid" = unparseable. */
function parseBorder(value: string | undefined): Border | null | "invalid" {
  if (!value) return null;
  const v = value.trim();
  if (!v || isUrl(v)) return null;
  const style = /(solid|dashed|dotted|double|groove|ridge|inset|outset|none|hidden)/i
    .exec(v)?.[1]
    ?.toLowerCase();
  if (!style) return "invalid";
  if (style === "none" || style === "hidden") return null;
  const width = pxTokens(v)?.[0];
  if (width === undefined) return "invalid";
  if (width <= 0) return null;
  return { widthPx: width, style };
}

/** Escape a value so it cannot terminate the custom-property declaration/block. */
function cssValue(value: string): string {
  return value.replace(/[\\;{}]/g, (c) => `\\${c}`).replace(/[\r\n]+/g, " ");
}

function increment<K>(map: Map<K, number>, key: K): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function walk(root: ComponentNode, fn: (node: ComponentNode) => void): void {
  fn(root);
  for (const child of root.children) walk(child, fn);
}

export function exportDesignTokens(pack: ComponentPack, opts: TokenOptions): DesignTokens {
  const requested = opts.include;
  const include = requested === undefined ? [...ALL] : ALL.filter((c) => requested.includes(c));
  const enabled = new Set(include);
  const notes: string[] = [];
  const skipped = new Map<string, number>();
  const skip = (what: string): void => {
    skipped.set(what, (skipped.get(what) ?? 0) + 1);
  };

  const colorCounts = new Map<string, number>();
  const sizeCounts = new Map<number, number>();
  const spacingCounts = new Map<number, number>();
  const radiiCounts = new Map<number, number>();
  const shadowCounts = new Map<string, number>();
  const borderCounts = new Map<string, Border & { count: number }>();
  const families = new Map<
    string,
    {
      weights: Set<string>;
      sizes: Set<number>;
      lineHeights: Set<string>;
      letterSpacings: Set<string>;
      count: number;
    }
  >();

  walk(pack.root, (node) => {
    const s = node.styles;

    if (enabled.has("colors")) {
      for (const key of ["color", "backgroundColor"] as const) {
        const raw = s[key]?.trim();
        if (!raw || isJunkColor(raw)) continue;
        increment(colorCounts, normalizeColor(raw));
      }
    }

    const rawSize = s["fontSize"]?.trim();
    let size: number | null = null;
    if (rawSize) {
      const parsed = pxTokens(rawSize);
      if (parsed && parsed.length === 1) {
        if (parsed[0]! > 0) {
          size = parsed[0]!;
          if (enabled.has("typography")) increment(sizeCounts, size);
        }
      } else if (enabled.has("typography")) {
        skip("fontSize");
      }
    }

    if (enabled.has("typography")) {
      const family = s["fontFamily"]?.trim();
      if (family) {
        if (isUrl(family)) {
          skip("fontFamily");
        } else {
          const entry = families.get(family) ?? {
            weights: new Set<string>(),
            sizes: new Set<number>(),
            lineHeights: new Set<string>(),
            letterSpacings: new Set<string>(),
            count: 0,
          };
          entry.count++;
          const weight = s["fontWeight"]?.trim().toLowerCase();
          if (weight) entry.weights.add(weight);
          if (size !== null) entry.sizes.add(size);
          const lineHeight = s["lineHeight"]?.trim();
          if (lineHeight) entry.lineHeights.add(lineHeight);
          const tracking = s["letterSpacing"]?.trim();
          if (tracking) entry.letterSpacings.add(tracking);
          families.set(family, entry);
        }
      }
    }

    if (enabled.has("spacing")) {
      for (const key of ["margin", "padding", "gap"] as const) {
        for (const px of positiveTokens(s[key])) increment(spacingCounts, px);
      }
    }

    if (enabled.has("radii")) {
      for (const px of positiveTokens(s["borderRadius"])) increment(radiiCounts, px);
    }

    if (enabled.has("shadows")) {
      const shadow = s["boxShadow"]?.trim();
      if (shadow && shadow !== "none" && !isUrl(shadow)) increment(shadowCounts, shadow);
    }

    if (enabled.has("borders")) {
      const border = parseBorder(s["border"]);
      if (border === "invalid") {
        skip("border");
      } else if (border) {
        const key = `${border.widthPx}px ${border.style}`;
        const entry = borderCounts.get(key) ?? { ...border, count: 0 };
        entry.count++;
        borderCounts.set(key, entry);
      }
    }
  });

  if (skipped.size > 0) {
    const parts = [...skipped.entries()]
      .sort((a, b) => codePointCompare(a[0], b[0]))
      .map(([what, n]) => `${what} (${n})`);
    notes.push(`skipped unparseable values: ${parts.join(", ")}`);
  }

  const colors = rankStrings(
    [...colorCounts.entries()].map(([value, count]) => ({ value, count })),
    (c) => c.value,
  ).slice(0, CAPS.colors);

  const familiesRaw = [...families.entries()].map(([family, e]) => ({
    family,
    weights: [...e.weights].sort(codePointCompare),
    sizes: [...e.sizes].sort((a, b) => a - b),
    lineHeights: [...e.lineHeights].sort(codePointCompare),
    letterSpacings: [...e.letterSpacings].sort(codePointCompare),
    count: e.count,
  }));
  const familyList = rankStrings(familiesRaw, (f) => f.family).slice(0, FAMILY_CAP);

  const sizes = rankNumbers(
    [...sizeCounts.entries()].map(([px, count]) => ({ px, count })),
    (s) => s.px,
  ).slice(0, CAPS.typography);

  const spacing = rankNumbers(
    [...spacingCounts.entries()].map(([px, count]) => ({ px, count })),
    (s) => s.px,
  ).slice(0, CAPS.spacing);

  const radii = rankNumbers(
    [...radiiCounts.entries()].map(([px, count]) => ({ px, count })),
    (r) => r.px,
  ).slice(0, CAPS.radii);

  const shadows = rankStrings(
    [...shadowCounts.entries()].map(([value, count]) => ({ value, count })),
    (s) => s.value,
  ).slice(0, CAPS.shadows);

  const borders = rankStrings([...borderCounts.values()], (b) => `${b.widthPx}px ${b.style}`).slice(
    0,
    CAPS.borders,
  );

  const capsHit: string[] = [];
  if (colorCounts.size > CAPS.colors) capsHit.push("colors");
  if (familiesRaw.length > FAMILY_CAP) capsHit.push("font families");
  if (sizeCounts.size > CAPS.typography) capsHit.push("font sizes");
  if (spacingCounts.size > CAPS.spacing) capsHit.push("spacing");
  if (radiiCounts.size > CAPS.radii) capsHit.push("radii");
  if (shadowCounts.size > CAPS.shadows) capsHit.push("shadows");
  if (borderCounts.size > CAPS.borders) capsHit.push("borders");

  if (capsHit.length > 0) notes.push(`token caps hit: ${capsHit.join(", ")}`);

  const nodesTruncated = pack.nodeCount >= opts.maxNodes;
  if (nodesTruncated) {
    notes.push(`component pack reached maxNodes (${opts.maxNodes}); tokens may be incomplete`);
  }

  const cssLines: string[] = [];
  const tailwind: DesignTokens["tailwind"] = {
    colors: {},
    fontFamily: {},
    fontSize: {},
    spacing: {},
    borderRadius: {},
    boxShadow: {},
    borderWidth: {},
  };

  if (enabled.has("colors")) {
    colors.forEach((c, i) => {
      const name = `color-${i + 1}`;
      cssLines.push(`  --${name}: ${cssValue(c.value)};`);
      tailwind.colors[name] = c.value;
    });
  }
  if (enabled.has("typography")) {
    familyList.forEach((f, i) => {
      const name = `font-${i + 1}`;
      cssLines.push(`  --${name}: ${cssValue(f.family)};`);
      tailwind.fontFamily[name] = [f.family];
    });
    sizes.forEach((s, i) => {
      const name = `font-size-${i + 1}`;
      cssLines.push(`  --${name}: ${s.px}px;`);
      tailwind.fontSize[name] = `${s.px}px`;
    });
  }
  if (enabled.has("spacing")) {
    spacing.forEach((s, i) => {
      const name = `space-${i + 1}`;
      cssLines.push(`  --${name}: ${s.px}px;`);
      tailwind.spacing[name] = `${s.px}px`;
    });
  }
  if (enabled.has("radii")) {
    radii.forEach((r, i) => {
      const name = `radius-${i + 1}`;
      cssLines.push(`  --${name}: ${r.px}px;`);
      tailwind.borderRadius[name] = `${r.px}px`;
    });
  }
  if (enabled.has("shadows")) {
    shadows.forEach((s, i) => {
      const name = `shadow-${i + 1}`;
      cssLines.push(`  --${name}: ${cssValue(s.value)};`);
      tailwind.boxShadow[name] = s.value;
    });
  }
  if (enabled.has("borders")) {
    borders.forEach((b, i) => {
      const name = `border-${i + 1}`;
      cssLines.push(`  --${name}: ${b.widthPx}px ${b.style};`);
      tailwind.borderWidth[name] = `${b.widthPx}px`;
    });
  }

  return {
    tokens: {
      colors: colors.map((c, i) => ({ name: `--color-${i + 1}`, value: c.value, count: c.count })),
      typography: { families: familyList, sizes },
      spacing: spacing.map((s, i) => ({ name: `--space-${i + 1}`, px: s.px, count: s.count })),
      radii: radii.map((r, i) => ({ name: `--radius-${i + 1}`, px: r.px, count: r.count })),
      shadows: shadows.map((s, i) => ({ name: `--shadow-${i + 1}`, value: s.value, count: s.count })),
      borders: borders.map((b, i) => ({
        name: `--border-${i + 1}`,
        widthPx: b.widthPx,
        style: b.style,
        count: b.count,
      })),
    },
    css: `:root {\n${cssLines.join("\n")}\n}`,
    tailwind,
    coverage: {
      nodesScanned: pack.nodeCount,
      nodesTruncated,
      sources: include,
    },
    truncated: capsHit.length > 0 || nodesTruncated,
    notes,
  };
}
