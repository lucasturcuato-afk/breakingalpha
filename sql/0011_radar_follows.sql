-- Radar: follows table (Following sub-tab).
-- Created: 2026-07-04 (feat/radar-unified)
--
-- DO NOT AUTO-APPLY. Written for human review; apply manually.
-- Apply order: 0011 before 0012 (no dependency between them, but keep
-- the numbered sequence).
--
-- Additive and non-destructive: one new table. No existing table,
-- column, or constraint is touched. Idempotent: safe to re-run.
--
-- A follow is a user-owned pointer into the ALREADY-INGESTED article
-- corpus. Follows never trigger per-follow external API calls; matching
-- happens read-time against articles (taxonomy arrays, company name
-- ILIKE per the watchlist precedent) and content_embeddings (topic
-- follows, via the existing match_content_embeddings RPC).
--
-- follow_type semantics:
--   ticker    target = ticker symbol; matched_keywords carries the
--             resolved company name(s) from the companies table
--   company   target = company name (canonical or as-entered)
--   industry  target = one of the 11 INDUSTRY_VERTICALS taxonomy values
--   activity  target = one of the 11 ACTIVITY_TYPES taxonomy values
--   topic     target = the user's phrase verbatim; embedding holds a
--             gemini-embedding-001 vector(768) computed ONCE at creation
--
-- Requires the pgvector extension, already enabled for
-- content_embeddings. CREATE EXTENSION guard included for safety.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS follows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  follow_type text NOT NULL
    CHECK (follow_type IN ('ticker','company','industry','activity','topic')),
  target text NOT NULL,
  display_name text,
  matched_keywords text[],
  embedding vector(768),
  muted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, follow_type, target)
);

CREATE INDEX IF NOT EXISTS idx_follows_user ON follows(user_id);

-- RLS: follows are private to their owner (unlike the public-read
-- watchlist tables). Service role bypasses RLS for backend jobs.
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'follows'
      AND policyname = 'follows_owner_all'
  ) THEN
    EXECUTE 'CREATE POLICY follows_owner_all ON follows
      FOR ALL USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id)';
  END IF;
END $$;
