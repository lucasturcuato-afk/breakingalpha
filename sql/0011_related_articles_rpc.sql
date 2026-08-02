-- 0011: related_articles RPC — nearest-neighbor articles for a given article.
--
-- Powers the dashboard hero's "In this thread" row. Takes an article id,
-- looks up that article's STORED embedding in content_embeddings (no
-- re-embedding, zero embedding-API cost), and returns the top-N nearest
-- article neighbors by cosine distance, excluding the article itself.
--
-- v2 NOTE (re-apply over v1): the first version used a single SQL self-join,
-- which prevents the planner from using a vector index (the comparison vector
-- is not a plan-time constant) and full-scans 50k+ embeddings -- observed
-- "canceling statement due to statement timeout" through PostgREST. This
-- version fetches the anchor vector into a plpgsql variable first, so the
-- ORDER BY embedding <=> v LIMIT k form is index-assisted, and ships an HNSW
-- index to serve it.
--
-- SECURITY DEFINER so the anon/authenticated web clients can call it even
-- though content_embeddings itself is not exposed to them; the function
-- returns only (article id, similarity) pairs, never embedding vectors or
-- content_text. search_path is pinned per SECURITY DEFINER hygiene.
--
-- Apply by hand in the Supabase SQL editor (agents do not apply migrations).
-- The index build on ~50k rows takes a moment; run it once.

CREATE INDEX IF NOT EXISTS idx_content_embeddings_article_hnsw
  ON content_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WHERE content_type = 'article';

CREATE OR REPLACE FUNCTION related_articles(
  p_article_id uuid,
  p_count int DEFAULT 3
)
RETURNS TABLE (
  article_id uuid,
  similarity float
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v vector(768);
BEGIN
  SELECT ce.embedding INTO v
  FROM content_embeddings ce
  WHERE ce.content_type = 'article'
    AND ce.content_id = p_article_id
  LIMIT 1;

  IF v IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    ce2.content_id AS article_id,
    1 - (ce2.embedding <=> v) AS similarity
  FROM content_embeddings ce2
  WHERE ce2.content_type = 'article'
    AND ce2.content_id <> p_article_id
  ORDER BY ce2.embedding <=> v
  LIMIT LEAST(GREATEST(p_count, 1), 12);
END;
$$;

GRANT EXECUTE ON FUNCTION related_articles(uuid, int) TO anon, authenticated;
