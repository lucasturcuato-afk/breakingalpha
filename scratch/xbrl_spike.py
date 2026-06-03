#!/usr/bin/env python3
"""
THROWAWAY READ-ONLY SPIKE — NOT production code.

Validates the "SEC Company Facts JSON" source strategy for analyst-grade
financial extraction. Reads ONLY public SEC APIs (no auth, no DB, no writes)
and prints extracted v1 line items with full provenance, then reports
coverage and gaps.

Run:  python3 scratch/xbrl_spike.py
Docs: companyfacts -> https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json

Nothing here is imported by the app. Safe to delete.
"""
from __future__ import annotations

import json
import sys
import time
import urllib.request
from urllib.error import HTTPError, URLError

# Matches backend/edgar/client.py convention (SEC requires a real UA).
USER_AGENT = "Signalera research lucas@signalera.ai"
PACING_SEC = 0.2  # 5 req/s, half of SEC's 10/s ceiling

# Mix of mega-caps + non-mega-caps + varied fiscal-year ends to stress
# fiscal alignment and tag variation:
#   AAPL  Sep FYE   NVDA  Jan FYE   CRWD  Jan FYE
#   DDOG  Dec FYE   SNOW  Jan FYE (loss-making -> negative EPS / net income)
TICKERS = ["AAPL", "NVDA", "CRWD", "DDOG", "SNOW"]

# v1 line items. Each maps to an ORDERED list of candidate us-gaap tags;
# first one present wins. `kind` is duration (flow) or instant (stock).
CONCEPTS = [
    ("Revenue", "duration", [
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "Revenues",
        "RevenueFromContractWithCustomerIncludingAssessedTax",
        "SalesRevenueNet",
    ]),
    ("CostOfRevenue", "duration", [
        "CostOfRevenue",
        "CostOfGoodsAndServicesSold",
    ]),
    ("GrossProfit", "duration", ["GrossProfit"]),
    ("OperatingIncome", "duration", ["OperatingIncomeLoss"]),
    ("NetIncome", "duration", ["NetIncomeLoss"]),
    ("EPS_Basic", "duration", ["EarningsPerShareBasic"]),
    ("EPS_Diluted", "duration", ["EarningsPerShareDiluted"]),
    ("OperatingCashFlow", "duration", [
        "NetCashProvidedByUsedInOperatingActivities",
        "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
    ]),
    ("TotalAssets", "instant", ["Assets"]),
    ("TotalLiabilities", "instant", ["Liabilities"]),
    ("StockholdersEquity", "instant", [
        "StockholdersEquity",
        "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
    ]),
    ("CashAndEquivalents", "instant", ["CashAndCashEquivalentsAtCarryingValue"]),
]

_last = 0.0


def _pace():
    global _last
    dt = time.time() - _last
    if dt < PACING_SEC:
        time.sleep(PACING_SEC - dt)
    _last = time.time()


def get_json(url: str):
    _pace()
    req = urllib.request.Request(url, headers={
        "User-Agent": USER_AGENT,
        "Accept-Encoding": "gzip, deflate",
    })
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                raw = r.read()
                if r.info().get("Content-Encoding") == "gzip":
                    import gzip
                    raw = gzip.decompress(raw)
                return json.loads(raw)
        except HTTPError as e:
            if e.code in (429, 503):
                time.sleep(2 ** attempt)
                continue
            print(f"  ! HTTP {e.code} on {url}")
            return None
        except (URLError, TimeoutError) as e:
            time.sleep(2 ** attempt)
    return None


def resolve_ciks(tickers):
    """ticker -> 10-digit CIK via SEC's company_tickers.json."""
    data = get_json("https://www.sec.gov/files/company_tickers.json")
    if not data:
        return {}
    by_ticker = {}
    for row in data.values():
        by_ticker[row["ticker"].upper()] = (int(row["cik_str"]), row["title"])
    out = {}
    for t in tickers:
        if t in by_ticker:
            cik, name = by_ticker[t]
            out[t] = (str(cik).zfill(10), name)
    return out


def pick_latest(units_block, kind, form_filter):
    """
    From a us-gaap concept's units block, choose the most relevant fact.
    Returns (fact_dict, unit_key) or (None, None).

    For duration facts we prefer the *discrete* period (shortest span) so we
    report the quarter, not cumulative YTD; for annual we want ~full year.
    """
    best = None
    best_unit = None
    for unit_key, facts in units_block.items():
        for f in facts:
            if form_filter and f.get("form") not in form_filter:
                continue
            if kind == "instant" and "start" in f:
                continue
            if kind == "duration" and "start" not in f:
                continue
            f = dict(f, _unit=unit_key)
            if best is None:
                best, best_unit = f, unit_key
                continue
            # primary sort: most recent end date
            if f["end"] > best["end"]:
                best, best_unit = f, unit_key
            elif f["end"] == best["end"] and kind == "duration":
                # tie on end -> prefer shorter span (discrete quarter for 10-Q,
                # full year for 10-K we approximate by longest span instead)
                span_f = _span_days(f)
                span_b = _span_days(best)
                if "10-K" in (form_filter or []):
                    if span_f > span_b:
                        best, best_unit = f, unit_key
                else:
                    if span_f < span_b:
                        best, best_unit = f, unit_key
    return best, best_unit


def _span_days(f):
    from datetime import date
    try:
        s = date.fromisoformat(f["start"])
        e = date.fromisoformat(f["end"])
        return (e - s).days
    except Exception:
        return 0


def fmt_val(name, val, unit):
    if val is None:
        return "—"
    if unit and unit.startswith("USD") and "PerShare" not in unit and "EPS" not in name:
        # scale large currency for readability
        if abs(val) >= 1e9:
            return f"${val/1e9:,.3f}B  ({unit})"
        if abs(val) >= 1e6:
            return f"${val/1e6:,.3f}M  ({unit})"
        return f"${val:,.0f}  ({unit})"
    return f"{val:,.4g}  ({unit})"


def prov(f):
    if not f:
        return ""
    period = f"{f.get('start','(instant)')}->{f['end']}" if "start" in f else f"@ {f['end']}"
    frame = f.get("frame", "-")
    return (f"fy={f.get('fy')} fp={f.get('fp')} form={f.get('form')} "
            f"period[{period}] accn={f.get('accn')} filed={f.get('filed')} frame={frame}")


def extract_for(facts_us_gaap, name, kind, candidates, form_filter):
    """
    Union ALL candidate tags, then pick the fact with the latest period.

    First-tag-wins is WRONG: issuers migrate tags over time (e.g. NVDA moved
    revenue from RevenueFromContractWithCustomerExcludingAssessedTax to
    Revenues). The old tag still carries stale facts, so first-tag-wins would
    return a years-old value. Period-latest across the union is the fix.
    """
    best = None  # (tag, fact, unit)
    for tag in candidates:
        if tag not in facts_us_gaap:
            continue
        units = facts_us_gaap[tag].get("units", {})
        f, unit = pick_latest(units, kind, form_filter)
        if not f:
            continue
        if best is None or f["end"] > best[1]["end"]:
            best = (tag, f, unit)
    if best:
        return best
    return None, None, None


def run():
    print("=" * 92)
    print("SEC XBRL Company Facts SPIKE — read-only, public API, no DB writes")
    print("=" * 92)
    ciks = resolve_ciks(TICKERS)
    missing = [t for t in TICKERS if t not in ciks]
    if missing:
        print(f"\n[warn] could not resolve CIK for: {missing}")

    coverage = {name: {"annual": 0, "quarterly": 0} for name, _, _ in CONCEPTS}
    n = 0

    for ticker in TICKERS:
        if ticker not in ciks:
            continue
        n += 1
        cik, company = ciks[ticker]
        print(f"\n{'#'*92}\n# {ticker}  ({company})   CIK {cik}\n{'#'*92}")
        cf = get_json(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json")
        if not cf:
            print("  ! companyfacts fetch failed")
            continue
        facts = cf.get("facts", {})
        us_gaap = facts.get("us-gaap", {})
        dei = facts.get("dei", {})
        print(f"  taxonomies present: {list(facts.keys())}  "
              f"| #us-gaap concepts tagged: {len(us_gaap)}  | #dei: {len(dei)}")

        for period_label, form_filter in (("LATEST ANNUAL (10-K)", ["10-K"]),
                                          ("LATEST QUARTER (10-Q)", ["10-Q"])):
            print(f"\n  --- {period_label} ---")
            row_vals = {}
            for name, kind, candidates in CONCEPTS:
                tag, f, unit = extract_for(us_gaap, name, kind, candidates, form_filter)
                if f:
                    row_vals[name] = (f["val"], unit)
                    if "ANNUAL" in period_label:
                        coverage[name]["annual"] += 1
                    else:
                        coverage[name]["quarterly"] += 1
                    print(f"    {name:20s} {fmt_val(name, f['val'], unit):28s} "
                          f"<- us-gaap:{tag}")
                    print(f"      {prov(f)}")
                else:
                    print(f"    {name:20s} {'— NOT FOUND —':28s} (tried {candidates})")
            # derived metric: gross margin
            rev = row_vals.get("Revenue")
            gp = row_vals.get("GrossProfit")
            cor = row_vals.get("CostOfRevenue")
            if rev and gp and rev[0]:
                print(f"    {'GrossMargin(derived)':20s} {gp[0]/rev[0]*100:,.2f}%  "
                      f"(GrossProfit/Revenue)")
            elif rev and cor and rev[0]:
                print(f"    {'GrossMargin(derived)':20s} {(rev[0]-cor[0])/rev[0]*100:,.2f}%  "
                      f"((Rev-CoR)/Rev)")

        # SEGMENTS probe — Company Facts collapses dimensions; demonstrate the gap.
        seg_like = [k for k in us_gaap
                    if "Segment" in k or "ReportableSegment" in k]
        print(f"\n  --- SEGMENTS probe ---")
        print(f"    us-gaap keys containing 'Segment': {seg_like if seg_like else 'none'}")
        print("    NOTE: Company Facts returns only the consolidated value per concept;")
        print("    per-segment (dimensional) breakdowns are NOT present here.")

    # ---- coverage summary
    print(f"\n{'='*92}\nCOVERAGE SUMMARY across {n} companies (count with a value found)\n{'='*92}")
    print(f"  {'concept':22s} {'annual':>8s} {'quarterly':>10s}")
    for name, _, _ in CONCEPTS:
        c = coverage[name]
        print(f"  {name:22s} {c['annual']:>6d}/{n} {c['quarterly']:>8d}/{n}")
    print("\nDONE. (read-only; nothing written)")


if __name__ == "__main__":
    sys.exit(run())
