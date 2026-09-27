# awwwards-mcp — project & architecture guide

Developer-facing guide to this repository. The [main README](README.md) covers
installation and user-facing features; this file explains how the codebase is
structured, how the data flows, and how to work on it without breaking it.

## What this is

A free, open-source MCP server that gives AI agents design inspiration from
[Awwwards](https://www.awwwards.com/). No API key, no account: it politely
scrapes public pages (1 request/second, robots.txt-compliant paths), caches
them in local SQLite, and serves them through 7 MCP tools — screenshots,
design DNA, band maps and motion recordings included.

```
                    ┌─────────────────────────────────────────────┐
 awwwards.com ─────►│ src/awwwards.ts  HTTP client (1 req/s,      │
                    │                  BlockedError on 403/429)   │
                    └───────────────┬─────────────────────────────┘
                                    │ HTML
                    ┌───────────────▼───────────────┐
                    │ src/parsers.ts  regex parsers │
                    │  parseListing / parseDetail / │
                    │  parseJuryDimensions /        │
                    │  parseCategories / parseElements
                    └───────────────┬───────────────┘
                                    │ rows
        ┌───────────────────────────▼───────────────────────────┐
        │ src/cache.ts  SQLite (node:sqlite) at ~/.awwwards-mcp │
        │  sites table + FTS5 (probe-guarded, derived) + asset  │
        │  image cache (sha1 of CDN path, no TTL)               │
        └───────────────────────────┬───────────────────────────┘
                                    │
        ┌───────────────────────────▼───────────────────────────┐
        │ src/server.ts  7 MCP tools over createHandlers(deps)  │
        └───────────────────────────┬───────────────────────────┘
                                    │
                    src/cli.ts ── stdio McpServer (awwwards-mcp)
                    src/index-cli.ts ── crawl CLI (awwwards-index)
```

## Module map (`src/`)

| Module | Lines | Role |
|---|---|---|
| `awwwards.ts` | ~134 | HTTP client. `BASE_URL` / `ASSETS_URL`, `AWARD_FILTERS`, `buildFilterUrl`, `RateLimiter` (promise-chained), `AwwwardsClient` with one retry on transient failures — **never** retries 403/429 (throws `BlockedError`). All binary CDN assets flow through one `getAsset` path. |
| `parsers.ts` | ~250 | Dependency-free regex parsers. See [parsers & drift](#parsers--drift-the-safety-net) below. |
| `cache.ts` | ~262 | SQLite storage. FTS5 layer is **derived and probe-guarded**: if the Node build lacks FTS5, `searchSites` returns null and callers fall back to substring search. Per-operation DB open/close (an open handle makes cache files undeletable on Windows). Batched-transaction upserts (per-insert autocommit pays ~4 ms disk sync on Windows). |
| `indexer.ts` | ~153 | `runIndexer`: meta-keyed lock (`index:lock`, 30 min stale), incremental crawl via `index:progress`, abort-safe status writes. `isIndexStale` gates the 7-day background re-index. |
| `server.ts` | ~700 | All MCP tool handlers + search merge semantics. The biggest and most rule-dense module — see [search semantics](#search_sites-semantics) before touching it. |
| `motion.ts` | ~429 | `recordSiteMotion`: webm recording + ffmpeg filmstrip under a strict 30 s budget (documented timing table at the top of the file). Virtual SVG cursor, per-call `mkdtemp` isolation, 10-min stale-tmp sweep, 60 s ffmpeg deadline. |
| `structure.ts` | ~249 | Band map. `SCAN_SNIPPET` runs in-page via `page.evaluate` (self-contained, reaches DOM through `globalThis` — the Node tsconfig has no DOM lib). `collapseBands` is pure: 8 px sweep, smallest-covering candidate wins, sliver absorb, max-40 cap. Owns the ONE `preScroll` shared with capture. |
| `capture.ts` | ~66 | Full-page screenshot. Intentionally circular import with `structure.ts` (call-time-only bindings; ESM resolves it). |
| `cli.ts` | ~179 | `McpServer` wiring, zod schemas, lazy playwright/ffmpeg defaults (optional deps are only touched when a tool actually runs), background auto-reindex, daily version check — stdout stays clean for JSON-RPC. |
| `version-check.ts` | ~131 | Daily npm-registry check, stderr-only, 3 s timeout, all failures swallowed. Self-update is opt-in via `AWWWARDS_AUTO_UPDATE=1`. |
| `viewport.ts` | ~20 | Desktop (1440×900) / mobile (390×844, DPR 3, touch) profiles. Width/height go in playwright's `viewport` key; mobile flags spread as sibling context options. |
| `types.ts`, `index-cli.ts` | — | Shared types (`SiteSummary`, `SiteDetails`, `ElementMedia`); thin crawl-CLI entry. |

## Search semantics (read before touching `server.ts`)

`search_sites` invariants, each pinned by tests in `test/server.test.ts`:

- **One filter per URL.** Combined filter URLs return 404 on awwwards.com, so
  `buildFilterUrl` picks the highest-priority filter (color > award >
  technology > first tag) and the rest are verified client-side by
  `matchesFilters`. `honorUrlSource` skips re-checking the URL filter for
  freshly scraped rows only.
- **FTS skip-query-check.** FTS matches prefix+porter-stem; re-checking the
  query with substring semantics would wrongly drop stem matches
  ("magazines" → Magazine). FTS-sourced rows skip the query check.
- **Color is never served from cache.** Site rows carry no colors, so a color
  search always scrapes its filter page.
- **Page-window merge.** An empty requested window → scrape replaces. A
  *partially* filled window → top-up scrape MERGES: dedupe by slug, verified
  cache rows win duplicates, bm25 rank order is preserved, scraped-only rows
  append newest-first.
- **Top-up scrapes are best-effort.** A failed fetch must not escape to the
  stale-fallback catch, which would silently discard the cached page window.
- **Never cache an all-empty parse.** `get_site_details` /
  `get_site_elements` treat an all-empty detail as layout drift and leave it
  uncached so the mismatch keeps surfacing. One fetch feeds both caches.
- **Zero results get hints, not live fetches.** Loose-match OR hint (up to 3
  slugs) + taxonomy suggestions computed from cached categories only.
- **Stale fallback.** On live-request failure, serve stale cache — and the
  cache lookup itself is guarded (the store may be the failure source).

## Parsers & drift: the safety net

awwwards.com is a moving target, so the parsers follow strict conventions:

- Every regex / `split` / `indexOf` anchor carries a date-stamped
  verification note ("verified live 2026-09-XX").
- **`parseJuryDimensions` refuses to guess**: if the chartbar labels are not
  exactly Design/Usability/Creativity/Content, it returns undefined instead
  of mapping by position.
- `parseElements`: `null` = no Elements section (legitimate); empty array =
  markup drift (never cached).
- Description: curated `>Description</h2>` section primary (~16 % coverage),
  `og:description` meta fallback (~50 %).
- Elements media paths come in two schemes — modern `element/YYYY/MM/…` and
  2018-era `external/YYYY/MM/…` — both with `_static.jpeg` posters on the CDN.

Three layers guard these anchors:

1. **Fixtures** — real saved awwwards pages in `test/fixtures/` (listing +
   four detail variants, 300–600 KB each). All parser tests are offline.
2. **Drift probe** — `scripts/parser-drift-probe.mjs` (`npm run drift`)
   checks every parser anchor against the live listing and detail pages
   (2 fetches at 1 req/s) and against the committed fixtures
   (`npm run drift -- --fixture`, offline). Writes `.drift/status.json`.
3. **CI** — a daily GitHub Action (`.github/workflows/parser-drift.yml`)
   runs the live probe and opens/updates a single tracking issue on drift
   (auto-closes when green).

When a drift issue lands, the fresh HTML snapshot becomes the new fixture.

## Tests

```bash
npm test        # offline, vitest, fixtures only — no network
npm run smoke   # manual live smoke test (test/live-smoke.ts)
npm run build   # tsc → dist/
```

Suites: `parsers` (fixtures pin every anchor), `cache` (FTS on/off, TTLs),
`server` (the merge semantics above — the largest suite), `indexer` (lock,
resume, abort), `motion` / `capture` / `structure` (fake playwright +
injectable ffmpeg — nothing launches a browser), `awwwards` (fetch fake),
`version-check`. `vitest.config.ts` raises the timeout to 30 s for the
multi-page indexer crawls.

Dependency injection is the pattern everywhere a hard dependency exists:
`AwwwardsClient.fetchFn`, `Cache` paths + clock, playwright loaders,
`ffmpegFn`. Write new tests against fakes, not networks.

## Scripts & tooling

| Script | Purpose |
|---|---|
| `scripts/doctor.mjs` | `npm run doctor` — checks network, drift, deps, cache, boot; applies fixes. |
| `scripts/parser-drift-probe.mjs` | `npm run drift` — live + fixture anchor probe (see above). |
| `scripts/enrich-styles.mjs` | Phase-1 style-classification experiment via a self-hosted simple-jev classifier (spec: `docs/superpowers/specs/2026-09-20-jev-style-enrichment-design.md`). |
| `scripts/make-demo.mjs` | Builds the README demo assets. |
| `scripts/record-scrollthrough.mjs` | The validated recording script `motion.ts` was ported from. |
| `scripts/skill-memory.mjs` | Journal → techniques distillation for the skills flywheel (`skills/_memory/techniques.json`). |

## Skills & showcase

- `skills/` ships three agent skills (`awwwards-inspiration`,
  `awwwards-motion-study`, `awwwards-doctor`). Shipped copies change only via
  human PRs; local copies self-improve through the skill-memory flywheel.
- `showcase/` holds real sites built through the loop (`ridge`,
  `afjal-portfolio`, `fallow-press`), each with `_qa/` capture evidence. They
  double as regression demos for the capture/structure/motion tools.

## Conventions worth preserving

These are hard-won; check for them before "simplifying":

- `page.evaluate` snippets are self-contained and reach browser globals via
  `globalThis` (no DOM lib in tsconfig).
- Per-operation SQLite open/close; batched transaction upserts.
- Optional heavy deps (playwright, ffmpeg-static) stay unresolved at compile
  time and resolve lazily at runtime with in-band install hints.
- stdout is the MCP JSON-RPC channel — every log/notice goes to stderr.
- New crawler code must keep the politeness contract: `/websites/…` paths
  only, 1 req/s, no query-string pagination (`/tag/`, `/search-websites`,
  `/elements/*` etc. are robots-disallowed and never fetched).

## Contributing

PRs welcome — parser-drift fixes especially (a fresh HTML snapshot attached
to a drift issue is the fastest merged PR). See [CONTRIBUTING.md](CONTRIBUTING.md)
for branch naming, the PR template and the politeness constraints. Security
issues go privately via [SECURITY.md](SECURITY.md).

MIT — see [LICENSE](LICENSE).
