---
name: recreate
description: Recreate a website from a link — evidence-driven reconstruction with the awwwards MCP. Use when the user says "recreate this site", "clone this page", "rebuild <url>", or gives a URL and asks to build it. Produces a faithful hand-built implementation (HTML/CSS/JS + GSAP/Lenis as the reference demands), QA-verified against the live site, then optionally converted into a Vite/Astro/Next project.
---

# Recreate a website from a link

Input: one URL (`$ARGUMENTS`). Follow the phases in order; do not skip the evidence steps.

## Phase 0 — Study-build terms (mandatory, every run)

This is a **local study build**: recreate the reference exactly — layout, text, images, fonts, audio, motion. In exchange, every output MUST ship the disclaimer:

1. **README.md in the build** must state, prominently: the design, copy, images, fonts and audio belong to the original owners; this build is a private study/reference recreation; **it must not be deployed, published, sold, or presented as your own work**; publishing requires replacing every borrowed asset (list them) and obtaining licenses.
2. **Header comment in the HTML** repeats the same notice in one line.
3. **Provenance list**: every borrowed asset path + source URL enumerated in the README.
4. If the user later wants to publish, that is a separate brief: replace assets → publish. Never quietly drop the disclaimer.

Scope: whole page or specific sections? A continuous scroll-narrative (fixed stage + long spacer) is one unit — do not force per-section pages onto it. Target: single-file build by default; **conversion is offered after QA, never assumed** (see Phase 4).

## Phase 1 — Evidence (free MCP, all read-only)

> **Any URL works, but check Awwwards first.** Step 1 is always `search_sites` with the site's domain/name. If the site is listed → `get_site_details` for its recorded DNA (palette, tech, elements, awards) and carry that into the report. If no match → say so once and continue: only the search/index tools are Awwwards-sourced; every capture tool below runs on any public link, and the live evidence still gives you everything.

- `analyze_stack <url>` → framework + CSS + libs (tells you whether the reference is Webflow/Next/static and which motion libs matter).
- `analyze_page_structure <url>` → bands (section order + heights). If bands collapse into a giant, `capture_component` with explicit id/class selectors instead.
- Per section: `capture_component <url>` with `selector` (id/class), `maxNodes` up to 2000 → geometry, 44 computed style keys, pseudo-elements, inline SVG, text, imgSrc, fonts, colors.
- Motion: `analyze_scroll_map <url>` (keyframes + `gsapTriggers` numerics; `scrubProbe` on for scrubbed narratives), `analyze_hover_census <url>` (during-hover `activeAnims`), `get_motion_dna <url>`.
- Canvas/WebGL hero: `capture_pose_3d` → frames/grid; keep `build_pose_stub` output as the camera reference.
- Screenshots: `capture_live_site` full-page + at each scroll anchor from the band map (this is your QA ground truth, not decoration). It waits out full-screen preloaders by default. If `analyze_page_structure` returns `scrollRoot`, the page scrolls an inner container: anchor screenshots must drive that container, not `window`, and `capture_live_site` full-page is viewport-only on such pages - capture per anchor with Playwright/your QA script instead of trusting the full-page image.
- Mechanism unknown after all evidence? `analyze_bundle <url>` (≤40 chunks, 1 req/s, keyword grep, optional webcrack) — understand *how*, still write your own code.
- API shape: export the network log as a HAR and run `analyze_network_capture <path>` — grouped endpoints and path templates only, no bodies/headers/secrets. Already have the page open in Chrome? `analyze_page_structure` with `cdpEndpoint` scans it without driving it (requires `AWWWARDS_MCP_ATTACH=1`; never navigates, scrolls, clicks or creates tabs).

## Phase 2 — Build

- One HTML file + CSS + JS matching the reference's own approach: vanilla for static sites; GSAP + ScrollTrigger + Lenis when the DNA shows them.
- Wire motion from the **measured** values: census durations/easings/triggers, `gsapTriggers` pixel start/end, keyframe from/to values, scrub curves. Do not invent easings the census didn't show.
- Continuous-scroll narratives: fixed viewport-size stage + long invisible spacer + one scrubbed master timeline; layer switching and `--bg` custom property tweens; reduced-motion mode collapses to a calm stacked document (always ship it).
- Structure: semantic ids per section (`#hero`, `#work`), local `vendor/` for libs (strict load order: gsap → ScrollTrigger → lenis → app.js), local `assets/` for fonts/audio/covers/images — **exact assets, copied in**.
- All links `target="_blank" rel="noopener"`, metadata + OG + JSON-LD updated.

## Phase 3 — QA gate (do not declare done without it)

- Playwright: 390, 768, 1024, 1440, 1728 widths; screenshot every scroll anchor (match the reference capture); compare compositions side by side. For inner-scroll pages (`scrollRoot`), drive the container's `scrollTop` at each anchor; do not assert against a `capture_live_site` full-page shot, which is viewport-only there.
- Zero console errors, zero 404s, zero horizontal overflow; assert element bounds (name width, card count/hrefs, contact block) at 1440 and 390.
- Reduced-motion pass at 1440: stacked layout, no overflow.
- Interaction parity: `verify_flow { buildUrl, referenceUrl, steps }` replays the same 1–6 scroll/click/wait steps and reports per-step `same`/`changed`/`unknown` — use it when a menu, accordion, modal or hover-revealed panel is part of the reference; treat `unknown` as unverified, not as a pass.
- If anything drifts from the evidence, fix and re-shoot — one anchor at a time (section-loop discipline).

## Phase 4 — Optional project conversion (ask first)

The rebuild is a valid deliverable on its own. After Phase 3 passes, **ask the user**:

> Keep it as a single-file build, or convert it to a project — Vite (plain HTML/CSS/JS, no components), Astro (HTML components), or Next.js (React components)? And if converted, keep the original scripts or switch to authored motion (`--authored`)?

Do not convert unprompted. Do not pick a framework for them. If they say "just build it", stop at Phase 3 + handoff.

When they choose:
1. `awwwards-build-project <file.html> --target vite|astro|next --out <dir>` → native structure: real section components, shell chrome, split CSS (`tokens.css` + `site.css`), ordered libs, head metadata/boot replayed.
2. If they chose authored motion: `--authored --motion <census.json>` — site logic scripts dropped, head boot + animation libs kept, `motion.manifest.json` carries measured per-section + page triggers. Then author the motion (see `motion-authoring`), recording any authored rows explicitly.
3. Gate: `npm install && npm run build` per target, serve, re-run Phase 3 anchors **plus a 390×844 mobile smoke** and reduced-motion; zero errors/404s.

## Phase 5 — Handoff

Always deliver a **reference report** — even if the user only asked for information and no build: detected stack + libs (`analyze_stack`, `get_motion_dna`), section map with heights/backgrounds (bands), motion summary (triggers, easings, durations, scrub/pin), asset inventory (fonts, images, audio), and bundle notes when `analyze_bundle` ran. For non-Awwwards links this report *is* the value when a build is out of scope.

If a build was produced: README with run instructions, the **mandatory study-build disclaimer** (copyright belongs to the original owners; no deploy/publish/production use; not presented as your own), full provenance list of borrowed assets, and the replace-before-publish plan if the user later wants to ship. Report: reference URL, evidence tools used, section map, QA matrix results, residual gaps.

## Known limits (say them out loud)

- WebGL/canvas interiors are opacity: reference frames only.
- Webflow IX2 / JS-driven initial states are recoverable as behavior evidence but not as their runtime — re-implement with your own JS (N2 authored mode proves the shape; vendor-bundle interpretation stays manual).
- `--authored` keeps head inline scripts even if they may be site logic (warned when >2 KB or animation-looking) — verify before shipping.
- Generator `pageTriggers` cover unattributed census rows; a page-level hook still needs authoring before it animates.
- Fonts: only ship if owned → self-host; otherwise match the closest licensed face.
