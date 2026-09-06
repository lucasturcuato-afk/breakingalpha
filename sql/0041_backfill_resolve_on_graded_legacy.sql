-- 0041_backfill_resolve_on_graded_legacy.sql
--
-- HAND-APPLY. Noah/Lucas apply this; agents do not apply migrations.
--
-- WHAT THIS DOES. Sets resolve_on = brief_date on the legacy calls that WERE
-- graded, and only those. It does not invent a horizon for any call that
-- was never graded. Measured over the full morning_brief_calls table on
-- 2026-09-06:
--
--   rows                         446
--   resolve_on NULL              305   (brief_date 2026-04-24 .. 2026-07-22)
--   resolve_on set               141   (brief_date 2026-07-27 onward, none NULL)
--   NULL rows WITH an outcome     85   (all graded on brief_date itself)
--   NULL rows WITHOUT an outcome 220   (the "invisible half")
--
-- WHY THE 85 ARE BACKFILLABLE AND THE 220 ARE NOT.
--
-- resolve_on is not a function of claim_type: the stored horizons since
-- 0014 range from 0 to 45 days inside every type, because the model states a
-- day count per claim (backend/call_horizons.py) and the code adds it to
-- brief_date. Before PR #507 (2026-07-25) no horizon field existed in the
-- extractor, the briefings body stores none, and 300 of the 305 NULL rows'
-- claim_text names no horizon at all. For the 220 the horizon was never
-- captured anywhere. A backfilled date for them would be a number the text
-- did not state: exactly the class of fabrication the grader's argument
-- guard (grade_brief_calls.py refuses --backfill) and sql/0014's header
-- ("Do not backfill") exist to prevent. They stay NULL, on purpose, and
-- grade_brief_calls now prints their count every run instead of skipping
-- them silently.
--
-- The 85 are different: each has a row in morning_brief_call_outcomes with
-- graded_at on brief_date, because the pre-horizon grader ran in "off" mode
-- (brief_date == today). Their window WAS the session. Writing
-- resolve_on = brief_date records how they were actually graded; it invents
-- nothing and makes nothing newly due, because their outcome row already
-- exists and the due-scan filters graded calls out.
--
-- Sections:
--   0. VERIFY FIRST (read-only)
--   1. the update
--   2. MEASURE AFTER (read-only)


-- ===========================================================================
-- 0. VERIFY FIRST. Read-only. The numbers above must still hold.
-- ===========================================================================

-- 0a. Expect: total 446, null_all 305, null_graded 85, null_ungraded 220,
--     newest_null 2026-07-22. If null_all has grown or newest_null is later
--     than 2026-07-22, the write path has regressed: STOP and read the
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
--     n 85, min_lag 0, max_lag 0. Any other lag means a window this file
--     would misstate; STOP.
--
--   SELECT count(*) AS n,
--          min(o.graded_at::date - c.brief_date) AS min_lag,
--          max(o.graded_at::date - c.brief_date) AS max_lag
--     FROM public.morning_brief_calls c
--     JOIN public.morning_brief_call_outcomes o ON o.call_id = c.id
--    WHERE c.resolve_on IS NULL;


-- ===========================================================================
-- 1. THE UPDATE. One statement, inside a transaction. Touches exactly the
--    rows 0b counted; the WHERE is the same predicate. Re-running matches
--    zero rows.
-- ===========================================================================

UPDATE public.morning_brief_calls c
   SET resolve_on = c.brief_date
 WHERE c.resolve_on IS NULL
   AND EXISTS (SELECT 1 FROM public.morning_brief_call_outcomes o
                WHERE o.call_id = c.id
                  AND o.graded_at::date = c.brief_date);
-- Expect: UPDATE 85


-- ===========================================================================
-- 2. MEASURE AFTER. Read-only.
-- ===========================================================================

-- 2a. Expect: null_all 220, null_graded 0, null_ungraded 220,
--     newest_null 2026-07-22, and set_before_cutover 85.
--
--   SELECT count(*) FILTER (WHERE resolve_on IS NULL)              AS null_all,
--          count(*) FILTER (WHERE resolve_on IS NULL
--                             AND EXISTS (SELECT 1 FROM public.morning_brief_call_outcomes o
--                                          WHERE o.call_id = c.id))   AS null_graded,
--          count(*) FILTER (WHERE resolve_on IS NULL
--                             AND NOT EXISTS (SELECT 1 FROM public.morning_brief_call_outcomes o
--                                              WHERE o.call_id = c.id)) AS null_ungraded,
--          max(brief_date) FILTER (WHERE resolve_on IS NULL)      AS newest_null,
--          count(*) FILTER (WHERE resolve_on IS NOT NULL
--                             AND brief_date < DATE '2026-07-25')  AS set_before_cutover
--     FROM public.morning_brief_calls c;

-- 2b. Nothing became newly due. Expect 0: every backfilled row is already
--     graded, so the due-scan's "not yet graded" filter excludes it.
--
--   SELECT count(*)
--     FROM public.morning_brief_calls c
--    WHERE c.resolve_on IS NOT NULL
--      AND c.resolve_on <= current_date
--      AND c.brief_date < DATE '2026-07-25'
--      AND NOT EXISTS (SELECT 1 FROM public.morning_brief_call_outcomes o
--                       WHERE o.call_id = c.id);

-- 2c. The grader's next run prints:
--       [grade] excluded: 220 call(s) with resolve_on NULL from before 2026-07-25
--     and no ::error line. The 220 are the legacy calls whose horizon was
--     never captured; they are counted, not graded.
