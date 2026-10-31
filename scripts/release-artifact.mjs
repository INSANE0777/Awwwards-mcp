// Turns `npm pack --json` output into the filename and integrity that the
// publish and verification steps must use. Exactly one packed entry is valid.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { emitOutputs } from "./release-output.mjs";

export function extractArtifact(packJson) {
  if (!Array.isArray(packJson)) {
    throw new Error("npm pack output is not an array");
  }
  if (packJson.length !== 1) {
    throw new Error(`npm pack produced ${packJson.length} entries; expected exactly one`);
  }
  const entry = packJson[0];
  const filename = entry?.filename;
  const integrity = entry?.integrity;
  if (typeof filename !== "string" || filename.trim() === "") {
    throw new Error("npm pack entry has no filename");
  }
  if (typeof integrity !== "string" || integrity.trim() === "") {
    throw new Error("npm pack entry has no integrity");
  }
  return { filename: filename.trim(), integrity: integrity.trim() };
}

function main() {
  const packPath = process.argv[2];
  if (!packPath) {
    console.error("usage: node scripts/release-artifact.mjs <pack.json>");
    process.exit(2);
  }

  let artifact;
  try {
    artifact = extractArtifact(JSON.parse(readFileSync(packPath, "utf8")));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  emitOutputs([
    ["filename", artifact.filename],
    ["integrity", artifact.integrity],
  ]);
  console.error(`release artifact is ${artifact.filename}`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
