-- Phase 1 observation layer — Brief Critic quality scores
-- One row per pipeline run, written by backend/critique.py after synthesis.
-- run_id is nullable: if observe.py fails, the critic row still writes.

create table if not exists brief_quality_scores (
    id                          uuid primary key default gen_random_uuid(),
    run_id                      uuid null references pipeline_runs(id),
    brief_type                  text,
    created_at                  timestamptz default now(),

    -- Headline heuristics
    headline_word_count         int,
    headline_pass               boolean,   -- true iff 10–15 words AND no HEADLINE_VAGUE_PATTERNS hit

    -- Hard banned phrase hits
    banned_phrase_hits          int,       -- distinct BANNED_PHRASES hits across summary + all sections
    what_to_watch_banned_hits   int,       -- distinct WHAT_TO_WATCH_BANNED hits in watch section only

    -- Section presence
    sections_present            jsonb,     -- sorted list of section keys present in output
    sections_omitted            jsonb,     -- expected keys missing from output

    -- Deal count
    top_deals_count             int,       -- len(top_deals array); null if parse fails

    -- Run status
    status                      text,      -- 'stub' | 'success'

    -- Soft flags (ambiguous patterns — never affect hard metrics)
    soft_flags                  jsonb null -- list of triggered flag ids; null if none
);

-- For joining to pipeline_runs
create index if not exists brief_quality_scores_run_id_idx
    on brief_quality_scores (run_id);

-- For time-series quality queries
create index if not exists brief_quality_scores_created_at_idx
    on brief_quality_scores (created_at desc);
