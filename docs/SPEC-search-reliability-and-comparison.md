# Search reliability and comparison — specification and implementation plan

## Goal

Make cached searches complete, bound slow Awwwards requests, and expose two useful read tools without expanding the crawler's allowed paths. This change covers the four improvements proposed after reviewing the repository: complete indexed search, HTTP deadlines, site comparison, and index health.

## Contract

### `search_sites` with free text

- FTS5 retains porter-stemmed prefix matching, AND semantics and BM25 ordering. It returns **all fresh hits** before the server applies tags, technology, award filters and the requested page window; the former implicit 200-hit ceiling is removed.
- The explicit three-hit limit remains for OR-based loose-match suggestions. Missing FTS5 and unusable tokens retain the legacy substring fallback.
- A fully populated requested page is served from cache; an empty page triggers a polite single-filter listing fetch and a partially populated page permits best-effort top-up, as before. Color searches still require a live filter-page fetch because indexed site rows have no palette.
- No new Awwwards crawl paths, query-string pagination, or additional dependencies.

### HTTP client

- Every page and CDN fetch has a 10-second default deadline **per attempt**, including reading the response body. Aborts are signaled to fetch; the caller also settles at the deadline if an injected fetch ignores abort.
- Page requests remain rate-limited to one attempt per second, retry transient failures at most once, and **never** retry HTTP 403/429. CDN assets are not retried. Timeouts return actionable errors. Tests can inject a shorter deadline.

### `compare_sites`

- Input: `slugs`, two or three distinct, safe site slugs. Invalid and duplicate inputs fail before fetching. Order is preserved.
- Output: a text-only JSON object containing `sites` in input order; each site includes slug, title, live URL, palette, technologies, design elements, awards, overall jury score and jury dimensions when available. Unavailable jury dimensions are `null`; summary title/URL/award data may fill missing detail fields.
- Reuse 7-day detail cache. Fetch a missing detail only from `/sites/{slug}` through the existing rate-limited client. A fetched detail also seeds the element cache where parsing succeeds. Never cache an all-empty detail; report a parser-drift error instead. Do not download comparison thumbnails.

### `get_index_status`

- No inputs and no network access. Output is text-only JSON with stored site count, `{pagesDone, pagesTotal}`, last successful finish timestamp, last error, lock start/activity/staleness, and 7-day index freshness/age.
- Count stored rows including expired entries; distinguish an absent index from an empty cache. During the first crawl derive the total from cached categories if no status exists. A completed crawl reports its status after the progress checkpoint is cleared.
- A successful crawl clears its per-cycle progress checkpoint after persisting completion; a failed crawl retains partial progress for resume. Old completed checkpoints must not make subsequent refreshes skip all tag pages. Failed refreshes preserve the preceding successful finish timestamp.

## Implementation plan

1. Update `src/cache.ts` FTS query to apply `LIMIT` only when explicitly requested; add a SQL row-count helper for index health.
2. Add a deadline wrapper in `src/awwwards.ts` around both fetch and body-read phases; preserve retry and rate-limit behavior.
3. Extract shared detail loading in `src/server.ts`, implement comparison and index-health handlers, and register them with Zod schemas in `src/cli.ts`.
4. Correct `src/indexer.ts` checkpoint lifecycle for both completed and interrupted crawls; document the two new tools and behavior in `README.md`.
5. Add offline regression coverage for >200 FTS hits, deep filtered/paged results, hung fetch/body stages, both tool outputs, parser drift, and refresh/resume cycles.
6. Review the combined diff for accidental network calls and data-loss paths; run typecheck, offline tests, build, and `git diff --check`. Do not run the live smoke test without an explicit reason.

## Review notes and tradeoffs

- The old checkpoint lifecycle would have falsely marked a no-op 7-day refresh as successful. The completed-vs-partial distinction and repeat-cycle tests address this alongside index visibility. A follow-up review also caught legacy completed checkpoints carrying a later `lastError`, and a newly acquired lock briefly displaying the previous cycle's 100% progress; both have regression tests.
- FTS currently materializes all fresh matches and filters them in the server. This removes the correctness cap but can cost memory/CPU for unusually large indexes; SQL-level filter pushdown is a separate optimization requiring equivalent tag-normalization and ranking behavior.
- A custom fetch that ignores abort may keep underlying work running after the caller times out; real fetch receives an abort signal. Per-attempt deadlines avoid extending a single hung attempt indefinitely.
- Comparison deliberately returns no inline screenshots to keep responses small; `search_sites` and `get_site_details` remain the image-bearing tools.
