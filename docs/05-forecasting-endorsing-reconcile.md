# 05 — Forecasting, Endorsing, Ballot Questions, Saved Maps, Reconcile

## Scope model (not presets)
A scope is a JSON predicate tree over races:
```
Scope = { include: Clause[], exclude: Clause[] }
Clause = { kind?: senate|house|governor|ballot, states?: USPS[], districts?: id[],
           race_ids?: id[], competitive?: {rule}, controls_chamber?: 'senate',
           has_polling?: bool, polled_since?: date }
```
Clauses are unioned in `include`, then `exclude` removed. "Competitive" and "could determine control" are **computed deterministically** from stored polling/history with the rule shown to the user (e.g., "polling margin ≤ 5 pts or no polling and historical margin ≤ 8") — and the thresholds are user-editable. Sidebar controls and the AI both edit this same object.

## Forecast flows
1. **Manual**: one-by-one cards; user calls Democratic / Republican / Other / Come back later.
2. **AI-assisted**: AI helps pick scope, surface evidence, queue races; the call is the user's click.
3. **Polling rule mode** ("go with whatever polling says"): deterministic. Uses the configured method; if no usable polling or the margin is exactly tied/indeterminate under the method (e.g., within a configurable tie band, default 0), the race goes to the user's queue. Origin tagged `rule:polling`; user can override any call.

## Polling methods (user-settable, also via AI)
`latest` · `latest_n(N)` · `window(days|weeks)` · `window + min_polls` · `provider_published` (labeled as theirs) · proposed additions: `recency_weighted`, `exclude_partisan_sponsors` (flag-based, off by default). Every average shows included/excluded polls and why. If data can't support a method (e.g., fewer than N polls), the UI says **"insufficient polling"** rather than inventing a number.

## Deferral ("Come back later")
Queue algorithm (deterministic, tested):
- Deferred item re-enters after **20** other items have been presented.
- If fewer than 20 items remain unresolved, it re-enters when the remaining queue is exhausted (i.e., circles back sooner; never starves, never nags).
- A deferred item is surfaced at most once per cycle; the Deferred drawer lists all deferred items for deliberate revisit anytime.
- Applies identically to Forecasting and Endorsing, tracked separately.

## Ballot questions
- Forecast mode: show question text, official summary, "yes means / no means", available polling, factual context; user predicts Yes/No/Come back later. Rendered in a **separate "Ballot" panel/layer**; excluded from chamber/governor/EV makeup by construction (separate views).
- Endorse mode: one-by-one; user records support/oppose; copy and UI clearly differ ("What do you want?" vs "What do you think will happen?").

## Makeup and transparency
Senate/House/Governor counts derive from `predictions` joined with baseline holdovers (seats not up in 2026 for Senate; vacancies/specials handled explicitly). The makeup panel is clickable: each seat lists contributing races and your call, plus unresolved seats shown as "uncalled" (never silently assigned to a party). Partial scope shows partial makeup with an explicit denominator.

## Saved maps — proposed definitions (Decision D6)
- **Prediction map** (limit 1,500 per election): a *working* set of calls — autosaved drafts, branch/versions, scratch experiments. Lightweight, cheap to create (e.g., "Georgia only", "what if latest-3").
- **Forecast map** (limit 70 per election): a deliberate, **named, frozen snapshot** of a prediction map: pins calls, scope, polling method, aggregate result, notes, and a **data snapshot id** so it can be reopened exactly as it was. Immutable.

Rationale: users iterate a lot (1,500 drafts) but "publish" few official forecasts (70). Old maps are never auto-deleted; creating a new one never overwrites an old one. Alternative reading: both are the same kind of object with different caps — rejected as pointless.

## Endorsing model
Separate table, separate UI, separate deferral queue. Items: Senate, House, Governor candidates, ballot questions. Always allowed to disagree with your forecast. Never auto-filled from forecasts, never reconciled in storage.

## Reconcile (descriptive only)
Statistics, no judgment words: match rate, mismatch rate by chamber/state/party, forecast-only count, endorsement-only count, "endorsed X, forecast Y" list, ballot-question agreement, deferred-never-resolved counts. Visuals: paired map (two maps side by side with a difference layer), a small Sankey/alluvial of forecast→endorsement, per-category bars. Copy rules: never "inconsistent", "good", "bad", "should". Uses the plain stored choices; deterministic.

## What happens after shutdown
All of the above becomes read-only. Saved maps open to an interactive view; once results go live, a map overlays **actual vs forecast** (hit/miss patterns + labels, not color alone) with a hit-rate summary (deterministic).
