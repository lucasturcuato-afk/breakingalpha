"""
embedding_job.py — BreakingAlpha
Embeds articles and theses into content_embeddings for RAG retrieval.
Uses Gemini embedding API + pgvector.
"""

import os
import time
from supabase import create_client
from google import genai

supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])
gemini_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

EMBEDDING_MODEL = "gemini-embedding-001"
BATCH_SIZE = 20
MAX_ITEMS_PER_RUN = 200
SLEEP_BETWEEN_BATCHES = 0.5
TEXT_TRUNCATE_LIMIT = 2000

EMBEDDINGS_DDL = """\
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS content_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type text NOT NULL CHECK (content_type IN ('article', 'thesis')),
  content_id uuid NOT NULL,
  embedding vector(768) NOT NULL,
  embedded_at timestamptz DEFAULT now(),
  UNIQUE(content_type, content_id)
);

CREATE INDEX IF NOT EXISTS content_embeddings_type_idx ON content_embeddings(content_type);
"""


def _fetch_unembedded_articles(limit: int) -> list[dict]:
    """Fetch articles that don't yet have embeddings."""
    existing = (
        supabase.table("content_embeddings")
        .select("content_id")
        .eq("content_type", "article")
        .execute()
    )
    existing_ids = [r["content_id"] for r in existing.data]

    query = supabase.table("articles").select("id, title, summary")
    if existing_ids:
        query = query.not_.in_("id", existing_ids)
    result = query.limit(limit).execute()
    return result.data


def _fetch_unembedded_theses(limit: int) -> list[dict]:
    """Fetch theses that don't yet have embeddings."""
    existing = (
        supabase.table("content_embeddings")
        .select("content_id")
        .eq("content_type", "thesis")
        .execute()
    )
    existing_ids = [r["content_id"] for r in existing.data]

    query = supabase.table("theses").select("id, title, rationale")
    if existing_ids:
        query = query.not_.in_("id", existing_ids)
    result = query.limit(limit).execute()
    return result.data


def _build_text(row: dict, content_type: str) -> str:
    """Build the text to embed, truncated to TEXT_TRUNCATE_LIMIT chars."""
    title = row.get("title") or ""
    if content_type == "article":
        body = row.get("summary") or ""
    else:
        body = row.get("rationale") or ""
    text = f"{title}\n{body}"
    return text[:TEXT_TRUNCATE_LIMIT]


def _embed_text(text: str) -> list[float] | None:
    """Call Gemini embedding API. Returns 768-dim vector or None on failure."""
    try:
        response = gemini_client.models.embed_content(
            model=EMBEDDING_MODEL,
            contents=text,
            config={"output_dimensionality": 768},
        )
        return response.embeddings[0].values
    except Exception as e:
        print(f"  ⚠️  Embedding API error: {e}")
        return None


def _store_embedding(content_type: str, content_id: str, embedding: list[float]):
    """Insert a row into content_embeddings."""
    supabase.table("content_embeddings").insert(
        {
            "content_type": content_type,
            "content_id": content_id,
            "embedding": embedding,
        }
    ).execute()


def _process_batch(items: list[dict], content_type: str) -> int:
    """Embed and store a batch of items. Returns count of successful embeddings."""
    success = 0
    for row in items:
        text = _build_text(row, content_type)
        embedding = _embed_text(text)
        if embedding is None:
            continue
        try:
            _store_embedding(content_type, row["id"], embedding)
            success += 1
        except Exception as e:
            print(f"  ⚠️  Insert error for {content_type} {row['id']}: {e}")
    return success


def main():
    print("🔢 embedding_job — starting")

    total_embedded = 0

    # --- Articles ---
    try:
        articles = _fetch_unembedded_articles(MAX_ITEMS_PER_RUN)
        print(f"📄 Found {len(articles)} unembedded articles")
    except Exception as e:
        print(f"⚠️  Failed to fetch articles: {e}")
        articles = []

    for i in range(0, len(articles), BATCH_SIZE):
        batch = articles[i : i + BATCH_SIZE]
        try:
            count = _process_batch(batch, "article")
            total_embedded += count
            print(f"  ✅ Batch {i // BATCH_SIZE + 1}: embedded {count}/{len(batch)} articles")
        except Exception as e:
            print(f"  ⚠️  Batch error (articles): {e}")
        if i + BATCH_SIZE < len(articles):
            time.sleep(SLEEP_BETWEEN_BATCHES)

    # --- Theses ---
    remaining = MAX_ITEMS_PER_RUN - len(articles)
    if remaining <= 0:
        remaining = 0

    try:
        theses = _fetch_unembedded_theses(remaining) if remaining > 0 else []
        print(f"🧠 Found {len(theses)} unembedded theses")
    except Exception as e:
        print(f"⚠️  Failed to fetch theses: {e}")
        theses = []

    for i in range(0, len(theses), BATCH_SIZE):
        batch = theses[i : i + BATCH_SIZE]
        try:
            count = _process_batch(batch, "thesis")
            total_embedded += count
            print(f"  ✅ Batch {i // BATCH_SIZE + 1}: embedded {count}/{len(batch)} theses")
        except Exception as e:
            print(f"  ⚠️  Batch error (theses): {e}")
        if i + BATCH_SIZE < len(theses):
            time.sleep(SLEEP_BETWEEN_BATCHES)

    print(f"🔢 embedding_job — done ({total_embedded} total embeddings)")


if __name__ == "__main__":
    main()
