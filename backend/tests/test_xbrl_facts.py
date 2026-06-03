"""Unit tests for backend/edgar/xbrl_facts.py (offline, synthetic fixtures).

Run: python -m unittest backend.tests.test_xbrl_facts
"""
import unittest

from backend.edgar.xbrl_facts import (
    derive_discrete_cash_flow,
    detect_restatements,
    detect_tag_drift,
    extract_financial_facts,
)


def _raw(val, end, accn, *, start=None, fy=None, fp=None, form="10-K",
         filed=None, frame=None):
    d = {"val": val, "end": end, "accn": accn, "fy": fy, "fp": fp,
         "form": form, "filed": filed or end}
    if start:
        d["start"] = start
    if frame:
        d["frame"] = frame
    return d


def _company_facts(us_gaap):
    return {"facts": {"us-gaap": us_gaap}}


def _annual(tag_val, year, accn):
    return _raw(tag_val, f"{year}-12-31", accn, start=f"{year}-01-01",
                fy=year, fp="FY", form="10-K", filed=f"{year + 1}-02-15")


class TagResolutionTests(unittest.TestCase):
    """The NVDA failure mode: issuer migrated revenue tags; the stale tag is
    FIRST in the candidate list but must not win recent periods."""

    def setUp(self):
        self.cf = _company_facts({
            # old tag: stops at FY2022 (stale but still present)
            "RevenueFromContractWithCustomerExcludingAssessedTax": {"units": {"USD": [
                _annual(10_000, 2020, "acc-old-2020"),
                _annual(11_000, 2021, "acc-old-2021"),
                _annual(12_000, 2022, "acc-old-2022"),
            ]}},
            # new tag: active through FY2025, overlaps FY2021/FY2022
            "Revenues": {"units": {"USD": [
                _annual(11_000, 2021, "acc-new-2021"),
                _annual(12_000, 2022, "acc-new-2022"),
                _annual(13_000, 2023, "acc-new-2023"),
                _annual(99_000, 2025, "acc-new-2025"),
            ]}},
        })
        self.facts = extract_financial_facts(123, self.cf)
        self.revenue = [f for f in self.facts if f["metric_key"] == "revenue"]

    def test_latest_period_resolves_from_active_tag(self):
        latest = max(self.revenue, key=lambda f: f["period_end"])
        self.assertEqual(latest["concept_tag"], "Revenues")
        self.assertEqual(latest["value"], 99_000)

    def test_overlapping_periods_resolve_to_active_tag_only(self):
        fy2022 = [f for f in self.revenue if f["period_end"] == "2022-12-31"]
        self.assertEqual(len(fy2022), 1)
        self.assertEqual(fy2022[0]["concept_tag"], "Revenues")

    def test_periods_only_in_stale_tag_are_kept(self):
        fy2020 = [f for f in self.revenue if f["period_end"] == "2020-12-31"]
        self.assertEqual(len(fy2020), 1)
        self.assertEqual(
            fy2020[0]["concept_tag"],
            "RevenueFromContractWithCustomerExcludingAssessedTax",
        )

    def test_tag_drift_hook_fires_on_the_migration(self):
        drift = detect_tag_drift(self.facts)
        rev_drift = [d for d in drift if d["metric_key"] == "revenue"]
        self.assertEqual(len(rev_drift), 1)
        self.assertEqual(
            rev_drift[0]["from_tag"],
            "RevenueFromContractWithCustomerExcludingAssessedTax",
        )
        self.assertEqual(rev_drift[0]["to_tag"], "Revenues")


class PeriodHandlingTests(unittest.TestCase):
    def test_instant_facts_store_start_equal_end(self):
        cf = _company_facts({
            "Assets": {"units": {"USD": [
                _raw(500_000, "2025-12-31", "acc-1", fy=2025, fp="FY"),
            ]}},
        })
        facts = extract_financial_facts(123, cf)
        assets = [f for f in facts if f["metric_key"] == "total_assets"]
        self.assertEqual(len(assets), 1)
        self.assertEqual(assets[0]["period_type"], "instant")
        self.assertEqual(assets[0]["period_start"], "2025-12-31")
        self.assertEqual(assets[0]["period_end"], "2025-12-31")

    def test_non_periodic_forms_excluded(self):
        cf = _company_facts({
            "Assets": {"units": {"USD": [
                _raw(500_000, "2025-12-31", "acc-1", form="8-K"),
            ]}},
        })
        self.assertEqual(extract_financial_facts(123, cf), [])

    def test_provenance_fields_present(self):
        cf = _company_facts({
            "Assets": {"units": {"USD": [
                _raw(500_000, "2025-12-31", "0000123-25-000001",
                     fy=2025, fp="FY", frame="CY2025Q4I"),
            ]}},
        })
        f = extract_financial_facts(123, cf)[0]
        self.assertEqual(f["accession_number"], "0000123-25-000001")
        self.assertEqual(f["sec_frame"], "CY2025Q4I")
        self.assertEqual(f["fiscal_year"], 2025)
        self.assertEqual(f["fiscal_period"], "FY")
        self.assertEqual(f["cik"], 123)
        self.assertIn("sec.gov/Archives/edgar/data/123/", f["filing_url"])
        self.assertIn("000012325000001", f["filing_url"])


class YtdDifferencingTests(unittest.TestCase):
    """10-Q cash flow is cumulative YTD; discrete quarters are derived."""

    def setUp(self):
        def ocf(val, start, end, accn, form, fp):
            return {
                "metric_key": "operating_cash_flow", "taxonomy": "us-gaap",
                "concept_tag": "NetCashProvidedByUsedInOperatingActivities",
                "value": val, "unit": "USD", "period_type": "duration",
                "period_start": start, "period_end": end,
                "fiscal_year": 2025, "fiscal_period": fp, "sec_frame": None,
                "form": form, "filed_date": end, "accession_number": accn,
                "is_derived": False, "derivation": None,
            }
        self.raw = [
            ocf(100, "2025-01-01", "2025-03-31", "acc-q1", "10-Q", "Q1"),
            ocf(220, "2025-01-01", "2025-06-30", "acc-q2", "10-Q", "Q2"),
            ocf(350, "2025-01-01", "2025-09-30", "acc-q3", "10-Q", "Q3"),
            ocf(500, "2025-01-01", "2025-12-31", "acc-fy", "10-K", "FY"),
        ]
        self.derived = derive_discrete_cash_flow(self.raw)

    def test_three_discrete_quarters_derived(self):
        self.assertEqual(len(self.derived), 3)
        by_end = {f["period_end"]: f for f in self.derived}
        self.assertEqual(by_end["2025-06-30"]["value"], 120)  # Q2 = 220-100
        self.assertEqual(by_end["2025-09-30"]["value"], 130)  # Q3 = 350-220
        self.assertEqual(by_end["2025-12-31"]["value"], 150)  # Q4 = FY-9mo

    def test_derived_periods_are_discrete_quarters(self):
        q2 = next(f for f in self.derived if f["period_end"] == "2025-06-30")
        self.assertEqual(q2["period_start"], "2025-04-01")
        self.assertTrue(q2["is_derived"])
        self.assertIn("ytd_diff", q2["derivation"])

    def test_derived_cites_minuend_filing(self):
        q4 = next(f for f in self.derived if f["period_end"] == "2025-12-31")
        self.assertEqual(q4["accession_number"], "acc-fy")
        self.assertIn("acc-q3", q4["derivation"])
        self.assertIsNone(q4["sec_frame"])  # computed, not reported

    def test_non_quarter_spans_are_skipped(self):
        # missing Q2: the 9mo - 3mo diff would be a 6-month span -> skipped
        gap = [self.raw[0], self.raw[2]]
        derived = derive_discrete_cash_flow(gap)
        self.assertEqual(derived, [])

    def test_restated_ytd_uses_latest_filed_value(self):
        restated = dict(self.raw[1], value=230, accession_number="acc-q2a",
                        filed_date="2025-08-15", form="10-Q/A")
        derived = derive_discrete_cash_flow(self.raw + [restated])
        q2 = next(f for f in derived if f["period_end"] == "2025-06-30")
        self.assertEqual(q2["value"], 130)  # 230 - 100, not 220 - 100
        q3 = next(f for f in derived if f["period_end"] == "2025-09-30")
        self.assertEqual(q3["value"], 120)  # 350 - 230


class RestatementHookTests(unittest.TestCase):
    def test_restatement_detected_across_accessions(self):
        cf = _company_facts({
            "NetIncomeLoss": {"units": {"USD": [
                _raw(1_000, "2024-12-31", "acc-orig", start="2024-01-01",
                     fy=2024, fp="FY", form="10-K", filed="2025-02-15"),
                _raw(900, "2024-12-31", "acc-restated", start="2024-01-01",
                     fy=2024, fp="FY", form="10-K/A", filed="2025-06-01"),
            ]}},
        })
        facts = extract_financial_facts(123, cf)
        restatements = detect_restatements(facts)
        self.assertEqual(len(restatements), 1)
        r = restatements[0]
        self.assertEqual(r["metric_key"], "net_income")
        self.assertEqual([v["value"] for v in r["values"]], [1_000, 900])

    def test_both_accessions_are_kept(self):
        cf = _company_facts({
            "NetIncomeLoss": {"units": {"USD": [
                _raw(1_000, "2024-12-31", "acc-orig", start="2024-01-01",
                     filed="2025-02-15"),
                _raw(900, "2024-12-31", "acc-restated", start="2024-01-01",
                     form="10-K/A", filed="2025-06-01"),
            ]}},
        })
        facts = extract_financial_facts(123, cf)
        self.assertEqual(len(facts), 2)  # accession-keyed history, no collapse


if __name__ == "__main__":
    unittest.main()
