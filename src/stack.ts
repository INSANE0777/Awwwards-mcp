// Stack fingerprint: detect framework, CSS framework, and JS libs from
// fetched HTML. Marker-based (each marker is an exact substring test),
// honest confidence, pure string ops. buildStack output is deterministic
// (no timestamps) so downstream consumers can pin byte-equality on it.
// Ported from the agensi-kit fingerprint tool (MIT).

export const STACK_ID = "stack-fingerprint-v1";

// Marker tables. Order is precedence: the first framework with ≥1 marker wins.
const FRAMEWORK_MARKERS: Record<string, string[]> = {
  next: ["_next/static", "__NEXT_DATA__", "/_next/"],
  astro: ["astro-island", "data-astro-cid", "astro:"],
  nuxt: ["__NUXT__", "data-v-", "/_nuxt/"],
  remix: ["__remixContext", "remix-run"],
  sveltekit: ["__sveltekit", "data-sveltekit"],
  wordpress: ["wp-content", "wp-includes"],
  webflow: ["webflow.js", "w-nav", "w-container"],
  framer: ["framerusercontent", "framer.com/mixin"],
};
const BOOTSTRAP_MARKERS = ["btn-", "col-md-", "navbar-"];
// Utility-density pattern for Tailwind, counted ONLY over class-attribute
// values (prose mentioning "flex" must not count). Fresh RegExp per call so
// lastIndex can never leak between runs.
const UTILITY_SRC = "(?:flex|grid|bg-[a-z]+|text-\\[(?:#|rgb))[\\w[\\]#-]*";
const CLASS_ATTR_SRC = "class\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')";

const confidenceFor = (n: number): "high" | "medium" | "low" =>
  n >= 2 ? "high" : n === 1 ? "medium" : "low";

export type FrameworkMatch = {
  framework: string;
  markers: string[];
  confidence: "high" | "medium" | "low";
};

export type CssMatch = {
  css: string;
  markers: string[];
  confidence: "high" | "medium" | "low";
};

export type StackFingerprint = {
  id: "stack-fingerprint-v1";
  framework: string;
  frameworkMarkers: string[];
  frameworkConfidence: "high" | "medium" | "low";
  css: string;
  cssMarkers: string[];
  cssConfidence: "high" | "medium" | "low";
  libs: string[];
};

export function detectFramework(html: string): FrameworkMatch {
  for (const [framework, markers] of Object.entries(FRAMEWORK_MARKERS)) {
    const found = markers.filter((m) => html.includes(m));
    if (found.length) return { framework, markers: found, confidence: confidenceFor(found.length) };
  }
  return { framework: "static", markers: [], confidence: "low" };
}

export function detectCss(html: string, framework: string = detectFramework(html).framework): CssMatch {
  let count = 0;
  const markers: string[] = [];
  const seen = new Set<string>();
  for (const attr of html.matchAll(new RegExp(CLASS_ATTR_SRC, "g"))) {
    for (const t of (attr[1] ?? attr[2] ?? "").matchAll(new RegExp(UTILITY_SRC, "g"))) {
      count++;
      if (!seen.has(t[0])) { seen.add(t[0]); markers.push(t[0]); }
    }
  }
  const bs = BOOTSTRAP_MARKERS.filter((m) => html.includes(m));
  // Webflow arbitration: Webflow's own functional classes (w-nav, w-*) fool
  // utility density counting — both dogfoods misread a Webflow page as
  // Tailwind "high". On Webflow pages the bar doubles (>=16 medium, >=32
  // high) and Tailwind confidence caps at medium even when the count clears it.
  const onWebflow = framework === "webflow";
  if (count >= (onWebflow ? 32 : 8)) return { css: "tailwind", markers, confidence: onWebflow ? "medium" : "high" };
  if (bs.length >= 2) return { css: "bootstrap", markers: bs, confidence: "high" };
  if (count >= (onWebflow ? 16 : 3)) return { css: "tailwind", markers, confidence: "medium" };
  if (bs.length === 1) return { css: "bootstrap", markers: bs, confidence: "medium" };
  return { css: "custom", markers: [], confidence: "low" };
}

export function collectLibs(motionDna: unknown): string[] {
  const stack = (motionDna as { stack?: { libs?: unknown[]; render?: unknown[] } } | null | undefined)?.stack ?? {};
  const out: string[] = [];
  for (const lib of [...(stack.libs ?? []), ...(stack.render ?? [])]) {
    const name = String(lib).toLowerCase();
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

export function buildStack(input: { html?: string; motionDna?: unknown } = {}): StackFingerprint {
  const page = String(input.html ?? "");
  const fw = detectFramework(page);
  const css = detectCss(page, fw.framework);
  return {
    id: STACK_ID,
    framework: fw.framework,
    frameworkMarkers: fw.markers,
    frameworkConfidence: fw.confidence,
    css: css.css,
    cssMarkers: css.markers,
    cssConfidence: css.confidence,
    libs: collectLibs(input.motionDna),
  };
}

// One polite fetch: neutral UA, bounded by an AbortController timer so a hung
// origin cannot wedge a tool call. Errors never throw — they surface as
// { error } so the MCP tool layer can render them as clean isError responses.
export async function analyzeStack(
  url: string,
  opts?: { timeoutMs?: number; fetchFn?: typeof fetch },
): Promise<StackFingerprint | { error: string }> {
  const fetchFn = opts?.fetchFn ?? fetch;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts?.timeoutMs ?? 15000);
  try {
    const res = await fetchFn(url, {
      headers: { "user-agent": "stack-fingerprint/1.0 (research tooling)" },
      signal: ac.signal,
    });
    if (!res.ok) return { error: `HTTP ${res.status} fetching ${url}` };
    const html = await res.text();
    return buildStack({ html });
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}
