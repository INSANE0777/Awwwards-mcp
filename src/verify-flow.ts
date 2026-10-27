// Step-aligned interaction verification (design §4.3): run the same scroll /
// click / wait steps on a build and a reference page, then compare compact
// hashed states after each step. Two fresh launches, never attach, no
// screenshots. "same" is only claimed when both sides are complete and
// untruncated; any missing or truncated evidence is "unknown".
import { createHash } from "node:crypto";
import { z } from "zod";
import { coverageFrom, type EvidenceCoverage } from "./coverage.js";
import type { WaitStrategy } from "./structure.js";
import { resolveViewport } from "./viewport.js";

export const MAX_STEPS = 6;
export const MAX_SKELETON_ELEMENTS = 800;
export const MAX_TEXT_CHARS = 50_000;
/** Post-action settle so scroll/click effects land before the next capture. */
export const SETTLE_MS = 150;

// Empty/over-long selectors and out-of-range steps are rejected here, at the
// MCP trust boundary; verifyFlow itself assumes validated args.
const flowActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("scroll"), y: z.number().int().min(0).max(100_000) }),
  z.object({ action: z.literal("click"), selector: z.string().min(1).max(300) }),
  z.object({ action: z.literal("wait"), ms: z.number().int().min(0).max(10_000) }),
]);

export const verifyFlowArgsSchema = z.object({
  buildUrl: z.string().url(),
  referenceUrl: z.string().url(),
  steps: z.array(flowActionSchema).min(1).max(MAX_STEPS),
  viewport: z.enum(["desktop", "mobile"]).optional(),
  waitStrategy: z.enum(["load", "networkidle"]).optional(),
});

export type FlowAction = z.infer<typeof flowActionSchema>;
export type VerifyFlowArgs = z.infer<typeof verifyFlowArgsSchema>;

export interface FlowState {
  path: string;
  scrollY: number;
  skeletonHash: string;
  textHash: string;
  elementCount: number;
  skeletonTruncated: boolean;
  textTruncated: boolean;
  complete: boolean;
  error?: string;
}

export interface FlowStep {
  index: number;
  action: string;
  build: FlowState;
  reference: FlowState;
  status: "same" | "changed" | "unknown";
  differences: string[];
}

export interface FlowReport {
  buildUrl: string;
  referenceUrl: string;
  steps: FlowStep[];
  evidenceCoverage: EvidenceCoverage;
}

export interface FlowRawState {
  path: string;
  scrollY: number;
  skeleton: string[];
  elementCount: number;
  text: string;
}

export interface OpenedFlowPage {
  page: any;
  close: () => Promise<void>;
}

export interface FlowOpenOptions {
  viewport?: "desktop" | "mobile";
  waitStrategy?: WaitStrategy;
}

export interface VerifyFlowDeps {
  openFn?: (url: string, opts: FlowOpenOptions) => Promise<OpenedFlowPage>;
  stateFn?: (page: any) => Promise<FlowState>;
  clickFn?: (page: any, selector: string) => Promise<void>;
  scrollFn?: (page: any, y: number) => Promise<void>;
  waitFn?: (page: any, ms: number) => Promise<void>;
}

const INSTALL_HINT =
  "verify_flow needs Playwright, which is an optional dependency.\n" +
  "Install it where this server runs:  npm install -g playwright && npx playwright install chromium\n" +
  "Then retry the flow verification (or restart your agent afterward).";

export const collapseWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

const sha1 = (value: string): string => createHash("sha1").update(value).digest("hex");

// Generated class hashes are trailing `_a1b2c3` / `-A1B2C3` / `__6a8f2c`
// suffixes on a class token. Anchor to that separator and require a digit so
// word-like classes (facade, decade) and bare hex words survive; lowercasing
// makes the comparison case-insensitive.
const GENERATED_SUFFIX = /(?:_{1,2}|-)(?=[a-f0-9]*\d)[a-f0-9]{6,}$/;

const normalizeSkeletonLine = (line: string): string =>
  collapseWhitespace(line)
    .toLowerCase()
    .split(" ")
    .map((token) => token.replace(GENERATED_SUFFIX, ""))
    .join(" ");

/** Normalize generated-class hash tokens, collapse line whitespace, hash. */
export function skeletonHash(lines: readonly string[]): string {
  return sha1(lines.map(normalizeSkeletonLine).join("\n"));
}

/** Collapse innerText whitespace, cap at 50k chars, hash. */
export function textHash(text: string): string {
  return sha1(collapseWhitespace(text).slice(0, MAX_TEXT_CHARS));
}

export function stateFromRaw(raw: FlowRawState): FlowState {
  const text = collapseWhitespace(typeof raw.text === "string" ? raw.text : "");
  const skeleton = Array.isArray(raw.skeleton)
    ? raw.skeleton.filter((line): line is string => typeof line === "string")
    : [];
  const elementCount = Number.isFinite(raw.elementCount)
    ? Math.max(0, Math.trunc(raw.elementCount))
    : skeleton.length;

  return {
    path: typeof raw.path === "string" ? raw.path : "",
    scrollY: Number.isFinite(raw.scrollY) ? raw.scrollY : 0,
    skeletonHash: skeletonHash(skeleton.slice(0, MAX_SKELETON_ELEMENTS)),
    textHash: textHash(text),
    elementCount,
    skeletonTruncated:
      elementCount > MAX_SKELETON_ELEMENTS || skeleton.length > MAX_SKELETON_ELEMENTS,
    textTruncated: text.length > MAX_TEXT_CHARS,
    complete: true,
  };
}

// Runs IN THE PAGE via page.evaluate(READ_STATE_SNIPPET, MAX_SKELETON_ELEMENTS).
// Plain function expression (no arrow — page.evaluate re-serializes the source)
// with zero outer references; browser globals go through globalThis because the
// Node tsconfig has no DOM lib. Body-scoped: head metadata must not count as
// visible structure, and the node cap arrives as an argument from stateFromRaw.
const READ_STATE_SNIPPET = function (limit: number): FlowRawState {
  const g = globalThis as any;
  const doc = g.document;
  const body = doc ? doc.body : null;
  const nodes = body ? body.querySelectorAll("*") : [];
  const skeleton: string[] = [];
  const count = Math.min(nodes.length, limit);
  for (let i = 0; i < count; i++) {
    const element = nodes[i];
    const id = element.id ? "#" + element.id : "";
    const cls = element.classList.length > 0 ? "." + element.classList[0] : "";
    skeleton.push(element.tagName.toLowerCase() + id + cls);
  }
  return {
    path: g.location.pathname + g.location.search,
    scrollY: g.window.scrollY,
    skeleton,
    elementCount: nodes.length,
    text: body ? body.innerText : "",
  };
};

/** Default state reader: one evaluate, bounded to the body's first MAX_SKELETON_ELEMENTS nodes. */
export async function readPageState(page: any): Promise<FlowState> {
  const raw = (await page.evaluate(READ_STATE_SNIPPET, MAX_SKELETON_ELEMENTS)) as FlowRawState;
  return stateFromRaw(raw);
}

async function openWithPlaywright(
  url: string,
  opts: FlowOpenOptions,
): Promise<OpenedFlowPage> {
  let chromium: any;
  try {
    ({ chromium } = await import("playwright" as string));
  } catch {
    throw new Error(INSTALL_HINT);
  }
  const browser = await chromium.launch();
  try {
    const { width, height, ...contextOpts } = resolveViewport(opts.viewport);
    const page = await browser.newPage({ viewport: { width, height }, ...contextOpts });
    const waitStrategy = opts.waitStrategy ?? "load";
    await page.goto(url, { waitUntil: waitStrategy, timeout: 45_000 });
    // "load" can fire before late work settles; networkidle already means quiet.
    if (waitStrategy === "load") await page.waitForTimeout(3000);
    return {
      page,
      close: async () => {
        await browser.close();
      },
    };
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
}

const message = (err: unknown): string =>
  (err instanceof Error ? err.message : String(err)).slice(0, 500);

function errorState(error: string): FlowState {
  return {
    path: "",
    scrollY: 0,
    skeletonHash: "",
    textHash: "",
    elementCount: 0,
    skeletonTruncated: false,
    textTruncated: false,
    complete: false,
    error,
  };
}

function withError(state: FlowState, error: string): FlowState {
  return { ...state, complete: false, error };
}

function actionLabel(step: FlowAction): string {
  if (step.action === "scroll") return `scroll y=${step.y}`;
  if (step.action === "click") return `click ${step.selector}`;
  return `wait ${step.ms}ms`;
}

function compareStates(
  build: FlowState,
  reference: FlowState,
  buildBaseline: FlowState,
  referenceBaseline: FlowState,
): Pick<FlowStep, "status" | "differences"> {
  const complete =
    build.complete &&
    reference.complete &&
    buildBaseline.complete &&
    referenceBaseline.complete;

  // Without both baselines the scroll delta is not evidence; stay unknown.
  if (!complete) return { status: "unknown", differences: [] };

  const buildDelta = build.scrollY - buildBaseline.scrollY;
  const referenceDelta = reference.scrollY - referenceBaseline.scrollY;
  const changed: Array<[string, boolean]> = [
    ["path", build.path !== reference.path],
    ["scrollDelta", buildDelta !== referenceDelta],
    ["skeleton", build.skeletonHash !== reference.skeletonHash],
    ["text", build.textHash !== reference.textHash],
    ["elementCount", build.elementCount !== reference.elementCount],
  ];
  const differences = changed.filter(([, differs]) => differs).map(([name]) => name);

  // Truncated evidence cannot prove complete equality, even when the visible
  // fields happen to match: report unknown but keep the observed differences.
  const truncated =
    build.skeletonTruncated ||
    build.textTruncated ||
    reference.skeletonTruncated ||
    reference.textTruncated;
  if (truncated) return { status: "unknown", differences };

  return { status: differences.length > 0 ? "changed" : "same", differences };
}

export async function verifyFlow(
  args: VerifyFlowArgs,
  deps: VerifyFlowDeps = {},
): Promise<FlowReport | { error: string }> {
  const open = deps.openFn ?? openWithPlaywright;
  const readState = deps.stateFn ?? readPageState;
  const click = deps.clickFn ?? ((page: any, selector: string) => page.click(selector));
  const scroll =
    deps.scrollFn ??
    ((page: any, y: number) =>
      page.evaluate(function (pos: number) {
        (globalThis as any).window.scrollTo(0, pos);
      }, y));
  const wait = deps.waitFn ?? ((page: any, ms: number) => page.waitForTimeout(ms));

  const opts: FlowOpenOptions = {
    viewport: args.viewport,
    waitStrategy: args.waitStrategy,
  };

  const capture = async (page: any): Promise<FlowState> => {
    try {
      return await readState(page);
    } catch (err) {
      return errorState(message(err));
    }
  };

  const runAction = async (page: any, step: FlowAction): Promise<string | null> => {
    try {
      if (step.action === "scroll") {
        await scroll(page, step.y);
        await wait(page, SETTLE_MS);
      } else if (step.action === "click") {
        await click(page, step.selector);
        await wait(page, SETTLE_MS);
      } else {
        await wait(page, step.ms);
      }
      return null;
    } catch (err) {
      return message(err);
    }
  };

  let buildOpened: OpenedFlowPage;
  try {
    buildOpened = await open(args.buildUrl, opts);
  } catch (err) {
    return { error: `build page could not be opened: ${message(err)}` };
  }

  let referenceOpened: OpenedFlowPage;
  try {
    referenceOpened = await open(args.referenceUrl, opts);
  } catch (err) {
    await buildOpened.close().catch(() => {});
    return { error: `reference page could not be opened: ${message(err)}` };
  }

  try {
    // Step 0 is each side's baseline; deltas are measured from it. A baseline
    // capture failure is not silently absorbed into an empty baseline.
    const baselineErrors: string[] = [];
    const buildBaseline = await capture(buildOpened.page);
    if (buildBaseline.error) {
      baselineErrors.push(`build baseline capture failed: ${buildBaseline.error}`);
    }
    const referenceBaseline = await capture(referenceOpened.page);
    if (referenceBaseline.error) {
      baselineErrors.push(`reference baseline capture failed: ${referenceBaseline.error}`);
    }

    const steps: FlowStep[] = [];
    for (const [offset, step] of args.steps.entries()) {
      const buildActionError = await runAction(buildOpened.page, step);
      const referenceActionError = await runAction(referenceOpened.page, step);

      let buildState = await capture(buildOpened.page);
      let referenceState = await capture(referenceOpened.page);
      if (buildActionError) buildState = withError(buildState, buildActionError);
      if (referenceActionError) referenceState = withError(referenceState, referenceActionError);

      steps.push({
        index: offset + 1,
        action: actionLabel(step),
        build: buildState,
        reference: referenceState,
        ...compareStates(buildState, referenceState, buildBaseline, referenceBaseline),
      });
    }

    const unknown = steps.filter((step) => step.status === "unknown").length;
    const truncated = steps.some(
      (step) =>
        step.build.skeletonTruncated ||
        step.build.textTruncated ||
        step.reference.skeletonTruncated ||
        step.reference.textTruncated,
    );
    const limitations = [...baselineErrors];
    if (truncated) {
      limitations.push(
        `some states were truncated (skeleton >${MAX_SKELETON_ELEMENTS} elements or text >${MAX_TEXT_CHARS} chars); equality cannot be proven`,
      );
    }

    return {
      buildUrl: args.buildUrl,
      referenceUrl: args.referenceUrl,
      steps,
      // collected = steps with decisive same/changed evidence.
      evidenceCoverage: coverageFrom({
        collected: steps.length - unknown,
        excluded: unknown,
        total: steps.length,
        limitations,
      }),
    };
  } finally {
    await buildOpened.close().catch(() => {});
    await referenceOpened.close().catch(() => {});
  }
}

export type VerifyFlowFn = (args: VerifyFlowArgs) => Promise<FlowReport | { error: string }>;
