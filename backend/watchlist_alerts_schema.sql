-- watchlist_price_alerts table
-- Run manually in Supabase SQL editor after deploying V4C

CREATE TABLE watchlist_price_alerts (
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

ALTER TABLE watchlist_price_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "User read own" ON watchlist_price_alerts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "User insert own" ON watchlist_price_alerts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "User update own" ON watchlist_price_alerts FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "User delete own" ON watchlist_price_alerts FOR DELETE USING (auth.uid() = user_id);
