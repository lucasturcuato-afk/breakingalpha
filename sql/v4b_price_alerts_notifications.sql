-- v4b_price_alerts_notifications.sql
-- Creates watchlist_price_alerts + watchlist_notifications tables.
-- Idempotent — safe to run multiple times.
--
-- Backend (backend/watchlist_sync.py) writes notifications via the service role /
-- anon key; the RLS INSERT policy below is intentionally permissive for service
-- use. In production the backend uses the anon key which — without an explicit
-- INSERT policy — would be blocked, so we keep a service-insert policy.

-- ─── Price alerts ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS watchlist_price_alerts (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  identifier      text        NOT NULL,
  alert_type      text        NOT NULL CHECK (alert_type IN ('percent_change', 'price_above', 'price_below')),
  threshold       numeric     NOT NULL,
  direction       text        CHECK (direction IN ('up', 'down', 'either')),
  enabled         boolean     NOT NULL DEFAULT true,
  last_triggered  timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, identifier, alert_type, threshold)
);

CREATE INDEX IF NOT EXISTS watchlist_price_alerts_user_id_idx
  ON watchlist_price_alerts(user_id);
CREATE INDEX IF NOT EXISTS watchlist_price_alerts_identifier_idx
  ON watchlist_price_alerts(identifier) WHERE enabled = true;

ALTER TABLE watchlist_price_alerts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "watchlist_price_alerts: users can read own"
    ON watchlist_price_alerts FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "watchlist_price_alerts: users can insert own"
    ON watchlist_price_alerts FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "watchlist_price_alerts: users can update own"
    ON watchlist_price_alerts FOR UPDATE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "watchlist_price_alerts: users can delete own"
    ON watchlist_price_alerts FOR DELETE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Notifications (in-app) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS watchlist_notifications (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  identifier  text        NOT NULL,
  type        text        NOT NULL CHECK (type IN ('price_alert', 'article', 'brief_ready')),
  title       text        NOT NULL,
  body        text,
  read        boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS watchlist_notifications_user_id_idx
  ON watchlist_notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS watchlist_notifications_user_unread_idx
  ON watchlist_notifications(user_id, read) WHERE read = false;

ALTER TABLE watchlist_notifications ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "watchlist_notifications: users can read own"
    ON watchlist_notifications FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "watchlist_notifications: users can update own"
    ON watchlist_notifications FOR UPDATE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "watchlist_notifications: users can delete own"
    ON watchlist_notifications FOR DELETE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- INSERT policy is permissive so the pipeline (running via anon key in
-- watchlist_sync.py) can write notifications on behalf of users. Rows always
-- carry user_id, and users can only SELECT/UPDATE/DELETE their own.
DO $$ BEGIN
  CREATE POLICY "watchlist_notifications: service insert"
    ON watchlist_notifications FOR INSERT WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Watchlist articles: score_breakdown column (for v4b relevance logging) ─
ALTER TABLE watchlist_articles
  ADD COLUMN IF NOT EXISTS score_breakdown text;
