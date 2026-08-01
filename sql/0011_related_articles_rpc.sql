-- 0011: related_articles RPC — nearest-neighbor articles for a given article.
--
-- Powers the dashboard hero's "In this thread" row. Takes an article id,
-- looks up that article's STORED embedding in content_embeddings (no
-- re-embedding, zero embedding-API cost), and returns the top-N nearest
-- article neighbors by cosine distance, excluding the article itself.
--
-- SECURITY DEFINER so the anon/authenticated web clients can call it even
-- though content_embeddings itself is not exposed to them; the function
-- returns only (article id, similarity) pairs, never embedding vectors or
-- content_text. search_path is pinned per SECURITY DEFINER hygiene.
--
-- Apply by hand in the Supabase SQL editor (agents do not apply migrations).

CREATE OR REPLACE FUNCTION related_articles(
  p_article_id uuid,
  p_count int DEFAULT 3
)
RETURNS TABLE (
  article_id uuid,
  similarity float
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    ce2.content_id AS article_id,
    1 - (ce2.embedding <=> ce1.embedding) AS similarity
  FROM content_embeddings ce1
  JOIN content_embeddings ce2
    ON ce2.content_type = 'article'
   AND ce2.content_id <> ce1.content_id
  WHERE ce1.content_type = 'article'
    AND ce1.content_id = p_article_id
  ORDER BY ce2.embedding <=> ce1.embedding
  LIMIT LEAST(GREATEST(p_count, 1), 12);
$$;

GRANT EXECUTE ON FUNCTION related_articles(uuid, int) TO anon, authenticated;
