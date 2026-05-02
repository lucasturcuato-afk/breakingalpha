-- web_search_cache.sql
-- Caches Exa (or other web-search provider) results for the Company Intel
-- web-fallback path. Keyed on a SHA-256 hash of the normalized query string
-- so that semantically identical queries reuse the same cache row.
--
-- TTL: callers should treat any row older than 6 hours as stale and re-fetch.
--      We do not enforce TTL at the DB level so admins can audit historical
--      results without losing them; pruning is left to a future maintenance job.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS web_search_cache (
    query_hash   text        PRIMARY KEY,
    query        text        NOT NULL,
    provider     text        NOT NULL DEFAULT 'exa',
    results      jsonb       NOT NULL,
    fetched_at   timestamptz NOT NULL DEFAULT now()
);

-- Lookup by recency (most-recent-first scans during cache reads).
CREATE INDEX IF NOT EXISTS web_search_cache_fetched_at_idx
    ON web_search_cache (fetched_at DESC);

-- Service-role only. The route handler uses the service-role key (mirrors the
-- pattern already used by /api/memo for personalization reads), so a permissive
-- RLS policy is unnecessary; we simply leave RLS disabled.
ALTER TABLE web_search_cache DISABLE ROW LEVEL SECURITY;
