-- Event spine: extend user_events into the single append-only behavioral log.
--
-- Purely additive. No column is dropped, no row is rewritten, and event_type /
-- payload / created_at keep their exact current meaning, so the five live
-- consumers (backend/user_signal_aggregator.py, /api/profile/insights,
-- /api/collective-signals, updateInferredWeights, the internal dashboard views)
-- are unaffected.
--
-- The route (src/app/api/user-events/route.ts) is deployable BEFORE this runs:
-- it retries with the legacy column set and folds the new fields into payload
-- under underscore-prefixed keys. Applying this migration is what promotes them
-- to real columns. Backfilling those folded keys afterwards is optional and not
-- attempted here.
--
-- Noah applies this. Do not run it from an agent.

-- 1. Session grouping. TEXT, not UUID: the client falls back to a non-uuid id
--    when crypto.randomUUID is unavailable (non-secure origins, older Safari).
ALTER TABLE user_events ADD COLUMN IF NOT EXISTS session_id TEXT;

-- 2. Entity class discriminator. The entity_id column already existed but had
--    no type alongside it, which is why it sat at 0 rows used out of 1555.
ALTER TABLE user_events ADD COLUMN IF NOT EXISTS entity_type TEXT;

-- 3. Widen entity_id from UUID to TEXT. Real entity keys in this app are not
--    all uuids: tickers (AAPL), section keys, and user_saved_deals.deal_id are
--    text. Safe unconditionally, the column has 0 non-null rows.
ALTER TABLE user_events ALTER COLUMN entity_id TYPE TEXT USING entity_id::TEXT;

-- 4. Client-stamped time, for intra-session ordering only. Client clocks are
--    wrong and keepalive/beacon requests can arrive late, so created_at stays
--    the server-side ordering key. Never order across users by client_ts.
ALTER TABLE user_events ADD COLUMN IF NOT EXISTS client_ts TIMESTAMPTZ;

-- 5. Indexes for the four access patterns the spine has to serve.
--    Plain CREATE INDEX, not CONCURRENTLY: Supabase runs migrations inside a
--    transaction, and at ~1.5k rows these build instantly.
CREATE INDEX IF NOT EXISTS idx_user_events_entity
  ON user_events (entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_events_session
  ON user_events (session_id, client_ts)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_events_type_created
  ON user_events (event_type, created_at DESC);

-- Per-user-recent and since-last-seen are both served by the existing
-- idx_user_events_user_created (user_id, created_at DESC). No new index needed.

COMMENT ON COLUMN user_events.session_id  IS 'Per-tab telemetry session. sessionStorage-scoped, never cross-tab or persistent.';
COMMENT ON COLUMN user_events.entity_type IS 'Entity class: briefing, story, thesis, ticker, claim, output.';
COMMENT ON COLUMN user_events.entity_id   IS 'Entity key, free text. Pair with entity_type.';
COMMENT ON COLUMN user_events.client_ts   IS 'Client-stamped. Intra-session ordering only. Order by created_at across users.';

-- NOT included here, deliberately, because it is a behavior change with real
-- blast radius and belongs in its own PR:
--   the live RLS policy is a single FOR ALL grant ("Users manage own events"),
--   so a user can UPDATE and DELETE their own event rows today. Append-only is
--   convention, not enforcement. Replacing it with separate SELECT and INSERT
--   policies requires first confirming backend/user_signal_aggregator.py (anon
--   key) still reads.
