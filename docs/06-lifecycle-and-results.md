# 06 — Lifecycle: Nov 4 Shutdown, Results Ingestion, Autonomous Hosted Updates

## Key instants (single source: `domain/lifecycle`)
| Event | Instant (UTC) | Local equivalents |
|---|---|---|
| Election Day | 2026-11-03 | — |
| **Forecast/Endorse close** | `2026-11-04T09:57:00Z` | Nov 4, 1:57 AM PST · 4:57 AM EST (US DST ended Nov 1, 2026, so both zones are on standard time) |
| **Results visible** | `2026-11-04T14:00:00Z` | 9:00 AM EST · 6:00 AM PST |

Constants are stored in the `elections` row (`forecast_closes_at`, `results_visible_at`) and mirrored in a typed module; changing them requires a deploy/DB migration.

⚠️ **Dead zone:** between 4:57 AM and 9:00 AM ET the site is closed for predictions but not yet showing results. Proposed UI: a calm "Predictions are closed. Real results start appearing at 9:00 AM ET" state with countdown (computed from server time), plus saved maps. (Decision D9: show results immediately at close instead?)

## Authoritative time
- Server-side checks use the **database `now()`** (trigger on write tables) — the real gate.
- API routes also gate with server time for fast failure and friendly messages.
- Client fetches `GET /api/time` (server instant) once, derives offset, and uses it only for countdown display. The user's machine clock never gates anything.
- About page shows the cutoff converted to the viewer's timezone via `Intl.DateTimeFormat` + their IANA zone, from the server-provided instant, plus the fixed PST/EST statement.
- Test hook: `LIFECYCLE_NOW_OVERRIDE` is honored only in non-production builds, enabling rehearsals.

## Closed-state behavior
- `/2026/forecasting` and `/2026/endorsing` render a closed page, not an error; no write controls exist in the DOM.
- AI agent: write tools are removed from the tool list; read tools remain; policy text updated to say predictions are closed.
- `/2026/saved`, About, Contact, Terms, Blog, Privacy remain fully live. Saved maps remain interactive (pan/zoom/inspect). Nothing is deleted.
- Edge case: a request in flight at 09:56:59 may complete; one arriving after is rejected by the DB. Documented behavior.

## Results ingestion (hosted, autonomous, computer-off)
Scheduler: Supabase `pg_cron` → Edge Function (or Cloudflare Cron Trigger), every 1–5 minutes from election night through certification; every 15 minutes afterward; paused when idle.
Pipeline per run:
1. **Fetch** each enabled results adapter (official state feeds; licensed feed if D5 chooses it).
2. **Store raw** payload (immutable) with hash; skip if unchanged (ETag/hash).
3. **Normalize** to `actual_results` rows with `as_of`, `precincts_reporting_pct`, `source_id`.
4. **Evaluate** each race with deterministic rules → `race_outcomes`:
   - `none` → `projected` → `called` → `certified`.
   - `called` requires evidence: ≥1 official source indicating certified/clear final, **or** ≥2 independent attributable call sources; never from a single scrape, never from AI inference.
   - Close races, recounts, runoffs (e.g., GA/LA-style) stay `projected`/`counting` with a visible reason.
   - Partial results never flip a race to called by themselves.
5. **Publish** snapshot JSON to the CDN for fast reads; update user-visible comparisons lazily at read time (forecast vs `race_outcomes`), so saved forecasts are never rewritten.
6. **Log** an `ingest_runs` row; alert if a provider is stale > threshold or counts go backwards (anomaly).

An admin screen (auth-gated, owner only) lets you confirm/override a call with a source URL; overrides are logged with who/when/why. AI search may *suggest* sources for review, but never finalizes a race.

## Forecast vs. actual
Per race: your call, actual (or projected/uncalled), status label, last updated time, source links. Aggregate: seats correct/incorrect/pending by chamber, per-state hit rate. Everything labeled "as of <time>" and "provisional" until certified.

## Failure modes considered
- Provider outage → keep last good, show "last updated" prominently; try fallback adapter.
- Contradictory sources → race stays `projected`, both shown with attribution.
- Race changes (candidate withdrawal, special/runoff) → versioned `race_candidates`; existing predictions remain tied to original candidate ids and are displayed historically.
- API disappears → raw payload archive lets us re-normalize; adapters are swappable.
- Hosting free-tier cron limits → fall back to a GitHub Actions scheduled workflow calling the same Edge Function (best-effort timing; documented).
