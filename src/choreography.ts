import type { ScrollCensus } from "./census.js";

/** One detected rhythm hint: where the stagger lives and its numeric value. */
export interface ChoreographyHint {
  selector: string;
  /** Steps in ms (delay-delta) or the unitless tween-var stagger, ≤2dp. */
  value: number;
  source: "tween-var" | "delay-delta";
}

/** L4 output distilled from a captured census: stagger hints for rebuilds. */
export interface Choreography {
  hints: ChoreographyHint[];
  groups: number;
}

export const CHOREOGRAPHY_CAP = 20;

// 10ms quantization bucket for delay deltas — absorbs sub-frame jitter
// between captured delays so one stepped sequence reads as one delta value.
const DELTA_BUCKET_MS = 10;

// PURE: reduces a census to ≤20 stagger hints. Two paths, tween-var first:
// (a) every GSAP trigger row whose captured `vars.stagger` parses to a
//     positive number becomes a hint verbatim (registry order preserved;
//     the snippet already bounded each var value to 24 plain chars);
// (b) sibling anims sharing identical props AND duration, with ≥3 members
//     whose consecutive positive delay diffs land ≥2 times in the same
//     10ms bucket, become ONE hint valued at that bucket (≈ the median
//     positive diff to bucket resolution), named after the earliest member.
// No Date, no Math.random, no in-place mutation of the census — output is
// byte-stable for byte-stable input (pinned by a determinism test).
export function choreographyFromCensus(census: ScrollCensus): Choreography {
  const hints: ChoreographyHint[] = [];

  // (a) tween-var path.
  for (const row of census.gsapTriggers ?? []) {
    if (hints.length >= CHOREOGRAPHY_CAP) break;
    if (!row.selector) continue; // a value with no target selector can't be wired
    const v = Number(row.vars?.stagger);
    if (Number.isFinite(v) && v > 0) {
      hints.push({
        selector: row.selector,
        value: Math.round(v * 100) / 100,
        source: "tween-var",
      });
    }
  }

  // (b) delay-delta path — group by props signature + duration.
  const bundles = new Map<string, typeof census.anims>();
  for (const a of census.anims ?? []) {
    if (typeof a.delayMs !== "number" || !Array.isArray(a.props)) continue;
    const key = `${a.props.join("|")}::${a.durationMs}`;
    const list = bundles.get(key);
    if (list) list.push(a);
    else bundles.set(key, [a]);
  }
  for (const members of bundles.values()) {
    if (hints.length >= CHOREOGRAPHY_CAP) break;
    if (members.length < 3) continue;
    const sorted = [...members].sort((a, b) => (a.delayMs as number) - (b.delayMs as number));
    const buckets = new Map<number, number>();
    for (let i = 1; i < sorted.length; i++) {
      const d = (sorted[i].delayMs as number) - (sorted[i - 1].delayMs as number);
      if (d <= 0) continue;
      const bucket = Math.round(d / DELTA_BUCKET_MS) * DELTA_BUCKET_MS;
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
    }
    for (const [bucket, hits] of buckets) {
      if (hits >= 2) {
        hints.push({
          selector: `${sorted[0].selector} (+${members.length - 1} siblings)`,
          value: bucket,
          source: "delay-delta",
        });
        break; // one hint per bundle: the first bucket reaching ≥2 diffs
      }
    }
  }

  return { hints, groups: hints.length };
}
