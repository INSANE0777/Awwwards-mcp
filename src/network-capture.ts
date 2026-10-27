// Offline HAR 1.2 API-surface extractor. Reads a local capture file, never
// fetches a recorded URL, and returns request groups only: no bodies, headers,
// cookies or query values. Bounds are part of the contract: 50 MB before read,
// 2000 entries, redacted/templated path segments, capped list fields.
import { readFile, stat } from "node:fs/promises";
import { coverageFrom, type EvidenceCoverage } from "./coverage.js";

export const MAX_HAR_BYTES = 50 * 1024 * 1024;
export const MAX_ENTRIES = 2000;
const DEFAULT_TOP = 50;
const MAX_TOP = 200;
const MAX_LIST = 20; // contentTypes / queryNames cap
const MAX_TEMPLATE = 200;

export interface NetworkCaptureGroup {
  method: string;
  origin: string;
  pathTemplate: string;
  count: number;
  statuses: number[];
  contentTypes: string[];
  queryNames: string[];
}

export interface NetworkCaptureResult {
  file: string;
  evidenceCoverage: EvidenceCoverage;
  groups: NetworkCaptureGroup[];
  templatedGroups: number;
  note: string;
}

const NOTE =
  "Offline HAR 1.2 API surface only: request/response bodies, headers, cookies and query values are never read or returned; recorded URLs are never fetched.";

type JsonObject = Record<string, unknown>;
const isObject = (v: unknown): v is JsonObject =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_RE = /^[0-9a-f]{32,}$/i;

// First matching rule wins, in the binding order (design §4.1).
const TEMPLATE_RULES: [RegExp, string][] = [
  [/^\d{4}-\d{2}-\d{2}(?:[T ][\d:.+-]+Z?)?$/, "{date}"],
  [/^v\d+$/, "{version}"],
  [UUID_RE, "{uuid}"],
  [HEX_RE, "{hex}"],
  [/^\d+$/, "{id}"],
];

function templateSegment(raw: string): string {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Malformed percent escape: check the raw segment instead.
  }
  // UUID/hex ids are longer than the 24-char redaction threshold by
  // definition, so those two structured shapes win over the length rule;
  // everything else long/high-entropy is redacted before templating.
  const structuredId = UUID_RE.test(decoded) || HEX_RE.test(decoded);
  if (
    decoded.includes("@") ||
    decoded.includes("=") ||
    decoded.includes("...") ||
    (!structuredId && decoded.length > 24)
  ) {
    return "{redacted}";
  }
  for (const [re, token] of TEMPLATE_RULES) if (re.test(decoded)) return token;
  return raw; // keep the original encoding (e.g. %2F stays one segment)
}

function pathTemplate(pathname: string): string {
  return pathname.split("/").map(templateSegment).join("/").slice(0, MAX_TEMPLATE);
}

const sortedDistinct = (values: string[]): string[] =>
  [...new Set(values)].sort(cmp).slice(0, MAX_LIST);

interface Accumulator {
  method: string;
  origin: string;
  template: string;
  templated: boolean;
  count: number;
  statuses: Set<number>;
  contentTypes: Set<string>;
  queryNames: Set<string>;
}

export async function analyzeNetworkCapture(
  path: string,
  opts?: { top?: number },
): Promise<NetworkCaptureResult | { error: string }> {
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    return { error: "cannot read HAR file" };
  }
  if (size > MAX_HAR_BYTES) return { error: "HAR file exceeds the 50 MB cap" };

  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return { error: "cannot read HAR file" };
  }

  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return { error: "not a HAR 1.2 file" };
  }
  if (!isObject(doc) || !isObject(doc.log) || !Array.isArray(doc.log.entries)) {
    return { error: "not a HAR 1.2 file" };
  }

  const entries = doc.log.entries as unknown[];
  const scanned = entries.slice(0, MAX_ENTRIES);
  const beyondCap = entries.length - scanned.length;
  const groups = new Map<string, Accumulator>();
  let invalid = 0;

  for (const entry of scanned) {
    if (!isObject(entry) || !isObject(entry.request) || typeof entry.request.url !== "string") {
      invalid++;
      continue;
    }
    let url: URL;
    try {
      url = new URL(entry.request.url);
    } catch {
      invalid++;
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      invalid++;
      continue;
    }

    const method = typeof entry.request.method === "string"
      ? entry.request.method.toUpperCase()
      : "";
    const template = pathTemplate(url.pathname);
    const key = JSON.stringify([method, url.origin, template]);
    let acc = groups.get(key);
    if (!acc) {
      acc = {
        method,
        origin: url.origin,
        template,
        templated: template !== url.pathname,
        count: 0,
        statuses: new Set(),
        contentTypes: new Set(),
        queryNames: new Set(),
      };
      groups.set(key, acc);
    }
    acc.count++;

    const response = isObject(entry.response) ? entry.response : undefined;
    if (response && typeof response.status === "number" && Number.isFinite(response.status)) {
      acc.statuses.add(response.status);
    }
    const content = response && isObject(response.content) ? response.content : undefined;
    if (content && typeof content.mimeType === "string") {
      const essence = content.mimeType.split(";")[0].trim().toLowerCase();
      if (essence) acc.contentTypes.add(essence);
    }
    for (const name of url.searchParams.keys()) acc.queryNames.add(name);
  }

  const ordered = [...groups.values()]
    .map((acc) => ({
      templated: acc.templated,
      group: {
        method: acc.method,
        origin: acc.origin,
        pathTemplate: acc.template,
        count: acc.count,
        statuses: [...acc.statuses].sort((a, b) => a - b),
        contentTypes: sortedDistinct([...acc.contentTypes]),
        queryNames: sortedDistinct([...acc.queryNames]),
      } satisfies NetworkCaptureGroup,
    }))
    .sort(
      (a, b) =>
        b.group.count - a.group.count ||
        cmp(a.group.method, b.group.method) ||
        cmp(a.group.origin, b.group.origin) ||
        cmp(a.group.pathTemplate, b.group.pathTemplate),
    );

  const requestedTop = opts?.top;
  const top = typeof requestedTop === "number" && Number.isFinite(requestedTop)
    ? Math.min(Math.max(Math.trunc(requestedTop), 1), MAX_TOP)
    : DEFAULT_TOP;
  const shown = ordered.slice(0, top);

  const limitations: string[] = [];
  if (beyondCap > 0) limitations.push(`only the first ${MAX_ENTRIES} entries were analyzed`);
  if (invalid > 0) limitations.push(`${invalid} invalid entries were excluded`);

  return {
    file: path,
    evidenceCoverage: coverageFrom({
      collected: scanned.length - invalid,
      excluded: invalid + beyondCap,
      total: entries.length,
      limitations,
    }),
    groups: shown.map((item) => item.group),
    templatedGroups: shown.filter((item) => item.templated).length,
    note: NOTE,
  };
}
