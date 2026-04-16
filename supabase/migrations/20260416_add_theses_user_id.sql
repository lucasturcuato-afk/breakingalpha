-- Phase 1 (personalization sprint): scope theses rows to their owning user.
--
-- Nullable on purpose — existing global theses predate personalization and we
-- must not break those rows. New inserts from /api/theses POST set user_id;
-- reads fall back to global (user_id IS NULL) when no per-user rows exist.

ALTER TABLE theses
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_theses_user_generated
  ON theses(user_id, generated_at DESC);

-- Dedup key guard — (user_id, lower(title), sector) must be unique within the
-- 7-day window enforced by the application layer. Here we add a partial unique
-- index so a future race-condition inside the same second can't create exact
-- duplicates even if the application 7-day lookup misses them.
CREATE UNIQUE INDEX IF NOT EXISTS idx_theses_user_title_sector_unique
  ON theses(user_id, lower(title), sector)
  WHERE user_id IS NOT NULL;
