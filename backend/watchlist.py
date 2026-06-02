"""
watchlist.py
CRUD operations for the watchlist table in Supabase.
Called from frontend API routes for the Watchlist feature.
"""

import os
from datetime import datetime, timezone
from supabase import create_client

supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])

# Chunk size for the boost .in_("id", ...) read. Matches the 200-id chunk that
# #301's chunked .in_ read uses in entity_resolver.increment_mention_counts:
# 200 UUIDs keep the GET querystring well under the proxy URL limit. The
# unbatched query overflowed at 1,156 ids (~52 KB URL -> raw 400 'Bad Request')
# in pipeline run #141. Env-overridable, like #301's STORE_CHUNK_SIZE.
WATCHLIST_BOOST_CHUNK = int(os.getenv("WATCHLIST_BOOST_CHUNK", "200"))


def list_watchlist():
    """Return all watchlist entries ordered by created_at descending."""
    resp = supabase.table("watchlist") \
        .select("*") \
        .order("created_at", desc=True) \
        .execute()
    return resp.data or []


def add_to_watchlist(data: dict):
    """
    Insert a new watchlist entry. Required keys: identifier, type.
    type must be 'ticker' or 'company'.
    Returns the inserted row.
    """
    row = {
        "identifier": data["identifier"],
        "type":       data["type"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    resp = supabase.table("watchlist").insert(row).execute()
    return resp.data[0] if resp.data else None


def remove_from_watchlist(entry_id: str):
    """
    Delete a watchlist entry by id.
    Returns the deleted row.
    """
    resp = supabase.table("watchlist") \
        .delete() \
        .eq("id", entry_id) \
        .execute()
    return resp.data[0] if resp.data else None


def clear_watchlist():
    """
    Delete all watchlist entries.
    Returns the list of deleted rows.
    """
    resp = supabase.table("watchlist") \
        .delete() \
        .neq("id", "00000000-0000-0000-0000-000000000000") \
        .execute()
    return resp.data or []


def _fetch_boost_candidates(article_ids):
    """Fetch the candidate article rows for boosting.

    When article_ids is provided, the .in_("id", ...) filter is split into
    batches of WATCHLIST_BOOST_CHUNK so the GET querystring never overflows the
    proxy URL limit (the unbatched query 400'd at 1,156 ids in run #141); the
    batch results are concatenated in input-batch order. When article_ids is
    empty/None the behaviour is unchanged: a single unfiltered query over all
    articles (preserved deliberately -- the caller always passes the stored ids).
    """
    cols = "id, title, summary, companies, relevance_score"
    if not article_ids:
        return supabase.table("articles").select(cols).execute().data or []

    rows = []
    for i in range(0, len(article_ids), WATCHLIST_BOOST_CHUNK):
        chunk = article_ids[i:i + WATCHLIST_BOOST_CHUNK]
        rows.extend(
            supabase.table("articles").select(cols).in_("id", chunk).execute().data or []
        )
    return rows


def boost_watchlist_relevance(article_ids: list = None) -> int:
    """
    For articles whose title, summary, or companies field contains a watchlist
    identifier (case-insensitive), boost relevance_score by 2, capped at 10.
    If article_ids is provided, only consider those articles.
    Returns the count of boosted articles.
    """
    watchlist = list_watchlist()
    if not watchlist:
        return 0

    identifiers = [entry["identifier"].lower() for entry in watchlist]

    articles = _fetch_boost_candidates(article_ids)

    boosted = 0
    for article in articles:
        title = (article.get("title") or "").lower()
        summary = (article.get("summary") or "").lower()
        companies = [c.lower() for c in (article.get("companies") or [])]

        matched = any(
            ident in title or ident in summary or any(ident in c for c in companies)
            for ident in identifiers
        )

        if matched:
            new_score = min(10, (article.get("relevance_score") or 0) + 2)
            supabase.table("articles").update({"relevance_score": new_score}).eq("id", article["id"]).execute()
            boosted += 1

    return boosted
