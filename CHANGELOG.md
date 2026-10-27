# Changelog

> **Versioning note:** every release through v1.6.0 was an **alpha**;
> `v1.0.0-beta.1` was the beta. `v1.0.0` is the first **stable** release.

## Unreleased - v1.14.0

Coverage honesty, output economy and responsive evidence.

### Hardening

- Bundle import-graph extraction replaces its lazy cross-statement ESM/reexport regexes with a linear scanner: bounded ≤500-char keyword window, capped candidates, same `raw`/`kind` values and dedupe/cap semantics. A 1 MB `import ` flood now yields no edges in well under a second instead of backtracking.
- `analyze_network_capture` HAR cap lowered from 50 MB to 20 MB, re-checked after `readFile` so a file that grows mid-read is rejected with the same error; the 2000-entry cap is unchanged.
- `capture_live_site` inline previews are capped at 2.5 MB of base64; `inline: false` keeps the saved file and returns text-only, and an omitted preview is stated in the response. `CaptureResult` now carries optional `base64` + `inlineOmitted`.
- `AWARDS_MCP_PROFILE=core|full` (default full) can expose only the 12 build-loop tools; `AWARDS_MCP_MAX_RESPONSE_BYTES` (default 8 MB) replaces oversized responses with a `{truncated:true,...}` JSON block; `AWARDS_MCP_DEBUG_MEMORY=1` logs one JSON line per call on stderr.
- `AWARDS_MCP_IMAGE_RETENTION_DAYS=N` (default 0 = off) prunes cached screenshots older than N days once at startup, best-effort.
- README/README.dev resource-limit docs; hardening tests for the scanner, post-read HAR race, screenshot budget, tool profile, response budget, stderr logging and image retention.

- `get_site_details { slugs }` batch enrichment (1-10, ordered, cached/fetched/error/skipped, stops on block, compact details, no images).
- `get_index_stats` reports per-metric `sample` and `insufficient`; below 30 parsed rows it suppresses colour/motion lists and score averages instead of publishing misleading numbers. This is a deliberate behaviour change for small caches.
- `audit_url` gains `compact: true` (reduced perf + pre-cap severity counts + nextActions + coverage) and always-present ranked `nextActions`; `verify_build` gains `compact: true` (verdict, scores, band counts).
- `analyze_page_structure compare:"mobile"` returns element-level `responsive` evidence: page overflow, overflow offenders, small text, small tap targets, document rects and selectors, per-kind caps. No screenshots, no hidden-band or wide-fixed checks.
- README routing table, compact guidance, and skill notes.

### Web reverse-engineering extension (P1-P5)

- `analyze_network_capture(path, top?)` - offline HAR 1.2 API-surface evidence: requests grouped by method + origin + templated path (dates, versions, UUIDs, hex ids and numbers templated; emails, tokens and high-entropy segments redacted), with counts, statuses, content types and query names only. 20 MB / 2000-entry caps; `evidenceCoverage` discloses exclusions; bodies, headers and query values are never returned.
- `analyze_bundle bundleIntel: true` - opt-in quoted routes, vendor signatures, source-map presence (never fetched) and module graph; default output keys are unchanged without the flag.
- `verify_flow` - step-aligned interaction comparison: the same 1-6 scroll/click/wait steps on a build and a reference, then path, scroll delta, skeleton hash, text hash and element count per step. `same` only when both sides are complete and untruncated; truncated or failed states are `unknown`. Two fresh launches, never attach, no screenshots.
- `analyze_page_structure cdpEndpoint` - loopback CDP attach to a browser the user started: requires `AWWWARDS_MCP_ATTACH=1`, selects an already-open page whose normalized href matches exactly, never navigates, scrolls, clicks or creates tabs, and disconnects without closing anything. An `http://` endpoint is resolved via `/json/version` and the returned ws URL is re-validated before connecting. Rejects `compare: "mobile"`, a custom viewport and responsive evidence; the result carries `attached: true` additively.
- `evidenceCoverage` on the new surfaces (HAR, flow, opt-in bundle intel); tool count 37; README tool/routing rows and attach setup section, README.dev counts, skill pointers, annotation hints.

## v1.13.0 - 2026-10-25

Discovery, sources, and inspection: 35 tools, with award data from Awwwards' official API,
curated collections and the agency directory, plus evidence-only audit surfaces.

### New tools (9) - 26 → 35

- `get_annual_categories`, `get_annual_nominees`, `get_annual_nominee` - Annual Awards
  via the official public read-only API (`llms.txt` / `openapi.json`): 6 categories,
  bounded nominee hydration (default 10, max 20 at 1 req/s), site/user detail with
  country/date/designBy/images/videos. 7-day cache, stale-on-failure marked, 403/429
  stop all further requests. Media URLs are reference-only (never downloaded).
- `get_collections`, plus collection detail by slug/page - curated and member collections
  (`/awwwards/collections/<slug>/`, `/<owner>/collections/<slug>/`), element-only
  collections reported instead of false parser drift.
- `search_directory` - agency/studio directory with path filters (82 canonical countries,
  categories, budgets), client-side free-text query, `applied`/`ignored` arrays,
  contact PII stripped.
- `audit_url` - runtime evidence (fps, dropped frames, long tasks, layout thrash) via an
  installed Chrome/Edge, plus an anti-pattern scan over bounded same-origin CSS/JS.
  Runtime and static halves degrade independently; evidence only.
- `analyze_accessibility` - composited contrast (opacity groups skipped and counted, never
  approximated), alt coverage, heading ladder, focus/tabindex, form labels, lang/title.
  `heuristic: true`, never a WCAG pass/fail.
- `get_index_stats` - aggregates over the local cache only: all-time sites/elements/tags
  vs windowed details/palettes/scores/motion DNA, every metric coverage-disclosed.
- `build_motion_manifest` - census + band map → `motion.manifest.json` scaffold;
  `measured` stays false when the census has no animations.

### Extended

- `capture_component` gains `typography` (families/sizes/weights/line-heights/tracking,
  top 12) and `paletteSummary` (strict colour grammar; background shorthands, gradients,
  images and alpha-0 values rejected and counted) summaries; inert in compact mode.
- `analyze_page_structure` gains `compare: "mobile"` (390×844 second pass) returning
  `mobileBands` + label-matched band diff; a failed mobile pass keeps the desktop result
  with `mobileError`.
- Award discovery: 9 new cuts (`sotm`, `soty`, `nominees`, six `winner_category_*`),
  persisted nominee flag, `list_categories` v2 (12 award filters + technology slugs),
  15 live-verified technology aliases applied in URLs and client-side filters.
- Skills and docs: collections/directory discovery, mobile compare in the section loop,
  motion-manifest hand-off; README "Official Awwwards resources" + non-affiliation note.

### Fixes

- Palette correctness: strict colour parsing, alpha-0 forms rejected, dead style keys removed.
- Accessibility: ancestor opacity groups excluded from ratios rather than faked.
- Mobile compare: desktop result preserved when the mobile capture fails.
- Collections: page-1 404 wording, page-N notes, `owner`/`ref` round-trip, v2 list cache.
- Directory: canonical-country validation blocks Awwwards' wrong-country 200 fallback.
- Bundle/index stats: honest all-time vs windowed semantics, severity-sorted findings.

## v1.12.0 - 2026-10-23

From capture to an owned project: conversion, authored motion, and a sharper audit layer.

### New tool (26 total) — `build_project` + `awwwards-build-project` bin

- Exact rebuild HTML or a real-site rehost → a runnable **Vite**, **Astro**, or **Next.js** project.
- Native structure: sections become real components (JSX for Next/Astro), shell chrome kept once, CSS split into tokens + site, ordered script loader, head metadata / JSON-LD / pre-paint boot replayed in captured order.
- Carries local external CSS/JS, inline scripts, and CDN libraries; StrictMode-safe loader; explicit warnings whenever content cannot be split safely (never silent loss).
- `--authored --motion <census.json>`: drops site logic (head boot and animation libs stay), emits `motion.manifest.json` (measured per-section triggers + `pageTriggers` for unattributed rows) and inert per-section/page motion hooks/modules to author against.
- Proven on a real hand-built GSAP site: all three targets build; desktop 1440×900 (8 anchors) and mobile 390×844 (5 anchors) parity exact — scrollHeight 25,650 identical, zero console errors/404s, reduced-motion clean.

### Audit wave

- Band-split v2: landmark subdivision + residual second pass kill mega-bands (a 20,631 px giant became 10 bands).
- `build_gsap_stub` consumes measured scrub curves (real progress values, not guessed timelines).
- Design briefs carry choreography hints (stagger / delay deltas from measured tween data).
- `get_motion_dna` runs a single browser launch and adds `censusSummary`.
- Compact response modes (`compact`) on the heaviest tools — measured ~38 % token cut.
- `awwwards-verify` bin: CI-grade verdict with exit codes (0 pass … 4 missing tool).
- `analyze_stack`: Webflow/Tailwind arbitration (no more Tailwind false positives on Webflow classes).
- `analyze_bundle`: opt-in chunk-graph walk, static import edges, JSON-LD/importmap filtering, pretty-code keyword scan, 4-char regex floor.
- `verify_build`: opt-in DOM-structure diff (missing/extra/rect-drift evidence, `incomplete` honesty flag); measured fps window audited and documented.
- Mobile hover census skips the hover loop with an explanatory note instead of pretending.

### Skills (seven)

- `recreate` — link-to-site playbook: Awwwards lookup first, evidence capture on any URL, study-build terms, exact assets, scroll-anchor QA, conversion **only on request**.
- `motion-authoring` — converting manifest + inert skeletons into real motion (topology, intent map, per-target surfaces, parity gate).
- `awwwards-section-loop` gains the convert-and-author close-out; `awwwards-motion-study` teaches the manifest hand-off and bundle forensics; `awwwards-setup` mentions optional webcrack.

### Fixes

- Issue #23: viewport-qualified screenshot/motion filenames, per-recording sheet directory, no screenshot read-back race.
- gsap stub keeps `pin` on superseded scrub rows; compact site details restore descriptions; daily env hint for optional webcrack; README tool/skill counts.

## v1.11.0 - 2026-10-20

The precision ladder completed: scrub curves, choreography, and polish.

- `analyze_scroll_map` gains an opt-in `scrubProbe`: the tool drives the page
  through up to 8 scroll steps and samples each scrubbed trigger's real
  progress curve (scrollY -> progress -> transform), so scrub behavior is
  measured, not inferred from declared start/end.
- `analyze_scroll_map` now also returns `choreography` hints: stagger values
  detected from captured tween vars and delay-step groups - rebuilds get
  entrance ordering, not just per-element timing.
- Bundle forensics polish: inline `ld+json`/`importmap`/`speculationrules`
  blocks are no longer captured as chunks; keyword search now also scans
  webcrack-de-obfuscated output (matches carry `source: "raw" | "pretty"`);
  the unpack cap counts only qualifying chunks (an oversized or failing
  chunk no longer consumes one of the 10 slots); distinct hint when webcrack
  is installed but nothing was unpacked.
- Motion Evidence Sheet: the first keyframe no longer wastes its slot on the
  pre-paint frame (guarded to 600ms); the cursor-trail overlay scales with
  the actual viewport instead of assuming 1440x900.
- Fixed a fetch-order race in search previews that intermittently reordered
  thumbnails when serving from cache (deterministic preview fetch + slug
  tie-break; the long-standing ~10% suite-order flake is gone).

## v1.10.0 - 2026-10-20

Motion precision, bundle forensics, and a measured verify loop. Now 25 tools.

- New `analyze_stack` tool: framework and CSS fingerprint (Next, Astro,
  Nuxt, Remix, SvelteKit, WordPress, Webflow, Framer; Tailwind/Bootstrap
  density) from one polite HTML fetch - no browser, no new dependencies.
- New `build_gsap_stub` tool:turns captured motion censuses into a runnable
  GSAP + ScrollTrigger stub (durations, easings, scrub/pin, reduced-motion
  guard).
- New `analyze_bundle` tool: bundle forensics for a live page - fetches its
  script chunks (bounded: 40 chunks, 10 MB, 1 request/second; script tags,
  inline scripts, and modulepreload/preload hints), saves them locally, and
  greps keywords so agents can read the actual animation mechanism instead
  of guessing. Optional webcrack de-obfuscation/unpack if installed (lazy,
  degrades to raw chunks + hint). Runs on URLs you are authorized to
  analyze.
- `analyze_scroll_map` now returns value-precise motion: per-animation
  keyframe matrices (real from/to values like `translateY(56px) -> 0`,
  bounded to 4 frames x 4 props/row) and a site-level `gsapTriggers` array
  with compiled pixel `startPx`/`endPx`, live `progress`, and tween vars
  (e.g. `stagger: 0.09`).
- `analyze_hover_census` now samples animations DURING hover (`activeAnims`
  + in-flight transform trail), catching event-driven tweens that do not
  exist at rest - the on-hover letter-swap class of effects is now
  recoverable without reading source.
- `verify_build` is instrumented: beyond band/motion scoring it runs a
  real-browser perf probe on the build (fps, dropped frames, long tasks,
  layout thrash) plus an anti-pattern scan (transitioning blur, animated
  layout properties, `transition:all`) and names the worst offender in the
  evidence.
- Existing installs: the daily environment notice now hints the optional
  `webcrack` install for bundle de-obfuscation (hint only - environment
  health is unchanged without it).
- CI: parser-drift probes treat network blocks as inconclusive instead of
  filing false drift issues.
- Docs/skills: NEUTOMNI one-shot rehost showcase, any-URL recreation
  positioning, and all five skills updated for the new tools.

## v1.9.0 - 2026-10-17

Motion Evidence, fidelity capture, and the recreation pipeline.

- New `capture_component` tool: serialize any page component (structure,
  computed-style tokens, animations, pseudo-elements) into a portable
  component pack for rebuild tooling. Runs on any URL. New `maxNodes`
  option (50–2000, default 400) for large sections.
- New `capture_pose_3d` tool: hero-canvas reference frames across a scroll
  journey → camera pose grid.
- New `build_pose_stub` tool: pose grid → offline three.js + GSAP replay
  skeleton (reduced-motion guarded, deterministic).
- `record_site_motion` now emits a Motion Evidence Sheet beside the filmstrip:
  census-timed keyframe grid, consecutive-frame difference masks, onion-skin
  composite, cursor-trail overlay, inspector-style timeline strip, and
  `motion-sheet.md` (video→document captions stamped with t / phase / scrollY).
  Degrades gracefully — the recording never fails because the sheet does.
- Fidelity capture: `capture_component` now records 44 computed-style keys
  (layout offsets, background image/size/position, flex/grid alignment,
  aspect-ratio, filters) plus `::before`/`::after` pseudo-elements —
  pixel-adjacent rebuilds, not just structure.
- New `analyze_hover_census` refinements: real-page hover semantics
  (IDL camelCase access, :hover-stripped candidate matching).
- Fixed a tsx-only snippet-injection failure in the hover census
  (`installSnippetShims` now applied everywhere snippets are evaluated).

## v1.8.0 - 2026-10-12

Deterministic design briefs and evidence-backed interaction guidance.

- Added the `create_design_brief` MCP tool for cited, versioned briefs from
  shortlisted Awwwards references.
- Reused cached site details, element metadata, and Motion DNA; optional
  structure analysis runs only when requested.
- Added an Interaction Plan for observed cursor/hover, scroll, entrance/reveal,
  easing, and duration signals, with reduced-motion and keyboard-access
  guidance. Missing evidence is reported rather than inferred.
- Documented the design-brief workflow in the `awwwards-inspiration` skill and
  README.

## v1.7.2 — 2026-09-29

Reliability & housekeeping. No runtime tool changes.

- **Parser-drift probe: network rejections no longer masquerade as parser
  drift.** A raw `fetch()` crash (DNS/reset/classifier network errors)
  killed the live probe with exit 1, which the workflow reported as
  "markup changed — parsers need updating" even though zero anchors had
  been probed. Rejected fetches are now recorded as failed pages and the
  verdict logic emits its existing honest `fetch-fail` (exit 2) state.
  This was the root cause of issue #6 (false alarm — the 9/19 committed
  status was `ok 0/59`, and awwwards.com fetches fine).
- **Dependency alerts cleared**: vitest + @vitest/mocker bumped to 4.1.11
  (dev-only; full suite 251/251 green on vitest 4). Supersedes the two
  Dependabot PRs, which were merged into one local commit.
- **CI updated** to `actions/checkout@v5` / `actions/setup-node@v5` in all
  three workflows (fixes the Node 20 deprecation annotation).
- Removed the stale `elements-motion-dna` worktree (fully merged).

## v1.7.1 — 2026-09-29

Daily environment self-check + corrected optional-dependency install hints.

- **Daily env check**: at server startup (once per day, stderr-only, never
  blocks serving) the server probes playwright with a real chromium launch
  and resolves ffmpeg-static from its own install location. When captures
  or motion recordings later fail, the cause was warned about up to a day
  earlier — and the fix hint prints once, not on every failed capture.
- **Corrected install hints**: capture/motion hints now say
  `npm install -g playwright && npx playwright install chromium` /
  `npm install -g ffmpeg-static` — the server resolves optional deps from
  its own install location, so a `-D` install in whichever project the
  agent happens to sit in does not fix a globally-installed server.
- Failure-tolerant by design: a flaky probe (first-run policy, AV scan)
  records nothing, so the next start re-checks; every failure is swallowed
  and stdout is never touched.

## v1.7.0 — 2026-09-28

> First stable-minor release. npm versions 1.1.0–1.6.0 were the retired
> alpha line, so the stable line jumps to 1.7.0 — semver forbids reusing a
> published version number.

Winner feed (`new_winners` + `watch_site`), `awwwards-setup` skill, repo
renamed to the correct spelling.

- **`new_winners`** polls today's freshly-crowned winners (SOTD /
  Developer Award / Honorable Mention) against a persisted UTC-day
  baseline: the first call seeds silently and dumps the listing; later
  calls report only the delta. Each first-seen winner's site page is
  fetched once and its Elements section is backfilled into the searchable
  element corpus as `source:"site"` records (slugs namespaced
  `site-<siteslug>-<title>` so they never collide with gallery records) —
  new winners are element-searchable immediately, no gallery indexing
  needed. Per-winner fetch failures never abort the loop.
- **`watch_site`** adds persistent watches (studio / tag / url, optional
  `award` + `note`). `list` matches each watch against the freshest cached
  listing and reports per-watch `NEW since last check` deltas; it never
  fetches — `new_winners` / `search_sites` keep the pool fresh. First
  `list` seeds the baseline silently; url watches take the site slug;
  studio matching is a case-insensitive substring.
- **New skill `awwwards-setup`** — first-invocation onboarding: wires the
  MCP server when it isn't connected yet (Claude Code, Codex, OpenCode,
  mcpServers-standard clients, pi), asks the user's preferences once
  (result density full/compact, default viewport, live-capture opt-in
  with playwright install, local-index opt-in, winner watches to register)
  and persists them to `~/.awwwards-mcp/preferences.json`. Later runs
  apply silently and only ask about missing fields. Shipped in the npm
  package; `awwwards-inspiration` hands off to it on first run.
- **Docs**: README documents both new tools and the two-source element
  corpus; `awwwards-inspiration` gains the tool-table rows, a "staying
  current" section, and the first-run setup handoff.
- **Repo renamed** `Awwards-mcp` → `Awwwards-mcp` (three w's, matching the
  npm package and awwwards.com). Old GitHub links redirect automatically;
  `package.json` and issue-template URLs updated.

## v1.0.1 — 2026-09-28

Element↔site pairing (Task 5), element category taxonomy, elements-index docs.

- **Pairing**: gallery elements now link to their owning site. Item-page
  attribution anchors (`/sites/<slug>`) are parsed into a new
  `elements.siteSlug` column (lazy ALTER TABLE migration — existing caches
  upgrade in place). At read time, rows crawled before this change fall back
  to an exact author→site-title match, filled only when the title is unique
  across the sites index (wrong pairing is worse than none). `search_elements`
  and `get_element` payloads carry `siteSlug` + `siteUrl`; the next elements
  re-index stamps `siteSlug` authoritatively.
- **Taxonomy**: `search_elements`'s `category` filter works for real. A
  taxonomy pass (opt-in, any `--elements` crawl beyond page 1) fetches each
  facet page (`/elements/footer/`, `/elements/cta/`, … 46 categories) once
  and stamps every element under it with that category id — element pages
  carry no breadcrumb, so the listing side is the only category source. The
  1-page bootstrap auto-index stays cheap; dead facet pages are skipped;
  a frozen 46-category list covers facet-nav drift. Elements seen on no
  facet page stay `unsorted`. Completes the "Task 5 fills the taxonomy" stub.
- **Docs**: README documents the optional full elements index
  (`--elements all|N`), slug-FTS search, the 7-day freshness gate, and the
  taxonomy pass.

## v1.0.0 — 2026-09-19

First **stable** release. Supersedes the alpha 1.x line and the beta — the
complete feature set: 6 tools, local index, three skills (including the
self-improving skill-memory flywheel), self-heal doctor, parser-drift
monitor, dual-viewport capture, FTS5 search. Ships with the layered-analysis
+ superprompt hand-off upgrade to the motion-study skill.

## v1.0.0-beta.1 — 2026-09-19

First **beta**. Supersedes the alpha 1.x line — the full v1.6.0 feature set
(6 tools, local index, three skills incl. the self-improving memory flywheel,
self-heal doctor, drift monitor, dual-viewport capture) now carries a beta
label while it takes public hardening. Alphas remain on the registry for
reproducibility.

## v1.6.0 — 2026-09-19

Skill-memory flywheel (reviewed and approved for ship):

- `scripts/skill-memory.mjs` (record/recall/distill/stats): the skills
  self-improve from what their verification loops catch. Findings journal
  (episodic, per-machine) + deterministic distiller folding rules seen 2+
  times into installed skill copies (machine-managed section, LRU-capped).
- `promote` + `sync` commands: promote prints folded rules cleaned for the
  shipped-copy PR (machine-local evidence paths stripped); sync copies repo
  skill updates into installed copies WITHOUT wiping learned rules.
- `skills/_memory/techniques.json`: techniques registry seeded from
  researched video-understanding, motion-detection, UI-structure,
  micro-interaction and image-analysis methods; grows via the flywheel.
## v1.4.0 — 2026-09-19

Search intelligence (FTS5 — no new dependencies):

- Porter-stem + prefix matching with BM25 ranking: "magazines" now finds
  Magazine-tagged sites (68 on the live index), best matches first — the old
  substring path returned zero. "edito" finds "editorial"; multi-word queries
  keep AND semantics (every token must hit the same site).
- Zero-result queries gain loose OR-matched hints alongside the taxonomy
  suggestions. Live top-up merge and client-side filters unchanged.

## v1.3.0 — 2026-09-19

Mobile viewports:

- `capture_live_site`, `analyze_page_structure` and `record_site_motion`
  accept `viewport: "desktop" | "mobile"` (mobile = 390×844 @3x with
  isMobile + hasTouch; desktop 1440×900 default, byte-identical).
- Motion recordings render at the selected viewport — no more pillarboxed
  mobile filmstrips.

## v1.2.0 — 2026-09-19

Adoption kit:

- **Demo GIF** at the top of the README — real tool output (search results,
  design DNA, a motion filmstrip of our own build, a band map), generated by
  `scripts/make-demo.mjs`.
- **Release automation**: pushing a `v*` tag now gates on the CHANGELOG
  section + npm-absence, runs typecheck/tests/build, publishes to npm with
  `NPM_TOKEN`, and creates the GitHub Release from the CHANGELOG section.
- **Package metadata**: keywords, repository, bugs, homepage for registry
  discovery.

## v1.1.0 — 2026-09-18

Self-repair + observability release (all shipped in repo 2026-09-18):

- **Parser-drift monitor**: `npm run drift` probes every markup anchor the
  parsers depend on (hybrid pinned + date-sampled detail URLs, section-scoped
  element anchors); daily GitHub Action opens/updates a tracking issue and
  commits probe state for was-ok→DRIFT diffs.
- **Doctor**: `npm run doctor [-- --fix]` diagnoses network blocks, parser
  drift, playwright/ffmpeg deps, corrupt/stale SQLite cache, and server boot —
  and applies the mechanical fixes.
- **Update notification**: once-daily npm registry check at startup with a
  stderr notice on older versions; `AWWWARDS_AUTO_UPDATE=1` opts into
  background self-update.
- **New skills**: `awwwards-doctor` (repair) and `awwwards-motion-study`
  (capture → review → build), alongside `awwwards-inspiration`.
- **Fix**: `parseElements` re-anchored after live awwwards.com element-blob
  markup change (broke `get_site_elements` on 2026-09-18); new offline
  fixture covers the broken shape.

## v1.0.0 — 2026-09-18

First public release: search_sites / get_site_details / get_site_elements /
list_categories / capture_live_site / analyze_page_structure /
record_site_motion, local index (`awwwards-index`), awwwards-inspiration skill.
