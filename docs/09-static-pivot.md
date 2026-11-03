# 09 — Static Pivot (what actually ships tonight)

Decision record, 2026-11-03. The owner wants this live today, free, with no accounts. That replaces the Vercel + Supabase plan in `02`.

## What ships
- A static site on **GitHub Pages**: Vite + TypeScript, MapLibre map, no server, no accounts, no analytics, no third-party requests at runtime (fonts are self-hosted).
- **Senate (35 seats) and Governor (36 seats)** races only.
- Forecasting (default), Endorsing, Reconcile (descriptive only), Saved maps, About/Blog/Contact/Terms, first-visit skippable tour, closed state, results view.
- Data refreshed every 15 minutes by a GitHub Actions job (`.github/workflows/pages.yml`) running `pipeline/build-data.ts`. If a source is down, the last committed data is kept.

## What does not ship (and why)
| Not shipped | Reason | Path forward |
|---|---|---|
| AI research agent | Needs a paid LLM key and a server to keep the key secret. The owner wants no spending. | Build it later behind a tiny serverless proxy, with every rule in `AGENTS.md` §3.1–3.2 and `04`. The "X away the AI" control is moot until then. |
| Accounts / cloud sync | No server. | Supabase auth later if wanted. Local export/import exists now. |
| House races, district map | Needs verified candidate data and post-redistricting boundaries (risk R1). | Tier 2. |
| Ballot questions | No free structured source found for 2026 measures (VoteHub only has CA Prop 50). | Tier 2. |
| Database-enforced shutdown | No database. | Client gate against server time (below). |
| AP / DDHQ results | Licensed products; no free or academic tier found; access depends on the provider's contract, not on our legal review. Scraping AP is not allowed. | See the runbook (`10`) for the access request and the interim path. |

## Shutdown on a static site
`src/domain/clock.ts` reads the HTTP `Date` header from GitHub's CDN with a same-origin HEAD request, keeps an offset from the visitor's clock, and re-syncs every 5 minutes. All gating uses that corrected time. If the request fails, the site falls back to the visitor's clock and says so in the banner and About page. The write layer refuses saves after 09:57 UTC. Limits of this approach: a visitor who edits the page in devtools can bypass it, and a visitor whose browser blocks the request uses their own clock. For a personal, unlisted, educational site that is acceptable; it is documented rather than hidden.

## Sources actually used
Polls: VoteHub. Nominees and seat holders for governors: Wikipedia race infoboxes (CC BY-SA). Senate roster and holdovers: unitedstates/congress-legislators. Governor holdovers: `data/curated/governor-holdovers.json` (hand-curated, marked as such in the UI). Map: us-atlas (Census). Poll matching: poll `subject` ("2026 Michigan") gives the state; poll answers are matched to nominees by last name + first initial; polls that do not match two named nominees (for example primary polls) are not shown, and the count is reported in the data warnings.

## Honest limits
- Wikipedia is crowd-edited. Nominee lists are as current as the page; the card links to the page and shows the retrieval time.
- VoteHub publishes polls, not averages. Every average is computed in the browser from the visible polls.
- The 14 governor holdovers are curated by hand and have not been machine-verified.
