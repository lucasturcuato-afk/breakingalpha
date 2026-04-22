-- Phase 1A: Fix brief_section_ratings schema
-- Run against Supabase SQL Editor (service role)

-- Step 1: Deduplicate existing rows — keep only the most recent rating
-- per (user_id, section_key) pair.
DELETE FROM brief_section_ratings
WHERE id NOT IN (
  SELECT DISTINCT ON (user_id, section_key)
         id
  FROM brief_section_ratings
  ORDER BY user_id, section_key, created_at DESC
);

-- Step 2: Partial unique index for rows WITHOUT a briefing_id.
-- This covers the legacy case: one rating per user per section when no
-- briefing_id was sent.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bsr_user_section_no_briefing
  ON brief_section_ratings (user_id, section_key)
  WHERE briefing_id IS NULL;

-- Step 3: Partial unique index for rows WITH a briefing_id.
-- One rating per user per section per briefing.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bsr_user_section_briefing
  ON brief_section_ratings (user_id, section_key, briefing_id)
  WHERE briefing_id IS NOT NULL;

-- Step 4: RLS — users can only read/write their own rows.
ALTER TABLE brief_section_ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bsr_select_own ON brief_section_ratings;
CREATE POLICY bsr_select_own ON brief_section_ratings
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS bsr_insert_own ON brief_section_ratings;
CREATE POLICY bsr_insert_own ON brief_section_ratings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS bsr_update_own ON brief_section_ratings;
CREATE POLICY bsr_update_own ON brief_section_ratings
  FOR UPDATE USING (auth.uid() = user_id);
