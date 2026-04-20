-- Adds the `market_cards` preference column to user_profiles.
-- Stores an ordered array of symbols (2–4) that the user wants to see as
-- metric cards at the top of the dashboard. NULL means "use defaults"
-- (SPY / VIX / TNX / SIGNALS).
--
-- Idempotent: safe to run multiple times.
-- No RLS changes: existing user_profiles RLS (owner-only select/update)
-- already applies to this column.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS market_cards jsonb DEFAULT NULL;

COMMENT ON COLUMN user_profiles.market_cards IS
  'Ordered array of dashboard metric card symbols (e.g. ["SPY","VIX","TNX","SIGNALS"]). NULL = use defaults.';
