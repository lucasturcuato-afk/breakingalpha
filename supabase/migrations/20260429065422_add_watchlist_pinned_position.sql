ALTER TABLE watchlist
  ADD COLUMN IF NOT EXISTS pinned_position smallint;

ALTER TABLE watchlist
  DROP CONSTRAINT IF EXISTS watchlist_pinned_position_range;

ALTER TABLE watchlist
  ADD CONSTRAINT watchlist_pinned_position_range
  CHECK (pinned_position IS NULL OR (pinned_position BETWEEN 1 AND 5));

CREATE UNIQUE INDEX IF NOT EXISTS watchlist_user_pinned_position_unique
  ON watchlist(user_id, pinned_position)
  WHERE pinned_position IS NOT NULL;

DROP POLICY IF EXISTS watchlist_update_own ON watchlist;
CREATE POLICY watchlist_update_own ON watchlist
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
