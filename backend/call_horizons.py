"""
call_horizons.py - the fixed resolution-horizon map for brief calls.

A brief call is a directional claim. Some are same-session ("the S&P closes
higher today"), some are multi-week theses ("energy re-rates as crude tightens").
Grading both against one afternoon's close is a category error: it scores the
thesis on noise. This module turns a coarse horizon_type emitted by the claims
extractor into a concrete resolve_on date.

The map is FIXED, not model-chosen. The extractor picks a bucket; the code picks
the days. A model that could name its own resolution date could also move the
goalposts, and the value of a call is that its window was fixed when it was made.

    session    -> brief_date        (unchanged, today's close)
    week       -> brief_date +  7   calendar days
    multiweek  -> brief_date + 21   calendar days

Calendar days, not trading days, deliberately. price_attribution.py counts
actual returned candles (see its resolve(), sessions from entity candle_count)
and scales its thresholds by sqrt(sessions), so a window that spans a weekend or
a holiday self-corrects. Calendar arithmetic here cannot drift the grading math.

Anything missing, unrecognized, or malformed falls back to session, which is
exactly today's behavior. There is deliberately no "event" bucket: an event
horizon needs a catalyst date the extractor cannot reliably supply, and guessing
one would produce a confident wrong window.

Pure module: no IO, no env, no Supabase, no Gemini. Importable from tests.
"""

from __future__ import annotations

from datetime import date, timedelta

HORIZON_SESSION = "session"
HORIZON_WEEK = "week"
HORIZON_MULTIWEEK = "multiweek"

#: The fixed map. Calendar days added to brief_date.
HORIZON_DAYS: dict[str, int] = {
    HORIZON_SESSION: 0,
    HORIZON_WEEK: 7,
    HORIZON_MULTIWEEK: 21,
}

#: Fallback for a missing or unrecognized horizon_type. Same-session is the
#: honest default: it is what every call does today, so an unparseable value
#: degrades to current behavior rather than silently extending a window.
DEFAULT_HORIZON = HORIZON_SESSION

#: Hard ceiling on any resolve_on, mirroring MAX_WINDOW_DAYS in
#: src/app/api/radar/claims/author/route.ts. Nothing in HORIZON_DAYS comes near
#: it; it is a guardrail so a future map edit cannot ship a 2-year window.
MAX_HORIZON_DAYS = 90

VALID_HORIZON_TYPES = frozenset(HORIZON_DAYS)


def normalize_horizon_type(raw: object) -> str:
    """Coerce a model-supplied horizon_type to a known bucket.

    Unknown, missing, non-string, or empty all fall back to session.
    """
    if not isinstance(raw, str):
        return DEFAULT_HORIZON
    value = raw.strip().lower()
    if value in VALID_HORIZON_TYPES:
        return value
    return DEFAULT_HORIZON


def horizon_days(raw: object) -> int:
    """Calendar days to add for a horizon_type, clamped to MAX_HORIZON_DAYS."""
    days = HORIZON_DAYS[normalize_horizon_type(raw)]
    return min(days, MAX_HORIZON_DAYS)


def _parse_date(value: object) -> date | None:
    if isinstance(value, date):
        return value
    if isinstance(value, str) and value:
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None
    return None


def resolve_on_for(brief_date: object, raw_horizon_type: object) -> str | None:
    """
    The resolve_on date for a call, as an ISO date string.

    Returns None when brief_date is unusable, which leaves the column NULL and
    keeps the call out of the due-scan entirely (see grade_brief_calls). A NULL
    resolve_on is never a grading candidate, so a bad date fails closed rather
    than producing a call that resolves at an arbitrary time.
    """
    base = _parse_date(brief_date)
    if base is None:
        return None
    return (base + timedelta(days=horizon_days(raw_horizon_type))).isoformat()
