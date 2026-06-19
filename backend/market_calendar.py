"""
market_calendar.py - US equities trading-day calendar (NYSE / Nasdaq full-day closures).

A SEPARATE concern from event_calendar.py: event_calendar answers "what scheduled
catalyst happens today" (FOMC, CPI, PCE, jobs); this module answers "is the US
equity market OPEN today" (weekend or full-day holiday). Used by the brief to frame
a closed day honestly: the tape on a holiday is the last completed session close,
and the brief states the closure rather than implying live trading.

DEPENDENCY DECISION: a vetted exchange-calendar library (exchange_calendars /
pandas_market_calendars) is NOT installed in this environment, and pulling one in
would add pandas and a large transitive tree to a daily pipeline for a small need.
We therefore use a STATIC holiday list verified against the published NYSE schedule
(nyse.com/markets/hours-calendars), with observed-date shifts baked in. The list is
a one-line-per-holiday annual edit; extend it each year from the published schedule.
If a market-calendar library is later added to the backend, swap the
US_MARKET_HOLIDAYS table for the library and keep this module's public API.

Everything here is pure / import-safe (stdlib only) and never raises.
"""
from __future__ import annotations

import datetime
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# Full-day NYSE/Nasdaq closures, verified vs the published NYSE schedule.
# Observed-date shifts are baked in (e.g. Independence Day 2026-07-04 is a Saturday,
# observed Friday 2026-07-03; Juneteenth 2027-06-19 is a Saturday, observed
# 2027-06-18; Christmas 2027-12-25 is a Saturday, observed 2027-12-24).
# Format: ISO date -> holiday name.
US_MARKET_HOLIDAYS: dict[str, str] = {
    # 2026
    "2026-01-01": "New Year's Day",
    "2026-01-19": "Martin Luther King Jr. Day",
    "2026-02-16": "Washington's Birthday",
    "2026-04-03": "Good Friday",
    "2026-05-25": "Memorial Day",
    "2026-06-19": "Juneteenth National Independence Day",
    "2026-07-03": "Independence Day (observed)",
    "2026-09-07": "Labor Day",
    "2026-11-26": "Thanksgiving Day",
    "2026-12-25": "Christmas Day",
    # 2027
    "2027-01-01": "New Year's Day",
    "2027-01-18": "Martin Luther King Jr. Day",
    "2027-02-15": "Washington's Birthday",
    "2027-03-26": "Good Friday",
    "2027-05-31": "Memorial Day",
    "2027-06-18": "Juneteenth National Independence Day (observed)",
    "2027-07-05": "Independence Day (observed)",
    "2027-09-06": "Labor Day",
    "2027-11-25": "Thanksgiving Day",
    "2027-12-24": "Christmas Day (observed)",
}

# Early-close (1:00pm ET) half-days. The market IS open on these, so they are
# trading days; recorded for completeness only and not used by is_trading_day.
US_MARKET_EARLY_CLOSES: dict[str, str] = {
    "2026-11-27": "Day after Thanksgiving (early close 1pm ET)",
    "2026-12-24": "Christmas Eve (early close 1pm ET)",
    "2027-11-26": "Day after Thanksgiving (early close 1pm ET)",
}


def _coerce(d) -> Optional[datetime.date]:
    if isinstance(d, datetime.datetime):
        return d.date()
    if isinstance(d, datetime.date):
        return d
    try:
        return datetime.date.fromisoformat(str(d)[:10])
    except Exception:
        return None


def holiday_name(date) -> Optional[str]:
    """Return the holiday name if `date` is a full-day market closure, else None."""
    d = _coerce(date)
    if d is None:
        return None
    return US_MARKET_HOLIDAYS.get(d.isoformat())


def is_trading_day(date) -> bool:
    """True if US equities trade a full or partial session on `date`; False on a
    weekend or a full-day holiday. Early-close half-days count as trading days.
    Never raises; on an unparseable input returns True (fail-open: do not falsely
    declare the market closed)."""
    d = _coerce(date)
    if d is None:
        return True
    if d.weekday() >= 5:  # 5 = Saturday, 6 = Sunday
        return False
    return d.isoformat() not in US_MARKET_HOLIDAYS


def last_trading_session(date) -> datetime.date:
    """The most recent trading day on or before `date`. On a holiday or weekend this
    is the prior open session (the close the brief should frame). On a normal trading
    day it is `date` itself. Bounded walk-back (10 days) so it never loops."""
    d = _coerce(date) or datetime.date.today()
    for _ in range(10):
        if is_trading_day(d):
            return d
        d = d - datetime.timedelta(days=1)
    return d


def market_status(date) -> dict:
    """Convenience summary for the brief: whether the market is closed today, the
    holiday name (or 'Weekend'), and the last trading session date. Never raises."""
    d = _coerce(date) or datetime.date.today()
    trading = is_trading_day(d)
    name = holiday_name(d)
    if not trading and name is None and d.weekday() >= 5:
        name = "Weekend"
    return {
        "date": d.isoformat(),
        "market_closed": not trading,
        "holiday_name": name,
        "last_trading_session": last_trading_session(d).isoformat(),
    }
