-- 20260416_add_strategy_horizon_workflow.sql
--
-- Adds three profile dimensions collected during the onboarding redesign:
--   • strategy_type       — investment mandate (pe / equity / vc / macro / credit)
--   • investment_horizon  — typical holding period (short / medium / long)
--   • workflow_style      — how the analyst works (deep_dive / screening / monitoring)
--
-- All three are nullable so existing rows stay valid. The onboarding wizard and
-- upsertUserProfile() soft-fail if any column is missing at runtime, so this
-- migration is safe to apply independently of the app deploy.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS strategy_type TEXT
    CHECK (strategy_type IN ('pe', 'equity', 'vc', 'macro', 'credit'));

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS investment_horizon TEXT
    CHECK (investment_horizon IN ('short', 'medium', 'long'));

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS workflow_style TEXT
    CHECK (workflow_style IN ('deep_dive', 'screening', 'monitoring'));
