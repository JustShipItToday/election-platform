# Elecia

A free, static 2026 U.S. election site. Forecast what you think will happen, record whom you want to win (stored separately), see the polls and sourced research behind every Senate, House and Governor race and 155 statewide ballot questions, and compare your forecast with real results. Your choices stay in your browser.

```bash
npm ci
npm test              # 303 tests
npm run dev           # local site
npm run data          # refresh races, nominees, polls, ballot measures
npm run research      # refresh ratings, past results, candidate profiles (slow when the cache is cold)
npm run official      # refresh official state tallies (North Carolina)
npm run districts     # rebuild House district shapes from Census TIGER (rarely needed)
npm run build         # type-check and build to dist/
```

Start with `AGENTS.md`, then `docs/09-static-pivot.md` (what ships), `docs/11-coverage-and-limits.md` (what is verified and what is not) and `docs/10-election-night-runbook.md`.
