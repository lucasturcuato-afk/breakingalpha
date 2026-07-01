-- Option B (Today's Stories snapshot): persist the ordered list of article IDs
-- selected for a briefing's Today's Stories rail, so the rail is reproducible
-- and identity-deduped against the prior brief instead of recomputed live.
--
-- Expand-migrate-contract, expand phase: the column is ADDITIVE and NULLABLE,
-- so applying it cannot break the running site. Legacy rows (and any generation
-- that did not persist IDs) stay NULL; the frontend falls back to the live
-- window query (src/lib/story-rail-window.ts) until a B-generated brief
-- populates this column. Nothing reads it as NOT NULL.
--
-- Shape: a JSON array of article id strings in render order, e.g.
--   ["<uuid>", "<uuid>", ...]  (up to 8).
--
-- NOT YET APPLIED. Hand to Noah to apply; prod is safe before and after.

ALTER TABLE briefings ADD COLUMN IF NOT EXISTS story_rail_ids jsonb;
