# Changelog

> **Versioning note:** every release through v1.6.0 was an **alpha**;
> `v1.0.0-beta.1` was the beta. `v1.0.0` is the first **stable** release.

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
