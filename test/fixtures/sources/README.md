# Collections + directory fixtures

Trimmed real HTML captured live on **2026-10-25** at 1 request/second with the
house user agent
(`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 awwwards-mcp/1.0`).
All source paths are robots-allowed; inline CSS/JS is elided because every
parser anchor lives in markup.

| Fixture | Source URL | Kept |
|---|---|---|
| `collections-index.html` | https://www.awwwards.com/collections/ | 6 of 32 collection cards + real pagination |
| `collections-brutalism.html` | https://www.awwwards.com/awwwards/collections/brutalism/ | heading, `83 items`, 6 of 10 site cards |
| `directory.html` | https://www.awwwards.com/directory/ | 1 pro card + 6 of 24 ordinary cards + pagination |
| `directory-united-states.html` | https://www.awwwards.com/directory/United%20States/ | 1 pro card + 6 of 24 US cards + pagination |

## Live findings pinned by these fixtures

- The collections index paginates with `?page=N`: page 1 and 2 have 32 cards
  each, page 4 has 4, page 5 returns 404. Page 2 repeats the last 4 page-1 cards,
  so `hasMore` is derived from the `?page=N+1` links, never from a card count.
- Collection cards carry an HTML-escaped `data-model` JSON blob
  (`type: "collection"`, `slug`, `name`, `description`, `user.username`).
  Curated collections link to `/awwwards/collections/<slug>/`; member
  collections link to `/<username>/collections/<slug>/`. The short
  `https://www.awwwards.com/collections/brutalism/` form returned **404**.
- Collection pages are ordinary site listings: `parseListing` extracted all
  10 cards on page 1 of brutalism (the page claims `83 items`).
- The directory renders two grids: a 3-card `card-directory-sp` promo grid
  (featured/PRO rows, duplicated from the ordinary grid) and the paginated
  `card-directory` grid (24 cards per page). Only the latter is parsed.
  `/directory/?page=2` works and returns different cards.
- Directory filters are **path-based**, not query params:
  `/directory/United%20States/` returned only US cards (24 on page 1),
  `/directory/over_hundred_thousand/` returned 14 budget-filtered cards,
  `/directory/agency-studio/` returned 200. A profile
  (`/locomotive/`) exposes `Canada - Montréal` but no budget/specialties
  fields; cards expose no contact PII, and the parser strips email/phone
  patterns defensively.
- The free-text directory endpoint `/directory/search/?...` is disallowed by
  robots.txt, so `search_directory` never calls it: `query` is filtered
  client-side over the one fetched page (`filteredClientSide: true`).

Source pages are trimmed only for size: the first N cards of each grid are
kept verbatim, and the pagination block is the real page markup.
