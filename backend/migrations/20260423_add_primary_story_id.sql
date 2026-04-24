-- Persist Gemini's primary_story_id self-check field on the briefings table
-- so we have an audit trail of "what Gemini said it picked" alongside the
-- written headline. Nullable text — older rows stay null; newer rows get
-- whatever Gemini emits.
--
-- Apply via Supabase Studio SQL Editor before merging the feature branch.
-- The synthesize.py insert is resilient: until this column exists, the
-- extras-with-pulse insert will fail and fall back to the base row, so the
-- brief still ships — but the audit trail will be empty.

ALTER TABLE briefings ADD COLUMN IF NOT EXISTS primary_story_id text;
