-- user_saved_deals: per-user bookmarked deals
-- deal_id is TEXT (not UUID) because manually-added deals use Date.now().toString()

CREATE TABLE IF NOT EXISTS user_saved_deals (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  deal_id     TEXT NOT NULL,
  saved_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, deal_id)
);

ALTER TABLE user_saved_deals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own saved deals"
  ON user_saved_deals
  FOR ALL
  TO authenticated
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_user_saved_deals_user_id ON user_saved_deals(user_id);
CREATE INDEX IF NOT EXISTS idx_user_saved_deals_deal_id  ON user_saved_deals(deal_id);
