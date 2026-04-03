-- pipeline_runs_schema.sql
-- Phase 1 Observation Layer — Run Recorder
-- Run once in the Supabase SQL editor to create the pipeline_runs table.

CREATE TABLE pipeline_runs (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    brief_type      text        NOT NULL,       -- 'morning' | 'evening'
    started_at      timestamptz NOT NULL,
    completed_at    timestamptz,
    duration_s      float,
    briefing_id     uuid,                       -- reserved for Phase 2+; null in Phase 1 (briefings.id existence in live schema unverified)
    headline_snap   text,                       -- snapshot of briefing headline at record time
    status          text        NOT NULL,       -- 'success' | 'stub' | 'error'
    ingest_count    int,                        -- new articles stored by the ingest step
    candidate_count int,                        -- articles in the 24h pool before diversification
    selected_count  int,                        -- articles reconstructed as passed to synthesis
    model_ingest    text,                       -- e.g. 'llama-3.1-8b-instant'
    model_synth     text,                       -- e.g. 'llama-3.3-70b-versatile'
    error_notes     text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- The pipeline uses SUPABASE_ANON_KEY, so public insert is required.
-- Public read allows operator review in the Supabase dashboard.
ALTER TABLE pipeline_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read"   ON pipeline_runs FOR SELECT USING (true);
CREATE POLICY "Public insert" ON pipeline_runs FOR INSERT WITH CHECK (true);
