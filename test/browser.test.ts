import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
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

const WS_TARGET = "ws://127.0.0.1:9222/devtools/browser/discovered";

/** Fake /json/version: records the discovery URL, returns a ws (or nothing). */
function fakeFetch(ws: string | null = WS_TARGET) {
  const calls: string[] = [];
  const fn = async (url: string) => {
    calls.push(url);
    return {
      ok: true,
      status: 200,
      json: async () => (ws === null ? {} : { webSocketDebuggerUrl: ws }),
    };
  };
  return { calls, fn };
}

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
    "http://127.0.0.1:9222/?",
    "http://127.0.0.1:9222/#",
    "ws://127.0.0.1:9222/devtools/browser/abc?",
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
    const discovery = fakeFetch();
    const res = await attachPage(loader, "http://127.0.0.1:9222", "https://example.com", discovery.fn);
    expect("error" in res).toBe(false);
    if (!("error" in res)) expect(res.page).toBe(target);
    // http input: discovery first, then Playwright gets the validated ws URL.
    expect(discovery.calls).toEqual(["http://127.0.0.1:9222/json/version"]);
    expect(chromium.connectOverCDP).toHaveBeenCalledWith(WS_TARGET);
    expect(chromium.launch).not.toHaveBeenCalled();
    // No navigation and no page creation (the fake has no newPage at all).
    expect(target.goto).not.toHaveBeenCalled();
  });

  it("does not fall back when only a near-miss href is open", async () => {
    const pages = [fakePage("https://example.com/path"), fakePage("https://example.com/")];
    const { chromium, loader } = fakeLoader(pages);
    const discovery = fakeFetch();
    const res = await attachPage(loader, "http://127.0.0.1:9222", "https://example.com/path/", discovery.fn);
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
    const discovery = fakeFetch();
    const res = await attachPage(loader, "http://127.0.0.1:9222", "https://want.test/", discovery.fn);
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

  it("refuses a non-loopback ws URL returned by discovery", async () => {
    const { chromium, loader } = fakeLoader([fakePage("https://example.com/")]);
    const discovery = fakeFetch("ws://evil.test:9222/devtools/browser/abc");
    const res = await attachPage(loader, "http://127.0.0.1:9222", "https://example.com", discovery.fn);
    expect("error" in res).toBe(true);
    if ("error" in res) {
      expect(res.error).toContain("refusing to connect");
      expect(res.error).toContain("--user-data-dir");
    }
    expect(chromium.connectOverCDP).not.toHaveBeenCalled();
  });

  it("errors when discovery fails instead of connecting to the http endpoint", async () => {
    const { chromium, loader } = fakeLoader([fakePage("https://example.com/")]);
    const res = await attachPage(
      loader,
      "http://127.0.0.1:9222",
      "https://example.com",
      async () => {
        throw new Error("ECONNREFUSED");
      },
    );
    expect("error" in res).toBe(true);
    if ("error" in res) {
      expect(res.error).toContain("CDP discovery failed");
      expect(res.error).toContain("ECONNREFUSED");
    }
    expect(chromium.connectOverCDP).not.toHaveBeenCalled();
  });

  it("requests discovery in manual redirect mode and refuses a 3xx", async () => {
    const seen: Array<string | undefined> = [];
    const { chromium, loader } = fakeLoader([fakePage("https://example.com/")]);
    const res = await attachPage(
      loader,
      "http://127.0.0.1:9222",
      "https://example.com/",
      async (_url, init) => {
        seen.push(init?.redirect);
        return { ok: false, status: 302, json: async () => ({}) };
      },
    );
    expect(seen).toEqual(["manual"]);
    expect("error" in res).toBe(true);
    if ("error" in res) {
      expect(res.error).toContain("refused a redirect");
      expect(res.error).toContain("HTTP 302");
    }
    expect(chromium.connectOverCDP).not.toHaveBeenCalled();
  });

  it("refuses an opaque redirect from discovery", async () => {
    const { chromium, loader } = fakeLoader([fakePage("https://example.com/")]);
    const res = await attachPage(
      loader,
      "http://127.0.0.1:9222",
      "https://example.com/",
      async () => ({ ok: false, status: 0, type: "opaqueredirect", json: async () => ({}) }),
    );
    expect("error" in res).toBe(true);
    if ("error" in res) expect(res.error).toContain("refused a redirect");
    expect(chromium.connectOverCDP).not.toHaveBeenCalled();
  });

  it("does not follow a loopback discovery redirect (local server)", async () => {
    const hits: string[] = [];
    const server = createServer((req, res) => {
      hits.push(req.url ?? "");
      res.writeHead(302, { location: WS_TARGET });
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const { chromium, loader } = fakeLoader([fakePage("https://example.com/")]);
    try {
      const res = await attachPage(loader, `http://127.0.0.1:${port}`, "https://example.com/");
      expect("error" in res).toBe(true);
      if ("error" in res) expect(res.error).toContain("refused a redirect");
      // One loopback request; the redirect target is never contacted.
      expect(hits).toEqual(["/json/version"]);
      expect(chromium.connectOverCDP).not.toHaveBeenCalled();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("keeps the direct ws input path without discovery", async () => {
    const target = fakePage("https://example.com/");
    const { chromium, loader } = fakeLoader([target]);
    const discovery = fakeFetch();
    const res = await attachPage(loader, WS_TARGET, "https://example.com/", discovery.fn);
    expect("error" in res).toBe(false);
    if (!("error" in res)) expect(res.page).toBe(target);
    expect(discovery.calls).toEqual([]);
    expect(chromium.connectOverCDP).toHaveBeenCalledWith(WS_TARGET);
  });

  it("explains the throwaway-profile setup when the connection fails", async () => {
    const res = await attachPage(
      async () => ({
        chromium: {
          connectOverCDP: async () => {
            throw new Error("ECONNREFUSED 127.0.0.1:9222");
          },
        },
      }),
      WS_TARGET,
      "https://example.com",
    );
    expect("error" in res).toBe(true);
    if ("error" in res) {
      expect(res.error).toContain("ECONNREFUSED");
      expect(res.error).toContain("--user-data-dir");
      expect(res.error).toContain("throwaway profile");
    }
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
