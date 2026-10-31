// Verifies that the tarball packed from this checkout is byte-identical to the
// artifact already on npm. A mismatch means the tag does not describe what is
// published, so the release must stop.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { extractArtifact } from "./release-artifact.mjs";
import { isSRI } from "./release-integrity.mjs";

export function verifyArtifact(localIntegrity, registryIntegrity) {
  const local = typeof localIntegrity === "string" ? localIntegrity.trim() : "";
  const registry = typeof registryIntegrity === "string" ? registryIntegrity.trim() : "";
  if (!isSRI(local)) {
    throw new Error(`local pack integrity is malformed: ${local || "missing"}`);
  }
  if (!isSRI(registry)) {
    throw new Error(`registry integrity is malformed: ${registry || "missing"}`);
  }
  if (local !== registry) {
    throw new Error(`packed tarball integrity ${local} does not match registry ${registry}`);
  }
}

function main() {
  const [packPath, registryIntegrity] = process.argv.slice(2);
  if (!packPath || !registryIntegrity) {
    console.error("usage: node scripts/verify-published-artifact.mjs <pack.json> <registry-integrity>");
    process.exit(2);
  }

  try {
    const { integrity } = extractArtifact(JSON.parse(readFileSync(packPath, "utf8")));
    verifyArtifact(integrity, registryIntegrity);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  console.error("packed tarball matches the published registry artifact");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
