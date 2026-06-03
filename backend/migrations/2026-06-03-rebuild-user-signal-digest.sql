-- 2026-06-03-rebuild-user-signal-digest.sql
--
-- Rebuild `user_signal_digest` to the PER-USER shape the pipeline code actually
-- reads and writes. The live table is an unrelated AGGREGATE shape that matches
-- neither side, so today every per-user write fails and every read soft-fails to
-- "" -- the engagement signal is silently absent from every brief/wrap.
--
-- DROP + CREATE (not ALTER) because the live and target shapes share no columns
-- and the live table is EMPTY (0 rows, verified 2026-06-03) with zero code
-- consumers of its aggregate columns. There is nothing to preserve or backfill.
--
-- ---------------------------------------------------------------------------
-- Schema divergence (why this rebuild exists)
-- ---------------------------------------------------------------------------
--   LIVE (aggregate, orphaned)        WRITER _upsert_digests / READER _fetch_aggregate_engagement
--   ------------------------------    ------------------------------------------------------------
--   id uuid PK                        user_id uuid              <- conflict target, absent live
--   created_at timestamptz            top_sectors jsonb         <- absent live  (read + write)
--   brief_type varchar                top_tickers jsonb         <- absent live  (read + write)
--   high_engagement_sectors jsonb     preferred_memo_types jsonb<- absent live  (write)
--   low_engagement_sectors jsonb      engagement_level text     <- absent live  (read + write)
--   top_engaged_tickers jsonb         event_count int           <- absent live  (read + write)
--   dismissed_themes jsonb            computed_at timestamptz   <- absent live  (write)
--   user_count int
--
-- The writer and reader AGREE on the per-user shape, so the code is the
-- de-facto source of truth. This migration makes the table match the code.
--
-- ---------------------------------------------------------------------------
-- Design notes
-- ---------------------------------------------------------------------------
-- * PRIMARY KEY (user_id): the writer upserts with `on_conflict="user_id"`
--   (user_signal_aggregator._upsert_digests), so user_id must carry a UNIQUE
--   constraint. A PK is the minimal faithful expression of the code's
--   documented contract ("user_id (uuid, PK)") and provides that UNIQUE(user_id).
--
-- * NO `REFERENCES auth.users(id)`: unlike the user-FACING per-user siblings
--   (user_preferences, watchlist_*), the source column `user_events.user_id` is
--   itself nullable with NO FK to auth.users. Adding an auth FK here would be
--   STRICTER than the data source and could reintroduce a silent per-user write
--   failure for any event user_id not present in auth.users. Kept unconstrained
--   to match the data contract. (The writer already drops null user_ids.)
--
-- * RLS + PERMISSIVE policies (NOT the auth.uid() pattern): this table is
--   PIPELINE-INTERNAL -- written by user_signal_aggregator and read by
--   synthesize, both using the SUPABASE_ANON_KEY server-side with no end-user
--   session (auth.uid() is NULL). An auth.uid()=user_id policy (as on
--   user_preferences) would block the pipeline entirely. The live table is RLS
--   ON with ZERO policies = default-deny, a second independent reason reads/
--   writes fail today. We mirror the pipeline-table convention used by
--   pipeline_runs and theses: RLS enabled + permissive Public policies.

DROP TABLE IF EXISTS public.user_signal_digest;

CREATE TABLE public.user_signal_digest (
    user_id              uuid        PRIMARY KEY,
    top_sectors          jsonb       NOT NULL DEFAULT '[]'::jsonb,
    top_tickers          jsonb       NOT NULL DEFAULT '[]'::jsonb,
    preferred_memo_types jsonb       NOT NULL DEFAULT '[]'::jsonb,
    engagement_level     text,
    event_count          integer     NOT NULL DEFAULT 0,
    computed_at          timestamptz NOT NULL DEFAULT now()
);

-- RLS: pipeline-internal table written/read by the anon-key pipeline (no
-- auth.uid()). Permissive policies, matching pipeline_runs / theses.
ALTER TABLE public.user_signal_digest ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read"   ON public.user_signal_digest FOR SELECT USING (true);
CREATE POLICY "Public insert" ON public.user_signal_digest FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update" ON public.user_signal_digest FOR UPDATE USING (true);
