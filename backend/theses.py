"""
theses.py
CRUD operations for the theses table in Supabase.
Called from frontend API routes for the Thesis Board feature.
"""

import os
from datetime import datetime, timezone
from supabase import create_client

supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])


def list_theses():
    """Return all theses ordered by created_at descending."""
    resp = supabase.table("theses") \
        .select("*") \
        .order("created_at", desc=True) \
        .execute()
    return resp.data or []


def create_thesis(data: dict):
    """
    Insert a new thesis. Required keys: company, thesis_text, bull_bear.
    Optional keys: sector.
    Returns the inserted row.
    """
    row = {
        "company":     data["company"],
        "thesis_text": data["thesis_text"],
        "bull_bear":   data["bull_bear"],
        "sector":      data.get("sector"),
        "created_at":  datetime.now(timezone.utc).isoformat(),
        "updated_at":  datetime.now(timezone.utc).isoformat(),
    }
    resp = supabase.table("theses").insert(row).execute()
    return resp.data[0] if resp.data else None


def update_thesis(thesis_id: str, data: dict):
    """
    Update an existing thesis by id.
    Accepts any subset of: company, thesis_text, bull_bear, sector.
    Returns the updated row.
    """
    allowed = {"company", "thesis_text", "bull_bear", "sector"}
    updates = {k: v for k, v in data.items() if k in allowed}
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()

    resp = supabase.table("theses") \
        .update(updates) \
        .eq("id", thesis_id) \
        .execute()
    return resp.data[0] if resp.data else None


def delete_thesis(thesis_id: str):
    """
    Delete a thesis by id.
    Returns the deleted row.
    """
    resp = supabase.table("theses") \
        .delete() \
        .eq("id", thesis_id) \
        .execute()
    return resp.data[0] if resp.data else None
