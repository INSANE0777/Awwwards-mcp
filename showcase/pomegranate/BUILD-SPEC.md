# Pomegranate Health — build spec (from live evidence)

Reference: https://pomegranate.health/ · Awwwards Honorable Mention, Jul 26 2025.

## Stack of the original
Vue 3 + Vite, custom CSS (UnoCSS-style utilities), anime.js v4 (SplitText + onScroll),
`@rive-app/canvas-lite` 2.27.2 with six `.riv` illustrations. PWA manifest.

## Tokens (computed at 1440)
- ink `#3A001D`, paper `#FFFAF0`, cream `#F7EFDF`, cream-warm `#FAE3B7`
- pink `#FF6F89`, red `#EA3D5B`, berry `#9A1436`, plum `#730F34`, accent `#FECB66`
- Fluid type scale `--step--2 … --step-10` (Utopia clamps, extracted verbatim)
- Fluid space scale `--space-3xs … --space-5xl` (extracted verbatim)
- Radius: 32 card, 24 raised, 9999 pill. Hard shadow `0 12px 0 #3A001D`.

## Page (desktop 1440, doc height 7367)
- Fixed header, margin-top 39px, h 76: left "Learn more" pill, centered logo, right CTA pill.
- Hero card (`.ui-card --hero`, radius 32, 2px ink border, margin-top 74):
  4 stacked rects (#FF6F89 y0 / #EA3D5B y67.2 / #9A1436 y115.2 / #F7EFDF y144), cream gradient body,
  pomegranate icon 64x72, dark tag, h1 80px Gliker, paragraph 890px, 3 phones (video + 2 png) rising on scroll.
- Features (x outer max 1510, px 84, py 42, 2-col grid, gap 84):
  1 text|media 870x458 · 2 media|text 732x496 · 3 text|media 625x562 ·
  4 large card (1813x585 canvas, centered) · 5 text|media 823x651 · 6 media|text 724x526.
- Footer (#EA3D5B) with flipped gradient rects (#C21937 y0 / #9A1436 y56 / #730F34 y96 / #FFFAF0 y120, rx 64),
  stacked logo (ink under, cream over, scaleY 1.035), bubble heading 64px, CTA #FECB66, phones, bar #9A1436 radius 24 shadow 0 12px.

## Motion (measured)
- Heading words: SplitText words, scaleY .8→1 + opacity 0→1, 1800ms outElastic(1.3,.4), stagger 60,
  autoplay at `center+=3em top` when scrollable, hero at +500ms.
- Text: opacity 0→1, 300ms linear, stagger 250 (start 200/800).
- Tag: scaleX .66→1 + opacity, 1200ms outElastic(1,.5), delay 80, on scroll.
- Media (jpg): y 20%→0 + opacity, 1500ms outElastic(1,.8).
- Phones: y 100%→0, scroll-synced (sync .5), outExpo, stagger 50.
- Header when fixed: scale 33%→100% + opacity 800ms outElastic(1,.8), stagger 200 start 1000.
- Menu buttons: scale .9→1, 700ms outElastic(1,.8), stagger 25 start 25.
- Rive: autoplay, artboard "Artboard", state machine "State Machine", Fit.Cover/Center,
  lazy create at 800 + index*100 ms, 50ms opacity fade, `isActive` input set on enter.

## Responsive (measured against the live reference)

- Header: `position: fixed`; buttons anchored left/right, logo is a separate centred block
  (467×76 at y39 on desktop, 316×51 at y27 at 390) so it scrolls away while the buttons stay.
  Below 1024 the buttons pin to the bottom (56 round toggle + 54 CTA), the logo stays on top.
- CTA pill is berry `#9A1436` with white text; "Learn more" is white with a 2px ink border,
  both with the `translateY(-.17em)` ink slab behind.
- Feature grid: one column below 768, two columns (gap 84) at 1024+.
- Rive canvases never shrink to the column: full artboard width at 768+ (overflowing the column,
  clipped by the page) and **2/3 of the artboard below 768** (390: 574×302, 483×327, 412×371,
  1197×386, 543×430, 478×347). Drawing surface is 2× CSS (1740×916 for 870×458), as on the reference.
- Gradient band stacks: the reference triples its SVG geometry below 768 (`viewBox` 1440×528,
  rects y 0/201.6/345.6/432) so the bands stay ~132px tall (150px for the footer, 552 viewBox).
  Reproduced with `preserveAspectRatio="none"` + `min-height` on the SVG.
- Menu: sheet 1316×356 at 1440 (white, 2px ink, radius 24, 4-column grid, items 160/327 tall,
  icon chip 43px, title 19.3px, desc 15.3px, card fill #FDF8EE); below 1024 it becomes a 2-column
  grid, below 640 a stacked list of 335×74–94 cards with the icon left of the text.

## Assets
Fonts TTCPro (variable) + Gliker SemiCondensed 400/600 (woff2), pomegranate icon + wordmark SVG,
phone-1 mp4 + 2 phone pngs (phone-mask.svg mask), 6 `.riv`, og image.

Fonts, masks and the Rive wasm/`.riv` payloads are also embedded as data URLs
(`css/fonts.css`, `vendor/rive/rive-data.js`, mask data URIs in `css/site.css`) so `file://` works.
