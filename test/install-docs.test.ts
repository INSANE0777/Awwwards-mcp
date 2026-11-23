import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { registerCaptureScene3d } from "../src/tools/scene.js";
import { shortlistInputSchema } from "../src/shortlist/contracts.js";

// Documentation guard: browser tools import playwright/ffmpeg-static from the
// package's install location, so `npx` alone cannot support them. The README
// must keep saying so, or users will file "playwright missing" bugs forever.
const README = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const CHANGELOG = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
const DEV = readFileSync(new URL("../README.dev.md", import.meta.url), "utf8");
const CONTRIBUTING = readFileSync(new URL("../CONTRIBUTING.md", import.meta.url), "utf8");
const PKG = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { scripts?: Record<string, string>; files?: string[]; version: string };
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

// Isolates the current notes (Unreleased during development, the package
// version at release time): pins must not be satisfied by an older section.
const unreleasedSection = (text: string): string => {
  const lines = text.split(/\r?\n/);
  const heading = `## v${PKG.version}`;
  const start = lines.findIndex((line) => {
    const value = line.trim();
    return value === "## Unreleased" || value === heading || value.startsWith(`${heading} `);
  });
  if (start === -1) {
    throw new Error(`CHANGELOG.md has no ## Unreleased or ${heading} section`);
  }
  let end = start + 1;
  while (end < lines.length && !lines[end].startsWith("## ")) end += 1;
  return lines.slice(start + 1, end).join("\n");
};

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
    expect(text).toContain("browser-smoke: connected to awwwards-mcp, 42 tools");
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
    expect(text).toContain("`v2` is opt-in, not the default and not a 2.0 release");
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

  it("README describes the reference shortlist, artifacts and exact status rule", () => {
    const text = flatten(README);
    expect(text).toContain("`shortlist_references`");
    expect(text).toContain("`limit` is 3–5 (default 5)");
    expect(text).toContain("up to 5 Awwwards references labelled `recommend` or `consider`");
    expect(text).toContain(
      "Candidates that fail a hard constraint are listed separately under `excluded` with a reason and do not count toward the limit",
    );
    expect(text).not.toContain("labelled `recommend`, `consider` or `avoid`");
    expect(text).toContain("Each criterion needs `query` or `tags`");
    for (const artifact of [
      "shortlist.md",
      "shortlist.html",
      "shortlist.json",
      "reference-decision.json",
    ]) {
      expect(text).toContain(`\`${artifact}\``);
    }
    expect(text).toContain("an `assets/` directory when thumbnails or screenshots were written");
    expect(text).toContain("it holds thumbnails plus full-page or viewport screenshots");
    expect(text).toContain("`viewport` supports `desktop` and `mobile`");
    expect(text).toContain("`shortlist.json` carries each candidate's artifact paths");
    expect(text).toContain(
      "`reference-decision.json` is a blank review template (`decision: null`) and is never overwritten on rerun",
    );
    expect(text).toContain("`reference-decision.new.json`");
    expect(text).toContain("`screenshot-viewport` limitation");
    expect(text).toContain(
      "Accessibility stays `unknown` unless the host injects an accessibility peer; the shipped CLI does not, so the dossier records that limitation",
    );
    expect(text).toContain(
      "`targetStack` is annotation-only; it never filters",
    );
    expect(text).toContain(
      "Criteria are discovery queries: coverage means a returned candidate was surfaced by that criterion, not that a measured property matches it",
    );
    expect(text).toContain(
      "`motionBudget` is a ceiling only; there is no minimum-motion or semantic-fit filter",
    );
    expect(text).toContain("`status` measures criterion coverage, not creative fitness");
    expect(text).toContain("including `motionLevel`");
    expect(text).toContain("are the fitness signal for the reviewer");
    expect(text).toContain("`allow3d:\"none\"` excludes only a recognized 3D library");
    expect(text).toContain(
      "canvas scroll mode or raw WebGL is returned as `consider` with a 3D-unverified reason (`3d-unverified` in unknowns for raw WebGL), never claimed 3D-free",
    );
    expect(text).toContain(
      "`motionBudget` is a real ceiling: `minimal` excludes any measured ScrollTrigger, scrub or pin; `scroll` allows triggers/scrubs but not pins; `expressive` allows pins",
    );
    expect(text).toContain(
      "An explicit seed that no criterion surfaces has no criterion coverage, so it never covers a `must`; coverage comes from discovery hits on returned candidates, and a seed that is also surfaced by a criterion can cover it",
    );
    expect(text).toContain("`outDir` must be absolute");
    expect(text).toContain("no hosting or telemetry");
    expect(text).toContain("`must` criteria are coverage requirements, not per-candidate passes");
    expect(text).toContain(
      "Status describes the returned list after `limit`: `ok` only when every `must` criterion is covered by a `recommend` in that list; `partial` when a `must` criterion has only `consider`; `inconclusive` when a `must` criterion is uncovered, when no candidates are returned, or when all candidates were excluded",
    );
    expect(text).toContain(
      "Precedence: if any `must` criterion is uncovered the result is `inconclusive`, even when another `must` criterion has only `consider`; `partial` requires every `must` criterion to have at least a `consider` and at least one `must` criterion to have no `recommend`",
    );
    expect(text).toContain(
      "With no `must` criteria, `ok` needs at least one `recommend`, consider-only is `partial`, and an empty or all-excluded list is `inconclusive`",
    );
    expect(text).toContain(
      "A covering `recommend` dropped by `limit` can change the status; the dossier always reflects the returned list",
    );
    expect(text).toContain(
      "Unknown evidence on a non-required candidate does not by itself change the status, and every candidate lists its unknowns",
    );
    expect(text).not.toContain("never `ok`");
    expect(text).toContain("adoption unproven");
    expect(text).toContain("No taste score, no auto-pick");
    expect(text).not.toContain("the suite's one local-write tool");
    expect(text).toContain(
      "One of two local-write tools: `build_project` writes the generated project, and `shortlist_references` writes its dossier",
    );
  });

  it("README shortlist example parses through the tool schema", () => {
    const section = README.slice(README.indexOf("### Reference shortlist"));
    const block = /```json\r?\n([\s\S]*?)```/.exec(section);
    expect(block).not.toBeNull();
    const parsed = shortlistInputSchema.parse(JSON.parse(block?.[1] ?? "{}"));
    expect(parsed.limit).toBe(4);
    expect(parsed.criteria.find((criterion) => criterion.label === "Motion-led product pages")?.query).toBe(
      "product",
    );
    expect(parsed.constraints.allow3d).toBe("any");
  });

  it("README marks shortlist_references as v1-only", () => {
    const text = flatten(README);
    expect(text).toContain("`shortlist_references`, which is v1-only with no v2 branch");
  });

  it("README scopes the skills mirror claim to the shipped pairing", () => {
    const text = flatten(README);
    expect(text).toContain(
      "all nine routing copies were byte-identical to the `test/fixtures/v2-routing.md` shipped in 1.21.0",
    );
    expect(text).toContain("must be mirrored to the skills repository");
    expect(text).not.toContain("all nine routing copies are byte-identical to this package's");
  });

  it("CHANGELOG current section pins the reference-shortlist claims", () => {
    const section = unreleasedSection(CHANGELOG);
    expect(section).toContain("### Reference shortlist");
    expect(section).not.toContain("## v1.21.1");

    const text = flatten(section);
    expect(text).toContain("up to 5");
    expect(text).toContain("`limit` 3-5");
    expect(text).toContain("`recommend` or `consider`");
    expect(text).toContain(
      "Candidates that fail a hard constraint are listed separately under `excluded` with a reason and do not count toward the limit",
    );
    expect(text).toContain(
      "An explicit seed with no criterion surfacers never covers a `must`; coverage comes from discovery hits, and a seed also surfaced by a criterion can cover it",
    );
    expect(text).toContain(
      "Status describes the returned list after `limit`: `ok` only when every `must` criterion is covered by a `recommend` in that list; `partial` when a `must` criterion has only `consider`; `inconclusive` when a `must` criterion is uncovered, when no candidates are returned, or when all candidates were excluded",
    );
    expect(text).toContain(
      "With no `must` criteria, `ok` needs at least one `recommend`, consider-only is `partial`, and an empty or all-excluded list is `inconclusive`",
    );
    expect(text).toContain("the dossier reflects the returned list");
    expect(text).toContain("an `assets/` directory when thumbnails or screenshots were written");
    expect(text).toContain(
      "Precedence: if any `must` criterion is uncovered the result is `inconclusive`, even when another `must` criterion has only `consider`; `partial` requires every `must` criterion to have at least a `consider` and at least one `must` criterion to have no `recommend`",
    );
    expect(text).toContain("blank review template (`decision: null`), never overwritten on rerun");
    expect(text).toContain("`reference-decision.new.json` / `.new-N.json`");
    expect(text).toContain("`screenshot-viewport` limitation");
    expect(text).toContain(
      "accessibility stays `unknown` unless the host injects an accessibility peer",
    );
    expect(text).toContain("adoption unproven");
    expect(text).toContain(
      "Honesty limits: criteria are discovery queries - coverage means a returned candidate was surfaced by that criterion, not that a measured property matches it",
    );
    expect(text).toContain(
      "`motionBudget` is a ceiling only; there is no minimum-motion or semantic-fit filter",
    );
    expect(text).toContain("`targetStack` is annotation-only; it never filters");
    expect(text).toContain("`status` measures criterion coverage, not creative fitness");
    expect(text).toContain("including `motionLevel`");
    expect(text).toContain(
      "`allow3d:\"none\"` excludes only a recognized 3D library; a page whose only 3D signal is a canvas scroll mode or raw WebGL comes back as `consider` with a 3D-unverified reason (`3d-unverified` in unknowns for raw WebGL), never claimed 3D-free",
    );
    expect(text).toContain(
      "`motionBudget` is a real ceiling: `minimal` excludes any measured ScrollTrigger, scrub or pin; `scroll` allows triggers/scrubs but not pins; `expressive` allows pins",
    );
    expect(text).not.toContain("never `ok`");
    expect(text).not.toContain("labelled `recommend`, `consider` or `avoid`");

    expect(text).toContain("**42 full / 14 core / 15 v2**");
    expect(text).toContain("**46 / 14 / 16**");
  });

  it("README.dev and CONTRIBUTING pin the current surface counts", () => {
    const dev = flatten(DEV);
    expect(dev).toContain("`core` registers only the 14 build-loop tools");
    expect(dev).toContain("`full` keeps all 42 (46 with `AWWWARDS_MCP_ATLAS=1`)");
    expect(dev).toContain("the 15-tool consolidated surface (16 with Atlas)");
    expect(dev).toContain(
      "`build` (project/stubs/manifest/stack), `shortlist` (discovery/evidence/dossier), `atlas` (ingest/collector/search/components/states/evidence packs)",
    );
    expect(dev).toContain("47-method `Handlers` object");
    expect(dev).toContain("`shortlist/` | ~1,020");
    expect(dev).toContain(
      "The 41 historical `tool()` / `registerTool()` registrations",
    );
    expect(dev).toContain("`tools/shortlist.ts` is the 42nd registration");

    const contributing = flatten(CONTRIBUTING);
    expect(contributing).toContain(
      "42 base MCP tool registrations (46 with AWWWARDS_MCP_ATLAS=1)",
    );
    expect(contributing).not.toContain("AWWARDS_MCP_ATLAS");
    expect(contributing).toContain("**46 full / 14 core / 16 v2**");
    expect(contributing).toContain("**42 full / 14 core / 15 v2**");
    expect(contributing).toContain("shortlist, atlas");
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
