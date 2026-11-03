# 08 — Testing, Risks, and Roadmap

## Testing strategy
- **Unit (domain):** scope compiler, polling methods (edge cases: ties, fewer than N polls, overlapping windows), makeup math, deferral queue (≥20 rule, tail-of-queue rule), lifecycle with injected clock, limit enforcement.
- **DB tests:** closing trigger rejects writes at/after cutoff; count limits; RLS isolation between users; forecast immutability.
- **Adapter contract tests:** against recorded real responses (clearly labeled fixtures) + a live smoke check job.
- **AI policy suite:** ≥150 adversarial cases — endorsement-seeking ("who should I vote for?", "which candidate is better?"), indirect ("if you were me…"), persuasion, ranking/scoring, system-prompt extraction (direct, indirect, translation, encoding, roleplay, tool-output injection), jailbreak variants. Each has a pass/fail assertion; run on every prompt/model/tool change.
- **E2E (Playwright):** first-visit tour (skippable), scope via sidebar and via AI, one-by-one flow, deferral, save/restore, AI-off mode, shutdown state via simulated clock, results flip, keyboard-only run, reduced-motion run, mobile viewport run.
- **Performance budgets:** map interaction ≥ 50 fps on a mid laptop at Balanced tier; JS payload budget for first load; Lighthouse a11y ≥ 95.
- **Accessibility:** axe in CI + manual screen-reader pass (VoiceOver/NVDA).

## Top risks
| ID | Risk | Mitigation |
|---|---|---|
| R1 | Mid-decade redistricting makes "119th Congress" district shapes wrong for some 2026 races | Per-state boundary verification; versioned boundaries; visible verification note |
| R2 | No free national results feed | Hybrid evidence-gated model + admin override; or license AP/DDHQ (D5) |
| R3 | Provider terms (FiftyPlusOne, VoteHub, news APIs) unverified | Verify before ingest; attribution built in; adapter swappability |
| R4 | The timeline: ~15 hours to shutdown, ~6 to a requested 5 PM publish | Ruthless scope tiers below; this plan states honestly what ships tonight |
| R5 | LLM misbehavior on political advice or prompt extraction | Layered guards + adversarial suite; fail-closed refusals |
| R6 | Photo identity/licensing errors | Wikidata-verified identity + license allowlist; otherwise placeholder |
| R7 | Free-tier hosting limits (cron frequency, function timeouts, commercial-use terms) | Verify at signup; Cloudflare/GitHub Actions fallbacks |
| R8 | Partial/contradictory results prematurely mark races final | Deterministic evidence gating; human override with audit |

## Roadmap (honest timeline)
**Now = 2026-11-03 ~10:45 AM PT. Close = Nov 4 1:57 AM PT (~15 h). Requested publish = 5 PM PT (~6 h).**
The *entire* vision cannot be built, tested, and data-populated in 6 hours without cutting corners that violate your own rules (no placeholders, no fabricated data, accessibility, tested guards). So I propose tiers; **you choose** (Decision D3):

### Tier 1 — "Tonight" (what can honestly ship by ~5 PM if you approve now)
Foundation + data truth first: repo/app skeleton, DB + lifecycle gates, FiftyPlusOne/VoteHub polling ingestion with our own averaging methods, **Senate + Governor races** (≈ 35 + 36 contests) with candidates, one-by-one forecasting with deferral, scope sidebar, makeup panel, a state-level MapLibre map, local save (prediction + forecast maps), first-visit tour, About with local-time shutdown, shutdown gate enforced in DB, AI agent with core read tools + factual-only guards (if you provide the LLM key), Reconcile v0 (descriptive) only if Endorsing exists.
### Tier 2 — House + Endorsing + Reconcile (district map, 435 seats; depends on verified district boundaries and candidate data)
### Tier 3 — Accounts/cloud sync, Blog, richer illustration, photos pipeline, results ingestion hardening, polish
### Hard deadline note
Because predictions close at 1:57 AM PT, anything not live by roughly evening has very little useful prediction time. Results ingestion (from 9 AM ET Nov 4) and saved-forecast viewing matter more than most Tier 2/3 features; I recommend **front-loading results + saved-map viewing** over House breadth.

## Todo (initial)
- [ ] Owner decisions D1–D10 (`00-decisions-needed.md`)
- [ ] Verify provider terms (FiftyPlusOne, VoteHub) and fetch real samples
- [ ] Get FEC + Congress.gov free keys
- [ ] Choose + provision hosting/DB; env var handling
- [ ] Repo scaffold, CI, lint/typecheck/test
- [ ] DB schema + lifecycle triggers + RLS
- [ ] Polling adapters + normalized poll store + averaging methods + tests
- [ ] Race/candidate seed from FEC/FiftyPlusOne/Wikidata with provenance
- [ ] Scope compiler + sidebar
- [ ] One-by-one flow + deferral queue
- [ ] Makeup + transparency panel
- [ ] Map (state level → district level)
- [ ] Tour, About with local-time cutoff, closed state
- [ ] AI agent tools + guards + adversarial suite
- [ ] Results ingestion + evidence gate + admin override
- [ ] Observability + health page
