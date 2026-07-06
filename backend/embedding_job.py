"""
embedding_job.py — BreakingAlpha
Embeds articles and theses into content_embeddings for RAG retrieval.
Uses Gemini embedding API + pgvector.
"""
from __future__ import annotations

import os
import time
from datetime import datetime, timedelta, timezone
from supabase import create_client
from google import genai

supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])
gemini_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

EMBEDDING_MODEL = "gemini-embedding-001"
BATCH_SIZE = 20
MAX_ITEMS_PER_RUN = 200
SLEEP_BETWEEN_BATCHES = 0.5
TEXT_TRUNCATE_LIMIT = 2000

# Priority tier: the set Radar actually clusters (the deduped union of per-follow
# displayed lists, radar-following.ts PER_FOLLOW_LIMIT=8) plus Calls evidence, so
# the embed budget covers it before the newest-first tail. See the recon: today
# the tier is ~18 to 24 articles, well under MAX_ITEMS_PER_RUN.
PRIORITY_WINDOW_DAYS = 7          # taxonomy/keyword follow window (radar-following.ts)
PRIORITY_CALLS_WINDOW_DAYS = 14   # Calls-derived follows (calls/page.tsx matchFollow(...,14))
# Over-fetch 12 not 8 per follow: Radar's per-follow selection orders published_at
# desc with NO id tiebreak, so at gnews timestamp ties the 8th displayed article
# flickers run-to-run; top-12 guarantees the displayed 8 are covered regardless.
PRIORITY_PER_FOLLOW = 12

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


# PostgREST returns at most 1000 rows per request; we paginate with .range().
_PAGE_SIZE = 1000


def _embedded_content_ids(content_type: str) -> set:
    """Full set of already-embedded content_ids for a content_type.

    Paginated: the prior single .select() silently capped at PostgREST's
    1000-row default, so once >1000 items were embedded the exclusion set was
    incomplete and embedded items got re-embedded.
    """
    ids: set = set()
    page = 0
    while True:
        rows = (
            supabase.table("content_embeddings")
            .select("content_id")
            .eq("content_type", content_type)
            .range(page * _PAGE_SIZE, page * _PAGE_SIZE + _PAGE_SIZE - 1)
            .execute()
            .data
            or []
        )
        for r in rows:
            cid = r.get("content_id")
            if cid:
                ids.add(cid)
        if len(rows) < _PAGE_SIZE:
            return ids
        page += 1


# --- Priority tier: the Radar-clustered + Calls set, embedded FIRST -----------
# We replicate the radar-following.ts matcher predicates in SQL (no dependency on
# the TS module): taxonomy jsonb-containment, keyword ILIKE with the len>=6
# title-leg gate. The topic SEMANTIC leg is intentionally skipped (it needs
# article embeddings, the chicken-and-egg this job breaks); the keyword
# complement is covered, so purely-semantic-no-keyword topic matches are
# best-effort (picked up by the newest-first fill over time).
#
# follows and user_claims are owner-scoped RLS, so the module's anon client reads
# ZERO rows from them. The priority reads therefore use the service-role client
# (bypasses RLS). If the service key is absent the whole tier soft-fails to [] and
# the run degrades to today's newest-first behavior.

_PRIORITY_CLIENT = None


def _priority_client():
    global _PRIORITY_CLIENT
    if _PRIORITY_CLIENT is None:
        from supabase_client import get_service_client
        _PRIORITY_CLIENT = get_service_client()
    return _PRIORITY_CLIENT


def _since_iso(days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


def _safe_ilike_term(term: str) -> str:
    """Mirror radar-following.ts safeIlikeTerm: strip chars that break the
    PostgREST .or() grammar."""
    out = term or ""
    for ch in ",()%":
        out = out.replace(ch, "")
    return out.strip()


def _keyword_or_filter(keywords: list[str]) -> str | None:
    """Mirror radar-following.ts keywordOrFilter: primary_company always, title
    only when the term is >= 6 chars."""
    conditions: list[str] = []
    for kw in keywords:
        safe = _safe_ilike_term(kw)
        if not safe:
            continue
        conditions.append(f"primary_company.ilike.%{safe}%")
        if len(safe) >= 6:
            conditions.append(f"title.ilike.%{safe}%")
    return ",".join(conditions) if conditions else None


def _taxonomy_match_ids(sc, column: str, value: str, days: int) -> list[str]:
    """articles.<column> @> ["value"] (jsonb containment), newest-first, limited.
    Mirrors radar-following.ts matchTaxonomy."""
    try:
        rows = (
            sc.table("articles")
            .select("id")
            .filter(column, "cs", f'["{value}"]')
            .gte("published_at", _since_iso(days))
            .order("published_at", desc=True)
            .limit(PRIORITY_PER_FOLLOW)
            .execute()
            .data
            or []
        )
        return [r["id"] for r in rows if r.get("id")]
    except Exception as e:
        print(f"  ⚠️  priority taxonomy match failed ({column}={value}): {e}")
        return []


def _keyword_match_ids(sc, keywords: list[str], days: int) -> list[str]:
    """primary_company/title ILIKE, newest-first, limited. Mirrors matchKeywords."""
    or_filter = _keyword_or_filter(keywords)
    if not or_filter:
        return []
    try:
        rows = (
            sc.table("articles")
            .select("id")
            .or_(or_filter)
            .gte("published_at", _since_iso(days))
            .order("published_at", desc=True)
            .limit(PRIORITY_PER_FOLLOW)
            .execute()
            .data
            or []
        )
        return [r["id"] for r in rows if r.get("id")]
    except Exception as e:
        print(f"  ⚠️  priority keyword match failed ({keywords}): {e}")
        return []


def _priority_article_ids() -> list[str]:
    """Deduped article ids Radar clusters (per-follow union) plus Calls
    (user_claims target symbols, 14 days). Raises only on a total failure (no
    client); per-follow failures degrade to nothing for that follow."""
    sc = _priority_client()
    ids: list[str] = []
    seen: set[str] = set()

    def add(new_ids: list[str]):
        for i in new_ids:
            if i and i not in seen:
                seen.add(i)
                ids.append(i)

    follows = (
        sc.table("follows")
        .select("follow_type, target, display_name, matched_keywords")
        .eq("muted", False)
        .execute()
        .data
        or []
    )
    for f in follows:
        ftype = f.get("follow_type")
        target = f.get("target") or ""
        if ftype == "industry":
            add(_taxonomy_match_ids(sc, "industry_verticals", target, PRIORITY_WINDOW_DAYS))
        elif ftype == "activity":
            add(_taxonomy_match_ids(sc, "activity_types", target, PRIORITY_WINDOW_DAYS))
        elif ftype in ("ticker", "company"):
            kws = f.get("matched_keywords") or [f.get("display_name") or target]
            add(_keyword_match_ids(sc, kws, PRIORITY_WINDOW_DAYS))
        elif ftype == "topic":
            # keyword complement only; semantic RPC leg needs embeddings (skipped)
            kws = [target] + (f.get("matched_keywords") or [])
            add(_keyword_match_ids(sc, kws, PRIORITY_WINDOW_DAYS))

    # Calls: user_claims -> synthetic company follow on target_symbol at 14 days
    # (calls/page.tsx). Best-effort; skip cleanly if the table is absent.
    try:
        claims = (
            sc.table("user_claims")
            .select("target_symbol, user_claim, status")
            .neq("status", "archived")
            .execute()
            .data
            or []
        )
        for c in claims:
            kw = c.get("target_symbol") or c.get("user_claim") or ""
            if kw:
                add(_keyword_match_ids(sc, [kw], PRIORITY_CALLS_WINDOW_DAYS))
    except Exception as e:
        print(f"  ⚠️  priority Calls (user_claims) leg skipped: {e}")

    return ids


def _fetch_priority_unembedded(embedded: set, limit: int) -> list[dict]:
    """Priority article rows (id, title, summary) not yet embedded, up to limit.
    Soft-fails to [] so a priority-computation error (including a missing service
    key) degrades to today's newest-first behavior instead of crashing."""
    try:
        pri_ids = [i for i in _priority_article_ids() if i not in embedded][:limit]
        if not pri_ids:
            return []
        sc = _priority_client()
        out: list[dict] = []
        for j in range(0, len(pri_ids), 100):
            chunk = pri_ids[j : j + 100]
            rows = (
                sc.table("articles")
                .select("id, title, summary")
                .in_("id", chunk)
                .execute()
                .data
                or []
            )
            out.extend(rows)
        return out
    except Exception as e:
        print(f"  ⚠️  priority tier computation failed; falling back to newest-first: {e}")
        return []


def _fetch_unembedded(content_table: str, content_type: str, select_cols: str,
                      order_col: str, limit: int, embedded: set | None = None) -> list[dict]:
    """Return up to `limit` rows from `content_table` not yet embedded.

    Filters against the embedded-id set IN MEMORY instead of a
    not.in.(<ids>) URL filter. That exclusion list grew to ~800 ids and
    overflowed the proxy URL limit (raw 400), so embedding_job silently embedded
    nothing in pipeline run #142. (Chunking a not.in. list is not an option:
    each chunk would only exclude its own slice, re-embedding everything.) Pages
    newest-first so freshly ingested content is embedded first and the scan
    stays bounded -- the newest page is almost always already unembedded.

    The order has a stable `id` tiebreaker: `order_col` alone is not a total
    order (gnews batch-inserts share near-identical ingested_at), so ties at a
    .range() page boundary are non-deterministic across requests -- a row can
    appear on two adjacent pages (duplicate embed) or fall between them (skipped
    forever). A backfill on the no-tiebreaker version produced ~262 duplicate
    embeddings and ~262 skips; adding `id` makes pagination exact.
    """
    if embedded is None:
        embedded = _embedded_content_ids(content_type)
    out: list[dict] = []
    page = 0
    while len(out) < limit:
        rows = (
            supabase.table(content_table)
            .select(select_cols)
            .order(order_col, desc=True)
            .order("id", desc=True)
            .range(page * _PAGE_SIZE, page * _PAGE_SIZE + _PAGE_SIZE - 1)
            .execute()
            .data
            or []
        )
        if not rows:
            break
        for r in rows:
            if r["id"] not in embedded:
                out.append(r)
                if len(out) >= limit:
                    break
        if len(rows) < _PAGE_SIZE:
            break
        page += 1
    return out


def _fetch_unembedded_articles(limit: int, embedded: set | None = None) -> list[dict]:
    """Fetch articles that don't yet have embeddings (newest-first, bounded)."""
    return _fetch_unembedded("articles", "article", "id, title, summary", "ingested_at", limit, embedded)


def _fetch_unembedded_theses(limit: int) -> list[dict]:
    """Fetch theses that don't yet have embeddings (newest-first, bounded)."""
    return _fetch_unembedded("theses", "thesis", "id, title, rationale", "generated_at", limit)


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


def _store_embedding(content_type: str, content_id: str, embedding: list[float], content_text: str):
    """Insert a row into content_embeddings."""
    supabase.table("content_embeddings").insert(
        {
            "content_type": content_type,
            "content_id": content_id,
            "embedding": embedding,
            "content_text": content_text,
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
            _store_embedding(content_type, row["id"], embedding, text)
            success += 1
        except Exception as e:
            print(f"  ⚠️  Insert error for {content_type} {row['id']}: {e}")
    return success


def main():
    print("🔢 embedding_job — starting")

    total_embedded = 0

    # --- Articles: priority tier FIRST, then newest-first fill ---
    try:
        embedded_ids = _embedded_content_ids("article")
    except Exception as e:
        print(f"⚠️  Failed to load embedded id set: {e}")
        embedded_ids = set()

    # Priority tier (Radar-clustered + Calls set). Soft-fails to [] so the run
    # degrades to today's newest-first behavior, never crashes or embeds nothing.
    priority = _fetch_priority_unembedded(embedded_ids, MAX_ITEMS_PER_RUN)
    priority_id_set = {r["id"] for r in priority}
    print(f"⭐ Priority tier: {len(priority)} unembedded Radar/Calls articles (embedded first)")

    newest: list[dict] = []
    remaining = MAX_ITEMS_PER_RUN - len(priority)
    if remaining > 0:
        try:
            newest = _fetch_unembedded_articles(remaining, embedded=embedded_ids)
        except Exception as e:
            print(f"⚠️  Failed to fetch newest-first articles: {e}")
            newest = []
        # A priority article can also be newest; do not embed it twice.
        newest = [r for r in newest if r["id"] not in priority_id_set]

    articles = (priority + newest)[:MAX_ITEMS_PER_RUN]
    print(f"📄 Embedding {len(articles)} articles ({len(priority)} priority + {len(articles) - len(priority)} newest-fill)")

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
