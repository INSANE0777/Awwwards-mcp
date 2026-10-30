#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { AwwwardsClient } from "./awwwards.js";
import { Cache } from "./cache.js";
import { runIndexer, IndexLockError } from "./indexer.js";

// npm run index              — sites crawl (default)
// The --elements gallery crawl is retired: robots.txt disallows /elements/*.
// new_winners backfills elements from each new winner's own site page.
const elementsRequested = process.argv.some(
  (arg) => arg === "--elements" || arg.startsWith("--elements="),
);
if (elementsRequested) {
  console.error(
    "awwwards-index: --elements is retired — robots.txt disallows /elements/*, so the element gallery crawl is disabled. " +
      "new_winners now backfills elements from each new winner's own site page; cached gallery records stay searchable.",
  );
  process.exit(2);
}

const cacheRoot = process.env.AWWWARDS_CACHE_DIR ?? join(homedir(), ".awwwards-mcp");
let cache: Cache;
try {
  cache = new Cache(cacheRoot);
} catch (err) {
  console.error(`awwwards-index: cannot initialize cache at ${cacheRoot}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

const client = new AwwwardsClient();
try {
  const result = await runIndexer({ client, cache, log: (m) => console.error(m) });
  console.error(
    `awwwards-index: done — ${result.pagesDone} pages crawled, ${result.skipped} skipped, ` +
      `${result.sitesIndexed} site rows upserted (${result.pagesTotal} tags total)`,
  );
  process.exit(0);
} catch (err) {
  if (err instanceof IndexLockError) {
    console.error(`awwwards-index: ${err.message}`);
    process.exit(0);
  }
  console.error(`awwwards-index aborted: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
