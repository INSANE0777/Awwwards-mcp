import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { registerCaptureScene3d } from "../src/tools/scene.js";

// Documentation guard: browser tools import playwright/ffmpeg-static from the
// package's install location, so `npx` alone cannot support them. The README
// must keep saying so, or users will file "playwright missing" bugs forever.
const README = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const CHANGELOG = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
const DEV = readFileSync(new URL("../README.dev.md", import.meta.url), "utf8");
const PKG = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { scripts?: Record<string, string>; files?: string[] };
const flatten = (text: string) => text.replace(/\s+/g, " ");

// Use the registered description, not a copy in this test, so a doc change is
// checked against what the tool actually advertises.
const toolCtx = { tool: vi.fn() } as any;
registerCaptureScene3d(toolCtx);
const TOOL_DESCRIPTION = String(toolCtx.tool.mock.calls[0]?.[1] ?? "");

// Claims are compared after case, dash, quote and Markdown-emphasis folding:
// R1–R4 and R1-R4, or `usually "unknown"` and usually unknown, are the same
// claim. Prohibited phrases are folded the same way.
const normalize = (text: string) =>
  flatten(text)
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/[`*"'“”]/g, "")
    .replace(/\s+/g, " ")
    .trim();

describe("install documentation", () => {
  it("README warns that npx is the core no-browser path", () => {
    expect(flatten(README)).toContain("is the core, no-browser path");
    expect(flatten(README)).toContain("isolated cache that does not contain Playwright");
  });

  it("README documents the global side-by-side browser install", () => {
    expect(README).toContain("npm install -g awwwards-mcp playwright ffmpeg-static");
    expect(README).toContain("npm exec --global -- playwright install chromium");
    expect(flatten(README)).toContain('"command": "awwwards-mcp"');
    expect(flatten(README)).toContain("not `npx`");
    expect(flatten(README)).not.toContain("npm install -g playwright && npx playwright install chromium");
  });

  it("README walkthrough includes restart, a verification call and the built smoke", () => {
    const text = flatten(README);
    expect(text).toContain("Restart the MCP server");
    expect(text).toContain(
      '{ "name": "analyze_page_structure", "arguments": { "url": "https://example.com" } }',
    );
    expect(text).toContain("npm run build && npm run smoke:browser");
    expect(text).toContain("127.0.0.1");
    expect(text).toContain("browser-smoke: pack + global install");
    expect(text).toContain("browser-smoke: connected to awwwards-mcp, 41 tools");
    expect(text).toContain("browser-smoke: analyze_page_structure -> 4 bands");
    expect(text).toContain("browser-smoke: capture_live_site -> image/png");
    expect(text).toContain("browser-smoke: PASS");

    expect(PKG.scripts?.["smoke:browser"]).toBe("node scripts/browser-smoke.mjs");
    expect(existsSync(new URL("../scripts/browser-smoke.mjs", import.meta.url))).toBe(true);
  });

  it("README documents the element, verify_build, v2 and directory limits", () => {
    const text = flatten(README);
    expect(text).toContain("element corpus is partial after the gallery-crawl retirement");
    expect(text).toContain('category: "uncategorized"');
    expect(text).toContain("free-text `query`");
    expect(text).toContain("`verify_build` scores structure and motion, not visual fidelity");
    expect(text).toContain("default 40, smallest bands merged");
    expect(text).toContain("landmark splitting can then add sub-bands up to its own limit of 60");
    expect(text).toContain("Capture timing can move the score");
    expect(text).toContain("The `v2` MCP surface is opt-in, not the default and not a 2.0 release");
    expect(text).toContain("manual post-release admin step");
  });

  it("README points qualification at the approved document-flow fixture", () => {
    const text = flatten(README);
    expect(text).toContain(
      "approved fixture is `https://awwwards-mcp.vercel.app/qualification-fixture/`",
    );
    expect(text).toContain("document-flow page with visible sections");
    expect(text).toContain("`browser.atlas_capture` check can publish sections");
    expect(text).toContain("`qualificationScope` becomes `full`");
  });

  it("README qualifies a supplied tarball against the approved fixture", () => {
    const text = flatten(README);
    const section = text.slice(
      text.indexOf("To qualify a tarball that already exists"),
      text.indexOf("### Resource limits and diagnostics"),
    );
    expect(section).toContain("--tarball <packed.tgz>");
    expect(section).toContain(
      "--fixture-url https://awwwards-mcp.vercel.app/qualification-fixture/",
    );
    expect(section).toContain('qualificationScope: "offline-installed"');
    expect(section).toContain("INCOMPLETE (exit 2)");
    expect(section).toContain("node scripts/qualify/gate.mjs");
    expect(section).toContain("--mode pack");
    expect(section).toContain("--integrity <registry-SRI>");
  });

  it("README describes local-first startup instead of promising zero egress", () => {
    const text = flatten(README);
    expect(text).toContain("it is not zero-egress at startup");
    expect(text).toContain("may refresh the index and check npm for updates");
    expect(text).not.toContain("Stable, current, fully offline — no API key, no account.");
  });

  it("does not ship the skills that moved to awwwards-skills", () => {
    expect(PKG.files).not.toContain("skills");
  });

  it("README.dev documents the supported layout and the entry guard", () => {
    expect(flatten(DEV)).toContain("global side-by-side install");
    expect(flatten(DEV)).toContain("isCliEntry");
    expect(flatten(DEV)).toContain("exits 0 silently");
    expect(flatten(DEV)).toContain("awwwards-skills repository");
  });
});

describe("3D dossier documentation claims", () => {
  const docs = {
    README: normalize(README),
    CHANGELOG: normalize(CHANGELOG),
    "capture_scene_3d description": normalize(TOOL_DESCRIPTION),
  };
  // Required claims must survive case, dash, quote and Markdown folding.
  const requiredClaims = [
    "scene-evidence-v2",
    "r1-r4",
    "workers are not inspected",
    "offscreencanvas is not inspected",
    "renderer api is not probed",
    "usually unknown",
  ];
  const prohibitedClaims = [
    "recreate any 3d website",
    "clone any 3d",
    "source-equivalent",
    "any 3d site",
    "detects webgpu",
    "webgpu detection",
  ];

  it("carries the required dossier claims in README, changelog and tool description", () => {
    for (const [source, text] of Object.entries(docs)) {
      for (const claim of requiredClaims) {
        expect(text, `${source} must contain ${claim}`).toContain(claim);
      }
    }
    for (const sceneClass of ["r1", "r2", "r3", "r4"]) {
      expect(docs.README, `README must name ${sceneClass}`).toContain(sceneClass);
    }
  });

  it("keeps every prohibited claim out of all three documented surfaces", () => {
    for (const [source, text] of Object.entries(docs)) {
      for (const claim of prohibitedClaims) {
        expect(text, `${source} must not contain ${claim}`).not.toContain(claim);
      }
    }
  });

  it("README states the dossier scope and its limits", () => {
    const text = docs.README;
    expect(text).toContain("not a general 3d-site rebuilder");
    expect(text).toContain("does not recover application source");
    expect(text).toContain("static replay and a build_project replay are not in 1.22");
    expect(text).toContain("opt-in on capture_scene_3d only");
    expect(text).toContain("emit:dossier");
    expect(text).toContain("dossier.md");
    expect(text).toContain("evidence-v2.json");
    expect(text).toContain("no completion claim");
    expect(text).toContain("build_motion kind:scene_stub");
    expect(text).toContain("capture_page kind:scene");
    expect(text).toContain("precedence: r3 > r1 > r4 (webgpu without hooks) > r2 (canvas) > r4 fallback");
    expect(text).toContain("no r1 or r3 evidence");
    expect(text).toContain("keyframes are parity-checked metadata");
    expect(text).toContain("camera/transforms are not replayed");
    expect(text).not.toContain("keyframes replayed");
    expect(text).not.toMatch(/(?:^|[\s(])v2 dossier/);
    expect(text).not.toMatch(/(?:^|[\s(])v2 inventory/);

    const start = README.indexOf("### 3D rebuild dossier");
    const end = README.indexOf("### Opt-in Three adapter");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const dossier = normalize(README.slice(start, end));
    expect(dossier).toContain("unhookedwebgpu");
    expect(dossier).toContain("stays false in 1.22");
    expect(dossier).toContain("no completion claim");
    expect(dossier).not.toContain("class verdict");
    expect(dossier).not.toContain("f9");
  });
});
