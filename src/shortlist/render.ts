import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, link, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import type { ShortlistCandidate, ShortlistResult } from "./contracts.js";

export type ArtifactAsset = {
  name: string;
  base64: string;
  mimeType: string;
};

// Everything under assets/ must be a flat, lowercase file name. The class
// already rejects separators and drive letters; the dot checks block "." and
// ".." before they can resolve to assets/ itself or its parent.
const ASSET_NAME = /^[a-z0-9._-]+$/;

// Hard links are the preferred exclusive publish, but some filesystems and
// sandboxes refuse them. These codes fall back to an exclusive direct write.
const LINK_FALLBACK_CODES: ReadonlySet<string> = new Set([
  "ENOSYS",
  "EPERM",
  "EXDEV",
  "EOPNOTSUPP",
  "ENOTSUP",
]);

const TMP_ATTEMPTS = 5;

function isEexist(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "EEXIST";
}

function isLinkUnsupported(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code !== undefined && LINK_FALLBACK_CODES.has(code);
}

// Create a temp file exclusively so a pre-planted file or symlink is never
// followed or removed. A UUID keeps the name unpredictable; a collision just
// retries with a fresh name. The caller owns the returned path.
async function writeExclusiveTemp(file: string, data: string | Buffer): Promise<string> {
  for (let attempt = 0; attempt < TMP_ATTEMPTS; attempt += 1) {
    const tmp = `${file}.tmp-${randomUUID()}`;
    try {
      await writeFile(tmp, data, { flag: "wx", mode: 0o600 });
      return tmp;
    } catch (error) {
      if (isEexist(error)) continue;
      await rm(tmp, { force: true }).catch(() => {});
      throw error;
    }
  }
  throw new Error(`could not create a temp file for ${file}`);
}

async function writeAtomic(file: string, data: string | Buffer): Promise<void> {
  const tmp = await writeExclusiveTemp(file, data);
  try {
    await rename(tmp, file);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}

function decodeAsset(asset: ArtifactAsset): Buffer {
  const bytes = Buffer.from(asset.base64, "base64");
  if (bytes.length === 0) {
    throw new Error(`asset decoded to zero bytes: ${JSON.stringify(asset.name)}`);
  }
  return bytes;
}

function isSafeAssetName(name: string): boolean {
  return ASSET_NAME.test(name) && name !== "." && name !== ".." && !name.includes("..");
}

function assertAssetName(name: string): void {
  if (!isSafeAssetName(name)) {
    throw new Error(`unsafe asset name: ${JSON.stringify(name)}`);
  }
}

function stripBidi(value: string): string {
  return value.replace(/[\u202a-\u202e\u2066-\u2069]/g, "");
}

function codeSpan(value: string): string {
  return `\`${stripBidi(value).replace(/`/g, "'")}\``;
}

function escapeHtml(value: string): string {
  return stripBidi(value)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeMarkdown(value: string, allowNewline = false): string {
  const controls = allowNewline
    ? /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g
    : /[\u0000-\u001f\u007f-\u009f]/g;
  const escaped = stripBidi(value)
    .replaceAll("\\", "\\\\")
    .replace(/[<>`\[\]()!]/g, (char) => `\\${char}`)
    .replace(
      controls,
      (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
    );
  return allowNewline
    ? escaped.replace(/^(\s*)([#\-|>])/gm, "$1\\$2")
    : escaped;
}

function artifactName(name: string): string {
  const assetName = name.startsWith("assets/") ? name.slice("assets/".length) : null;
  if (assetName !== null && isSafeAssetName(assetName)) return codeSpan(name);
  return isSafeAssetName(name) ? codeSpan(name) : escapeMarkdown(name);
}

function artifactBasenames(result: ShortlistResult): Array<[string, string]> {
  const artifacts = result.artifacts;
  const entries: Array<[string, string]> = [
    ["Markdown", artifacts.markdown],
    ["HTML", artifacts.html],
    ["JSON", artifacts.json],
    ["Reference decision (kept)", artifacts.decision],
  ];
  if (artifacts.decisionNew) {
    entries.push(["Reference decision proposal (new)", artifacts.decisionNew]);
  }
  return entries
    .filter(([, path]) => Boolean(path))
    .map(([label, path]): [string, string] => [label, basename(path)]);
}

// Human labels for candidate images: a viewport shot is not a full page.
const CANDIDATE_ARTIFACT_LABELS: Record<string, string> = {
  thumbnail: "Thumbnail",
  fullPage: "Full page",
  screenshot: "Viewport screenshot",
};

function candidateArtifactLabel(kind: string): string {
  return CANDIDATE_ARTIFACT_LABELS[kind] ?? kind;
}

function surfacedLabel(candidate: ShortlistCandidate): string {
  return (
    candidate.surfacedBy.join(", ") ||
    (candidate.seeded ? "explicit seed" : "unknown")
  );
}

function motionLabel(candidate: ShortlistCandidate): string {
  if (candidate.motionLevel === "unknown") return "unknown";
  const scroll = candidate.evidence.motion?.scroll;
  const counts = `${scroll?.triggerCount ?? 0} triggers, ${scroll?.scrubCount ?? 0} scrubs, ${scroll?.pinCount ?? 0} pins`;
  if (candidate.motionLevel === "minimal") {
    return `none measured (${counts}; globals only)`;
  }
  return `${candidate.motionLevel} (${counts})`;
}

function threeDLabel(candidate: ShortlistCandidate): string {
  if (candidate.threeD.detected) {
    return `detected (${candidate.threeD.libraries.join(", ")})`;
  }
  if (candidate.threeD.canvas) return "unverified (canvas scroll mode)";
  if (candidate.evidence.unknowns.includes("3d-unverified")) {
    return "unverified (raw WebGL)";
  }
  return "not detected";
}

function evidenceLines(candidate: ShortlistCandidate): string[] {
  const { stack, structure, a11y } = candidate.evidence;
  const lines = [
    stack
      ? `Stack: ${stack.framework ?? "unknown"}${stack.libs.length ? ` (${stack.libs.join(", ")})` : ""}`
      : "Stack: not measured",
    structure
      ? `Structure: ${structure.scrollMode ?? "unknown"} scroll, ${structure.totalHeight}px, ${structure.bands.length} bands`
      : "Structure: not measured",
  ];
  lines.push(`Motion: ${motionLabel(candidate)}`);
  lines.push(
    `3D: ${threeDLabel(candidate)}`,
  );
  lines.push(
    a11y.status === "available"
      ? `A11y: available${
          a11y.contrastWorstPairs === undefined
            ? ""
            : `; worst sampled contrast pairs below 4.5:1: ${a11y.contrastWorstPairs}`
        }`
      : "A11y: unknown",
  );
  return lines;
}

export function renderShortlistMarkdown(result: ShortlistResult): string {
  const lines: string[] = [
    "# Reference shortlist",
    "",
    `**Status:** ${escapeMarkdown(result.status)} · **Viewport:** ${escapeMarkdown(result.viewport)}`,
    "",
    "## Brief",
    "",
    escapeMarkdown(result.brief.replace(/\r\n?/g, "\n"), true),
    "",
    "## Criteria",
    "",
  ];

  if (result.criteria.length === 0) {
    lines.push("_No criteria recorded._", "");
  } else {
    for (const criterion of result.criteria) {
      lines.push(
        `- **${escapeMarkdown(criterion.kind)}** ${codeSpan(criterion.id)} — ${escapeMarkdown(criterion.label)} — ${
          criterion.covered ? "covered" : "not covered"
        }`,
      );
    }
    lines.push("");
  }

  lines.push("## Candidates", "");
  if (result.candidates.length === 0) {
    lines.push("_No candidates passed the constraints._", "");
  }
  for (const candidate of result.candidates) {
    lines.push(
      `### ${escapeMarkdown(candidate.title)} (${codeSpan(candidate.siteSlug)})`,
      "",
    );
    lines.push(`**Decision:** ${escapeMarkdown(candidate.decision)}`, "");
    lines.push(`- Live URL: ${escapeMarkdown(candidate.liveUrl ?? "not available")}`);
    lines.push(`- Why: ${escapeMarkdown(candidate.reason)}`);
    lines.push(`- Surfaced by: ${escapeMarkdown(surfacedLabel(candidate))}`);
    if (candidate.screenshotBlocked) {
      lines.push(
        "- Screenshot: blocked by the network guard; no screenshot asset was written.",
      );
    }
    for (const line of evidenceLines(candidate)) {
      // The 3D line is generated from allowlisted library labels, so its
      // parentheses can stay literal; every other evidence line is untrusted.
      lines.push(
        `- ${line.startsWith("3D: ") || line.startsWith("Motion: ") ? line : escapeMarkdown(line)}`,
      );
    }
    const candidateArtifacts = Object.entries(candidate.artifacts).filter(([, path]) =>
      Boolean(path),
    );
    if (candidateArtifacts.length > 0) {
      lines.push(
        `- Candidate artifacts: ${candidateArtifacts
          .map(
            ([kind, path]) =>
              `${escapeMarkdown(candidateArtifactLabel(kind))} ${artifactName(path)}`,
          )
          .join(", ")}`,
      );
    }
    lines.push("", "**Unknowns**", "");
    if (candidate.evidence.unknowns.length === 0) {
      lines.push("_None recorded._");
    } else {
      for (const unknown of candidate.evidence.unknowns) {
        lines.push(`- ${escapeMarkdown(unknown)}`);
      }
    }
    lines.push("");
  }

  lines.push("## Excluded", "");
  if (result.excluded.length === 0) {
    lines.push("_None._");
  } else {
    for (const item of result.excluded) {
      lines.push(
        `- ${codeSpan(item.siteSlug)} — ${escapeMarkdown(item.reason)}`,
      );
    }
  }

  lines.push("", "## Unknowns", "");
  const unknownKeys = new Set<string>();
  const unknowns = result.candidates.flatMap((candidate) =>
    candidate.evidence.unknowns.map((unknown) => ({ candidate, unknown })),
  );
  for (const { candidate, unknown } of unknowns) unknownKeys.add(`${candidate.siteSlug}\u0000${unknown}`);
  if (unknownKeys.size === 0) {
    lines.push("_None recorded._");
  } else {
    for (const entry of unknownKeys) {
      const [siteSlug, unknown] = entry.split("\u0000");
      lines.push(`- ${codeSpan(siteSlug)}: ${escapeMarkdown(unknown)}`);
    }
  }

  lines.push("", "## Limitations", "");
  if (result.limitations.length === 0) {
    lines.push("_None recorded._");
  } else {
    for (const limitation of result.limitations) {
      lines.push(`- ${escapeMarkdown(limitation)}`);
    }
  }

  lines.push("", "## Artifacts", "");
  const artifacts = artifactBasenames(result);
  if (artifacts.length === 0) {
    lines.push("No artifact paths recorded.");
  } else {
    for (const [label, name] of artifacts) {
      lines.push(`- ${label}: ${artifactName(name)}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

// A card image must come from the candidate's own artifact field, and the
// writer only emits "assets/<flat-name>". Anything else (bare file names,
// capture paths, URLs, traversal) is omitted rather than guessed.
function artifactImage(path: string | undefined): string | null {
  if (!path?.startsWith("assets/")) return null;
  const name = path.slice("assets/".length);
  return isSafeAssetName(name) ? name : null;
}

function candidateImage(
  candidate: ShortlistCandidate,
): { name: string; label: string } | null {
  const fields: Array<[keyof ShortlistCandidate["artifacts"], string]> = [
    ["thumbnail", "thumbnail"],
    ["fullPage", "full page"],
    ["screenshot", "viewport screenshot"],
  ];
  for (const [field, label] of fields) {
    const name = artifactImage(candidate.artifacts[field]);
    if (name) return { name, label };
  }
  return null;
}

// Fixed artifact names are safe, but a decision proposal name comes from the
// filesystem surface. Validate before creating an href, and escape the text
// either way so an unsafe name can never break out of the attribute.
function fileLink(name: string): string {
  const text = escapeHtml(name);
  return isSafeAssetName(name) ? `<a href="${text}">${text}</a>` : `<code>${text}</code>`;
}

function decisionClass(decision: ShortlistCandidate["decision"]): string {
  return decision === "recommend" || decision === "consider" || decision === "avoid"
    ? decision
    : "unknown";
}

function candidateCard(candidate: ShortlistCandidate): string {
  const image = candidateImage(candidate);
  const thumb = image
    ? `<img src="assets/${escapeHtml(image.name)}" alt="${escapeHtml(`${candidate.title} ${image.label}`)}" loading="lazy">`
    : `<div class="noimg">No image captured</div>`;
  const { stack, structure, a11y } = candidate.evidence;
  const facts: Array<[string, string]> = [
    [
      "3D",
      threeDLabel(candidate),
    ],
    [
      "Motion",
      motionLabel(candidate),
    ],
    ["Stack fit", candidate.stackFit],
    [
      "Stack",
      stack
        ? `${stack.framework ?? "unknown"}${stack.libs.length ? ` · ${stack.libs.join(", ")}` : ""}`
        : "not measured",
    ],
    [
      "Structure",
      structure
        ? `${structure.scrollMode ?? "unknown"} scroll · ${structure.totalHeight}px · ${structure.bands.length} bands`
        : "not measured",
    ],
    [
      "Accessibility",
      a11y.status === "available"
        ? `available${
            a11y.contrastWorstPairs === undefined
              ? ""
              : ` · worst sampled contrast pairs below 4.5:1: ${a11y.contrastWorstPairs}`
          }`
        : "unknown",
    ],
    ["Surfaced by", surfacedLabel(candidate)],
  ];
  if (candidate.screenshotBlocked) {
    facts.push(["Screenshot", "blocked by network guard"]);
  }
  const factsHtml = facts
    .map(
      ([label, value]) =>
        `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`,
    )
    .join("");
  const unknowns =
    candidate.evidence.unknowns.length === 0
      ? `<p class="muted">None recorded.</p>`
      : `<ul>${candidate.evidence.unknowns
          .map((unknown) => `<li>${escapeHtml(unknown)}</li>`)
          .join("")}</ul>`;
  const candidateArtifacts = Object.entries(candidate.artifacts).filter(([, path]) =>
    Boolean(path),
  );

  return `<article class="card decision-${decisionClass(candidate.decision)}">
<div class="thumb">${thumb}</div>
<div class="body">
<div class="row"><h3>${escapeHtml(candidate.title)}</h3><span class="badge">${escapeHtml(candidate.decision)}</span></div>
<p class="slug">${escapeHtml(candidate.siteSlug)} <span class="url">${escapeHtml(candidate.liveUrl ?? "no live URL")}</span></p>
<p class="reason">${escapeHtml(candidate.reason)}</p>
<dl class="facts">${factsHtml}</dl>
<h4>Unknowns</h4>${unknowns}
${
  candidateArtifacts.length > 0
    ? `<p class="muted">Captured: ${candidateArtifacts
        .map(
          ([kind, path]) =>
            `${escapeHtml(candidateArtifactLabel(kind))} ${escapeHtml(path)}`,
        )
        .join(" · ")}</p>`
    : ""
}
</div>
</article>`;
}

const STYLE = `
:root{--bg:#f6f5f2;--card:#fff;--ink:#1c1b19;--muted:#6b6862;--line:#dedbd4;--warn:#8a5a12;--bad:#8a2f2f}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;overflow-wrap:anywhere}
main{max-width:1120px;margin:0 auto;padding:48px 24px 72px}
.kicker{text-transform:uppercase;letter-spacing:.14em;font-size:12px;color:var(--muted);margin:0 0 8px}
h1{font-size:36px;line-height:1.15;margin:0 0 16px;letter-spacing:-.02em}
h2{font-size:20px;margin:40px 0 14px;padding-bottom:8px;border-bottom:1px solid var(--line)}
h3{font-size:18px;margin:0}
h4{font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin:16px 0 6px}
p{margin:0 0 10px}
ul{margin:0;padding-left:20px}
li{margin:3px 0}
.brief{font-size:18px;max-width:70ch}
.meta{display:flex;gap:8px;align-items:center;margin-bottom:18px;flex-wrap:wrap}
.pill,.badge,.tag{display:inline-block;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
.status-ok{background:#e2efe9;color:#245c4a}
.status-partial{background:#f4ead4;color:var(--warn)}
.status-inconclusive{background:#f3dede;color:var(--bad)}
.criteria .tag{background:#eceae5;color:var(--muted);margin-right:8px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:20px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;display:flex;flex-direction:column}
.thumb{aspect-ratio:16/9;background:#e8e5df;border-bottom:1px solid var(--line)}
.thumb img{width:100%;height:100%;object-fit:cover;display:block}
.noimg{width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:13px}
.body{padding:16px 18px 20px}
.row{display:flex;gap:10px;justify-content:space-between;align-items:flex-start}
.badge{background:#eceae5;color:var(--muted);white-space:nowrap}
.decision-recommend .badge{background:#e2efe9;color:#245c4a}
.decision-consider .badge{background:#f4ead4;color:var(--warn)}
.decision-avoid .badge{background:#f3dede;color:var(--bad)}
.slug{color:var(--muted);font-size:13px;word-break:break-word}
.url{margin-left:6px}
.reason{margin-top:8px}
.facts{display:grid;grid-template-columns:1fr 1fr;gap:8px 14px;margin:12px 0 0}
.facts div{min-width:0}
.facts dt{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.facts dd{margin:1px 0 0;font-size:14px;word-break:break-word}
.muted{color:var(--muted)}
.excluded li{color:var(--bad)}
footer{margin-top:48px;color:var(--muted);font-size:13px}
code{background:#eceae5;border-radius:4px;padding:1px 5px;font-size:13px}
`;

// Card images come only from each candidate's explicit artifact fields. Task 3
// must rewrite a candidate's artifacts.thumbnail and a finalist's fullPage or
// screenshot to "assets/<flat-name>" (or a bare flat name) before rendering;
// raw capture or CDN paths are never inferred or rewritten here.
export function renderShortlistHtml(result: ShortlistResult): string {
  const statusClass =
    result.status === "ok" || result.status === "partial" || result.status === "inconclusive"
      ? result.status
      : "inconclusive";
  const criteria =
    result.criteria.length === 0
      ? `<p class="muted">No criteria recorded.</p>`
      : `<ul class="criteria">${result.criteria
          .map(
            (criterion) =>
              `<li><span class="tag">${escapeHtml(criterion.kind)}</span><strong>${escapeHtml(
                criterion.label,
              )}</strong> <span class="muted">${criterion.covered ? "covered" : "not covered"}</span></li>`,
          )
          .join("")}</ul>`;
  const candidates =
    result.candidates.length === 0
      ? `<p class="muted">No candidates passed the constraints.</p>`
      : `<div class="grid">${result.candidates
          .map((candidate) => candidateCard(candidate))
          .join("\n")}</div>`;
  const excluded =
    result.excluded.length === 0
      ? `<p class="muted">None.</p>`
      : `<ul class="excluded">${result.excluded
          .map(
            (item) =>
              `<li><code>${escapeHtml(item.siteSlug)}</code> — ${escapeHtml(item.reason)}</li>`,
          )
          .join("")}</ul>`;
  const unknownKeys = new Set<string>();
  for (const candidate of result.candidates) {
    for (const unknown of candidate.evidence.unknowns) {
      unknownKeys.add(`${candidate.siteSlug}\u0000${unknown}`);
    }
  }
  const unknowns =
    unknownKeys.size === 0
      ? `<p class="muted">None recorded.</p>`
      : `<ul>${[...unknownKeys]
          .map((entry) => {
            const [siteSlug, unknown] = entry.split("\u0000");
            return `<li><code>${escapeHtml(siteSlug)}</code>: ${escapeHtml(unknown)}</li>`;
          })
          .join("")}</ul>`;
  const limitations =
    result.limitations.length === 0
      ? `<p class="muted">None recorded.</p>`
      : `<ul>${result.limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  const briefHtml = result.brief
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map(escapeHtml)
    .join("<br>");
  const fileEntries: Array<[string, string]> = [
    ["Markdown", result.artifacts.markdown],
    ["HTML", result.artifacts.html],
    ["JSON", result.artifacts.json],
    ["Reference decision (kept)", result.artifacts.decision],
  ];
  if (result.artifacts.decisionNew) {
    fileEntries.push(["Reference decision proposal (new)", result.artifacts.decisionNew]);
  }
  const files =
    fileEntries
      .filter(([, path]) => Boolean(path))
      .map(
        ([label, path]) =>
          `<li>${escapeHtml(label)}: ${fileLink(basename(path))}</li>`,
      )
      .join("") || `<li class="muted">No artifact paths recorded.</li>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Reference shortlist</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<header>
<p class="kicker">Awwwards reference shortlist</p>
<h1>Reference shortlist</h1>
<div class="meta"><span class="pill status-${statusClass}">${escapeHtml(result.status)}</span><span class="muted">Viewport: ${escapeHtml(result.viewport)}</span><span class="muted">${result.candidates.length} candidates · ${result.excluded.length} excluded</span></div>
<p class="brief">${briefHtml}</p>
</header>
<section><h2>Criteria</h2>${criteria}</section>
<section><h2>Candidates</h2>${candidates}</section>
<section><h2>Excluded</h2>${excluded}</section>
<section><h2>Unknowns</h2>${unknowns}</section>
<section><h2>Limitations</h2>${limitations}</section>
<footer><h2>Files</h2><ul>${files}</ul><p>Offline view. Images are stored beside this page under <code>assets/</code>.</p></footer>
</main>
</body>
</html>
`;
}

export function renderDecisionTemplate(result: ShortlistResult, reviewer = ""): string {
  const template = {
    schema: "awwwards-shortlist-decision-v1",
    briefSha256: createHash("sha256").update(result.brief, "utf8").digest("hex"),
    viewport: result.viewport,
    criteria: result.criteria,
    candidates: result.candidates.map((candidate) => ({
      siteSlug: candidate.siteSlug,
      title: candidate.title,
      decision: null,
      borrow: "",
      avoid: "",
      reviewer,
      reviewedAt: null,
    })),
  };
  return `${JSON.stringify(template, null, 2)}\n`;
}

// Write the complete body to an exclusive temp file, then publish it with
// link(2). link fails with EEXIST instead of replacing, and the canonical only
// ever appears as a complete file. Filesystems that refuse hard links fall back
// to an exclusive direct write, which still never replaces an existing target.
async function createDecisionLink(target: string, body: string): Promise<boolean> {
  const tmp = await writeExclusiveTemp(target, body);
  try {
    try {
      await link(tmp, target);
      return true;
    } catch (error) {
      if (isEexist(error)) return false;
      if (!isLinkUnsupported(error)) throw error;
    }
    try {
      await writeFile(target, body, { flag: "wx", mode: 0o600 });
      return true;
    } catch (error) {
      if (isEexist(error)) return false;
      // A failed direct write can leave a partial target behind; never keep a
      // truncated canonical decision file.
      await rm(target, { force: true }).catch(() => {});
      throw error;
    }
  } finally {
    await rm(tmp, { force: true }).catch(() => {});
  }
}

// The canonical decision file is the kept one and is never replaced. On a
// collision the proposal fans out to reference-decision.new.json, .new-2.json,
// ... so earlier proposals stay available for diffing too.
async function createDecisionFile(
  outDir: string,
  body: string,
): Promise<{ decision: string; decisionNew?: string }> {
  const decision = join(outDir, "reference-decision.json");
  if (await createDecisionLink(decision, body)) return { decision };
  for (let n = 1; n <= 100; n += 1) {
    const decisionNew = join(
      outDir,
      n === 1 ? "reference-decision.new.json" : `reference-decision.new-${n}.json`,
    );
    if (await createDecisionLink(decisionNew, body)) return { decision, decisionNew };
  }
  throw new Error(`could not create a decision file next to ${decision}`);
}

const OUT_DIR_NAMES = new Set([
  "shortlist.md",
  "shortlist.html",
  "shortlist.json",
  "reference-decision.json",
  "assets",
  ".DS_Store",
  "Thumbs.db",
  "desktop.ini",
]);

function isAllowedOutDirEntry(name: string): boolean {
  if (OUT_DIR_NAMES.has(name)) return true;
  if (/^reference-decision\.new.*\.json$/.test(name)) return true;
  if (
    name.startsWith("shortlist.md.tmp-") ||
    name.startsWith("shortlist.html.tmp-") ||
    name.startsWith("shortlist.json.tmp-") ||
    (name.startsWith("reference-decision") && name.includes(".tmp-"))
  ) {
    return true;
  }
  return false;
}

// outDir is caller-supplied. Never write into a linked directory or on top of
// unrelated files; reruns over this tool's own artifacts are allowed.
async function assertOutDir(outDir: string): Promise<void> {
  let info;
  try {
    info = await lstat(outDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (info.isSymbolicLink()) {
    throw new Error(`refusing to write into a symbolic link or junction: ${outDir}`);
  }
  if (!info.isDirectory()) {
    throw new Error(`outDir must be a directory: ${outDir}`);
  }
  const entries = await readdir(outDir);
  if (entries.some((name) => !isAllowedOutDirEntry(name))) {
    throw new Error(
      "outDir contains unrelated files; choose an empty or dedicated directory",
    );
  }
}

// Task 3 must rewrite each finalist's artifacts.thumbnail/fullPage/screenshot
// to assets/<flat-name> before calling; this only writes the supplied assets
// and never infers names from candidate evidence or raw capture paths.
export async function writeShortlistArtifacts(
  outDir: string,
  result: ShortlistResult,
  assets: ArtifactAsset[],
): Promise<{
  markdown: string;
  html: string;
  json: string;
  decision: string;
  decisionNew?: string;
}> {
  if (!isAbsolute(outDir)) {
    throw new Error(`outDir must be an absolute path: ${JSON.stringify(outDir)}`);
  }
  for (const asset of assets) assertAssetName(asset.name);
  const decodedAssets = assets.map((asset) => ({ asset, bytes: decodeAsset(asset) }));

  await assertOutDir(outDir);
  await mkdir(outDir, { recursive: true });
  if (decodedAssets.length > 0) {
    const assetsDir = join(outDir, "assets");
    try {
      const info = await lstat(assetsDir);
      if (info.isSymbolicLink()) {
        throw new Error(
          `refusing to write assets through a symbolic link: ${assetsDir}`,
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await mkdir(assetsDir, { recursive: true });
    for (const { asset, bytes } of decodedAssets) {
      await writeAtomic(join(assetsDir, asset.name), bytes);
    }
  }

  const paths = {
    markdown: join(outDir, "shortlist.md"),
    html: join(outDir, "shortlist.html"),
    json: join(outDir, "shortlist.json"),
    decision: join(outDir, "reference-decision.json"),
  };
  const initialResult: ShortlistResult = {
    ...result,
    artifacts: paths,
  };
  // Write the generated dossier before the canonical decision file. A failure
  // in any of these writes must not leave a blank reference-decision.json.
  await writeAtomic(paths.markdown, renderShortlistMarkdown(initialResult));
  await writeAtomic(paths.html, renderShortlistHtml(initialResult));
  await writeAtomic(paths.json, JSON.stringify(initialResult, null, 2));

  const { decision, decisionNew } = await createDecisionFile(
    outDir,
    renderDecisionTemplate(result),
  );
  const finalPaths = { ...paths, decision };
  if (decisionNew) {
    const renderedResult: ShortlistResult = {
      ...result,
      artifacts: {
        markdown: finalPaths.markdown,
        html: finalPaths.html,
        json: finalPaths.json,
        decision: finalPaths.decision,
        decisionNew,
      },
    };
    await writeAtomic(finalPaths.markdown, renderShortlistMarkdown(renderedResult));
    await writeAtomic(finalPaths.html, renderShortlistHtml(renderedResult));
    await writeAtomic(finalPaths.json, JSON.stringify(renderedResult, null, 2));
  }

  return { ...finalPaths, ...(decisionNew ? { decisionNew } : {}) };
}
