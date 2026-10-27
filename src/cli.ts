#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { AwwwardsClient, SHARED_RATE_LIMITER } from "./awwwards.js";
import { Cache } from "./cache.js";
import { createHandlers } from "./server.js";
import { captureLiveSite } from "./capture.js";
import { runIndexer, shouldAutoIndex } from "./indexer.js";
import { checkForUpdate } from "./version-check.js";
import { checkEnvironment } from "./env-check.js";
import { createServer } from "./server-instance.js";

const cacheRoot = process.env.AWWWARDS_CACHE_DIR ?? join(homedir(), ".awwwards-mcp");
let cache: Cache;
try {
  cache = new Cache(cacheRoot);
} catch (err) {
  console.error(
    `awwwards-mcp: cannot initialize cache at ${cacheRoot}: ${
      err instanceof Error ? err.message : String(err)
    }`,
  );
  process.exit(1);
}
const client = new AwwwardsClient({ rateLimiter: SHARED_RATE_LIMITER });
const handlers = createHandlers({
  client,
  cache,
  // captureLiveSite's third positional is the injectable playwright loader,
  // so the CaptureFn-shaped (url, dir, opts) call is adapted to land opts
  // in the function's fourth (opts) position.
  captureFn: (url, imagesDir, opts) => captureLiveSite(url, imagesDir, undefined, opts),
});

// Version must match package.json; reading it at runtime makes drift impossible.
const pkgJson = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf8"),
) as { version: string };

// Auto-refresh: if the index is stale (or absent) and no crawl is running,
// re-index in the background. Serving is never blocked; errors are stderr-only.
if (shouldAutoIndex(cache)) {
  void runIndexer({ client, cache, log: (m) => console.error(m) }).catch((err) => {
    console.error(
      `awwwards-mcp: background index failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  });
}

// Update notice: once a day, compare against the npm registry; stderr-only,
// never blocks serving. AWWWARDS_AUTO_UPDATE=1 opts into background install.
checkForUpdate(pkgJson.version);

// Environment notice: once a day, verify playwright/ffmpeg are usable from
// the server's own install (a real chromium launch, not just an import) and
// hint at the optional webcrack bundle-de-obfuscation dep; stderr-only,
// never blocks serving.
checkEnvironment();

serveStdio(() => createServer({ handlers, version: pkgJson.version }), {
  onerror: (error) => console.error(`awwwards-mcp: server error: ${error.message}`),
});

