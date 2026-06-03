-- Phase B internal analytics dashboard: durable, segmentable KPI views.
--
-- Additive and non-destructive. Builds a real-users base (dim_users), rebuilds
-- internal_kpi_summary and internal_kpi_retention_cohorts on top of it, and adds
-- two new views (activation funnel, instrumentation health). No table is created,
-- altered, or mutated. No row is written. All metric views key off dim_users so
-- founders/test accounts are excluded everywhere, every metric is computed
-- per-user-then-rolled-up, and every metric works BOTH blended (segment_domain
-- = 'All') AND segmented (GROUP BY segment_domain via GROUPING SETS).
--
-- DEFERRED, intentionally NOT in this migration: D5a memo target-company capture
-- (outputs.source_id / event payload) and club-level signup_source capture. The
-- distinct_companies_researched metric therefore keeps its Phase A definition.
--
-- internal_kpi_summary and internal_kpi_retention_cohorts change their column
-- shape, so they are DROP + CREATE (a view's columns cannot be removed/renamed
-- by CREATE OR REPLACE). This is still views-only and fully reversible; see the
-- DOWN block at the bottom.

-- ── Base: real users only, with per-user dimensions ──
-- Exclusion: explicit founder/agent emails + internal/test domains. We do NOT
-- blanket @signalera.ai (only the explicit claude-agent@signalera.ai is cut).
CREATE OR REPLACE VIEW dim_users AS
SELECT
  u.id,
  u.created_at,
  u.last_sign_in_at,
  date_trunc('week', u.created_at)::date AS signup_week,
  CASE WHEN lower(split_part(u.email, '@', 2)) IN ('usc.edu', 'marshall.usc.edu')
       THEN 'USC' ELSE 'other' END AS segment_domain
FROM auth.users u
WHERE lower(u.email) NOT IN (
        'noahhanning03@gmail.com',
        'lucasturcuato@gmail.com',
        'claude-agent@signalera.ai'
      )
  AND lower(split_part(u.email, '@', 2)) NOT IN (
        'signalera-internal.com',
        'anthropic-test.local'
      );

-- ── Summary: one row per segment_domain ('USC', 'other') plus an 'All' rollup ──
-- active_* are event-based (a user_events row in the window), NOT last_sign_in_at.
-- logged_in_* are last_sign_in_at, kept only as a secondary reachability signal.
-- WAPS, % watchlist, brief-opens-per-active, and 4-week retention are computed
-- HERE in SQL (single source of truth); the app only renders them.
DROP VIEW IF EXISTS internal_kpi_summary;
CREATE VIEW internal_kpi_summary AS
WITH ev AS (
  SELECT d.id,
    bool_or(e.created_at >= now() - interval '7 days')  AS active_7d,
    bool_or(e.created_at >= now() - interval '30 days') AS active_30d,
    bool_or(e.event_type IN ('morning_brief_opened','evening_wrap_opened')
            AND e.created_at >= now() - interval '7 days') AS brief_open_user_7d,
    count(*) FILTER (WHERE e.event_type IN ('morning_brief_opened','evening_wrap_opened')
            AND e.created_at >= now() - interval '7 days') AS brief_opens_7d,
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
    (d.last_sign_in_at >= now() - interval '7 days')  AS logged_7d,
    (d.last_sign_in_at >= now() - interval '30 days') AS logged_30d,
    (d.created_at <= now() - interval '4 weeks') AS coh4w,
    COALESCE(ev.active_7d, false)  AS active_7d,
    COALESCE(ev.active_30d, false) AS active_30d,
    COALESCE(ev.brief_open_user_7d, false) AS brief_open_user_7d,
    COALESCE(ev.brief_opens_7d, 0) AS brief_opens_7d,
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
  round(100.0 * count(*) FILTER (WHERE brief_open_user_7d) / nullif(count(*), 0), 1) AS waps_pct,
  round(100.0 * count(*) FILTER (WHERE has_watchlist) / nullif(count(*), 0), 1) AS watchlist_pct,
  round(sum(brief_opens_7d)::numeric / nullif(count(*) FILTER (WHERE active_7d), 0), 2) AS brief_opens_per_active,
  round(100.0 * count(*) FILTER (WHERE coh4w AND active_7d) / nullif(count(*) FILTER (WHERE coh4w), 0), 1) AS retention_4w_pct,
  -- Global metrics, not user-segmentable: emitted on the 'All' row only.
  CASE WHEN GROUPING(segment_domain) = 1 THEN (SELECT count(*) FROM public.waitlist) END AS waitlist_count,
  CASE WHEN GROUPING(segment_domain) = 1 THEN (
    SELECT count(*) FROM (
      SELECT source_id::text AS company FROM public.outputs WHERE output_type = 'memo' AND source_id IS NOT NULL
      UNION
      SELECT company_id FROM public.user_memo_regeneration_quota WHERE company_id IS NOT NULL
    ) z
  ) END AS distinct_companies_researched
FROM peruser
GROUP BY GROUPING SETS ((segment_domain), ());

-- ── Retention cohorts: one row per (signup week x segment) plus per-week 'All' ──
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
  floor(extract(epoch FROM (now() - d.signup_week)) / 604800)::int AS weeks_since_signup
FROM dim_users d
LEFT JOIN recent_active a ON a.user_id = d.id
GROUP BY GROUPING SETS ((d.signup_week, d.segment_domain), (d.signup_week))
ORDER BY cohort_week, segment_domain;

-- ── Activation funnel: per signup-week cohort, share onboarded and activated ──
-- within 7 days of each user's own signup. Activated = first brief open OR first
-- memo within 7d. Onboarded is a separate, earlier funnel stage (setup, not value).
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
  count(*) FILTER (WHERE first_onb <= created_at + interval '7 days') AS onboarded_7d,
  round(100.0 * count(*) FILTER (WHERE first_onb <= created_at + interval '7 days') / nullif(count(*), 0)) AS onboarded_7d_pct,
  count(*) FILTER (WHERE least(first_brief, first_memo) <= created_at + interval '7 days') AS activated_7d,
  round(100.0 * count(*) FILTER (WHERE least(first_brief, first_memo) <= created_at + interval '7 days') / nullif(count(*), 0)) AS activated_7d_pct
FROM firsts
GROUP BY GROUPING SETS ((signup_week, segment_domain), (signup_week))
ORDER BY cohort_week, segment_domain;

-- ── Instrumentation health: per event_type freshness + volume ──
-- Surfaces events that have gone silent (e.g. watchlist_added, brief_section_rated).
-- Spans all events (not just real users): the question is whether the event fires
-- at all. days_since_last > 7 with events_7d = 0 is the silent-event flag.
CREATE OR REPLACE VIEW internal_kpi_instrumentation_health AS
SELECT
  event_type,
  max(created_at)::date AS last_seen,
  (now()::date - max(created_at)::date) AS days_since_last,
  count(*) FILTER (WHERE created_at >= now() - interval '7 days')  AS events_7d,
  count(*) FILTER (WHERE created_at >= now() - interval '30 days') AS events_30d,
  count(*) AS events_all
FROM public.user_events
GROUP BY event_type
ORDER BY days_since_last DESC;

-- ── Grants: service_role only, same gate as #311 ──
REVOKE ALL ON dim_users                          FROM anon, authenticated;
REVOKE ALL ON internal_kpi_summary               FROM anon, authenticated;
REVOKE ALL ON internal_kpi_retention_cohorts     FROM anon, authenticated;
REVOKE ALL ON internal_kpi_activation            FROM anon, authenticated;
REVOKE ALL ON internal_kpi_instrumentation_health FROM anon, authenticated;
GRANT SELECT ON dim_users                          TO service_role;
GRANT SELECT ON internal_kpi_summary               TO service_role;
GRANT SELECT ON internal_kpi_retention_cohorts     TO service_role;
GRANT SELECT ON internal_kpi_activation            TO service_role;
GRANT SELECT ON internal_kpi_instrumentation_health TO service_role;

NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────────────
-- DOWN (manual rollback). Views only, no data touched. Run in this order:
--
--   -- 1) restore the Phase A internal_kpi_summary body (reads auth.users directly)
--   DROP VIEW IF EXISTS internal_kpi_summary;
--   CREATE VIEW internal_kpi_summary AS
--   SELECT
--     (SELECT count(*) FROM auth.users) AS total_users,
--     (SELECT count(*) FROM auth.users WHERE last_sign_in_at >= now() - interval '7 days') AS active_7d,
--     (SELECT count(*) FROM auth.users WHERE last_sign_in_at >= now() - interval '30 days') AS active_30d,
--     (SELECT count(*) FROM auth.users WHERE created_at >= now() - interval '7 days') AS new_users_7d,
--     (SELECT count(*) FROM auth.users WHERE created_at >= now() - interval '30 days') AS new_users_30d,
--     (SELECT count(*) FROM public.waitlist) AS waitlist_count,
--     (SELECT count(DISTINCT user_id) FROM public.user_events WHERE created_at >= now() - interval '7 days') AS weekly_actives,
--     (SELECT count(DISTINCT user_id) FROM public.user_events WHERE event_type IN ('morning_brief_opened','evening_wrap_opened') AND created_at >= now() - interval '7 days') AS brief_open_users_7d,
--     (SELECT count(*) FROM public.user_events WHERE event_type IN ('morning_brief_opened','evening_wrap_opened') AND created_at >= now() - interval '7 days') AS brief_opens_7d,
--     (SELECT round(100.0 * count(DISTINCT a.user_id) / nullif(count(DISTINCT u.id), 0), 1)
--        FROM auth.users u LEFT JOIN (SELECT DISTINCT user_id FROM public.user_events WHERE created_at >= now() - interval '7 days') a ON a.user_id = u.id
--        WHERE u.created_at <= now() - interval '4 weeks') AS retention_4w_pct,
--     (SELECT count(*) FROM public.user_events WHERE event_type = 'memo_generated') AS memos_all_time,
--     (SELECT count(*) FROM public.user_events WHERE event_type = 'memo_generated' AND created_at >= now() - interval '7 days') AS memos_7d,
--     (SELECT count(*) FROM public.user_events WHERE event_type = 'memo_generated' AND created_at >= now() - interval '30 days') AS memos_30d,
--     (SELECT count(*) FROM (SELECT source_id::text AS company FROM public.outputs WHERE output_type='memo' AND source_id IS NOT NULL UNION SELECT company_id FROM public.user_memo_regeneration_quota WHERE company_id IS NOT NULL) z) AS distinct_companies_researched,
--     (SELECT count(DISTINCT user_id) FROM public.watchlist) AS users_with_watchlist;
--
--   -- 2) restore the Phase A internal_kpi_retention_cohorts body
--   DROP VIEW IF EXISTS internal_kpi_retention_cohorts;
--   CREATE VIEW internal_kpi_retention_cohorts AS
--   WITH cohorts AS (SELECT u.id, date_trunc('week', u.created_at)::date AS cohort_week FROM auth.users u),
--        recent_active AS (SELECT DISTINCT user_id FROM public.user_events WHERE created_at >= now() - interval '7 days')
--   SELECT c.cohort_week, count(*) AS cohort_size, count(a.user_id) AS active_last_7d,
--          round(100.0 * count(a.user_id) / nullif(count(*), 0), 1) AS retention_pct,
--          floor(extract(epoch FROM (now() - c.cohort_week)) / 604800)::int AS weeks_since_signup
--   FROM cohorts c LEFT JOIN recent_active a ON a.user_id = c.id
--   GROUP BY c.cohort_week ORDER BY c.cohort_week;
--
--   -- 3) restore grants on the two restored views
--   REVOKE ALL ON internal_kpi_summary FROM anon, authenticated;
--   REVOKE ALL ON internal_kpi_retention_cohorts FROM anon, authenticated;
--   GRANT SELECT ON internal_kpi_summary TO service_role;
--   GRANT SELECT ON internal_kpi_retention_cohorts TO service_role;
--
--   -- 4) drop the Phase B-only objects
--   DROP VIEW IF EXISTS internal_kpi_instrumentation_health;
--   DROP VIEW IF EXISTS internal_kpi_activation;
--   DROP VIEW IF EXISTS dim_users;
--
--   NOTIFY pgrst, 'reload schema';
-- ─────────────────────────────────────────────────────────────────────────────
