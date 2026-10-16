// Pure verify-build layer: motion fingerprinting, band comparison, verdict.
// Zero imports (mirrors easings.ts) so tests and later server.ts wiring can
// pull this in without Playwright or node deps. The fingerprint string is the
// ONLY interchange format: motionDiffScore re-parses it, so caller and
// verifier don't need to share an object type.

export interface MotionCensusInput {
  counts: Record<string, number>;
  anims: { easing: string | null; scrub: boolean; pin: boolean }[];
  nativeScrollTimelines: number;
  /** Pre-aggregated easing vocabulary; falls back to anims' easings. */
  easingTokens?: string[];
}

export interface BandRow {
  label: string;
  bg: string | null;
  tag: string;
}

export interface VerifyReport {
  buildUrl: string;
  referenceUrl: string;
  bands: { score: number; matched: string[]; refOnly: string[]; buildOnly: string[] };
  motion: { score: number; refFingerprint: string; buildFingerprint: string };
  overall: number;
  verdict: "pass" | "warn" | "fail";
  evidence: string[];
}

// Fixed order = positional tr tokens ("g3" = 3 gsap-scrolltrigger anims);
// "unknown" is deliberately excluded — it means "couldn't classify".
const TRIGGER_KEYS = [
  "gsap-scrolltrigger",
  "css-scroll-timeline",
  "css-view-timeline",
  "data-attr",
  "css-keyframe",
  "smil",
] as const;
const TRIGGER_PREFIX: Record<(typeof TRIGGER_KEYS)[number], string> = {
  "gsap-scrolltrigger": "g",
  "css-scroll-timeline": "c",
  "css-view-timeline": "v",
  "data-attr": "d",
  "css-keyframe": "k",
  smil: "s",
};

export function motionFingerprint(c: MotionCensusInput): string {
  const tr = TRIGGER_KEYS.map(
    (k) => `${TRIGGER_PREFIX[k]}${c.counts[k] ?? 0}`
  ).join(",");
  const sc = c.anims.filter((a) => a.scrub).length;
  const pin = c.anims.filter((a) => a.pin).length;
  const easings = (c.easingTokens ?? c.anims.map((a) => a.easing))
    .filter((e): e is string => e !== null)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join(",");
  // "k1" is a format version tag so future parsers can bail politely.
  return `k1|tr:${tr}|nat:${c.nativeScrollTimelines}|sc:${sc}|pin:${pin}|e:${easings}`;
}

const jaccard = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
};

export function motionDiffScore(a: string, b: string): number {
  const parse = (fp: string) => {
    const p = { tr: new Set<string>(), nat: 0, sc: 0, pin: 0, e: new Set<string>() };
    for (const seg of fp.split("|")) {
      const i = seg.indexOf(":");
      if (i < 0) continue; // the "k1" version tag
      const key = seg.slice(0, i);
      const val = seg.slice(i + 1);
      if (key === "tr") {
        for (const t of val.split(",")) if (t) p.tr.add(t);
      } else if (key === "nat") {
        p.nat = Number(val) || 0;
      } else if (key === "sc") {
        p.sc = Number(val) || 0;
      } else if (key === "pin") {
        p.pin = Number(val) || 0;
      } else if (key === "e") {
        for (const t of val.split(",")) if (t) p.e.add(t);
      }
    }
    return p;
  };
  const pa = parse(a), pb = parse(b);
  const trJ = jaccard(pa.tr, pb.tr);
  const l1 = Math.abs(pa.sc - pb.sc) + Math.abs(pa.pin - pb.pin);
  const eJ = jaccard(pa.e, pb.e);
  const natD = Math.abs(pa.nat - pb.nat);
  const score =
    0.30 * trJ +
    0.20 * (1 - Math.min(1, l1 / 8)) +
    0.35 * eJ +
    0.15 * (1 - Math.min(1, natD / 10));
  return Math.round(score * 100);
}

const normLabel = (s: string) => s.trim().toLowerCase().slice(0, 24);
const normBg = (s: string | null) => (s ?? "").trim().toLowerCase();

export function compareBands(
  ref: BandRow[],
  build: BandRow[]
): { score: number; matched: string[]; refOnly: string[]; buildOnly: string[] } {
  const pool = build.map((b) => ({
    label: normLabel(b.label),
    bg: normBg(b.bg),
    tag: b.tag,
    used: false,
  }));
  const matched: string[] = [];
  const refOnly: string[] = [];
  // Greedy first match, consuming the build pool so one build band can't
  // absorb several ref bands.
  for (const r of ref) {
    const rl = normLabel(r.label);
    const rb = normBg(r.bg);
    const hit = pool.find(
      (b) =>
        !b.used &&
        (b.label === rl || (b.bg !== "" && b.bg === rb && b.tag === r.tag))
    );
    if (hit) {
      hit.used = true;
      matched.push(rl);
    } else {
      refOnly.push(r.label.trim() || "(unlabeled)");
    }
  }
  const buildOnly = pool.filter((b) => !b.used).map((b) => b.label);
  const total = ref.length + build.length;
  const score = total === 0 ? 100 : Math.round((2 * matched.length) / (total) * 100);
  return { score, matched, refOnly, buildOnly };
}

export function verdictFrom(bandScore: number, motionScore: number) {
  const overall = Math.round(0.6 * bandScore + 0.4 * motionScore);
  const verdict: VerifyReport["verdict"] =
    overall >= 80 ? "pass" : overall >= 55 ? "warn" : "fail";
  const evidence = [
    `Bands: ${bandScore}/100 similarity`,
    `Motion: ${motionScore}/100 fingerprint similarity`,
    `Overall: ${overall}/100 → ${verdict.toUpperCase()}`,
  ];
  return { overall, verdict, evidence };
}
