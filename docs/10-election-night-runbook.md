# 10 — Election-Night Runbook

## What updates by itself (computer off)
Every ~15 minutes GitHub Actions refreshes polls, nominees, Wikipedia-reported results, ratings, past results, ballot results, and North Carolina's official tallies, runs the tests, and redeploys. If a source fails, the last good data stays live. Check the **Actions** tab for red runs, and the site's **Data status** page for freshness and warnings.

## Confirming a race or measure (free, evidence-gated)
Edit `public/data/calls.json` on GitHub (pencil icon, commit to the deployed branch). A call needs the race or measure id, the winner (a candidate id from `public/data/dataset.json`, or `"yes"` / `"no"` for a ballot measure), and evidence:
- one **official** source (a state or county election office results page), or
- two **news** sources from different publishers.

```json
{
  "updatedAt": "2026-11-04T15:20:00Z",
  "calls": [
    { "raceId": "senate-GA", "winnerCandidateId": "senate-GA:jon-ossoff", "calledAt": "2026-11-04T15:10:00Z",
      "evidence": [ { "kind": "official", "publisher": "Georgia Secretary of State", "url": "https://results.example.gov/ga", "retrievedAt": "2026-11-04T15:05:00Z" } ] },
    { "raceId": "ballot-AK-alaska-measure-2", "winnerCandidateId": "no", "calledAt": "2026-11-04T16:00:00Z",
      "evidence": [ { "kind": "news", "publisher": "Outlet One", "url": "https://example.com/a", "retrievedAt": "2026-11-04T15:58:00Z" },
                    { "kind": "news", "publisher": "Outlet Two", "url": "https://example.com/b", "retrievedAt": "2026-11-04T15:59:00Z" } ] }
  ]
}
```
The example shows the format only; it is not a result. The tests reject unknown races or measures, duplicates, winners who are not in the race, and too little evidence, and a failing test blocks the deploy, so a typo cannot publish a wrong call.

"Reported by Wikipedia" and "State election office tally" on the Results page are read automatically and labeled unverified or unofficial. They never count as called.

## Getting AP or Decision Desk HQ data
No free or academic tier was found. Both are licensed. Draft request (edit, send from your own email):

> Subject: Request for educational access to election results data
> Hello, I run Elecia, a free, non-commercial educational site where people record their own election predictions and compare them with results. I would like to ask whether you offer an academic, non-profit, or educational license or API access for 2026 U.S. Senate, House, gubernatorial and ballot-measure results, and what the terms and cost would be. The site is static, ad-free, and collects no personal data. Thank you.

## Adding another official feed
Add an adapter in `pipeline/official/` (see `nc.ts`): fetch, validate the format loudly, map contests to race ids, and add a fixture test from real rows. Candidates to verify: Virginia (election-night JSON/CSV links on its results page).

## Owner steps to publish
1. Merge the branch into `main` (the schedule and the Pages deployment run from the default branch), or make this branch the default branch.
2. Settings → Pages → Source: **GitHub Actions**. Free Pages needs a public repository.
3. Actions → "Build and deploy" → Run workflow once, then open the Pages URL. The first run may take longer while the cache warms.
4. The site is `noindex`. Remove the robots meta in `index.html` to allow search engines.

## Rehearsal
`npm run dev -- --port 5199`, then open `/?simulate=2026-11-04T10:00:00Z#/2026/forecasting` (closed state) or `...T15:00:00Z#/2026/results` (results). Browser scripts are in `tests/e2e/`.
