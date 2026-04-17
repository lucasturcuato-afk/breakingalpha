-- watchlist_notifications table
-- Run manually in Supabase SQL editor after deploying V4B

CREATE TABLE watchlist_notifications (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  identifier   text        NOT NULL,
  type         text        NOT NULL CHECK (type IN ('price_alert', 'article', 'brief_ready')),
  title        text        NOT NULL,
  body         text,
  read         boolean     NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_watchlist_notifications_user ON watchlist_notifications(user_id, created_at DESC);
ALTER TABLE watchlist_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "User read own" ON watchlist_notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "User update own" ON watchlist_notifications FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Service insert" ON watchlist_notifications FOR INSERT WITH CHECK (true);
CREATE POLICY "User delete own" ON watchlist_notifications FOR DELETE USING (auth.uid() = user_id);

-- score_breakdown column for watchlist_articles
-- Stores a human-readable breakdown of the relevance score components
ALTER TABLE watchlist_articles ADD COLUMN IF NOT EXISTS score_breakdown text;
