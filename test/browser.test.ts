import { describe, expect, it, vi } from "vitest";
import { attachPage, closeAttached, validateCdpEndpoint } from "../src/browser.js";

type FakePage = {
  url: () => string;
  goto: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

const fakePage = (url: string): FakePage => ({
  url: () => url,
  goto: vi.fn(async () => {}),
  close: vi.fn(async () => {}),
});

// Fake chromium + browser: no newPage at all, so a page-creation fallback
// would throw instead of silently passing.
function fakeLoader(pages: FakePage[], calls: string[] = []) {
  const browser = {
    contexts: () => [
      {
        pages: () => pages,
        close: vi.fn(async () => {
          calls.push("context.close");
        }),
      },
    ],
    close: vi.fn(async () => {
      calls.push("browser.close");
    }),
  };
  const chromium = {
    launch: vi.fn(async () => {
      calls.push("launch");
      return browser;
    }),
    connectOverCDP: vi.fn(async (endpoint: string) => {
      calls.push("connect:" + endpoint);
      return browser;
    }),
  };
  return { browser, chromium, loader: async () => ({ chromium }) };
}

describe("validateCdpEndpoint", () => {
  it.each([
    "http://127.0.0.1:9222",
    "http://127.0.0.1:9222/",
    "http://[::1]:9222",
    "ws://127.0.0.1:9222/devtools/browser/6f1a2b3c-4d5e",
    "ws://[::1]:9222/devtools/browser/abc_123",
  ])("accepts %s", (endpoint) => {
    expect(validateCdpEndpoint(endpoint)).toEqual({ endpoint });
  });

  it.each([
    "",
    "not a url",
    "https://127.0.0.1:9222",
    "wss://127.0.0.1:9222/devtools/browser/abc",
    "http://localhost:9222",
    "http://192.168.1.5:9222",
    "http://127.0.0.1",
    "http://user:pass@127.0.0.1:9222",
    "http://127.0.0.1:9222/?token=abc",
    "http://127.0.0.1:9222/#frag",
    "http://127.0.0.1:9222/json/version",
    "ws://127.0.0.1:9222/devtools/page/ABC",
    "ws://127.0.0.1:9222/",
    "http://[::1]:9222/devtools/browser/abc",
  ])("rejects %s", (endpoint) => {
    expect(validateCdpEndpoint(endpoint)).toHaveProperty("error");
  });
});

describe("attachPage", () => {
  it("connects over CDP and selects the page with the exact normalized href", async () => {
    const target = fakePage("https://example.com/");
    const { chromium, loader } = fakeLoader([fakePage("https://other.test/"), target]);
    const res = await attachPage(loader, "http://127.0.0.1:9222", "https://example.com");
    expect("error" in res).toBe(false);
    if (!("error" in res)) expect(res.page).toBe(target);
    expect(chromium.connectOverCDP).toHaveBeenCalledWith("http://127.0.0.1:9222");
    expect(chromium.launch).not.toHaveBeenCalled();
    // No navigation and no page creation (the fake has no newPage at all).
    expect(target.goto).not.toHaveBeenCalled();
  });

  it("does not fall back when only a near-miss href is open", async () => {
    const pages = [fakePage("https://example.com/path"), fakePage("https://example.com/")];
    const { chromium, loader } = fakeLoader(pages);
    const res = await attachPage(loader, "http://127.0.0.1:9222", "https://example.com/path/");
    expect("error" in res).toBe(true);
    if ("error" in res) {
      expect(res.error).toContain("No open page matches");
      expect(res.error).toContain("https://example.com");
    }
    expect(chromium.connectOverCDP).toHaveBeenCalledTimes(1);
    expect(pages[0]!.goto).not.toHaveBeenCalled();
  });

  it("lists available origins (not paths or queries) when no page matches", async () => {
    const pages = [
      fakePage("https://other.test/secret/path?token=abc"),
      fakePage("http://second.test/x"),
    ];
    const { loader } = fakeLoader(pages);
    const res = await attachPage(loader, "http://127.0.0.1:9222", "https://want.test/");
    expect("error" in res).toBe(true);
    if ("error" in res) {
      expect(res.error).toContain("https://other.test");
      expect(res.error).toContain("http://second.test");
      expect(res.error).not.toContain("/secret/path");
      expect(res.error).not.toContain("token=abc");
      expect(res.error).not.toContain("/x");
    }
    expect(pages[0]!.goto).not.toHaveBeenCalled();
    expect(pages[1]!.goto).not.toHaveBeenCalled();
  });

  it("returns the validation error without touching the loader", async () => {
    let loaded = false;
    const res = await attachPage(
      async () => {
        loaded = true;
        return {};
      },
      "https://127.0.0.1:9222",
      "https://example.com",
    );
    expect("error" in res).toBe(true);
    expect(loaded).toBe(false);
  });
});

describe("closeAttached", () => {
  it("disconnects without closing pages or contexts", async () => {
    const page = fakePage("https://example.com/");
    const context = { pages: () => [page], close: vi.fn(async () => {}) };
    const browser = { contexts: () => [context], close: vi.fn(async () => {}) };
    await closeAttached(browser);
    expect(browser.close).toHaveBeenCalledTimes(1);
    expect(page.close).not.toHaveBeenCalled();
    expect(context.close).not.toHaveBeenCalled();
  });
});
