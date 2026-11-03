# Browser checks

These Playwright scripts drive the real app. They are not part of `npm test` because they need a running server and a
Playwright install.

```bash
npm run dev -- --port 5199        # simulated-clock checks need the dev server
node tests/e2e/lifecycle.cjs      # tour, forecast, endorse, reconcile, saved maps, closed state, results, pages
node tests/e2e/house.cjs          # House districts, list virtualization, search
node tests/e2e/ballot.cjs         # ballot deck, separation from chamber totals
node tests/e2e/helper.cjs         # research helper, refusals, hide control
node tests/e2e/reconcile.cjs      # paired forecast / endorsement map
npm run build && npm run preview -- --port 4199
BASE_URL=http://127.0.0.1:4199/ node tests/e2e/accessibility.cjs   # axe-core on every route, light and dark
```

The dev server accepts `?simulate=2026-11-04T10:00:00Z` to rehearse the shutdown and results phases.
