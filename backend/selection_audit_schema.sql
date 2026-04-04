-- Phase 1 observation layer — Selection Auditor (run-level only)
-- One row per pipeline run, written by backend/audit.py after critique.py.
--
-- All rows carry provenance='reconstructed'. The selected/candidate sets
-- recorded in run_articles are approximations based on a replayed selection
-- query, not the exact input received by synthesize.py. Treat every field
-- in this table as an aggregate observation over that reconstructed set,
-- not a certified per-article fact.
--
-- run_id is nullable for schema consistency with other observation tables.
-- In practice the code never writes a row without a valid run_id.

create table if not exists selection_audit (
    id                        uuid primary key default gen_random_uuid(),
    run_id                    uuid null references pipeline_runs(id),
    brief_type                text,
    created_at                timestamptz default now(),

    -- Input set size
    candidate_count           int,     -- total articles in reconstructed pool
    selected_count            int,     -- articles with role='selected'
    target_count              int,     -- reference target (hardcoded 20); gap signals cap pressure

    -- Score-based miss signals (candidates = role='candidate' in run_articles)
    score_10_not_selected     int,     -- count of score=10 candidates not selected
    score_8_plus_not_selected int,     -- count of score>=8 candidates not selected
    top_unselected_score      int,     -- highest relevance_score among non-selected; null if no candidates

    -- Selected set score floor
    min_selected_score        int,     -- lowest relevance_score among selected; null if selected_count=0
    mean_selected_score       float,   -- average relevance_score of selected set (1 dp); null if empty

    -- Sector concentration (requires join to articles table for selected set)
    sector_counts_selected    jsonb,   -- {"Technology": 4, "Healthcare": 1, ...}; null if join fails
    sector_concentration_flag bool,    -- true if any sector >= 50% of selected_count; observational only

    -- Provenance marker
    provenance                text     -- always 'reconstructed' in Phase 1
);

-- For joining to pipeline_runs and run_articles
create index if not exists selection_audit_run_id_idx
    on selection_audit (run_id);

-- For time-series queries
create index if not exists selection_audit_created_at_idx
    on selection_audit (created_at desc);
