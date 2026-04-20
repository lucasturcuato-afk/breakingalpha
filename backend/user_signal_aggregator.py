"""
user_signal_aggregator.py — BreakingAlpha pipeline step.

Aggregates user behavioral events from the last 30 days into a compact
per-user signal digest. This digest is consumed by synthesize.py to bias
thesis generation toward sectors and tickers users actually engage with.

Table: user_signal_digest
  - user_id (uuid, PK)
  - top_sectors (jsonb)         — [{sector, score, events}] ranked
  - top_tickers (jsonb)         — [{ticker, score, events}] ranked
  - preferred_memo_types (jsonb) — [{type, count}] ranked
  - engagement_level (text)     — "high" | "medium" | "low"
  - event_count (int)
  - computed_at (timestamptz)

Runs as a soft-fail step in run.py before synthesize.
"""

import logging
import os
from collections import defaultdict
from datetime import datetime, timezone, timedelta

from supabase import create_client

logger = logging.getLogger("user_signal_aggregator")

supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])

# Event weights: positive engagement scores higher than passive views.
EVENT_WEIGHTS = {
    "thesis_approved": 3.0,
    "memo_generated": 2.0,
    "watchlist_added": 2.5,
    "thesis_viewed": 1.0,
    "pattern_clicked": 1.5,
    "sector_filter_applied": 1.0,
    "morning_brief_opened": 0.5,
    "evening_wrap_opened": 0.5,
    "thesis_dismissed": -1.0,
    "watchlist_removed": -1.5,
}

LOOKBACK_DAYS = 30


def _fetch_events(cutoff_iso: str) -> list[dict]:
    """Fetch all user_events since cutoff. Soft-fails to []."""
    try:
        resp = (
            supabase.table("user_events")
            .select("user_id, event_type, payload, created_at")
            .gte("created_at", cutoff_iso)
            .order("created_at", desc=True)
            .limit(5000)
            .execute()
        )
        return resp.data or []
    except Exception as e:
        logger.warning("fetch user_events failed: %s", e)
        return []


def _extract_sector(payload: dict) -> str | None:
    """Extract sector from event payload if present."""
    if not payload or not isinstance(payload, dict):
        return None
    # Various payload shapes store sector differently
    return (
        payload.get("sector")
        or payload.get("thesis_sector")
        or payload.get("sectors", [None])[0]
        if isinstance(payload.get("sectors"), list)
        else None
    )


def _extract_ticker(payload: dict) -> str | None:
    """Extract ticker from event payload if present."""
    if not payload or not isinstance(payload, dict):
        return None
    return payload.get("ticker") or payload.get("identifier") or None


def _classify_engagement(event_count: int) -> str:
    """Classify engagement level based on raw event count over 30 days."""
    if event_count >= 50:
        return "high"
    if event_count >= 15:
        return "medium"
    return "low"


def aggregate_user_signals() -> dict[str, dict]:
    """
    Aggregate last 30 days of user_events into per-user signal digests.
    Returns {user_id: digest_dict}.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)).isoformat()
    events = _fetch_events(cutoff)

    if not events:
        logger.info("No user events in last %d days — nothing to aggregate.", LOOKBACK_DAYS)
        return {}

    # Group by user
    by_user: dict[str, list[dict]] = defaultdict(list)
    for ev in events:
        uid = ev.get("user_id")
        if uid:
            by_user[uid].append(ev)

    digests = {}
    for uid, user_events in by_user.items():
        sector_scores: dict[str, float] = defaultdict(float)
        sector_counts: dict[str, int] = defaultdict(int)
        ticker_scores: dict[str, float] = defaultdict(float)
        ticker_counts: dict[str, int] = defaultdict(int)
        memo_types: dict[str, int] = defaultdict(int)

        for ev in user_events:
            etype = ev.get("event_type", "")
            weight = EVENT_WEIGHTS.get(etype, 0.5)
            payload = ev.get("payload") or {}
            if isinstance(payload, str):
                try:
                    import json
                    payload = json.loads(payload)
                except Exception:
                    payload = {}

            sector = _extract_sector(payload)
            if sector:
                sector_scores[sector] += weight
                sector_counts[sector] += 1

            ticker = _extract_ticker(payload)
            if ticker:
                ticker_scores[ticker] += weight
                ticker_counts[ticker] += 1

            if etype == "memo_generated":
                memo_type = payload.get("memo_type", "unknown")
                memo_types[memo_type] += 1

        # Build ranked lists
        top_sectors = sorted(
            [
                {"sector": s, "score": round(sector_scores[s], 2), "events": sector_counts[s]}
                for s in sector_scores
            ],
            key=lambda x: -x["score"],
        )[:10]

        top_tickers = sorted(
            [
                {"ticker": t, "score": round(ticker_scores[t], 2), "events": ticker_counts[t]}
                for t in ticker_scores
            ],
            key=lambda x: -x["score"],
        )[:10]

        preferred_memo = sorted(
            [{"type": t, "count": c} for t, c in memo_types.items()],
            key=lambda x: -x["count"],
        )

        digests[uid] = {
            "user_id": uid,
            "top_sectors": top_sectors,
            "top_tickers": top_tickers,
            "preferred_memo_types": preferred_memo,
            "engagement_level": _classify_engagement(len(user_events)),
            "event_count": len(user_events),
            "computed_at": datetime.now(timezone.utc).isoformat(),
        }

    return digests


def _upsert_digests(digests: dict[str, dict]) -> int:
    """Write digests to user_signal_digest table. Returns count written."""
    import json

    written = 0
    for uid, d in digests.items():
        row = {
            "user_id": uid,
            "top_sectors": json.dumps(d["top_sectors"]),
            "top_tickers": json.dumps(d["top_tickers"]),
            "preferred_memo_types": json.dumps(d["preferred_memo_types"]),
            "engagement_level": d["engagement_level"],
            "event_count": d["event_count"],
            "computed_at": d["computed_at"],
        }
        try:
            supabase.table("user_signal_digest").upsert(
                row, on_conflict="user_id"
            ).execute()
            written += 1
        except Exception as e:
            logger.warning("upsert user_signal_digest for %s failed: %s", uid, e)
    return written


def main() -> None:
    """Pipeline entrypoint. Aggregate signals and persist to user_signal_digest."""
    print("📊 Aggregating user behavioral signals...")

    digests = aggregate_user_signals()
    if not digests:
        print("  (no user events to aggregate)")
        return

    written = _upsert_digests(digests)
    print(f"  ✅ Aggregated signals for {written}/{len(digests)} user(s)")

    # Log top engagement
    for uid, d in digests.items():
        top_s = ", ".join(s["sector"] for s in d["top_sectors"][:3]) or "none"
        top_t = ", ".join(t["ticker"] for t in d["top_tickers"][:3]) or "none"
        print(f"    {uid[:8]}… | {d['engagement_level']} | sectors: {top_s} | tickers: {top_t}")


if __name__ == "__main__":
    main()
