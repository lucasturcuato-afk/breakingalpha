-- live_score_columns.sql
-- Adds continuous in-flight grading columns to theses.
-- Idempotent — safe to re-run.

ALTER TABLE theses
    ADD COLUMN IF NOT EXISTS live_score              integer
        CHECK (live_score IS NULL OR (live_score >= -100 AND live_score <= 100));

ALTER TABLE theses
    ADD COLUMN IF NOT EXISTS live_verdict            text;

ALTER TABLE theses
    ADD COLUMN IF NOT EXISTS live_score_updated_at   timestamptz;

-- Index used by Track Record's "What's Been Working" / "What's Not" rankings.
CREATE INDEX IF NOT EXISTS theses_live_score_idx
    ON theses (live_score DESC NULLS LAST);

-- Index used by the average-live-score sparkline over the last 30 days.
CREATE INDEX IF NOT EXISTS theses_live_score_updated_idx
    ON theses (live_score_updated_at DESC NULLS LAST);
