-- 0041_backfill_resolve_on_graded_legacy.sql
--
-- APPLIED 2026-09-06 to the production database, by an agent, under the
-- Database writes rules in CLAUDE.md. This file has run. What it did, as
-- measured, not as predicted:
--
--   section 0   446 total, 305 with resolve_on NULL, 85 of those graded,
--               220 not; newest null brief_date 2026-07-22; grade lag min 0
--               max 0; neither column present yet. Matched every expectation.
--   1a          ALTER TABLE x2, COMMENT x2
--   1b          UPDATE 85     (counted 85 from the identical predicate first)
--   1c          UPDATE 220    (counted 220 from the identical predicate first)
--   2a          graded 209 | gradeable_pending 17 | ungradable 220 |
--               defect 0 | total 446, and the four buckets sum to the total
--   2b          n 220 | {horizon_never_captured} | newest 2026-07-01 |
--               with_outcome 0. The newest date differed from what this file
--               predicted; see the note at 2b. The comment was wrong, the
--               data was not.
--   2c          0 rows newly due
--   2d          outcomes 209 before, 209 after: the desk record did not move
--
-- Applying it again is a no-op: IF NOT EXISTS on both columns, and both
-- UPDATE predicates now match zero rows.
--
-- ORDERING: this file was applied BEFORE the grader change in the same PR
-- shipped; until it is applied the grader fails every run naming it as the fix.
--
-- WHAT THIS DOES, in one apply that leaves every row of morning_brief_calls
-- in a stated state:
--   1a. adds grading_status (gradeable | ungradable) and ungradable_reason
--   1b. sets resolve_on = brief_date on the 85 legacy calls that WERE graded
--   1c. marks the 220 legacy calls that never were as ungradable, with the
--       reason on the row
-- After it: graded rows (85 legacy + everything the grader has written),
-- gradeable rows (resolve_on set, status gradeable) and ungradable rows
-- (status ungradable, resolve_on NULL, reason horizon_never_captured). No
-- row is gradeable with resolve_on NULL; the grader treats that as a defect.
--
-- Measured over the full morning_brief_calls table on 2026-09-06:
--
--   rows                         446
--   resolve_on NULL              305   (brief_date 2026-04-24 .. 2026-07-22)
--   resolve_on set               141   (brief_date 2026-07-27 onward, none NULL)
--   NULL rows WITH an outcome     85   (all graded on brief_date itself)
--   NULL rows WITHOUT an outcome 220   (the "invisible half")
--
-- WHY A MARKER ON THE CALL, NOT AN OUTCOME ROW. The calls precedent for
-- "ungradable" is an outcome row with verdict 'ungradable'. Not used here,
-- measured 2026-09-06: the desk record (src/lib/desk-record-query.ts) counts
-- every outcome row with no date window, so 220 marker rows would move the
-- dashboard's record from 209 to 429 total and "No clean read" from 84 to
-- 304, and push the record's start date back to April. The record is the
-- product's public claim about itself and does not get to move. The other
-- precedent, user_claims (sql/0012: gradeable flag + gradeability_note +
-- status 'ungradable'), lives on the claim row and is read by no record
-- surface. This follows that one. No reader-facing number moves.
--
-- WHY THE 85 GET A DATE AND THE 220 DO NOT. resolve_on is not a function of
-- claim_type: the stored horizons since 0014 range from 0 to 45 days inside
-- every type, because the model states a day count per claim
-- (backend/call_horizons.py) and the code adds it to brief_date. Before PR
-- #507 (2026-07-25) no horizon field existed in the extractor, the briefings
-- body stores none, and 300 of the 305 NULL rows' claim_text names no
-- horizon. For the 220 the horizon was never captured anywhere; a backfilled
-- date would be a number the text did not state, which sql/0014's header and
-- the grader's argument guard both refuse. The 85 each have an outcome row
-- graded ON brief_date by the pre-horizon grader ("off" mode, brief_date ==
-- today): their window WAS the session, so resolve_on = brief_date records
-- how they were graded and makes nothing newly due.
--
-- Sections:
--   0. VERIFY FIRST (read-only)
--   1. columns, the two backfills
--   2. MEASURE AFTER (read-only)


-- ===========================================================================
-- 0. VERIFY FIRST. Read-only. The numbers above must still hold.
-- ===========================================================================

-- 0a. Expect: total 446, null_all 305, null_graded 85, null_ungraded 220,
--     newest_null 2026-07-22. If null_all has grown or newest_null is later,
--     the write path regressed since the measurement: STOP and read the
--     grader's [grade] excluded line first.
--
--   SELECT count(*)                                              AS total,
--          count(*) FILTER (WHERE resolve_on IS NULL)              AS null_all,
--          count(*) FILTER (WHERE resolve_on IS NULL
--                             AND EXISTS (SELECT 1 FROM public.morning_brief_call_outcomes o
--                                          WHERE o.call_id = c.id))   AS null_graded,
--          count(*) FILTER (WHERE resolve_on IS NULL
--                             AND NOT EXISTS (SELECT 1 FROM public.morning_brief_call_outcomes o
--                                              WHERE o.call_id = c.id)) AS null_ungraded,
--          max(brief_date) FILTER (WHERE resolve_on IS NULL)      AS newest_null
--     FROM public.morning_brief_calls c;

-- 0b. Every graded NULL row was graded ON its brief_date. Expect one row:
--     n 85, min_lag 0, max_lag 0. Any other lag means a window 1b would
--     misstate; STOP.
--
--   SELECT count(*) AS n,
--          min(o.graded_at::date - c.brief_date) AS min_lag,
--          max(o.graded_at::date - c.brief_date) AS max_lag
--     FROM public.morning_brief_calls c
--     JOIN public.morning_brief_call_outcomes o ON o.call_id = c.id
--    WHERE c.resolve_on IS NULL;

-- 0c. The columns do not exist yet. Expect 0.
--
--   SELECT count(*) FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'morning_brief_calls'
--      AND column_name IN ('grading_status', 'ungradable_reason');


-- ===========================================================================
-- 1. COLUMNS AND THE TWO BACKFILLS. One paste, inside a transaction. Each
--    statement is a no-op on a second run: IF NOT EXISTS, and UPDATEs whose
--    WHERE matches nothing once applied.
-- ===========================================================================

-- 1a. The marker, the user_claims shape (sql/0012). Every existing row is
--     gradeable by default; 1c narrows that to the truth.
ALTER TABLE public.morning_brief_calls
    ADD COLUMN IF NOT EXISTS grading_status text NOT NULL DEFAULT 'gradeable'
        CHECK (grading_status IN ('gradeable', 'ungradable'));

ALTER TABLE public.morning_brief_calls
    ADD COLUMN IF NOT EXISTS ungradable_reason text;

COMMENT ON COLUMN public.morning_brief_calls.grading_status IS
    'gradeable: the due-scan may select it once resolve_on passes. ungradable: '
    'it says so, with ungradable_reason; the grader skips it and never grades '
    'it. A gradeable row with resolve_on NULL is a write-path defect.';
COMMENT ON COLUMN public.morning_brief_calls.ungradable_reason IS
    'Why grading_status is ungradable. horizon_never_captured: written before '
    'migration 0014, no horizon exists for it anywhere (sql/0041).';

-- 1b. The 85: resolve_on records the session window their outcome row proves.
UPDATE public.morning_brief_calls c
   SET resolve_on = c.brief_date
 WHERE c.resolve_on IS NULL
   AND EXISTS (SELECT 1 FROM public.morning_brief_call_outcomes o
                WHERE o.call_id = c.id
                  AND o.graded_at::date = c.brief_date);
-- Expect: UPDATE 85

-- 1c. The 220: say it on the row. After 1b, a NULL resolve_on is exactly a
--     legacy call with no outcome; this marks those and nothing else.
UPDATE public.morning_brief_calls c
   SET grading_status    = 'ungradable',
       ungradable_reason = 'horizon_never_captured'
 WHERE c.resolve_on IS NULL
   AND c.grading_status = 'gradeable'
   AND NOT EXISTS (SELECT 1 FROM public.morning_brief_call_outcomes o
                    WHERE o.call_id = c.id);
-- Expect: UPDATE 220


-- ===========================================================================
-- 2. MEASURE AFTER. Read-only.
-- ===========================================================================

-- 2a. Every row is in exactly one stated state. Expect:
--       graded 209 (85 legacy + 124 with horizons), gradeable_pending 17,
--       ungradable 220, defect 0, and the four sum to total 446.
--
--   SELECT count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.morning_brief_call_outcomes o
--                                          WHERE o.call_id = c.id))       AS graded,
--          count(*) FILTER (WHERE grading_status = 'gradeable' AND resolve_on IS NOT NULL
--                             AND NOT EXISTS (SELECT 1 FROM public.morning_brief_call_outcomes o
--                                              WHERE o.call_id = c.id))   AS gradeable_pending,
--          count(*) FILTER (WHERE grading_status = 'ungradable')          AS ungradable,
--          count(*) FILTER (WHERE grading_status = 'gradeable' AND resolve_on IS NULL) AS defect,
--          count(*)                                                       AS total
--     FROM public.morning_brief_calls c;

-- 2b. The ungradable rows are exactly the legacy set, all with the reason.
--     Expect one row: n 220, reasons {horizon_never_captured}, newest
--     2026-07-01, with_outcome 0.
--
--     newest is 2026-07-01 here and 2026-07-22 in 0a because the two measure
--     DIFFERENT SETS. 0a's newest_null is the max over all 305 rows that had
--     resolve_on NULL; 2b's newest is the max over the 220 this file MARKED,
--     which excludes the 85 that 1b gave a resolve_on. The newest row of the
--     305 is one of those 85. Verified against the live table 2026-09-06 by
--     listing every row with brief_date in [2026-07-01, 2026-07-22]: 82 rows,
--     of which the only 3 ungradable sit at 2026-07-01, and all 79 later ones
--     are gradeable with resolve_on = brief_date and an outcome row, which is
--     1b's signature. This comment read 2026-07-22 before that check and was
--     wrong; the data was not.
--
--   SELECT count(*) AS n,
--          array_agg(DISTINCT ungradable_reason) AS reasons,
--          max(brief_date) AS newest,
--          count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.morning_brief_call_outcomes o
--                                          WHERE o.call_id = c.id)) AS with_outcome
--     FROM public.morning_brief_calls c
--    WHERE grading_status = 'ungradable';

-- 2c. Nothing became newly due. Expect 0.
--
--   SELECT count(*)
--     FROM public.morning_brief_calls c
--    WHERE c.grading_status = 'gradeable'
--      AND c.resolve_on <= current_date
--      AND c.brief_date < DATE '2026-07-25'
--      AND NOT EXISTS (SELECT 1 FROM public.morning_brief_call_outcomes o
--                       WHERE o.call_id = c.id);

-- 2d. The desk record did not move. Run before and after; the numbers are
--     the same, because no record surface reads grading_status.
--
--   SELECT count(*) AS outcomes FROM public.morning_brief_call_outcomes;

-- 2e. The grader's next run prints
--       [grade] skipped: 220 call(s) marked ungradable (horizon_never_captured: 220)
--     and no ::error line.
