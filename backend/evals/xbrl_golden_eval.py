"""Golden-set regression eval for the XBRL extractor. THE gate for extractor
changes: if this fails, the change is wrong (or a filing was restated; verify
against the cited accession before touching a golden value).

Runs the REAL pipeline (extract + FULL validation gate, including the network
cross-endpoint reconciliation) against live SEC Company Facts for a fixed set
of companies, then asserts that known-correct values come back exact and
VALIDATED. Read-only: no DB, no writes.

The golden values were spot-verified 2026-06-03 against the cited filings
(EDGAR accessions below) and independent public figures; the spike's
spot-check additionally reconciled them against the Company Concept endpoint
to the dollar (scratch/xbrl_spotcheck_output.txt at the time; see
docs/xbrl-financial-facts-spec.md Appendix B).

Coverage is deliberate, per WD-XBRL E:
  * AAPL  - mega-cap, September FYE
  * NVDA  - mega-cap, January FYE (odd fiscal year), REVENUE TAG MIGRATION
            (Revenues, not RevenueFromContractWithCustomer...) - regression
            for the first-tag-wins bug
  * CRWD  - non-mega, January FYE, LOSS-MAKER, IncludingAssessedTax revenue tag
  * DDOG  - non-mega, calendar FYE, negative operating income w/ positive NI
  * SNOW  - non-mega, January FYE, deep loss-maker (negative EPS)
  * plus one DERIVED fact (NVDA discrete Q4 OCF) to pin YTD differencing.

Run: python -m backend.evals.xbrl_golden_eval
"""
from __future__ import annotations

import logging
import sys

from backend.edgar.xbrl_facts import extract_financial_facts, fetch_company_facts
from backend.edgar.xbrl_validation import validate_facts, validated_only

logger = logging.getLogger(__name__)

# (ticker, cik, metric_key, period_end, expected_value, expected_tag_or_None,
#  is_derived)
GOLDEN = [
    # AAPL FY2025 10-K (accn 0000320193-25-000079, FYE 2025-09-27)
    ("AAPL", 320193, "revenue", "2025-09-27", 416_161_000_000,
     "RevenueFromContractWithCustomerExcludingAssessedTax", False),
    ("AAPL", 320193, "net_income", "2025-09-27", 112_010_000_000, None, False),
    ("AAPL", 320193, "eps_diluted", "2025-09-27", 7.46, None, False),
    ("AAPL", 320193, "total_assets", "2025-09-27", 359_241_000_000, None, False),
    ("AAPL", 320193, "operating_cash_flow", "2025-09-27", 111_482_000_000,
     None, False),

    # NVDA FY2026 10-K (accn 0001045810-26-000021, FYE 2026-01-25).
    # expected_tag pins the tag-migration regression: must resolve from
    # us-gaap:Revenues, NOT the stale RevenueFromContractWithCustomer tag.
    ("NVDA", 1045810, "revenue", "2026-01-25", 215_938_000_000,
     "Revenues", False),
    ("NVDA", 1045810, "net_income", "2026-01-25", 120_067_000_000, None, False),
    ("NVDA", 1045810, "eps_diluted", "2026-01-25", 4.90, None, False),
    # derived discrete Q4 OCF = FY 102,718 - 9mo YTD (ytd_diff)
    ("NVDA", 1045810, "operating_cash_flow", "2026-01-25", 36_188_000_000,
     None, True),

    # CRWD FY2026 10-K (accn 0001535527-26-000010, FYE 2026-01-31), loss-maker
    ("CRWD", 1535527, "revenue", "2026-01-31", 4_812_005_000,
     "RevenueFromContractWithCustomerIncludingAssessedTax", False),
    ("CRWD", 1535527, "net_income", "2026-01-31", -162_502_000, None, False),
    ("CRWD", 1535527, "eps_diluted", "2026-01-31", -0.65, None, False),

    # DDOG FY2025 10-K (accn 0001628280-26-008819, calendar FYE)
    ("DDOG", 1561550, "net_income", "2025-12-31", 107_741_000, None, False),
    ("DDOG", 1561550, "eps_diluted", "2025-12-31", 0.31, None, False),
    ("DDOG", 1561550, "total_assets", "2025-12-31", 6_643_844_000, None, False),

    # SNOW FY2026 10-K (accn 0001640147-26-000008, FYE 2026-01-31), deep loss
    ("SNOW", 1640147, "revenue", "2026-01-31", 4_683_946_000, None, False),
    ("SNOW", 1640147, "net_income", "2026-01-31", -1_331_616_000, None, False),
    ("SNOW", 1640147, "eps_diluted", "2026-01-31", -3.95, None, False),
]

# Fiscal-LABEL golden set: fiscal_year/fiscal_period must describe the row's
# OWN period (period-derived), not the filing it was extracted from.
# (ticker, metric_key, period_start, period_end, expected_value,
#  expected_fiscal_year, expected_fiscal_period)
LABEL_GOLDEN = [
    # comparative annuals must keep their own year, not the filing's
    ("AAPL", "revenue", "2023-10-01", "2024-09-28", 391_035_000_000, 2024, "FY"),
    ("NVDA", "revenue", "2024-01-29", "2025-01-26", 130_497_000_000, 2025, "FY"),
    ("NVDA", "revenue", "2025-01-27", "2026-01-25", 215_938_000_000, 2026, "FY"),
    # in-progress fiscal year (no FY2027 10-K exists yet): extrapolated window
    ("NVDA", "revenue", "2026-01-26", "2026-04-26", 81_615_000_000, 2027, "Q1"),
    # YTD vs discrete sharing one period_end must NOT both read Q2
    ("AAPL", "net_income", "2025-09-28", "2026-03-28", 71_675_000_000, 2026, "6M"),
    ("AAPL", "net_income", "2025-12-28", "2026-03-28", 29_578_000_000, 2026, "Q2"),
    # FYE balance re-reported in next year's 10-Q stays the FY balance
    ("AAPL", "total_assets", "2025-09-27", "2025-09-27", 359_241_000_000, 2025, "FY"),
]

EPS_EXACT_TOL = 1e-9  # XBRL values are exact decimals; this is float noise only


def _find(validated, metric_key, period_end, is_derived):
    rows = [
        f for f in validated
        if f["metric_key"] == metric_key
        and f["period_end"] == period_end
        and f["is_derived"] == is_derived
        and (f["period_type"] == "instant"
             or not is_derived and f["form"].startswith("10-K")
             or is_derived)
    ]
    if not rows:
        return None
    # restatement-aware: latest filed wins
    return max(rows, key=lambda f: (f["filed_date"] or "", f["period_start"]))


def run() -> int:
    ciks = {}
    for t, cik, *_ in GOLDEN:
        ciks[t] = cik

    print("=" * 88)
    print("XBRL GOLDEN-SET EVAL  (live Company Facts, FULL gate incl. "
          "cross-endpoint reconciliation)")
    print("=" * 88)

    validated_by_ticker = {}
    print("\n-- dry-run: validated vs quarantined per ticker --")
    for ticker, cik in ciks.items():
        cf = fetch_company_facts(cik)
        if not cf:
            print(f"  {ticker:5s} FETCH FAILED")
            continue
        facts = extract_financial_facts(cik, cf)
        summary = validate_facts(facts, cik)  # full gate, network cross-check
        validated_by_ticker[ticker] = validated_only(facts)
        print(f"  {ticker:5s} extracted={summary['total']:5d}  "
              f"validated={summary['validated']:5d}  "
              f"quarantined={summary['quarantined']:4d}  "
              f"reasons={summary['reasons'] or '-'}")

    print("\n-- golden assertions --")
    failures = 0
    for ticker, cik, metric_key, period_end, expected, expected_tag, derived in GOLDEN:
        validated = validated_by_ticker.get(ticker, [])
        f = _find(validated, metric_key, period_end, derived)
        label = f"{ticker} {metric_key}@{period_end}" + (" [derived]" if derived else "")
        if f is None:
            print(f"  FAIL {label}: no VALIDATED fact found")
            failures += 1
            continue
        ok_val = (abs(f["value"] - expected) <= EPS_EXACT_TOL
                  if isinstance(expected, float)
                  else f["value"] == expected)
        ok_tag = expected_tag is None or f["concept_tag"] == expected_tag
        if ok_val and ok_tag:
            print(f"  PASS {label}: {f['value']:,} "
                  f"({f['concept_tag']}, accn={f['accession_number']})")
        else:
            failures += 1
            if not ok_val:
                print(f"  FAIL {label}: got {f['value']:,}, expected {expected:,}")
            if not ok_tag:
                print(f"  FAIL {label}: resolved tag {f['concept_tag']}, "
                      f"expected {expected_tag}")

    print("\n-- fiscal-label assertions (period-derived, not filing fy/fp) --")
    label_failures = 0
    for ticker, metric_key, ps, pe, exp_val, exp_fy, exp_fp in LABEL_GOLDEN:
        validated = validated_by_ticker.get(ticker, [])
        rows = [f for f in validated
                if f["metric_key"] == metric_key
                and f["period_start"] == ps and f["period_end"] == pe
                and not f["is_derived"]]
        label = f"{ticker} {metric_key} {ps}->{pe}"
        if not rows:
            print(f"  FAIL {label}: no VALIDATED fact found")
            label_failures += 1
            continue
        f = max(rows, key=lambda r: r["filed_date"] or "")
        ok_val = f["value"] == exp_val
        ok_lbl = (f["fiscal_year"], f["fiscal_period"]) == (exp_fy, exp_fp)
        if ok_val and ok_lbl:
            print(f"  PASS {label}: {f['value']:,} -> {exp_fy}/{exp_fp}")
        else:
            label_failures += 1
            if not ok_val:
                print(f"  FAIL {label}: value {f['value']:,} != {exp_val:,}")
            if not ok_lbl:
                print(f"  FAIL {label}: labeled {f['fiscal_year']}/"
                      f"{f['fiscal_period']}, expected {exp_fy}/{exp_fp}")

    print("\n" + "=" * 88)
    total = len(GOLDEN) + len(LABEL_GOLDEN)
    if failures or label_failures:
        print(f"GOLDEN EVAL FAILED: {failures + label_failures}/{total} "
              "assertions failed")
        return 1
    print(f"GOLDEN EVAL PASSED: {total}/{total} assertions exact and validated "
          f"({len(GOLDEN)} values, {len(LABEL_GOLDEN)} labels)")
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING,
                        format="%(asctime)s [%(levelname)s] %(message)s")
    sys.exit(run())
