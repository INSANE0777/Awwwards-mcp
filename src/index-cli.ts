#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { AwwwardsClient } from "./awwwards.js";
import { Cache } from "./cache.js";
import { runIndexer, IndexLockError } from "./indexer.js";

// npm run index              — sites crawl (default)
// npm run index -- --elements          — elements gallery, page 1 only
// npm run index -- --elements [pages]  — elements gallery, N pages ("all" =
//                                        follow pagination until exhausted)
const elementsArg = process.argv.indexOf("--elements");
const elements = elementsArg !== -1;
const pagesArg = elements ? process.argv[elementsArg + 1] : undefined;

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
  if (elements) {
    const { runElementsIndexer } = await import("./elements-indexer.js");
    const maxPages = pagesArg === undefined ? 1
      : pagesArg === "all" ? Infinity
      : Math.max(1, Number.parseInt(pagesArg, 10) || 1);
    // Category facets only for non-bootstrap crawls: ~46 extra 1/s fetches.
    const res = await runElementsIndexer({ client, cache, maxPages, withCategories: maxPages > 1 });
    console.error(`awwwards-index: elements done — ${res.itemsIndexed} item pages indexed${res.skipped ? " (skipped: fresh)" : ""}`);
    process.exit(0);
  }
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
