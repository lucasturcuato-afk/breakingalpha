"""
watchlist.py
CRUD operations for the watchlist table in Supabase.
Called from frontend API routes for the Watchlist feature.
"""

import os
from datetime import datetime, timezone
from supabase import create_client

supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])


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

    query = supabase.table("articles").select("id, title, summary, companies, relevance_score")
    if article_ids:
        query = query.in_("id", article_ids)
    articles = query.execute().data or []

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
