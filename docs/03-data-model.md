# 03 — Data Model (Postgres, source of truth)

Conventions: UUID PKs; `created_at/updated_at`; every externally-derived row has `source_id → sources` and `retrieved_at`; times are `timestamptz` (UTC); money/counts are integers; enums as Postgres enums or checked text.

## Reference
- **elections**(id, cycle_year, election_date, forecast_closes_at, results_visible_at, status)
- **states**(id, usps, name, fips, electoral_votes)
- **offices**(id, kind[senate|house|governor|ballot], state_id, district_id?, class?, name)
- **districts**(id, state_id, number, geom_version_id, verified_at, verification_source_id)
- **boundary_versions**(id, kind, label, effective_for_election_id, source_id)  ← handles mid-decade redistricting
- **races**(id, election_id, office_id, kind[general|special|runoff], seat_incumbent_party, status[upcoming|polls_open|counting|called|certified], called_at?, notes)
- **candidates**(id, wikidata_qid?, fec_id?, bioguide_id?, full_name, party, incumbent bool, website_url?)
- **race_candidates**(race_id, candidate_id, ballot_name, party_on_ballot, status[active|withdrawn|…])
- **ballot_questions**(id, election_id, state_id, local_scope?, title, summary_official, full_text_url, yes_means, no_means, source_id)

## Evidence
- **sources**(id, category[poll|historical|official_statement|public_record|rating|news|ai_summary], publisher, url, license, terms_url, trust_notes)
- **raw_payloads**(id, source_id, fetched_at, content_hash, body jsonb/blob)  immutable
- **pollsters**(id, name, grade_source?, methodology_url?)
- **polls**(id, race_id|ballot_question_id, pollster_id, source_id, field_start, field_end, released_at, sample_size?, population[lv|rv|a]?, mode?, margin_error?, sponsor?, url, partisan_flag?, **ingested_at**)
- **poll_results**(poll_id, candidate_id|answer[yes|no|undecided], pct numeric)
- **polling_averages_provider**(race_id, provider, value jsonb, as_of)  — only provider-published averages, labeled as theirs
- **historical_results**(id, office_id|district_id, year, candidate_name, party, votes, pct, source_id)
- **ratings**(id, race_id, org, rating, as_of, url)  — metadata + link only unless licensed
- **news_items**(id, publisher, headline, snippet, url, published_at, race_ids[], source_id)  — no full text
- **candidate_bios**(id, candidate_id, text, neutrality_checked bool, source_ids[], generated_by[human|ai_summary], created_at)
- **official_statements**(id, candidate_id, kind[campaign_site|press_release|filing|speech], text_excerpt, url, published_at, source_id)
- **quotes**(id, candidate_id, text, context, url, said_at, source_id, verified bool)
- **issue_positions**(id, candidate_id, issue, stated_position_excerpt, url, as_of, origin[campaign|official|reporting])
- **candidate_photos**(id, candidate_id, url, license, author, source_page_url, verified_identity_via, verified_at)  — absent row ⇒ placeholder
- **endorsements_by_others**(id, candidate_id, endorser, url, as_of)  — factual third-party endorsements

## Results
- **actual_results**(id, race_id|ballot_question_id, candidate_id|answer, votes, pct, precincts_reporting_pct, as_of, source_id, is_official bool)
- **race_outcomes**(race_id, status[none|projected|called|certified], winner_candidate_id?, evidence jsonb[source_ids,count], decided_by[auto_rule|admin], decided_at)  ← evidence-gated finalization
- **ingest_runs**(id, provider, started_at, finished_at, ok, rows_in, rows_changed, error)

## User data (RLS: `user_id = auth.uid()`)
- **profiles**(user_id, display_name?, ai_enabled bool, polling_defaults jsonb)
- **predictions**(id, user_id, election_id, prediction_map_id, race_id|ballot_question_id, pick_candidate_id|pick_answer, origin[user|rule:polling|user_via_ai], note?, made_at)
- **endorsements**(id, user_id, election_id, race_id|ballot_question_id, pick_candidate_id|pick_answer, note?, made_at)  ← separate table, no FK to predictions
- **prediction_maps**(id, user_id, election_id, name?, scope jsonb, polling_method jsonb, status[draft|autosave|archived], parent_id?, created_at)
- **forecast_maps**(id, user_id, election_id, prediction_map_id, name, notes, scope jsonb, polling_method jsonb, calls jsonb, aggregate jsonb, data_snapshot_ref, data_as_of, frozen_at)  immutable after insert
- **deferrals**(id, user_id, mode[forecast|endorse], item_ref, deferred_at, items_seen_at_defer, resurface_after_n)
- **saved_research**(id, user_id, title, query, tool_calls jsonb, answer, sources jsonb, created_at)
- **data_snapshots**(id, as_of, polls_hash, races_hash, storage_ref)  ← makes forecasts reproducible

## Integrity rules enforced in the DB
- `predictions`/`endorsements` INSERT/UPDATE rejected when `now() >= elections.forecast_closes_at` (trigger; not just app code).
- Count limits per (user, election): ≤1,500 non-archived `prediction_maps`, ≤70 `forecast_maps` (trigger; error is user-readable).
- `forecast_maps` rows are immutable (no UPDATE/DELETE except owner delete of the whole row).
- `predictions` for ballot questions never join into chamber makeup views.
- Only `service_role` can write evidence/results tables; users read-only.
