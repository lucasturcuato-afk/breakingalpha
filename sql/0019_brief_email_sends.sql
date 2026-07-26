-- 0019_brief_email_sends.sql
--
-- Idempotence ledger for the daily Morning Brief email.
--
-- One row per (brief, user) that was successfully mailed. The pipeline reads
-- this before every send and skips anyone already recorded, so a manual
-- workflow_dispatch after the cron run cannot double-send today's brief.
--
-- The UNIQUE constraint is the hard backstop, not the optimization: if the
-- pre-send read fails or two runs race, the insert is what actually prevents a
-- duplicate. backend/brief_email_send.py treats a failed ledger read as "send"
-- precisely because this constraint exists.
--
-- NOT APPLIED. Noah applies migrations. Nothing in the send path assumes this
-- table exists: a missing table degrades to a logged warning and an empty
-- already-sent set, so the feature is safe to merge before the migration runs
-- (with EMAIL_DIGEST_MODE off, which is the default).
--
-- The per-user opt-out column this feature relies on already exists in prod:
--   user_profiles.brief_email_subscribed boolean NOT NULL DEFAULT true
-- shipped in sql/brief_email_unsubscribe.sql. No new preference column is
-- needed; new users default to subscribed via that column default.

CREATE TABLE IF NOT EXISTS public.brief_email_sends (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    brief_id    uuid NOT NULL REFERENCES public.briefings (id) ON DELETE CASCADE,
    user_id     uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    sent_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT brief_email_sends_brief_user_key UNIQUE (brief_id, user_id)
);

COMMENT ON TABLE public.brief_email_sends IS
    'One row per successfully delivered Morning Brief email. UNIQUE(brief_id, user_id) is what makes a pipeline re-run non-duplicating.';

-- Covers the pre-send lookup: "which users already got THIS brief".
CREATE INDEX IF NOT EXISTS brief_email_sends_brief_id_idx
    ON public.brief_email_sends (brief_id);

-- Covers per-user delivery history for support questions ("did I get it?").
CREATE INDEX IF NOT EXISTS brief_email_sends_user_id_sent_at_idx
    ON public.brief_email_sends (user_id, sent_at DESC);

-- RLS on, with no permissive policy. This is a service-role-only ledger: the
-- pipeline writes it with the service key, which bypasses RLS. No client, and
-- no logged-in user, has any reason to read another user's delivery record.
ALTER TABLE public.brief_email_sends ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS brief_email_sends_own_reads ON public.brief_email_sends;
CREATE POLICY brief_email_sends_own_reads
    ON public.brief_email_sends
    FOR SELECT
    USING (auth.uid() = user_id);
