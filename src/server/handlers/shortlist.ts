import { createHash } from "node:crypto";
import { open, realpath } from "node:fs/promises";
import { isAbsolute, sep } from "node:path";
import { buildFilterUrl } from "../../awwwards.js";
import type { AccessibilityResult } from "../../a11y.js";
import { parseListing } from "../../parsers.js";
import { startPublicNetworkGuard } from "../../public-net.js";
import type { CaptureResult } from "../../capture.js";
import type { StackFingerprint } from "../../stack.js";
import type { PageStructure } from "../../structure.js";
import type { MotionDna, SiteDetails, SiteSummary } from "../../types.js";
import { parseShortlistInput } from "../../shortlist/contracts.js";
import type {
  CandidateEvidence,
  CandidateSeed,
  CriterionInput,
  ShortlistCandidate,
  ShortlistInput,
  ShortlistResult,
} from "../../shortlist/contracts.js";
import {
  classifyCandidate,
  criterionCoverage,
  shortlistStatus,
  threeDSignal,
} from "../../shortlist/decide.js";
import { writeShortlistArtifacts, type ArtifactAsset } from "../../shortlist/render.js";
import type { HandlerContext } from "../context.js";
import { MOTION_DNA_TTL_MS, SITE_TTL_MS, text } from "../types.js";
import type {
  AnalyzeFn,
  CaptureFn,
  MotionDnaFn,
  StackFn,
  ToolResponse,
} from "../types.js";

const MAX_POOL = 20;
const PROBE_CONCURRENCY = 4;
// Best-effort wall-clock budget, not a hard deadline: checks happen between
// peers, so an in-flight probe may run to its own per-probe timeout.
export const SHORTLIST_BUDGET_MS = 180_000;
export const MAX_SCREENSHOT_BYTES = 8_000_000;
const MAX_SCREENSHOT_BASE64 = Math.ceil((MAX_SCREENSHOT_BYTES * 4) / 3) + 4;
export const SEARCH_RESULT_CAP = 50;

export function capSearchResults<T>(sites: T[]): T[] {
  return sites.slice(0, SEARCH_RESULT_CAP);
}

interface PoolEntry {
  seed: CandidateSeed;
  site?: SiteSummary;
  /** loadDetail returned null: the seed cannot be treated as a normal site. */
  seedLookupFailed?: boolean;
}

interface ProbeOutcome {
  liveUrl: string | null;
  evidence: CandidateEvidence;
  limitations: string[];
  networkBlocked: boolean;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Probe errors can carry long remote messages; the dossier keeps a readable line.
function cleanText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, "");
}

function shortMessage(error: unknown): string {
  return cleanText(messageOf(error)).replace(/\s+/g, " ").trim().slice(0, 300);
}

function errorOf(value: unknown): string | null {
  if (value && typeof value === "object" && "error" in value) {
    const raw = (value as { error: unknown }).error;
    return typeof raw === "string" ? raw : String(raw);
  }
  return null;
}

function blockedCount(guard: { blocked(): number }): number {
  try {
    return guard.blocked();
  } catch {
    return 0;
  }
}

// assets/ names are flat and lowercase. A slug-only name collides for "Alpha"
// vs "alpha" on case-sensitive output trees, so the original slug's hash keeps
// each candidate's files distinct while staying deterministic. The viewport is
// part of the name because a mobile and a desktop dossier can share one outDir.
function assetBase(slug: string, viewport: "desktop" | "mobile"): string {
  const lower = slug
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, ".");
  return `${lower}-${viewport}-${createHash("sha1").update(slug).digest("hex").slice(0, 8)}`;
}

function unknownEvidence(unknowns: string[]): CandidateEvidence {
  return { stack: null, structure: null, motion: null, a11y: { status: "unknown" }, unknowns };
}

// CaptureResult distinguishes a document-root full-page shot (no mode) from
// inner-scroller viewport/anchored shots; only the former is a full page.
function captureOutput(
  result: CaptureResult,
): { file: string; viewport: boolean; base64?: string } | null {
  if ("error" in result) return null;
  if ("mode" in result) {
    if (result.mode === "viewport") {
      return result.file
        ? { file: result.file, viewport: true, base64: result.base64 }
        : null;
    }
    const first = result.anchors[0]?.file;
    return first ? { file: first, viewport: true } : null;
  }
  return "file" in result && result.file
    ? { file: result.file, viewport: false, base64: result.base64 }
    : null;
}

// A refused capture is a screenshot failure, not evidence failure: keep it off
// candidate.evidence.unknowns so the decision/status are not silently rewritten.
function markScreenshotBlocked(
  candidate: ShortlistCandidate,
  limitations: string[],
  refused: number,
): void {
  candidate.screenshotBlocked = true;
  limitations.push(
    `screenshot-blocked: ${candidate.siteSlug} capture had ${refused} refused request(s); no screenshot asset was written.`,
  );
}

// Capture peers return paths. Only a regular PNG strictly inside the cache's
// images directory may be copied into the dossier; a path outside it, a
// symlink escape, a short read or a non-PNG is refused.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function isPng(bytes: Buffer): boolean {
  return bytes.length >= PNG_SIGNATURE.length &&
    bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
}

export async function readBoundedFile(
  file: string,
  maxBytes: number,
  root: string,
): Promise<Buffer | null> {
  try {
    const [rootReal, fileReal] = await Promise.all([realpath(root), realpath(file)]);
    const rootPrefix =
      (process.platform === "win32" ? rootReal.toLowerCase() : rootReal).replace(
        /[\\/]+$/,
        "",
      ) + sep;
    const fileNormalized =
      process.platform === "win32" ? fileReal.toLowerCase() : fileReal;
    if (!fileNormalized.startsWith(rootPrefix)) return null;

    const handle = await open(fileReal, "r");
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > maxBytes) return null;
      const buffer = Buffer.alloc(info.size);
      let offset = 0;
      while (offset < info.size) {
        const { bytesRead } = await handle.read(
          buffer,
          offset,
          info.size - offset,
          offset,
        );
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      // A short read (truncated or changed after fstat) is not a valid asset.
      if (offset !== info.size) return null;
      return isPng(buffer) ? buffer : null;
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
  shouldStop: () => boolean = () => false,
): Promise<Array<R | null>> {
  const results: Array<R | null> = new Array(items.length).fill(null);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      if (shouldStop()) return;
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

interface CachedSites {
  sites: SiteSummary[];
  limitation?: string;
}

function cachedSites(ctx: HandlerContext, criterion: CriterionInput): CachedSites {
  if (criterion.query) {
    const hits = ctx.cache.searchSites(criterion.query, SITE_TTL_MS);
    if (hits) {
      // FTS already applied the query; re-checking with substring semantics
      // would drop stem matches.
      return {
        sites: hits.filter((site) =>
          ctx.matchesFilters(site, { tags: criterion.tags }, false, true),
        ),
      };
    }
    // FTS5 unavailable: keep the legacy substring path rather than a blank list.
    return {
      sites: ctx.cache
        .getSites(SITE_TTL_MS)
        .filter((site) =>
          ctx.matchesFilters(site, { query: criterion.query, tags: criterion.tags }, false),
        ),
      limitation: `search: full-text search unavailable; substring match used for ${criterion.id}`,
    };
  }
  return {
    sites: ctx.cache
      .getSites(SITE_TTL_MS)
      .filter((site) => ctx.matchesFilters(site, { tags: criterion.tags }, false)),
  };
}

// One listing fetch per criterion maximum: a cache miss is repaired, a failed
// fetch is reported as a limitation instead of thrown.
async function searchCriterion(
  ctx: HandlerContext,
  criterion: CriterionInput,
): Promise<{ sites: SiteSummary[]; limitation?: string }> {
  const hit = cachedSites(ctx, criterion);
  if (hit.sites.length > 0) {
    return { sites: hit.sites, ...(hit.limitation ? { limitation: hit.limitation } : {}) };
  }
  const notes: string[] = [];
  if (hit.limitation) notes.push(hit.limitation);
  if ((criterion.tags?.length ?? 0) > 1) {
    notes.push(
      `search: ${criterion.id} fetched first tag only; remaining tags filtered locally`,
    );
  }
  if (criterion.query && (criterion.tags?.length ?? 0) === 0) {
    notes.push(
      `search: ${criterion.id} query was not sent to the remote listing fetch; only tags filter the remote list`,
    );
  }
  try {
    const html = await ctx.client.getHtml(buildFilterUrl({ tags: criterion.tags }));
    const parsed = parseListing(html);
    ctx.cache.upsertSites(parsed);
    if (parsed.length === 0) {
      return {
        sites: [],
        limitation: [
          ...notes,
          `search: ${criterion.id} returned 0 site cards`,
        ].join("; "),
      };
    }
    const filtered = cachedSites(ctx, criterion);
    if (filtered.limitation) notes.push(filtered.limitation);
    if (filtered.sites.length === 0) {
      notes.push(`search: ${criterion.id} returned cards but none matched`);
    }
    return { sites: filtered.sites, limitation: notes.join("; ") || undefined };
  } catch (error) {
    return {
      sites: [],
      limitation: [
        ...notes,
        `search fetch failed for criterion "${criterion.id}": ${shortMessage(error)}`,
      ].join("; "),
    };
  }
}

async function probeCandidate(
  ctx: HandlerContext,
  input: ShortlistInput,
  entry: PoolEntry,
): Promise<ProbeOutcome> {
  const { seed } = entry;
  const limitations: string[] = [];
  const liveUrl = entry.site?.liveUrl ?? seed.detail?.liveUrl ?? null;

  if (!liveUrl) {
    limitations.push(`no live URL for ${seed.siteSlug}; live evidence is unknown.`);
    return {
      liveUrl: null,
      evidence: unknownEvidence(["liveUrl"]),
      limitations,
      networkBlocked: false,
    };
  }

  const guard = await startPublicNetworkGuard(liveUrl);
  if ("error" in guard) {
    limitations.push(
      `public network guard refused ${liveUrl} for ${seed.siteSlug}; live evidence is unknown.`,
    );
    return {
      liveUrl,
      evidence: unknownEvidence(["publicUrl"]),
      limitations,
      networkBlocked: false,
    };
  }

  try {
    const unknowns: string[] = [];
    const blockedBefore = blockedCount(guard);

    // All live peers receive the guard proxy. No peer runs before the guard
    // preflight succeeds, and no path falls back to a direct connection.
    // Stack launches Chromium through the proxy so redirects/subresources stay
    // guard-pinned; that costs more than a fetch and can yield partial evidence
    // when the best-effort budget is hit.
    const stackProbe: StackFn =
      ctx.deps.stackFn ??
      ((url, opts) => import("../../stack.js").then((m) => m.analyzeStack(url, opts)));
    let stack: StackFingerprint | null = null;
    try {
      const result = await stackProbe(liveUrl, { proxyServer: guard.proxyUrl });
      const failed = errorOf(result);
      if (failed !== null) throw new Error(failed);
      stack = result as StackFingerprint;
    } catch (error) {
      unknowns.push("stack");
      limitations.push(`stack probe failed for ${seed.siteSlug}: ${shortMessage(error)}`);
    }

    // analyzePageStructure's second positional is the injectable loader, so the
    // default wrapper places maxBands and opts in their real third/fourth slots.
    const analyze: AnalyzeFn =
      ctx.deps.analyzeFn ??
      ((url, maxBands, opts) =>
        import("../../structure.js").then((m) =>
          m.analyzePageStructure(url, undefined, maxBands, opts),
        ));
    let structure: PageStructure | null = null;
    try {
      const result = await analyze(liveUrl, undefined, {
        waitStrategy: "load",
        viewport: input.viewport,
        proxyServer: guard.proxyUrl,
      });
      const failed = errorOf(result);
      if (failed !== null) throw new Error(failed);
      structure = result as PageStructure;
    } catch (error) {
      unknowns.push("structure");
      limitations.push(`structure probe failed for ${seed.siteSlug}: ${shortMessage(error)}`);
    }

    const captureMotion: MotionDnaFn =
      ctx.deps.motionDnaFn ??
      ((url, opts) =>
        import("../../motion-dna.js").then((m) =>
          m.captureMotionDnaUnified(url, opts),
        ));
    let motion: MotionDna | null = null;
    const desktopMotionCache = input.viewport === "desktop";
    if (input.viewport === "mobile") {
      limitations.push(
        "motion-cache: mobile motion was captured fresh; cached motion DNA rows are desktop-only.",
      );
    }
    if (!input.refresh && desktopMotionCache) {
      try {
        const cached = ctx.cache.getMotionDna(liveUrl);
        if (cached && ctx.nowMs() - cached.capturedAt < MOTION_DNA_TTL_MS) {
          motion = cached;
        }
      } catch {
        // A broken cache row is a miss, not a failed probe.
      }
    }
    if (!motion) {
      try {
        const result = await captureMotion(liveUrl, {
          waitStrategy: "load",
          viewport: input.viewport,
          proxyServer: guard.proxyUrl,
        });
        const failed = errorOf(result);
        if (failed !== null) throw new Error(failed);
        motion = result;
        // Mobile DNA is viewport-specific but the cache has no viewport key;
        // never read or write that cache for mobile (see the note above).
        // A blocked probe produced partial DNA; caching it would poison every
        // later dossier for the whole motion TTL. Only cache when the guard
        // refused nothing new while this probe ran.
        if (blockedCount(guard) > blockedBefore) {
          if (!unknowns.includes("network-blocked")) unknowns.push("network-blocked");
          limitations.push(
            `network-blocked: motion cache write skipped for ${seed.siteSlug}; the guard refused subresources during the probe.`,
          );
        } else if (desktopMotionCache) {
          try {
            ctx.cache.upsertMotionDna(motion);
          } catch {
            // A cache write is best effort; the probe itself succeeded.
          }
        }
      } catch (error) {
        unknowns.push("motion");
        limitations.push(`motion probe failed for ${seed.siteSlug}: ${shortMessage(error)}`);
      }
    }

    // A11y is measured only through the explicit accessibility peer. Never
    // launch Chrome implicitly, and never infer evidence from another tool.
    let a11y: CandidateEvidence["a11y"] = { status: "unknown" };
    if (ctx.deps.analyzeAccessibilityFn) {
      try {
        const result = await ctx.deps.analyzeAccessibilityFn({
          url: liveUrl,
          viewport: input.viewport,
          proxyServer: guard.proxyUrl,
        });
        const failed = errorOf(result);
        if (failed !== null) throw new Error(failed);
        const pairs = (result as AccessibilityResult).evidence?.contrast?.worstPairs ?? [];
        a11y = {
          status: "available",
          contrastWorstPairs: pairs.filter((pair) => pair.ratio < 4.5).length,
        };
      } catch (error) {
        unknowns.push("a11y");
        limitations.push(`a11y probe failed for ${seed.siteSlug}: ${shortMessage(error)}`);
      }
    } else {
      unknowns.push("a11y");
    }

    const evidence: CandidateEvidence = { stack, structure, motion, a11y, unknowns };
    const threeD = threeDSignal(stack, structure, motion);
    const rawWebgl = [
      ...(stack?.libs ?? []),
      ...(motion?.stack?.libs ?? []),
      ...(motion?.stack?.render ?? []),
    ].some((lib) => lib.trim().toLowerCase() === "webgl");
    if (rawWebgl && threeD.libraries.length === 0) {
      // Documented residual: a raw WebGL scene proves a canvas, not an engine.
      evidence.unknowns.push("3d-unverified");
      limitations.push(
        `Raw WebGL detected for ${seed.siteSlug} (3d-unverified); no true 3D library was identified, so 3D presence or absence is unproven.`,
      );
    }

    const refused = blockedCount(guard);
    if (refused > 0) {
      if (!unknowns.includes("network-blocked")) unknowns.push("network-blocked");
      limitations.push(
        `network-blocked: ${seed.siteSlug} had ${refused} refused request(s), so live evidence is partial.`,
      );
    }

    return {
      liveUrl,
      evidence,
      limitations,
      networkBlocked: refused > 0,
    };
  } finally {
    try {
      await guard.close();
    } catch {
      // Closing the loopback proxy is best effort.
    }
  }
}

// Unanticipated failures still return a clean tool error; artifacts already
// written by runShortlist are atomic and are never removed here.
export async function shortlist_references(
  ctx: HandlerContext,
  args: ShortlistInput,
): Promise<ToolResponse> {
  try {
    return await runShortlist(ctx, args);
  } catch (error) {
    return {
      content: [text(`shortlist_references failed: ${shortMessage(error)}`)],
      isError: true,
    };
  }
}

async function runShortlist(
  ctx: HandlerContext,
  args: ShortlistInput,
): Promise<ToolResponse> {
  const input = parseShortlistInput(args);
  if (!input) {
    return {
      content: [
        text(
          "shortlist_references: invalid arguments. Use 1-6 criteria, 3-5 results, Awwwards slugs for seeds and an absolute outDir.",
        ),
      ],
      isError: true,
    };
  }
  if (!isAbsolute(input.outDir)) {
    return {
      content: [
        text(`outDir must be an absolute path: ${JSON.stringify(input.outDir)}`),
      ],
      isError: true,
    };
  }

  // Budget time honors an injected clock, but reads Date.now live otherwise so
  // fake timers and spies installed after context creation still advance it.
  const clock = (): number => (ctx.deps.now ? ctx.nowMs() : Date.now());
  const startedAt = clock();
  const limitations: string[] = [];
  let budgetReported = false;
  const budgetExceeded = (): boolean => {
    if (clock() - startedAt <= SHORTLIST_BUDGET_MS) return false;
    if (!budgetReported) {
      budgetReported = true;
      limitations.push(
        `budget: best-effort; in-flight probes may finish. Reached the ${Math.round(SHORTLIST_BUDGET_MS / 1000)}s limit; remaining probes or screenshots were skipped.`,
      );
    }
    return true;
  };
  if (!ctx.deps.analyzeAccessibilityFn) {
    limitations.push("a11y: not measured (no accessibility peer configured)");
  }
  const pool = new Map<string, PoolEntry>();
  const addSite = (site: SiteSummary, surfacedBy: string): void => {
    const existing = pool.get(site.slug);
    if (existing) {
      existing.site = site;
      if (!existing.seed.surfacedBy.includes(surfacedBy)) {
        existing.seed.surfacedBy.push(surfacedBy);
      }
      return;
    }
    pool.set(site.slug, {
      site,
      seed: {
        siteSlug: site.slug,
        title: site.title,
        liveUrl: site.liveUrl,
        thumbnailPath: site.thumbnailPath,
        surfacedBy: [surfacedBy],
      },
    });
  };

  for (const criterion of input.criteria) {
    const result = await searchCriterion(ctx, criterion);
    if (result.limitation) limitations.push(result.limitation);
    // A broad query can match most of the cache; poll only the first page-sized
    // slice per criterion so the pool and probe fan-out stay bounded.
    const capped = capSearchResults(result.sites);
    if (capped.length < result.sites.length) {
      limitations.push(
        `search-capped: ${criterion.id} matched ${result.sites.length}; only the first ${capped.length} were considered.`,
      );
    }
    for (const site of capped) {
      addSite(site, criterion.id);
    }
  }

  for (const slug of input.seeds ?? []) {
    const existing = pool.get(slug);
    if (existing) {
      existing.seed.seeded = true;
      continue;
    }
    let loaded: SiteDetails | null = null;
    let seedLookupFailed = false;
    try {
      loaded = await ctx.loadDetail(slug);
    } catch (error) {
      seedLookupFailed = true;
      limitations.push(`seed-lookup: ${slug} could not be loaded (${shortMessage(error)}).`);
    }
    if (!loaded && !seedLookupFailed) {
      seedLookupFailed = true;
      limitations.push(
        `seed-lookup: no detail was parsed for seed ${slug}; it is kept with unverified metadata.`,
      );
    }
    const site = ctx.cache.getSite(slug, SITE_TTL_MS) ?? undefined;
    pool.set(slug, {
      site,
      seedLookupFailed,
      seed: {
        siteSlug: slug,
        title: loaded?.title ?? slug,
        liveUrl: loaded?.liveUrl ?? null,
        ...(site ? { thumbnailPath: site.thumbnailPath } : {}),
        surfacedBy: [],
        seeded: true,
        detail: loaded,
      },
    });
  }

  // Explicit seeds are always kept and probed first; only non-seed candidates
  // compete for the remaining pool slots.
  const ranked = [...pool.values()].sort(
    (a, b) =>
      b.seed.surfacedBy.length - a.seed.surfacedBy.length ||
      a.seed.siteSlug.localeCompare(b.seed.siteSlug),
  );
  const seedOrder = new Map((input.seeds ?? []).map((slug, index) => [slug, index]));
  const seedEntries = ranked
    .filter((entry) => entry.seed.seeded === true)
    .sort(
      (a, b) =>
        (seedOrder.get(a.seed.siteSlug) ?? 0) - (seedOrder.get(b.seed.siteSlug) ?? 0),
    );
  const otherEntries = ranked.filter((entry) => entry.seed.seeded !== true);
  const remaining = Math.max(0, MAX_POOL - seedEntries.length);
  const entries = [...seedEntries, ...otherEntries.slice(0, remaining)];
  const dropped = otherEntries.length - (entries.length - seedEntries.length);
  if (dropped > 0) {
    limitations.push(
      `pool-truncated: dropped ${dropped} non-seed candidate(s) beyond the ${MAX_POOL}-site cap.`,
    );
  }
  const entriesBySlug = new Map(entries.map((entry) => [entry.seed.siteSlug, entry]));

  const outcomes = await mapWithConcurrency(
    entries,
    PROBE_CONCURRENCY,
    (entry) => probeCandidate(ctx, input, entry),
    () => budgetExceeded(),
  );
  const classified: ShortlistCandidate[] = [];
  entries.forEach((entry, index) => {
    const outcome = outcomes[index];
    if (!outcome) return;
    limitations.push(...outcome.limitations);
    if (
      entry.seedLookupFailed &&
      !outcome.evidence.unknowns.includes("seedLookup")
    ) {
      outcome.evidence.unknowns.push("seedLookup");
    }
    const candidate = classifyCandidate({
      seed: { ...entry.seed, liveUrl: outcome.liveUrl },
      evidence: outcome.evidence,
      constraints: input.constraints,
    });
    // Subresource refusals mean the page was only partially measured; never
    // leave a fully clean recommendation on that evidence.
    classified.push(
      outcome.networkBlocked && candidate.decision === "recommend"
        ? {
            ...candidate,
            decision: "consider",
            reason:
              "Network guard refused subresources, so the measured evidence is partial.",
          }
        : candidate,
    );
  });

  const rank = (a: ShortlistCandidate, b: ShortlistCandidate): number =>
    (a.decision === "recommend" ? 0 : 1) - (b.decision === "recommend" ? 0 : 1) ||
    b.surfacedBy.length - a.surfacedBy.length ||
    a.siteSlug.localeCompare(b.siteSlug);
  const nonAvoid = classified.filter((candidate) => candidate.decision !== "avoid");
  // Explicit seeds are marked on the candidate itself; a criterion may
  // legitimately use the id "seed", and a search result must not inherit
  // seed reservation from that string.
  const isSeedCandidate = (candidate: ShortlistCandidate): boolean =>
    candidate.seeded === true;
  const rankedCandidates = [...nonAvoid].sort(rank);
  const rankedSeeds = rankedCandidates.filter(isSeedCandidate);
  const rankedOthers = rankedCandidates.filter((candidate) => !isSeedCandidate(candidate));

  // Selection order: must coverage, then seeds, then remaining discoveries.
  // A must criterion gets its best-ranked non-avoid candidate before any seed
  // can consume a slot, so seeds cannot crowd out required coverage.
  const selected: ShortlistCandidate[] = [];
  const selectedSlugs = new Set<string>();
  const mustTrim: string[] = [];
  for (const criterion of input.criteria) {
    if (criterion.kind !== "must") continue;
    if (selected.some((candidate) => candidate.surfacedBy.includes(criterion.id))) {
      continue;
    }
    const pick = rankedCandidates.find(
      (candidate) =>
        !selectedSlugs.has(candidate.siteSlug) &&
        candidate.surfacedBy.includes(criterion.id),
    );
    if (!pick) continue;
    if (selected.length >= input.limit) {
      mustTrim.push(criterion.id);
      continue;
    }
    selected.push(pick);
    selectedSlugs.add(pick.siteSlug);
  }
  if (mustTrim.length > 0) {
    limitations.push(
      `must-trim: limit ${input.limit} cannot fit every must criterion (${mustTrim.join(", ")}); selection prioritizes must coverage.`,
    );
  }

  for (const seed of rankedSeeds) {
    if (selectedSlugs.has(seed.siteSlug)) continue;
    if (selected.length >= input.limit) {
      limitations.push(
        `seed-limit: ${seed.siteSlug} did not fit within limit ${input.limit}.`,
      );
      continue;
    }
    selected.push(seed);
    selectedSlugs.add(seed.siteSlug);
  }

  for (const candidate of rankedOthers) {
    if (selected.length >= input.limit) break;
    if (selectedSlugs.has(candidate.siteSlug)) continue;
    selected.push(candidate);
    selectedSlugs.add(candidate.siteSlug);
  }

  const candidates = selected.sort(rank);
  // The dossier must be internally consistent: status and coverage describe
  // the candidates it actually returns, not ones trimmed by `limit`.
  const status = shortlistStatus(candidates, input.criteria);
  const coverage = criterionCoverage(candidates, input.criteria);
  const excluded = classified
    .filter((candidate) => candidate.decision === "avoid")
    .sort((a, b) => a.siteSlug.localeCompare(b.siteSlug))
    .map((candidate) => ({ siteSlug: candidate.siteSlug, reason: candidate.reason }));

  let captureBudgetReported = false;
  const captureBudgetExceeded = (slug: string): boolean => {
    if (!budgetExceeded()) return false;
    if (!captureBudgetReported) {
      captureBudgetReported = true;
      limitations.push(
        `budget: capture stopped before thumbnails/screenshots for ${slug}.`,
      );
    }
    return true;
  };

  const assets: ArtifactAsset[] = [];
  for (const candidate of candidates) candidate.artifacts = {};
  for (const candidate of candidates) {
    if (captureBudgetExceeded(candidate.siteSlug)) break;
    const entry = entriesBySlug.get(candidate.siteSlug);
    if (!entry?.site) {
      limitations.push(
        `thumbnail: no cached site record for ${candidate.siteSlug}; the card has no image.`,
      );
      continue;
    }
    try {
      const image = await ctx.siteImage(entry.site);
      if (image?.type === "image" && image.data) {
        const name = `${assetBase(candidate.siteSlug, input.viewport)}.jpg`;
        assets.push({ name, base64: image.data, mimeType: image.mimeType });
        candidate.artifacts.thumbnail = `assets/${name}`;
      } else {
        limitations.push(
          `thumbnail: siteImage returned no image for ${candidate.siteSlug}.`,
        );
      }
    } catch (error) {
      limitations.push(
        `thumbnail: siteImage failed for ${candidate.siteSlug} (${shortMessage(error)}).`,
      );
    }
  }

  const capture: CaptureFn =
    ctx.deps.captureFn ??
    ((url, imagesDir, opts) =>
      import("../../capture.js").then((m) =>
        m.captureLiveSite(url, imagesDir, undefined, opts),
      ));

  for (const candidate of candidates) {
    if (captureBudgetExceeded(candidate.siteSlug)) break;
    const entry = entriesBySlug.get(candidate.siteSlug);
    const liveUrl =
      candidate.liveUrl ?? entry?.site?.liveUrl ?? entry?.seed.detail?.liveUrl ?? null;
    if (!liveUrl) {
      limitations.push(`screenshot skipped for ${candidate.siteSlug}: no live URL.`);
      continue;
    }
    const guard = await startPublicNetworkGuard(liveUrl);
    if ("error" in guard) {
      limitations.push(
        `screenshot skipped for ${candidate.siteSlug}: public network guard refused ${liveUrl}.`,
      );
      continue;
    }
    try {
      const result = await capture(liveUrl, ctx.cache.imagesDir, {
        inline: true,
        maxInlineBytes: MAX_SCREENSHOT_BYTES,
        viewport: input.viewport,
        scrollCapture: "viewport",
        proxyServer: guard.proxyUrl,
      });
      // Read the guard before branching on capture errors: a failed capture
      // that also hit blocked subresources must record both facts.
      const captureBlocked = blockedCount(guard);
      if (captureBlocked > 0) {
        markScreenshotBlocked(candidate, limitations, captureBlocked);
      }
      if ("error" in result) {
        limitations.push(
          `screenshot: capture failed for ${candidate.siteSlug}: ${shortMessage(result.error)}`,
        );
        continue;
      }
      if (captureBlocked > 0) continue;
      const output = captureOutput(result);
      if (!output) {
        limitations.push(
          `screenshot: capture returned no image for ${candidate.siteSlug}.`,
        );
        continue;
      }
      // Prefer capture's bounded base64 payload: it avoids a file race. Without
      // it, read at most the checked byte count from a PNG inside the cache's
      // images directory; never read unbounded and never follow a path out.
      let bytes: Buffer | null = null;
      if (output.base64) {
        if (output.base64.length > MAX_SCREENSHOT_BASE64) {
          limitations.push(
            `screenshot: base64 payload for ${candidate.siteSlug} exceeded the ${MAX_SCREENSHOT_BYTES}-byte limit; it was not decoded.`,
          );
          continue;
        }
        bytes = Buffer.from(output.base64, "base64");
      } else {
        bytes = await readBoundedFile(
          output.file,
          MAX_SCREENSHOT_BYTES,
          ctx.cache.imagesDir,
        );
      }
      if (!bytes || !isPng(bytes)) {
        limitations.push(
          `screenshot: capture for ${candidate.siteSlug} was not a PNG inside the configured images directory.`,
        );
        continue;
      }
      if (bytes.length > MAX_SCREENSHOT_BYTES) {
        limitations.push(
          `screenshot: capture for ${candidate.siteSlug} exceeded ${MAX_SCREENSHOT_BYTES} bytes.`,
        );
        continue;
      }
      const base = assetBase(candidate.siteSlug, input.viewport);
      const name = output.viewport ? `${base}-viewport.png` : `${base}-full.png`;
      assets.push({ name, base64: bytes.toString("base64"), mimeType: "image/png" });
      if (output.viewport) {
        // Inner-scroller mode yields viewport/anchored shots, never a full page.
        candidate.artifacts.screenshot = `assets/${name}`;
        limitations.push(
          `screenshot-viewport: ${candidate.siteSlug} was captured as a viewport shot by the inner scroll container, not a full page.`,
        );
      } else {
        candidate.artifacts.fullPage = `assets/${name}`;
      }
    } catch (error) {
      // A throw can still leave guard refusals worth reporting; read before
      // closing so the screenshot-scoped note survives.
      const refused = blockedCount(guard);
      if (refused > 0) markScreenshotBlocked(candidate, limitations, refused);
      limitations.push(
        `screenshot: capture failed for ${candidate.siteSlug}: ${shortMessage(error)}`,
      );
    } finally {
      try {
        await guard.close();
      } catch {
        // Closing the loopback proxy is best effort.
      }
    }
  }

  const result: ShortlistResult = {
    status,
    brief: input.brief,
    viewport: input.viewport,
    criteria: input.criteria.map((criterion) => ({
      id: criterion.id,
      label: criterion.label,
      kind: criterion.kind,
      covered: coverage[criterion.id] ?? false,
    })),
    candidates,
    excluded,
    artifacts: { markdown: "", html: "", json: "", decision: "" },
    limitations: [...new Set(limitations.map(cleanText))],
  };

  try {
    result.artifacts = await writeShortlistArtifacts(input.outDir, result, assets);
  } catch (error) {
    return {
      content: [
        text(`shortlist_references could not write artifacts: ${shortMessage(error)}`),
      ],
      isError: true,
    };
  }

  return { content: [text(JSON.stringify(result, null, 1))] };
}
