"""Shared evidence-fetching utilities for outcome graders."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Optional

from supabase import Client

logger = logging.getLogger(__name__)

_ARTICLE_COLUMNS = (
    "id, title, source, summary, sentiment, published_at, companies, sector"
)


def fetch_subsequent_articles(
    sb: Client,
    *,
    ticker: Optional[str] = None,
    sector: Optional[str] = None,
    after: datetime,
    before: datetime,
    limit: int = 15,
) -> list[dict]:
    """Articles published between after/before, filtered by ticker or sector."""
    try:
        query = (
            sb.table("articles")
            .select(_ARTICLE_COLUMNS)
            .gte("published_at", after.isoformat())
            .lte("published_at", before.isoformat())
            .order("published_at", desc=True)
            .limit(limit)
        )
        if ticker:
            query = query.contains("companies", [ticker])
        elif sector:
            query = query.eq("sector", sector)
        else:
            return []
        resp = query.execute()
        return resp.data or []
    except Exception as e:
        logger.error("evidence: fetch_subsequent_articles failed: %s", e)
        return []


def fetch_user_feedback_for_output(sb: Client, output_id: str) -> Optional[dict]:
    """Returns aggregated feedback for an output: thumbs, dwell, exported, shared."""
    try:
        resp = (
            sb.table("output_user_feedback")
            .select("thumbs, dwell_seconds, scroll_depth, exported, shared")
            .eq("output_id", output_id)
            .execute()
        )
        rows = resp.data or []
        if not rows:
            return None
        thumbs_up = sum(1 for r in rows if r.get("thumbs") == "up")
        thumbs_down = sum(1 for r in rows if r.get("thumbs") == "down")
        dwells = [r["dwell_seconds"] for r in rows if r.get("dwell_seconds")]
        return {
            "thumbs_up": thumbs_up,
            "thumbs_down": thumbs_down,
            "avg_dwell_seconds": round(sum(dwells) / len(dwells), 1) if dwells else None,
            "exported": any(r.get("exported") for r in rows),
            "shared": any(r.get("shared") for r in rows),
            "feedback_count": len(rows),
        }
    except Exception as e:
        logger.error("evidence: fetch_user_feedback failed for %s: %s", output_id, e)
        return None


def build_evidence_context(
    *,
    output: dict,
    window_days: int,
    articles: list[dict],
    price_data: Optional[dict] = None,
    user_feedback: Optional[dict] = None,
) -> dict:
    """Build the evidence_data jsonb payload to store with the grade."""
    return {
        "window_days": window_days,
        "article_count": len(articles),
        "article_ids": [a["id"] for a in articles if a.get("id")],
        "price_data": price_data,
        "user_feedback": user_feedback,
    }


def extract_ticker_from_output(output: dict) -> Optional[str]:
    """Try to extract a stock ticker from output content or generation_context."""
    content = output.get("content") or {}
    ctx = output.get("generation_context") or {}
    return (
        content.get("ticker")
        or content.get("target_company")
        or ctx.get("ticker")
        or None
    )


def extract_sector_from_output(output: dict) -> Optional[str]:
    """Try to extract a sector from output content or generation_context."""
    content = output.get("content") or {}
    ctx = output.get("generation_context") or {}
    return content.get("sector") or content.get("target_sector") or ctx.get("sector") or None


def parse_created_at(output: dict) -> datetime:
    """Parse created_at from an output row, return as UTC datetime."""
    raw = output.get("created_at", "")
    if isinstance(raw, datetime):
        return raw
    try:
        # Handle both timezone-aware and naive formats
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        return datetime.fromisoformat(raw)
    except Exception:
        return datetime.now()
