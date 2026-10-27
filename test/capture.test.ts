import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { captureLiveSite, DEFAULT_MAX_INLINE_BYTES, isBlockingOverlay, waitForOverlays } from "../src/capture.js";

const dirs: string[] = [];
const tmpDir = () => {
  const d = mkdtempSync(join(tmpdir(), "awwwards-cap-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("isBlockingOverlay", () => {
  const viewport = { width: 1000, height: 800 };
  const style = (over: Partial<Record<string, string>> = {}) => ({
    position: "fixed",
    zIndex: "100",
    opacity: "1",
    visibility: "visible",
    display: "block",
    ...over,
  });
  const rect = { width: 900, height: 720 };

  it("blocks only fixed elements covering ≥90% in both axes", () => {
    expect(isBlockingOverlay(rect, style(), viewport)).toBe(true);
    expect(isBlockingOverlay(rect, style({ position: "absolute" }), viewport)).toBe(false);
    expect(isBlockingOverlay({ width: 899, height: 720 }, style(), viewport)).toBe(false);
    expect(isBlockingOverlay({ width: 900, height: 719 }, style(), viewport)).toBe(false);
  });

  it("requires z-index ≥100 and opacity >0.05", () => {
    expect(isBlockingOverlay(rect, style({ zIndex: "99" }), viewport)).toBe(false);
    expect(isBlockingOverlay(rect, style({ zIndex: "auto" }), viewport)).toBe(false);
    expect(isBlockingOverlay(rect, style({ zIndex: "101" }), viewport)).toBe(true);
    expect(isBlockingOverlay(rect, style({ opacity: "0.05" }), viewport)).toBe(false);
    expect(isBlockingOverlay(rect, style({ opacity: "0" }), viewport)).toBe(false);
    expect(isBlockingOverlay(rect, style({ opacity: "0.051" }), viewport)).toBe(true);
    expect(isBlockingOverlay(rect, style({ opacity: undefined as any }), viewport)).toBe(true); // missing → 1
  });

  it("rejects hidden/none and malformed candidates", () => {
    expect(isBlockingOverlay(rect, style({ visibility: "hidden" }), viewport)).toBe(false);
    expect(isBlockingOverlay(rect, style({ display: "none" }), viewport)).toBe(false);
    expect(isBlockingOverlay(null, style(), viewport)).toBe(false);
    expect(isBlockingOverlay(rect, null, viewport)).toBe(false);
  });
});

describe("waitForOverlays", () => {
  const blocking = {
    rect: { width: 900, height: 720 },
    style: { position: "fixed", zIndex: "100", opacity: "1", visibility: "visible", display: "block" },
    viewport: { width: 1000, height: 800 },
  };

  it("no-ops on a page without evaluate", async () => {
    await expect(waitForOverlays({})).resolves.toBeUndefined();
    await expect(waitForOverlays(undefined)).resolves.toBeUndefined();
  });

  it("polls every 250ms until no blocking candidate remains", async () => {
    let polls = 0;
    const waits: number[] = [];
    const page = {
      evaluate: async () => {
        polls++;
        return polls <= 2 ? [blocking] : [];
      },
      waitForTimeout: async (ms: number) => {
        waits.push(ms);
      },
    };
    await waitForOverlays(page);
    expect(polls).toBe(3);
    expect(waits).toEqual([250, 250]);
  });

  it("stops at the timeout without throwing", async () => {
    let polls = 0;
    const page = {
      evaluate: async () => {
        polls++;
        return [blocking];
      },
      waitForTimeout: async () => {},
    };
    await expect(waitForOverlays(page, 0)).resolves.toBeUndefined();
    expect(polls).toBe(1); // no extra poll after the deadline
  });

  it("swallows evaluate errors (page closed mid-wait)", async () => {
    const page = {
      evaluate: async () => {
        throw new Error("Target closed");
      },
    };
    await expect(waitForOverlays(page)).resolves.toBeUndefined();
  });

  it("captureLiveSite waits by default and waitForOverlay:false skips", async () => {
    let evals = 0;
    const overlayFake = () => ({
      launch: async () => ({
        newPage: async () => ({
          goto: async () => {},
          waitForTimeout: async () => {},
          evaluate: async () => {
            evals++;
            return 500; // preScroll result; not an overlay candidate list
          },
          screenshot: async ({ path }: { path: string }) => {
            const fs = await import("node:fs/promises");
            await fs.writeFile(path, Buffer.from("png-bytes"));
            return Buffer.from("png-bytes");
          },
        }),
        close: async () => {},
      }),
    });
    await captureLiveSite("https://example.com", tmpDir(), async () => ({ chromium: overlayFake() }));
    expect(evals).toBe(2); // preScroll + one overlay poll
    evals = 0;
    await captureLiveSite(
      "https://example.com",
      tmpDir(),
      async () => ({ chromium: overlayFake() }),
      { waitForOverlay: false },
    );
    expect(evals).toBe(1); // preScroll only
  });
});

describe("captureLiveSite", () => {
  it("returns install instructions when playwright is missing", async () => {
    const res = await captureLiveSite("https://example.com", tmpDir(), async () => {
      throw new Error("Cannot find package 'playwright'");
    });
    expect("error" in res).toBe(true);
    if ("error" in res) expect(res.error).toContain("npx playwright install chromium");
  });

  it("returns install instructions when chromium launch fails", async () => {
    const res = await captureLiveSite("https://example.com", tmpDir(), async () => ({
      chromium: { launch: async () => { throw new Error("Executable doesn't exist"); } },
    }));
    expect("error" in res).toBe(true);
    if ("error" in res) expect(res.error).toContain("npx playwright install chromium");
  });

  it("propagates page-level runtime errors instead of the install hint", async () => {
    const res = captureLiveSite("https://example.com", tmpDir(), async () => ({
      chromium: {
        launch: async () => ({
          newPage: async () => ({
            goto: async () => {
              throw new Error("Timeout 45000ms exceeded");
            },
            screenshot: async () => {},
          }),
          close: async () => {},
        }),
      },
    }));
    await expect(res).rejects.toThrow("Timeout 45000ms exceeded");
  });

  it("screenshots the page with a fake chromium", async () => {
    const dir = tmpDir();
    const fake = {
      launch: async () => ({
        newPage: async () => ({
          goto: async () => {},
          // settle wait + pre-scroll evaluate from the capture flow
          waitForTimeout: async () => {},
          evaluate: async () => 500,
          screenshot: async ({ path }: { path: string }) => {
            const fs = await import("node:fs/promises");
            await fs.writeFile(path, Buffer.from("png-bytes"));
            return Buffer.from("png-bytes");
          },
        }),
        close: async () => {},
      }),
    };
    const res = await captureLiveSite(
      "https://example.com",
      dir,
      async () => ({ chromium: fake }),
    );
    expect("file" in res).toBe(true);
    if ("file" in res) {
      expect(readFileSync(res.file).toString()).toBe("png-bytes");
      expect(res.base64).toBe(Buffer.from("png-bytes").toString("base64"));
    }
  });

  // Page fake that records the order of goto/waitForTimeout/evaluate/screenshot
  // calls so tests can pin the wait-strategy, settle, and pre-scroll ordering.
  const recordingFake = (calls: string[]) => ({
    launch: async () => ({
      newPage: async () => ({
        goto: async (_u: string, o: any) => { calls.push("goto:" + o.waitUntil); },
        waitForTimeout: async (ms: number) => { calls.push("wait:" + ms); },
        evaluate: async () => { calls.push("eval"); return 500; },
        screenshot: async ({ path }: { path: string }) => {
          calls.push("shot");
          const fs = await import("node:fs/promises");
          await fs.writeFile(path, Buffer.from("png-bytes"));
          return Buffer.from("png-bytes");
        },
      }),
      close: async () => {},
    }),
  });

  it("uses load strategy with settle and scrolls before the screenshot", async () => {
    const calls: string[] = [];
    const res = await captureLiveSite(
      "https://example.com",
      tmpDir(),
      async () => ({ chromium: recordingFake(calls) }),
    );
    expect("file" in res).toBe(true);
    expect(calls[0]).toBe("goto:load"); // default wait strategy is "load"
    expect(calls.indexOf("wait:3000")).toBe(1); // settle right after load
    expect(calls.filter((c) => c === "eval").length).toBeGreaterThanOrEqual(1); // pre-scroll runs
    expect(calls.indexOf("eval")).toBeGreaterThan(calls.indexOf("wait:3000")); // scroll after settle
    expect(calls[calls.length - 1]).toBe("shot"); // screenshot last
  });

  it("networkidle strategy skips the settle but still pre-scrolls", async () => {
    const calls: string[] = [];
    const res = await captureLiveSite(
      "https://example.com",
      tmpDir(),
      async () => ({ chromium: recordingFake(calls) }),
      { waitStrategy: "networkidle" },
    );
    expect("file" in res).toBe(true);
    expect(calls[0]).toBe("goto:networkidle");
    expect(calls).not.toContain("wait:3000"); // fixed settle is load-only
    expect(calls.filter((c) => c === "eval").length).toBeGreaterThanOrEqual(1); // still pre-scrolls
    expect(calls[calls.length - 1]).toBe("shot");
  });

  // Fake chromium whose newPage captures its creation options (mirrors
  // structure.test.ts's optionCapturingFake) so tests can pin the viewport
  // threading through captureLiveSite.
  const optionCapturingFake = (captured: any[]) => ({
    launch: async () => ({
      newPage: async (opts: any) => {
        captured.push(opts);
        return {
          goto: async () => {},
          // settle wait + pre-scroll evaluate from the capture flow
          waitForTimeout: async () => {},
          evaluate: async () => 500,
          screenshot: async ({ path }: { path: string }) => {
            const fs = await import("node:fs/promises");
            await fs.writeFile(path, Buffer.from("png-bytes"));
            return Buffer.from("png-bytes");
          },
        };
      },
      close: async () => {},
    }),
  });

  it("uses the mobile viewport profile when opts.viewport is mobile", async () => {
    const captured: any[] = [];
    const res = await captureLiveSite(
      "https://x.test",
      tmpDir(),
      async () => ({ chromium: optionCapturingFake(captured) }),
      { viewport: "mobile" },
    );
    expect("file" in res).toBe(true);
    expect(captured).toHaveLength(1);
    // The profile is SPLIT: width/height land in playwright's `viewport` key,
    // the mobile flags are sibling context options.
    expect(captured[0]).toEqual({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
  });

  it("defaults to the desktop viewport (no mobile flags)", async () => {
    const captured: any[] = [];
    const res = await captureLiveSite(
      "https://x.test",
      tmpDir(),
      async () => ({ chromium: optionCapturingFake(captured) }),
    );
    expect("file" in res).toBe(true);
    expect(captured).toHaveLength(1);
    // Exact equality: the desktop default must inject no mobile flags and no
    // extra fields into newPage.
    expect(captured[0]).toEqual({ viewport: { width: 1440, height: 900 } });
  });

  it("keeps the inline preview by default for a small screenshot", async () => {
    const res = await captureLiveSite(
      "https://example.com",
      tmpDir(),
      async () => ({ chromium: optionCapturingFake([]) }),
    );
    expect("file" in res).toBe(true);
    if ("file" in res) {
      expect(res.base64).toBe(Buffer.from("png-bytes").toString("base64"));
      expect(res.inlineOmitted).toBeUndefined();
    }
  });

  it("omits the inline preview when inline is false, file still saved", async () => {
    const dir = tmpDir();
    const res = await captureLiveSite(
      "https://example.com",
      dir,
      async () => ({ chromium: optionCapturingFake([]) }),
      { inline: false },
    );
    expect("file" in res).toBe(true);
    if ("file" in res) {
      expect(res.base64).toBeUndefined();
      expect(res.inlineOmitted).toBe(true);
      expect(readFileSync(res.file).toString()).toBe("png-bytes");
    }
  });

  const bufferFake = (buf: Buffer) => ({
    launch: async () => ({
      newPage: async () => ({
        goto: async () => {},
        waitForTimeout: async () => {},
        evaluate: async () => 500,
        screenshot: async ({ path }: { path: string }) => {
          const fs = await import("node:fs/promises");
          await fs.writeFile(path, buf);
          return buf;
        },
      }),
      close: async () => {},
    }),
  });

  it("omits a preview whose base64 exceeds maxInlineBytes", async () => {
    const big = Buffer.alloc(300, 1);
    const res = await captureLiveSite(
      "https://example.com",
      tmpDir(),
      async () => ({ chromium: bufferFake(big) }),
      { maxInlineBytes: 32 },
    );
    expect("file" in res).toBe(true);
    if ("file" in res) {
      expect(res.base64).toBeUndefined();
      expect(res.inlineOmitted).toBe(true);
      expect(readFileSync(res.file).equals(big)).toBe(true);
    }
  });

  it("omits a preview above the default 2.5MB base64 budget", async () => {
    // 1.9MB raw -> 2,533,336 base64 chars, above the default 2,500,000.
    const big = Buffer.alloc(1_900_000, 1);
    const res = await captureLiveSite(
      "https://example.com",
      tmpDir(),
      async () => ({ chromium: bufferFake(big) }),
    );
    expect("file" in res).toBe(true);
    if ("file" in res) {
      expect(res.base64).toBeUndefined();
      expect(res.inlineOmitted).toBe(true);
      expect(readFileSync(res.file).equals(big)).toBe(true);
    }
    expect(DEFAULT_MAX_INLINE_BYTES).toBe(2_500_000);
  });

  it("desktop and mobile captures of the same URL keep distinct files (issue #23)", async () => {
    const dir = tmpDir();
    const desktop = await captureLiveSite(
      "https://x.test/same",
      dir,
      async () => ({ chromium: optionCapturingFake([]) }),
    );
    const mobile = await captureLiveSite(
      "https://x.test/same",
      dir,
      async () => ({ chromium: optionCapturingFake([]) }),
      { viewport: "mobile" },
    );
    expect("file" in desktop && "file" in mobile).toBe(true);
    if (!("file" in desktop && "file" in mobile)) return;
    expect(desktop.file).not.toBe(mobile.file);
    expect(desktop.file.endsWith("-desktop.png")).toBe(true);
    expect(mobile.file.endsWith("-mobile.png")).toBe(true);
    expect(existsSync(desktop.file) && existsSync(mobile.file)).toBe(true);
  });
});
