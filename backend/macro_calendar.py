"""Macro data layer (Stage 1a, BLS-only): a STANDING panel of the latest U.S.
economic prints, framed the way the headline/press frames them.

This stage is data-only. There is NO calendar, NO release-day detection, and NO
lead reordering (those are later stages). It always returns the latest available
print per release. It makes NO model calls. It is fail-soft: any failed or
partial fetch yields an empty/partial result the panel can skip; it never raises
into a pipeline run.

Stage 2 (NOT done here) will prepend a directive to the synthesis system prompt,
mirroring the precedent at synthesize.py:1282
(`system = market_tape.build_tape_directive(tape) + system`).

BLS API v2 contract (provided as verified):
  POST https://api.bls.gov/publicAPI/v2/timeseries/data/  (Content-Type: application/json)
  body: {"seriesid":[...], "startyear","endyear", "calculations": true,
         "registrationkey": <env BLS_API_KEY, included only when set>}
  response: {status, responseTime, message,
             Results:{series:[{seriesID, data:[{year, period("M01".."M12"),
               periodName, value, footnotes:[...],
               calculations:{net_changes:{"1","3","6","12"},
                             pct_changes:{"1","3","6","12"}}}]}]}}
  Latest observation = the first data element (BLS returns most-recent-first);
  we additionally sort defensively by (year, month) descending.

Series IDs and SA/NSA routing are documented per release below. Confidence is
marked confirmed vs assumed; assumed ids are VERIFY-LIVE (see CONFIDENCE).

Live verification (run with BLS_API_KEY set):
  python -m backend.macro_calendar
"""

from __future__ import annotations

import datetime
import logging
import os
from dataclasses import dataclass, field
from typing import Optional

import requests

logger = logging.getLogger(__name__)

BLS_API_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/"

# ── Series IDs ────────────────────────────────────────────────────────────────
# CPI-U: CUSR = seasonally adjusted (SA), CUUR = not seasonally adjusted (NSA),
# 0000 = U.S. city average, SA0 = all items, ...SA0L1E = all items less food and
# energy (core). Headline framing: m/m uses SA, 12-month (y/y) uses NSA.
CPI_MM_SA = "CUSR0000SA0"        # confirmed: CPI all items, SA  -> m/m
CPI_YY_NSA = "CUUR0000SA0"       # confirmed: CPI all items, NSA -> y/y
CORE_CPI_MM_SA = "CUSR0000SA0L1E"  # ASSUMED (VERIFY-LIVE): core CPI, SA  -> m/m
CORE_CPI_YY_NSA = "CUUR0000SA0L1E"  # ASSUMED (VERIFY-LIVE): core CPI, NSA -> y/y
PAYROLLS_SA = "CES0000000001"    # confirmed: total nonfarm, SA, level (thousands)
UNEMPLOYMENT_SA = "LNS14000000"  # confirmed: unemployment rate, SA (percent)
PPI_MM_SA = "WPSFD4"             # ASSUMED (VERIFY-LIVE): PPI final demand, SA  -> m/m
PPI_YY_NSA = "WPUFD4"            # ASSUMED (VERIFY-LIVE): PPI final demand, NSA -> y/y

# Confidence per series id, surfaced to the PR/morning check.
CONFIDENCE: dict[str, str] = {
    CPI_MM_SA: "confirmed",
    CPI_YY_NSA: "confirmed",
    CORE_CPI_MM_SA: "assumed (VERIFY-LIVE: core-CPI L1E id)",
    CORE_CPI_YY_NSA: "assumed (VERIFY-LIVE: core-CPI L1E id)",
    PAYROLLS_SA: "confirmed",
    UNEMPLOYMENT_SA: "confirmed",
    PPI_MM_SA: "assumed (VERIFY-LIVE: PPI final demand SA id)",
    PPI_YY_NSA: "assumed (VERIFY-LIVE: PPI final demand NSA id)",
}

ALL_SERIES = [
    CPI_MM_SA, CPI_YY_NSA, CORE_CPI_MM_SA, CORE_CPI_YY_NSA,
    PAYROLLS_SA, UNEMPLOYMENT_SA, PPI_MM_SA, PPI_YY_NSA,
]

_VINTAGE = (
    "BLS revises the prior 1-2 months; 'prior' is BLS's current value for the "
    "preceding period and may itself be revised, not the originally-reported print."
)


# ── Typed result ──────────────────────────────────────────────────────────────
@dataclass
class MacroFigure:
    label: str               # e.g. "m/m (SA)", "y/y (NSA)", "change", "level", "rate"
    value: Optional[float]
    unit: str                # "%", "K" (thousands of jobs), "pp" (percentage points)
    prior: Optional[float]


@dataclass
class MacroRelease:
    key: str                 # "cpi", "core_cpi", "nonfarm_payrolls", "unemployment", "ppi"
    name: str                # "CPI"
    period: str              # "May 2026"
    figures: list[MacroFigure]
    vintage_note: str
    confidence: str          # "confirmed" | "assumed (VERIFY-LIVE...)"
    series_ids: list[str] = field(default_factory=list)
    footnotes: list[str] = field(default_factory=list)


# ── Pure parsing helpers (no network; unit-tested against fixtures) ───────────
def _month_num(period: Optional[str]) -> Optional[int]:
    """'M01'..'M12' -> 1..12. Annual ('M13') and malformed -> None (skipped)."""
    if not period or len(period) != 3 or period[0] != "M":
        return None
    try:
        n = int(period[1:])
    except ValueError:
        return None
    return n if 1 <= n <= 12 else None


def _monthly_sorted(series_data: Optional[list]) -> list:
    """Monthly observations (M01-M12), newest first, sorted defensively by
    (year, month) descending. Drops annual averages and malformed periods."""
    if not series_data:
        return []
    rows = []
    for obs in series_data:
        if not isinstance(obs, dict):
            continue
        m = _month_num(obs.get("period"))
        try:
            y = int(obs.get("year"))
        except (TypeError, ValueError):
            continue
        if m is None:
            continue
        rows.append((y, m, obs))
    rows.sort(key=lambda t: (t[0], t[1]), reverse=True)
    return [obs for _, _, obs in rows]


def _latest_two(series_data: Optional[list]) -> tuple[Optional[dict], Optional[dict]]:
    rows = _monthly_sorted(series_data)
    latest = rows[0] if len(rows) >= 1 else None
    prior = rows[1] if len(rows) >= 2 else None
    return latest, prior


def _period_label(obs: Optional[dict]) -> str:
    if not obs:
        return ""
    name = (obs.get("periodName") or "").strip()
    year = str(obs.get("year") or "").strip()
    return f"{name} {year}".strip()


def _to_float(raw) -> Optional[float]:
    if raw is None:
        return None
    try:
        return float(str(raw).replace(",", ""))
    except (TypeError, ValueError):
        return None


def _value(obs: Optional[dict]) -> Optional[float]:
    return _to_float(obs.get("value")) if obs else None


def _pct_change(obs: Optional[dict], key: str) -> Optional[float]:
    """calculations.pct_changes[key]; None if calculations absent (fail-soft)."""
    if not obs:
        return None
    calc = obs.get("calculations") or {}
    return _to_float((calc.get("pct_changes") or {}).get(key))


def _net_change(obs: Optional[dict], key: str) -> Optional[float]:
    if not obs:
        return None
    calc = obs.get("calculations") or {}
    return _to_float((calc.get("net_changes") or {}).get(key))


def _footnotes(obs: Optional[dict]) -> list[str]:
    if not obs:
        return []
    out = []
    for fn in obs.get("footnotes") or []:
        if isinstance(fn, dict):
            text = fn.get("text") or fn.get("code")
            if text:
                out.append(str(text))
    return out


def _confidence_for(ids: list[str]) -> str:
    """A release is 'confirmed' only if every series it uses is confirmed."""
    return (
        "confirmed"
        if all(CONFIDENCE.get(i) == "confirmed" for i in ids)
        else next((CONFIDENCE[i] for i in ids if CONFIDENCE.get(i) != "confirmed"), "assumed")
    )


def _has_any_value(figs: list[MacroFigure]) -> bool:
    return any(f.value is not None for f in figs)


def _index_series(raw: dict) -> dict[str, list]:
    """seriesID -> data list, from a BLS v2 response. Tolerant of partial data."""
    out: dict[str, list] = {}
    results = (raw or {}).get("Results") or {}
    for s in results.get("series") or []:
        if isinstance(s, dict) and s.get("seriesID"):
            out[s["seriesID"]] = s.get("data") or []
    return out


# ── Release builders ─────────────────────────────────────────────────────────
def _build_index_release(
    series_by_id: dict[str, list],
    key: str,
    name: str,
    sa_id: str,
    nsa_id: str,
) -> Optional[MacroRelease]:
    """CPI / core CPI / PPI: m/m from the SA series, y/y from the NSA series."""
    sa_latest, sa_prior = _latest_two(series_by_id.get(sa_id))
    nsa_latest, nsa_prior = _latest_two(series_by_id.get(nsa_id))
    if sa_latest is None and nsa_latest is None:
        return None
    figures = [
        MacroFigure("m/m (SA)", _pct_change(sa_latest, "1"), "%", _pct_change(sa_prior, "1")),
        MacroFigure("y/y (NSA)", _pct_change(nsa_latest, "12"), "%", _pct_change(nsa_prior, "12")),
    ]
    if not _has_any_value(figures):
        return None
    period = _period_label(sa_latest) or _period_label(nsa_latest)
    return MacroRelease(
        key=key, name=name, period=period, figures=figures,
        vintage_note=_VINTAGE, confidence=_confidence_for([sa_id, nsa_id]),
        series_ids=[sa_id, nsa_id],
        footnotes=_footnotes(sa_latest) + _footnotes(nsa_latest),
    )


def _build_payrolls(series_by_id: dict[str, list]) -> Optional[MacroRelease]:
    latest, prior = _latest_two(series_by_id.get(PAYROLLS_SA))
    if latest is None:
        return None
    figures = [
        MacroFigure("m/m change (SA)", _net_change(latest, "1"), "K", _net_change(prior, "1")),
        MacroFigure("level (SA)", _value(latest), "K", _value(prior)),
    ]
    if not _has_any_value(figures):
        return None
    return MacroRelease(
        key="nonfarm_payrolls", name="Nonfarm payrolls",
        period=_period_label(latest), figures=figures,
        vintage_note=_VINTAGE, confidence=_confidence_for([PAYROLLS_SA]),
        series_ids=[PAYROLLS_SA], footnotes=_footnotes(latest),
    )


def _build_unemployment(series_by_id: dict[str, list]) -> Optional[MacroRelease]:
    latest, prior = _latest_two(series_by_id.get(UNEMPLOYMENT_SA))
    if latest is None:
        return None
    rate = _value(latest)
    prior_rate = _value(prior)
    # change vs prior in percentage points: prefer net_changes, else compute.
    change = _net_change(latest, "1")
    if change is None and rate is not None and prior_rate is not None:
        change = round(rate - prior_rate, 2)
    figures = [
        MacroFigure("rate (SA)", rate, "%", prior_rate),
        MacroFigure("change vs prior", change, "pp", None),
    ]
    if not _has_any_value(figures):
        return None
    return MacroRelease(
        key="unemployment", name="Unemployment rate",
        period=_period_label(latest), figures=figures,
        vintage_note=_VINTAGE, confidence=_confidence_for([UNEMPLOYMENT_SA]),
        series_ids=[UNEMPLOYMENT_SA], footnotes=_footnotes(latest),
    )


def build_releases(series_by_id: dict[str, list]) -> list[MacroRelease]:
    """Assemble all in-scope releases from indexed series. Skips any release
    whose series are missing or unparseable (fail-soft, partial-OK)."""
    builders = [
        lambda: _build_index_release(series_by_id, "cpi", "CPI", CPI_MM_SA, CPI_YY_NSA),
        lambda: _build_index_release(series_by_id, "core_cpi", "Core CPI", CORE_CPI_MM_SA, CORE_CPI_YY_NSA),
        lambda: _build_payrolls(series_by_id),
        lambda: _build_unemployment(series_by_id),
        lambda: _build_index_release(series_by_id, "ppi", "PPI final demand", PPI_MM_SA, PPI_YY_NSA),
    ]
    out: list[MacroRelease] = []
    for b in builders:
        try:
            rel = b()
        except Exception as e:  # one bad release never sinks the panel
            logger.warning("macro release build failed: %s", e)
            rel = None
        if rel is not None:
            out.append(rel)
    return out


# ── HTTP fetch (network; wraps the pure parser) ──────────────────────────────
def _post_bls(series_ids: list[str], timeout: int) -> Optional[dict]:
    """One batched POST. Returns the parsed JSON dict, or None on any failure."""
    now_year = datetime.date.today().year
    body = {
        "seriesid": series_ids,
        "startyear": str(now_year - 1),
        "endyear": str(now_year),
        "calculations": True,
    }
    key = os.environ.get("BLS_API_KEY")
    if key:
        body["registrationkey"] = key
    else:
        logger.warning(
            "BLS_API_KEY not set: calculations may be unavailable and rate limits tighter"
        )
    try:
        resp = requests.post(
            BLS_API_URL,
            json=body,
            headers={"Content-Type": "application/json"},
            timeout=timeout,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        logger.warning("BLS request failed: %s", e)
        return None
    if data.get("status") != "REQUEST_SUCCEEDED":
        logger.warning("BLS status=%s message=%s", data.get("status"), data.get("message"))
        # Still attempt to parse any Results that came back (partial-OK).
    return data


def fetch_macro_releases(timeout: int = 10) -> list[MacroRelease]:
    """Standing panel: the latest available print per in-scope release.

    Fail-soft: returns [] on total failure and a partial list when only some
    series resolve. Never raises into a pipeline run. No model calls.
    """
    try:
        raw = _post_bls(ALL_SERIES, timeout)
        if not raw:
            return []
        return build_releases(_index_series(raw))
    except Exception as e:
        logger.warning("fetch_macro_releases failed: %s", e)
        return []


# ── Standalone harness: python -m backend.macro_calendar ─────────────────────
def _fmt(value: Optional[float], unit: str) -> str:
    if value is None:
        return "n/a"
    if unit == "K":
        return f"{value:+,.0f}K" if value < 0 or abs(value) < 100000 else f"{value:,.0f}K"
    if unit == "pp":
        return f"{value:+.1f}pp"
    return f"{value:.1f}%"


def _print_panel(releases: list[MacroRelease]) -> None:
    if not releases:
        print("(macro panel empty: no releases resolved -- check BLS_API_KEY and connectivity)")
        return
    for r in releases:
        print(f"\n{r.name}  [{r.period or 'period n/a'}]  ({r.confidence})")
        print(f"  series: {', '.join(r.series_ids)}")
        for f in r.figures:
            prior = "n/a" if f.prior is None else _fmt(f.prior, f.unit)
            print(f"    {f.label:<18} actual={_fmt(f.value, f.unit):>10}   prior={prior:>10}")
        if r.footnotes:
            print(f"  footnotes: {'; '.join(r.footnotes)}")
        print(f"  vintage: {r.vintage_note}")


def _main() -> None:
    logging.basicConfig(level=logging.INFO)
    if not os.environ.get("BLS_API_KEY"):
        print("WARNING: BLS_API_KEY is not set; the live request may fail or omit calculations.\n")
    print("Macro panel (Stage 1a, BLS-only) -- live fetch:")
    _print_panel(fetch_macro_releases())


if __name__ == "__main__":
    _main()
