---
name: motion-authoring
description: Use when a converted project (build_project --authored) needs its motion authored — turning motion.manifest.json + inert skeletons into real per-section/page motion with parity proof. Covers topology choice (one master scrub vs independent triggers), intent mapping (loader, journey, cursor, canvas, audio, ruler), per-target surfaces (Next hooks/globals vs Vite/Astro modules), reduced-motion, and the verification gate.
---

# Motion authoring — from measured manifest to real motion

Runs only when the user chose a converted project **and** authored motion.
The generator gives you structure, inert skeleton mounts, and
`motion.manifest.json` (measured triggers, `pageTriggers`, initial-hidden
hints). Authoring is the step where those mounts become real motion and
the build is proven against the reference. This is the N2 dogfood recipe
(nesil: one 31.21 s master scrub, exact 25,650 px parity).

## 0. Read the reference, not just the census

The census tells you **what** moves and roughly **when**; its selectors are
structural paths, not your ids/classes. Read the site's own motion script
when available and treat the census as corroboration: real trigger count,
pins, scrub ratio, duration, easing vocabulary, stagger delays, which
animations are CSS keyframes vs GSAP vs native scroll timelines.
Use `anims[]` to verify coverage — never to derive timelines.

## 1. Decide the topology before writing code

One question: **one master timeline or independent section triggers?**

- **One master scrub** (tall spacer, fixed stage, single scrubbed trigger) →
  author a page-level `journey` module with one labelled timeline; section
  modules become thin slice builders that add to it. Do NOT split into seven
  independent ScrollTriggers — overlap and hand-offs change.
- **Independent section triggers** → one timeline per section module keyed by
  the manifest's `triggers[]`; the skeletons already have the shape
  (`gsap.context`, measured constants, refresh).

Rows with `start: null` are CSS keyframes or unowned rows — provenance, not an
instruction to build a timeline each.

## 2. Manifest contract

`motion.manifest.json` is **evidence, not an authoring file**:

- consume as generated; never add hand rows or flip `measured`
- record counts verbatim (`sections`, `sectionTriggers`, `pageTriggers`)
- record authored code separately (files + before/after) and keep the delivered
  manifest hash equal to a fresh generation; if you must add rows, mark them
  authored and say so — never `measured: true`
- `pageTriggers` belong to the page-level module, not to a section

## 3. Intent map (what to port, what to skip)

| Intent | Port | Skip |
|---|---|---|
| Loader intro | hero sequence from the site's timeline (name, cursor travel, lid, kicker, role, face) | analytics, spinners |
| Master journey | one scrubbed timeline, section `set` times, `--bg` tweens, labelled sections | unrelated scripts |
| Canvas/dust | canvas sized to stage, DPR clamp, bounded count, velocity push, cleanup | unused particle/WebGL libs |
| Cursor | idle tween, intro hand-off, end-state handover | OS cursor replacement |
| Audio | loop element, volume ramp, toggle, `visibilitychange` pause | autoplay assertions |
| Ruler/progress | one control per label, head position = progress | custom scrollbar |
| Copy/forms | clipboard + fallback, status reset | server-side behavior absent from the page |
| Reduced motion | head boot + CSS class; authored code returns before GSAP | "lite" variants nobody asked for |

## 4. Target surfaces (do not double-load GSAP)

| Target | Surface | Rule |
|---|---|---|
| Next | vendor globals via `SiteScripts` (before `MotionRoot`), authored hooks/modules | no `import gsap` in authored code; bounded wait for `window.gsap`/`ScrollTrigger` |
| Vite | `window.gsap`/`ScrollTrigger`/`Lenis` from kept classic tags copied to `dist/src/scripts` | no `import gsap` |
| Astro | same globals, `is:inline` vendor tags; page script first, then sections | no `import gsap` |

Generated skeletons import npm `gsap`; replacing that with the kept global
avoids two copies. An unused `gsap` dependency may remain — harmless, do not
import it.

## 5. Authoring order

Page-level first (loader → journey → cursor → audio → ruler), then sections
that own independent triggers. Keep the same lock discipline as the section
loop: author a section, verify its band, lock it, next.

## 6. Verification gate (all must pass)

- Every target builds (`vite build`, `astro build`, `next build` + start probe).
- Desktop 1440×900 at the band anchors (8 stops): scrollHeight ±1 %, identical
  visible section ids, fonts, 0 console/page errors/404s.
- Mobile 390×844 smoke: no horizontal overflow, same anchors/visible sections,
  0 errors.
- Reduced motion: head class applied, fixed stage disabled, no overflow, page
  readable.
- Authored proof: zero references to the dropped site scripts in source and
  build trees; only the kept vendor libs; `SiteScripts` before `MotionRoot`.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Page inert after authoring | authored code started before libs | wait for globals / keep `SiteScripts` first |
| Two GSAP runtimes / odd easing | npm import + vendor global | use the kept global only |
| Hand-offs changed | master scrub split into per-section triggers | one page-level journey, sections slice it |
| Manifest "measured" but wrong | hand rows edited in place | regenerate, or mark authored rows explicitly |
| Motion fine, page broken on mobile | desktop-only authoring | run the 390 smoke every iteration |
