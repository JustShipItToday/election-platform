# 09 — What Ships (static GitHub Pages build)

Decision record, 2026-11-03. The owner wants this live today, free, with no accounts. That replaced the Vercel + Supabase plan in `02`. Verified facts and limits are in `11-coverage-and-limits.md`.

## What ships
- A static site on **GitHub Pages**: Vite + TypeScript, MapLibre, no server, no accounts, no analytics. Fonts are self-hosted and the production build carries a Content-Security-Policy.
- **Senate (35), House (435 districts) and Governor (36) races**, plus **155 statewide ballot questions**.
- **Forecasting** (default) and **Endorsing**, stored separately; **Reconcile** (descriptive only, with a paired map); **Saved** prediction maps (limit 1,500) and frozen forecast maps (limit 70); first-visit skippable tour; closed state and Results view; About, Blog, Contact, Terms, and a Data status page.
- **Research on every race, each in its own labeled category:** polls (VoteHub), analyst ratings, past results, candidate profiles with verified photos and sourced bios, official state tallies where a feed is connected, live news headlines.
- **Research helper:** rule-based and tool-driven (21 validated tools), always cites sources, hideable, with the factual-only policy enforced in code.
- Data refreshes about every 15 minutes through GitHub Actions (`.github/workflows/pages.yml`). If a source is down, the last committed data stays live.

## What does not ship, and why
| Not shipped | Reason | Path forward |
|---|---|---|
| An LLM behind the helper | Needs a paid or quota-limited key and a server, because a prompt shipped in browser JavaScript cannot be secret | Cloudflare Worker (free tier) holding the key and prompt, using the same tools and policy; needs the owner's Cloudflare account |
| Accounts / cloud sync | No server; owner chose none | Local export/import exists |
| Database-enforced shutdown | No database | Client gate against server time (below) |
| AP / Decision Desk HQ | Licensed products; no free or academic tier found; access is a contract with the provider | Request access (draft in `10`) |
| Official results from most states | Feeds are undocumented and could not be verified before polls closed | North Carolina is connected; others can be added to `pipeline/official/` as they are verified |
| Presidential results by district | No free structured source integrated | — |

## Shutdown on a static site
`src/domain/clock.ts` reads the HTTP `Date` header from GitHub's CDN with a same-origin HEAD request, keeps an offset from the visitor's clock, and re-syncs every 5 minutes. All gating uses that corrected time. If the request fails, the site falls back to the visitor's clock and says so in the banner, About and Data status pages. The write layer refuses saves after 09:57 UTC, and the pick buttons are removed from the page. A visitor who edits the page in developer tools can bypass a client-side gate; that limit is accepted for a free static site and documented.

## Sources actually used
Polls: VoteHub. Race lists, nominees, governors, ballot measures, ratings, past results, bios: Wikipedia (CC BY-SA, linked on every card) and Wikidata. Senate roster, caucus, portraits and service history: unitedstates/congress-legislators and its public-domain images. House district shapes: Census TIGER/Line 2026 (120th Congress), compared with TIGER 2025 to identify redrawn states. News: GDELT, fetched in the visitor's browser. Official tallies: North Carolina State Board of Elections. Photos beyond official portraits: Wikimedia Commons, only with an allowed license and shown with credit.
