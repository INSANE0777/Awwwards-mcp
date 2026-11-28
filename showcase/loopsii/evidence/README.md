# Evidence and QA — Loopsii study recreation

Reference: **https://loopsii.com/**  
Captured: **21 November 2026** — build QA: **22 November 2026**  
Viewport used for the desktop pass: **1440 × 900**.

## Tools used

- Awwwards MCP: `search_sites`, `get_site_details`, `analyze_stack`, `analyze_page_structure`,
  `capture_live_site`, `analyze_scroll_map`, `analyze_hover_census`, `get_motion_dna`.
- Playwright (system Chrome) for reference scroll frames, build frames, geometry probes and interaction checks.
- The reference's public HTML/CSS was inspected for tokens and content; no copied source ships in this folder.

## What the evidence said

- **Stack:** Astro static page, Tailwind utility CSS, Lenis smooth scroll, CSS keyframe pulse rings.
  No GSAP ScrollTrigger registry (`gsapRegistryCount: 0`); the page is mostly CSS sticky + JS scroll maths.
- **Palette:** `--color-grey #f0f0f0`, `--color-main #c4f041`, `--color-lime-light #e0f661`,
  `--color-coral #fa8e66`, `--color-apricot #f3bd77`, `--color-sky #bce6fa`, `--color-steel #9ec3d5`,
  `--color-sage #aac2aa`.
- **Type:** Saans VF (body/headings), Caveat VF (handwritten notes). Headline scale on the site:
  `h1 100×u`, `h2 74×u`, `h3 54×u`, where `u = clamp(0.625px, 100vw/1920, 1.333px)`.
- **Grid:** 12-column main grid, `--cont: 40×u` side padding. The stack diagram uses an 8×180px cell grid
  (8×9 cells at 1440). The hero shape field is an 11×3 crop of a 21-column field.
- **Reference section heights at 1440:** hero 872, intro 2250, distraction 2700, app demo 2414, stack 2268,
  highlights 3089, folders 759, features 2862, testimonials 705, pricing 833, roadmap 3600, waitlist 759,
  FAQ 822, outro 555, footer 900 (document 23,825).
- **Build section heights at 1440:** hero 900, intro 2250, distraction 2700, app demo 2385, stack 2207,
  highlights 3039, folders 766, features 2894, testimonials 671, pricing 830, roadmap 3600, waitlist 759,
  FAQ 639, outro 508, footer 900 (document ≈23,246). The app demo was shortened from 2700 to 2385 to match the
  live stack offset (build stack top −365 vs live −364 at scroll 6800).

## Preloader spec (from the live site)

The live loader is a DOM loader, not a canvas or video:

- `.loader` fixed inset 0, lime `--main` sheet (`.loader_sheet`), `z-index: 5`.
- `.loader_box` is a 290×u square (218×218 at 1440) centred in the viewport.
- Four 8px black dots sit at `40×u` from the viewport corners, then fly to the box corners (1.1 s, stagger 0.04).
- Four 1px rules grow from the box edges to full bleed (`scaleX/scaleY` 1 s, delays 0.55/0.65).
- `.loader_frame` is a 1px black inset border, fading in at 1.2 s.
- `.loader_counter` is Caveat, `40×u` from the bottom, tabular numerals, reading `000 %` → `100 %`
  over 1.9 s with a `power2.inOut` ease starting at 0.3 s.
- The mark is three Lottie files: `logo-left.json` + `logo-right.json` compose the double-loop loader mark at
  `0.36 × cell` (56×48 at 1440); `logo-loop.json` is the hero mark.
- Exit: counter fades, the mark moves and scales to the hero coral loop (0.8 s), the sheet lifts −100%
  (1 s), the hero shapes scale in from the centre with distance-based delays, then the nav and hero type reveal.
- Reference timings at 1440: ready ≈3.1 s, counter 0→100 3.2–6.6 s, clear 6.9 s, sheet lift 7.3–8.3 s,
  hero visible 8.0 s. The build's absolute times depend on font/Lottie load; the step durations match, and the
  final QA run completed the loader in ≈6.3 s.

## Motion model

The live page's `Layout…js` bundle dynamically imports a `home…js` chunk that registers GSAP 3 with ScrollTrigger,
ScrollSmoother, SplitText, DrawSVG, MorphSVG and MotionPath, runs through Tempus, and drives one class per section
(`hero`, `heroElements`, `intro`, `distraction`, `appDemo`, `stack`, `highlights`, `incomeGauge`, `chaptersBoard`,
`timelinePlan`, `requestsFeed`, `agentChat`, `dictationDemo`, `features`, `testimonials`, `folders`, `roadmap`,
`pricing`, `faq`, `outro`). The bundle was read for exact triggers, transforms and easings; it is not shipped.

This build re-creates the visible beats in vanilla CSS/WAAPI + one scroll rAF (`js/motion.js`):
the hero field runs a 21-column shuffle with shape pops and a compact gather; the intro logo is a fixed clone that
interpolates from the hero loop into the intro while the h2 waits behind it; split headings use masked word spans;
the stack draws each rule, pops cards per row and orbits its pills around a giant lime mark; highlight cards get
depth scale/rotation and the gauge counts up; the app-demo title shrinks from ~125 px to 55 px while the dashboard
rises; the 18 feature SVG glyphs run per-icon vector timelines (spin, slide, bars, pulse). No GSAP is loaded.

### Motion inventory

| Section | Live trigger | Live transform | Build |
| --- | --- | --- | --- |
| Hero field | continuous timeline, repeat −1 | cells move between grid slots, shape swap, 3-column compact | 720 ms cell moves, shape pop, compact every 7 steps |
| Hero → intro | scrub from `main` to intro bottom | logo scale/translate from hero loop to intro logo | fixed intro logo interpolated by intro top; hero loop faded |
| Intro | enter / scrub | word masks, orbit on `#intro-orbit-path` (40 s), scale-in | masked words; computed circular orbit |
| Distraction | scrub | tags/parentheses fly from centre; shader blur/zoom | tag class with offsets; CSS blur/scale |
| App demo | scrub | title `--progress`: font-size `74 + boost·(1−p)`; WebGL reveal; stage rise | title font-size 124.8 → 83.9 → 55.5 px at y 414 → 395 → 144; stage rise lowered; no shader |
| Stack | enter + scrub | per-line draw, cards pop/count, brands cycle, loop mark/ring/pills draw/orbit, `$120` hub | per-line IO draw, per-card IO pop, count-up, brand timer, pill orbit, giant lime mark + ring, `$120` hub |
| Highlights | sticky + scroll | cards scale 0.82/rotateX −8°, frame/text fade, gauge drifts | card scale/rotate by overlap; gauge 0→$7,100 |
| Feature glyphs | enter | inline SVG per-icon GSAP timelines (spin, slide, drawSVG) | inline SVG per-icon vanilla timelines (spin, slide, bars, pulse), 3D card entrance |
| Folders | enter / hover | folders fan and lift | stagger entrance + hover fan |
| Testimonials / roadmap / outro | carousel, wheel, scroll | paper frames, rotating wheel, pixel field | faded neighbours, snapped cards, waves/particles |

## QA matrix

| Width | Height | Horizontal overflow | Console errors | 404s | Result |
| --- | --- | --- | --- | --- | --- |
| 390 | 844 | 0 | none | none | pass |
| 768 | 1024 | 0 | none | none | pass |
| 1024 | 768 | 0 | none | none | pass |
| 1440 | 900 | 0 | none | none | pass |
| 1728 | 1080 | 0 | none | none | pass |

Checks performed:

- Preloader: lime sheet on first paint, four corner dots, crosshair, 218px frame, `000 %` counter reaching
  `100 %`, full double-loop mark, handoff into the hero coral loop, no layout jump.
- Hero field: cells move between slots, shapes change, a compact gather and expand; loop stays centred.
- Intro: the intro coral loop starts exactly over the hero loop (26 px at 390, 105 px at 1440), travels to the
  intro centre, the orbit items scale in around it, and the h2 reveals over/behind it.
- Stack: grid lines draw in as their row/column enters; cards pop per card; stats count up; the giant lime mark,
  dashed ring, pills, badge, stem and `$120/yr` hub card arrive when the loop enters.
- App demo: the title measures 124.8 px at scroll 4300, 83.9 px at 4800 and 55.5 px at 5300 (live: 124.8 / 80.6 /
  55.5), moves from y 414 to 144, and stays above the rising dashboard.
- Features: 18 inline SVG glyphs are present and animated; e.g. `client-portal` `Null 7` x moves 296 → 398 over
  ~1.1 s, `reusable` spins, dictation bars breathe; cards enter with rotateX and all become `is-in`.
- Full scroll pass at each width with no horizontal overflow (`scrollWidth − innerWidth = 0`).
- Console + network listener: zero errors and zero failed requests after the fixes.
- Testimonials: next arrow advances `01 → 02` and updates the live status.
- Pricing: yearly switch sets `.is-yearly`, `aria-checked="true"`, and the yearly card becomes visible.
- FAQ: opening item 3 closes item 1 and updates `aria-expanded`.
- Cookie notice: OK hides the banner and stores the choice.
- Footer video: plays when the footer intersects (`paused: false`).
- Reduced motion (`prefers-reduced-motion: reduce`): page renders with the calm stacked layout,
  no overflow. The loader is reduced to a short sheet lift.

## Evidence files

- `reference/` — nine ordered live-site frames at 1440.
- `reference/loader/` — seven live preloader frames: corners, counter, full box + mark, 100 %, handoff, hero.
- `reference/motion/` — ten live motion frames: hero shuffle, intro travel/orbit, stack 6800, stack loop 7400,
  gauge, feature glyphs, app title 4800/5300, distraction.
- `build/` — the matching build frames after the fixes.
- `build/loader/` — five build preloader frames: sheet, counter, mark, handoff, hero, plus `compare.png`
  (reference vs build side by side).
- `build/motion/` — build motion frames: hero shuffle/compact, intro travel/orbit, stack 6800/loop 7400, gauge,
  features 12700/13500, app title 4800/5300, mobile intro/hero, plus `hero-motion.gif`, `intro-motion.gif` and
  `features-motion.gif` clips of the animated passages.
- `mobile/` — three reference mobile frames and three build mobile frames.
- `qa/` — the latest responsive pass at 390 / 768 / 1024 / 1728 after the preloader work, plus
  `final-check.json`, `interactions.json`, `responsive-log.txt` and `motion.json` (hero, intro travel, stack,
  gauge, features and reduced-motion state checks) for the final run.
- `tools/` — the Playwright scripts used to capture frames, probe geometry, test interactions and re-run the
  responsive matrix (`qa.mjs`, `qa2.mjs`, `qa-responsive.mjs`, `final-check.mjs`, `interactions.mjs`,
  `motion-check.mjs`). They wait for `body.is-loaded` before measuring, so the preloader is never mistaken for the
  page. They require `playwright` installed in the folder to run; they are evidence, not part of the served site.

## Residual gaps (also listed in the top-level README)

- The loader mark scales/fades in instead of the 4-frame Lottie draw; the composition and handoff match.
- The reference's GSAP/ScrollTrigger/ScrollSmoother/SplitText/DrawSVG/MorphSVG layer is approximated with vanilla
  CSS/WAAPI; the WebGL portrait shader and app-demo reveal are not reproduced.
- Feature glyphs are inline versions of the reference SVGs with a vanilla port of its per-icon timelines; the
  drawSVG trim loops are approximated with a pulse and the meetings/dictation loops are simplified.
- Hero shape and feature glyph changes are pops, not path morphs.
- The interactive product demo is a static mock; the original is a functional demo.
- Testimonial paper/wireframe motion and the nav overlay panel are simplified.
- The dashboard mock's smallest typography is approximate.
- The footer video and Lottie JSON are the reference's own files and are only suitable for a private study.
