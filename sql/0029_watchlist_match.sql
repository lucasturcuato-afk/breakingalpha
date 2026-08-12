-- 0029_watchlist_match.sql
--
-- HAND-APPLY. Agents do not run migrations.
--
-- Records which watchlist identifiers an article matched, replacing the
-- in-place +2 rewrite of articles.relevance_score that backend/watchlist.py
-- used to perform.
--
-- Why this column exists:
--   boost_watchlist_relevance matched identifiers as bare SUBSTRINGS, so
--   two-letter tickers (v, de, ba, bx, cf, gd, ge, gs, mu, on, pl) matched
--   inside ordinary words -- "de" in "demand", "v" in any title containing the
--   letter v. 96.5% of a 9,600-row uuid-stratified sample of the live corpus
--   matched at least one identifier, so the boost applied a near-constant +2
--   to the whole table. That destroyed the grader's scale (the rubric's 6-7
--   analyst-action band landed at 8-9) and was unrecoverable, because nothing
--   on the row recorded that a boost had been applied.
--
--   Matching is now token-anchored, and the match is recorded HERE instead of
--   being folded into the score. relevance_score once again means only what
--   the grader assigned. Ranking on watchlist membership becomes a read-side
--   decision over this column.
--
-- Semantics:
--   NULL  -> matched nothing, or the row predates this column. The two are not
--            distinguished; backend/watchlist.py writes only non-empty matches
--            to keep the per-run write volume down.
--   text[] -> the distinct lowercased watchlist identifiers this article
--            matched, sorted.
--
-- NOT a backfill. Historical relevance_score values still carry the old +2 and
-- are deliberately left alone: the corpus is two scoring populations split at
-- 2026-06-19 (legacy FILTER_PROMPT vs RELEVANCE_GRADE_PROMPT) and how to
-- correct them is a separate decision.

ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS watchlist_match text[];

COMMENT ON COLUMN articles.watchlist_match IS
  'Distinct lowercased watchlist identifiers this article matched, token-anchored. '
  'NULL = no match or pre-dates the column. Never folded into relevance_score.';

-- Supports "articles matching this watchlist entry" reads, which is the whole
-- point of recording the match rather than baking it into the score.
-- GIN over text[] serves the array-containment operator PostgREST emits for
-- .contains("watchlist_match", [...]) / cs.{...}.
CREATE INDEX IF NOT EXISTS idx_articles_watchlist_match
  ON articles USING GIN (watchlist_match)
  WHERE watchlist_match IS NOT NULL;
