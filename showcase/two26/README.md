# Two26 Studio — private study recreation

> **This is a study recreation, not my work.**
> The design, copy, images, fonts, videos and audio belong to **Two26 Studio** and their respective owners.
> This build is a **private study/reference recreation** made to understand how the original site is built.
> It **must not be deployed, published, sold, or presented as my own work**.
> Publishing it in any form requires replacing every borrowed asset listed below and obtaining the appropriate licences.

Reference: <https://two26.studio/> (captured 27 Oct 2026).
Local build: `A:\Recreations\two26` — single-page, hand-authored HTML/CSS/JS. No framework, no Webflow export, no `build_project` conversion.

---

## Run it

Any static server. From this folder:

```powershell
python -m http.server 8000
# or
npx serve .
```

Open <http://localhost:8000/>.

Do **not** open `index.html` via `file://` — the fonts, Lottie JSON and videos are fetched relatively and some browsers block them on `file://`.

`tools/` contains the evidence and QA scripts. They expect Playwright from the local awwwards MCP install (`A:/AWWARDS MCP/node_modules/playwright`):

```powershell
node tools/qa.mjs        # screenshots + console/404/overflow checks (5 passes)
node tools/assert.mjs    # element-bounds + contact-overlay assertions
node tools/measure.mjs   # section offsets and total height
```

---

## Structure

```
two26/
├─ index.html               # all sections, inline brand SVGs, study disclaimer comment
├─ css/style.css            # tokens, fluid scaling system, layout, responsive, reduced motion
├─ js/app.js                # loader, hero, about pin, showcase, projects, services, deck, FAQ, footer
├─ vendor/                  # GSAP 3.15.0, ScrollTrigger, DrawSVG, SplitText, CustomEase, MotionPath, Lenis 1.1.20, lottie-web 5.12.2
├─ assets/
│  ├─ fonts/                # MD Nichrome Test Bold/Dark (woff), Neue Montreal Regular/Medium (otf)
│  ├─ video/                # hero.mp4, shot-1.mp4, shot-3.mp4
│  ├─ img/                  # posters, 6 showcase stills, 6 projects × 2 images, 6 logos, 5 avatars, contact + footer texture SVGs
│  ├─ lottie/               # 7 service icons
│  └─ svg/cat.svg           # sleeping-cat FAQ illustration
├─ evidence/                # reference captures, DOM/CSS/SVG dumps, embed sources, reference screenshots
├─ qa/                      # final screenshots, assertions.json, offsets.txt, qa-log.txt, provenance-table.md
├─ tools/                   # probe / download / measure / qa / assert scripts
└─ README.md
```

Measurement model: the original is a Webflow build using a fluid scaling system (root `font-size = 100vw / (1440/16)`, clamped 992–1920 px, with 834/550/390 ideals for tablet/landscape/portrait). That system is reproduced, so the reference's `em` values map 1:1 at 1440.

---

## Evidence summary

Awwwards **does not list two26.studio**: `search_sites` with `query: "two26"` and `query: "two26.studio"` both returned "No sites matched…". There is therefore no `get_site_details` record to carry over. Every capture tool still ran against the live URL.

| Item | Finding |
| --- | --- |
| Stack (`analyze_stack`) | Static / hand-embedded Webflow page. CSS fingerprinted as "bootstrap" from `btn-`/`navbar-` prefixes — a false positive; the real sheet is `two-26-…webflow.shared.css`. No JS framework. |
| Motion libs (`get_motion_dna`) | GSAP 3.15.0 + ScrollTrigger + Lenis 1.1.20. 13 triggers, 2 scrubbed, 1 pinned. Easing vocabulary: `power1.inOut` ×42, `power1.out` ×33, `power2.out` ×3, `back.out(1.6)` ×1, `power2.inOut`, `power3.inOut`, `back.out(2)`. Duration vocabulary p25 500 ms / median 3500 ms / p75 3500 ms. |
| Scroll model | Custom scroller: `body { position: fixed; overflow: hidden }` + `.page { height: 100svh; overflow-y: auto }`. ScrollTrigger's `scroller` is `.page`. |
| Bands (desktop 1440×900) | hero 0·1343 → about pin 1343·3100 → showcase 4443·820 → projects 5263·2066 → services 7329·2378 → testimonials 9706·1270 → FAQ 10976·1227 → footer 12203·900. Total 13 103 px. |
| Bands (mobile 390×844) | hero 0·753 → about 753·844 → … total 12 101 px. |
| Palette | `#FF5400` primary, `#F8EEE8` cream, `#FAE3E2` hero pink, `#000` ink, `#FDF8F5` off-white, `#F2E3DA` FAQ pill. |
| Type | MD Nichrome Test (Bold display / Dark condensed), Neue Montreal (body). h1 8em/80 % at 1440 (128 px), section headings 6.25em/85 %, about paragraph 5em/105 %, footer heading 3.75em. |
| Sections captured (`capture_component`, compact) | hero (54 nodes), about (203), showcase (60), projects (193), services (127), testimonials (78), FAQ (198), footer (164). |
| Hover census | 3 hover rules; candidates sampled (5 selectors). Observed behaviours from CSS/embeds: project image swap + coloured squiggle draw, CTA circle expands to fill the pill, nav pill draws an orange squiggle underline, footer links underline. |
| Bundle analysis | Not run — the page exposes its behaviour in full inline embeds (`window` load order, exact GSAP values), so no bundle forensics were needed. |

### Motion triggers reproduced

| Section | Trigger | Values |
| --- | --- | --- |
| Loader | page load | logo fade/scale → curtain `yPercent:-100`, `power3.inOut`; skipped under `prefers-reduced-motion`. |
| Hero | after loader | heading lines `yPercent 115 → 0`, `0.85 s`, `back.out(1.4)`, stagger `0.12`; pills `scale .4 → 1`, `back.out(2.5)`; squiggle paths draw `strokeDashoffset len → 0`, `strokeWidth 0 → 30`. Master `timeScale(.75)`. |
| Hero marquee | immediate + `top 85%` | infinite `startOffset` at `unitLength / 75`; ribbon `drawSVG 100%→0 100%`, `1.3 s`, `power2.out`, once. |
| About | `top top` → `+=2200` (1150 mobile / 1550 tablet), `pin`, `scrub .8` (`.6` < 992) | per-character colour `rgba(255,84,0,.45) → #FF5400 → #000`, scale 1→1.12→1, rotation ±4°, 3.5 s each; pills pop at 35 / 72 / 96 % with `back.out(2)`. |
| Showcase | loop | continuous x marquee (`half width / 60 s`). |
| Projects | `top 85%`, once | clip-path `inset(42.5%) → inset(0%)` + `rotate ±4°, rotateY ±16°, rotateX 25°, scale 1.45 → 1`, ~1.2 s `power3.out`. |
| Services | `top 70%` → `bottom 70%`, `scrub 1.2` | path draw 0→100 %; each of 7 rows: SVG width `0 → natural`, `scale 0→1`, opacity, `back.out(3.5)`; paragraph pill `scale 0→1`, `rotate -5°`. |
| Testimonials | click | deck rotates to `[-7.5, 6.8, -5.5, 8.2, -8.5]`, active card 0°, sidebar tick width 14→34 px, `back.out(1.6)`. |
| FAQ | click | open row width 50 % (75 % mobile), border 0→1 px, answer block scale/height, badge `scale 0→1`, `back.out(1.6)`. |
| Footer | `top 55%` / scroll | heading lines `yPercent 115 → 0`, stagger 0.08; links fade-up; wordmark parallax. |

---

## QA results

Served locally, Playwright Chromium, `deviceScaleFactor 1`. Reference screenshots were captured from the live site with the same viewport and scroll container (`.page.scrollTop`), after the loader completed.

### Section offsets (desktop 1440×900)

| Section | Reference | Built | Result |
| --- | --- | --- | --- |
| hero | 0 · h1343 | 0 · h1343 | PASS |
| about (pin spacer) | 1343 · h3100 | 1343 · h3100 | PASS |
| showcase | 4443 · h820 | 4443 · h820 | PASS |
| projects | 5263 · h2066 | 5263 · h2065 | PASS (−1 px) |
| services | 7329 · h2378 | 7328 · h2378 | PASS (−1 px) |
| testimonials | 9706 · h1270 | 9706 · h1270 | PASS |
| FAQ | 10976 · h1227 | 10976 · h1226 | PASS (−1 px) |
| footer | 12203 · h900 | 12202 · h900 | PASS (−1 px) |
| **total** | **13103** | **13102** | **PASS (−1 px)** |

### Screenshot matrix

| Viewport | Anchors shot | Console errors | 404s | H-overflow | Verdict |
| --- | --- | --- | --- | --- | --- |
| 1440×900 | 0, 1343, 2100, 3000, 4443, 5263, 6000, 7329, 8100 (clamped 8045), 9706, 10976, bottom | 0 | 0 | 0 | PASS |
| 390×844 | 0, 950, 3400, 5200, 7400, 9100, 10600, 11300 | 0 | 0 | 0 | PASS (offsets drift after services, see below) |
| 768×1024 | 0, 800, 2000, 3200, 4400, 5600, 6800 | 0 | 0 | 0 | PASS at anchors; layout drift noted |
| 1728×1080 | 0, 1600, 2600, 5300, 6200, 7900, 8800 | 0 | 0 | 0 | PASS |
| 1440×900 reduced motion | 0, 2100, 5263, 10976 | 0 | 0 | 0 | PASS (stacked document, 9565 px) |

Element assertions (`qa/assertions.json`): 6 project cards, 6 outbound case-study links, all names render, 10 FAQ items, 5 testimonials, 2 contact emails, no broken images, contact overlay opens at every viewport, 0 HTTP errors.

Reference vs built side by side (same anchors): hero, about mid-pin, projects grid, services diagonal, testimonial deck, FAQ, footer. Compositions land on the same anchors at 1440 within a few px; text wrapping, card sizes, radii, colours and section heights match.

### Honest mismatches

1. **Mobile total height** — built 12 417 px vs reference 12 101 px (+2.6 %). Mobile services rows are re-laid-out more conservatively (wrapped, no horizontal offsets) to avoid overflow; anchors after ~7 000 px therefore drift by up to ~300 px. Content order is identical.
2. **Tablet total height** — built 12 353 px vs reference 11 412 px (+8.2 %). The 768 px breakpoint is the weakest layout; the desktop/390/1728 targets are the calibrated ones.
3. **Hero squiggles at 768** — my decorative paths are larger and cross the heading more than the reference's. At 1440/1728 the placement matches the measured boxes; at 390 it matches closely.
4. **Video frames** — the hero and showcase videos loop, so screenshots catch different frames than the reference captures. Layout is unaffected.
5. **Project hover** — implemented as an image swap + squiggle draw. The reference also uses per-project brush-mask SVG overlays and a coloured art layer; those mask paths are not reproduced.
6. **Testimonial deck** — click/keyboard-style advance, sidebar ticks and rotations are faithful; the custom cursor arrow that follows the pointer inside the orange panel is not implemented.
7. **Loader** — logo fade/scale + full-screen curtain slide. The reference's stroke-draw SVG background choreography is simplified.
8. **Contact overlay** — copy, emails, socials and layout are present and open from every "Let's Talk"; the SVG wipe/panel-morph transition and the illustrated contact figure animation are simplified (static image).
9. **Footer heading** sits ~15–25 px lower than the reference; footer wordmark parallax is approximated.
10. **Navigation links** — the original is multi-page (`/work`, `/about`). This recreation is a single page, so nav links scroll to in-page sections and project cards/live "See all projects" open the original case-study URLs in a new tab. No local 404s.
11. **Fonts** are the original files, so rendering matches on desktop Chromium; other platforms may hint differently.
12. **Lenis** is vendored but not attached to the custom `.page` scroller (Lenis wrapper mode expects a content child). ScrollTrigger scrub supplies the smoothing; the wheel feel is therefore slightly less damped than the original.

No claim of pixel-perfection is made. The 1440 desktop build is a close, hand-authored match at every measured band; mobile is structurally faithful with a documented height drift; tablet is the least exact.

---

## Borrowed assets and provenance

Everything below is the original owners' work, downloaded only so this private study build can be compared side by side. Inline SVGs (Two26 wordmark, hero squiggle paths, marquee ribbon path, services path, footer wordmark, FAQ badge, cat illustration) come from <https://two26.studio/> itself.

| Local path | Source URL |
| --- | --- |
| `assets/fonts/MDNichromeTest-Bold.woff` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f52049/6aaad679fdb9d914f7f52051_MDNichromeTest-Bold.woff |
| `assets/fonts/MDNichromeTest-Dark.woff` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f52049/6aaad679fdb9d914f7f52052_MDNichromeTest-Dark.woff |
| `assets/fonts/NeueMontreal-Regular.otf` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f52049/6aaad679fdb9d914f7f52053_NeueMontreal-Regular.otf |
| `assets/fonts/NeueMontreal-Medium.otf` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f52049/6aaad679fdb9d914f7f52054_NeueMontreal-Medium.otf |
| `assets/video/hero.mp4` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f52049/6aaad679fdb9d914f7f52055_Hero_mp4.mp4 |
| `assets/video/shot-1.mp4` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f52049/6ab26381b5a759b6db4cec12_Shot%201_mp4.mp4 |
| `assets/video/shot-3.mp4` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f52049/6ab263f29cc7204d5832b66d_Shot%203_mp4.mp4 |
| `assets/img/hero-poster.jpg` | https://cdn.prod.website-files.com/6a7d9d7d7c99784ba2cac874/6a7db9b17a581584f4171aad_Hero_poster.0000000.jpg |
| `assets/img/shot-1-poster.jpg` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f52049/6ab26381b5a759b6db4cec12_Shot%201_poster.0000000.jpg |
| `assets/img/shot-2.jpg` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f52049/6ab263498b14a38a7a109afc_Shot%202.jpg |
| `assets/img/shot-3-poster.jpg` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f52049/6ab263f29cc7204d5832b66d_Shot%203_poster.0000000.jpg |
| `assets/img/shot-4.jpg` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f52049/6ab2633da8fa39ec5216880b_Shot%204.jpg |
| `assets/img/shot-5.jpg` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f52049/6ab2633d3e5b6a35a15d74d7_Shot%205.jpg |
| `assets/img/shot-6.png` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f52049/6ab2634dc8995221637e120c_Shot%206.png |
| `assets/img/proj-heygluco-a.jpg` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f5203c/6ab393770c697e34bcc4e4fb_Vertical6.jpg |
| `assets/img/proj-heygluco-b.jpg` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f5203c/6ab392697fe7cc9c077d1bb5_HeyGluco_2_hover.jpg |
| `assets/img/proj-bagel-a.jpg` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f5203c/6ab270be80849a0a23faa24a_6ab2707cc2a53666310f52d2_Bagel_2_hover.jpeg |
| `assets/img/proj-bagel-b.jpg` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f5203c/6ab270be80849a0a23faa24d_6ab27078c47da30c0af6b000_Bagel_1.jpeg |
| `assets/img/proj-tanti-a.jpg` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f5203c/6ab2723d53bb370f04afa391_6ab2722d77656a8e8b50e941_Tanti_2_hover.jpeg |
| `assets/img/proj-tanti-b.jpg` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f5203c/6ab2723d53bb370f04afa38a_6ab2722877656a8e8b50e7c0_Tanti_1.jpeg |
| `assets/img/proj-munchies-a.jpg` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f5203c/6ab2723d53bb370f04afa375_6ab27223e0afaf640fd855d7_Munchies_2_hover.jpeg |
| `assets/img/proj-munchies-b.jpg` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f5203c/6ab2723d53bb370f04afa381_6ab2721e4694c5c1d617273d_Munchies_1.jpeg |
| `assets/img/proj-mvp-a.jpg` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f5203c/6ab270be80849a0a23faa29e_6ab27093a089e1fd370a7310_MVP_Thumbnail2_hover.jpeg |
| `assets/img/proj-mvp-b.jpg` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f5203c/6ab270be80849a0a23faa284_6ab270907f6e9d96146209a1_MVP_Thumbnail1.jpeg |
| `assets/img/proj-yumyum-a.jpg` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f5203c/6ab2723d53bb370f04afa372_6ab2723985afb9378f444d8b_YumYum_2_hover.jpeg |
| `assets/img/proj-yumyum-b.jpg` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f5203c/6ab2723d53bb370f04afa37d_6ab272335c44422412d81fb1_YumYum_1.jpeg |
| `assets/img/logo-heygluco.png` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f5203c/6ab266d33e964df940c04833_HeyGluco.png |
| `assets/img/logo-bagel.png` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f5203c/6ab2675e0b996d1415be46a3_The%20Bagel%20Bar.png |
| `assets/img/logo-tanti.png` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f5203c/6ab266e293685f22fedc573a_Tanti%20Maria.png |
| `assets/img/logo-munchies.png` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f5203c/6ab26718a85417b42d23712f_Munchies%20%26%20Cream.png |
| `assets/img/logo-mvp.png` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f5203c/6ab26733f2ee3f3da2d70eeb_MVP.png |
| `assets/img/logo-yumyum.png` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f5203c/6ab266f1e1ea593718edc309_YumYum.png |
| `assets/img/avatar-rux.jpg` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f5203c/6ab3d538dbdbc6a5f1d1d3f4_Rux.jpg |
| `assets/img/avatar-luiza.jpg` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f5203c/6ab3d1f99d28cf11d2e8f501_luiza.jpg |
| `assets/img/avatar-vlad.jpg` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f5203c/6ab3d5ec9cfd634776e95758_Vlad.jpg |
| `assets/img/avatar-ionut.jpg` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f5203c/6ab3d72a667c6ab560a03d5b_Ionut.jpg |
| `assets/img/avatar-monica.jpg` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f5203c/6ab3d7f19cfd634776eaf212_Monica.jpg |
| `assets/img/contact.svg` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f52049/6aaad679fdb9d914f7f5206b_contact.svg |
| `assets/img/footer-texture.svg` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f52049/6aaad679fdb9d914f7f52067_footer-texture.svg |
| `assets/lottie/brand-strategy.json` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f52049/6aaad679fdb9d914f7f52071_Brand%20strategy.json |
| `assets/lottie/brand-identity.json` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f52049/6aaad679fdb9d914f7f52076_Brand%20Identity.json |
| `assets/lottie/packaging.json` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f52049/6aaad679fdb9d914f7f52077_Packaging.json |
| `assets/lottie/motion-design.json` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f52049/6aaad679fdb9d914f7f52078_Motion%20Design.json |
| `assets/lottie/web-design.json` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f52049/6aaad679fdb9d914f7f52079_Web%20design.json |
| `assets/lottie/illustration.json` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f52049/6aaad679fdb9d914f7f5207a_Illustration.json |
| `assets/lottie/art-direction.json` | https://cdn.prod.website-files.com/6aaad679fdb9d914f7f52049/6aaad679fdb9d914f7f5207b_Art%20Direction.json |
| `vendor/gsap.min.js` | https://cdn.prod.website-files.com/gsap/3.15.0/gsap.min.js |
| `vendor/ScrollTrigger.min.js` | https://cdn.prod.website-files.com/gsap/3.15.0/ScrollTrigger.min.js |
| `vendor/DrawSVGPlugin.min.js` | https://cdn.prod.website-files.com/gsap/3.15.0/DrawSVGPlugin.min.js |
| `vendor/SplitText.min.js` | https://cdn.prod.website-files.com/gsap/3.15.0/SplitText.min.js |
| `vendor/CustomEase.min.js` | https://cdn.prod.website-files.com/gsap/3.15.0/CustomEase.min.js |
| `vendor/MotionPathPlugin.min.js` | https://cdn.prod.website-files.com/gsap/3.15.0/MotionPathPlugin.min.js |
| `vendor/lenis.min.js` | https://cdn.jsdelivr.net/npm/lenis@1.1.20/dist/lenis.min.js |
| `vendor/lottie.min.js` | https://cdn.jsdelivr.net/npm/lottie-web@5.12.2/build/player/lottie_light.min.js |

GSAP plugins are vendored from the same CDN the reference uses. GSAP and Lenis keep their own licences (GSAP standard "no charge" licence, Lenis MIT); Lottie-web is MIT.

Also reproduced from the reference (not files): page copy (all headlines, service descriptions, 5 testimonials, 10 FAQs, footer text), colour palette, layout metrics, and the motion parameter values listed above.

---

## If this is ever to be published

1. Replace all fonts with licensed equivalents (MD Nichrome and Neue Montreal are commercial).
2. Replace every image, video, poster, avatar, project logo and Lottie animation with owned or licensed work.
3. Rewrite all copy and replace the Two26 wordmark, cat illustration, squiggle paths and marquee ribbon with original artwork.
4. Remove every reference to Two26 Studio and this study build's provenance from the page, then re-run the QA gate.
5. Keep this README's provenance record for the private archive; do not ship it as part of a public site.

Until all of that is done: private, local, unlisted — and not presented as anyone's own work.
