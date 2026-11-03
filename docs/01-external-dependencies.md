# 01 — External Dependencies (the "list of all external stuff")

Researched 2026-11-03. **Verification status matters:** items marked ⚠️ were found via search snippets only. I have NOT yet confirmed their current terms, endpoints, or limits on the provider's own site. Nothing here is a final commitment.

Legend — Need: 🔴 blocks launch · 🟡 strongly wanted · 🟢 nice to have. Cost: free / free-key / paid.

## A. Things that require YOU (no free-signup path for me)

| # | Need | Why | What I need from you |
|---|---|---|---|
| A1 | 🔴 LLM API key (Anthropic Claude) | Powers the research agent and natural-language scope parsing. Usage-billed; no free tier I can sign you up for. | An `ANTHROPIC_API_KEY` with a spending cap you choose, added as a server-side env var (never pasted into chat or the repo). |
| A2 | 🔴 Hosting account authorization | Vercel/Supabase/Cloudflare sign-ins need an interactive login on your accounts. I can create free-tier signups with your email per your instructions, but email verification and OAuth hand-offs often require you to click a link. | Approve the stack (Decision D2), then be ready to click verification emails. |
| A3 | 🔴 Nationwide live results licensing | There is **no free, legitimate, national machine-readable results feed** I could find. AP and Decision Desk HQ are commercial licensed products; scraping AP's website would violate its terms. | Decision D5: pick an approach (see section C). |

## B. Free / free-key data sources I can pursue

### Polling
| Source | Coverage | Access | Status |
|---|---|---|---|
| **FiftyPlusOne** | Senate/governor/House general + primary, generic ballot, pollster list, candidates.csv, races.csv | CSV downloads at `/downloads` (some files premium-only: crosstabs). | ⚠️ Terms/license/rate limits unstated on ReadMe; must read `/terms`. Likely **primary poll source** if terms permit. |
| **VoteHub Polling API** | Senate, House, governor, generic ballot | JSON API (`api.votehub.com`), reported **CC BY 4.0** (credit VoteHub + original poll URL). | ⚠️ Only found via a third-party index. Must confirm at `votehub.com/polls/api/`. Strong candidate as **secondary/fallback**. |
| Electoral-vote.com | Senate polls | Plain text/CSV | ⚠️ Terms unconfirmed. Fallback. |
| FiveThirtyEight archives (DataHub mirror) | Historical, generic ballot | CSV | Stale (last update noted Mar 2026); historical only. |
| RCP | Averages | No public API | Not usable as a data source; at most a human link-out. |

Design response: provider-adapter layer; store every poll with provenance; compute averages **ourselves** from stored polls (deterministic, user-configurable). Only display a provider's own published average if it exists and is labeled as theirs.

### Candidates, offices, incumbents
| Source | Use | Access |
|---|---|---|
| **FEC OpenFEC API** | Federal candidate filings (House/Senate), IDs, party, incumbency status | Free key at api.data.gov (⚠️ ~1,000 req/hr; `DEMO_KEY` ~30/hr). Only lists candidates who filed. |
| **unitedstates/congress-legislators** | Incumbent roster, bioguide IDs, committee/term data | Public domain GitHub dataset. |
| **Congress.gov API** | Member bios, sponsored bills, votes | Free key (api.data.gov). ⚠️ confirm limits. |
| **Wikidata / Wikipedia REST** | Identity linking (QIDs), neutral bio seeds, official sites | Free; CC BY-SA attribution. One source of several, never sole authority. |
| Campaign websites / official .gov sites | Official positions, quotes | Fetched politely (robots.txt, rate limits), labeled "campaign claim". |
| Ballotpedia | Great data, but API is paid. | Do **not** scrape; link-out only unless you license it. |
| State election offices / SOS | Official candidate lists, ballot measure texts | Per-state; no uniform API. |

### Historical results
| Source | Use |
|---|---|
| **MIT Election Data + Science Lab** (Harvard Dataverse) | Senate/House/governor/president historical results (⚠️ confirm license per dataset). |
| 2024 presidential results by congressional district (e.g., Daily Kos Elections) | District partisan lean context (⚠️ confirm terms and which district lines they use — see risk R1). |

### Ratings
Cook, Sabato, Inside Elections are proprietary. **Plan: link-out only, no scraping, no copying their ratings into our DB** unless you obtain permission. Wikipedia's ratings tables may be summarized with attribution as a secondary reference (⚠️ verify). Your own "competitive races" filter can be computed from polling margin + historical margin, deterministically and honestly labeled as ours.

### News
| Source | Access | Notes |
|---|---|---|
| **GDELT DOC 2.0** | Keyless | ⚠️ ~1 request / 5 s; broad coverage; discovery only. |
| **Guardian Open Platform** | Free key | ⚠️ non-commercial terms. |
| NYT APIs | Free key | ⚠️ attribution/usage terms. |
| NewsAPI free tier | Free key | Dev/testing only — **not for production**. |

Rule: store headline + snippet + link + publisher + date. Never republish full article text.

### Photos
| Source | Use |
|---|---|
| `theunitedstates.io/images/congress/{size}/{bioguide}.jpg` | Incumbent portraits (GPO, public domain). ⚠️ may lag official bioguide. |
| **Wikimedia Commons** via MediaWiki API (imageinfo/extmetadata) | Non-incumbent photos when license is PD/CC0/CC BY/CC BY-SA **and** the file is linked to the person's Wikidata item (P18). |
| Fallback | Neutral placeholder → initials. Never a guess. |

### Maps & geography
| Source | Use |
|---|---|
| **Census TIGER/Line / Cartographic Boundary** | State and congressional district boundaries (public domain). |
| **MapLibre GL JS** (BSD) + **PMTiles** (static vector tiles) | Rendering. |
| Natural Earth / us-atlas | Low-detail state outlines for overview zooms. |

⚠️ **Redistricting risk (R1):** several states redrew congressional maps mid-decade for 2026. District files labeled "119th Congress" would then be **wrong for those states**. Boundaries must be verified per state against official sources before launch, and the app must show a visible "districts verified as of …" note.

## C. Results ingestion — options (needs your decision, D5)

1. **Licensed feed (AP Elections API or Decision Desk HQ).** Best quality, calls, partial-results handling, but paid and requires a contract. Not possible tonight without you.
2. **State official feeds + evidence-gated finalization.** Free but 50 different formats; most states do not offer a clean public JSON feed. I would build adapters for the highest-value states and use a **human-confirmed** path for the rest.
3. **Hybrid (recommended for tonight):** Display race status as **"called" only with ≥2 independent attributable sources or one official state source**; store source URLs and timestamps; allow *you* to confirm/override calls from an admin screen; use AI search only to *surface* candidate sources for you to confirm — never to auto-finalize a race. This respects your "don't prematurely mark races final" rule.

## D. Infrastructure (free tiers I can sign up for; ⚠️ confirm limits at signup)

| Need | Candidate | Notes |
|---|---|---|
| App hosting | Vercel (Hobby) or Cloudflare Pages/Workers | See `02-architecture-and-stack.md`. |
| Database + Auth + RLS | Supabase (Postgres) | One vendor for DB, auth, row-level security, scheduled jobs. |
| Scheduled ingestion | Supabase `pg_cron` + Edge Functions, or Cloudflare Cron Triggers | Must run with your computer off. |
| Static tiles/assets | Cloudflare R2 or Supabase Storage / Vercel static | |
| Error/uptime monitoring | Sentry free tier + a free uptime pinger | 🟡 |
| Transactional email (contact form, magic links) | Supabase Auth email + Resend free tier | 🟡 |
| Domain | Your choice | 🟢 `elecia.*` availability and trademark are **unchecked**. |

## E. Open verification tasks (first 30 minutes after approval)
1. Read FiftyPlusOne `/terms` and `/downloads`; fetch a real `senate_general.csv` and inspect schema and freshness.
2. Read VoteHub API docs; confirm license, endpoints, rate limits.
3. Get FEC and Congress.gov keys.
4. Confirm which districts changed for 2026 and source authoritative boundaries.
5. Confirm current pricing/limits for chosen free tiers.
