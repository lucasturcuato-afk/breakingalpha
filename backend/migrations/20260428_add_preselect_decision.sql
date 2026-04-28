-- Filter A2 v2-calibration observability hook.
-- Persists lead_preselect's per-run decision log so we can tune
-- thresholds and keyword vocabularies from production data instead
-- of synthetic corpora.
--
-- Shape (set in backend/lead_preselect.py:_LAST_DECISION_LOG):
--   {
--     "filter_a_candidates":  int,
--     "filter_a2_candidates": int,
--     "filter_b_macro_hit":   bool,
--     "filter_b_geo_hit":     bool,
--     "filter_b_sector_hit":  bool,
--     "winner_reason":        text|null,
--     "winner_deal_value":    text|null,
--     "winner_stage":         text|null,
--     "winner_deal_type":     text|null,
--     "winner_url":           text|null
--   }
ALTER TABLE pipeline_runs
    ADD COLUMN IF NOT EXISTS preselect_decision jsonb;
