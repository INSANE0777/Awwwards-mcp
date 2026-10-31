# v2 routing — 1.x tool names → `AWWWARDS_MCP_PROFILE=v2`

Use this page when the server runs with `AWWWARDS_MCP_PROFILE=v2`. That profile
registers **15** tools and **none** of the 1.x names mapped below, so every 1.x
call in a skill is a dead tool. Set the variable in the server `env` and
**restart the MCP server** — the profile is read once at startup.

| `AWWWARDS_MCP_PROFILE` | Tools | Surface |
|---|---|---|
| `full` (default) | 39 | Every 1.x tool, unchanged |
| `core` | 13 | Build-loop subset of the 1.x tools; includes `get_annual_categories` |
| `v2` | 15 | 10 consolidated tools + 5 retained flat tools |

The ten consolidated tools are `search_references`, `get_reference`,
`browse_awards`, `get_index`, `inspect_page`, `analyze_motion`,
`capture_page`, `audit_page`, `build_motion` and `monitor_awards`; the five
retained flat tools are `create_design_brief`, `build_project`, `verify_build`,
`verify_flow` and `analyze_network_capture`.

In v2 every consolidated tool takes exactly one `request` object with one
branch (`kind` or `action`). There is no all-mode and no cross-branch mixing:

```json
{ "request": { "kind": "sites", "query": "portfolio", "count": 3 } }
```

## Replaced operations: 1.x → v2

All 34 replaced 1.x names. Fields marked `?` are optional; branch objects are
strict, so do not send fields from another branch.

| 1.x tool | v2 call |
|---|---|
| `search_sites` | `search_references {request:{kind:"sites", query?, color?, tags?, technology?, award?, sortBy?, responseMode?, count?, page?}}` |
| `search_elements` | `search_references {request:{kind:"elements", query?, category?, stack?, limit?}}` |
| `search_directory` | `search_references {request:{kind:"directory", query?, country?, category?, budget?, page?}}` |
| `search_motion` | `search_references {request:{kind:"motion", lib?, scrubOnly?, hasPins?, limit?}}` |
| `get_collections` | `search_references {request:{kind:"collections", page?}}` without a slug; `get_reference {request:{kind:"collection", slug, page?}}` for one collection |
| `get_site_details` | `get_reference {request:{kind:"site_details", slug}}` — or `slugs` for a batch of 1-10 (with optional `compact`) |
| `get_site_elements` | `get_reference {request:{kind:"site_elements", slug}}` |
| `get_element` | `get_reference {request:{kind:"element", id}}` |
| `compare_sites` | `get_reference {request:{kind:"comparison", slugs}}` (2-3 slugs) |
| `get_index_status` | `get_index {request:{kind:"status"}}` |
| `get_index_stats` | `get_index {request:{kind:"stats", windowDays?, top?}}` |
| `list_categories` | `browse_awards {request:{kind:"filters"}}` |
| `get_annual_categories` | `browse_awards {request:{kind:"annual_categories"}}` |
| `get_annual_nominees` | `browse_awards {request:{kind:"annual_nominees", category, limit?, offset?, hydrate?}}` |
| `get_annual_nominee` | `browse_awards {request:{kind:"annual_nominee", id}}` — or `category` + `slug` instead of `id` |
| `analyze_page_structure` | `inspect_page {request:{kind:"structure", url, maxBands?, waitStrategy?, viewport?, compare?, cdpEndpoint?}}` |
| `export_design_tokens` | `inspect_page {request:{kind:"tokens", url, selector?, viewport?, maxNodes?, include?}}` |
| `analyze_stack` | `inspect_page {request:{kind:"stack", url, timeoutMs?}}` |
| `get_motion_dna` | `analyze_motion {request:{kind:"dna", url, recapture?}}` |
| `analyze_scroll_map` | `analyze_motion {request:{kind:"scroll", url, waitStrategy?, viewport?, reducedMotion?, scrubProbe?, compact?}}` |
| `analyze_hover_census` | `analyze_motion {request:{kind:"hover", url, waitStrategy?, viewport?, reducedMotion?, compact?}}` |
| `capture_live_site` | `capture_page {request:{kind:"screenshot", url, waitStrategy?, viewport?, inline?, maxInlineBytes?, waitForOverlay?, scrollCapture?}}` |
| `capture_component` | `capture_page {request:{kind:"component", url, selector?, maxNodes?, viewport?, compact?}}` |
| `capture_pose_3d` | `capture_page {request:{kind:"pose", url, steps?, viewport?}}` |
| `record_site_motion` | `capture_page {request:{kind:"recording", url, frames?, waitStrategy?, viewport?}}` |
| `audit_url` | `audit_page {request:{kind:"performance", url, viewport?, timeoutMs?, compact?}}` |
| `analyze_accessibility` | `audit_page {request:{kind:"accessibility", url, viewport?, limit?}}` |
| `analyze_images` | `audit_page {request:{kind:"images", url, viewport?, maxImages?}}` |
| `analyze_bundle` | `audit_page {request:{kind:"bundle", url, keywords?, maxChunks?, walkChunks?, edges?, bundleIntel?}}` |
| `build_pose_stub` | `build_motion {request:{kind:"pose_stub", poseGrid, scrollCensus?}}` |
| `build_gsap_stub` | `build_motion {request:{kind:"gsap_stub", scrollCensus, poseGrid?}}` |
| `build_motion_manifest` | `build_motion {request:{kind:"manifest", bands, scrollCensus, sections?}}` |
| `new_winners` | `monitor_awards {request:{action:"poll_winners", award?}}` |
| `watch_site` | `monitor_awards {request:{action:"add_watch", kind, pattern, award?, note?}}` for add; `monitor_awards {request:{action:"list_watches"}}` for list; `monitor_awards {request:{action:"remove_watch", kind, pattern}}` for remove |

## Retained flat tools (no `request`)

Five 1.x tools keep their names **and** their flat input shape in v2. Do not
wrap them in `request`:

| Tool | Flat example |
|---|---|
| `create_design_brief` | `create_design_brief { slugs: ["l-i-s-a", "bruno-simon"], goal: "portfolio for a type foundry" }` |
| `build_project` | `build_project { htmlPath: "rebuild/index.html", target: "vite", out: "site" }` |
| `verify_build` | `verify_build { buildUrl: "http://localhost:5173", referenceUrl: "https://example.com" }` |
| `verify_flow` | `verify_flow { buildUrl: "http://localhost:5173", referenceUrl: "https://example.com", steps: [{ action: "scroll", y: 1200 }] }` |
| `analyze_network_capture` | `analyze_network_capture { path: "capture.har", top: 50 }` |

## v2 rules the 1.x workflow didn't need

- **`monitor_awards` is keyed on `action`, not `kind`.** Valid actions are
  `poll_winners`, `add_watch`, `list_watches`, `remove_watch`. On
  `add_watch`/`remove_watch`, `kind` is the watch target
  (`studio | tag | url`) and both `kind` and `pattern` are required.
- **`build_project` output is source, not a servable site.** It scaffolds a
  Vite/Astro/Next project; run `npm install && npm run build`, then serve the
  generated output (Vite/Astro `dist/`, Next `.next` with `next start`). Never
  serve the raw scaffold directory.
- **A compact motion census cannot feed `build_motion`.** `analyze_motion`
  `{kind:"scroll", compact:true}` omits `anims[]` and turns
  keyframes/props/durations/`scrubCurves` into counts, so `build_motion`
  `gsap_stub`/`manifest` reject it. Capture the census with `compact:false`
  (the default) for that handoff.
- **Branch limits worth knowing:** `inspect_page` `tokens` and `stack` require a
  live URL, while `structure` accepts `file://` and `cdpEndpoint`; `capture_page`
  `screenshot` is the only branch with `inline`/`scrollCapture`; `audit_page`
  performance uses Chrome/Edge over CDP, accessibility and images need
  Playwright, and bundle fetches chunks without a browser.
