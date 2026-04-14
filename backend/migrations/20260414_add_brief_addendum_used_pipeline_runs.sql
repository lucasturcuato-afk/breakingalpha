-- Track which addendum was used in each pipeline run
ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS brief_addendum_used jsonb;
