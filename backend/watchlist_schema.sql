-- watchlist_schema.sql
-- Run once in the Supabase SQL editor to create the watchlist table.

-- Create watchlist_type enum
CREATE TYPE watchlist_type AS ENUM ('ticker', 'company');

-- Create watchlist table
CREATE TABLE watchlist (
    id          uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
    identifier  text            NOT NULL,
    type        watchlist_type  NOT NULL,
    created_at  timestamptz     NOT NULL DEFAULT now(),
    updated_at  timestamptz     NOT NULL DEFAULT now()
);

-- RLS: public read + public write (same as theses and deal_flow)
ALTER TABLE watchlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read"   ON watchlist FOR SELECT USING (true);
CREATE POLICY "Public insert" ON watchlist FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update" ON watchlist FOR UPDATE USING (true);
CREATE POLICY "Public delete" ON watchlist FOR DELETE USING (true);
