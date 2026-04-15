-- watchlist_articles_schema.sql
-- Run once in the Supabase SQL editor before deploying watchlist v3a.
--
-- TABLE 1: watchlist_articles
--   Pre-fetched articles per watchlist identifier, populated by watchlist_sync.py
--   running as step 13 of the backend pipeline. Shared across all users.
--   No user_id — one article set per identifier, not per user.
--
-- TABLE 2: watchlist_briefs
--   Cached LLM-generated company briefs per identifier.
--   Written by the browser after Gemini generates a brief via /api/memo.
--   Shared per identifier — any user viewing the same identifier sees the
--   same cached brief.
--
-- Created: 2026-04-15 | Sprint: watchlist-v3a

-- ─────────────────────────────────────────────────────────────────────
-- watchlist_articles
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS watchlist_articles (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    identifier      text        NOT NULL,
    article_id      text        NOT NULL,
    title           text        NOT NULL,
    url             text,
    source          text,
    source_type     text        NOT NULL CHECK (source_type IN ('finnhub', 'exa', 'gdelt')),
    summary         text,
    published_at    timestamptz,
    relevance_score integer     NOT NULL DEFAULT 5 CHECK (relevance_score BETWEEN 1 AND 10),
    fetched_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (identifier, article_id)
);

-- Primary query: all articles for an identifier, newest first
CREATE INDEX IF NOT EXISTS watchlist_articles_identifier_published
    ON watchlist_articles (identifier, published_at DESC);

-- Cleanup query: find stale rows by fetch date
CREATE INDEX IF NOT EXISTS watchlist_articles_fetched_at
    ON watchlist_articles (fetched_at);

-- RLS
ALTER TABLE watchlist_articles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read"   ON watchlist_articles FOR SELECT USING (true);
CREATE POLICY "Public insert" ON watchlist_articles FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update" ON watchlist_articles FOR UPDATE USING (true);
CREATE POLICY "Public delete" ON watchlist_articles FOR DELETE USING (true);

-- ─────────────────────────────────────────────────────────────────────
-- watchlist_briefs
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS watchlist_briefs (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    identifier    text        NOT NULL UNIQUE,
    brief_text    text        NOT NULL,
    article_count integer     NOT NULL DEFAULT 0,
    generated_at  timestamptz NOT NULL DEFAULT now(),
    model         text        NOT NULL DEFAULT 'gemini-2.5-flash'
);

-- Freshness check query
CREATE INDEX IF NOT EXISTS watchlist_briefs_identifier_generated
    ON watchlist_briefs (identifier, generated_at);

-- RLS
ALTER TABLE watchlist_briefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read"   ON watchlist_briefs FOR SELECT USING (true);
CREATE POLICY "Public insert" ON watchlist_briefs FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update" ON watchlist_briefs FOR UPDATE USING (true);
CREATE POLICY "Public delete" ON watchlist_briefs FOR DELETE USING (true);
