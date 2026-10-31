import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProject, copyAssets } from "../src/build-project.js";

// Junctions cover directory escapes on every Windows account (no Developer
// Mode needed); platforms that deny link creation skip the case explicitly.
const linkDir = (target: string, at: string): boolean => {
  try {
    symlinkSync(target, at, "junction");
    return true;
  } catch {
    return false;
  }
};

const linkFile = (target: string, at: string): boolean => {
  try {
    symlinkSync(target, at, "file");
    return true;
  } catch {
    return false;
  }
};

const SENTINEL = "TOP-SECRET-SENTINEL";

describe("build_project canonical containment", () => {
  it("never reads a source asset through a symlinked directory", async (ctx) => {
    const dir = mkdtempSync(join(tmpdir(), "awwwards-bp-link-src-"));
    try {
      const site = join(dir, "site");
      const outside = join(dir, "outside");
      mkdirSync(site);
      mkdirSync(outside);
      writeFileSync(join(outside, "secret.png"), SENTINEL);
      if (!linkDir(outside, join(site, "assets"))) ctx.skip();

      const out = join(dir, "out");
      const res = await copyAssets('<img src="assets/secret.png">', site, out);
      expect(res.copied).toEqual([]);
      expect(res.missing).toContain("assets/secret.png");
      expect(existsSync(join(out, "assets", "secret.png"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never overwrites a destination through a symlinked output directory", async (ctx) => {
    const dir = mkdtempSync(join(tmpdir(), "awwwards-bp-link-out-"));
    try {
      const site = join(dir, "site");
      const outside = join(dir, "outside");
      mkdirSync(join(site, "assets"), { recursive: true });
      mkdirSync(outside);
      writeFileSync(join(site, "assets", "hero.png"), "SAFE");
      writeFileSync(join(outside, "hero.png"), SENTINEL);
      const out = join(dir, "out");
      mkdirSync(out);
      // `into` is a subdirectory of the output root: a link there must not
      // become the root itself.
      if (!linkDir(outside, join(out, "public"))) ctx.skip();

      const res = await copyAssets('<img src="assets/hero.png">', site, out, { into: "public" });
      expect(res.copied).toEqual([]);
      expect(res.missing).toContain("assets/hero.png");
      expect(readFileSync(join(outside, "hero.png"), "utf8")).toBe(SENTINEL);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses generated files through a junction in the output tree", async (ctx) => {
    const dir = mkdtempSync(join(tmpdir(), "awwwards-bp-link-gen-"));
    try {
      const site = join(dir, "site");
      const outside = join(dir, "outside");
      mkdirSync(site);
      mkdirSync(outside);
      writeFileSync(
        join(site, "index.html"),
        '<!doctype html><html><body><section class="c-1"><p>x</p></section></body></html>',
      );
      const out = join(dir, "out");
      mkdirSync(out);
      if (!linkDir(outside, join(out, "src"))) ctx.skip();

      const res = await buildProject({ html: join(site, "index.html"), target: "vite", out });
      expect("error" in res).toBe(true);
      expect(existsSync(join(outside, "main.js"))).toBe(false);
      expect(existsSync(join(outside, "styles", "tokens.css"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not copy a rehosted script through a symlinked directory", async (ctx) => {
    const dir = mkdtempSync(join(tmpdir(), "awwwards-bp-link-script-"));
    try {
      const site = join(dir, "site");
      const outside = join(dir, "outside");
      mkdirSync(site);
      mkdirSync(outside);
      writeFileSync(join(outside, "app.js"), `window.order = "${SENTINEL}";`);
      if (!linkDir(outside, join(site, "assets"))) ctx.skip();
      writeFileSync(
        join(site, "index.html"),
        `<!doctype html><html><body>
<main id="main"><section id="a">A</section><section id="b">B</section></main>
<script src="assets/app.js"></script>
</body></html>`,
      );

      const out = join(dir, "out");
      const res = await buildProject({ html: join(site, "index.html"), target: "vite", out });
      if ("error" in res) throw new Error(res.error);
      expect(res.warnings.some((w) => w.includes("asset not found: assets/app.js"))).toBe(true);
      expect(existsSync(join(out, "src", "scripts", "assets", "app.js"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not fold a stylesheet that resolves outside the source root", async (ctx) => {
    const dir = mkdtempSync(join(tmpdir(), "awwwards-bp-link-css-"));
    try {
      const site = join(dir, "site");
      const outside = join(dir, "outside");
      mkdirSync(site);
      mkdirSync(outside);
      writeFileSync(join(outside, "secret.css"), `.leak { content: "${SENTINEL}"; }`);
      if (!linkDir(outside, join(site, "css"))) ctx.skip();
      writeFileSync(
        join(site, "index.html"),
        `<!doctype html><html><head><link rel="stylesheet" href="css/secret.css"></head><body>
<main id="main"><section id="a">A</section><section id="b">B</section></main>
</body></html>`,
      );

      const out = join(dir, "out");
      const res = await buildProject({ html: join(site, "index.html"), target: "next", out });
      if ("error" in res) throw new Error(res.error);
      expect(res.warnings.some((w) => w.includes("asset not found: css/secret.css"))).toBe(true);
      const layout = readFileSync(join(out, "app", "layout.tsx"), "utf8");
      expect(layout).not.toContain(SENTINEL);
      expect(existsSync(join(out, "public", "css", "secret.css"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolves dependencies from the logical path of an allowed contained file symlink", async (ctx) => {
    const dir = mkdtempSync(join(tmpdir(), "awwwards-bp-link-file-"));
    try {
      const site = join(dir, "site");
      mkdirSync(join(site, "shared"), { recursive: true });
      mkdirSync(join(site, "styles"), { recursive: true });
      writeFileSync(
        join(site, "shared", "site.css"),
        '@font-face{font-family:x;src:url("font.woff2")}',
      );
      writeFileSync(join(site, "styles", "font.woff2"), "FONT");
      if (!linkFile(join(site, "shared", "site.css"), join(site, "styles", "site.css"))) ctx.skip();

      const out = join(dir, "out");
      const res = await copyAssets('<link rel="stylesheet" href="styles/site.css">', site, out);
      expect(res.missing).toEqual([]);
      expect(res.copied).toEqual(expect.arrayContaining(["styles/site.css", "font.woff2"]));
      expect(existsSync(join(out, "styles", "font.woff2"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
