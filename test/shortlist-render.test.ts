import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { ShortlistResult } from "../src/shortlist/contracts.js";
import {
  renderDecisionTemplate,
  renderShortlistHtml,
  renderShortlistMarkdown,
  writeShortlistArtifacts,
} from "../src/shortlist/render.js";

const linkFailure = vi.hoisted(() => ({ code: null as string | null }));
const writeFailure = vi.hoisted(() => ({
  code: null as string | null,
  only: null as string | null,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      if (
        writeFailure.code &&
        (!writeFailure.only || String(args[0]).endsWith(writeFailure.only))
      ) {
        await actual.writeFile(args[0], "partial");
        throw Object.assign(new Error(`write failed: ${writeFailure.code}`), {
          code: writeFailure.code,
        });
      }
      return actual.writeFile(...args);
    },
    link: async (existingPath: string, newPath: string) => {
      if (linkFailure.code) {
        throw Object.assign(new Error(`link failed: ${linkFailure.code}`), {
          code: linkFailure.code,
        });
      }
      return actual.link(existingPath, newPath);
    },
  };
});

const dirs: string[] = [];

const tempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "awwwards-shortlist-render-"));
  dirs.push(dir);
  return dir;
};

afterEach(async () => {
  linkFailure.code = null;
  writeFailure.code = null;
  for (const dir of dirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

const injected = `<img src=x onerror=alert(1)>`;

const result = (): ShortlistResult => ({
  status: "partial",
  brief: "Portfolio rebuild with fast project discovery.",
  viewport: "desktop",
  criteria: [
    { id: "portfolio", label: "Portfolio discovery", kind: "must", covered: true },
    { id: "motion", label: "Scroll-driven motion", kind: "nice", covered: false },
  ],
  candidates: [
    {
      siteSlug: "studio-alpha",
      title: injected,
      liveUrl: "https://studio.example/",
      decision: "recommend",
      reason: `Hard constraints clear; <script>alert("x")</script>`,
      surfacedBy: ["portfolio", "seed"],
      threeD: { detected: true, libraries: ["three"], canvas: false },
      motionLevel: "scroll",
      stackFit: "same",
      evidence: {
        stack: {
          id: "stack-fingerprint-v1",
          framework: "next",
          frameworkMarkers: [],
          frameworkConfidence: "high",
          css: "custom",
          cssMarkers: [],
          cssConfidence: "low",
          libs: ["gsap", "three"],
        },
        structure: {
          url: "https://studio.example/",
          title: "Studio Alpha",
          totalHeight: 5400,
          bands: [],
          scrollMode: "document",
        },
        motion: {
          url: "https://studio.example/",
          stack: { libs: ["gsap"], render: ["three"], scrollModel: "native" },
          scroll: { triggerCount: 8, scrubCount: 3, pinCount: 0, scrubRatio: 0.375, sample: [] },
          easingVocab: [],
          durationVocab: null,
          capturedAt: 1,
        },
        a11y: { status: "available", contrastWorstPairs: 2 },
        unknowns: ["motion budget unmeasured below the fold"],
      },
      artifacts: { thumbnail: "assets/studio-alpha.jpg" },
    },
    {
      siteSlug: "studio-beta",
      title: "Studio Beta",
      liveUrl: null,
      decision: "consider",
      reason: "No live URL, so live evidence cannot be measured.",
      surfacedBy: ["seed"],
      threeD: { detected: false, libraries: [], canvas: false },
      motionLevel: "unknown",
      stackFit: "unknown",
      evidence: {
        stack: null,
        structure: null,
        motion: null,
        a11y: { status: "unknown" },
        unknowns: ["liveUrl", "stack fingerprint"],
      },
      artifacts: {},
    },
  ],
  excluded: [{ siteSlug: "studio-gamma", reason: "3D detected; allow3d is none." }],
  artifacts: {
    markdown: "",
    html: "",
    json: "",
    decision: "",
  },
  limitations: ["Only the first 12 gallery pages were searched."],
});

const png = (text: string): string => Buffer.from(text).toString("base64");

describe("renderShortlistMarkdown", () => {
  it("includes the brief, criteria, decisions, unknowns, exclusions and limitations", () => {
    const md = renderShortlistMarkdown(result());
    expect(md).toContain("Portfolio rebuild with fast project discovery.");
    expect(md).toContain("**Viewport:** desktop");
    expect(md).toContain("Portfolio discovery");
    expect(md).toContain("studio-alpha");
    expect(md).toContain("recommend");
    expect(md).toContain("motion budget unmeasured below the fold");
    expect(md).toContain("liveUrl");
    expect(md).toContain("studio-gamma");
    expect(md).toContain("Only the first 12 gallery pages were searched.");
    expect(md).toContain("worst sampled contrast pairs below 4.5:1: 2");
    expect(md).toContain("Thumbnail `assets/studio-alpha.jpg`");
    expect(md).toContain("No artifact paths recorded.");
  });

  it("escapes markdown metacharacters and lists artifact basenames", () => {
    const hostile = result();
    hostile.brief = "Brief <b> `tick` \u0007 end\nSecond \u001b[2m line";
    hostile.candidates[0].title = "Title <i> `x`";
    hostile.artifacts = {
      markdown: "/abs/out/shortlist.md",
      html: "/abs/out/shortlist.html",
      json: "/abs/out/shortlist.json",
      decision: "/abs/out/reference-decision.json",
      decisionNew: "/abs/out/bad`name.json",
    };
    const md = renderShortlistMarkdown(hostile);

    expect(md).toContain("Brief \\<b\\> \\`tick\\` \\u0007 end");
    expect(md).toContain("Second \\u001b\\[2m line");
    expect(md).not.toContain("\\u000a");
    expect(md).toContain("### Title \\<i\\> \\`x\\`");
    expect(md).not.toContain("/abs/out");
    expect(md).toContain("- Markdown: `shortlist.md`");
    expect(md).toContain("- HTML: `shortlist.html`");
    expect(md).toContain("- JSON: `shortlist.json`");
    expect(md).toContain("- Reference decision (kept): `reference-decision.json`");
    expect(md).toContain(
      "- Reference decision proposal (new): bad\\`name.json",
    );
    expect(md).not.toContain("`bad");
  });

  it("escapes backslashes and markdown link and image syntax", () => {
    const hostile = result();
    hostile.brief =
      "\\<img src=x onerror=alert(1)\\> [x](https://phishing.example/) ![x](https://tracker.example/p.gif)";
    const md = renderShortlistMarkdown(hostile);

    expect(md).not.toMatch(/(?<!\\)<img/);
    expect(md).not.toContain("[x](https://phishing.example/)");
    expect(md).not.toContain("![x](https://tracker.example/p.gif)");
    expect(md).toContain("\\\\\\<img src=x onerror=alert\\(1\\)");
    expect(md).toContain("\\[x\\]\\(https://phishing.example/\\)");
    expect(md).toContain("!\\[x\\]\\(https://tracker.example/p.gif\\)");
  });
});

describe("renderShortlistHtml", () => {
  it("escapes untrusted text and references only local assets", () => {
    const base = result();
    base.brief = "Line one\nLine two \u001b[2m \u202eRTL";
    const html = renderShortlistHtml(base);
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img src=x onerror");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("https://fonts.");
    expect(html).not.toContain("@import");
    expect(html).toContain('src="assets/studio-alpha.jpg"');
    expect(html).toContain("Viewport: desktop");
    expect(html).toContain('alt="&lt;img src=x onerror=alert(1)&gt; thumbnail"');
    expect(html).not.toContain("\u001b");
    expect(html).not.toContain("\u202e");
    expect(html).toMatch(/Line one<br>Line two +\[2m/);
    expect(html).toContain("worst sampled contrast pairs below 4.5:1: 2");
  });

  it("labels canvas-only evidence as unverified, not 3D detected", () => {
    const base = result();
    base.candidates[0]!.threeD = { detected: false, libraries: [], canvas: true };
    const card = renderShortlistHtml(base).split('<article class="card').slice(1)[0]!;

    expect(card).toContain("canvas scroll");
    expect(card).toContain("unverified");
    expect(card).not.toContain("3D detected");
    expect(card).not.toContain("not detected");
  });

  it("uses the same 3D labels in Markdown and HTML for canvas and raw WebGL", () => {
    const base = result();
    const template = base.candidates[0]!;
    const canvas = {
      ...template,
      siteSlug: "canvas-only",
      title: "Canvas only",
      threeD: { detected: false, libraries: [], canvas: true },
      evidence: { ...template.evidence, unknowns: [] },
    };
    const raw = {
      ...template,
      siteSlug: "raw-webgl",
      title: "Raw WebGL",
      threeD: { detected: false, libraries: [], canvas: false },
      evidence: { ...template.evidence, unknowns: ["3d-unverified"] },
    };
    const detected = {
      ...template,
      siteSlug: "three-site",
      title: "Three site",
      threeD: { detected: true, libraries: ["three"], canvas: false },
      evidence: { ...template.evidence, unknowns: [] },
    };
    base.candidates = [detected, canvas, raw];

    const md = renderShortlistMarkdown(base);
    const html = renderShortlistHtml(base);
    expect(md).toContain("3D: detected (three)");
    expect(md).toContain("3D: unverified (canvas scroll mode)");
    expect(md).toContain("3D: unverified (raw WebGL)");
    expect(html).toContain("detected (three)");
    expect(html).toContain("unverified (canvas scroll mode)");
    expect(html).toContain("unverified (raw WebGL)");
  });

  it("escapes line-leading Markdown markers, code-span backticks and bidi overrides", () => {
    const hostile = result();
    hostile.brief = "# heading\n- item\n> quote\n| table\nbidi \u202eRTL";
    hostile.criteria[0]!.id = "bad`id";
    hostile.candidates[0]!.siteSlug = "bad`slug";
    const md = renderShortlistMarkdown(hostile);

    expect(md).toContain("\\# heading");
    expect(md).toContain("\\- item");
    expect(md).toContain("\\> quote");
    expect(md).toContain("\\| table");
    expect(md).toContain("`bad'id`");
    expect(md).toContain("`bad'slug`");
    expect(md).not.toContain("\u202e");
  });

  it("normalizes a CRLF brief without rendering a carriage-return escape", () => {
    const base = result();
    base.brief = "Line one\r\nLine two";
    const md = renderShortlistMarkdown(base);

    expect(md).toContain("Line one\nLine two");
    expect(md).not.toContain("\\u000d");
  });

  it("renders minimal as none measured, never as a motion claim", () => {
    const base = result();
    const candidate = base.candidates[0]!;
    candidate.motionLevel = "minimal";
    candidate.evidence.motion = {
      ...candidate.evidence.motion!,
      scroll: { triggerCount: 0, scrubCount: 0, pinCount: 0, scrubRatio: 0, sample: [] },
    };
    const md = renderShortlistMarkdown(base);
    const html = renderShortlistHtml(base);

    expect(md).toContain(
      "Motion: none measured (0 triggers, 0 scrubs, 0 pins; globals only)",
    );
    expect(md).not.toContain("Motion: minimal");
    expect(html).toContain(
      "none measured (0 triggers, 0 scrubs, 0 pins; globals only)",
    );
    expect(html).not.toContain("Motion: minimal");
  });

  it("uses only each candidate's explicit artifact fields", () => {
    const base = result();
    const [alpha, beta] = base.candidates;
    base.candidates = [
      {
        ...alpha,
        siteSlug: "studio-alpha",
        title: "Alpha",
        artifacts: { thumbnail: "alpha.jpg" },
      },
      {
        ...beta,
        siteSlug: "studio-beta",
        title: "Beta",
        artifacts: { thumbnail: "assets/beta.jpg", fullPage: "assets/beta-full.jpg" },
      },
      { ...beta, siteSlug: "studio-gamma", title: "Gamma", artifacts: {} },
      {
        ...beta,
        siteSlug: "studio-delta",
        title: "Delta",
        artifacts: { thumbnail: "submissions/delta.jpg" },
      },
      { ...beta, siteSlug: "studio-epsilon", title: "Epsilon", artifacts: { fullPage: "assets/epsilon.jpg" } },
      {
        ...beta,
        siteSlug: "studio-zeta",
        title: "Zeta",
        artifacts: { screenshot: "assets/zeta-viewport.png" },
      },
      {
        ...beta,
        siteSlug: "studio-eta",
        title: "Eta",
        artifacts: {
          fullPage: "assets/eta-full.jpg",
          screenshot: "assets/eta-viewport.png",
        },
      },
    ];
    // No filename or slug lookup exists; only the explicit fields above count.
    const html = renderShortlistHtml(base);
    const cards = html.split('<article class="card').slice(1);
    const cardFor = (slug: string): string => {
      const card = cards.find((entry) => entry.includes(`class="slug">${slug} `));
      expect(card, `card for ${slug}`).toBeDefined();
      return card as string;
    };

    expect(cardFor("studio-alpha")).not.toContain("<img");
    expect(cardFor("studio-beta")).toContain('src="assets/beta.jpg"');
    expect(cardFor("studio-beta")).toContain('alt="Beta thumbnail"');
    expect(cardFor("studio-beta")).not.toContain('src="assets/beta-full.jpg"');
    expect(cardFor("studio-gamma")).not.toContain("<img");
    expect(cardFor("studio-delta")).not.toContain("<img");
    expect(cardFor("studio-epsilon")).toContain('src="assets/epsilon.jpg"');
    expect(cardFor("studio-epsilon")).toContain('alt="Epsilon full page"');
    expect(cardFor("studio-zeta")).toContain('src="assets/zeta-viewport.png"');
    expect(cardFor("studio-zeta")).toContain("Viewport screenshot");
    expect(cardFor("studio-zeta")).toContain('alt="Zeta viewport screenshot"');
    expect(cardFor("studio-eta")).toContain('src="assets/eta-full.jpg"');
    expect(cardFor("studio-eta")).not.toContain('src="assets/eta-viewport.png"');
    expect(cardFor("studio-eta")).toContain("Viewport screenshot");
  });

  it("never emits an unsafe href for a hostile decision proposal name", () => {
    const hostile = result();
    hostile.artifacts.decisionNew = `"><img src=x onerror=alert(1)>.json`;
    const html = renderShortlistHtml(hostile);
    expect(html).not.toContain("<img src=x onerror");
    expect(html).toContain("&quot;&gt;&lt;img src=x onerror=alert(1)&gt;.json");

    hostile.artifacts.decisionNew = "javascript:alert(1)";
    const javascriptHtml = renderShortlistHtml(hostile);
    expect(javascriptHtml).not.toContain('href="javascript:');
    expect(javascriptHtml).toContain("javascript:alert(1)");
  });
});

describe("renderDecisionTemplate", () => {
  it("emits the decision schema with a brief hash and empty decisions", () => {
    const template = JSON.parse(renderDecisionTemplate(result(), "Afjal")) as {
      schema: string;
      briefSha256: string;
      viewport: string;
      criteria: unknown[];
      candidates: Array<Record<string, unknown>>;
    };
    expect(template.schema).toBe("awwwards-shortlist-decision-v1");
    expect(template.viewport).toBe("desktop");
    expect(template.briefSha256).toBe(
      createHash("sha256")
        .update("Portfolio rebuild with fast project discovery.", "utf8")
        .digest("hex"),
    );
    expect(template.criteria).toHaveLength(2);
    expect(template.candidates[0]).toEqual({
      siteSlug: "studio-alpha",
      title: injected,
      decision: null,
      borrow: "",
      avoid: "",
      reviewer: "Afjal",
      reviewedAt: null,
    });
  });
});

describe("writeShortlistArtifacts", () => {
  it("leaves the final artifact state in absolute paths", async () => {
    const outDir = await tempDir();
    const written = await writeShortlistArtifacts(outDir, result(), [
      { name: "studio-alpha.jpg", base64: png("jpeg-bytes"), mimeType: "image/jpeg" },
    ]);

    for (const file of [written.markdown, written.html, written.json, written.decision]) {
      expect(isAbsolute(file)).toBe(true);
      expect((await stat(file)).isFile()).toBe(true);
    }
    expect(written.markdown).toBe(join(outDir, "shortlist.md"));
    expect(written.html).toBe(join(outDir, "shortlist.html"));
    expect(written.json).toBe(join(outDir, "shortlist.json"));
    expect(written.decision).toBe(join(outDir, "reference-decision.json"));
    expect(written.decisionNew).toBeUndefined();

    expect((await readFile(join(outDir, "assets", "studio-alpha.jpg"), "utf8"))).toBe(
      "jpeg-bytes",
    );

    const parsed = JSON.parse(await readFile(written.json, "utf8")) as ShortlistResult;
    expect(parsed).toEqual({
      ...result(),
      artifacts: {
        markdown: written.markdown,
        html: written.html,
        json: written.json,
        decision: written.decision,
      },
    });

    const md = await readFile(written.markdown, "utf8");
    expect(md).toContain("Portfolio rebuild with fast project discovery.");

    const html = await readFile(written.html, "utf8");
    expect(html).toContain('src="assets/studio-alpha.jpg"');
    expect(html).toContain('href="shortlist.html"');

    const leftovers = (await readdir(outDir)).filter((name) =>
      name.includes(".tmp-"),
    );
    expect(leftovers).toEqual([]);
  });

  it("leaves a pre-existing temp-shaped file untouched", async () => {
    const outDir = await tempDir();
    const planted = join(outDir, "shortlist.md.tmp-planted");
    await writeFile(planted, "do not delete");

    const written = await writeShortlistArtifacts(outDir, result(), []);

    expect(await readFile(planted, "utf8")).toBe("do not delete");
    expect(await readFile(written.markdown, "utf8")).toContain("Reference shortlist");
  });

  it("removes a partial temp when a non-EEXIST write fails", async () => {
    const outDir = await tempDir();
    writeFailure.code = "EIO";
    await expect(writeShortlistArtifacts(outDir, result(), [])).rejects.toThrow(
      /write failed/i,
    );
    writeFailure.code = null;

    expect((await readdir(outDir)).filter((name) => name.includes(".tmp-"))).toEqual([]);
    expect(existsSync(join(outDir, "reference-decision.json"))).toBe(false);
  });

  it("removes a partial decision target when the fallback write fails", async () => {
    const outDir = await tempDir();
    const canonical = join(outDir, "reference-decision.json");
    linkFailure.code = "EPERM";
    writeFailure.code = "ENOSPC";
    writeFailure.only = "reference-decision.json";

    await expect(writeShortlistArtifacts(outDir, result(), [])).rejects.toThrow(
      /write failed/i,
    );
    linkFailure.code = null;
    writeFailure.code = null;
    writeFailure.only = null;

    expect(existsSync(canonical)).toBe(false);
    await expect(writeShortlistArtifacts(outDir, result(), [])).resolves.toBeDefined();
    expect((await stat(canonical)).isFile()).toBe(true);
  });

  it("refuses unrelated files in outDir without writing anything", async () => {
    const outDir = await tempDir();
    const notes = join(outDir, "notes.txt");
    await writeFile(notes, "keep me");

    await expect(writeShortlistArtifacts(outDir, result(), [])).rejects.toThrow(
      /unrelated files/i,
    );
    expect(await readFile(notes, "utf8")).toBe("keep me");
    expect(existsSync(join(outDir, "shortlist.md"))).toBe(false);
  });

  it("allows common OS metadata files without touching them", async () => {
    const outDir = await tempDir();
    const metadata = [".DS_Store", "Thumbs.db", "desktop.ini"];
    for (const name of metadata) await writeFile(join(outDir, name), "os metadata");

    const written = await writeShortlistArtifacts(outDir, result(), []);

    for (const name of metadata) {
      expect(await readFile(join(outDir, name), "utf8")).toBe("os metadata");
    }
    expect((await stat(written.markdown)).isFile()).toBe(true);
  });

  it("allows a rerun over its own four files", async () => {
    const outDir = await tempDir();
    const first = await writeShortlistArtifacts(outDir, result(), []);
    const second = await writeShortlistArtifacts(outDir, result(), []);

    expect(second.markdown).toBe(first.markdown);
    expect((await stat(second.decision)).isFile()).toBe(true);
    expect(second.decisionNew).toBe(join(outDir, "reference-decision.new.json"));
  });

  it("refuses to write assets through a symbolic link", async () => {
    const outDir = await tempDir();
    const target = await tempDir();
    try {
      await symlink(target, join(outDir, "assets"), "junction");
    } catch {
      return; // The platform does not allow this link; nothing to prove here.
    }

    await expect(
      writeShortlistArtifacts(outDir, result(), [
        { name: "blocked.jpg", base64: png("blocked"), mimeType: "image/jpeg" },
      ]),
    ).rejects.toThrow(/symbolic link/i);
    expect(existsSync(join(target, "blocked.jpg"))).toBe(false);
  });

  it("never replaces a decision file and preserves earlier .new files", async () => {
    const outDir = await tempDir();
    const canonical = join(outDir, "reference-decision.json");
    const approved = '{"approved":true,"note":"keep me"}';
    await writeFile(canonical, approved);

    const first = await writeShortlistArtifacts(outDir, result(), []);
    const firstNewPath = join(outDir, "reference-decision.new.json");
    expect(first.decision).toBe(canonical);
    expect(first.decisionNew).toBe(firstNewPath);
    expect(await readFile(canonical, "utf8")).toBe(approved);
    const firstNew = await readFile(firstNewPath, "utf8");

    const second = await writeShortlistArtifacts(outDir, result(), []);
    const secondNewPath = join(outDir, "reference-decision.new-2.json");
    expect(second.decision).toBe(canonical);
    expect(second.decisionNew).toBe(secondNewPath);
    expect(await readFile(canonical, "utf8")).toBe(approved);
    expect(await readFile(firstNewPath, "utf8")).toBe(firstNew);

    const fresh = JSON.parse(await readFile(secondNewPath, "utf8")) as {
      schema: string;
      candidates: Array<{ decision: null }>;
    };
    expect(fresh.schema).toBe("awwwards-shortlist-decision-v1");
    expect(fresh.candidates[0]?.decision).toBeNull();

    const machine = JSON.parse(await readFile(second.json, "utf8")) as ShortlistResult;
    expect(machine.artifacts).toEqual({
      markdown: second.markdown,
      html: second.html,
      json: second.json,
      decision: canonical,
      decisionNew: secondNewPath,
    });

    const html = await readFile(second.html, "utf8");
    expect(html).toContain("Reference decision (kept)");
    expect(html).toContain("Reference decision proposal (new)");
    expect(html).toContain('href="reference-decision.new-2.json"');
    expect(html).toContain('href="shortlist.html"');
    expect((await readdir(outDir)).filter((name) => name.includes(".tmp-"))).toEqual([]);
  });

  it("falls back to exclusive create when hard links are unsupported", async () => {
    const outDir = await tempDir();
    const canonical = join(outDir, "reference-decision.json");
    linkFailure.code = "EOPNOTSUPP";

    const first = await writeShortlistArtifacts(outDir, result(), []);
    const original = await readFile(canonical, "utf8");
    expect(first.decision).toBe(canonical);
    expect(first.decisionNew).toBeUndefined();
    expect(JSON.parse(original).schema).toBe("awwwards-shortlist-decision-v1");

    const second = await writeShortlistArtifacts(outDir, result(), []);
    expect(second.decision).toBe(canonical);
    expect(second.decisionNew).toBe(join(outDir, "reference-decision.new.json"));
    expect(await readFile(canonical, "utf8")).toBe(original);
  });

  it("rejects an asset that decodes to zero bytes", async () => {
    const outDir = await tempDir();
    await expect(
      writeShortlistArtifacts(outDir, result(), [
        { name: "empty.png", base64: "!!!!", mimeType: "image/png" },
      ]),
    ).rejects.toThrow(/zero bytes/i);
    expect(existsSync(join(outDir, "assets", "empty.png"))).toBe(false);
  });

  it("rejects relative outDir and unsafe asset names", async () => {
    await expect(writeShortlistArtifacts("relative/out", result(), [])).rejects.toThrow(
      /absolute/i,
    );

    for (const name of ["../evil.png", "a/b.png", "a\\b.png", "C:\\evil.png", "..", "."]) {
      const outDir = await tempDir();
      await expect(
        writeShortlistArtifacts(outDir, result(), [
          { name, base64: png("x"), mimeType: "image/png" },
        ]),
      ).rejects.toThrow(/asset name/i);
      expect(existsSync(join(outDir, "assets", "evil.png"))).toBe(false);
    }
  });
});
