# Annual Awards API fixtures

Captured live once from the official Awwwards public read-only API on
**2026-10-23** (1 request/second, user agent
`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 awwwards-mcp/1.0`).

| File | Endpoint |
|---|---|
| `categories.json` | `https://www.awwwards.com/api/annual/categories` |
| `site-nominee.json` | `https://www.awwwards.com/api/annual/nominees/sites/09679d45-7588-444b-9288-dc56a11873a1` |
| `user-nominee.json` | `https://www.awwwards.com/api/annual/nominees/users/08af5f2f-d4f6-47e9-9cdb-641841acffff` |

The payloads are the exact JSON:API envelopes returned by the API, trimmed
only for size: each category's `nominees` array keeps its first 3 UUIDs, and
the user nominee's `featuredProjects` keeps its first 3 entries. Everything
else — including one complete site object and one complete user object — is
unchanged. `GET /api/annual/nominees` (the untyped list) is deliberately not
fixtured: it returned `totalItems: 0` when checked.
