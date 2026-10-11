import type { MotionDna, SiteDetails } from "./types.js";
import type { PageStructure } from "./structure.js";

export type EvidenceStatus = "cached" | "fetched" | "unavailable";
export type StructureEvidenceStatus = "captured" | "unavailable" | "not_requested";
export interface DesignBriefInput { slugs: string[]; goal: string; audience?: string; constraints?: string[]; includeStructure?: boolean; }
export interface DesignBriefSource { slug: string; title: string; detail: SiteDetails | null; detailStatus: EvidenceStatus; motion: MotionDna | null; structure: PageStructure | null; structureStatus: StructureEvidenceStatus; }
export interface BriefSignal { value: string; display: string; frequency: number; sourceSlugs: string[]; }
export interface PaletteSignal extends BriefSignal { luminanceBand: "light" | "mid" | "dark"; }
export interface DesignBrief {
  version: 1; goal: string; audience?: string; constraints: string[];
  sources: Array<{ slug: string; title: string; evidence: { detail: EvidenceStatus; motion: "cached" | "unavailable"; elements: "cached" | "unavailable"; structure: StructureEvidenceStatus; }; }>;
  direction: {
    summary: string; sharedPatterns: BriefSignal[]; outliers: BriefSignal[];
    palette: PaletteSignal[]; technologySignals: BriefSignal[]; elementSignals: BriefSignal[];
    motion: { availableSourceSlugs: string[]; libraries: BriefSignal[]; renderers: BriefSignal[]; scrollModels: BriefSignal[]; interactionSignals: BriefSignal[]; easings: BriefSignal[]; durationRange: { p25: number; median: number; p75: number; sourceSlugs: string[] } | null; };
    structure?: { availableSourceSlugs: string[]; bandCounts: Array<{ slug: string; count: number }>; repeatedTags: BriefSignal[]; };
    buildConstraints: string[]; limitations: string[];
  };
}

const token = (s: string): string => s.trim().toLowerCase();
const hex = (s: string): string => /^#[\da-f]{6}$/i.test(s.trim()) ? s.trim().toUpperCase() : token(s);
const isCapturedStructure = (source: DesignBriefSource): boolean => source.structureStatus === "captured" && source.structure !== null;

function signals(rows: Array<{ slug: string; values: string[] }>): BriefSignal[] {
  const byValue = new Map<string, Set<string>>();
  for (const { slug, values } of rows) for (const raw of new Set(values.map(token).filter(Boolean))) {
    if (!byValue.has(raw)) byValue.set(raw, new Set());
    byValue.get(raw)!.add(slug);
  }
  return [...byValue].map(([value, slugs]) => ({ value, display: value, frequency: slugs.size, sourceSlugs: [...slugs].sort() }))
    .sort((a, b) => b.frequency - a.frequency || a.value.localeCompare(b.value) || a.sourceSlugs.join(",").localeCompare(b.sourceSlugs.join(",")));
}

function luminance(color: string): number {
  const channels = color.slice(1).match(/.{2}/g)!.map((part) => parseInt(part, 16) / 255).map((c) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function createDesignBrief(input: DesignBriefInput, sources: DesignBriefSource[]): DesignBrief {
  const usable = sources.filter((s) => s.detail !== null);
  const capturedStructures = sources.filter(isCapturedStructure);
  const threshold = usable.length === 2 ? 2 : usable.length >= 3 ? Math.ceil(usable.length / 2) : Infinity;
  const categoryRows = (key: "technologies" | "elements") => usable.map((s) => ({ slug: s.slug, values: s.detail![key].map(token).filter(Boolean) }));
  const tech = signals(categoryRows("technologies"));
  const elements = signals(categoryRows("elements"));
  const palette = signals(usable.map((s) => ({ slug: s.slug, values: s.detail!.palette.map(hex).filter((x) => /^#[\da-f]{6}$/i.test(x)) })))
    .map((s) => ({ ...s, value: s.value.toUpperCase(), display: s.value.toUpperCase(), luminanceBand: luminance(s.value) >= 0.7 ? "light" as const : luminance(s.value) <= 0.3 ? "dark" as const : "mid" as const }))
    .sort((a, b) => b.frequency - a.frequency || a.value.localeCompare(b.value) || a.sourceSlugs.join(",").localeCompare(b.sourceSlugs.join(",")));
  const categories = [...tech.map((s) => ({ ...s, value: `technology:${s.value}` })), ...elements.map((s) => ({ ...s, value: `element:${s.value}` })), ...palette.map((s) => ({ ...s, value: `palette:${s.value}` }))];
  const sharedPatterns = categories.filter((s) => s.frequency >= threshold).sort((a,b) => b.frequency-a.frequency || a.value.localeCompare(b.value) || a.sourceSlugs.join(",").localeCompare(b.sourceSlugs.join(",")));
  const outliers = categories.filter((s) => usable.length >= 2 && s.frequency === 1).sort((a,b) => a.value.localeCompare(b.value));
  const motions = sources.filter((s): s is DesignBriefSource & { motion: MotionDna } => s.motion !== null);
  const motionSignals = (values: (m: MotionDna) => string[]) => signals(motions.map((s) => ({ slug: s.slug, values: values(s.motion) })));
  const durationRows = motions.flatMap((s) => s.motion.durationVocab ? [{ slug: s.slug, ...s.motion.durationVocab }] : []);
  const durationRange = durationRows.length ? {
    p25: Math.round(durationRows.reduce((n, x) => n + x.p25, 0) / durationRows.length),
    median: Math.round(durationRows.reduce((n, x) => n + x.median, 0) / durationRows.length),
    p75: Math.round(durationRows.reduce((n, x) => n + x.p75, 0) / durationRows.length),
    sourceSlugs: durationRows.map((x) => x.slug).sort(),
  } : null;
  const constraints = [...new Set((input.constraints ?? []).map((c) => c.trim()).filter(Boolean))];
  const renderers = motionSignals((m) => m.stack.render);
  const buildConstraints = constraints.length ? constraints.map((c) => `Honor constraint: ${c}`) : ["Keep the implementation grounded in the observed evidence; do not copy a single source."];
  if (constraints.some((c) => /webgl/i.test(c)) && renderers.some((s) => s.value === "webgl")) buildConstraints.push("Avoid observed WebGL rendering where the stated constraint requires it; retain WebGL in the evidence above.");
  const limitations = sources.flatMap((s) => [
    ...(s.detail === null ? [`${s.slug}: detail unavailable`] : []),
    ...(s.motion === null ? [`${s.slug}: cached motion unavailable`] : []),
    ...(input.includeStructure && !isCapturedStructure(s) ? [`${s.slug}: requested structure unavailable`] : []),
  ]);
  const brief: DesignBrief = {
    version: 1, goal: input.goal.trim(), ...(input.audience?.trim() ? { audience: input.audience.trim() } : {}), constraints,
    sources: sources.map((s) => ({ slug: s.slug, title: s.title, evidence: { detail: s.detail === null ? "unavailable" : s.detailStatus, motion: s.motion ? "cached" : "unavailable", elements: s.detail ? "cached" : "unavailable", structure: input.includeStructure ? s.structureStatus : "not_requested" } })),
    direction: {
      summary: `For ${input.goal.trim()}${input.audience?.trim() ? ` for ${input.audience.trim()}` : ""}, draw on the observed evidence without copying a single source.`,
      sharedPatterns, outliers, palette, technologySignals: tech, elementSignals: elements,
      motion: { availableSourceSlugs: motions.map((s) => s.slug), libraries: motionSignals((m) => m.stack.libs), renderers, scrollModels: motionSignals((m) => m.stack.scrollModel === "unknown" ? [] : [m.stack.scrollModel]), interactionSignals: motionSignals((m) => [...(m.scroll.pinCount > 0 ? ["pinned-sections"] : []), ...(m.scroll.scrubCount > 0 ? ["scrubbed-scroll"] : [])]), easings: motionSignals((m) => m.easingVocab.map((e) => e.token)), durationRange },
      ...(input.includeStructure ? { structure: { availableSourceSlugs: capturedStructures.map((s) => s.slug), bandCounts: capturedStructures.map((s) => ({ slug: s.slug, count: s.structure!.bands.length })).sort((a, b) => a.slug.localeCompare(b.slug)), repeatedTags: signals(capturedStructures.map((s) => ({ slug: s.slug, values: s.structure!.bands.map((b) => b.tag).filter(Boolean) }))) } } : {}),
      buildConstraints, limitations,
    },
  };
  return brief;
}

function lines(signals: BriefSignal[], total: number): string {
  return signals.length ? signals.map((s) => `- ${s.display} — ${s.frequency}/${total} (${s.sourceSlugs.map((slug) => `\`${slug}\``).join(", ")})`).join("\n") : "- None";
}

export function renderDesignBrief(brief: DesignBrief): string {
  const d = brief.direction;
  const sections = [
    `# Design brief\n\n## Direction\n${d.summary}`,
    `## Shared signals\n${lines(d.sharedPatterns, brief.sources.length)}`,
    `## Deliberate outliers\n${lines(d.outliers, brief.sources.length)}`,
    `## Palette and technology signals\n${lines([...d.palette, ...d.technologySignals, ...d.elementSignals], brief.sources.length)}`,
    `## Motion model\n${lines([...d.motion.libraries, ...d.motion.renderers, ...d.motion.scrollModels, ...d.motion.interactionSignals, ...d.motion.easings], brief.sources.length)}${d.motion.durationRange ? `\n- Duration p25/median/p75: ${d.motion.durationRange.p25}/${d.motion.durationRange.median}/${d.motion.durationRange.p75} (${d.motion.durationRange.sourceSlugs.map((slug) => `\`${slug}\``).join(", ")})` : ""}`,
    ...(d.structure ? [`## Optional structure findings\n${lines(d.structure.repeatedTags, brief.sources.length)}\n${d.structure.bandCounts.map((b) => `- \`${b.slug}\`: ${b.count} bands`).join("\n")}`] : []),
    `## Build constraints\n${d.buildConstraints.map((c) => `- ${c}`).join("\n")}`,
    `## Evidence and limitations\n${brief.sources.map((s) => `- \`${s.slug}\`: detail ${s.evidence.detail}, motion ${s.evidence.motion}, elements ${s.evidence.elements}, structure ${s.evidence.structure}`).join("\n")}${d.limitations.length ? `\n${d.limitations.map((l) => `- ${l}`).join("\n")}` : ""}`,
    `## JSON\n\`\`\`json\n${JSON.stringify(brief, null, 2)}\n\`\`\``,
  ];
  return sections.join("\n\n") + "\n";
}
