-- v4b_sidebar_section_order.sql
-- Adds sidebar_section_order jsonb column to user_profiles for per-user
-- sidebar section ordering + visibility. Idempotent.
--
-- Shape: { "order": ["dashboard","morning-brief",...], "hidden": ["track-record"] }
-- NULL means the user hasn't customised the sidebar yet — use defaults.
--
-- No RLS change needed; user_profiles already has owner-only RLS.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS sidebar_section_order jsonb DEFAULT NULL;
