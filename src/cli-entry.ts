// Entry-point detection shared by the bin wrappers. npm installs a bin as an
// extensionless symlink/alias (node_modules/.bin/awwwards-verify), so a
// basename check against the compiled filename silently misses it. Compare
// real paths and fall back to the advertised aliases for hardlinks/copies.
import { realpathSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function isCliEntry(
  metaUrl: string,
  argv1: string | undefined,
  aliases: readonly string[],
): boolean {
  if (!argv1) return false;
  const self = fileURLToPath(metaUrl);
  try {
    if (realpathSync(resolve(argv1)) === realpathSync(self)) return true;
  } catch {
    // argv[1] vanished before load; the alias check below still applies.
  }
  return aliases.includes(basename(argv1));
}
