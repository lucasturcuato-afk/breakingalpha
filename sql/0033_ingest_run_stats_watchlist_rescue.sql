-- =====================================================================
-- 0033_ingest_run_stats_watchlist_rescue.sql
--
-- HAND-APPLY. Additive only: one nullable column on ingest_run_stats.
-- No existing column is altered, dropped or backfilled.
--
-- WHY. WATCHLIST_GATE_EXCEPTION lets an article BELOW the ingest gate be stored
-- anyway when it matches a ticker or company on somebody's watchlist. Those
-- articles are counted inside gate_passed, so without this column a run with the
-- exception on is indistinguishable from a run where the grader simply scored
-- more articles above the line. The whole point of raising the gate is to know
-- what it cost; an unobservable exception defeats that.
--
-- The identity gate_candidates = gate_passed + gate_dropped is UNCHANGED. This
-- column reports how many of gate_passed got there by rescue rather than by
-- score, so it is always <= gate_passed.
--
-- NOT a backfill. Rows written before this column exists stay NULL, which reads
-- as "the exception did not run, or predates the column". Runs with the flag off
-- write 0, so 0 and NULL are meaningfully different and are not merged.
--
-- Backend is forward-compatible: _persist_ingest_run_stats retries the insert
-- once without rescued_by_watchlist, so until this is applied the run still
-- records every other field instead of losing the whole stats row.
-- =====================================================================


-- =====================================================================
-- SECTION 0 -- INSPECT. Read-only. Run first.
-- =====================================================================
--
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name = 'ingest_run_stats'
--      AND column_name = 'rescued_by_watchlist';
--     Expect ZERO rows before applying, one after.
--
--   -- the pre-exception baseline, for comparison after the flag is turned on:
--   SELECT run_started_at, ingest_gate, gate_candidates, gate_passed,
--          gate_dropped_by_reason->>'below_gate' AS below_gate, articles_stored
--     FROM public.ingest_run_stats ORDER BY run_started_at DESC LIMIT 5;


-- =====================================================================
-- SECTION 1 -- the column.
-- =====================================================================

ALTER TABLE public.ingest_run_stats
  ADD COLUMN IF NOT EXISTS rescued_by_watchlist integer;

COMMENT ON COLUMN public.ingest_run_stats.rescued_by_watchlist IS
  'Articles stored DESPITE scoring below ingest_gate, because they matched a '
  'ticker or company watchlist identifier (WATCHLIST_GATE_EXCEPTION). Counted '
  'inside gate_passed, so gate_candidates = gate_passed + gate_dropped still '
  'holds. 0 = the exception ran and rescued nothing; NULL = it did not run or '
  'the row predates the column. Sector watchlist entries never rescue.';


-- =====================================================================
-- SECTION 2 -- VERIFY, after the next pipeline run.
-- =====================================================================
--
--   SELECT run_started_at,
--          ingest_gate,
--          gate_candidates,
--          gate_passed,
--          rescued_by_watchlist,
--          round(100.0 * rescued_by_watchlist
--                / nullif(gate_passed, 0), 1) AS pct_of_passed,
--          gate_dropped_by_reason->>'below_gate' AS below_gate,
--          articles_stored
--     FROM public.ingest_run_stats
--    ORDER BY run_started_at DESC LIMIT 3;
--
--   EXPECT while vars.WATCHLIST_GATE_EXCEPTION is unset or 0:
--     rescued_by_watchlist = 0 on every run. Non-zero means the flag is on when
--     nobody meant it to be.
--
--   EXPECT on the first run with the flag on AND vars.RELEVANCE_NEW_GATE = 3:
--     rescued_by_watchlist  roughly 135 (measured on run b64868c9, 2026-08-25)
--     articles_stored       roughly 499 rather than the 364 a bare gate of 3
--                           would have stored
--
--   If rescued_by_watchlist is 0 with the flag on and the gate above 1, either
--   the watchlist read failed (the run log says so explicitly) or every entry is
--   a sector row, which cannot rescue by design.
