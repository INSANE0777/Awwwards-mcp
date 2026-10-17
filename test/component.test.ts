import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMPONENT_SNIPPET, captureComponent, reduceComponent } from "../src/component.js";
import type { ComponentNode, ComponentPack } from "../src/component.js";
import { createHandlers } from "../src/server.js";
import { AwwwardsClient } from "../src/awwwards.js";
import { Cache } from "../src/cache.js";

describe("COMPONENT_SNIPPET source contract", () => {
  it("is a plain function expression (no arrows)", () => {
    const src = String(COMPONENT_SNIPPET);
    expect(src).not.toContain("=>");
    expect(src.trimStart().startsWith("function")).toBe(true);
  });
  it("mirrors census capture contract: no direct awwwards references", () => {
    expect(String(COMPONENT_SNIPPET)).not.toMatch(/awwwards/i);
  });
  it("declares its style-prop list inline (page.evaluate serializes no closure)", () => {
    // A module-scope STYLE_PROPS referenced inside the snippet would be
    // undefined in the page — the declaration must live in the function body.
    expect(String(COMPONENT_SNIPPET)).toContain("const STYLE_PROPS");
  });
});

describe("COMPONENT_SNIPPET fidelity source contract", () => {
  const src = String(COMPONENT_SNIPPET);
  it("captures ::before/::after through the content gate (source-lock)", () => {
    expect(src).toContain('getComputedStyle(el, "::before")');
    expect(src).toContain('getComputedStyle(el, "::after")');
    // Pseudo styles reuse stylesOf with the pseudo arg (same STYLE_PROPS list).
    expect(src).toContain('stylesOf(el, "::before")');
    expect(src).toContain('stylesOf(el, "::after")');
  });
  it("gates pseudo capture on a real content value", () => {
    expect(src).toContain('cs.content !== "none"');
    expect(src).toContain('cs.content !== "normal"');
  });
  it("declares the 18 new fidelity style keys inline", () => {
    const keys = [
      "left", "top", "right", "bottom",
      "backgroundImage", "backgroundSize", "backgroundPosition",
      "alignItems", "justifyContent", "flexWrap", "textAlign",
      "minHeight", "maxHeight", "minWidth", "maxWidth",
      "filter", "backdropFilter", "objectFit", "aspectRatio",
    ];
    for (const key of keys) expect(src).toContain('"' + key + '"');
  });
  it("clamps maxNodes in-page for safety (source-lock)", () => {
    // Numeric literals are transpiled (2000 → 2e3), so match the operator form.
    expect(src).toContain("Math.max(1, Math.min(");
    expect(src).toContain("|| 400)");
  });
});

// --- reducer fixtures -------------------------------------------------------

const n = (children: ComponentNode[] = [], over: Partial<ComponentNode> = {}): ComponentNode => ({
  tag: "div",
  classes: [],
  rect: { x: 0, y: 0, w: 1, h: 1 },
  styles: {},
  children,
  ...over,
});

// Recursive count — the ground truth reduceComponent.nodeCount is checked against.
const countNodes = (node: ComponentNode): number =>
  1 + node.children.reduce((a, c) => a + countNodes(c), 0);

// deep(k) is a k+1-node chain — deeper than any shallow depth cap.
const deep = (levels: number): ComponentNode => (levels <= 0 ? n() : n([deep(levels - 1)]));

// One in-page scan as COMPONENT_SNIPPET returns it (plain data only).
const scan = (over: object = {}) => ({
  notFound: false,
  selector: "header",
  nodeCount: 3,
  fonts: ["Zig", "Arial", "Zig"],
  colors: ["#ffffff", "#000000", "#ffffff"],
  root: n([n(), n()], { tag: "header" }),
  ...over,
});

describe("reduceComponent", () => {
  const input = (scanOver: object, over: object = {}) => ({
    url: "https://example.dev",
    capturedAt: 5,
    selector: "header",
    viewport: { width: 1440, height: 900 },
    scan: scan(scanOver),
    ...over,
  });

  it("stamps id and counts nodes recursively", () => {
    const root = n([n([n()]), n()]); // 4 nodes
    const pack = reduceComponent(input({ root, nodeCount: 4 })) as ComponentPack;
    expect(pack.id).toBe("component-pack-v1");
    expect(pack.nodeCount).toBe(countNodes(root));
    expect(pack.url).toBe("https://example.dev");
    expect(pack.capturedAt).toBe(5);
    expect(pack.viewport).toEqual({ width: 1440, height: 900 });
  });

  it("traverses deep child chains", () => {
    const root = deep(19); // 20 nodes, depth 19
    const pack = reduceComponent(input({ root, nodeCount: 20 })) as ComponentPack;
    expect(pack.nodeCount).toBe(countNodes(root));
    expect(pack.nodeCount).toBe(20);
  });

  it("dedupes and sorts fonts and colors from collected values", () => {
    const pack = reduceComponent(input({})) as ComponentPack;
    expect(pack.fonts).toEqual(["Arial", "Zig"]);
    expect(pack.colors).toEqual(["#000000", "#ffffff"]);
  });

  it("truncates trees over the node cap without crashing", () => {
    // Separate fixtures: keep() truncates in place, so calls can't share a tree.
    const capped = reduceComponent(input({ root: deep(59), nodeCount: 60 }), 50) as ComponentPack;
    expect(capped.nodeCount).toBe(50); // cap 50 wins over 60-node fixture
    const uncapped = reduceComponent(input({ root: deep(59), nodeCount: 60 }), 5000) as ComponentPack;
    expect(uncapped.nodeCount).toBe(60); // 5000 clamps to 2000; 60-node fixture untouched
  });

  it("maps a notFound scan to the selector error contract", () => {
    const miss = reduceComponent(input({ notFound: true, root: null, nodeCount: 0 }));
    expect(miss).toEqual({ error: "selector not found: header" });
  });

  it("passes pseudos through untouched and harvests fonts/colors from them", () => {
    const withPseudo = n([], {
      tag: "h1",
      pseudos: [
        {
          kind: "before",
          content: '"★"',
          styles: { fontFamily: "Iconic", color: "#ff0000" },
        },
      ],
    });
    const pack = reduceComponent(input({ root: withPseudo, nodeCount: 1 })) as ComponentPack;
    expect(pack.root.pseudos).toEqual(withPseudo.pseudos); // pass-through, untouched
    expect(pack.fonts).toEqual(["Arial", "Iconic", "Zig"]); // "Iconic" harvested from pseudo styles
    expect(pack.colors).toEqual(["#000000", "#ff0000", "#ffffff"]); // "#ff0000" from pseudo styles
  });
});

// --- MCP handler (DI fake captureComponentFn, mirrors server.test.ts) ------

describe("capture_component handler", () => {
  const dirs: string[] = [];
  const tmpDir = () => {
    const d = mkdtempSync(join(tmpdir(), "awwwards-comp-"));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  const pack: ComponentPack = {
    id: "component-pack-v1",
    url: "https://example.com",
    selector: "header",
    capturedAt: 1700000000000,
    viewport: { width: 1440, height: 900 },
    nodeCount: 3,
    root: { tag: "header", classes: [], rect: { x: 0, y: 0, w: 10, h: 10 }, styles: {}, children: [] },
    fonts: ["Arial"],
    colors: ["#ffffff"],
  };

  it("returns the pack as a JSON text block (pass-through of pack fields)", async () => {
    const seen: Array<{ url: string; opts?: { selector?: string; viewport?: string } }> = [];
    const h = createHandlers({
      client: new AwwwardsClient(),
      cache: new Cache(tmpDir()),
      captureComponentFn: async (url, opts) => {
        seen.push({ url, opts });
        return pack;
      },
    });
    const res = await h.capture_component({ url: pack.url, selector: ".hero", viewport: "mobile" });
    expect(res.isError).toBeUndefined();
    const parsed = JSON.parse((res.content[0] as any).text);
    expect(parsed.id).toBe("component-pack-v1");
    expect(parsed.selector).toBe("header");
    expect(parsed.nodeCount).toBe(3);
    expect(parsed.fonts).toEqual(["Arial"]);
    expect(parsed.colors).toEqual(["#ffffff"]);
    // args map onto the capture fn's opts
    expect(seen[0]).toEqual({ url: pack.url, opts: { selector: ".hero", viewport: "mobile" } });
  });

  it("maps { error } results to error responses", async () => {
    const h = createHandlers({
      client: new AwwwardsClient(),
      cache: new Cache(tmpDir()),
      captureComponentFn: async () => ({ error: "selector not found: header" }),
    });
    const res = await h.capture_component({ url: "https://example.com" });
    expect(res.isError).toBe(true);
    expect((res.content[0] as any).text).toContain("selector not found: header");
  });
});

// --- orchestrator (fake-page DI harness, mirrors test/pose3d.test.ts) -------

function harness(result: unknown) {
  const evaluateCalls: unknown[][] = [];
  const fakePage = {
    addInitScript: async () => {},
    goto: async () => {},
    waitForTimeout: async () => {},
    evaluate: async (...args: unknown[]) => {
      evaluateCalls.push(args);
      return result;
    },
  };
  const fakeBrowser = {
    newPage: async () => fakePage,
    close: async () => {},
  };
  const loader = async () => ({
    chromium: { launch: async () => fakeBrowser },
  });
  return { loader, evaluateCalls };
}

describe("captureComponent", () => {
  it("captures through a fake browser and reduces a pack", async () => {
    const { loader, evaluateCalls } = harness(scan({}));
    const result = await captureComponent("https://example.com", { loader });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.id).toBe("component-pack-v1");
    expect(result.selector).toBe("header"); // default selector
    expect(result.viewport).toEqual({ width: 1440, height: 900 });
    expect(result.nodeCount).toBe(3);
    expect(result.capturedAt).toBeGreaterThan(0);
    // Snippet call is the last evaluate; arg pins the bounded-walk contract.
    const lastCall = evaluateCalls[evaluateCalls.length - 1];
    expect(lastCall[1]).toEqual({ selector: "header", maxNodes: 400 });
  });

  it("passes a custom selector through", async () => {
    const { loader } = harness(scan({ selector: ".hero" }));
    const result = await captureComponent("u", { loader, selector: ".hero" });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.selector).toBe(".hero");
  });

  it("honors the maxNodes opt end-to-end", async () => {
    const { loader, evaluateCalls } = harness(scan({}));
    const result = await captureComponent("u", { loader, maxNodes: 50 });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    // Orchestrator forwards the raw opt to the snippet arg...
    expect(evaluateCalls[evaluateCalls.length - 1][1]).toEqual({ selector: "header", maxNodes: 50 });
    // ...and to the reducer, whose 50..2000 clamp keeps it (fixture is 3 nodes).
    expect(result.nodeCount).toBe(3);
  });

  it("returns the selector error contract when the scan misses", async () => {
    const { loader } = harness(scan({ notFound: true, root: null, nodeCount: 0 }));
    const result = await captureComponent("u", { loader });
    expect(result).toEqual({ error: "selector not found: header" });
  });

  it("resolves the mobile viewport profile", async () => {
    const { loader } = harness(scan({}));
    const result = await captureComponent("u", { loader, viewport: "mobile" });
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.viewport).toEqual({ width: 390, height: 844 });
  });

  it("returns { error } when navigation fails", async () => {
    const evaluateCalls: unknown[][] = [];
    const fakePage = {
      addInitScript: async () => {},
      goto: async () => {
        throw new Error("nav boom");
      },
      waitForTimeout: async () => {},
      evaluate: async (...args: unknown[]) => {
        evaluateCalls.push(args);
        return scan({});
      },
    };
    const loader = async () => ({
      chromium: { launch: async () => ({ newPage: async () => fakePage, close: async () => {} }) },
    });
    const result = await captureComponent("u", { loader });
    expect("error" in result).toBe(true);
    expect(JSON.stringify(result)).toContain("nav boom");
  });

  it("returns { error } when the browser fails to launch", async () => {
    const loader = async () => ({
      chromium: {
        launch: async () => {
          throw new Error("boom");
        },
      },
    });
    const result = await captureComponent("u", { loader });
    expect("error" in result).toBe(true);
    expect(JSON.stringify(result)).toContain("boom");
  });
});
