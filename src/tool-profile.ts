// Tool registration guard: profile filtering, per-call debug memory lines and
// a response-byte ceiling. Kept out of the server factory so tests can
// exercise it without starting the stdio server.

// The 14 tool core an agent needs for the brief -> capture -> analyze -> build
// -> verify loop, discovery included. AWWWARDS_MCP_PROFILE=core registers only
// these; default full has all 42.
export const CORE_TOOL_NAMES: readonly string[] = [
  "search_sites",
  "get_site_details",
  "analyze_page_structure",
  "analyze_scroll_map",
  "capture_component",
  "verify_build",
  "build_project",
  "get_motion_dna",
  "analyze_stack",
  "capture_live_site",
  "get_annual_categories",
  "get_annual_nominees",
  "get_collections",
  "shortlist_references",
];

export const DEFAULT_MAX_RESPONSE_BYTES = 32_000_000;

// Canonical AWWWARDS_MCP_* names, with the one-release AWARDS_MCP_* fallback
// from v1.14.0. The new value wins even when set to an empty string.
export function envValue(env: NodeJS.ProcessEnv, suffix: string): string | undefined {
  return env[`AWWWARDS_MCP_${suffix}`] ?? env[`AWARDS_MCP_${suffix}`];
}

export function isCoreTool(name: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (envValue(env, "PROFILE") !== "core") return true;
  return CORE_TOOL_NAMES.includes(name);
}

function maxResponseBytes(env: NodeJS.ProcessEnv): number {
  const raw = Number(envValue(env, "MAX_RESPONSE_BYTES"));
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : DEFAULT_MAX_RESPONSE_BYTES;
}

const SERIALIZATION_ERROR_MESSAGE = "Tool result could not be serialized.";

// The full serialized result: text, inline image data and structuredContent.
// isError and other result keys are part of it too, so no field can bypass the
// ceiling by living outside `content`.
function resultBytes(result: unknown): number {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(result);
  } catch {
    throw new Error(SERIALIZATION_ERROR_MESSAGE);
  }
  // JSON.stringify returns undefined for values it cannot represent (for
  // example a function). That is a failed measurement, not a zero-byte result.
  if (serialized === undefined) throw new Error(SERIALIZATION_ERROR_MESSAGE);
  return Buffer.byteLength(serialized, "utf8");
}

const note = (): string =>
  "Response exceeded AWWWARDS_MCP_MAX_RESPONSE_BYTES; narrow the request or raise the limit.";

type ServerLike = {
  registerTool: (...args: any[]) => unknown;
};

// Registers through server.registerTool (v2 has no server.tool). In core
// profile a non-core name is silently skipped. The final function argument
// (the handler) is wrapped: response size is enforced, and
// AWWWARDS_MCP_DEBUG_MEMORY=1 emits one JSON line per call on stderr (never
// stdout — stdout is the JSON-RPC channel).
export function registerGuarded(
  server: ServerLike,
  method: "registerTool",
  args: any[],
  env: NodeJS.ProcessEnv = process.env,
  log: (line: string) => void = (line) => console.error(line),
): void {
  const name = String(args[0]);
  if (!isCoreTool(name, env)) return;

  const last = args.length - 1;
  const handler = args[last];
  if (typeof handler === "function") {
    const limit = maxResponseBytes(env);
    const debugMemory = envValue(env, "DEBUG_MEMORY") === "1";
    args[last] = async (...callArgs: unknown[]) => {
      const started = performance.now();
      try {
        const result = await handler(...callArgs);
        const bytes = resultBytes(result);
        if (bytes > limit) {
          // Truncation discards every original field. Always mark the
          // replacement as an error so an unstructured payload that lost its
          // evidence cannot pass as a successful result. isError also makes
          // the SDK skip output-schema validation, which would otherwise fail
          // on the missing structuredContent.
          //
          // The replacement is a fixed recovery envelope, not payload. It can
          // exceed a deliberately tiny configured limit (a 10-byte limit
          // cannot fit any JSON-RPC result); it is about 200 bytes and stays
          // under 1 KiB for every registered tool name.
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify({ truncated: true, tool: name, bytes, limit, note: note() }),
              },
            ],
          };
        }
        // An isError result must not carry a structured success payload.
        if (result && typeof result === "object") {
          const record = result as Record<string, unknown>;
          if (record.isError === true && record.structuredContent !== undefined) {
            const { structuredContent: _drop, ...rest } = record;
            return rest;
          }
        }
        return result;
      } finally {
        if (debugMemory) {
          const mem = process.memoryUsage();
          log(
            JSON.stringify({
              tool: name,
              durationMs: Math.round(performance.now() - started),
              rss: mem.rss,
              heapUsed: mem.heapUsed,
              heapTotal: mem.heapTotal,
              external: mem.external,
            }),
          );
        }
      }
    };
  }

  server.registerTool(...args);
}
