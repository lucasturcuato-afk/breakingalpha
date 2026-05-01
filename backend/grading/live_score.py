"""
live_score.py — Continuous in-flight thesis grading (Wave 1).

Computes a -100..+100 integer ``live_score`` per thesis from existing data
(no new ingestion sources, no LLM calls). Designed to give Track Record
something meaningful to render the moment the page loads, even when the
terminal grader has not yet produced a ``confirmed``/``invalidated`` verdict.

Five components, each clamped to its own band, summed, then clamped to
[-100, +100]:

    Price alignment       : -50 .. +50   (signal_breakdown.price_change_pct × stance)
    Sentiment alignment   : -25 .. +25   (latest verdicts.weighted_sentiment_alignment × 25)
    Support/contradict    : -15 .. +15   (clamped log of supporting_vs_contradicting_ratio × stance)
    Confidence boost      : -10 ..  10   (verdict-aligned: +c×10 if confirmed, -c×10 if invalidated)
    Time decay            : -10 ..   0   (only when no terminal verdict — older theses pulled toward 0)

Stance direction is derived from ``theses.conviction``:
    BEARISH                  → -1
    BULLISH / HIGH / MEDIUM  → +1
    WATCH / unknown / null   →  0

Derived ``live_verdict`` label:
    terminal "confirmed"  → "Confirmed"
    terminal "invalidated"→ "Invalidated"
    score ≥ +35           → "Tracking confirmed"
    score ≤ -35           → "Tracking invalidated"
    age ≥ horizon &       → "Inconclusive after Nd"
        |score| ≤ 10
    otherwise             → "Tracking neutral"

Run
---
    python -m backend.grading.live_score              # update all theses
    python -m backend.grading.live_score --thesis ID  # one thesis (debug)

Wired into ``backend/cron/daily_grading.py`` after ``thesis_grader.main()``
so the grader and live_score share the same daily 8:10 PM PT pulse.

Soft-fail in every direction. Never crashes the daily pipeline.
"""

from __future__ import annotations

import argparse
import logging
import math
import os
import sys
from datetime import datetime, timezone
from typing import Any

from supabase import create_client


logger = logging.getLogger(__name__)


# ==========================================================================
# Constants
# ==========================================================================

# Per-component bands.
PRICE_BAND = 50          # |price_change_pct| ≥ 10% → saturates the band
SENTIMENT_BAND = 25
RATIO_BAND = 15
CONFIDENCE_BAND = 10
TIME_DECAY_BAND = 10

# Saturation: |price_change_pct (Finnhub dp)| at which we hit ±PRICE_BAND.
# Finnhub returns percent points (e.g. 1.5 = +1.5%).
PRICE_SATURATION_PCT = 10.0

# Horizon → days mapping (mirrors thesis_grader.HORIZON_DAYS).
_HORIZON_DAYS: dict[str, int] = {"7d": 7, "30d": 30, "90d": 90}
_DEFAULT_HORIZON_DAYS = 30

# live_verdict thresholds.
TRACKING_CONFIRMED_AT = 35
TRACKING_INVALIDATED_AT = -35
NEUTRAL_BAND = 10  # |score| ≤ 10 + age past horizon → "Inconclusive after Nd"


# ==========================================================================
# Stance + horizon resolution
# ==========================================================================

def _stance_direction(conviction: Any) -> int:
    """Return +1 / -1 / 0 for the directional sign of the thesis."""
    s = str(conviction or "").strip().upper()
    if s == "BEARISH":
        return -1
    if s in ("BULLISH", "HIGH", "MEDIUM"):
        return +1
    return 0


def _horizon_days(horizon: Any) -> int:
    """Resolve a horizon string to an integer day count (default 30)."""
    s = str(horizon or "").strip().lower()
    return _HORIZON_DAYS.get(s, _DEFAULT_HORIZON_DAYS)


def _parse_dt(value: Any) -> datetime | None:
    """Coerce a possibly-stringified timestamp into a UTC-aware datetime."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        s = str(value).replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _to_float(value: Any) -> float | None:
    """Coerce numeric input to float; return None on failure."""
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _clamp(value: float, lo: float, hi: float) -> float:
    """Clamp a numeric value into [lo, hi]."""
    return max(lo, min(hi, value))


# ==========================================================================
# Component scorers
# ==========================================================================

def _price_component(price_change_pct: Any, stance: int) -> float:
    """Score the price-vs-stance band. Saturates at PRICE_SATURATION_PCT."""
    if stance == 0:
        return 0.0
    pct = _to_float(price_change_pct)
    if pct is None:
        return 0.0
    saturated = _clamp(pct / PRICE_SATURATION_PCT, -1.0, 1.0)
    return saturated * PRICE_BAND * stance


def _sentiment_component(weighted_sentiment_alignment: Any) -> float:
    """Score the supporting-article sentiment alignment band.

    ``weighted_sentiment_alignment`` is already signed by stance direction
    upstream (see grading.features._weighted_sentiment_alignment), and
    clamped roughly to [-1, +1].
    """
    s = _to_float(weighted_sentiment_alignment)
    if s is None:
        return 0.0
    return _clamp(s, -1.0, 1.0) * SENTIMENT_BAND


def _ratio_component(
    supporting_vs_contradicting_ratio: Any,
    stance: int,
) -> float:
    """Score support/contradict ratio in log space, signed by stance."""
    if stance == 0:
        return 0.0
    r = _to_float(supporting_vs_contradicting_ratio)
    if r is None or r <= 0:
        return 0.0
    # log10(1) = 0 (parity), log10(10) = 1 (cap of ratio at 10 in features.py).
    normalized = _clamp(math.log10(r), 0.0, 1.0)
    # Bullish stance (+1): more support than contradict ⇒ +RATIO_BAND.
    # Bearish stance (-1): same support count is a *negative* signal ⇒ -RATIO_BAND.
    return normalized * RATIO_BAND * stance


def _confidence_component(verdict: str | None, confidence: Any) -> float:
    """Apply confidence as a directional kicker for terminal verdicts only."""
    c = _to_float(confidence)
    if c is None:
        return 0.0
    c = _clamp(c, 0.0, 1.0)
    if verdict == "confirmed":
        return c * CONFIDENCE_BAND
    if verdict == "invalidated":
        return -c * CONFIDENCE_BAND
    # Inconclusive / null → no confidence kick (avoids amplifying noise).
    return 0.0


def _time_decay_component(
    generated_at: Any,
    horizon: Any,
    verdict: str | None,
    now: datetime,
) -> float:
    """Pull older un-resolved theses toward zero (negative-only band)."""
    if verdict in ("confirmed", "invalidated"):
        return 0.0
    gen = _parse_dt(generated_at)
    if gen is None:
        return 0.0
    age_days = max(0.0, (now - gen).total_seconds() / 86400.0)
    horizon_days = _horizon_days(horizon)
    if horizon_days <= 0:
        return 0.0
    fraction = _clamp(age_days / horizon_days, 0.0, 1.0)
    return -fraction * TIME_DECAY_BAND


# ==========================================================================
# Public compute
# ==========================================================================

def compute_live_score(
    thesis: dict,
    latest_verdict: dict | None = None,
    now: datetime | None = None,
) -> dict:
    """Compute the live_score for one thesis. Pure / deterministic.

    Inputs are dicts (not pydantic) so this can be called by the grading job,
    one-off backfills, and (transpiled in TS) the Track Record client. Returns
    a dict ``{score, verdict, components, age_days, horizon_days}``.
    """
    now = now or datetime.now(timezone.utc)
    stance = _stance_direction(thesis.get("conviction"))
    signal_breakdown = thesis.get("signal_breakdown") or {}
    if not isinstance(signal_breakdown, dict):
        signal_breakdown = {}

    verdict = (latest_verdict or {}).get("verdict")
    if isinstance(verdict, str):
        verdict = verdict.lower()
    else:
        verdict = thesis.get("outcome")

    components = {
        "price": _price_component(signal_breakdown.get("price_change_pct"), stance),
        "sentiment": _sentiment_component(
            (latest_verdict or {}).get("weighted_sentiment_alignment")
        ),
        "ratio": _ratio_component(
            (latest_verdict or {}).get("supporting_vs_contradicting_ratio"),
            stance,
        ),
        "confidence": _confidence_component(
            verdict if isinstance(verdict, str) else None,
            (latest_verdict or {}).get("confidence"),
        ),
        "time_decay": _time_decay_component(
            thesis.get("generated_at"),
            thesis.get("horizon"),
            verdict if isinstance(verdict, str) else None,
            now,
        ),
    }

    raw = sum(components.values())
    score = int(round(_clamp(raw, -100.0, 100.0)))

    gen = _parse_dt(thesis.get("generated_at"))
    age_days = (now - gen).days if gen else 0
    horizon_days = _horizon_days(thesis.get("horizon"))

    live_verdict = derive_live_verdict(score, verdict, age_days, horizon_days)

    return {
        "score": score,
        "verdict": live_verdict,
        "terminal_verdict": verdict if verdict in ("confirmed", "invalidated") else None,
        "components": components,
        "age_days": age_days,
        "horizon_days": horizon_days,
        "stance": stance,
    }


def derive_live_verdict(
    score: int,
    terminal: str | None,
    age_days: int,
    horizon_days: int,
) -> str:
    """Convert a numeric live_score into a human-readable label."""
    if terminal == "confirmed":
        return "Confirmed"
    if terminal == "invalidated":
        return "Invalidated"
    if score >= TRACKING_CONFIRMED_AT:
        return "Tracking confirmed"
    if score <= TRACKING_INVALIDATED_AT:
        return "Tracking invalidated"
    if age_days >= horizon_days and abs(score) <= NEUTRAL_BAND:
        return f"Inconclusive after {age_days}d"
    return "Tracking neutral"


# ==========================================================================
# Persistence — daily update job
# ==========================================================================

def _build_supabase_client():
    """Create a Supabase client from env (mirrors thesis_grader.py wiring)."""
    return create_client(
        os.environ["SUPABASE_URL"],
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ["SUPABASE_ANON_KEY"],
    )


def _fetch_latest_verdict(supabase: Any, thesis_id: str) -> dict | None:
    """Pull the most recent thesis_verdicts row for a thesis (or None)."""
    try:
        resp = (
            supabase.table("thesis_verdicts")
            .select(
                "verdict, confidence, weighted_sentiment_alignment, "
                "supporting_vs_contradicting_ratio, graded_at"
            )
            .eq("thesis_id", thesis_id)
            .order("graded_at", desc=True)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return rows[0] if rows else None
    except Exception as e:
        logger.warning("live_score: latest verdict fetch failed for %s: %s", thesis_id, e)
        return None


def _persist_score(supabase: Any, thesis_id: str, result: dict, now_iso: str) -> bool:
    """Write live_score / live_verdict / live_score_updated_at; soft-fail."""
    try:
        supabase.table("theses").update(
            {
                "live_score": result["score"],
                "live_verdict": result["verdict"],
                "live_score_updated_at": now_iso,
            }
        ).eq("id", thesis_id).execute()
        return True
    except Exception as e:
        # Most likely failure mode: columns not yet added (DDL not run).
        # We log once per thesis and keep going so the cron stays soft-fail.
        logger.warning(
            "live_score: persist failed for %s: %s "
            "(did you run sql/live_score_columns.sql?)",
            thesis_id, e,
        )
        return False


def update_all_live_scores(
    supabase: Any | None = None,
    only_thesis_id: str | None = None,
) -> dict:
    """Refresh live_score for every non-locked thesis. Returns a summary dict.

    Idempotent. Pure read of ``signal_breakdown`` / latest verdict — never
    changes the terminal ``outcome`` mirror or any column owned by the grader.
    """
    sb = supabase or _build_supabase_client()
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    try:
        query = sb.table("theses").select(
            "id, conviction, horizon, generated_at, signal_breakdown, outcome"
        )
        if only_thesis_id:
            query = query.eq("id", only_thesis_id)
        resp = query.limit(500).execute()
        theses = resp.data or []
    except Exception as e:
        logger.exception("live_score: theses fetch failed: %s", e)
        return {"updated": 0, "skipped": 0, "failed": 1, "error": str(e)}

    updated = 0
    skipped = 0
    failed = 0
    distribution: dict[str, int] = {}

    for t in theses:
        tid = t.get("id")
        if not tid:
            skipped += 1
            continue
        latest = _fetch_latest_verdict(sb, tid)
        result = compute_live_score(t, latest, now=now)
        label = result["verdict"]
        distribution[label] = distribution.get(label, 0) + 1
        if _persist_score(sb, tid, result, now_iso):
            updated += 1
        else:
            failed += 1

    summary = {
        "updated": updated,
        "skipped": skipped,
        "failed": failed,
        "distribution": distribution,
    }
    print(f"  [live_score] {summary}")
    logger.info("live_score: %s", summary)
    return summary


def main(only_thesis_id: str | None = None) -> dict:
    """CLI entry point — refresh every thesis (or one for debugging)."""
    return update_all_live_scores(only_thesis_id=only_thesis_id)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser(
        description="Refresh continuous live_score for all theses."
    )
    parser.add_argument(
        "--thesis",
        dest="thesis_id",
        default=None,
        help="Recompute one thesis only (debug).",
    )
    args = parser.parse_args()
    summary = main(only_thesis_id=args.thesis_id)
    sys.exit(0 if summary.get("failed", 0) == 0 else 0)  # always exit 0
