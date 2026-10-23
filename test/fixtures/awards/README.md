# Award listing fixtures

Trimmed real HTML captured live on 2026-10-23 by the Theme A (award discovery
completeness) live check — 1 request/second, house UA, robots-allowed
`/websites/<slug>/` paths only.

| Fixture | Source URL | parseListing rows kept |
|---|---|---|
| `sites_of_the_year.html` | https://www.awwwards.com/websites/sites_of_the_year/ | 6 of 31 |
| `winner_category_ecommerce.html` | https://www.awwwards.com/websites/winner_category_ecommerce/ | 6 of 31 |
| `nominees.html` | https://www.awwwards.com/websites/nominees/ | 6 of 31 |

Trimming, applied on capture (see the inline comment markers in each file):
inline `<style>` and `<script>` bodies were elided — every parser anchor lives
in markup, not in CSS/JS — and the card list was cut after the 6th site card.
The full `nav-filters` bar (Awards/Category/Tag/Technology/... dropdowns) is
intact.

Notable card facts pinned by tests:
- `sites_of_the_year`: cards carry `budget-tag--soty` (`Site of the Year`) and
  `budget-tag--dev` (`Developer Award`).
- `winner_category_ecommerce`: cards carry only their underlying award tags
  (`ah`/`dev`/`sotd`) — no distinctive winner-category marker exists on the
  card, so these award filters are URL-verified only (the search re-scrapes
  instead of trusting cached rows).
- `nominees`: cards carry no award tags at all; results are flagged
  `nominee: true` at the server layer for this source page.
