"""
pattern_memory.py — Signalera Pattern Library (Phase 3 + Phase 6)

Scans all graded theses (those with a non-null `outcome`) and builds an
aggregate pattern library keyed on
    (sector, horizon, dominant_signal)
so the rest of the pipeline can answer questions like
    "how often do 30d energy theses with a positive analyst_consensus
    confirm?"

The library is upserted into `pattern_library`. Every row carries
`n_observed`, `n_confirmed`, and `win_rate` (confirmed / observed),
rounded to 4 decimal places for Supabase storage.

Phase 6 exposes `query_relevant_patterns()` as a read helper for the
thesis-generation flow to fetch high-win-rate patterns matching a
context (sector + horizon).

Wired into `backend/run.py` as a soft-fail step after `thesis_grader`.
"""

from __future__ import annotations

import os
import json
import logging
from collections import defaultdict
from datetime import datetime, timezone

from supabase import create_client


logger = logging.getLogger(__name__)


supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])


# ==========================================================================
# DDL — paste into Supabase SQL editor ONCE before this module runs
# ==========================================================================
PATTERN_LIBRARY_DDL = """
-- Signalera pattern library
-- Run ONCE in the Supabase SQL editor. Safe to re-run (IF NOT EXISTS).

create table if not exists pattern_library (
    id             uuid        primary key default gen_random_uuid(),
    pattern_key    text        not null unique,
    sector         text,
    horizon        text,
    dominant_signal text,
    signal_profile jsonb,
    n_observed     int         not null default 0,
    n_confirmed    int         not null default 0,
    n_invalidated  int         not null default 0,
    win_rate       numeric     not null default 0,
    last_updated   timestamptz not null default now()
);

create index if not exists pattern_library_win_rate_idx
    on pattern_library (win_rate desc);
create index if not exists pattern_library_sector_horizon_idx
    on pattern_library (sector, horizon);

alter table pattern_library enable row level security;
create policy "Public read"   on pattern_library for select using (true);
create policy "Public insert" on pattern_library for insert with check (true);
create policy "Public update" on pattern_library for update using (true);
"""


# ==========================================================================
# Helpers
# ==========================================================================

def _r4(v):
    """Round a float to 4dp for Supabase storage; pass through None."""
    if v is None:
        return None
    try:
        return round(float(v), 4)
    except Exception:
        return None


def _preflight_schema() -> bool:
    """Verify pattern_library exists. Logs DDL on miss and returns False."""
    try:
        supabase.table("pattern_library").select("pattern_key").limit(1).execute()
        return True
    except Exception as e:
        logger.error(
            "pattern_memory: pattern_library table missing (%s). "
            "RUN THIS IN SUPABASE SQL EDITOR:\n%s",
            e, PATTERN_LIBRARY_DDL,
        )
        return False


def _normalize_horizon(h) -> str:
    if isinstance(h, str) and h in ("7d", "30d", "90d"):
        return h
    return "30d"


def _normalize_sector(s) -> str:
    if isinstance(s, str) and s.strip():
        return s.strip()
    return "Unknown"


def classify_dominant_signal(signal_breakdown: dict | None) -> str:
    """
    Inspect a signal_breakdown dict and return a single label naming the
    strongest signal observed. Rules are intentionally simple so the
    pattern library groups stay interpretable.
    """
    if not isinstance(signal_breakdown, dict):
        return "unknown"

    # Price move dominates if it's big enough to matter
    pcp = signal_breakdown.get("price_change_pct")
    if pcp is not None:
        try:
            if abs(float(pcp)) >= 5.0:
                return "price"
        except Exception:
            pass

    # Earnings surprise next
    es = signal_breakdown.get("earnings_surprise")
    if isinstance(es, dict):
        sp = es.get("surprise_percent")
        if sp is not None:
            try:
                if abs(float(sp)) >= 3.0:
                    return "earnings"
            except Exception:
                pass

    # Analyst consensus direction
    ac = signal_breakdown.get("analyst_consensus")
    if isinstance(ac, dict):
        pos = (ac.get("strong_buy") or 0) + (ac.get("buy") or 0)
        neg = (ac.get("strong_sell") or 0) + (ac.get("sell") or 0)
        if pos or neg:
            if pos >= neg + 2:
                return "analysts_positive"
            if neg >= pos + 2:
                return "analysts_negative"

    # High news velocity
    nv = signal_breakdown.get("news_velocity")
    if nv is not None:
        try:
            if int(nv) >= 10:
                return "news"
        except Exception:
            pass

    return "mixed"


def _make_pattern_key(sector: str, horizon: str, dominant_signal: str) -> str:
    return f"{sector}|{horizon}|{dominant_signal}"


# ==========================================================================
# Aggregation
# ==========================================================================

def aggregate_graded_theses() -> list[dict]:
    """
    Pull all graded theses (outcome IS NOT NULL) and bucket them by
    (sector, horizon, dominant_signal). Returns a list of pattern rows
    ready to upsert.
    """
    resp = (
        supabase.table("theses")
        .select("sector, horizon, outcome, signal_breakdown")
        .not_.is_("outcome", "null")
        .limit(5000)
        .execute()
    )
    rows = resp.data or []

    buckets: dict[tuple[str, str, str], dict] = defaultdict(
        lambda: {"n_observed": 0, "n_confirmed": 0, "n_invalidated": 0,
                 "signal_profile": defaultdict(int)}
    )

    for r in rows:
        sector = _normalize_sector(r.get("sector"))
        horizon = _normalize_horizon(r.get("horizon"))
        sb = r.get("signal_breakdown")
        if isinstance(sb, str):
            try:
                sb = json.loads(sb)
            except Exception:
                sb = None
        dom = classify_dominant_signal(sb)
        key = (sector, horizon, dom)
        b = buckets[key]
        b["n_observed"] += 1
        outcome = (r.get("outcome") or "").lower()
        if outcome == "confirmed":
            b["n_confirmed"] += 1
        elif outcome == "invalidated":
            b["n_invalidated"] += 1
        b["signal_profile"][dom] += 1

    now_iso = datetime.now(timezone.utc).isoformat()
    pattern_rows = []
    for (sector, horizon, dom), b in buckets.items():
        n = b["n_observed"]
        win_rate = (b["n_confirmed"] / n) if n else 0.0
        pattern_rows.append({
            "pattern_key": _make_pattern_key(sector, horizon, dom),
            "sector": sector,
            "horizon": horizon,
            "dominant_signal": dom,
            "signal_profile": dict(b["signal_profile"]),
            "n_observed": n,
            "n_confirmed": b["n_confirmed"],
            "n_invalidated": b["n_invalidated"],
            "win_rate": _r4(win_rate) or 0.0,
            "last_updated": now_iso,
        })
    return pattern_rows


def upsert_patterns(rows: list[dict]) -> int:
    """
    Upsert each row on pattern_key. Uses supabase-py `upsert` with
    on_conflict on the unique `pattern_key` column. Returns the number of
    rows written.
    """
    if not rows:
        return 0
    try:
        supabase.table("pattern_library").upsert(
            rows, on_conflict="pattern_key"
        ).execute()
        return len(rows)
    except Exception as e:
        logger.exception("pattern_memory: upsert failed: %s", e)
        return 0


# ==========================================================================
# Phase 6 — read helpers consumed by the thesis-generation flow
# ==========================================================================

def query_relevant_patterns(
    sector: str | None = None,
    horizon: str | None = None,
    min_n: int = 10,
    limit: int = 5,
) -> list[dict]:
    """
    Return the top-`limit` patterns (ordered by win_rate desc) with at
    least `min_n` observations. When `sector` or `horizon` is provided,
    filter to those values; otherwise return globally top patterns.

    Callers use this to seed thesis generation prompts with pattern
    context: "historically, patterns matching this profile confirm at X%".
    Never raises.
    """
    try:
        q = supabase.table("pattern_library").select(
            "pattern_key, sector, horizon, dominant_signal, "
            "n_observed, n_confirmed, win_rate"
        )
        if sector:
            q = q.eq("sector", sector)
        if horizon:
            q = q.eq("horizon", horizon)
        q = q.gte("n_observed", int(min_n)).order("win_rate", desc=True).limit(int(limit))
        resp = q.execute()
        return resp.data or []
    except Exception as e:
        logger.warning("pattern_memory: query_relevant_patterns failed: %s", e)
        return []


def top_patterns(limit: int = 5, min_n: int = 5) -> list[dict]:
    """Shortcut for the weekly digest — global top-N regardless of sector."""
    return query_relevant_patterns(sector=None, horizon=None, min_n=min_n, limit=limit)


# ==========================================================================
# main()
# ==========================================================================

def main() -> dict | None:
    """
    Aggregate graded theses into the pattern library. Returns a summary
    dict or None on catastrophic failure.
    """
    try:
        if not _preflight_schema():
            return None
        rows = aggregate_graded_theses()
        written = upsert_patterns(rows)
        print(f"  [pattern_memory] aggregated={len(rows)} upserted={written}")
        logger.info("pattern_memory: %d patterns upserted", written)
        return {"patterns_aggregated": len(rows), "patterns_upserted": written}
    except Exception as e:
        logger.exception("pattern_memory.main crashed: %s", e)
        return None


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    main()
