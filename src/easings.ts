// GSAP preset easing → cubic-bezier equivalents (Penner-family values per
// easings.net conventions). Approximations are intentional and only serve
// vocabulary aggregation ("what curves do winners favor?"), not frame-exact
// reproduction — that's what the raw token is for. bounce/elastic/steps/
// CustomEase have no single-curve cubic-bezier equivalent → "unknown".
const GSAP_BEZIERS: Record<string, [number, number, number, number]> = {
  // power1 = quad
  "power1.in": [0.55, 0.085, 0.68, 0.53],
  "power1.out": [0.25, 0.46, 0.45, 0.94],
  "power1.inout": [0.455, 0.03, 0.515, 0.955],
  // power2 = cubic
  "power2.in": [0.6, 0.04, 0.98, 0.335],
  "power2.out": [0.215, 0.61, 0.355, 1],
  "power2.inout": [0.645, 0.045, 0.355, 1],
  // power3 = quart
  "power3.in": [0.895, 0.03, 0.685, 0.22],
  "power3.out": [0.165, 0.84, 0.44, 1],
  "power3.inout": [0.77, 0, 0.175, 1],
  // power4 = quint
  "power4.in": [0.755, 0.05, 0.855, 0.06],
  "power4.out": [0.23, 1, 0.32, 1],
  "power4.inout": [0.86, 0, 0.07, 1],
  // sine
  "sine.in": [0.12, 0, 0.39, 0],
  "sine.out": [0.61, 1, 0.88, 1],
  "sine.inout": [0.37, 0, 0.63, 1],
  // expo
  "expo.in": [0.95, 0.05, 0.795, 0.035],
  "expo.out": [0.19, 1, 0.22, 1],
  "expo.inout": [1, 0, 0, 1],
};

export type NormalizedEasing =
  | { kind: "bezier"; value: [number, number, number, number] }
  | { kind: "named"; value: string }
  | { kind: "unknown"; value: string };

export function normalizeEasing(token: string): NormalizedEasing {
  const t = token.trim();
  const css = t.match(/^cubic-bezier\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i);
  if (css) return { kind: "bezier", value: [Number(css[1]), Number(css[2]), Number(css[3]), Number(css[4])] };
  const key = t.toLowerCase();
  if (GSAP_BEZIERS[key]) return { kind: "bezier", value: GSAP_BEZIERS[key] };
  // quad/cubic/quart/quint are the same curves under Penner's names.
  // Table keys are lowercase (incl. "inout") so lookup is case-insensitive.
  const alias = key.replace(/^quad/, "power1").replace(/^cubic/, "power2")
    .replace(/^quart/, "power3").replace(/^quint/, "power4");
  if (GSAP_BEZIERS[alias]) return { kind: "bezier", value: GSAP_BEZIERS[alias] };
  // CSS keyword easings are honest named curves.
  if (["linear", "ease", "ease-in", "ease-out", "ease-in-out"].includes(key)) {
    return { kind: "named", value: key };
  }
  return { kind: "unknown", value: t };
}

export function quartiles(nums: number[]): { p25: number; median: number; p75: number } | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const q = (p: number) => {
    const i = p * (s.length - 1);
    const lo = Math.floor(i), hi = Math.ceil(i);
    return s[lo] + (s[hi] - s[lo]) * (i - lo);
  };
  return { p25: q(0.25), median: q(0.5), p75: q(0.75) };
}
