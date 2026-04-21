-- Grader upgrade — one row per grading run (append-only history).
CREATE TABLE IF NOT EXISTS thesis_verdicts (
    id                                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    thesis_id                         uuid        NOT NULL REFERENCES theses(id) ON DELETE CASCADE,
    verdict                           text        NOT NULL CHECK (verdict IN ('confirmed','invalidated','inconclusive')),
    confidence                        numeric     CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
    notes                             text,
    key_evidence_ids                  uuid[]      NOT NULL DEFAULT '{}',
    signals_weighted                  jsonb,
    contradicting_evidence_considered boolean     NOT NULL DEFAULT false,

    -- rule features
    tag_overlap_count                 numeric,
    new_article_count                 numeric,
    weighted_sentiment_alignment      numeric,
    source_diversity_score            numeric,
    time_elapsed_days                 numeric,
    supporting_vs_contradicting_ratio numeric,

    -- provenance
    model_version                     text,
    prompt_version                    text,
    cost_estimate                     numeric,

    graded_at                         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS thesis_verdicts_thesis_graded_idx
    ON thesis_verdicts (thesis_id, graded_at DESC);

CREATE INDEX IF NOT EXISTS thesis_verdicts_verdict_idx
    ON thesis_verdicts (verdict);

ALTER TABLE thesis_verdicts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'thesis_verdicts' AND policyname = 'Public read thesis_verdicts') THEN
        CREATE POLICY "Public read thesis_verdicts"   ON thesis_verdicts FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'thesis_verdicts' AND policyname = 'Public insert thesis_verdicts') THEN
        CREATE POLICY "Public insert thesis_verdicts" ON thesis_verdicts FOR INSERT WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'thesis_verdicts' AND policyname = 'Public update thesis_verdicts') THEN
        CREATE POLICY "Public update thesis_verdicts" ON thesis_verdicts FOR UPDATE USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'thesis_verdicts' AND policyname = 'Public delete thesis_verdicts') THEN
        CREATE POLICY "Public delete thesis_verdicts" ON thesis_verdicts FOR DELETE USING (true);
    END IF;
END $$;

-- Theses ALTERs (idempotent)
ALTER TABLE theses ADD COLUMN IF NOT EXISTS locked_at  timestamptz;
ALTER TABLE theses ADD COLUMN IF NOT EXISTS expired    boolean NOT NULL DEFAULT false;
ALTER TABLE theses ADD COLUMN IF NOT EXISTS confidence numeric CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1));

CREATE INDEX IF NOT EXISTS theses_expired_locked_idx
    ON theses (expired, locked_at) WHERE outcome IS NULL;
