#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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
import { registerGuarded } from "./tool-profile.js";
import { registerAllTools } from "./tools/index.js";

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
const server = new McpServer({ name: "awwwards-mcp", version: pkgJson.version });

// Every registration goes through the guard: AWWWARDS_MCP_PROFILE=core skips
// non-core tools, AWWWARDS_MCP_MAX_RESPONSE_BYTES caps text+image payloads, and
// AWWWARDS_MCP_DEBUG_MEMORY=1 logs one JSON line per call on stderr. The
// legacy AWARDS_MCP_* names are accepted as a one-release fallback.
const tool = ((...args: any[]) =>
  registerGuarded(server, "tool", args)) as unknown as McpServer["tool"];
const registerTool = ((...args: any[]) =>
  registerGuarded(server, "registerTool", args)) as unknown as McpServer["registerTool"];
registerAllTools({ handlers, tool, registerTool });

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

await server.connect(new StdioServerTransport());
