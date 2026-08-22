-- =====================================================================
-- 0033_user_claim_commit_note.sql
--
--   *** PROPOSAL. NOT APPLIED. ***
--
-- Gives the user's own commit note somewhere to live.
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
--
-- Safe to run at any time before the API change merges. After it merges, the
-- routes answer 503 rather than dropping the note, so a rollback degrades to
-- "cannot commit" rather than to silent data loss.
-- =====================================================================

ALTER TABLE user_claims
  ADD COLUMN IF NOT EXISTS commit_note text;

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
-- OPEN QUESTION FOR THE RULING. Not decided here.
-- =====================================================================
--
-- The design renders "YOU WROTE, 2026-08-06 06:58 PT" above the note
-- (prototype line 504). This proposal supplies no timestamp of its own and
-- expects Review to render user_claims.created_at, which is correct only while
-- the note cannot be edited after commitment.
--
-- The prototype never offers an edit affordance, so created_at is right today.
-- If a note ever becomes editable, "YOU WROTE" must track the note rather than
-- the row, and that needs its own column:
--
--   ALTER TABLE user_claims ADD COLUMN IF NOT EXISTS commit_note_at timestamptz;
--
-- Deliberately not included. Adding an unused column now is cheap; adding it
-- later is one more migration. Ruling either way is fine, but the Review
-- screen should not be built until it is ruled, because it decides which
-- timestamp that screen reads.
