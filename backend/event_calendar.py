"""
event_calendar.py - BreakingAlpha scheduled-catalyst system.

Two layers:

  1. STATIC FLOOR (this module, no network, no key): the guaranteed schedule of
     scheduled market catalysts (FOMC decisions + dot plot, and the recurring key
     prints CPI / PCE / nonfarm payrolls). Dates are encoded from the Fed, BLS,
     and BEA published schedules. The floor NEVER asserts a stale value (no rate,
     no chair name): it states the EVENT, its date, and whether a dot plot lands.

  2. LIVE ENRICHMENT (gated, soft-fail): FRED supplies the latest released ACTUAL
     and PREVIOUS values for the recurring prints (free, requires a free
     FRED_API_KEY). Consensus/estimate is GATED on every free calendar tier we
     surveyed (Finnhub economic_calendar returns 403 on the current plan), so it
     sits behind a separate flag, off by default, and is reported as a paid
     upgrade. Any live failure (no key, timeout, access-denied, malformed) falls
     back to the static floor: the brief never loses the core schedule.

Design rules (see the catalyst-system PR):
  - FRED uses server-side unit transforms (units=pc1 for y/y, units=chg for the
    payroll change) so this module does NOT re-implement the SA/NSA y/y math that
    macro_calendar.py (BLS) and bea_calendar.py (BEA) already own. No duplication.
  - The FOMC date is cross-checked: if a live source ever disagrees with the
    static table, the static date WINS and the conflict is logged.
  - Single fetch per run; everything is import-safe without env vars.

Annual refresh: add the next year's FOMC meetings and the next year's print
release dates, one line per entry, in the tables below.
"""
from __future__ import annotations

import datetime
import logging
import os
from dataclasses import dataclass, field
from typing import Optional

import requests

logger = logging.getLogger(__name__)

# ── Static FOMC table (verified against federalreserve.gov/monetarypolicy) ───
# Each entry is the DECISION day (day two of the two-day meeting); the statement
# and, on SEP meetings, the dot plot land that afternoon at 2:00pm ET. SEP
# (Summary of Economic Projections / dot plot) is published at the March, June,
# September, and December meetings only.
FOMC_TIME_ET = "2:00pm ET"
# (decision_date_iso, has_dot_plot)
FOMC_MEETINGS: tuple[tuple[str, bool], ...] = (
    # 2026
    ("2026-01-28", False),
    ("2026-03-18", True),
    ("2026-04-29", False),
    ("2026-06-17", True),
    ("2026-07-29", False),
    ("2026-09-16", True),
    ("2026-10-28", False),
    ("2026-12-09", True),
    # 2027 (Fed published schedule)
    ("2027-01-27", False),
    ("2027-03-17", True),
    ("2027-04-28", False),
    ("2027-06-09", True),
    ("2027-07-28", False),
    ("2027-09-15", True),
    ("2027-10-27", False),
    ("2027-12-08", True),
)

# ── Static recurring-print release dates ─────────────────────────────────────
# Release DATE (not reference month) for each scheduled print, 8:30am ET. These
# are verified from the BLS (CPI, Employment Situation) and BEA (Personal Income
# and Outlays / PCE) published schedules as of 2026-06-18. Encoded through the
# next confirmed release per series; the floor never asserts an unverified date,
# so extend these tuples at the annual refresh (BLS/BEA publish the full year).
# Format: (release_date_iso, reference_month_label)
CPI_RELEASES: tuple[tuple[str, str], ...] = (
    ("2026-03-11", "Feb 2026"),
    ("2026-04-10", "Mar 2026"),
    ("2026-05-12", "Apr 2026"),
    ("2026-06-10", "May 2026"),
    ("2026-07-14", "Jun 2026"),
)
NFP_RELEASES: tuple[tuple[str, str], ...] = (
    ("2026-06-05", "May 2026"),
    ("2026-07-02", "Jun 2026"),
)
PCE_RELEASES: tuple[tuple[str, str], ...] = (
    ("2026-06-25", "May 2026"),
    ("2026-07-30", "Jun 2026"),
    ("2026-08-26", "Jul 2026"),
    ("2026-09-30", "Aug 2026"),
    ("2026-10-29", "Sep 2026"),
    ("2026-11-25", "Oct 2026"),
    ("2026-12-23", "Nov 2026"),
)
PRINT_TIME_ET = "8:30am ET"

# Display names per type.
_TYPE_NAME = {
    "fomc": "FOMC rate decision",
    "cpi": "CPI",
    "pce": "PCE price index",
    "nfp": "Nonfarm payrolls",
}


@dataclass
class Catalyst:
    date: str                       # release / decision date, ISO yyyy-mm-dd
    name: str                       # display name, e.g. "CPI (May 2026)"
    type: str                       # fomc | cpi | pce | nfp
    time_et: str                    # e.g. "8:30am ET"
    has_dot_plot: bool = False      # FOMC only
    consensus: Optional[str] = None  # market consensus for the upcoming print (gated)
    actual: Optional[str] = None     # latest released value (FRED)
    previous: Optional[str] = None   # prior released value (FRED)
    impact: str = "high"            # all encoded catalysts are high-impact
    ref_month: Optional[str] = None  # reference month label for prints


def _parse(d: str) -> Optional[datetime.date]:
    try:
        return datetime.date.fromisoformat(d)
    except Exception:
        return None


# ── Static floor ─────────────────────────────────────────────────────────────
def get_upcoming_catalysts(
    asof_date: datetime.date,
    window_days: int = 7,
) -> list[Catalyst]:
    """Static floor: scheduled catalysts with a date in [asof_date, asof_date +
    window_days], inclusive, sorted by date. No network, no key, never raises.
    Soft-fail: an empty window returns an empty list (the caller omits the block).
    Never asserts a value (rate / chair); only the event, date, and dot-plot flag.
    """
    out: list[Catalyst] = []
    try:
        end = asof_date + datetime.timedelta(days=window_days)

        for iso, dot in FOMC_MEETINGS:
            d = _parse(iso)
            if d and asof_date <= d <= end:
                out.append(Catalyst(
                    date=iso, name=_TYPE_NAME["fomc"], type="fomc",
                    time_et=FOMC_TIME_ET, has_dot_plot=dot, impact="high",
                ))

        for typ, table in (("cpi", CPI_RELEASES), ("nfp", NFP_RELEASES), ("pce", PCE_RELEASES)):
            for iso, ref in table:
                d = _parse(iso)
                if d and asof_date <= d <= end:
                    out.append(Catalyst(
                        date=iso, name=f"{_TYPE_NAME[typ]} ({ref})", type=typ,
                        time_et=PRINT_TIME_ET, ref_month=ref, impact="high",
                    ))

        out.sort(key=lambda c: c.date)
    except Exception as e:  # the floor must never raise
        logger.warning("event_calendar: get_upcoming_catalysts failed: %s", e)
        return []
    return out


# ── Live enrichment: FRED actuals (free, requires free FRED_API_KEY) ─────────
# FRED server-side unit transforms give the released headline number directly, so
# we never re-derive y/y from raw index levels (that lives in macro_calendar.py /
# bea_calendar.py). pc1 = percent change from a year ago; chg = change from prior.
FRED_URL = "https://api.stlouisfed.org/fred/series/observations"
FRED_SERIES = {
    # type -> (series_id, units, suffix)
    "cpi": ("CPIAUCSL", "pc1", "% y/y"),
    "pce": ("PCEPI", "pc1", "% y/y"),
    "nfp": ("PAYEMS", "chg", "K m/m"),
}
LIVE_CALENDAR_ENABLED = os.environ.get("LIVE_CALENDAR_ENABLED", "true").strip().lower() != "false"
CONSENSUS_ENABLED = os.environ.get("CATALYST_CONSENSUS_ENABLED", "false").strip().lower() == "true"


def _fred_latest_two(series_id: str, units: str, timeout: int) -> tuple[Optional[str], Optional[str]]:
    """Return (latest, previous) observation values as strings, or (None, None).
    Soft-fail on any error; never raises."""
    key = os.environ.get("FRED_API_KEY")
    if not key:
        return None, None
    try:
        resp = requests.get(
            FRED_URL,
            params={
                "series_id": series_id, "units": units, "api_key": key,
                "file_type": "json", "sort_order": "desc", "limit": 2,
            },
            timeout=timeout,
        )
        if resp.status_code != 200:
            logger.warning("event_calendar: FRED %s returned %d", series_id, resp.status_code)
            return None, None
        obs = (resp.json() or {}).get("observations") or []
        vals = [o.get("value") for o in obs if o.get("value") not in (None, ".", "")]
        latest = vals[0] if len(vals) >= 1 else None
        prev = vals[1] if len(vals) >= 2 else None
        return latest, prev
    except Exception as e:
        logger.warning("event_calendar: FRED fetch %s failed: %s", series_id, e)
        return None, None


def _fmt_fred(value: Optional[str], suffix: str) -> Optional[str]:
    if value is None:
        return None
    try:
        num = float(value)
    except (TypeError, ValueError):
        return None
    if suffix.startswith("K"):
        return f"{num:+.0f}K m/m"
    if "y/y" in suffix:
        return f"{num:.1f}% y/y"
    return f"{num} {suffix}"


def enrich_with_live(catalysts: list[Catalyst], timeout: int = 12) -> list[Catalyst]:
    """Attach FRED actual/previous to matching print catalysts. Single fetch per
    series, only for types present in the window. Gated behind LIVE_CALENDAR_ENABLED
    and FRED_API_KEY. Soft-fail: on any failure the input list is returned
    unchanged (the floor schedule is preserved). Consensus stays None unless a
    paid source is wired behind CATALYST_CONSENSUS_ENABLED.
    """
    if not LIVE_CALENDAR_ENABLED or not catalysts:
        return catalysts
    if not os.environ.get("FRED_API_KEY"):
        return catalysts  # floor-only until a free FRED key is added
    try:
        needed = {c.type for c in catalysts if c.type in FRED_SERIES}
        cache: dict[str, tuple[Optional[str], Optional[str]]] = {}
        for typ in needed:
            series_id, units, suffix = FRED_SERIES[typ]
            latest, prev = _fred_latest_two(series_id, units, timeout)
            cache[typ] = (_fmt_fred(latest, suffix), _fmt_fred(prev, suffix))
        for c in catalysts:
            if c.type in cache:
                latest, prev = cache[c.type]
                # The upcoming print's "previous" is the most recent released value.
                c.previous = latest if latest is not None else c.previous
        if not CONSENSUS_ENABLED:
            logger.info("event_calendar: consensus disabled (no free source); set "
                        "CATALYST_CONSENSUS_ENABLED + a paid calendar key to enable")
    except Exception as e:
        logger.warning("event_calendar: live enrichment failed, using floor: %s", e)
    return catalysts


def reconcile_fomc(static_list: list[Catalyst], live_dates: dict[str, str]) -> list[Catalyst]:
    """Cross-check live FOMC dates against the static table; the static date WINS
    on any conflict, and the conflict is logged. `live_dates` maps an event key to
    an ISO date from a live calendar. Defensive: no free calendar supplies FOMC
    dates today, so this guards a future live source. Never raises."""
    try:
        static_fomc = {c.date for c in static_list if c.type == "fomc"}
        for k, live_iso in (live_dates or {}).items():
            if "fomc" in k.lower() and live_iso not in static_fomc:
                logger.warning(
                    "event_calendar: live FOMC date %s conflicts with static table "
                    "%s; preferring static", live_iso, sorted(static_fomc))
    except Exception as e:
        logger.warning("event_calendar: reconcile_fomc failed: %s", e)
    return static_list


# ── Public entry point used by synthesize.py ─────────────────────────────────
# Morning weights the forward window; evening feeds tomorrow_setup with a
# next-day-and-ahead window.
WINDOW_MORNING = 7
WINDOW_EVENING = 5


def get_catalysts(asof_date: datetime.date, brief_type: str) -> list[Catalyst]:
    """Merged catalyst list for a brief: the static floor enriched with live
    actuals. The floor is the guarantee; the live layer only adds values and
    never removes a scheduled event. Soft-fail to floor on any live error."""
    window = WINDOW_MORNING if brief_type == "morning" else WINDOW_EVENING
    floor = get_upcoming_catalysts(asof_date, window_days=window)
    if not floor:
        return []
    return enrich_with_live(floor)


# ── Framing + render/prompt serialization ────────────────────────────────────
def when_label(asof_date: datetime.date, event_date_iso: str) -> str:
    """TODAY / tomorrow / in N days framing, never a stale relative phrase."""
    d = _parse(event_date_iso)
    if not d:
        return event_date_iso
    delta = (d - asof_date).days
    if delta <= 0:
        return "today"
    if delta == 1:
        return "tomorrow"
    if delta <= 6:
        return f"in {delta} days ({d.strftime('%a %b %-d')})"
    return d.strftime("%a %b %-d")


def to_render_payload(catalysts: list[Catalyst], asof_date: datetime.date) -> list[dict]:
    """Compact JSON list for the render strip (rides inside macro_panel.catalysts;
    no new column). Only fields the strip shows."""
    payload = []
    for c in catalysts:
        payload.append({
            "date": c.date,
            "when": when_label(asof_date, c.date),
            "name": c.name,
            "type": c.type,
            "time_et": c.time_et,
            "has_dot_plot": c.has_dot_plot,
            "consensus": c.consensus,
            "previous": c.previous,
            "actual": c.actual,
            "impact": c.impact,
        })
    return payload


def build_catalyst_block(catalysts: list[Catalyst], asof_date: datetime.date, brief_type: str) -> str:
    """Prompt-injection block. Empty string when the window has no catalysts (the
    caller injects nothing). Values are framed as REPORTED data (the schedule and,
    when present, the market's consensus / last released figure), never as a
    Signalera prediction of the outcome."""
    if not catalysts:
        return ""
    lines = ["[SCHEDULED CATALYSTS - deterministic calendar, reported data not a prediction]"]
    for c in catalysts:
        when = when_label(asof_date, c.date)
        bits = [f"{c.name}: {when}, {c.time_et}"]
        if c.has_dot_plot:
            bits.append("includes the dot plot / SEP")
        if c.consensus:
            bits.append(f"consensus {c.consensus}")
        if c.previous:
            bits.append(f"prior {c.previous}")
        if c.actual:
            bits.append(f"actual {c.actual}")
        lines.append("- " + "; ".join(bits))
    field = "what_to_watch" if brief_type == "morning" else "tomorrow_setup"
    has_imminent = any(when_label(asof_date, c.date) in ("today", "tomorrow") for c in catalysts)
    lines.append(
        f"USAGE ({brief_type}): a scheduled catalyst that lands TODAY or TOMORROW "
        "(especially FOMC, CPI, PCE, or jobs) is the dominant item into the session "
        f"and MUST be named in {field} as analysis of what is AT STAKE (what a beat, "
        "miss, or hawkish or dovish surprise would mean for rates, the curve, or risk "
        "appetite), NEVER as a prediction of the outcome and NEVER as a recommendation. "
        "The 'same-session deal flow dominates' exception applies ONLY to catalysts more "
        "than one day out. Consensus and prior figures above are reported market data, "
        "not a Signalera forecast."
        + (" An imminent catalyst is present above: surface it." if has_imminent else "")
    )
    return "\n".join(lines) + "\n\n"
