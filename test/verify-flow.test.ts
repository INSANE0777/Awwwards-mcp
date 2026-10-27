import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  skeletonHash,
  verifyFlow,
  verifyFlowArgsSchema,
  type FlowReport,
  type FlowState,
} from "../src/verify-flow.js";
import { createHandlers } from "../src/server.js";
import { AwwwardsClient, RateLimiter } from "../src/awwwards.js";
import { Cache } from "../src/cache.js";

const FIXTURE_HASH = "a".repeat(40);

const state = (overrides: Partial<FlowState> = {}): FlowState => ({
  path: "/flow?x=1",
  scrollY: 0,
  skeletonHash: FIXTURE_HASH,
  textHash: FIXTURE_HASH,
  elementCount: 10,
  skeletonTruncated: false,
  textTruncated: false,
  complete: true,
  ...overrides,
});

// Each URL gets a queue: baseline (step 0) then one state per action step.
function scriptedStates(statesByUrl: Record<string, FlowState[]>) {
  const queues = new Map(Object.entries(statesByUrl).map(([url, states]) => [url, [...states]]));
  const openFn = vi.fn(async (url: string) => ({
    page: { url },
    close: vi.fn(async () => {}),
  }));
  const stateFn = vi.fn(async (page: { url: string }) => {
    const queue = queues.get(page.url);
    const next = queue?.shift();
    if (!next) throw new Error(`no state queued for ${page.url}`);
    return next;
  });
  return {
    openFn,
    stateFn,
    clickFn: vi.fn(async () => {}),
    scrollFn: vi.fn(async () => {}),
    waitFn: vi.fn(async () => {}),
  };
}

const buildUrl = "https://build.example/flow?x=1";
const referenceUrl = "https://reference.example/flow?x=1";

describe("verifyFlow", () => {
  it("returns same for different origins when every step state matches", async () => {
    const deps = scriptedStates({
      [buildUrl]: [state({ scrollY: 0 }), state({ scrollY: 120 })],
      [referenceUrl]: [state({ scrollY: 0 }), state({ scrollY: 120 })],
    });

    const report = await verifyFlow(
      { buildUrl, referenceUrl, steps: [{ action: "scroll", y: 120 }] },
      deps,
    );
    expect("error" in report).toBe(false);
    if ("error" in report) throw new Error(report.error);

    expect(report.steps).toHaveLength(1);
    expect(report.steps[0]).toMatchObject({
      index: 1,
      action: "scroll y=120",
      status: "same",
      differences: [],
    });
    expect(report.steps[0].build.path).toBe("/flow?x=1");
    expect(report.evidenceCoverage).toEqual({
      status: "complete",
      collected: 1,
      excluded: 0,
      limitations: [],
    });
  });

  it("reports changed with the differing fields named", async () => {
    const deps = scriptedStates({
      [buildUrl]: [state(), state({ skeletonHash: "b".repeat(40), textHash: "c".repeat(40) })],
      [referenceUrl]: [state(), state()],
    });

    const report = await verifyFlow(
      { buildUrl, referenceUrl, steps: [{ action: "wait", ms: 10 }] },
      deps,
    );
    if ("error" in report) throw new Error(report.error);

    expect(report.steps[0].status).toBe("changed");
    expect(report.steps[0].differences).toEqual(["skeleton", "text"]);
    expect(report.evidenceCoverage.status).toBe("complete");
  });

  it("marks an action failure unknown on that side and keeps running later steps", async () => {
    const deps = scriptedStates({
      [buildUrl]: [state(), state(), state()],
      [referenceUrl]: [state(), state(), state()],
    });
    deps.clickFn.mockImplementation(async (page: { url: string }) => {
      if (page.url === buildUrl) throw new Error("click blocked");
    });

    const report = await verifyFlow(
      {
        buildUrl,
        referenceUrl,
        steps: [{ action: "click", selector: ".go" }, { action: "wait", ms: 25 }],
      },
      deps,
    );
    if ("error" in report) throw new Error(report.error);

    expect(report.steps.map((step) => step.status)).toEqual(["unknown", "same"]);
    expect(report.steps[0].build.complete).toBe(false);
    expect(report.steps[0].build.error).toContain("click blocked");
    expect(report.steps[0].reference.complete).toBe(true);
    // Baseline + two steps on both sides: the later step still ran.
    expect(deps.stateFn).toHaveBeenCalledTimes(6);
    expect(deps.waitFn).toHaveBeenCalledTimes(2);
    expect(report.evidenceCoverage.status).toBe("partial");
    expect(report.evidenceCoverage).toMatchObject({ collected: 1, excluded: 1 });
  });

  it("marks truncated evidence unknown even when the visible hashes match", async () => {
    const deps = scriptedStates({
      [buildUrl]: [state(), state({ textTruncated: true })],
      [referenceUrl]: [state(), state()],
    });

    const report = await verifyFlow(
      { buildUrl, referenceUrl, steps: [{ action: "wait", ms: 1 }] },
      deps,
    );
    if ("error" in report) throw new Error(report.error);

    expect(report.steps[0].status).toBe("unknown");
    expect(report.evidenceCoverage.status).toBe("unknown");
    expect(report.evidenceCoverage.limitations[0]).toContain("truncated");
  });

  it("compares scroll as a delta from each side's step-0 baseline", async () => {
    const deps = scriptedStates({
      [buildUrl]: [state({ scrollY: 100 }), state({ scrollY: 500 })],
      [referenceUrl]: [state({ scrollY: 50 }), state({ scrollY: 450 })],
    });

    const report = await verifyFlow(
      { buildUrl, referenceUrl, steps: [{ action: "scroll", y: 400 }] },
      deps,
    );
    if ("error" in report) throw new Error(report.error);

    expect(report.steps[0].status).toBe("same");
    expect(report.steps[0].differences).toEqual([]);
  });
});

describe("verifyFlowArgsSchema", () => {
  const valid = {
    buildUrl: "https://build.example/",
    referenceUrl: "https://reference.example/",
    steps: [{ action: "click", selector: ".go" }],
  };

  it("accepts 1..6 steps and every action type at its bounds", () => {
    expect(verifyFlowArgsSchema.safeParse(valid).success).toBe(true);
    expect(verifyFlowArgsSchema.safeParse({
      ...valid,
      steps: [
        { action: "scroll", y: 0 },
        { action: "scroll", y: 100_000 },
        { action: "wait", ms: 0 },
        { action: "wait", ms: 10_000 },
        { action: "click", selector: "a" },
        { action: "click", selector: "x".repeat(300) },
      ],
    }).success).toBe(true);
  });

  it("rejects empty/over-long selectors, out-of-range y and more than 6 steps", () => {
    expect(verifyFlowArgsSchema.safeParse({
      ...valid,
      steps: [{ action: "click", selector: "" }],
    }).success).toBe(false);
    expect(verifyFlowArgsSchema.safeParse({
      ...valid,
      steps: [{ action: "click", selector: "x".repeat(301) }],
    }).success).toBe(false);
    expect(verifyFlowArgsSchema.safeParse({
      ...valid,
      steps: [{ action: "scroll", y: 100_001 }],
    }).success).toBe(false);
    expect(verifyFlowArgsSchema.safeParse({
      ...valid,
      steps: Array.from({ length: 7 }, () => ({ action: "wait", ms: 1 })),
    }).success).toBe(false);
    expect(verifyFlowArgsSchema.safeParse({ ...valid, steps: [] }).success).toBe(false);
  });
});

describe("skeletonHash", () => {
  it("normalizes generated class hash tokens before hashing", () => {
    expect(skeletonHash(["div.hero_a1b2c3", "p.copy_d4e5f6"]))
      .toBe(skeletonHash(["div.hero_d4e5f6", "p.copy_a1b2c3"]));
    expect(skeletonHash(["div.hero_a1b2c3"]))
      .not.toBe(skeletonHash(["div.hero"]));
  });
});

describe("verify_flow handler", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("passes args through and serializes the flow report", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awwwards-flow-"));
    dirs.push(dir);
    const report: FlowReport = {
      buildUrl,
      referenceUrl,
      steps: [
        {
          index: 1,
          action: "wait 50ms",
          build: state(),
          reference: state(),
          status: "same",
          differences: [],
        },
      ],
      evidenceCoverage: { status: "complete", collected: 1, excluded: 0, limitations: [] },
    };
    const verifyFlowFn = vi.fn(async () => report);
    const handlers = createHandlers({
      client: new AwwwardsClient({ rateLimiter: new RateLimiter(0) }),
      cache: new Cache(dir),
      verifyFlowFn,
    });
    const args = {
      buildUrl,
      referenceUrl,
      steps: [{ action: "wait" as const, ms: 50 }],
    };

    const res = await handlers.verify_flow(args);
    expect(res.isError).toBeUndefined();
    expect(JSON.parse((res.content[0] as { text: string }).text)).toEqual(report);
    expect(verifyFlowFn).toHaveBeenCalledWith(args);
  });

  it("returns an MCP error when the flow runner reports one", async () => {
    const dir = mkdtempSync(join(tmpdir(), "awwwards-flow-"));
    dirs.push(dir);
    const handlers = createHandlers({
      client: new AwwwardsClient({ rateLimiter: new RateLimiter(0) }),
      cache: new Cache(dir),
      verifyFlowFn: async () => ({ error: "browser blocked" }),
    });

    const res = await handlers.verify_flow({
      buildUrl,
      referenceUrl,
      steps: [{ action: "wait", ms: 1 }],
    });
    expect(res.isError).toBe(true);
    expect((res.content[0] as { text: string }).text).toBe("browser blocked");
  });
});
