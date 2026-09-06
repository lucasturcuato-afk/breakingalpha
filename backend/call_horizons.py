"""
call_horizons.py - the fixed resolution-horizon map for brief calls.

A brief call is a directional claim. Some are same-session ("the S&P closes
higher today"), some are multi-week theses ("energy re-rates as crude tightens").
Grading both against one afternoon's close is a category error: it scores the
thesis on noise. This module turns a coarse horizon_type emitted by the claims
extractor into a concrete resolve_on date.

The extractor states how long the claim needs; the code turns that into a date.
A model that could name its own resolution date could also move the goalposts,
and the value of a call is that its window was fixed when it was made.

The extractor now emits a DAY COUNT rather than one of three buckets, because
three buckets stood in for reasoning the model can do directly: a call about
Thursday's print does not need seven days, it needs three. The count is clamped
to [0, MAX_HORIZON_DAYS] by normalize_horizon_days, and a bounded non-negative
integer cannot express a window in the past or a year out. See that function.

The three named buckets survive as a VOCABULARY, not as the only vocabulary.
The user-facing selector and the adopt route still speak in them:

    session    -> brief_date        (today's close)
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


# ---------------------------------------------------------------------------
# Variable horizons: a day count, not a bucket
# ---------------------------------------------------------------------------

#: Floor on any window. Zero is same-session, which is a real and common answer.
MIN_HORIZON_DAYS = 0


def normalize_horizon_days(raw: object) -> int:
    """
    Coerce a model-supplied day count to an integer in [0, MAX_HORIZON_DAYS].

    This is the whole safety argument for emitting a count rather than a date.
    A bounded non-negative integer CANNOT express a window 400 days out or one
    that ends in the past: those values are not rejected after the fact, they
    are unrepresentable. There is no date to parse, no timezone to get wrong,
    and no plausible-but-wrong arithmetic for the model to do.

    Anything missing, non-numeric, boolean, or NaN falls back to 0, which is
    same-session, which is exactly what an unrecognized bucket did before. An
    out-of-range value is clamped rather than dropped: a model asking for 120
    days meant "a long window", and 90 is the longest honest one.
    """
    # bool is an int subclass in Python. True would silently become 1 day.
    if isinstance(raw, bool):
        return MIN_HORIZON_DAYS
    if isinstance(raw, int):
        value = raw
    elif isinstance(raw, float):
        # NaN and the infinities are not windows.
        if raw != raw or raw in (float("inf"), float("-inf")):
            return MIN_HORIZON_DAYS
        value = int(raw)
    elif isinstance(raw, str):
        text = raw.strip()
        try:
            value = int(float(text))
        except (TypeError, ValueError):
            return MIN_HORIZON_DAYS
    else:
        return MIN_HORIZON_DAYS
    return max(MIN_HORIZON_DAYS, min(value, MAX_HORIZON_DAYS))


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


def resolve_on_for_days(brief_date: object, raw_days: object) -> str | None:
    """
    The resolve_on date for a call whose horizon is a day COUNT.

    Same contract as resolve_on_for, same fail-closed behavior on an unusable
    brief_date, same function boundary. The model states how long the claim
    needs; the code owns the date. That division is the reason this module
    exists (see the header) and a variable count does not change it: a count is
    still intent, not arithmetic.
    """
    base = _parse_date(brief_date)
    if base is None:
        return None
    return (base + timedelta(days=normalize_horizon_days(raw_days))).isoformat()


def is_missing_column_error(exc: object) -> bool:
    """True when a PostgREST/Postgres error says a COLUMN does not exist.

    The only condition under which synthesize.extract_and_persist_claims may
    insert calls without resolve_on/is_lead: migrations 0013/0014 not applied.
    Any other failure (a recycled connection, a timeout, an RLS refusal) must
    not be answered by stripping the column, because a call stored without
    resolve_on is excluded from grading forever. Matched on the PostgREST code
    (PGRST204: column not in the schema cache), the Postgres code (42703:
    undefined column) and the two message shapes they carry.
    """
    text = str(exc)
    low = text.lower()
    return (
        "PGRST204" in text
        or "42703" in text
        or ("column" in low and "does not exist" in low)
        or ("could not find the" in low and "column" in low)
    )
