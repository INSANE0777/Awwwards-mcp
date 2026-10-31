import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Documentation guard: browser tools import playwright/ffmpeg-static from the
// package's install location, so `npx` alone cannot support them. The README
// must keep saying so, or users will file "playwright missing" bugs forever.
const README = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const DEV = readFileSync(new URL("../README.dev.md", import.meta.url), "utf8");
const flatten = (text: string) => text.replace(/\s+/g, " ");

describe("install documentation", () => {
  it("README warns that npx is the core no-browser path", () => {
    expect(flatten(README)).toContain("is the core, no-browser path");
    expect(flatten(README)).toContain("isolated cache that does not contain Playwright");
  });

  it("README documents the global side-by-side browser install", () => {
    expect(README).toContain("npm install -g awwwards-mcp playwright ffmpeg-static");
    expect(README).toContain("playwright install chromium");
    expect(flatten(README)).toContain('"command": "awwwards-mcp"');
    expect(flatten(README)).not.toContain("npm install -g playwright && npx playwright install chromium");
  });

  it("README.dev documents the supported layout and the entry guard", () => {
    expect(flatten(DEV)).toContain("global side-by-side install");
    expect(flatten(DEV)).toContain("isCliEntry");
    expect(flatten(DEV)).toContain("exits 0 silently");
  });
});
