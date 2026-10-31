---
name: awwwards-doctor
description: Use when awwwards-mcp scraping or tools stop working — BlockedError, "layout may have changed" parser errors, empty results, failed captures, stale searches — or when the user reports the MCP behaving oddly. Guides running the doctor/drift/index scripts, applying their fixes, re-anchoring parsers after real awwwards.com drift, and recovering the in-flight task that surfaced the failure.
---

# Awwwards MCP Doctor

You are repairing the awwwards-mcp toolchain or working around it mid-task.
Work in this order: **diagnose → fix mechanically → fix parsers (if drift) →
recover the user's task**. Never delete user data; the only destructive step
(cache DB moved aside) preserves the old file in the OS temp dir.

> **Profile note:** this skill's tools are `search_sites`, `get_site_details`,
> `capture_live_site`, `analyze_page_structure`, `capture_component`,
> `export_design_tokens` and `analyze_images`. The examples below use those 1.x
> names (the default `full` profile). On `AWWWARDS_MCP_PROFILE=v2`, use
> `search_references {request:{kind:"sites", ...}}`,
> `get_reference {request:{kind:"site_details", slug}}`,
> `capture_page {request:{kind:"screenshot", url}}`,
> `inspect_page {request:{kind:"structure", url}}`,
> `capture_page {request:{kind:"component", url}}`,
> `inspect_page {request:{kind:"tokens", url}}` and
> `audit_page {request:{kind:"images", url}}` instead. Full mapping:
> [v2-routing.md](../v2-routing.md).

## 1. Run the doctor (repo checkout)

```bash
npm run doctor             # diagnose only
npm run doctor -- --fix    # diagnose AND apply available fixes
npm run doctor -- --json   # machine-readable report
```

The doctor checks five things and knows how to fix the mechanical ones:

| Check | Failure meaning | What --fix does |
|---|---|---|
| network | awwwards.com blocked/challenged the request | nothing to fix locally — wait, retry later; never retry in a loop |
| parser-drift | awwwards.com markup changed under the parsers | captures the raw live page into `docs/drift-<timestamp>/` (gitignored) as the fixture for the fix |
| playwright-chromium / ffmpeg-static | optional capture deps missing or broken | installs them (dev deps + `npx playwright install chromium`) |
| cache | SQLite DB corrupt/locked, or index older than 30 days | moves an unreadable DB aside (kept in temp) and rebuilds via `npm run index` |
| boot | `dist/cli.js` doesn't start | `npm run build` |

Re-run the doctor after fixing; the verdict must be HEALTHY before you claim
the MCP is repaired.

## 2. Fixing real parser drift (the only code-level failure)

If the doctor reports parser-drift, the anchor probes say which parser broke.
Repair sequence — keep it mechanical, verify at each step:

1. **Capture the evidence**: the `--fix` snapshot in `docs/drift-*/` IS the
   new truth. (The daily GitHub Action also opens/updates a `parser-drift`
   tracking issue with the drifted anchor names.)
2. **Locate the new anchors**: open the captured HTML and find the markup
   that replaced the old anchor (search the old anchor's *purpose*, e.g. the
   card JSON blob, the Elements section heading, the og:image meta).
3. **Re-anchor the parsers** in `src/parsers.ts` — change the minimum needed
   (one split/indexOf/regex literal), not the surrounding logic.
4. **Update the probe list** in `scripts/parser-drift-probe.mjs`
   (`PROBE_GROUPS`) so the same failure is detectable next time.
5. **Refresh the fixture**: download the live page with the same UA the
   client uses and replace `test/fixtures/listing.html` (or the detail
   fixture). The offline tests run against fixtures only — a refreshed
   fixture proves the re-anchor against reality.
6. `npm run typecheck && npm test` — all tests must pass.
7. Commit as `fix: re-anchor <parser> after awwwards.com markup change`,
   reference the tracking issue.

Note: the annual-award tools (`get_annual_*`) come from the official JSON API
(`src/annual.ts`), not the parsers, and the expanded award-cut listings
(`sites_of_the_month`/`year`, `nominees`, `winner_category_*`) have their own
trimmed fixtures under `test/fixtures/awards/` — refresh those when their
anchors drift, alongside the daily listing's.

## 3. End users (installed via npm, not a repo checkout)

The doctor scripts live in the repo, so for an npm-installed server:

1. Check the version notice: stderr at startup prints when a newer
   `awwwards-mcp` exists. Update with `npm install -g awwwards-mcp@latest`
   (or clear the npx cache) and restart the agent — a surprising share of
   "broken" reports are old parsers fixed in a newer release.
   `AWWWARDS_AUTO_UPDATE=1` in the MCP server env opts into background
   self-update on startup.
2. Reset local state: `rm -rf ~/.awwwards-mcp` is safe (cache + index +
   version-check state rebuild automatically; nothing user-authored lives
   there).
3. If it still fails, it's upstream (block or drift): open an issue at the
   awwwards-mcp repo attaching the raw HTML of the failing URL.

## 4. Recovering the in-flight task (the reason you noticed)

The user's build/research doesn't wait for the repair. Degrade gracefully:

- **Stale cache is your friend**: `search_sites`/`get_site_details` serve
  cached data when live fetches fail — say so in the reply ("7-day-old
  cached data").
- **BlockedError means stop, not retry**: the client never retries through
  blocks; tell the user and continue with cached/alternate data.
- **Capture tools down** (playwright missing): fall back to
  `get_site_details` screenshots (CDN-served, no browser needed) until
  `npm run doctor -- --fix` restores chromium.
- **Token/image tools down**: `export_design_tokens` reuses the
  `capture_component` pack (same playwright/chromium requirement), and
  `analyze_images` needs the same browser. Without playwright both return the
  raw browser/module error (e.g. `Cannot find package 'playwright'`), not the
  friendly install hint — `capture_live_site` / `analyze_page_structure` are the
  tools that return the hint. Cached `get_site_details` screenshots are the
  fallback. `analyze_images` never downloads assets — zero images means the page
  has no `<img>` elements (canvas/CSS-background content) or the scan found none,
  not a broken audit.
- **One band, a preloader, or `mode:"anchors"`**: 1.14 detects inner scroll
  roots (`scrollRoot`) and waits out full-screen loaders; 1.15 returns
  `mode:"anchors"` for inner-scroll pages — six ordered viewport shots down the
  scroller as JSON paths (`anchors[].scrollTop`/`file`) with no inline image.
  That is the honest success payload, not a broken capture; use
  `scrollCapture:"viewport"` when you want one explicit viewport shot. A
  `scrollRoot` re-query error (0 or >1 matches) means the DOM changed between
  scan and shot — re-run or report the label and match count. If a page still
  returns a single band, its content may be in shadow DOM or canvas; inspect and
  report the limitation instead of treating it as a full band map.
- **Parser drift mid-task**: results may be partially empty (e.g. details
  without palette). Surface which part is missing; don't silently present
  degraded data as complete.
- After the MCP is healthy again, **re-run the failed calls** and reconcile
  with whatever the fallback produced.

## Close the flywheel

Repairs are the highest-value lessons - they were expensive to learn. In a repository checkout (the installed npm package does not ship this dev script), after a successful diagnosis + fix:
`node scripts/skill-memory.mjs record --skill awwwards-doctor --phase repair --symptom "..." --rule "..." [--evidence <report path>]`. Distill folds recurring failure signatures into this installed copy so the next repair starts knowing them. When a rule proves out, `promote --skill awwwards-doctor` outputs it cleaned (no machine-local evidence paths) for the shipped-copy PR.

## Anti-patterns

- Retrying blocked requests in a loop — politeness rules and block
  detection exist precisely so this doesn't hammer awwwards.com.
- Diffing raw HTML to detect drift — cosmetic page changes would false-alarm
  daily; only parser-anchor probes matter.
- "Fixing" parsers by loosening them to return empty results quietly — a
  parse that can't find its anchors must error loudly (that is the drift
  signal).
- Treating the doctor's UNHEALTHY verdict as done because one check passed.

<!-- skill-memory:start -->
<!-- skill-memory:end -->
