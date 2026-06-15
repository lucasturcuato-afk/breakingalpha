"""BEA data layer: the BEA sibling of backend/macro_calendar.py (the BLS layer).

Same purpose, same output shape (`MacroRelease`/`MacroFigure`, imported from
macro_calendar so BLS and BEA releases render uniformly), different source API.
Adds PCE, core PCE, and real GDP to the macro data set. Data-only: no calendar,
no synthesis, no render, no DB. Makes NO model calls. Fail-soft per release: a
failure on one release never breaks the others; on total failure returns an
empty list, never raises into the caller.

BEA API (read-only GETs):
  GET https://apps.bea.gov/api/data/  with params:
    UserID=<env BEA_API_KEY>, method=GetData, datasetname=NIPA,
    TableName, Frequency, Year=<trailing 3 years>, ResultFormat=JSON
  response: BEAAPI.Results.Data[] of {SeriesCode, LineNumber, LineDescription,
    TimePeriod ("YYYYMNN" monthly | "YYYYQN" quarterly), DataValue, ...},
    plus BEAAPI.Results.Notes[] carrying "LastRevised: <date>" (vintage).

Series (verified live 2026-06-14 against published anchors; see
docs/recon/bea-data-layer-recon.md):
  - Headline PCE: m/m from T20807 DPCERGM; y/y computed from T20804 DPCERG levels.
  - Core PCE:     m/m from T20807 DPCCRGM; y/y computed from T20804 DPCCRG levels.
    (NOT the market-based lines DPCMRGM/DPCXRGM / DPCMRG/DPCXRG.)
  - Real GDP:     q/q annualized from T10101 line 1, SeriesCode A191RL.
y/y = (Index[m] / Index[m-12] - 1) * 100, index unrounded, final percent to 1 dp.

Live verification (run with BEA_API_KEY set):
  python -m backend.bea_calendar
"""

from __future__ import annotations

import datetime
import logging
import os
import re
from typing import Optional

import requests

# Reuse the BLS layer's dataclasses so the later render treats BLS and BEA
# releases uniformly (do not redefine them).
from backend.macro_calendar import MacroFigure, MacroRelease

logger = logging.getLogger(__name__)

BEA_API_URL = "https://apps.bea.gov/api/data/"

# ── Tables and series codes (confirmed live; see recon doc) ───────────────────
TABLE_PCE_MM = "T20807"   # Frequency=M, m/m percent change in PCE prices
TABLE_PCE_LVL = "T20804"  # Frequency=M, PCE price index levels (for y/y)
TABLE_GDP = "T10101"      # Frequency=Q, percent change in real GDP

PCE_MM = "DPCERGM"        # headline PCE, m/m percent change
PCE_LVL = "DPCERG"        # headline PCE, index level
CORE_PCE_MM = "DPCCRGM"   # core PCE (excl food and energy), m/m percent change
CORE_PCE_LVL = "DPCCRG"   # core PCE (excl food and energy), index level
GDP_QQ = "A191RL"         # real GDP, q/q annualized

# Market-based lines that must NEVER be selected (documented decoys).
MARKET_BASED_CODES = {"DPCMRGM", "DPCXRGM", "DPCMRG", "DPCXRG"}

# Confidence per series code, same convention as macro_calendar. All confirmed:
# row selection verified live and values match published anchors to the decimal.
CONFIDENCE: dict[str, str] = {
    PCE_MM: "confirmed", PCE_LVL: "confirmed",
    CORE_PCE_MM: "confirmed", CORE_PCE_LVL: "confirmed",
    GDP_QQ: "confirmed",
}

_VINTAGE_PCE = (
    "BEA revises PCE prices in subsequent months; 'prior' is BEA's current value "
    "for the preceding period and may itself be revised. y/y is computed from the "
    "published price-index levels."
)

_MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


# ── Pure parsing helpers (no network; unit-tested against fixtures) ───────────
def _to_float(raw) -> Optional[float]:
    """Parse a BEA DataValue: strip commas, tolerate negatives; None on junk."""
    if raw is None:
        return None
    try:
        return float(str(raw).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def _parse_month(tp: Optional[str]) -> Optional[tuple[int, int]]:
    """'YYYYMNN' -> (year, month 1..12); None otherwise."""
    if not tp:
        return None
    m = re.fullmatch(r"(\d{4})M(\d{2})", tp.strip())
    if not m:
        return None
    year, month = int(m.group(1)), int(m.group(2))
    return (year, month) if 1 <= month <= 12 else None


def _parse_quarter(tp: Optional[str]) -> Optional[tuple[int, int]]:
    """'YYYYQN' -> (year, quarter 1..4); None otherwise."""
    if not tp:
        return None
    m = re.fullmatch(r"(\d{4})Q(\d)", tp.strip())
    if not m:
        return None
    year, q = int(m.group(1)), int(m.group(2))
    return (year, q) if 1 <= q <= 4 else None


def _month_minus(year: int, month: int, k: int) -> tuple[int, int]:
    idx = (year * 12 + (month - 1)) - k
    return idx // 12, idx % 12 + 1


def _quarter_minus(year: int, q: int, k: int) -> tuple[int, int]:
    idx = (year * 4 + (q - 1)) - k
    return idx // 4, idx % 4 + 1


def _index_table(table_json: Optional[dict]) -> list:
    """BEAAPI.Results.Data list, tolerant of partial/empty responses."""
    if not isinstance(table_json, dict):
        return []
    return (((table_json.get("BEAAPI") or {}).get("Results") or {}).get("Data")) or []


def _last_revised(table_json: Optional[dict]) -> Optional[str]:
    """Pull 'LastRevised: <date>' out of Results.Notes[].NoteText, if present."""
    results = ((table_json or {}).get("BEAAPI") or {}).get("Results") or {}
    for note in results.get("Notes") or []:
        text = note.get("NoteText") if isinstance(note, dict) else None
        if text:
            m = re.search(r"LastRevised:\s*([A-Za-z0-9 ,]+)", text)
            if m:
                return m.group(1).strip()
    return None


def _monthly_map(data: list, series_code: str) -> dict[tuple[int, int], float]:
    """(year, month) -> value for one monthly SeriesCode. Unparseable rows skipped."""
    out: dict[tuple[int, int], float] = {}
    for d in data:
        if not isinstance(d, dict) or d.get("SeriesCode") != series_code:
            continue
        key = _parse_month(d.get("TimePeriod"))
        val = _to_float(d.get("DataValue"))
        if key is not None and val is not None:
            out[key] = val
    return out


def _quarterly_map(data: list, series_code: str) -> dict[tuple[int, int], float]:
    out: dict[tuple[int, int], float] = {}
    for d in data:
        if not isinstance(d, dict) or d.get("SeriesCode") != series_code:
            continue
        key = _parse_quarter(d.get("TimePeriod"))
        val = _to_float(d.get("DataValue"))
        if key is not None and val is not None:
            out[key] = val
    return out


def _month_label(year: int, month: int) -> str:
    return f"{_MONTHS[month - 1]} {year}"


def _quarter_label(year: int, q: int) -> str:
    return f"Q{q} {year}"


def _yoy_from_levels(
    lvl_map: dict[tuple[int, int], float], year: int, month: int
) -> Optional[float]:
    """(Index[y,m] / Index[y-1,m] - 1) * 100, rounded to 1 dp. None if either
    level (especially the 12-month prior) is missing -- never compute against a
    wrong month."""
    cur = lvl_map.get((year, month))
    base = lvl_map.get((year - 1, month))
    if cur is None or base is None or base == 0:
        return None
    return round((cur / base - 1.0) * 100.0, 1)


def _has_any_value(figs: list[MacroFigure]) -> bool:
    return any(f.value is not None for f in figs)


# ── Release builders ─────────────────────────────────────────────────────────
def _build_pce(
    mm_json: Optional[dict],
    lvl_json: Optional[dict],
    key: str,
    name: str,
    mm_code: str,
    lvl_code: str,
) -> Optional[MacroRelease]:
    """Headline / core PCE: m/m published (T20807), y/y computed from levels (T20804)."""
    mm_map = _monthly_map(_index_table(mm_json), mm_code)
    lvl_map = _monthly_map(_index_table(lvl_json), lvl_code)
    if not mm_map and not lvl_map:
        return None

    # Period anchored on the latest published m/m month (fallback to levels).
    anchor = max(mm_map) if mm_map else max(lvl_map)
    ly, lm = anchor
    py, pm = _month_minus(ly, lm, 1)  # exact prior month (skips gaps)

    mm_figure = MacroFigure(
        "m/m", mm_map.get((ly, lm)), "%", mm_map.get((py, pm))
    )
    yy_figure = MacroFigure(
        "y/y", _yoy_from_levels(lvl_map, ly, lm), "%", _yoy_from_levels(lvl_map, py, pm)
    )
    figures = [mm_figure, yy_figure]
    if not _has_any_value(figures):
        return None

    return MacroRelease(
        key=key, name=name, period=_month_label(ly, lm), figures=figures,
        vintage_note=_VINTAGE_PCE, confidence=_confidence_for([mm_code, lvl_code]),
        series_ids=[mm_code, lvl_code], footnotes=[],
    )


def _build_gdp(gdp_json: Optional[dict]) -> Optional[MacroRelease]:
    gmap = _quarterly_map(_index_table(gdp_json), GDP_QQ)
    if not gmap:
        return None
    ly, lq = max(gmap)
    py, pq = _quarter_minus(ly, lq, 1)  # exact prior quarter
    figure = MacroFigure("q/q annualized", gmap.get((ly, lq)), "%", gmap.get((py, pq)))
    if figure.value is None:
        return None
    revised = _last_revised(gdp_json)
    vintage = (
        "Real GDP is revised across estimates (advance/second/third)."
        + (f" BEA LastRevised: {revised}." if revised else "")
    )
    return MacroRelease(
        key="gdp", name="Real GDP", period=_quarter_label(ly, lq), figures=[figure],
        vintage_note=vintage, confidence=_confidence_for([GDP_QQ]),
        series_ids=[GDP_QQ], footnotes=[],
    )


def _confidence_for(codes: list[str]) -> str:
    return (
        "confirmed"
        if all(CONFIDENCE.get(c) == "confirmed" for c in codes)
        else next((CONFIDENCE[c] for c in codes if CONFIDENCE.get(c) != "confirmed"), "assumed")
    )


def build_releases(
    pce_mm_json: Optional[dict],
    pce_lvl_json: Optional[dict],
    gdp_json: Optional[dict],
) -> list[MacroRelease]:
    """Assemble PCE, core PCE, GDP from the three table responses. Skips any
    release whose data is missing/unparseable (fail-soft, partial-OK)."""
    builders = [
        lambda: _build_pce(pce_mm_json, pce_lvl_json, "pce", "PCE Price Index", PCE_MM, PCE_LVL),
        lambda: _build_pce(pce_mm_json, pce_lvl_json, "core_pce", "Core PCE Price Index", CORE_PCE_MM, CORE_PCE_LVL),
        lambda: _build_gdp(gdp_json),
    ]
    out: list[MacroRelease] = []
    for b in builders:
        try:
            rel = b()
        except Exception as e:  # one bad release never sinks the panel
            logger.warning("BEA release build failed: %s", e)
            rel = None
        if rel is not None:
            out.append(rel)
    return out


# ── HTTP fetch (network; wraps the pure parser) ──────────────────────────────
def _get_bea(table: str, frequency: str, timeout: int) -> Optional[dict]:
    """One read-only GET for a NIPA table. Returns parsed JSON, or None on any
    failure / API error."""
    key = os.environ.get("BEA_API_KEY")
    if not key:
        logger.warning("BEA_API_KEY not set: cannot fetch BEA data")
        return None
    now_year = datetime.date.today().year
    params = {
        "UserID": key,
        "method": "GetData",
        "datasetname": "NIPA",
        "TableName": table,
        "Frequency": frequency,
        "Year": f"{now_year - 2},{now_year - 1},{now_year}",
        "ResultFormat": "JSON",
    }
    try:
        resp = requests.get(BEA_API_URL, params=params, timeout=timeout)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        logger.warning("BEA request failed for %s/%s: %s", table, frequency, e)
        return None
    # Surface API-level errors (BEA returns 200 with an Error object).
    results = (data.get("BEAAPI") or {}).get("Results")
    err = None
    if isinstance(results, dict):
        err = results.get("Error")
    elif isinstance(data.get("BEAAPI"), dict):
        err = data["BEAAPI"].get("Error")
    if err:
        logger.warning("BEA API error for %s/%s: %s", table, frequency, err)
        return None
    return data


def fetch_bea_releases(timeout: int = 20) -> list[MacroRelease]:
    """The BEA panel: PCE, core PCE, real GDP. Fail-soft: returns [] on total
    failure and a partial list when only some tables resolve. Never raises. No
    model calls."""
    try:
        pce_mm = _get_bea(TABLE_PCE_MM, "M", timeout)
        pce_lvl = _get_bea(TABLE_PCE_LVL, "M", timeout)
        gdp = _get_bea(TABLE_GDP, "Q", timeout)
        return build_releases(pce_mm, pce_lvl, gdp)
    except Exception as e:
        logger.warning("fetch_bea_releases failed: %s", e)
        return []


# ── Standalone harness: python -m backend.bea_calendar ───────────────────────
def _fmt(value: Optional[float], unit: str) -> str:
    if value is None:
        return "n/a"
    return f"{value:+.1f}%" if unit == "%" else f"{value}"


def _print_panel(releases: list[MacroRelease]) -> None:
    if not releases:
        print("(BEA panel empty: no releases resolved -- check BEA_API_KEY and connectivity)")
        return
    for r in releases:
        print(f"\n{r.name}  [{r.period or 'period n/a'}]  ({r.confidence})")
        print(f"  series: {', '.join(r.series_ids)}")
        for f in r.figures:
            prior = "n/a" if f.prior is None else _fmt(f.prior, f.unit)
            print(f"    {f.label:<16} actual={_fmt(f.value, f.unit):>9}   prior={prior:>9}")
        print(f"  vintage: {r.vintage_note}")


def _main() -> None:
    logging.basicConfig(level=logging.INFO)
    if not os.environ.get("BEA_API_KEY"):
        print("WARNING: BEA_API_KEY is not set; the live request will fail.\n")
    print("BEA panel (PCE, core PCE, real GDP) -- live fetch:")
    _print_panel(fetch_bea_releases())


if __name__ == "__main__":
    _main()
