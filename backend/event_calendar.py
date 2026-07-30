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

# ── Authoritative release-date lookup (for synthesis recency, no estimator) ───
# macro_calendar / bea_calendar release keys map to the static release tables
# above. Payrolls and unemployment ship on the SAME Employment Situation report
# (NFP table); headline and core CPI ship on the SAME CPI report; headline and
# core PCE ship on the SAME Personal Income and Outlays report. PPI and GDP have
# no authoritative table encoded here (they stay estimator-free: awaiting/unknown).
_RELEASE_KEY_TO_TABLE: dict[str, tuple[tuple[str, str], ...]] = {
    "cpi": CPI_RELEASES,
    "core_cpi": CPI_RELEASES,
    "nonfarm_payrolls": NFP_RELEASES,
    "unemployment": NFP_RELEASES,
    "pce": PCE_RELEASES,
    "core_pce": PCE_RELEASES,
}

_MONTH_TO_NUM = {
    m.lower(): i
    for i, m in enumerate(
        ["", "january", "february", "march", "april", "may", "june", "july",
         "august", "september", "october", "november", "december"]
    )
} | {
    m.lower(): i
    for i, m in enumerate(
        ["", "jan", "feb", "mar", "apr", "may", "jun", "jul",
         "aug", "sep", "oct", "nov", "dec"]
    )
}


def _period_to_ym(label: Optional[str]) -> Optional[tuple[int, int]]:
    """Normalize a reference-period label ('Jun 2026', 'June 2026', 'Q2 2026')
    to (year, month). Quarterly maps to the quarter-end month. None if unparseable."""
    toks = (label or "").strip().split()
    if len(toks) < 2:
        return None
    try:
        year = int(toks[-1])
    except ValueError:
        return None
    head = toks[0].lower()
    if head.startswith("q") and len(head) >= 2 and head[1].isdigit():
        q = int(head[1])
        return (year, q * 3) if 1 <= q <= 4 else None
    mo = _MONTH_TO_NUM.get(head)
    return (year, mo) if mo else None


def authoritative_release_date(
    release_key: str, ref_period: Optional[str]
) -> Optional[datetime.date]:
    """The AUTHORITATIVE published release date for a macro release, looked up from
    the static BLS/BEA schedule tables by (key, reference-period month). This is the
    single source of truth for release-day / recency detection in synthesis; it
    replaces the hardcoded 12th-of-month estimator. Returns None when the key has no
    encoded table (PPI, GDP) or the reference month is not in the table (the caller
    then treats recency as unknown, never fabricated). Never raises."""
    try:
        table = _RELEASE_KEY_TO_TABLE.get((release_key or "").strip().lower())
        if not table:
            return None
        want = _period_to_ym(ref_period)
        if not want:
            return None
        for iso, ref in table:
            if _period_to_ym(ref) == want:
                return _parse(iso)
    except Exception as e:
        logger.warning("event_calendar: authoritative_release_date failed: %s", e)
    return None


@dataclass
class Catalyst:
    date: str                       # release / decision date, ISO yyyy-mm-dd
    name: str                       # display name, e.g. "CPI (May 2026)"
    type: str                       # fomc | cpi | pce | nfp
    time_et: str                    # e.g. "8:30am ET"
    has_dot_plot: bool = False      # FOMC only
    consensus: Optional[str] = None  # market consensus for the upcoming print (gated)
    actual: Optional[str] = None     # RESOLVED outcome: the released value (prints,
                                     # from FRED) or the decision + tone TEXT (FOMC,
                                     # from the corpus). Null until the event resolves.
    previous: Optional[str] = None   # prior released value (FRED); the "last print"
                                     # framing for an UPCOMING (unresolved) event
    impact: str = "high"            # all encoded catalysts are high-impact
    ref_month: Optional[str] = None  # reference month label for prints
    resolved_at: Optional[str] = None  # ISO datetime the event's scheduled time
                                     # passed (its clock struck), i.e. it is no longer
                                     # "due". None => still scheduled/upcoming.

    @property
    def is_resolved(self) -> bool:
        """Resolution STATE: scheduled -> resolved. True once the event's scheduled
        clock has passed (resolved_at set). The outcome text/value rides in .actual;
        a resolved event with .actual is None simply means the outcome was not yet
        extractable, NOT that it is still upcoming."""
        return self.resolved_at is not None


def _parse(d: str) -> Optional[datetime.date]:
    try:
        return datetime.date.fromisoformat(d)
    except Exception:
        return None


# ── Clock helpers (event-resolution state) ───────────────────────────────────
# when_label was date-granular: a 2:00pm event still read "today" at 10:31pm. The
# helpers below give the calendar a CLOCK so a same-day event whose time has PASSED
# reads "earlier today" (resolved), never "due today". Pure, tz-correct via
# zoneinfo (handles EST/EDT); soft-fail to date-granular if the clock is absent.
def _et_zone():
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo("America/New_York")
    except Exception:
        return None


def _coerce_et_dt(asof) -> Optional[datetime.datetime]:
    """Normalize `asof` to a tz-aware America/New_York datetime, or None when no
    clock is available (a bare date was passed). Naive datetimes are read as UTC."""
    if isinstance(asof, datetime.datetime):
        tz = _et_zone()
        if tz is None:
            return None
        dt = asof if asof.tzinfo else asof.replace(tzinfo=datetime.timezone.utc)
        return dt.astimezone(tz)
    return None


def _asof_date(asof) -> Optional[datetime.date]:
    """The ET calendar date for `asof`, whether it is a clock-bearing datetime or a
    bare date."""
    et = _coerce_et_dt(asof)
    if et is not None:
        return et.date()
    if isinstance(asof, datetime.date):
        return asof
    return None


def _parse_time_et(time_et: Optional[str]) -> Optional[tuple[int, int]]:
    """('2:00pm ET') -> (14, 0). None if unparseable."""
    if not time_et:
        return None
    import re
    m = re.search(r"(\d{1,2}):(\d{2})\s*([ap])m", time_et.strip().lower())
    if not m:
        return None
    hour = int(m.group(1)) % 12
    if m.group(3) == "p":
        hour += 12
    return hour, int(m.group(2))


def _event_dt_et(date_iso: str, time_et: Optional[str]) -> Optional[datetime.datetime]:
    """The event's scheduled moment as a tz-aware ET datetime. None if the date or
    time cannot be parsed (caller then falls back to date-granular framing)."""
    d = _parse(date_iso)
    hm = _parse_time_et(time_et)
    tz = _et_zone()
    if not d or hm is None or tz is None:
        return None
    return datetime.datetime(d.year, d.month, d.day, hm[0], hm[1], tzinfo=tz)


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


def enrich_with_live(catalysts: list[Catalyst], timeout: int = 12, asof=None) -> list[Catalyst]:
    """Attach FRED actual/previous to matching print catalysts. Single fetch per
    series, only for types present in the window. Gated behind LIVE_CALENDAR_ENABLED
    and FRED_API_KEY. Soft-fail: on any failure the input list is returned
    unchanged (the floor schedule is preserved). Consensus stays None unless a
    paid source is wired behind CATALYST_CONSENSUS_ENABLED.

    Resolution-aware (generalized, not FOMC-specific): when `asof` carries a clock
    and a print's release time has PASSED, FRED's latest observation IS that
    release's ACTUAL, so it fills .actual (the resolved outcome). When the print is
    still upcoming, the same latest value is the "previous" print (old behavior).
    """
    if not LIVE_CALENDAR_ENABLED or not catalysts:
        return catalysts
    if not os.environ.get("FRED_API_KEY"):
        return catalysts  # floor-only until a free FRED key is added
    try:
        asof_dt = _coerce_et_dt(asof)
        needed = {c.type for c in catalysts if c.type in FRED_SERIES}
        cache: dict[str, tuple[Optional[str], Optional[str]]] = {}
        for typ in needed:
            series_id, units, suffix = FRED_SERIES[typ]
            latest, prev = _fred_latest_two(series_id, units, timeout)
            cache[typ] = (_fmt_fred(latest, suffix), _fmt_fred(prev, suffix))
        for c in catalysts:
            if c.type in cache:
                latest, prev = cache[c.type]
                ev_dt = _event_dt_et(c.date, c.time_et)
                resolved = (
                    asof_dt is not None and ev_dt is not None and ev_dt <= asof_dt
                )
                if resolved:
                    # The release has dropped: FRED's latest IS this print's actual.
                    c.actual = latest if latest is not None else c.actual
                    c.previous = prev if prev is not None else c.previous
                else:
                    # Upcoming print: FRED's latest is the most recent PRIOR value.
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


def get_catalysts(asof, brief_type: str, articles: Optional[list] = None) -> list[Catalyst]:
    """Merged catalyst list for a brief: the static floor, enriched with live
    actuals and stamped with resolution state. The floor is the guarantee; the
    live/resolution layers only add values and never remove a scheduled event.
    Soft-fail to floor on any error.

    `asof` may be a clock-bearing datetime (preferred: enables event-resolution
    state and "earlier today" framing) or a bare date (degrades to date-granular,
    old behavior). `articles` is the brief's corpus pool; when present it sources
    the FOMC decision + tone (which has no FRED series) for a resolved meeting.
    """
    asof_date = _asof_date(asof) or datetime.date.today()
    window = WINDOW_MORNING if brief_type == "morning" else WINDOW_EVENING
    floor = get_upcoming_catalysts(asof_date, window_days=window)
    if not floor:
        return []
    enriched = enrich_with_live(floor, asof=asof)
    mark_resolution(enriched, asof)
    if articles:
        resolve_fomc_from_corpus(enriched, asof, articles)
    return enriched


# ── Event-resolution state ───────────────────────────────────────────────────
def mark_resolution(catalysts: list[Catalyst], asof) -> list[Catalyst]:
    """Stamp resolved_at on every catalyst whose scheduled clock has PASSED as of
    `asof`. This is the deterministic state transition scheduled -> resolved; it is
    outcome-independent, so the "due today at 2:00pm ET" defect is fixed even when
    no outcome text can be extracted. No-op (state stays scheduled) when `asof`
    carries no clock. Never raises."""
    try:
        asof_dt = _coerce_et_dt(asof)
        if asof_dt is None:
            return catalysts
        for c in catalysts:
            if c.resolved_at is not None:
                continue
            ev_dt = _event_dt_et(c.date, c.time_et)
            if ev_dt is not None and ev_dt <= asof_dt:
                c.resolved_at = ev_dt.isoformat()
    except Exception as e:
        logger.warning("event_calendar: mark_resolution failed: %s", e)
    return catalysts


# FOMC has no FRED series and resolves to a DECISION + TONE (text), not a number.
# Recon (Jul 29 2026 evening pool) confirmed the outcome is in the article corpus
# ("Fed Holds Rates Steady...", "Rate Hold Masks A More Hawkish Fed") well before
# the evening run, so the outcome is sourced from the corpus, not a new ingester.
_FOMC_HOLD = ("holds rate", "held rate", "rate hold", "holds steady", "held steady",
              "leaves rate", "left rate", "keeps rate", "kept rate", "unchanged",
              "hawkish hold", "dovish hold", "on hold", "stands pat")
_FOMC_CUT = ("cuts rate", "cut rates", "rate cut", "lowers rate", "lowered rate",
             "trims rate", "trimmed rate", "reduces rate", "reduced rate")
_FOMC_HIKE = ("hikes rate", "hiked rate", "rate hike", "raises rate", "raised rate",
              "lifts rate", "lifted rate", "increases rate", "increased rate")
_FOMC_REF = ("fed", "fomc", "federal reserve", "central bank")


def resolve_fomc_from_corpus(catalysts: list[Catalyst], asof, articles: list) -> list[Catalyst]:
    """Populate .actual for a RESOLVED FOMC catalyst with its decision + tone,
    extracted deterministically from the brief's own corpus (titles + summaries).
    Only runs on a meeting whose clock has passed (resolved_at set) and only when a
    POST-decision signal exists (a Fed reference plus a decisive verb), so a preview
    pool ('Fed weighs decision') never fabricates an outcome. No signal => .actual
    stays None (state remains resolved-by-clock, no invented number). Never raises."""
    try:
        fomc = [c for c in catalysts if c.type == "fomc" and c.is_resolved]
        if not fomc or not articles:
            return catalysts
        holds = cuts = hikes = hawk = dove = 0
        for a in articles:
            if not isinstance(a, dict):
                continue
            text = ((a.get("title") or "") + " " + (a.get("summary") or "")).lower()
            if not any(k in text for k in _FOMC_REF):
                continue
            if any(k in text for k in _FOMC_HOLD):
                holds += 1
            if any(k in text for k in _FOMC_CUT):
                cuts += 1
            if any(k in text for k in _FOMC_HIKE):
                hikes += 1
            if "hawkish" in text:
                hawk += 1
            if "dovish" in text:
                dove += 1
        decisions = {"held rates steady": holds, "cut rates": cuts, "raised rates": hikes}
        top = max(decisions, key=decisions.get)
        if decisions[top] == 0:
            return catalysts  # no post-decision signal; do not fabricate an outcome
        tone = ""
        if hawk > dove:
            tone = " (hawkish tone)"
        elif dove > hawk:
            tone = " (dovish tone)"
        outcome = top + tone
        for c in fomc:
            if c.actual is None:
                c.actual = outcome
    except Exception as e:
        logger.warning("event_calendar: resolve_fomc_from_corpus failed: %s", e)
    return catalysts


# ── Framing + render/prompt serialization ────────────────────────────────────
def when_label(asof, event_date_iso: str, time_et: Optional[str] = None) -> str:
    """CLOCK-aware framing, never a stale relative phrase and never a resolved event
    mislabeled as "due". When `asof` carries a clock and the event's `time_et` is
    known: a same-day event whose time has PASSED reads "earlier today"; a same-day
    event still ahead reads "later today". Otherwise it degrades to the date-granular
    today / tomorrow / in N days framing (old behavior)."""
    d = _parse(event_date_iso)
    if not d:
        return event_date_iso
    asof_d = _asof_date(asof)
    if asof_d is None:
        return event_date_iso
    asof_dt = _coerce_et_dt(asof)
    if asof_dt is not None and time_et:
        ev_dt = _event_dt_et(event_date_iso, time_et)
        if ev_dt is not None:
            if ev_dt <= asof_dt:
                return "earlier today" if d == asof_d else d.strftime("%a %b %-d")
            if d == asof_d:
                return "later today"
    delta = (d - asof_d).days
    if delta <= 0:
        return "today"
    if delta == 1:
        return "tomorrow"
    if delta <= 6:
        return f"in {delta} days ({d.strftime('%a %b %-d')})"
    return d.strftime("%a %b %-d")


def to_render_payload(catalysts: list[Catalyst], asof) -> list[dict]:
    """Compact JSON list for the render strip (rides inside macro_panel.catalysts;
    no new column, no migration). Only fields the strip shows, plus resolution state
    (resolved / resolved_at) so the UI can render "earlier today - outcome ..."
    instead of a stale "due today"."""
    payload = []
    for c in catalysts:
        payload.append({
            "date": c.date,
            "when": when_label(asof, c.date, c.time_et),
            "name": c.name,
            "type": c.type,
            "time_et": c.time_et,
            "has_dot_plot": c.has_dot_plot,
            "consensus": c.consensus,
            "previous": c.previous,
            "actual": c.actual,
            "resolved": c.is_resolved,
            "resolved_at": c.resolved_at,
            "impact": c.impact,
        })
    return payload


def build_catalyst_block(catalysts: list[Catalyst], asof, brief_type: str) -> str:
    """Prompt-injection block. Empty string when the window has no catalysts (the
    caller injects nothing). Each event carries its RESOLUTION STATE: an UPCOMING
    event is framed forward (what is at stake); a RESOLVED event is framed backward
    (report what happened). The forward "what a hawkish surprise WOULD mean" framing
    is emitted ONLY for genuinely upcoming events, never for one whose clock passed.
    Values are reported data, never a Signalera prediction of the outcome."""
    if not catalysts:
        return ""
    lines = ["[SCHEDULED CATALYSTS - deterministic calendar, reported data not a prediction]"]
    resolved_present = False
    upcoming_imminent = False
    for c in catalysts:
        when = when_label(asof, c.date, c.time_et)
        bits = [f"{c.name}: {when}, {c.time_et}"]
        if c.is_resolved:
            resolved_present = True
            bits.append("RESOLVED - this event has already occurred")
            if c.actual:
                bits.append(f"outcome {c.actual}")
        else:
            if when in ("today", "tomorrow", "later today"):
                upcoming_imminent = True
            if c.has_dot_plot:
                bits.append("includes the dot plot / SEP")
            if c.consensus:
                bits.append(f"consensus {c.consensus}")
            if c.previous:
                bits.append(f"prior {c.previous}")
        lines.append("- " + "; ".join(bits))
    field = "what_to_watch" if brief_type == "morning" else "tomorrow_setup"
    # RESOLVED framing: report the outcome, never preview a decision already made.
    if resolved_present:
        lines.append(
            "USAGE (resolved events): a catalyst marked RESOLVED already happened "
            "BEFORE this brief's timestamp. REPORT what occurred - the decision or "
            "print and its value or tone (the 'outcome' field above is the "
            "deterministic summary; corroborate and expand it from the corpus "
            "articles) - as a backward-looking fact that shaped the session. NEVER "
            "call it 'due today', 'due tomorrow', or 'on tap'; NEVER preview 'what a "
            "beat, miss, or hawkish or dovish surprise would mean'; NEVER frame a "
            "decision that has been made as an outcome still to come."
        )
    # FORWARD framing: only for genuinely upcoming (unresolved) imminent catalysts.
    if upcoming_imminent:
        lines.append(
            f"USAGE ({brief_type}): an UNRESOLVED scheduled catalyst that lands TODAY "
            "or TOMORROW (especially FOMC, CPI, PCE, or jobs) is the dominant item "
            f"into the session and MUST be named in {field} as analysis of what is AT "
            "STAKE (what a beat, miss, or hawkish or dovish surprise would mean for "
            "rates, the curve, or risk appetite), NEVER as a prediction of the outcome "
            "and NEVER as a recommendation. The 'same-session deal flow dominates' "
            "exception applies ONLY to catalysts more than one day out. Consensus and "
            "prior figures above are reported market data, not a Signalera forecast."
        )
    return "\n".join(lines) + "\n\n"
