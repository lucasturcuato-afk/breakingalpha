-- brief_email_unsubscribe.sql
-- Schema for Morning Brief email polish (Wave 2): issue numbering and
-- one-click unsubscribe. Idempotent: safe to re-run.
--
-- Apply manually in Supabase SQL editor before merging the email-polish PR.
--
-- 1. issue_number on briefings   stable per-brief sequential counter cached
--    on the row so it never shifts even if older briefings are deleted.
-- 2. brief_email_subscribed on user_profiles   per-user opt-out flag.
--    Defaults true; flipped false by /api/unsubscribe?token=...

-- ── 1. Stable issue number on briefings ────────────────────────────────
ALTER TABLE briefings
    ADD COLUMN IF NOT EXISTS issue_number integer;

-- Lookup index for "next issue number" computations, plus a uniqueness
-- guard so two simultaneous send attempts cannot mint the same number.
CREATE UNIQUE INDEX IF NOT EXISTS briefings_issue_number_uniq_idx
    ON briefings (issue_number)
    WHERE issue_number IS NOT NULL;

COMMENT ON COLUMN briefings.issue_number IS
    'Sequential issue number assigned at first email send. Stable forever once set, even if older briefings are deleted. Computed as MAX(issue_number)+1 over briefings at send time.';

-- ── 2. Email opt-out flag on user_profiles ─────────────────────────────
ALTER TABLE user_profiles
    ADD COLUMN IF NOT EXISTS brief_email_subscribed boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN user_profiles.brief_email_subscribed IS
    'True if the user receives Morning Brief / Evening Wrap emails. Set false by one-click unsubscribe handler at /api/unsubscribe.';

-- Filtering index for the (eventual) bulk-send cron. Cheap to maintain
-- because the filter only inspects opt-outs, which is the small minority.
CREATE INDEX IF NOT EXISTS user_profiles_brief_email_subscribed_idx
    ON user_profiles (brief_email_subscribed)
    WHERE brief_email_subscribed = false;
