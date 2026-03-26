-- theses_schema.sql
-- Run once in the Supabase SQL editor to create the theses table.

-- Create bull_bear enum
CREATE TYPE bull_bear AS ENUM ('bull', 'bear');

-- Create theses table
CREATE TABLE theses (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    company     text        NOT NULL,
    thesis_text text        NOT NULL,
    bull_bear   bull_bear   NOT NULL,
    sector      text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- RLS: public read + public write (same as deal_flow)
ALTER TABLE theses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read"   ON theses FOR SELECT USING (true);
CREATE POLICY "Public insert" ON theses FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update" ON theses FOR UPDATE USING (true);
CREATE POLICY "Public delete" ON theses FOR DELETE USING (true);
