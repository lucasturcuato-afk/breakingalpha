-- ############################################################################
-- ##  UNAPPLIED. THIS MIGRATION HAS NOT BEEN RUN AGAINST ANY DATABASE.      ##
-- ##                                                                        ##
-- ##  It was authored by an unattended agent run, which never applies       ##
-- ##  migrations. A human must review and run it. It lives in               ##
-- ##  backend/migrations/ (the hand-run directory) rather than              ##
-- ##  supabase/migrations/ specifically so no automated runner picks it up, ##
-- ##  and the filename is prefixed UNAPPLIED for the same reason. Rename it ##
-- ##  when you actually apply it.                                           ##
-- ############################################################################
--
-- SIGNUP COHORT CAPTURE
--
-- PROBLEM. Users arriving from different channels are indistinguishable in the
-- data. The only segmentation that exists today is an email-domain proxy in
-- dim_users (usc.edu and marshall.usc.edu), which files 153 of 199 users into a
-- single "USC" bucket while the beta_allowlist notes column is already being
-- used as a de facto cohort field in free text, with at least four real cohorts
-- inside that one domain (TIS, BSIG, SMU Finance, personal) and with "BSIG" and
-- "BSIG " stored as two distinct values. Pilot users will be unreadable against
-- organic signups and outreach unless attribution is captured at signup, and
-- attribution not captured at signup cannot be reconstructed later.
--
-- SHAPE, and why. Three columns rather than one free-text tag, carried on BOTH
-- public.waitlist and public.beta_allowlist:
--
--   cohort_source       closed enum, which channel
--   cohort_institution  normalized slug, which school or org
--   cohort_batch        normalized slug, which admission wave
--
-- Why on beta_allowlist and not only on waitlist: admission is a MANUAL insert
-- into beta_allowlist. No application code anywhere writes that table; the only
-- writers in the repository are hand-run SQL files. Today a waitlist row and the
-- resulting auth.users row are linked by nothing but the email string, and the
-- link is lost in both directions: 7 of 130 waitlist rows belong to already
-- admitted people with no marker of that fact, and 84 of the 91 allowlist rows
-- have no waitlist row at all. Putting the cohort on beta_allowlist means the
-- same hand-run INSERT that admits someone also carries their batch, with no
-- second step to forget. admitted_from_waitlist_id additionally makes the link
-- explicit rather than leaving it implied by email.
--
-- Why NOT a join table keyed by user_id: there is no code path that would write
-- it. Admission has no application code at all, so a user-keyed table would need
-- the first ever INSERT path into the admission flow plus a new RLS policy
-- (beta_allowlist currently has SELECT policies only, no INSERT policy).
--
-- Why NOT auth.users.raw_user_meta_data: Google overwrites identity metadata on
-- OAuth, and OAuth is the path for 99 of the 130 existing waitlist rows.
--
-- NO CARD DEFINITION CHANGES. internal_kpi_summary, internal_kpi_activation,
-- internal_kpi_retention_cohorts and internal_kpi_instrumentation_health are NOT
-- touched by this migration. The cohort dimension arrives as a NEW view whose
-- metric expressions are copied verbatim from internal_kpi_summary, so the
-- existing cards keep returning exactly what they return today. Card
-- corrections come after the audit is read, not here.
--
-- NO BACKFILL. This migration writes no rows. Every existing user and waitlist
-- row keeps NULL cohort fields and lands in the 'unattributed' bucket. The
-- backfill proposal is prose in the PR body and is deliberately not executed.

BEGIN;

-- ── 1. Cohort columns on the waitlist (capture at first touch) ──────────────
ALTER TABLE public.waitlist
  ADD COLUMN IF NOT EXISTS cohort_source      text,
  ADD COLUMN IF NOT EXISTS cohort_institution text,
  ADD COLUMN IF NOT EXISTS cohort_batch       text;

-- ── 2. Cohort columns on the allowlist (batch identity survives admission) ──
ALTER TABLE public.beta_allowlist
  ADD COLUMN IF NOT EXISTS cohort_source              text,
  ADD COLUMN IF NOT EXISTS cohort_institution         text,
  ADD COLUMN IF NOT EXISTS cohort_batch               text,
  ADD COLUMN IF NOT EXISTS admitted_from_waitlist_id  uuid
    REFERENCES public.waitlist(id) ON DELETE SET NULL;

-- ── 3. Constrain the enum and the slug shape in the database, not only in the
-- application. The capture endpoint is unauthenticated and client-callable, so
-- the closed set has to be enforced where it cannot be bypassed. NULL is always
-- allowed: an unattributed signup is legitimate and must never be blocked.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'waitlist_cohort_source_enum') THEN
    ALTER TABLE public.waitlist ADD CONSTRAINT waitlist_cohort_source_enum
      CHECK (cohort_source IS NULL OR cohort_source IN
        ('organic','pilot','outreach','referral','event','import'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'waitlist_cohort_slug_shape') THEN
    ALTER TABLE public.waitlist ADD CONSTRAINT waitlist_cohort_slug_shape
      CHECK (
        (cohort_institution IS NULL OR cohort_institution ~ '^[a-z0-9][a-z0-9-]{0,39}$')
        AND (cohort_batch   IS NULL OR cohort_batch       ~ '^[a-z0-9][a-z0-9-]{0,39}$')
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'allowlist_cohort_source_enum') THEN
    ALTER TABLE public.beta_allowlist ADD CONSTRAINT allowlist_cohort_source_enum
      CHECK (cohort_source IS NULL OR cohort_source IN
        ('organic','pilot','outreach','referral','event','import'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'allowlist_cohort_slug_shape') THEN
    ALTER TABLE public.beta_allowlist ADD CONSTRAINT allowlist_cohort_slug_shape
      CHECK (
        (cohort_institution IS NULL OR cohort_institution ~ '^[a-z0-9][a-z0-9-]{0,39}$')
        AND (cohort_batch   IS NULL OR cohort_batch       ~ '^[a-z0-9][a-z0-9-]{0,39}$')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS waitlist_cohort_batch_idx
  ON public.waitlist (cohort_batch) WHERE cohort_batch IS NOT NULL;
CREATE INDEX IF NOT EXISTS allowlist_cohort_batch_idx
  ON public.beta_allowlist (cohort_batch) WHERE cohort_batch IS NOT NULL;

-- ── 4. dim_users gains the cohort dimension ─────────────────────────────────
-- The join has to happen HERE because this is the only place both sides are
-- available: dim_users reads auth.users (which has email) while deliberately
-- exposing no email of its own. Downstream views therefore get a cohort without
-- any of them gaining access to an address.
--
-- CREATE OR REPLACE is safe: the new columns are APPENDED. Postgres permits
-- adding trailing columns to a view that has dependents; it would reject a
-- removal, a rename, or a reorder. The existing five columns keep their names,
-- types and positions, so internal_kpi_summary and the other dependents are
-- unaffected and are not rebuilt.
CREATE OR REPLACE VIEW dim_users AS
SELECT
  u.id,
  u.created_at,
  u.last_sign_in_at,
  date_trunc('week', u.created_at)::date AS signup_week,
  CASE WHEN lower(split_part(u.email, '@', 2)) IN ('usc.edu', 'marshall.usc.edu')
       THEN 'USC' ELSE 'other' END AS segment_domain,
  -- New, appended:
  a.cohort_source,
  a.cohort_institution,
  a.cohort_batch,
  -- Mirrors cohortKey() in src/lib/cohort.ts EXACTLY. Keep the two in sync.
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
WHERE lower(u.email) NOT IN (
        'noahhanning03@gmail.com',
        'lucasturcuato@gmail.com',
        'claude-agent@signalera.ai'
      )
  AND lower(split_part(u.email, '@', 2)) NOT IN (
        'signalera-internal.com',
        'anthropic-test.local'
      );

-- ── 5. Cohort-scoped summary. NEW view, existing ones untouched ─────────────
-- Every metric expression below is copied VERBATIM from internal_kpi_summary
-- (supabase/migrations/20260602160000_internal_dashboard_phase_b_views.sql
-- lines 49-112). The ONLY change is the grouping key: cohort_key instead of
-- segment_domain. That is what makes this a filter rather than a redefinition.
-- If a card is corrected later, both views must be corrected together.
CREATE OR REPLACE VIEW internal_kpi_summary_by_cohort AS
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
  SELECT d.id, d.cohort_key,
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
  CASE WHEN GROUPING(cohort_key) = 1 THEN 'All' ELSE cohort_key END AS cohort_key,
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
  round(100.0 * count(*) FILTER (WHERE coh4w AND active_7d) / nullif(count(*) FILTER (WHERE coh4w), 0), 1) AS retention_4w_pct
FROM peruser
GROUP BY GROUPING SETS ((cohort_key), ());

-- ── 6. Cohort roster, the ground truth the self test asserts against ────────
-- Deliberately a separate, dead-simple view: the self test must not verify the
-- summary using the summary. This counts members straight off dim_users.
CREATE OR REPLACE VIEW internal_kpi_cohort_members AS
SELECT
  cohort_key,
  cohort_source,
  cohort_institution,
  cohort_batch,
  count(*) AS member_count
FROM dim_users
GROUP BY cohort_key, cohort_source, cohort_institution, cohort_batch;

-- ── 7. Grants: service_role only, same gate as the other internal views ─────
REVOKE ALL ON internal_kpi_summary_by_cohort FROM anon, authenticated;
REVOKE ALL ON internal_kpi_cohort_members    FROM anon, authenticated;
GRANT SELECT ON internal_kpi_summary_by_cohort TO service_role;
GRANT SELECT ON internal_kpi_cohort_members    TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- DOWN (manual rollback). Drops only what this migration added. No data is
-- destroyed except the cohort values themselves, which nothing else reads.
--
--   DROP VIEW IF EXISTS internal_kpi_cohort_members;
--   DROP VIEW IF EXISTS internal_kpi_summary_by_cohort;
--
--   -- Restore dim_users to its five-column Phase B shape. This is a DROP, not a
--   -- REPLACE, because REMOVING columns from a view is not allowed in place.
--   -- Dependents must be rebuilt after, so run the Phase B migration's
--   -- internal_kpi_* section again once dim_users is back.
--   DROP VIEW IF EXISTS dim_users CASCADE;
--   -- then re-run supabase/migrations/20260602160000_internal_dashboard_phase_b_views.sql
--
--   ALTER TABLE public.beta_allowlist
--     DROP CONSTRAINT IF EXISTS allowlist_cohort_source_enum,
--     DROP CONSTRAINT IF EXISTS allowlist_cohort_slug_shape,
--     DROP COLUMN IF EXISTS cohort_source,
--     DROP COLUMN IF EXISTS cohort_institution,
--     DROP COLUMN IF EXISTS cohort_batch,
--     DROP COLUMN IF EXISTS admitted_from_waitlist_id;
--   ALTER TABLE public.waitlist
--     DROP CONSTRAINT IF EXISTS waitlist_cohort_source_enum,
--     DROP CONSTRAINT IF EXISTS waitlist_cohort_slug_shape,
--     DROP COLUMN IF EXISTS cohort_source,
--     DROP COLUMN IF EXISTS cohort_institution,
--     DROP COLUMN IF EXISTS cohort_batch;
--
--   NOTIFY pgrst, 'reload schema';
-- ─────────────────────────────────────────────────────────────────────────────
