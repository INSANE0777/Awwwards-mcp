// One evidence-coverage contract for the v1.14 comparison surfaces.
// Truth table is binding (design §4.5): unknown on error or a collection that
// produced nothing when there was something to collect; partial when evidence
// was excluded, a limitation applies, or fewer items were collected than seen.
export interface EvidenceCoverage {
  status: "complete" | "partial" | "unknown";
  collected: number;
  excluded: number;
  limitations: string[];
}

export function coverageFrom(input: {
  collected: number;
  excluded: number;
  total?: number;
  error?: string;
  limitations?: string[];
}): EvidenceCoverage {
  const { collected, excluded, total, error } = input;
  const limitations = [...(input.limitations ?? [])];
  const missedSome = total !== undefined && collected < total;

  const status = error || (total !== undefined && total > 0 && collected === 0)
    ? "unknown"
    : excluded > 0 || limitations.length > 0 || missedSome
      ? "partial"
      : "complete";

  return { status, collected, excluded, limitations };
}
