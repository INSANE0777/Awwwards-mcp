# Pomegranate — study recreation

**Reference:** <https://pomegranate.health/> — Awwwards *Honorable Mention*, 26 Jul 2025.
Built from live evidence (full-page captures, per-section HTML, computed CSS tokens, network log), not from screenshots.

---

## ⚠️ Study build — not for publication

The design, copy, illustrations, fonts, video and imagery in this folder belong to
**Pomegranate Health / Really Intelligent Ltd** (and its designers and licensors).
This folder is a **private study/reference recreation** made to learn how the page is built.

- **Do not deploy, publish, sell, or present this as your own work.**
- Publishing it as-is would infringe copyright and trademark (wordmark, product name, copy).
- To publish anything derived from it, **replace every borrowed asset** (list below) and obtain licences
  for the typefaces and illustrations — that is a separate brief, not a continuation of this one.

The same notice is repeated in a comment at the top of `index.html`.

---

## Run it

No build step and no server needed — self-contained enough to double-click:

```text
index.html            → works straight from disk (file://)
```

The browser blocks `file://` XHR for most builds; here the woff2 fonts, the phone/logo
mask SVGs and the Rive runtime payload (wasm + six `.riv` files) are embedded as data URLs
(`css/fonts.css`, `vendor/rive/rive-data.js`), so the page, fonts and illustrations render
from disk. Any static server also works if you prefer one:

```bash
python -m http.server 4173        # then open http://127.0.0.1:4173/
# or: npx serve .
```

```text
index.html            page markup (semantic sections, one file)
css/fonts.css         generated: TTCPro + Gliker woff2 as data URIs
css/site.css          tokens + layout + components (all classes mirror the reference naming)
js/app.js             anime.js reveals, scroll-synced phones, menu, Rive mounting
vendor/animejs/       anime.js v4.0.2 (MIT)
vendor/rive/          @rive-app/canvas-lite 2.27.2 + rive.wasm (MIT) + rive-data.js (generated data URLs)
assets/               fonts, images, video, .riv illustrations
evidence/             captures, extracted CSS/HTML, probes and QA screenshots used to build this
evidence/qa/qa.mjs    Playwright QA: 1440 / 768 / 390 / reduced motion + menu
BUILD-SPEC.md         measured spec: tokens, geometry, motion values
```

---

## What the reference is made of

| Layer | Reference | This recreation |
|---|---|---|
| Framework | Vue 3 + Vite, PWA | plain HTML/CSS/JS |
| CSS | custom utility layer (`--ui-*`, `--type-*`) + fluid Utopia tokens | same token values, same class names, hand-written CSS |
| Motion | anime.js v4 (`onScroll`, `stagger`, elastic eases) | anime.js v4.0.2, same values |
| Illustration | Rive, 6 `.riv` files, `@rive-app/canvas-lite` 2.27.2 | same runtime + same files |
| Type | TTCPro (variable), Gliker SemiCondensed 400/600 | same woff2 files |
| Phones | 1 mp4 + 2 pngs, masked by `phone-mask.svg` | same files, same mask |

### Page map (desktop 1440)

| # | Section | Height | Notes |
|---|---|---|---|
| — | fixed header | 76 | 39px from top, "Learn more" pill / centred wordmark / CTA pill |
| 1 | hero card | ~1345 | 4 stacked gradient bands, icon, dark tag, h1 80px Gliker, 890px paragraph, 3 phones |
| 2 | Always looking ahead | 542 | text left, Rive 870×458 right |
| 3 | Learning about you | 580 | Rive 732×496 left, text right |
| 4 | Compare yourself | 645 | text left, Rive 625×562 right |
| 5 | Personal health intelligence | 1237 | large cream card, Rive 1813×585 inside |
| 6 | Healthcare is more than insurance | 735 | text left, Rive 823×651 right |
| 7 | Your health. Your data. | 609 | Rive 724×526 left, text right |
| — | footer | ~1413 | flipped gradient stack, layered wordmark, bubble headline, CTA, phones peeking, bar |
| | **document** | **7367** | build: 7415 (within 0.7%) |

### Motion values (measured, not invented)

- Heading words: `scaleY .8→1`, opacity 0→1 (75ms linear), 1800ms `outElastic(1.3,.4)`, stagger 60,
  scroll entry `center+=3em top`; hero plays 500ms after load.
- Body copy: opacity 0→1, 300ms linear, stagger 250.
- Tags: `scaleX .66→1` + opacity, 1200ms `outElastic(1,.5)`, delay 80, on scroll.
- Phones: `y 100%→0`, `outExpo`, stagger 50, `onScroll({target, sync:.5})`.
- Header: `scale .33→1` + opacity, 800ms `outElastic(1,.8)`, stagger 200, start 1000.
- Menu items: `scale .9→1`, 700ms `outElastic(1,.8)`, stagger 25, start 25.
- Rive: autoplay, lazy-mount at `800ms + index×100ms` on intersection, `Fit.Cover` / `Alignment.Center`.
- Reduced motion: one calm document — no reveals, static illustration frames (played ~1.4s then paused), no parallax.

---

## Provenance — every borrowed asset

All URLs below are on `https://pomegranate.health/` unless stated.

| Local path | Source |
|---|---|
| `assets/fonts/TTCPro.woff2` | `/assets/TTCPro-ed9ac02e.woff2` |
| `assets/fonts/Gliker-Regular.woff2` | `/assets/Gliker-RegularSemiCondensed-315ea8e4.woff2` |
| `assets/fonts/Gliker-SemiBold.woff2` | `/assets/Gliker-SemiBoldSemiCondensed-d695c20d.woff2` |
| `assets/img/pomegranate-logo.svg` | `/assets/pomegranate-logo-71304675.svg` |
| `assets/img/pomegranate-icon.svg` | `/assets/pomegranate-icon-dfadad6d.svg` |
| `assets/img/phone-mask.svg` | `/assets/phone-mask-f191834c.svg` |
| `assets/img/phone-2.png` | `/thumbs/pinkphone-crop-99599_phone.png` |
| `assets/img/phone-3.png` | `/thumbs/phone-3-46773_phone.png` |
| `assets/img/og.jpg` | `/thumbs/og-68657_opengraph.jpg` |
| `assets/img/favicon-32.png` | `/thumbs/favicon-88699_favicon-32.png` |
| `assets/video/phone-1.mp4` | `/api/media-stream/phone-1-v2-3034.mp4/` |
| `assets/rive/feature-1.riv` | `/uploads/feature-1-15351.riv` |
| `assets/rive/feature-2.riv` | `/uploads/feature-2-v2-84416.riv` |
| `assets/rive/feature-3.riv` | `/uploads/feature-3-v2-58293.riv` |
| `assets/rive/feature-4.riv` | `/uploads/feature-4-69534.riv` |
| `assets/rive/feature-5.riv` | `/uploads/feature-5-v3-55153.riv` |
| `assets/rive/feature-6.riv` | `/uploads/feature-6-566.riv` |
| All body copy, headings, tag labels | the live page's rendered text |
| Layout, tokens, motion values | the live page's computed styles and bundles |

**Not borrowed:** the CSS is hand-written (values measured from the reference, code not copied), the JS is
hand-written, and the Vue application code is not included.

Third-party libraries (both MIT, vendored unmodified):

| Local path | Package | Licence |
|---|---|---|
| `vendor/animejs/anime.iife.min.js` | `animejs@4.0.2` | MIT — © Julian Garnier |
| `vendor/rive/rive.js`, `vendor/rive/rive.wasm` | `@rive-app/canvas-lite@2.27.2` | MIT — © Rive Inc. |

Generated files (same source assets, base64-embedded so `file://` works):
`css/fonts.css` (the three woff2 above), `vendor/rive/rive-data.js` (the wasm + six `.riv` above),
and the two mask data URIs inside `css/site.css` (`phone-mask.svg`, `pomegranate-logo.svg`).

---

## QA results (evidence/qa/, script: `evidence/qa/qa.mjs`)

Playwright, Chromium. Latest run compares against the live reference at the same widths.

| Check | 390 | 768 | 1440 | 1440 reduced |
|---|---|---|---|---|
| horizontal overflow | none | none | none | none |
| document height (reference) | 7961 (7910) | 6823 (6825) | 7374 (7367) | 7374 |
| console errors | 0 | 0 | 0 | 0 |
| failed requests / 404s | 0 | 0 | 0 | 0 |
| Rive canvases mounted | 6 | 6 | 6 | 6 |
| Rive drawing surface | 1148×604 … | 1740×916 … | 1740×916 … | 1740×916 … |
| header | fixed bottom, 56 round + 54 CTA | fixed bottom | 76 tall at y 39 | 76 |
| logo | 316 wide at y 27 | centered | 467 wide at y 39 | same |
| hero h1 | centred, 5 lines | centred | 1080 wide, Gliker 80px | same |
| footer bar | 316 wide, 134 tall | 676 | 1316×87 | 1316×87 |
| menu | logo-less list, 6 icon cards | 2-col grid | 1316×356 sheet, 4-col grid, 6 icons | same |
| illustrations visible | yes | yes | yes | yes (static frames) |

Measured against the reference at 1440: header 39/76 ✅, feature text column 594 wide at x84 ✅,
h2 64.3px Gliker ✅, body 21.5px ✅, card radius 32 / 2px ink border ✅, footer bar 1316×85 ✅,
canvas sizes 870×458 / 732×496 / 625×562 / 1813×585 / 823×651 / 724×526 ✅ (exact).

At 390 the reference keeps every illustration at 2/3 desktop size and lets it bleed off the
column (canvas 574×302 etc.); this build reproduces that, which is where most of the page height
comes from. Below 640 the reference also triples the gradient band geometry — the recreation's
`min-height` on the gradient SVGs matches the measured 132/150px stacks.

`file://` smoke test: 0 console errors, 0 failed requests, all three fonts loaded, 6 Rive
canvases at 2x, masks applied.

Screenshots: `evidence/qa/*-full.png`, menus `evidence/qa/*-menu.png`, element crops in `evidence/qa/els/`,
reference-vs-build pairs in `evidence/qa/compare/`.

---

## Known gaps / limits

- **Mobile paragraph breaks**: the reference hides its `<br class="--type-nl2br">` below 768px and
  renders "health.See" with no space; this build keeps the break, so two paragraphs run one line
  longer at 390 (+48px on a 7900px page).
- **Hero phone peek** is a few percent further along at scroll 0 than the reference (its scroll-progress
  mapping is internal to its animation setup; the stagger and easing match).
- **Live content differences** — the site currently shows "Your personal health intelligence platform";
  the Awwwards snapshot from July 2025 shows the earlier "Finally, Really Intelligent Healthcare" hero.
  This build follows the live page.
- **Menu**: icons and the sheet/card geometry are taken from the reference's menu DOM; link descriptions
  were read from the reference markup, but the mobile reference hides its close/CTA row behind the
  list, so this build keeps its own close button visible at the top.
- **Form** is not rebuilt: "Register your interest" links to the original Typeform, as on the reference.
- Rive illustrations are the original files played with the runtime defaults — artboard/state-machine
  names are left to the files, so no authored state inputs are guaranteed beyond autoplay.
- No `prefers-color-scheme` variant exists on the reference; none here.

## If you ever want to publish this

1. Replace the six `.riv` illustrations, phone mockups/video, wordmark/icon and OG image with licensed or
   original artwork.
2. License or substitute the typefaces (TTCPro and Gliker are commercial).
3. Rewrite all copy — the headlines and body text are the original's.
4. Remove the Pomegranate name/marks, then re-run the QA matrix.
