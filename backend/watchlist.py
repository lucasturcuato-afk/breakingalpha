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
