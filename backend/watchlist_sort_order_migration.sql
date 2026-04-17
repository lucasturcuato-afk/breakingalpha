-- watchlist_sort_order_migration.sql
-- Run once in Supabase SQL editor before deploying watchlist v4a.
-- This adds sort_order to the watchlist table for drag-to-reorder.
-- DO NOT run this from application code — execute manually in Supabase dashboard.

ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS sort_order integer;
UPDATE watchlist SET sort_order = (ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at))::integer
WHERE sort_order IS NULL;
CREATE INDEX IF NOT EXISTS watchlist_sort_order ON watchlist(user_id, sort_order);
