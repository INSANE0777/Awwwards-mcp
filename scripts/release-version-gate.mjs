// Release gate: the tag, package.json and both package-lock.json version
// fields must name the same release. Runs before npm ci, so no dependencies.
import { readFileSync } from "node:fs";

const tag = (process.argv[2] ?? "").replace(/^v/, "");
if (!tag) {
  console.error("usage: node scripts/release-version-gate.mjs <tag, e.g. v1.16.0>");
  process.exit(2);
}

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const sources = [
  ["package.json version", pkg.version],
  ["package-lock.json version", lock.version],
  ['package-lock.json packages[""] version', lock.packages?.[""]?.version],
];

const mismatches = sources.filter(([, version]) => version !== tag);
if (mismatches.length > 0) {
  const detail = mismatches.map(([name, version]) => `${name}=${version ?? "missing"}`).join(", ");
  console.error(`release tag v${tag} disagrees with ${detail}`);
  process.exit(1);
}
console.log(`release tag v${tag} matches package.json and package-lock.json`);
