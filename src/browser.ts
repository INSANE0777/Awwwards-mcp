// Read-only loopback CDP attach (design §4.4). Attaches to a browser the user
// already started and returns an EXISTING page whose normalized href matches;
// never navigates, creates or closes pages. Disconnecting is browser.close(),
// which Playwright documents as a disconnect for a connected browser.
import { CAPTURE_INSTALL_HINT } from "./capture.js";

/** Opt-in gate; attach stays disabled unless the user sets this in the server env. */
export const ATTACH_ENV = "AWWWARDS_MCP_ATTACH";

/** Browser-side setup; Chrome/Edge 136+ ignore the debugging flag on the default profile. */
export const ATTACH_SETUP_HINT =
  "Start Chrome/Edge with --remote-debugging-port=9222 --user-data-dir=<throwaway dir> " +
  "(version 136+ ignores --remote-debugging-port on the default profile), then open the exact " +
  "URL in that window — it runs in the throwaway profile, not your everyday one.";

const ENDPOINT_HINT =
  "cdpEndpoint must be a loopback CDP URL: http://127.0.0.1:<port>, http://[::1]:<port>, " +
  "ws://127.0.0.1:<port>/devtools/browser/<id> or ws://[::1]:<port>/devtools/browser/<id>. " +
  "Credentials, queries, fragments, HTTPS/WSS and non-loopback hosts are rejected.";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]"]);
const WS_BROWSER_PATH = /^\/devtools\/browser\/[A-Za-z0-9_-]+$/;
const MAX_ORIGINS = 20;

/** Canonical href for exact-match comparison; invalid URLs compare as-is. */
function normalizeHref(raw: string): string {
  try {
    return new URL(raw).href;
  } catch {
    return raw;
  }
}

/** Accepts only the loopback forms in design §4.4; returns the trimmed endpoint. */
export function validateCdpEndpoint(endpoint: string): { endpoint: string } | { error: string } {
  const trimmed = endpoint.trim();
  // Raw delimiters are rejected before parsing: an empty "?" or "#" leaves
  // u.search/u.hash empty, so checking the parsed fields alone would pass it.
  if (trimmed.includes("?") || trimmed.includes("#")) return { error: ENDPOINT_HINT };
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return { error: ENDPOINT_HINT };
  }
  if (u.protocol !== "http:" && u.protocol !== "ws:") return { error: ENDPOINT_HINT };
  if (u.username || u.password || u.search || u.hash) return { error: ENDPOINT_HINT };
  if (!LOOPBACK_HOSTS.has(u.hostname) || !u.port) return { error: ENDPOINT_HINT };
  if (u.protocol === "http:") {
    if (u.pathname !== "/") return { error: ENDPOINT_HINT + " The http:// form takes no path." };
  } else if (!WS_BROWSER_PATH.test(u.pathname)) {
    return { error: ENDPOINT_HINT + " The ws:// form must be /devtools/browser/<id>." };
  }
  return { endpoint: trimmed };
}

/** Origins only (never paths or queries) so the error stays non-sensitive. */
function availableOrigins(pages: any[]): string[] {
  const origins = new Set<string>();
  for (const page of pages) {
    try {
      const origin = new URL(page.url()).origin;
      if (origin !== "null") origins.add(origin);
    } catch {
      /* ignore unparseable page URLs */
    }
  }
  return [...origins].slice(0, MAX_ORIGINS);
}

/**
 * Connect over CDP and select the already-open page whose normalized href
 * equals `url`. NotFound disconnects before returning the error.
 */
export async function attachPage(
  loader: () => Promise<any>,
  endpoint: string,
  url: string,
): Promise<{ browser: any; page: any } | { error: string }> {
  const valid = validateCdpEndpoint(endpoint);
  if ("error" in valid) return valid;
  let chromium: any;
  try {
    ({ chromium } = await loader());
  } catch {
    return { error: CAPTURE_INSTALL_HINT };
  }
  if (!chromium || typeof chromium.connectOverCDP !== "function") {
    return { error: CAPTURE_INSTALL_HINT };
  }
  let browser: any;
  try {
    browser = await chromium.connectOverCDP(valid.endpoint);
  } catch (err) {
    return {
      error:
        `CDP attach failed (${valid.endpoint}): ${err instanceof Error ? err.message : String(err)}. ` +
        ATTACH_SETUP_HINT,
    };
  }
  const pages: any[] = [];
  try {
    for (const context of browser.contexts()) {
      if (context && typeof context.pages === "function") pages.push(...context.pages());
    }
  } catch {
    /* no pages to read: reported below */
  }
  const wanted = normalizeHref(url);
  const page = pages.find(
    (p) => p && typeof p.url === "function" && normalizeHref(p.url()) === wanted,
  );
  if (page) return { browser, page };
  await closeAttached(browser);
  const origins = availableOrigins(pages);
  return {
    error:
      (pages.length === 0
        ? `No open pages in the browser at ${valid.endpoint}. `
        : `No open page matches ${wanted} in the browser at ${valid.endpoint}. ` +
          `Available origins: ${origins.length ? origins.join(", ") : "(none)"}. `) +
      `Open the exact URL in that browser, then retry — attach never navigates.`,
  };
}

/** Disconnect a connected browser without closing its pages or contexts. */
export async function closeAttached(browser: any): Promise<void> {
  try {
    await browser.close();
  } catch {
    /* the user's browser and pages are already out of our hands */
  }
}
