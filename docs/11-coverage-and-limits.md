# 11 — Coverage, Verification and Limits

Written 2026-11-03 from the data that is actually in `public/data/`. Re-check the live numbers on the site's **Data status** page.

## What was verified, and how
| Claim | How it was checked |
|---|---|
| 35 Senate, 36 Governor, 435 House races | Race lists are derived from Wikipedia's 2026 election pages and the Census district file; the build stops if the counts differ. Tests assert them. |
| House shapes are the 2026 election maps | Census TIGER 2026 (120th Congress) was compared with TIGER 2025. Districts changed substantially in AL, CA, FL, LA, MO, NC, OH, TN, TX and UT, and are identical in every other state. Virginia is unchanged because its state Supreme Court voided the new map on May 8, 2026 (confirmed on Wikipedia). |
| Governors (all 50) and holdovers | Parsed from Wikipedia's current-governors table (24 D, 26 R, matching Wikipedia's own tally) and cross-checked against each race page; mismatches would be published as warnings. |
| Independent senators' caucus | Read from the roster data (`caucus` field), not typed. |
| Ballot questions never change chamber totals | Separate storage and a separate tally; a unit test and a browser check show the Senate, House and Governor totals unchanged after answering ballot questions. |
| Evidence gate for calling a race | Unit-tested: one official source, or two news sources from different publishers; anything else stays uncalled. A failing test blocks deployment of a bad `calls.json`. |
| Factual-only policy | 205 adversarial cases (advice, persuasion, prompt extraction, injection, spelling and spacing tricks) plus benign requests that must still work. This is a rules-based guard, not a proof; it can be evaded by phrasing it has not seen. |
| Accessibility | axe-core (WCAG 2 A/AA) on 9 routes in light and dark: no violations after fixes. Keyboard and screen-reader behavior was not tested by hand. |
| Production build | Browser-tested with the Content-Security-Policy active: map, House layer, ballot flow and all pages with no violations. |

## Coverage numbers (at build time)
- Nominees named: 500 of 506 races (all 71 Senate and Governor; 429 of 435 House districts). The rest show "nominees not confirmed".
- Polls: 971 matched to named nominees. 207 poll records were not matched (for example primary polls) and are not shown.
- Ballot questions: 155 across 40 states. No polling exists for them in the poll source.
- Ratings found for 502 of 506 races; past results for all Senate and Governor races and nearly all House districts.
- Candidate profiles: 1,016 candidates; 607 have a Wikipedia article and bio, 561 have a verified photo (375 official portraits, 186 license-checked Commons photos), 354 campaign sites were read, 388 have public-record congressional service.

## Known limits (stated plainly)
1. **Wikipedia is crowd-edited.** Nominees, ratings, past results and "reported" results come from it. Cards link to the page, show the retrieval time, and label results "unverified".
2. **No free national results feed exists.** Races are "called" only with an official source or two independent news sources, entered in `public/data/calls.json`. Official vote tallies are connected for North Carolina only. Elecia never calls a race from vote counts or headlines alone.
3. **The research helper is not an AI model.** It understands a fixed set of request shapes and says so when it does not understand. Quotes are only ever the campaign's own website description, shown as a labeled campaign claim; no quotes are extracted or invented, so "quotes" and "voting records" are not provided.
4. **Live news was not verified end to end from the build sandbox**: GDELT rate-limited that network, so only the parser (tested on a real response) and the response headers (cross-origin allowed) were verified. Each visitor has their own rate limit.
5. **Client-side shutdown.** See `09`.
6. **House seat-holder labels in redrawn states** use Wikipedia's incumbent for the race, because the roster's member for a district number is often not who is running there.
7. **Ballot measure wording** is Wikipedia's description of what a yes vote does; the source does not say what a no vote does, and neither does Elecia.
8. **Photos**: only official portraits and Commons photos whose license was checked; everyone else shows initials.
