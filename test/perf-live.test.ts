import { describe, expect, it, vi } from "vitest";
import {
  Cdp,
  COLLECTOR,
  clampSeconds,
  findBrowser,
  measureRuntime,
  type CdpLike,
  type CdpResult,
  type FetchFn,
  type PerfChild,
  type SpawnFn,
} from "../src/perf-live.js";

const BROWSER = "C:\\fake\\chrome.exe";

/** Fake browser child: announces a DevTools port on stderr unless told not to. */
function fakeSpawn(opts: {
  announcePort?: boolean;
  exitQuick?: boolean;
  kill?: () => void;
} = {}): SpawnFn {
  return () => {
    const child: PerfChild = {
      stderr:
        opts.announcePort === false
          ? { on: () => {} }
          : { on: (_e, cb) => queueMicrotask(() => cb("DevTools listening on ws://127.0.0.1:9222/ gag")) },
      on: (event, cb) => {
        if (event === "exit" && opts.exitQuick) queueMicrotask(() => cb());
      },
      kill: opts.kill ?? (() => {}),
    };
    return child;
  };
}

const fakeFetch: FetchFn = async () => ({
  json: async () => [{ type: "page", webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/1" }],
});

/** Fake CDP endpoint: records sends, answers readyState + the collector result. */
class FakeCdp implements CdpLike {
  sent: Array<{ method: string; params: Record<string, unknown> }> = [];
  metrics: Record<string, unknown> | undefined = {};
  closed = false;

  async send(method: string, params: Record<string, unknown> = {}): Promise<CdpResult> {
    this.sent.push({ method, params });
    return {};
  }
  async evaluate(expression: string): Promise<unknown> {
    if (expression.includes("readyState")) return "complete";
    if (expression.includes("__AEGON_LIVE__")) return this.metrics;
    return undefined;
  }
  close() {
    this.closed = true;
  }
}

const aegonMetrics = {
  seconds: 0.05, frames: 3, badFrames: 1, worstFrameMs: 40, avgFps: 55,
  longTasks: 2, longTaskMaxMs: 70, loaf: 1, loafMaxBlockingMs: 60,
  layoutReads: 5, layoutReadsInRaf: 4, styleWrites: 2, thrashEvents: 1,
  scrollListeners: [{ type: "wheel", passive: false }],
  animationsAtEnd: 2,
};

describe("clampSeconds", () => {
  it("defaults to aegon's 4s and never exceeds the 10s plan cap", () => {
    expect(clampSeconds(undefined)).toBe(4);
    expect(clampSeconds(60)).toBe(10);
    expect(clampSeconds(0.05)).toBe(0.05);
    expect(clampSeconds(0)).toBe(0.05);
  });
});

describe("findBrowser", () => {
  it("honors the AEGON_BROWSER override when it exists", () => {
    expect(
      findBrowser({
        env: { AEGON_BROWSER: "C:\\b\\chrome.exe" },
        exists: (p) => p.endsWith("chrome.exe"),
        platform: "win32",
      }),
    ).toBe("C:\\b\\chrome.exe");
  });

  it("returns null when no candidate exists", () => {
    expect(findBrowser({ env: {}, exists: () => false, platform: "linux" })).toBeNull();
  });

  it("picks the first existing candidate in aegon's priority order", () => {
    const env = { ProgramFiles: "P", "ProgramFiles(x86)": "P86" };
    // only the PF Edge install "exists" — chrome (pf/pf86/appdata) all miss
    expect(
      findBrowser({ env, exists: (p) => p.startsWith("P\\Microsoft"), platform: "win32" }),
    ).toBe("P\\Microsoft\\Edge\\Application\\msedge.exe");
  });
});

describe("Cdp (raw CDP over the global WebSocket)", () => {
  it("routes wire messages to pending sends and rejects on CDP errors", async () => {
    let last: FakeWs | undefined;
    class FakeWs {
      listeners = new Map<string, Array<(ev: unknown) => void>>();
      sent: Array<Record<string, unknown>> = [];
      constructor(_url: string) {
        last = this;
        queueMicrotask(() => this.fire("open"));
      }
      addEventListener(type: string, cb: (ev: unknown) => void) {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), cb]);
      }
      send(data: string) {
        this.sent.push(JSON.parse(data) as Record<string, unknown>);
      }
      close() {}
      fire(type: string, ev?: unknown) {
        for (const cb of this.listeners.get(type) ?? []) cb(ev);
      }
      reply(msg: object) {
        this.fire("message", { data: JSON.stringify(msg) });
      }
    }
    vi.stubGlobal("WebSocket", FakeWs);
    try {
      const cdp = await Cdp.connect("ws://127.0.0.1:9222/devtools/page/1");
      const ok = cdp.send("Page.enable");
      expect(last!.sent[0]).toMatchObject({ id: 1, method: "Page.enable" });
      last!.reply({ id: 1, result: { result: { value: true } } });
      await expect(ok).resolves.toEqual({ result: { value: true } });

      const bad = cdp.send("X.bad");
      last!.reply({ id: 2, error: { message: "boom", code: -32000 } });
      await expect(bad).rejects.toThrow("boom (CDP -32000)");

      const throwing = cdp.evaluate("nope");
      last!.reply({ id: 3, result: { exceptionDetails: { exception: { description: "SyntaxError: x" } } } });
      await expect(throwing).rejects.toThrow("SyntaxError: x");

      const value = cdp.evaluate("42");
      last!.reply({ id: 4, result: { result: { value: 42 } } });
      await expect(value).resolves.toBe(42);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("COLLECTOR (structure lock on aegon's instrumentation)", () => {
  it("keeps every instrumentation anchor", () => {
    expect(COLLECTOR).toContain("EventTarget.prototype.addEventListener");
    expect(COLLECTOR).toContain("getBoundingClientRect");
    expect(COLLECTOR).toContain('"offsetWidth"');
    expect(COLLECTOR).toContain("setProperty");
    expect(COLLECTOR).toContain("requestAnimationFrame");
    expect(COLLECTOR).toContain('"longtask"');
    expect(COLLECTOR).toContain('"long-animation-frame"');
    expect(COLLECTOR).toContain("__AEGON_DEADLINE__");
  });
});

describe("measureRuntime", () => {
  const base = { spawnFn: fakeSpawn(), fetchFn: fakeFetch, seconds: 0.05 };

  it("launches via raw CDP, registers the collector pre-navigation and maps aegon names", async () => {
    const cdp = new FakeCdp();
    cdp.metrics = aegonMetrics;
    const kills: string[] = [];
    const res = await measureRuntime("https://build.example/page", {
      ...base,
      spawnFn: fakeSpawn({ kill: () => kills.push("child") }),
      connectFn: async () => cdp,
      findBrowserFn: () => BROWSER,
    });
    if ("error" in res) throw new Error(res.error);
    expect(res.fps).toBe(55); // aegon avgFps
    expect(res.droppedFrames).toBe(1); // aegon badFrames
    expect(res.longTaskCount).toBe(2);
    expect(res.longAnimationFrameMaxBlockingMs).toBe(60);
    expect(res.layoutThrashCount).toBe(1); // aegon thrashEvents
    expect(res.measureBeforeCompositeCount).toBe(4); // aegon layoutReadsInRaf
    expect(res.scrollListeners).toEqual([{ type: "wheel", passive: false }]);
    expect(res.chromePath).toBe(BROWSER);

    const methods = cdp.sent.map((s) => s.method);
    // collector registered BEFORE navigation so foreign pages measure at all
    expect(methods).toEqual([
      "Page.enable",
      "Emulation.setDeviceMetricsOverride",
      "Page.addScriptToEvaluateOnNewDocument",
      "Page.navigate",
    ]);
    const inject = cdp.sent[2].params.source as string;
    expect(inject).toContain("__AEGON_SECONDS__=0.05;");
    expect(inject).toContain("getBoundingClientRect");
    expect(cdp.sent[3].params.url).toBe("https://build.example/page");
    expect(kills).toEqual(["child"]); // browser process reaped
  });

  it("degrades when no Chrome/Edge is found — spawn never called", async () => {
    let spawned = false;
    const res = await measureRuntime("https://build.example/page", {
      ...base,
      findBrowserFn: () => null,
      spawnFn: () => (spawned = true, { stderr: null, on: () => {}, kill: () => {} }),
    });
    expect(res).toEqual({
      error: "No Chrome or Edge found. Install Chrome or set AEGON_BROWSER to the executable path.",
    });
    expect(spawned).toBe(false);
  });

  it("degrades when the browser exits before the DevTools port opens", async () => {
    const res = await measureRuntime("https://build.example/page", {
      ...base,
      spawnFn: fakeSpawn({ announcePort: false, exitQuick: true }),
      findBrowserFn: () => BROWSER,
    });
    expect(res).toEqual({ error: "Browser exited before the DevTools port opened" });
  });

  it("degrades on a missing page target and still kills the child", async () => {
    const kills: string[] = [];
    const res = await measureRuntime("https://build.example/page", {
      ...base,
      spawnFn: fakeSpawn({ kill: () => kills.push("k") }),
      fetchFn: async () => ({ json: async () => [] }),
      findBrowserFn: () => BROWSER,
    });
    expect(res).toEqual({ error: "Browser opened with no page target" });
    expect(kills).toEqual(["k"]);
  });

  it("degrades when the collector never reports", async () => {
    const cdp = new FakeCdp();
    cdp.metrics = undefined;
    const res = await measureRuntime("https://build.example/page", {
      ...base,
      connectFn: async () => cdp,
      findBrowserFn: () => BROWSER,
    });
    expect(res).toEqual({
      error: "Live collector never reported — the page navigated away or crashed before capture ended.",
    });
  });

  it("degrades when the transport throws — error message passes through", async () => {
    const res = await measureRuntime("https://build.example/page", {
      ...base,
      connectFn: async () => {
        throw new Error("CDP websocket failed");
      },
      findBrowserFn: () => BROWSER,
    });
    expect(res).toEqual({ error: "CDP websocket failed" });
  });

  it("degrades when spawn itself throws (ENOENT-style)", async () => {
    const res = await measureRuntime("https://build.example/page", {
      ...base,
      spawnFn: () => {
        throw new Error("spawn ENOENT");
      },
      findBrowserFn: () => BROWSER,
    });
    expect(res).toEqual({ error: "spawn ENOENT" });
  });
});
