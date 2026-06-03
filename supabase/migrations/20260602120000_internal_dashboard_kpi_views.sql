-- Phase A internal analytics dashboard: read-only KPI views.
--
-- Additive and non-destructive. Creates two views over EXISTING tables
-- (auth.users, public.user_events, public.outputs, public.waitlist,
-- public.watchlist, public.user_memo_regeneration_quota). No table is created,
-- altered, or mutated. The /internal founders-only dashboard reads these views
-- through the service-role client.
--
-- Index note: the engagement queries below filter user_events by
-- (event_type, created_at) and group by user_id. The covering index
--   idx_user_events_user_type_created ON user_events(user_id, event_type, created_at DESC)
-- already exists (see 20260416_create_user_events.sql), so this migration adds
-- NO new index. The guarded statement below is a documented no-op that stays
-- idempotent if that earlier migration is ever absent.
CREATE INDEX IF NOT EXISTS idx_user_events_user_type_created
  ON user_events(user_id, event_type, created_at DESC);

-- ── Summary view: one row of headline KPI counts ──
-- Ratios (WAPS, brief-opens-per-active, % with watchlist, retention) are derived
-- in the application layer from these raw counts.
CREATE OR REPLACE VIEW internal_kpi_summary AS
SELECT
  -- DEMAND
  (SELECT count(*) FROM auth.users)                                              AS total_users,
  (SELECT count(*) FROM auth.users
     WHERE last_sign_in_at >= now() - interval '7 days')                         AS active_7d,
  (SELECT count(*) FROM auth.users
     WHERE last_sign_in_at >= now() - interval '30 days')                        AS active_30d,
  (SELECT count(*) FROM auth.users
     WHERE created_at >= now() - interval '7 days')                              AS new_users_7d,
  (SELECT count(*) FROM auth.users
     WHERE created_at >= now() - interval '30 days')                             AS new_users_30d,
  (SELECT count(*) FROM public.waitlist)                                         AS waitlist_count,

  -- ENGAGEMENT (weekly, 7d-anchored by definition)
  (SELECT count(DISTINCT user_id) FROM public.user_events
     WHERE created_at >= now() - interval '7 days')                              AS weekly_actives,
  (SELECT count(DISTINCT user_id) FROM public.user_events
     WHERE event_type IN ('morning_brief_opened','evening_wrap_opened')
       AND created_at >= now() - interval '7 days')                              AS brief_open_users_7d,
  (SELECT count(*) FROM public.user_events
     WHERE event_type IN ('morning_brief_opened','evening_wrap_opened')
       AND created_at >= now() - interval '7 days')                              AS brief_opens_7d,
  -- of users who joined at least 4 weeks ago, share active in the last 7 days
  (SELECT round(100.0 * count(DISTINCT a.user_id) / nullif(count(DISTINCT u.id), 0), 1)
     FROM auth.users u
     LEFT JOIN (SELECT DISTINCT user_id FROM public.user_events
                  WHERE created_at >= now() - interval '7 days') a
       ON a.user_id = u.id
     WHERE u.created_at <= now() - interval '4 weeks')                           AS retention_4w_pct,

  -- DEPTH
  (SELECT count(*) FROM public.user_events
     WHERE event_type = 'memo_generated')                                        AS memos_all_time,
  (SELECT count(*) FROM public.user_events
     WHERE event_type = 'memo_generated'
       AND created_at >= now() - interval '7 days')                              AS memos_7d,
  (SELECT count(*) FROM public.user_events
     WHERE event_type = 'memo_generated'
       AND created_at >= now() - interval '30 days')                             AS memos_30d,
  -- Distinct companies researched. Best-available from existing data only:
  -- outputs(type=memo).source_id is currently never populated, so this resolves
  -- almost entirely to regeneration-quota company_id. Known undercount; proper
  -- capture (persist target company on memo generation) is Phase B.
  (SELECT count(*) FROM (
      SELECT source_id::text AS company FROM public.outputs
        WHERE output_type = 'memo' AND source_id IS NOT NULL
      UNION
      SELECT company_id FROM public.user_memo_regeneration_quota
        WHERE company_id IS NOT NULL
   ) z)                                                                          AS distinct_companies_researched,
  (SELECT count(DISTINCT user_id) FROM public.watchlist)                         AS users_with_watchlist;

-- ── Retention cohort view: one row per weekly signup cohort ──
-- retention_pct = share of the cohort active (any user_event) in the last 7 days.
CREATE OR REPLACE VIEW internal_kpi_retention_cohorts AS
WITH cohorts AS (
  SELECT u.id, date_trunc('week', u.created_at)::date AS cohort_week
  FROM auth.users u
),
recent_active AS (
  SELECT DISTINCT user_id FROM public.user_events
  WHERE created_at >= now() - interval '7 days'
)
SELECT
  c.cohort_week,
  count(*)                                                              AS cohort_size,
  count(a.user_id)                                                      AS active_last_7d,
  round(100.0 * count(a.user_id) / nullif(count(*), 0), 1)             AS retention_pct,
  floor(extract(epoch FROM (now() - c.cohort_week)) / 604800)::int     AS weeks_since_signup
FROM cohorts c
LEFT JOIN recent_active a ON a.user_id = c.id
GROUP BY c.cohort_week
ORDER BY c.cohort_week;

-- Restrict reads to the service role only. The /internal page queries these
-- views with the service-role client behind the requireAdmin() gate; anon and
-- authenticated roles get NO access, so these aggregates can never leak through
-- PostgREST to a normal session.
REVOKE ALL ON internal_kpi_summary FROM anon, authenticated;
REVOKE ALL ON internal_kpi_retention_cohorts FROM anon, authenticated;
GRANT SELECT ON internal_kpi_summary TO service_role;
GRANT SELECT ON internal_kpi_retention_cohorts TO service_role;

-- Ask PostgREST to pick up the new views immediately.
NOTIFY pgrst, 'reload schema';

-- ─────────────────────────────────────────────────────────────────────────────
-- DOWN (manual rollback). This repo applies plain .sql forward migrations, so
-- reversal is documented here rather than auto-run. Safe and complete because
-- the migration only added views (and a no-op IF NOT EXISTS index guard):
--
--   DROP VIEW IF EXISTS internal_kpi_retention_cohorts;
--   DROP VIEW IF EXISTS internal_kpi_summary;
--   -- leave idx_user_events_user_type_created in place; it predates this migration.
-- ─────────────────────────────────────────────────────────────────────────────
