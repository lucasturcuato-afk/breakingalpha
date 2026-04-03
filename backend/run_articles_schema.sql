-- run_articles_schema.sql
-- Phase 1 Observation Layer — Run Recorder
-- Run once in the Supabase SQL editor to create the run_articles table.
-- pipeline_runs must exist before running this.

CREATE TABLE run_articles (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id           uuid        NOT NULL REFERENCES pipeline_runs(id) ON DELETE CASCADE,
    article_id       uuid        NOT NULL,      -- corresponds to articles.id; no enforced FK to avoid cascade complexity on articles table
    role             text        NOT NULL,      -- 'candidate' | 'selected'
    relevance_score  float,
    selection_source text        NOT NULL,      -- how this row was produced:
                                               --   'reconstructed' — article set inferred by replaying the diversify
                                               --     query after the run; closely mirrors but is not guaranteed to
                                               --     match the exact set synthesize.py used.
                                               --   'exact' — article id was captured directly during synthesis
                                               --     (requires synthesize.py instrumentation; reserved for Phase 2+).
    created_at       timestamptz NOT NULL DEFAULT now()
);

-- Indexes for efficient per-run and per-article lookups
CREATE INDEX idx_run_articles_run_id     ON run_articles(run_id);
CREATE INDEX idx_run_articles_article_id ON run_articles(article_id);

-- Same RLS pattern as pipeline_runs
ALTER TABLE run_articles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read"   ON run_articles FOR SELECT USING (true);
CREATE POLICY "Public insert" ON run_articles FOR INSERT WITH CHECK (true);
