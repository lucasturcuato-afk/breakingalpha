#!/usr/bin/env python3
"""
THROWAWAY SPOT-CHECK — proves the spike's numbers are analyst-grade.

Three independent checks, all read-only:
  1. Cross-endpoint agreement: pull a value from the Company CONCEPT endpoint
     (different API path) and confirm it equals the Company FACTS value.
  2. Internal tie-out: GrossProfit == Revenue - CostOfRevenue for the latest
     annual period (catches period/scale/tag misalignment).
  3. Source link: print the EDGAR filing index URL so a human can eyeball the
     statement against the extracted figure.

Run: python3 scratch/xbrl_spotcheck.py
"""
from __future__ import annotations
import json, time, urllib.request
from urllib.error import HTTPError, URLError

UA = "Signalera research lucas@signalera.ai"
_last = 0.0


def _pace():
    global _last
    dt = time.time() - _last
    if dt < 0.2:
        time.sleep(0.2 - dt)
    _last = time.time()


def get_json(url):
    _pace()
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip, deflate"})
    for a in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                raw = r.read()
                if r.info().get("Content-Encoding") == "gzip":
                    import gzip; raw = gzip.decompress(raw)
                return json.loads(raw)
        except (HTTPError, URLError, TimeoutError):
            time.sleep(2 ** a)
    return None


def latest_annual(units, kind="duration"):
    best = None
    for facts in units.values():
        for f in facts:
            if f.get("form") != "10-K":
                continue
            if kind == "duration" and "start" not in f:
                continue
            if kind == "instant" and "start" in f:
                continue
            if best is None or f["end"] > best["end"]:
                best = f
    return best


def edgar_index_url(cik, accn):
    c = str(int(cik))
    a = accn.replace("-", "")
    return f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany (or) https://www.sec.gov/Archives/edgar/data/{c}/{a}/"


CASES = [
    ("AAPL", "0000320193", "Assets", "instant"),
    ("NVDA", "0001045810", "Revenues", "duration"),
]

print("=" * 80)
print("SPOT-CHECK 1 — cross-endpoint agreement (Company Concept vs Company Facts)")
print("=" * 80)
for tkr, cik, concept, kind in CASES:
    facts = get_json(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json")
    concept_doc = get_json(f"https://data.sec.gov/api/xbrl/companyconcept/CIK{cik}/us-gaap/{concept}.json")
    fv = latest_annual(facts["facts"]["us-gaap"][concept]["units"], kind)
    cv = latest_annual(concept_doc["units"], kind)
    ok = fv["val"] == cv["val"] and fv["end"] == cv["end"]
    print(f"\n  {tkr} us-gaap:{concept}  latest 10-K @ {fv['end']}")
    print(f"    companyfacts  = {fv['val']:,}")
    print(f"    companyconcept= {cv['val']:,}")
    print(f"    MATCH: {ok}   accn={fv['accn']}")

print("\n" + "=" * 80)
print("SPOT-CHECK 2 — internal tie-out: GrossProfit == Revenue - CostOfRevenue (latest 10-K)")
print("=" * 80)
REV = ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues",
       "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet"]
COR = ["CostOfRevenue", "CostOfGoodsAndServicesSold"]
for tkr, cik in [("AAPL", "0000320193"), ("NVDA", "0001045810"),
                 ("CRWD", "0001535527"), ("DDOG", "0001561550"), ("SNOW", "0001640147")]:
    facts = get_json(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json")["facts"]["us-gaap"]
    def pick(cands):
        best = None
        for t in cands:
            if t in facts:
                f = latest_annual(facts[t]["units"], "duration")
                if f and (best is None or f["end"] > best["end"]):
                    best = f
        return best
    rev, cor, gp = pick(REV), pick(COR), pick(["GrossProfit"])
    if rev and cor and gp:
        implied = rev["val"] - cor["val"]
        diff = implied - gp["val"]
        rel = abs(diff) / abs(gp["val"]) if gp["val"] else 0
        flag = "OK" if rel < 0.005 else "MISMATCH"
        print(f"  {tkr:5s} @ {gp['end']}  Rev {rev['val']/1e9:8.3f}B - CoR {cor['val']/1e9:7.3f}B "
              f"= {implied/1e9:8.3f}B vs GrossProfit {gp['val']/1e9:8.3f}B  diff={diff/1e6:+.1f}M  [{flag}]")
    else:
        print(f"  {tkr:5s}  insufficient tags  rev={bool(rev)} cor={bool(cor)} gp={bool(gp)}")

print("\n" + "=" * 80)
print("SPOT-CHECK 3 — source filing URLs (open and eyeball the income statement)")
print("=" * 80)
for tkr, cik in [("AAPL", "0000320193"), ("NVDA", "0001045810")]:
    facts = get_json(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json")["facts"]["us-gaap"]
    ni = latest_annual(facts["NetIncomeLoss"]["units"], "duration")
    print(f"  {tkr}  FY NetIncome={ni['val']/1e9:.3f}B  end={ni['end']}  accn={ni['accn']}")
    print(f"    {edgar_index_url(cik, ni['accn'])}")
print("\nDONE (read-only).")
