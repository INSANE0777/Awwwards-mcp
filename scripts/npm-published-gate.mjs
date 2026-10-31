// Registry gate: decides from the npm registry document whether this version
// is already published and which tarball integrity it has. Runs before npm ci,
// so it uses only Node built-ins. Any registry error fails closed.
import { pathToFileURL } from "node:url";
import { emitOutputs } from "./release-output.mjs";
import { isSRI } from "./release-integrity.mjs";

const DEFAULT_REGISTRY_URL = "https://registry.npmjs.org/awwwards-mcp";

export function classifyRegistryDoc(doc, version) {
  const value = String(version ?? "").trim();
  if (!/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(value)) {
    throw new Error(`invalid version: ${version}`);
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error("registry document is not an object");
  }
  const versions = doc.versions;
  if (versions === null || typeof versions !== "object" || Array.isArray(versions)) {
    throw new Error('registry document has no "versions" map');
  }
  if (!Object.prototype.hasOwnProperty.call(versions, value)) {
    return { published: false };
  }
  const integrity = versions[value]?.dist?.integrity;
  if (typeof integrity !== "string" || integrity.trim() === "") {
    throw new Error(`registry entry for ${value} has no dist.integrity`);
  }
  const sri = integrity.trim();
  if (!isSRI(sri)) {
    throw new Error(`registry entry for ${value} has malformed dist.integrity`);
  }
  return { published: true, integrity: sri };
}

async function main() {
  const version = (process.argv[2] ?? "").trim();
  if (!version) {
    console.error("usage: node scripts/npm-published-gate.mjs <version>");
    process.exit(2);
  }

  const url = process.env.NPM_REGISTRY_URL || DEFAULT_REGISTRY_URL;
  const timeoutMs = Number(process.env.NPM_REGISTRY_TIMEOUT_MS ?? 30_000);
  let response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    console.error(`registry request failed: ${error.message}`);
    process.exit(1);
  }
  if (response.status !== 200) {
    console.error(`registry returned HTTP ${response.status} for ${url}`);
    process.exit(1);
  }

  let doc;
  try {
    doc = await response.json();
  } catch (error) {
    console.error(`registry returned invalid JSON: ${error.message}`);
    process.exit(1);
  }

  let result;
  try {
    result = classifyRegistryDoc(doc, version);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  if (result.published) {
    emitOutputs([
      ["published", "true"],
      ["integrity", result.integrity],
    ]);
    console.error(`awwwards-mcp@${version} is already on npm`);
  } else {
    emitOutputs([["published", "false"]]);
    console.error(`awwwards-mcp@${version} is not on npm`);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
