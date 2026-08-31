-- ############################################################################
-- ##  UNAPPLIED. THIS MIGRATION HAS NOT BEEN RUN AGAINST ANY DATABASE.      ##
-- ##                                                                        ##
-- ##  Authored by an unattended agent run, which never applies migrations.  ##
-- ##  A human must review and run it. It lives in backend/migrations/ (the  ##
-- ##  hand-run directory) rather than supabase/migrations/ so no automated  ##
-- ##  runner picks it up, and the filename is prefixed UNAPPLIED for the    ##
-- ##  same reason. Rename it when you actually apply it.                    ##
-- ##                                                                        ##
-- ##  RUN scripts/invariants.mjs BEFORE AND AFTER. The before-and-after     ##
-- ##  numbers in FIXES.md were computed from raw data, not from this SQL    ##
-- ##  having been executed, so the first run of this file is also its first ##
-- ##  parse. Two constructs are worth watching: count(DISTINCT a || b) and  ##
-- ##  percentile_disc(...) WITHIN GROUP (...) FILTER (...).                 ##
-- ############################################################################
--
-- LOOP FIXES. Four items land here, all of them read-path.
--
--   POP     dim_users stops admitting plus-addressed test accounts.
--   ITEM 3  brief opens are deduped to one per reader per briefing per day,
--           and the opens-per-active card is replaced by a habit measure.
--   ITEM 4  companies researched reads the column that is actually populated.
--   ITEM 5  activation and retention defects recorded in DASH-AUDIT.md.
--   ITEM 7  denominators that drift downward forever are replaced, and every
--           card gains its window, its denominator and a refresh time.
--
-- BOTH SUMMARY VIEWS CHANGE TOGETHER. internal_kpi_summary and
-- internal_kpi_summary_by_cohort carry verbatim copies of the same metric
-- expressions and differ only in their grouping key. Diverging them is a
-- defect. Every expression below appears twice, identically, and the
-- accompanying invariant suite asserts they agree.
--
-- NO DATA IS WRITTEN. Views only. Nothing is backfilled, altered or deleted.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- dim_users. THE POPULATION ITSELF, and it was letting test accounts through.
--
-- WHAT WAS WRONG. The exclusion was already IN the view definition, which is
-- the right place, but it matched on the FULL address with NOT IN. Plus
-- addressing defeats that: a <primary>+tag form is not string-equal to the
-- <primary> literal below, so it passed the filter and joined the real-user
-- population. Five such accounts exist and ALL FIVE were inside dim_users:
--
--     +e2e        created 2026-08-25, still signing in on a schedule
--     +tmpl0721   created 2026-07-22
--     +fresh0721  created 2026-07-21
--     +wltest2    created 2026-07-20
--     +wltest1    created 2026-07-19
--
-- The +e2e one is the end-to-end test harness. It is on a schedule, so it keeps
-- generating events, and over the 7 day window it alone produced 195 of the 227
-- raw brief-open events. It is the account that made "brief opens per active"
-- read 15.36, and it survived the dedupe too, contributing 5 of the 21 deduped
-- opens.
--
-- THE FIX IS CANONICAL, NOT A LIST OF IDS. The local part is truncated at the
-- first '+' before comparing, so every current and FUTURE plus variant of every
-- excluded address is covered, including ones nobody has created yet, and
-- including Lucas's. No new address literal is added to this repository: the
-- three already here are reused, and the rule is derived from them.
--
-- CREATE OR REPLACE is safe and is the right verb. The column list is identical
-- to the current definition, so the dependent internal_kpi_* views are NOT
-- dropped and do not need rebuilding on account of this change. Only the WHERE
-- clause moves.
--
-- Effect on the population: 206 auth users, 7 excluded before, 12 excluded now,
-- so dim_users goes from 199 to 194. scripts/invariants.mjs NEW-a asserts that
-- reconciliation and has been updated to the canonical rule in the same commit.
CREATE OR REPLACE VIEW dim_users AS
SELECT
  u.id,
  u.created_at,
  u.last_sign_in_at,
  date_trunc('week', u.created_at)::date AS signup_week,
  CASE WHEN lower(split_part(u.email, '@', 2)) IN ('usc.edu', 'marshall.usc.edu')
       THEN 'USC' ELSE 'other' END AS segment_domain,
  a.cohort_source,
  a.cohort_institution,
  a.cohort_batch,
  CASE
    WHEN a.cohort_source IS NULL
     AND a.cohort_institution IS NULL
     AND a.cohort_batch IS NULL THEN 'unattributed'
    ELSE concat_ws(':',
           coalesce(a.cohort_source, 'unknown'),
           coalesce(a.cohort_institution, 'unknown'),
           coalesce(a.cohort_batch, 'unknown'))
  END AS cohort_key
FROM auth.users u
LEFT JOIN public.beta_allowlist a ON lower(a.email) = lower(u.email)
WHERE
  -- Canonical address: local part truncated at the first '+', then the domain.
  -- A <primary>+tag address canonicalizes to <primary> and is therefore matched
  -- by the SAME literal that already excluded the primary. This is why the list
  -- below is unchanged and does not need to grow when a new test address is
  -- minted. The tags themselves are recorded in FIXES.md, not the addresses.
  (split_part(split_part(lower(u.email), '@', 1), '+', 1)
     || '@' || split_part(lower(u.email), '@', 2))
  NOT IN (
        'noahhanning03@gmail.com',
        'lucasturcuato@gmail.com',
        'claude-agent@signalera.ai'
      )
  AND lower(split_part(u.email, '@', 2)) NOT IN (
        'signalera-internal.com',
        'anthropic-test.local'
      );
-- NULL-email hazard, unchanged from the previous definition and deliberately
-- not papered over: a NULL email makes NOT IN evaluate to NULL and the row is
-- dropped silently. There are zero such rows today, and invariants.mjs NEW-a
-- is the assertion that would catch one appearing.

-- ═══════════════════════════════════════════════════════════════════════════
-- internal_kpi_summary
--
-- DROP + CREATE rather than CREATE OR REPLACE, because the column shape
-- changes: brief_opens_per_active is REMOVED and six columns are added. A
-- view's columns cannot be removed or reordered in place.
-- ═══════════════════════════════════════════════════════════════════════════
DROP VIEW IF EXISTS internal_kpi_summary;
CREATE VIEW internal_kpi_summary AS
WITH ev AS (
  SELECT d.id,
    bool_or(e.created_at >= now() - interval '7 days')  AS active_7d,
    bool_or(e.created_at >= now() - interval '30 days') AS active_30d,
    bool_or(e.event_type IN ('morning_brief_opened','evening_wrap_opened')
            AND e.created_at >= now() - interval '7 days') AS brief_open_user_7d,

    -- ITEM 3, THE DEDUPE. Was a raw count(*), which counted page mounts rather
    -- than opens: one account produced 195 of 215 counted opens across 125
    -- sessions but only 5 distinct briefings, one of them 84 times in a day.
    -- Now one open per briefing per UTC day. The per-user dimension comes from
    -- this CTE's own GROUP BY d.id, so it is deliberately NOT in the key.
    --
    -- Written as a concatenated text key rather than count(DISTINCT (a, b)),
    -- which does not parse: Postgres reads the parenthesised list as two
    -- aggregate arguments. count(DISTINCT ROW(a, b)) would work but sorts
    -- records and has fiddlier NULL semantics.
    --
    -- The coalesce is load-bearing, not cosmetic. count(DISTINCT x) ignores
    -- NULLs and || propagates them, so a row with no briefing id would vanish
    -- from the numerator entirely rather than counting once. Legacy rows
    -- (April-era, payload = {}) are exactly that case; they fall back to one
    -- open per reader per day.
    --
    -- AT TIME ZONE 'UTC' pins the day boundary. A bare ::date follows the
    -- session TimeZone, so the same view would return different numbers to
    -- PostgREST and to psql. It also matches onceDayStamp() in
    -- src/lib/track-event.ts, which is the client half of this fix.
    count(DISTINCT
      coalesce(e.payload->>'briefing_id', e.entity_id, 'noid')
      || ':' || ((e.created_at AT TIME ZONE 'UTC')::date)::text
    ) FILTER (WHERE e.event_type IN ('morning_brief_opened','evening_wrap_opened')
            AND e.created_at >= now() - interval '7 days') AS brief_opens_7d,

    -- ITEM 3, THE HABIT MEASURE. Distinct days a reader opened at all, which is
    -- the input to the median that replaces opens-per-active.
    count(DISTINCT ((e.created_at AT TIME ZONE 'UTC')::date))
      FILTER (WHERE e.event_type IN ('morning_brief_opened','evening_wrap_opened')
              AND e.created_at >= now() - interval '7 days') AS brief_open_days_7d,

    count(*) FILTER (WHERE e.event_type = 'memo_generated') AS memos_all,
    count(*) FILTER (WHERE e.event_type = 'memo_generated' AND e.created_at >= now() - interval '7 days')  AS memos_7d,
    count(*) FILTER (WHERE e.event_type = 'memo_generated' AND e.created_at >= now() - interval '30 days') AS memos_30d
  FROM dim_users d LEFT JOIN public.user_events e ON e.user_id = d.id
  GROUP BY d.id
),
wl AS (SELECT DISTINCT user_id FROM public.watchlist),
peruser AS (
  SELECT d.id, d.segment_domain,
    (d.created_at >= now() - interval '7 days')  AS new_7d,
    (d.created_at >= now() - interval '30 days') AS new_30d,
    -- ITEM 7. Tenured means "has had a full window to form the habit". This is
    -- the denominator that does not drift downward forever.
    (d.created_at <= now() - interval '7 days')  AS tenured,
    (d.last_sign_in_at >= now() - interval '7 days')  AS logged_7d,
    (d.last_sign_in_at >= now() - interval '30 days') AS logged_30d,
    (d.created_at <= now() - interval '4 weeks') AS coh4w,
    COALESCE(ev.active_7d, false)  AS active_7d,
    COALESCE(ev.active_30d, false) AS active_30d,
    COALESCE(ev.brief_open_user_7d, false) AS brief_open_user_7d,
    COALESCE(ev.brief_opens_7d, 0) AS brief_opens_7d,
    COALESCE(ev.brief_open_days_7d, 0) AS brief_open_days_7d,
    COALESCE(ev.memos_all, 0) AS memos_all,
    COALESCE(ev.memos_7d, 0)  AS memos_7d,
    COALESCE(ev.memos_30d, 0) AS memos_30d,
    (wl.user_id IS NOT NULL) AS has_watchlist
  FROM dim_users d
  LEFT JOIN ev ON ev.id = d.id
  LEFT JOIN wl ON wl.user_id = d.id
)
SELECT
  CASE WHEN GROUPING(segment_domain) = 1 THEN 'All' ELSE segment_domain END AS segment_domain,
  count(*) AS total_users,
  count(*) FILTER (WHERE tenured) AS tenured_users,
  count(*) FILTER (WHERE active_7d)  AS weekly_actives,
  count(*) FILTER (WHERE active_30d) AS active_30d,
  count(*) FILTER (WHERE logged_7d)  AS logged_in_7d,
  count(*) FILTER (WHERE logged_30d) AS logged_in_30d,
  count(*) FILTER (WHERE new_7d)  AS new_users_7d,
  count(*) FILTER (WHERE new_30d) AS new_users_30d,
  count(*) FILTER (WHERE brief_open_user_7d) AS brief_open_users_7d,
  sum(brief_opens_7d) AS brief_opens_7d,
  sum(memos_all) AS memos_all_time,
  sum(memos_7d)  AS memos_7d,
  sum(memos_30d) AS memos_30d,
  count(*) FILTER (WHERE has_watchlist) AS users_with_watchlist,

  -- ITEM 7, WAPS. The old waps_pct divided by ALL signups, so it fell as the
  -- product grew regardless of behavior: 98 of 199 users signed up inside the
  -- same window and exactly one of them opened a brief, which alone dragged
  -- the printed number from 10.9 to 6.0. The name is CHANGED rather than
  -- redefined in place, so a reader cannot mistake the new number for the old
  -- one and the page is forced to acknowledge the swap.
  --
  -- Both denominators ship, labeled. They answer different questions and the
  -- gap between them is itself the finding.
  round(100.0 * count(*) FILTER (WHERE brief_open_user_7d AND tenured)
        / nullif(count(*) FILTER (WHERE tenured), 0), 1) AS waps_tenured_pct,
  round(100.0 * count(*) FILTER (WHERE brief_open_user_7d)
        / nullif(count(*) FILTER (WHERE active_7d), 0), 1) AS waps_active_pct,

  -- ITEM 7, same defect on the watchlist card.
  round(100.0 * count(*) FILTER (WHERE has_watchlist AND tenured)
        / nullif(count(*) FILTER (WHERE tenured), 0), 1) AS watchlist_tenured_pct,

  -- ITEM 3, THE REPLACEMENT CARD. brief_opens_per_active is GONE. It divided an
  -- inflated event count by active readers and printed 15.36; the deduped
  -- truth is 1.57, and the honest measure of a habit is how many DAYS a reader
  -- showed up, not how many times a component mounted.
  --
  -- percentile_disc, not percentile_cont: cont interpolates and yields double
  -- precision, which emits 1.5 on an even population and breaks the promised
  -- 1 to 7 integer scale. disc yields an actually observed value.
  --
  -- Ordered-set aggregates take WITHIN GROUP rather than a plain argument list,
  -- and they compose with GROUPING SETS exactly like count(*) does, one value
  -- per group. FILTER is permitted on them; DISTINCT is not, which is fine
  -- because the ev CTE already pre-aggregated per user.
  --
  -- A rolling 7 day window can straddle 8 calendar dates, so this is clamped
  -- to keep the promised scale rather than occasionally printing 8.
  least(
    percentile_disc(0.5) WITHIN GROUP (ORDER BY brief_open_days_7d)
      FILTER (WHERE brief_open_user_7d),
    7
  ) AS brief_open_days_median_7d,

  round(100.0 * count(*) FILTER (WHERE coh4w AND active_7d) / nullif(count(*) FILTER (WHERE coh4w), 0), 1) AS retention_4w_pct,
  count(*) FILTER (WHERE coh4w) AS retention_4w_cohort,

  -- ITEM 7. The window and the refresh time come out of the SAME transaction as
  -- every number above, because now() is transaction start time and is constant
  -- within a statement. A timestamp taken in the page would be a different
  -- clock at a different moment, and the page makes six separate view reads.
  (now() - interval '7 days') AS window_start_utc,
  now() AS window_end_utc,
  now() AS computed_at,

  -- Global metrics, not user-segmentable: emitted on the 'All' row only.
  CASE WHEN GROUPING(segment_domain) = 1 THEN (SELECT count(*) FROM public.waitlist) END AS waitlist_count,

  -- ITEM 4. Was source_id, a uuid polymorphic pointer to the ORIGIN record of
  -- an artifact, qualified by source_table. It is not a company reference, it
  -- is NULL on all 143 memo rows, and it never could carry a company name: a
  -- filter comparing it to one raises 22P02 invalid input syntax for uuid.
  -- So that leg contributed zero and the card's 5 came entirely from the
  -- regeneration-quota table.
  --
  -- The company was being persisted the whole time, one key over.
  -- content->>'target_company' is populated on 89 of 143 memo rows and carries
  -- 58 distinct names, a strict superset of all 5 quota names. Reading it takes
  -- the card from 5 to 57 with no new capture code anywhere.
  --
  -- lower(trim(...)) merges casing and whitespace variants. It cannot merge
  -- suffix variants ("Visa" against "Visa Inc."), which is a known residual and
  -- is why 58 raw becomes 57 normalized. Names are stored verbatim on purpose:
  -- /api/memo-cache matches them exactly, so normalizing at WRITE time would
  -- break the cache.
  CASE WHEN GROUPING(segment_domain) = 1 THEN (
    SELECT count(*) FROM (
      SELECT lower(btrim(o.content->>'target_company')) AS company
        FROM public.outputs o
        WHERE o.output_type = 'memo'
          AND nullif(btrim(o.content->>'target_company'), '') IS NOT NULL
      UNION
      SELECT lower(btrim(q.company_id))
        FROM public.user_memo_regeneration_quota q
        WHERE nullif(btrim(q.company_id), '') IS NOT NULL
    ) z
  ) END AS distinct_companies_researched
FROM peruser
GROUP BY GROUPING SETS ((segment_domain), ());

-- ═══════════════════════════════════════════════════════════════════════════
-- internal_kpi_summary_by_cohort
--
-- VERBATIM COPY of everything above. The ONLY difference is the grouping key:
-- cohort_key instead of segment_domain. If you change one, change the other in
-- the same commit, and re-run scripts/invariants.mjs, which asserts they agree.
-- ═══════════════════════════════════════════════════════════════════════════
DROP VIEW IF EXISTS internal_kpi_summary_by_cohort;
CREATE VIEW internal_kpi_summary_by_cohort AS
WITH ev AS (
  SELECT d.id,
    bool_or(e.created_at >= now() - interval '7 days')  AS active_7d,
    bool_or(e.created_at >= now() - interval '30 days') AS active_30d,
    bool_or(e.event_type IN ('morning_brief_opened','evening_wrap_opened')
            AND e.created_at >= now() - interval '7 days') AS brief_open_user_7d,
    count(DISTINCT
      coalesce(e.payload->>'briefing_id', e.entity_id, 'noid')
      || ':' || ((e.created_at AT TIME ZONE 'UTC')::date)::text
    ) FILTER (WHERE e.event_type IN ('morning_brief_opened','evening_wrap_opened')
            AND e.created_at >= now() - interval '7 days') AS brief_opens_7d,
    count(DISTINCT ((e.created_at AT TIME ZONE 'UTC')::date))
      FILTER (WHERE e.event_type IN ('morning_brief_opened','evening_wrap_opened')
              AND e.created_at >= now() - interval '7 days') AS brief_open_days_7d,
    count(*) FILTER (WHERE e.event_type = 'memo_generated') AS memos_all,
    count(*) FILTER (WHERE e.event_type = 'memo_generated' AND e.created_at >= now() - interval '7 days')  AS memos_7d,
    count(*) FILTER (WHERE e.event_type = 'memo_generated' AND e.created_at >= now() - interval '30 days') AS memos_30d
  FROM dim_users d LEFT JOIN public.user_events e ON e.user_id = d.id
  GROUP BY d.id
),
wl AS (SELECT DISTINCT user_id FROM public.watchlist),
peruser AS (
  SELECT d.id, d.cohort_key,
    (d.created_at >= now() - interval '7 days')  AS new_7d,
    (d.created_at >= now() - interval '30 days') AS new_30d,
    (d.created_at <= now() - interval '7 days')  AS tenured,
    (d.last_sign_in_at >= now() - interval '7 days')  AS logged_7d,
    (d.last_sign_in_at >= now() - interval '30 days') AS logged_30d,
    (d.created_at <= now() - interval '4 weeks') AS coh4w,
    COALESCE(ev.active_7d, false)  AS active_7d,
    COALESCE(ev.active_30d, false) AS active_30d,
    COALESCE(ev.brief_open_user_7d, false) AS brief_open_user_7d,
    COALESCE(ev.brief_opens_7d, 0) AS brief_opens_7d,
    COALESCE(ev.brief_open_days_7d, 0) AS brief_open_days_7d,
    COALESCE(ev.memos_all, 0) AS memos_all,
    COALESCE(ev.memos_7d, 0)  AS memos_7d,
    COALESCE(ev.memos_30d, 0) AS memos_30d,
    (wl.user_id IS NOT NULL) AS has_watchlist
  FROM dim_users d
  LEFT JOIN ev ON ev.id = d.id
  LEFT JOIN wl ON wl.user_id = d.id
)
SELECT
  CASE WHEN GROUPING(cohort_key) = 1 THEN 'All' ELSE cohort_key END AS cohort_key,
  count(*) AS total_users,
  count(*) FILTER (WHERE tenured) AS tenured_users,
  count(*) FILTER (WHERE active_7d)  AS weekly_actives,
  count(*) FILTER (WHERE active_30d) AS active_30d,
  count(*) FILTER (WHERE logged_7d)  AS logged_in_7d,
  count(*) FILTER (WHERE logged_30d) AS logged_in_30d,
  count(*) FILTER (WHERE new_7d)  AS new_users_7d,
  count(*) FILTER (WHERE new_30d) AS new_users_30d,
  count(*) FILTER (WHERE brief_open_user_7d) AS brief_open_users_7d,
  sum(brief_opens_7d) AS brief_opens_7d,
  sum(memos_all) AS memos_all_time,
  sum(memos_7d)  AS memos_7d,
  sum(memos_30d) AS memos_30d,
  count(*) FILTER (WHERE has_watchlist) AS users_with_watchlist,
  round(100.0 * count(*) FILTER (WHERE brief_open_user_7d AND tenured)
        / nullif(count(*) FILTER (WHERE tenured), 0), 1) AS waps_tenured_pct,
  round(100.0 * count(*) FILTER (WHERE brief_open_user_7d)
        / nullif(count(*) FILTER (WHERE active_7d), 0), 1) AS waps_active_pct,
  round(100.0 * count(*) FILTER (WHERE has_watchlist AND tenured)
        / nullif(count(*) FILTER (WHERE tenured), 0), 1) AS watchlist_tenured_pct,
  least(
    percentile_disc(0.5) WITHIN GROUP (ORDER BY brief_open_days_7d)
      FILTER (WHERE brief_open_user_7d),
    7
  ) AS brief_open_days_median_7d,
  round(100.0 * count(*) FILTER (WHERE coh4w AND active_7d) / nullif(count(*) FILTER (WHERE coh4w), 0), 1) AS retention_4w_pct,
  count(*) FILTER (WHERE coh4w) AS retention_4w_cohort,
  (now() - interval '7 days') AS window_start_utc,
  now() AS window_end_utc,
  now() AS computed_at
FROM peruser
GROUP BY GROUPING SETS ((cohort_key), ());

-- ═══════════════════════════════════════════════════════════════════════════
-- ITEM 5. Activation funnel.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE VIEW internal_kpi_activation AS
WITH firsts AS (
  SELECT d.id, d.segment_domain, d.created_at, d.signup_week,
    min(e.created_at) FILTER (WHERE e.event_type IN ('morning_brief_opened','evening_wrap_opened')) AS first_brief,
    min(e.created_at) FILTER (WHERE e.event_type = 'memo_generated') AS first_memo,
    min(e.created_at) FILTER (WHERE e.event_type = 'onboarding_completed') AS first_onb
  FROM dim_users d LEFT JOIN public.user_events e ON e.user_id = d.id
  GROUP BY d.id, d.segment_domain, d.created_at, d.signup_week
)
SELECT
  signup_week AS cohort_week,
  CASE WHEN GROUPING(segment_domain) = 1 THEN 'All' ELSE segment_domain END AS segment_domain,
  count(*) AS cohort_size,

  -- ITEM 5. The lower bound is NEW. The filter was `first_onb <= created_at +
  -- 7 days` with no floor, so an event that fired BEFORE its own user existed
  -- would have counted them as onboarded. Latent rather than live today: the
  -- smallest observed gap between an event and its user's signup is +31.9
  -- seconds, so nothing currently triggers it. Nothing in the schema forbids
  -- it either, which is the point of a bound.
  count(*) FILTER (WHERE first_onb >= created_at
                     AND first_onb <= created_at + interval '7 days') AS onboarded_7d,
  round(100.0 * count(*) FILTER (WHERE first_onb >= created_at
                     AND first_onb <= created_at + interval '7 days')
        / nullif(count(*), 0), 1) AS onboarded_7d_pct,

  -- least() ignores NULLs in Postgres, so least(NULL, x) = x. That is
  -- load-bearing and CORRECT here: it makes the filter behave as the OR the UI
  -- copy describes. 16 of 41 activated users have only one of the two events
  -- and are counted solely because of it. Verified rather than assumed: an
  -- explicit OR gives the same 41, a NULL-propagating reading gives 25.
  -- Documented because it is not obvious and a future editor could "simplify"
  -- it into a different metric.
  count(*) FILTER (WHERE least(first_brief, first_memo) >= created_at
                     AND least(first_brief, first_memo) <= created_at + interval '7 days') AS activated_7d,

  -- ITEM 5. round() gains its scale argument. These two were the only
  -- percentages in the whole view set with no scale, so 67.2 printed as 67
  -- while every other percentage on the page carried one decimal.
  round(100.0 * count(*) FILTER (WHERE least(first_brief, first_memo) >= created_at
                     AND least(first_brief, first_memo) <= created_at + interval '7 days')
        / nullif(count(*), 0), 1) AS activated_7d_pct,

  -- ITEM 5, THE CENSORING MARKER. The most recent cohort had 98 members of
  -- whom 96 were created that same day with zero events ever, and it rendered
  -- "1 percent activated" with nothing to say its 7 day window had not closed.
  -- A right-censored cohort is not a low number, it is not a number yet.
  -- Censored while ANY member's own window is still open, which is max(), not
  -- min(). Using the earliest member would call a cohort complete while its
  -- newest members still had days to act.
  (max(created_at) + interval '7 days' <= now()) AS window_closed,
  (max(created_at) + interval '7 days') AS window_closes_at,
  count(*) FILTER (WHERE created_at + interval '7 days' <= now()) AS cohort_size_observed,
  now() AS computed_at
FROM firsts
GROUP BY GROUPING SETS ((signup_week, segment_domain), (signup_week))
ORDER BY cohort_week, segment_domain;

-- ═══════════════════════════════════════════════════════════════════════════
-- ITEM 5. Retention cohorts.
-- ═══════════════════════════════════════════════════════════════════════════
DROP VIEW IF EXISTS internal_kpi_retention_cohorts;
CREATE VIEW internal_kpi_retention_cohorts AS
WITH recent_active AS (
  SELECT DISTINCT user_id FROM public.user_events WHERE created_at >= now() - interval '7 days'
)
SELECT
  d.signup_week AS cohort_week,
  CASE WHEN GROUPING(d.segment_domain) = 1 THEN 'All' ELSE d.segment_domain END AS segment_domain,
  count(*) AS cohort_size,
  count(a.user_id) AS active_last_7d,
  round(100.0 * count(a.user_id) / nullif(count(*), 0), 1) AS retention_pct,

  -- ITEM 5. Was floor(epoch(now() - signup_week) / 604800), measured from the
  -- MONDAY that starts the signup week rather than from each user's own
  -- signup. That credited a reader who joined on Sunday at 23:59 with the same
  -- tenure as one who joined Monday at 00:01 of the same week, and it
  -- overstated 29 of 199 users by a full week. Now measured from the median
  -- actual signup in the cohort, which cannot overstate.
  -- max(created_at) is the NEWEST member, so this is the floor of the cohort's
  -- tenure and can never overstate. A median would still overstate for half the
  -- cohort, and the shipped version overstated up to 199 of 199 depending on
  -- which day of the week the page was loaded.
  floor(extract(epoch FROM (now() - max(d.created_at))) / 604800)::int AS weeks_since_signup,

  -- Same censoring problem as the activation table: the newest cohort is hours
  -- old and its retention reads as a measurement.
  (max(d.created_at) <= now() - interval '7 days') AS window_closed,
  count(*) FILTER (WHERE d.created_at <= now() - interval '7 days') AS cohort_size_observed,
  now() AS computed_at
FROM dim_users d
LEFT JOIN recent_active a ON a.user_id = d.id
GROUP BY GROUPING SETS ((d.signup_week, d.segment_domain), (d.signup_week))
ORDER BY cohort_week, segment_domain;

-- ═══════════════════════════════════════════════════════════════════════════
-- ITEM 5. Instrumentation health. Carries D4, D6, D7 and the clock defect.
--
-- The GLOBAL scope stays. The view's job, stated in its own header, is whether
-- an event fires AT ALL, and joining it to dim_users would break that. What is
-- added is the scoped counter beside the global one, so the page can stop
-- contradicting itself: Depth prints "Memos generated 160" while this table
-- prints 264 for the same event, in identical styling, and the 104 gap is
-- exactly the excluded-account events.
-- ═══════════════════════════════════════════════════════════════════════════
DROP VIEW IF EXISTS internal_kpi_instrumentation_health;
CREATE VIEW internal_kpi_instrumentation_health AS
WITH expected(event_type) AS (
  -- D6. GROUP BY over stored rows can only produce a row for an event that has
  -- fired at least once, so an event that has NEVER fired is invisible in the
  -- very table whose job is to surface silent events. thesis_approved is read
  -- in seven places, including a user-visible label and the strongest positive
  -- weight in the backend aggregator, and has zero rows. A FULL OUTER JOIN
  -- against the declared roster makes that visible.
  --
  -- The roster is the legacy union declared in src/lib/track-event.ts, so the
  -- SQL and the TypeScript stay checkable against each other.
  VALUES ('thesis_viewed'),('thesis_dismissed'),('thesis_approved'),('memo_generated'),
         ('morning_brief_opened'),('evening_wrap_opened'),('pattern_clicked'),
         ('watchlist_added'),('watchlist_removed'),('sector_filter_applied'),
         ('onboarding_completed'),('brief_section_rated')
),
read_by_a_metric(event_type) AS (
  -- D7. Exactly the names an internal_kpi_* view filters on. Everything else in
  -- user_events is stored and read by nothing: 1109 of 3082 rows, 36 percent,
  -- rendered indistinguishably from the rows that feed a card.
  --
  -- Keep in sync with the FILTER clauses in internal_kpi_summary,
  -- internal_kpi_summary_by_cohort and internal_kpi_activation.
  VALUES ('morning_brief_opened'),('evening_wrap_opened'),('memo_generated'),('onboarding_completed')
)
SELECT
  COALESCE(e.event_type, x.event_type) AS event_type,
  max(e.created_at)::date AS last_seen,

  -- The clock defect. Was now()::date - max(created_at)::date, which counts
  -- calendar boundaries crossed while events_7d counts against a rolling 168
  -- hours. Two clocks in adjacent columns: an event 0.9 hours old could print
  -- "1 day ago", and a 5.8-hour and a 24.0-hour event could print the same
  -- number. Now both columns are on elapsed time.
  floor(extract(epoch FROM (now() - max(e.created_at))) / 86400)::int AS days_since_last,

  count(e.id) FILTER (WHERE e.created_at >= now() - interval '7 days')  AS events_7d,
  count(e.id) FILTER (WHERE e.created_at >= now() - interval '30 days') AS events_30d,
  count(e.id) AS events_all,
  -- D4. The same total restricted to the population the page header claims.
  count(e.id) FILTER (WHERE d.id IS NOT NULL) AS events_all_real_users,
  round(100.0 * count(e.id) FILTER (WHERE d.id IS NULL) / nullif(count(e.id), 0), 1)
    AS pct_outside_dim_users,
  -- D6 and D7 flags.
  (x.event_type IS NOT NULL AND count(e.id) = 0) AS never_fired,
  (r.event_type IS NULL) AS feeds_no_metric,
  now() AS computed_at
FROM expected x
FULL OUTER JOIN public.user_events e ON e.event_type = x.event_type
LEFT JOIN dim_users d ON d.id = e.user_id
LEFT JOIN read_by_a_metric r ON r.event_type = COALESCE(e.event_type, x.event_type)
GROUP BY COALESCE(e.event_type, x.event_type), x.event_type, r.event_type
ORDER BY never_fired DESC, days_since_last DESC NULLS FIRST;

-- ═══════════════════════════════════════════════════════════════════════════
-- ITEM 7. Loop cards.
--
-- Every one carries its denominator label, its window as literal UTC instants,
-- its population filter, a refresh time, and its n. Several read n=1 today,
-- which is stated on the row rather than hidden: a rate over a denominator of
-- one is a sentence about one person, and it WILL be quoted as if it were a
-- rate unless the card says otherwise.
-- ═══════════════════════════════════════════════════════════════════════════

-- (a) ADOPTION RATE OVER BRIEF OPENERS, not over all-time signups.
CREATE OR REPLACE VIEW internal_kpi_loop_adoption AS
WITH win AS (
  SELECT (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') - interval '7 days' AS w_start,
         (date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')                     AS w_end
),
openers AS (
  SELECT DISTINCT e.user_id
  FROM public.user_events e
  JOIN dim_users d ON d.id = e.user_id
  CROSS JOIN win w
  WHERE e.event_type IN ('brief.page.opened','morning_brief_opened',
                         'wrap.page.opened','evening_wrap_opened')
    AND e.created_at >= w.w_start AND e.created_at < w.w_end
),
adopters AS (
  SELECT DISTINCT c.user_id
  FROM public.user_claims c
  JOIN dim_users d ON d.id = c.user_id
  CROSS JOIN win w
  WHERE c.source = 'adopted'
    AND c.created_at >= w.w_start AND c.created_at < w.w_end
)
SELECT
  (SELECT count(*) FROM openers) AS brief_openers_7d,
  -- The EXISTS is not decorative. An adopter who did not open a brief in the
  -- window would otherwise sit in a numerator that is not a subset of its
  -- denominator, and the card could print above 100 percent.
  (SELECT count(*) FROM adopters a
     WHERE EXISTS (SELECT 1 FROM openers o WHERE o.user_id = a.user_id)) AS adopting_openers_7d,
  round(100.0 * (SELECT count(*) FROM adopters a
                   WHERE EXISTS (SELECT 1 FROM openers o WHERE o.user_id = a.user_id))
        / nullif((SELECT count(*) FROM openers), 0), 1) AS adoption_over_openers_pct,
  (SELECT w_start FROM win) AS window_start_utc,
  (SELECT w_end FROM win) AS window_end_utc,
  'distinct brief openers in window, dim_users only' AS denominator_label,
  now() AS computed_at
FROM win;

-- (c) RETURN AFTER AN ADOPTED CALL MOVES TO CHALLENGED.
--
-- CHALLENGED is verdict 'wrong' plus attribution 'clean'. Verified against
-- src/lib/scored-object-map.ts (wrong + clean maps to state "wrong") and
-- src/lib/verdict-vocabulary.ts (RESOLUTION_BY_STATE maps "wrong" to
-- "challenged"). No other verdict and attribution pair reaches it.
CREATE OR REPLACE VIEW internal_kpi_loop_post_challenge AS
WITH challenged AS (
  SELECT o.claim_id, c.user_id, o.graded_at
  FROM public.user_claim_outcomes o
  JOIN public.user_claims c ON c.id = o.claim_id AND c.source = 'adopted'
  JOIN dim_users d ON d.id = c.user_id
  WHERE o.verdict = 'wrong' AND o.attribution = 'clean'
),
later AS (
  SELECT ch.claim_id,
         count(DISTINCT e.session_id) AS later_sessions,
         count(DISTINCT ((e.created_at AT TIME ZONE 'UTC')::date)) AS later_days
  FROM challenged ch
  JOIN public.user_events e
    ON e.user_id = ch.user_id
   AND e.created_at > ch.graded_at
   AND e.session_id IS NOT NULL
  GROUP BY ch.claim_id
)
SELECT
  (SELECT count(*) FROM challenged) AS challenged_adopted_claims,
  (SELECT count(*) FROM later WHERE later_sessions > 0) AS claims_with_a_later_session,
  -- The DAY figure is the honest one and is why both ship. session_id is per
  -- tab, from sessionStorage, so nine sessions on one afternoon is nine tab
  -- opens rather than nine visits back. Today every later session for the single
  -- challenged claim falls on the same UTC day as its grading.
  (SELECT count(*) FROM later WHERE later_days > 1) AS claims_with_a_later_day,
  round(100.0 * (SELECT count(*) FROM later WHERE later_sessions > 0)
        / nullif((SELECT count(*) FROM challenged), 0), 1) AS return_rate_pct,
  'adopted claims of dim_users members whose outcome is wrong plus clean' AS denominator_label,
  'all time, no window: n is too small to window' AS window_label,
  now() AS computed_at;

-- (b) RESOLUTION VIEW RATE is deliberately NOT created.
--
-- No event that has ever fired is a view of a graded record. All six surfaces
-- that render one (/review, /ledger, /radar/calls, /record, /desk-record,
-- /radar/track-record) contain no tracking import at all, so the denominator
-- exists and the numerator cannot. A view created now would return a NULL rate
-- forever, and a card rendering 0 percent would be a false statement about
-- reader behavior rather than a true one about instrumentation.
--
-- The emit ships in this branch (record.claim.exposed). The VIEW should be
-- created in the follow-up that lands after the first rows arrive, so nobody
-- reads a null as a measurement in between. The SQL is written out in FIXES.md
-- ready to paste.

-- ═══════════════════════════════════════════════════════════════════════════
-- Grants: service_role only, matching every other internal view.
-- ═══════════════════════════════════════════════════════════════════════════
REVOKE ALL ON internal_kpi_summary               FROM anon, authenticated;
REVOKE ALL ON internal_kpi_summary_by_cohort     FROM anon, authenticated;
REVOKE ALL ON internal_kpi_activation            FROM anon, authenticated;
REVOKE ALL ON internal_kpi_retention_cohorts     FROM anon, authenticated;
REVOKE ALL ON internal_kpi_instrumentation_health FROM anon, authenticated;
REVOKE ALL ON internal_kpi_loop_adoption         FROM anon, authenticated;
REVOKE ALL ON internal_kpi_loop_post_challenge   FROM anon, authenticated;
GRANT SELECT ON internal_kpi_summary               TO service_role;
GRANT SELECT ON internal_kpi_summary_by_cohort     TO service_role;
GRANT SELECT ON internal_kpi_activation            TO service_role;
GRANT SELECT ON internal_kpi_retention_cohorts     TO service_role;
GRANT SELECT ON internal_kpi_instrumentation_health TO service_role;
GRANT SELECT ON internal_kpi_loop_adoption         TO service_role;
GRANT SELECT ON internal_kpi_loop_post_challenge   TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- DOWN (manual rollback). Views only, no data touched.
--
--   -- dim_users reverts by re-running the cohort migration's CREATE OR REPLACE.
--   DROP VIEW IF EXISTS internal_kpi_loop_post_challenge;
--   DROP VIEW IF EXISTS internal_kpi_loop_adoption;
--   DROP VIEW IF EXISTS internal_kpi_summary;
--   DROP VIEW IF EXISTS internal_kpi_summary_by_cohort;
--   DROP VIEW IF EXISTS internal_kpi_retention_cohorts;
--   -- then re-run, in order:
--   --   supabase/migrations/20260602160000_internal_dashboard_phase_b_views.sql
--   --   backend/migrations/UNAPPLIED-2026-08-28-signup-cohort-capture.sql
--   -- which together restore internal_kpi_summary, the cohort views, the
--   -- retention cohorts view and internal_kpi_activation to their prior bodies.
--   NOTIFY pgrst, 'reload schema';
-- ─────────────────────────────────────────────────────────────────────────────
