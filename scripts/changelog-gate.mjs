// Reads CHANGELOG.md from the working directory. --check requires an exact
// "## v<version> - " heading; --body prints that section up to the next
// "## v" heading. Runs before npm ci, so it uses only Node built-ins.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function findSection(text, version) {
  const value = String(version ?? "").trim().replace(/^v/, "");
  if (!/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(value)) {
    throw new Error(`invalid version: ${version}`);
  }
  const heading = `## v${value} - `;
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(heading));
  if (start === -1) {
    return null;
  }
  let end = start + 1;
  while (end < lines.length && !lines[end].startsWith("## v")) {
    end += 1;
  }
  return lines.slice(start + 1, end).join("\n").trim();
}

function main() {
  const args = process.argv.slice(2);
  const flags = args.filter((arg) => arg.startsWith("--"));
  const version = args.find((arg) => !arg.startsWith("--"));
  const mode = flags.length === 1 ? flags[0] : "";
  if (!version || (mode !== "--check" && mode !== "--body")) {
    console.error("usage: node scripts/changelog-gate.mjs <version> --check|--body");
    process.exit(2);
  }

  let section;
  try {
    section = findSection(readFileSync("CHANGELOG.md", "utf8"), version);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  if (section === null) {
    console.error(`CHANGELOG.md has no "## v${version.replace(/^v/, "")} - " section`);
    process.exit(1);
  }

  if (section === "") {
    console.error(`CHANGELOG.md has an empty "## v${version.replace(/^v/, "")} - " section`);
    process.exit(1);
  }

  if (mode === "--check") {
    console.error(`CHANGELOG.md has the v${version.replace(/^v/, "")} section`);
    return;
  }
  process.stdout.write(`${section}\n`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
