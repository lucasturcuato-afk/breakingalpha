-- Phase 1 (personalization sprint): behavioral event stream.
--
-- Append-only log of user interactions with theses, briefs, memos, etc. The
-- aggregate shape (per-sector views / dismissals / memo generations) drives
-- inferred sector weights used when re-ranking theses + morning briefs.
--
-- Payload is JSONB to avoid a schema migration every time we add a new event
-- type. Canonical event types documented in src/lib/user-profile.ts.

CREATE TABLE IF NOT EXISTS user_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_events_user_type_created
  ON user_events(user_id, event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_events_user_created
  ON user_events(user_id, created_at DESC);

-- Inferred weights lookup — read hot-path for personalization. Using a
-- materialized view would be tempting, but we want immediate updates after a
-- user dismisses a thesis, so keep it a regular index.
CREATE INDEX IF NOT EXISTS idx_user_events_payload_sector
  ON user_events USING GIN ((payload -> 'sector'));

ALTER TABLE user_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own events"
  ON user_events FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own events"
  ON user_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- No UPDATE / DELETE policy — events are immutable by design.
