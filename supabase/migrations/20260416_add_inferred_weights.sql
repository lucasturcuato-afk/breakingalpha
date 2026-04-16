-- Phase 1 (personalization sprint): inferred sector weights on user_profiles.
--
-- Weights are { sector_name: number between 0.3 and 2.5 } updated by
-- src/lib/user-profile.ts::updateInferredWeights() from user_events
-- aggregates. 1.0 = neutral; >1.0 boosts sector in re-ranking, <1.0 suppresses.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS inferred_sector_weights JSONB DEFAULT '{}'::jsonb;

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS inferred_weights_updated_at TIMESTAMPTZ;
