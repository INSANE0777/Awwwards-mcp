# Neutomni — private study recreation

> **STUDY / REFERENCE BUILD — DO NOT PUBLISH.**
>
> The design, layout, copy, photography, video, fonts and all visual assets in this
> project belong to **Neutomni** (https://neutomni.com/) and their respective
> licensors. This is a **private, non-commercial study recreation** made to
> understand and practise the original's art direction and motion.
>
> **It must not be deployed, published, sold, sublicensed or presented as original
> work.** Publishing anything derived from it requires replacing every borrowed
> asset listed below and obtaining the appropriate licences. This project is not
> affiliated with, endorsed by, or connected to Neutomni.

A hand-built recreation of the **neutomni.com** homepage: the "cut along line"
preloader, the fixed wordmark that collapses into a nav, the showreel hero, the
sticky process cards with the rolling polygon canvas, the pinned project gallery,
the Windows XP pricing desktop and the morphing contact/footer.

---

## Run it

The build uses only local files — no build step and no network requests.

```bash
# from this folder
npx http-server -p 4173 -c-1
# then open http://127.0.0.1:4173/
```

Opening `index.html` directly also works in Chrome/Edge. A local server is
recommended for consistent font/video loading.

**Files**

```
index.html
css/style.css
js/app.js
vendor/          gsap 3.15, ScrollTrigger, Lenis 1.3.21 (MIT / GSAP standard licence)
assets/fonts/    four borrowed font files
assets/img/      borrowed imagery + recreated iconography
assets/video/    hero showreel (transcode + original)
evidence/        reference captures, IX2 data, QA scripts and screenshots (internal, not the site)
```

---

## Reference report

**Reference:** `https://neutomni.com/` (captured 23 Oct 2026)
**Stack detected:** Webflow (high confidence) with GSAP 3.15, ScrollTrigger, MorphSVG, SplitText, Lenis 1.3.21, Swiper and CircleType. The site is a Webflow export plus a Slater-loaded module for the morphing CTA.

**Awwwards:** no listing matched `neutomni.com` (empty search), so this report is built from live evidence.

**Evidence tools:** `analyze_stack`, `analyze_page_structure`, `capture_live_site`, `get_motion_dna`, `capture_component`, `analyze_hover_census`, the live Webflow IX2 store (`ixData`) for exact keyframes, plus Playwright scroll probes and screenshots at 390/768/1024/1440/1728.

**Section map (1440 × 900 reference)**

| # | Band | Height | Notes |
|---|------|--------|-------|
| 0 | Hero spacer | 500px | Nav wordmark + fixed h1 |
| 1 | Showcase | 1,800px | Pinned 100vh video, scale .4 → 1 |
| 2 | Process | 5,363px | Marquee, about grid, 4,500px sticky card/canvas stage |
| 3 | Selected Work | 3,600px | Pinned 100vh gallery, 3 masked projects, 2,700px play |
| 4 | Pricing / XP | 9,000px | 1,000vh sticky narrative: pricing page → XP desktop → CRT monitor |
| 5 | Contact | 790px | Pointer-driven morph track (4→24 sides) + dashed line |
| 6 | Footer | 482px | Red, giant wordmark; O loops through seven shapes |

**Motion summary (measured from the live site: Webflow IX2 data + Playwright scroll probes)**

- Hero showreel: scale `0.4 → 1`, y `-100 → 0`, first ~900px of scroll; nav
  wordmark shrinks from full width to 180px; h1 fades at ~5% page scroll.
- Hero landing (after the loader): nav row at 0s, h1 lines at 0.2s with a
  0.10s stagger, hero flex scale 0→1 at 0.4s, local time/CTA at 1.0s.
- Process: `.process_cover` heights `0 → 100%` with end keyframes at 30/45/60/75%;
  canvas rolling 4→12-gon → circle, dashes, catenary road.
- Work: three clip-path polygon reveals, image scales `1.1 → 1 → 1.2`, a ~0.8s
  scrub, direction-aware snapping to the three project labels.
- Pricing: 13 keyframes across the 1,000vh sticky wrapper; cards translate
  `860 → 0` and rotate `180° → 0` staggered at 30–60%; window shrinks to `0.45`
  at bottom-left around 60–66%; the whole computer scales `1 → 0.3`, rotates 6°
  and moves down 100px from 80–95%.
- Contact: mouse-x drives a six-shape morph (4→6→8→12→16→24 sides, 450° roll) across the track, with fading outline trails at each checkpoint, dashed line and reserve link.
- Footer: the red counter-shape inside the O loops shape1→…→shape7→shape1, one second per step with a +60° roll, power2.inOut, then resets.

**Asset inventory / provenance (all borrowed)**

Everything below is copied from the reference's public CDN or site. The local
path is on the left, the original source URL on the right.

### Fonts

| Local | Source |
|---|---|
| `assets/fonts/pp-editorial-italic.woff2` | `https://cdn.prod.website-files.com/696f937263525fd559c6ea5f/69d6543004152005279a44f2_PPEditorialNew-Italic.woff2` |
| `assets/fonts/vazirmatn.ttf` | `https://cdn.prod.website-files.com/696f937263525fd559c6ea5f/69708959fef5e934c74b2781_Vazirmatn-VariableFont_wght.ttf` |
| `assets/fonts/firacode.ttf` | `https://cdn.prod.website-files.com/696f937263525fd559c6ea5f/6996e2a8567ee7b9dd661d52_FiraCode-VariableFont_wght.ttf` |
| `assets/fonts/editorial.otf` | `https://cdn.prod.website-files.com/696f937263525fd559c6ea5f/6970899ddcc21b73dfd850f5_EditorialNew-Regular.otf` |

### Video

| Local | Source |
|---|---|
| `assets/video/hero.mp4` | `https://pub-72fbbd6aa7d54a70b04aaa87235f19c9.r2.dev/Scene-2%20(1)%20(1).mp4` — 5.1 MB 1440×800 / 30 fps transcode; the 46 MB original is kept as `assets/video/hero-original.mp4` |

### Imagery

| Local | Source |
|---|---|
| `assets/img/team.webp` | `.../6a68aa63b30470f3ff48e30d_Group%20483851%20(3).webp` |
| `assets/img/work-pomio.webp` | `.../6a7edd0938121cbf205f879a_Frame%20484276.webp` |
| `assets/img/work-rsb.avif` | `.../69e22c23e07c2726303610f7_Frame%20484304%20(3)%20(1).avif` |
| `assets/img/work-matematica.avif` | `.../69ef56402e38efd97459d475_Mockup%20(72)%20(1).avif` |
| `assets/img/work-slide-pomio.webp` | `.../69ef6b2df0eb90f6f76e7717_Frame%20484311.webp` |
| `assets/img/work-slide-rsb.webp` | `.../69ef6b2b449fc5fec4f8666e_Frame%20484312.webp` |
| `assets/img/work-slide-matematica.webp` | `.../69ef6cd4e7a3820e20dd0962_Frame%20484314%20(1).webp` |
| `assets/img/monitor.webp` | `.../6a68987e814285f163da4f3e_Monitor%20(3).webp` |
| `assets/img/phone.avif` | `.../69d6196b3a985f90f0b8cbfc_Untitled%20Project%20-%20illustrationImage%20(1).avif` |
| `assets/img/xp-html.png` | `.../69ca4fb53287878393b635c4_Group%20116%20(4).png` |
| `assets/img/xp-folder.png` | `.../69b00a6ddf111f169cf2c333_Group%20116%20(1).png` |
| `assets/img/xp-md.png` | `.../69b00a9a3502cd46e577c39a_Group%20116%20(3).png` |
| `assets/img/xp-zefir.avif` | `.../6a140385117bd9c5fd2cd554_IMG_6707%203%201%20(1).avif` |
| `assets/img/xp-natalia.webp` | `.../6a1400ff117bd9c5fd2bfc66_047682%203%201.webp` |
| `assets/img/xp-andrii.avif` | `.../6a14047bc62e80f0d134960a_FilmCam_K%20Funs_20260502_170223235%201.avif` |
| `assets/img/natalia-bg.webp` | `.../69f9a3ae05c3c1e0102dfbe0_047682.webp` |
| `assets/img/andrii-bg.avif` | `.../6a1404f7f9203d414eeea7ad_FilmCam_K%20Funs_20260502_170223235%201%20(1).avif` |
| `assets/img/menu-0..3.png` | `.../69cbebecfd098188c46ff154_Menu%20Bar%20Icons.png` etc. |
| `assets/img/dot-hex.png` | `.../69b0308e4504c24e1e13cfe2_Polygon%2025.png` |
| `assets/img/dot-diamond.png` | `.../69b030a51523ef0b389a277b_Polygon%2026.png` |
| `assets/img/divider.svg` | `.../6996dc77fdc109b630795d58_Divider.svg` |
| `assets/img/divider2.png` | `.../699c2b5f8a927fe43031fa7a_Divider%20(2).png` |
| `assets/img/list-dot-1..3.svg` | `.../6996ce5a...`, `.../6996ce57...`, `.../6996ce54...` |
| `assets/img/qr.svg` | `.../699c25d8ab2fe2e2b2ce2e8b_Group%20105.svg` |
| `assets/img/crosshair.png` | `.../699c2667c97184fe81505288_Group%20107.png` |
| `assets/img/icon-e.png` | `.../699c27610f0eaff6acf1eec3_Group%20111.png` |
| `assets/img/icon-g.png` | `.../699c300995edffbdcecab644_Group%20111%20(1).png` |
| `assets/img/icon-e2.png` | `.../699c30085ab0f97f49850691_Group%20111%20(2).png` |
| `assets/img/arrows.png` | `.../699c27d4d0107831c69e0e82_Vector.png` |
| `assets/img/scissors.png` | `.../69bd455af03722278a958711_Scisors.png` |
| `assets/img/wheel.png`, `wheel-1..4.png` | `.../69c27125089d0b0d55cf0bee_Wheel.png` etc. |
| `assets/img/cookie-close.png` | `.../6aa2a1018163696ce7df2d16_Frame.png` |
| `assets/img/arrow-left.png`, `arrow-next.png` | `.../69d7688447b9fb3d83257020_460000443.png`, `.../69d76881f9d2adcbf1c91450_460000444.png` |
| `assets/img/ellipse.png` | `.../69d769725f1c73b0b29d4c92_Frame%20484299.png` |
| `assets/img/arrow-right.png` | `.../69e61218e9bf98ea868e1e22_%E2%86%92.png` |

The `...` prefix for every CDN asset is
`https://cdn.prod.website-files.com/696f937263525fd559c6ea5f/`.

Also borrowed: the **NEUTOMNI wordmark SVG paths**, the **seven footer-O shape paths** (in `js/app.js`), the colour palette
(`#cf1830`, `#6db1f0`, `#f8f4f4`), the typographic scale, and all site copy
(headlines, process/service/pricing descriptions, FAQ, testimonials, footer
links and microcopy). Those live directly in `index.html` / `css/style.css`.

Vendor libraries: GSAP 3.15.0 + ScrollTrigger (GreenSock standard licence),
Lenis 1.3.21 (MIT). No Webflow runtime, Slater module, analytics or cookie SDK
is included.

---

## What is recreated vs. simplified

**Recreated**

- "Cut along line" preloader with dropping wordmark, dashed cut line, travelling
  scissors, rolling counter and split reveal (duration shortened to ~3.9s).
- Fixed wordmark-to-nav collapse; nav hides on scroll down, returns on scroll up.
- Video showreel with the measured scale/translate motion.
- Hero landing after the loader: the nav row/hamburger slides up at 0s, the h1 lines blur in with a 0.10s stagger starting at 0.2s, the hero flex scales 0→1 from 0.4s, and the local time/Open-for-work fade up at 1.0s.
- Process section marquee, magazine about grid, pinned cards with red fill
  keyframes at 30/45/60/75%, and a procedural canvas that rolls a 4→12-gon into
  a circle over a catenary road with a dashed axle.
- Pinned project gallery: three clip-path reveals, image zoom, active list item,
  pointer-following circular "explore" target with rotating text, direction-aware snapping.
- Pricing narrative: white page → 3D card backs flying/flipping in → blue
  packaging layout → window chrome → XP desktop → CRT monitor → rotation.
- XP desktop: icons, draggable personal/FAQ/testimonials windows, pricing window
  chrome and close, 5 testimonial tabs, code-editor FAQ.
- Plan cards: dashed tear line, generated barcode, price strip, lift-on-hover,
  packaging back with QR, marks and microcopy.
- Contact CTA: pointer-x follows the mouse across the track while the shape morphs through six checkpoints (4→6→8→12→16→24 sides) with a 450° roll and fading outline trails; dashed line and reserve link. The footer O instead loops through seven custom shapes, one second per step with a +60° roll.
- Cookie banner, open-for-work pulse, live Warsaw clock, mobile menu slider.
- Reduced-motion mode: all pins/canvas/timeline motion removed, content stacked.

**Simplified / known gaps**

- The original's MorphSVG tweens are replaced by a procedural six-checkpoint
  polygon morph (CTA) and a radial-sample morph of the seven footer-O paths
  (same visual language, not the exact MorphSVG interpolation).
- The original's Lottie barcode animation and hamburger are replaced with a
  generated barcode and CSS menu icon.
- Subscription/cookie preference panel and analytics are not implemented; all
  three cookie buttons simply dismiss and persist locally.
- Pricing card rise timings are measured approximations; the 15300/16200 states
  match, the 14400 mid-state is slightly behind the reference.
- Mobile is an adapted stacked/step version, not a 1:1 port of Webflow's mobile
  interactions.
- The page uses the 5.1 MB transcode of the 46 MB showreel; the exact 46 MB original
  is kept in `assets/video/hero-original.mp4`. Any public use still needs a licence.
- No XP sound effects, no Webflow page-transition runtime.

---

## QA matrix

Run at `http://127.0.0.1:4173/` on Chromium (Playwright), device scale 1.

| Width | Scroll height | Horizontal overflow | Console errors | 404s | Notes |
|---|---|---|---|---|---|
| 390 | 10194 | 0 | 0 | 0 | mobile stack, slider, phone mockup |
| 768 | 10317 | 0 | 0 | 0 | mobile breakpoint |
| 1024 | 21477 | 0 | 0 | 0 | desktop nav, pinned work/pricing |
| 1440 | 21535 | 0 | 0 | 0 | reference-height match |
| 1728 | 21533 | 0 | 0 | 0 | full-bleed wordmark |
| 1440 reduced-motion | 9082 | 0 | 0 | 0 | pins/canvas off, stacked |
| 390 reduced-motion | 8149 | 0 | 0 | 0 | cards + projects stacked |

*(Measured with `evidence/qa-final.js` on the local server; every row also has console
and response assertions. The video's transient `ERR_ABORTED` range request is normal
and is excluded from the failure count.)*

---

## Replace-before-publish plan

If this ever needs to become public, do this first:

1. Replace **every** item in the provenance tables above with licensed or
   commissioned equivalents (or remove it).
2. Replace the wordmark/logo, O-morph footer mark, all Neutomni copy and the
   "Neutomni" name in metadata.
3. Re-shoot/commission the hero showreel (`assets/video/hero.mp4`) and all
   project/team photography; the XP wallpaper/CRT/phone images are also
   third-party imagery.
4. Buy licences for PP Editorial New and Editorial New, or substitute a licensed
   serif; Vazirmatn and Fira Code are open-source (SIL OFL) and can stay.
5. Recreate the XP icons/window chrome in-house or use licensed equivalents.
6. Remove the study disclaimer only after all of the above is verified by a
   lawyer/owner; keep the provenance list as an audit trail.

**Never quietly deploy this study version.**

