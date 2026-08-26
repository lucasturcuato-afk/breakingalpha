-- =====================================================================
-- 0033_user_claim_commit_note.sql
--
--   *** APPLIED TO PRODUCTION 2026-08-25, BY HAND, BY NOAH. ***
--
-- This file is now a RECORD of what was run, not a proposal. It was edited
-- after the fact to match production, because the version that shipped in the
-- PR contained only the first of the two columns. The second was ruled and run
-- by hand. A migration file that does not match the database it describes is
-- worse than no file, so this one was corrected rather than left as history.
--
-- Gives the user's own commit note, AND the moment it was written, somewhere
-- to live.
--
-- WHY
--
-- The mobile Commit sheet (build step 3) requires a note before its button
-- unlocks, and Review (build step 4) reads that note back to the user months
-- later under the heading "YOU WROTE". Neither is buildable today: there is
-- nowhere to write the note and nowhere to read it from.
--
-- What user_claims has now, and why none of it is this:
--
--   gradeability_note   the SERVER's explanation of why a claim cannot be
--                       graded. Written by the adopt and author routes, never
--                       by the user. sql/0012_radar_user_claims.sql:43
--   verdict_notes       on user_claim_outcomes, written by the grader at
--                       resolution. Also not the user's.  :73
--   user_claim          the claim text itself. On an adopted claim this is
--                       copied verbatim from the brief, so it is the desk's
--                       sentence, not the user's reasoning for taking it.
--
-- The note is a third thing: the user's stated reasoning at the moment of
-- commitment. It is the whole subject of the Review screen.
--
-- BLAST RADIUS
--
-- One nullable column on one table. No backfill, no rename, no drop, no index
-- change, nothing reads it until the API change in this PR ships. Existing
-- rows keep NULL and every current query is unaffected because none of them
-- SELECT *.
--
-- RLS needs no change. user_claims carries `user_claims_owner_all` FOR ALL
-- USING (auth.uid() = user_id) at 0012:85-95, so the column is owner-only the
-- moment it exists. The note is private by inheritance, which is the correct
-- default for something the product promises to read back only to its author.
--
-- REVERSIBLE
--
--   ALTER TABLE user_claims DROP COLUMN IF EXISTS commit_note;
--   ALTER TABLE user_claims DROP COLUMN IF EXISTS commit_note_at;
--
-- Safe to run at any time before the API change merges. After it merges, the
-- routes answer 503 rather than dropping the note, so a rollback degrades to
-- "cannot commit" rather than to silent data loss.
-- =====================================================================

ALTER TABLE user_claims
  ADD COLUMN IF NOT EXISTS commit_note text;

-- The moment the note was written, which is NOT the moment the claim was
-- adopted. See the ruling below: Review renders this, never created_at.
ALTER TABLE user_claims
  ADD COLUMN IF NOT EXISTS commit_note_at timestamptz;

-- A note that is present must say something. The product requires it before
-- the commit button unlocks, so an all-whitespace note is a client that got
-- around the gate, not a user who meant to leave it blank. NULL stays legal:
-- claims authored through paths that have no sheet, and every row that exists
-- today, have no note and are not retroactively invalid.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_claims_commit_note_nonempty'
  ) THEN
    ALTER TABLE user_claims
      ADD CONSTRAINT user_claims_commit_note_nonempty
      CHECK (commit_note IS NULL OR length(btrim(commit_note)) > 0);
  END IF;
END $$;

COMMENT ON COLUMN user_claims.commit_note IS
  'The user''s own reasoning, written in the Commit sheet at the moment of '
  'commitment and read back verbatim by the Review screen. Distinct from '
  'gradeability_note (the server''s) and verdict_notes (the grader''s). '
  'Owner-only via user_claims_owner_all.';

-- =====================================================================
-- VERIFY. Run after the ALTER; all four must pass.
-- =====================================================================
--
-- 1. Column exists, nullable, text.
--
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_name = 'user_claims' AND column_name = 'commit_note';
--   -- expect: commit_note | text | YES
--
-- 2. No existing row was touched.
--
--   SELECT count(*) FROM user_claims WHERE commit_note IS NOT NULL;
--   -- expect: 0
--
-- 3. The constraint rejects whitespace and accepts NULL.
--
--   -- expect: ERROR
--   INSERT INTO user_claims (user_id, user_claim, claim_type,
--                            resolution_method, commit_note)
--   VALUES ('00000000-0000-0000-0000-000000000000', 't', 'other', '{}', '   ');
--
-- 4. RLS still owner-only, one policy, unchanged.
--
--   SELECT policyname, cmd FROM pg_policies
--    WHERE tablename = 'user_claims';
--   -- expect exactly: user_claims_owner_all | ALL
--
-- =====================================================================
-- RULED. Review renders commit_note_at, never created_at.
-- =====================================================================
--
-- The design renders "YOU WROTE, 2026-08-06 06:58 PT" above the note
-- (prototype line 504). The question was which timestamp that is.
--
-- RULING: it is commit_note_at, the moment the NOTE was written, not
-- created_at, the moment the ROW was made. Noah, 2026-08-25.
--
-- The reasoning, and it is the reason the column exists rather than a
-- preference between two equally good options: the two values diverge the
-- moment a note is edited. created_at is right only for as long as a note can
-- never change after commitment, and nothing in the schema enforces that. A
-- screen whose entire subject is "what you said, when you said it" should read
-- the field that means that, not one that happens to coincide with it today.
--
-- CONSEQUENCE FOR REVIEW. commit_note_at is NULL on every claim adopted before
-- 2026-08-25, and there is no backfill: nothing recorded when those notes
-- would have been written, because there were no notes. Review must render the
-- honest-empty case for those rows. It must not fall back to created_at, which
-- would show a real-looking timestamp above a note that does not exist.
--
-- The write sets both together or neither. A note with no timestamp and a
-- timestamp with no note are both incoherent, and the API is the only place
-- that can guarantee it.
--
-- =====================================================================
-- VERIFY THE SECOND COLUMN
-- =====================================================================
--
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_name = 'user_claims'
--      AND column_name IN ('commit_note', 'commit_note_at')
--    ORDER BY column_name;
--   -- expect: commit_note    | text                     | YES
--   --         commit_note_at | timestamp with time zone | YES
--
--   SELECT count(*) FROM user_claims WHERE commit_note_at IS NOT NULL;
--   -- expect: 0 before the first commit sheet write
--
-- Both confirmed against production on 2026-08-25: the REST endpoint answers
-- 200 for each column rather than 42703.
