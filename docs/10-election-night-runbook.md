# 10 — Election-Night Runbook

## Confirming a race result (free, evidence-gated)
Edit `public/data/calls.json` on GitHub (pencil icon, commit to the deployed branch). Each call needs a `raceId`, the winner's `candidateId` (copy it from `public/data/dataset.json`), and evidence:
- one **official** source (a state or county election office results page), or
- two **news** sources from different publishers.

```json
{
  "updatedAt": "2026-11-04T15:20:00Z",
  "calls": [
    {
      "raceId": "senate-GA",
      "winnerCandidateId": "senate-GA:jon-ossoff",
      "calledAt": "2026-11-04T15:10:00Z",
      "evidence": [
        { "kind": "official", "publisher": "Georgia Secretary of State", "url": "https://results.example.gov/ga", "retrievedAt": "2026-11-04T15:05:00Z" }
      ]
    }
  ]
}
```
The example above shows the format only; it is not a result. The test suite rejects a call that has too little evidence, an unknown race or candidate, or a duplicate, and a failing test blocks the deploy, so a typo cannot publish a wrong call.

"Reported by Wikipedia" on the Results page is read automatically from each race's infobox, labeled unverified, and never counts as called.

## Getting AP or Decision Desk HQ data
I found no free or academic tier. Both are licensed. If you want automatic results, request access and tell me when you have a key; the pipeline has a clean adapter boundary. Draft request (edit as needed, send from your own email):

> Subject: Request for educational access to election results data
> Hello, I run Elecia, a free, non-commercial educational site where people record their own election predictions and compare them with results. I would like to ask whether you offer an academic, non-profit, or educational license or API access for 2026 U.S. Senate and gubernatorial results, and what the terms and cost would be. The site is static, ad-free, and collects no personal data. Thank you.

## Enabling the site (owner steps)
1. Merge the branch into `main` (the deploy workflow and the 15-minute schedule only run from the default branch).
2. Repo Settings → Pages → Source: **GitHub Actions**. Free Pages requires a public repository.
3. Open Actions → "Build and deploy" → Run workflow once, then open the Pages URL.
4. The site is `noindex` by default. Remove the robots meta in `index.html` to allow search engines.
