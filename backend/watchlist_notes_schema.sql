-- watchlist_notes_schema.sql
-- Run once in the Supabase SQL editor before deploying watchlist v3b.
--
-- Stores private per-user notes for watchlist entries.
-- Scoped by user_id + identifier — one note per user per entry.
-- RLS ensures users can only read/write their own notes.
--
-- Created: 2026-04-16 | Sprint: watchlist-v3b

CREATE TABLE IF NOT EXISTS watchlist_notes (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL,
  identifier   text        NOT NULL,
  note_text    text        NOT NULL DEFAULT '',
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, identifier)
);

ALTER TABLE watchlist_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own notes"   ON watchlist_notes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own notes" ON watchlist_notes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own notes" ON watchlist_notes FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own notes" ON watchlist_notes FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS watchlist_notes_user_identifier ON watchlist_notes (user_id, identifier);
