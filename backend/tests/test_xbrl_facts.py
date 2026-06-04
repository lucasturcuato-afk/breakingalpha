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
            # annual fact anchors the fiscal calendar for the instant's label
            "Revenues": {"units": {"USD": [
                _raw(1_000_000, "2025-12-31", "0000123-25-000001",
                     start="2025-01-01", fy=2025, fp="FY", form="10-K",
                     filed="2026-02-15"),
            ]}},
            "Assets": {"units": {"USD": [
                _raw(500_000, "2025-12-31", "0000123-25-000001",
                     fy=2025, fp="FY", frame="CY2025Q4I", filed="2026-02-15"),
            ]}},
        })
        f = next(x for x in extract_financial_facts(123, cf)
                 if x["metric_key"] == "total_assets")
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


class FiscalLabelingTests(unittest.TestCase):
    """fiscal_year/fiscal_period must describe the fact's OWN period, never
    the filing's fy/fp (which mislabels comparatives and conflates YTD with
    the discrete quarter)."""

    def setUp(self):
        # AAPL-like September FYE.
        # FY2024 annual appears twice: original FY2024 10-K (fy=2024) and as
        # the comparative inside the FY2025 10-K (fy=2025 - the SEC label that
        # used to leak through).
        fy24 = dict(start="2023-10-01", end="2024-09-28")
        fy25 = dict(start="2024-09-29", end="2025-09-27")
        self.cf = _company_facts({
            "Revenues": {"units": {"USD": [
                _raw(100, fy24["end"], "acc-10k-24", start=fy24["start"],
                     fy=2024, fp="FY", form="10-K", filed="2024-11-01"),
                _raw(100, fy24["end"], "acc-10k-25", start=fy24["start"],
                     fy=2025, fp="FY", form="10-K", filed="2025-10-31"),
                _raw(120, fy25["end"], "acc-10k-25", start=fy25["start"],
                     fy=2025, fp="FY", form="10-K", filed="2025-10-31"),
            ]}},
            "NetIncomeLoss": {"units": {"USD": [
                # FY2026 10-Q: discrete Q2 and 6-month YTD share period_end
                _raw(30, "2026-03-28", "acc-10q-26", start="2025-12-28",
                     fy=2026, fp="Q2", form="10-Q", filed="2026-05-01"),
                _raw(70, "2026-03-28", "acc-10q-26", start="2025-09-28",
                     fy=2026, fp="Q2", form="10-Q", filed="2026-05-01"),
            ]}},
            "Assets": {"units": {"USD": [
                # FYE balance reported in the original 10-K AND re-reported in
                # next year's Q2 10-Q (SEC labels it fy=2026 fp=Q2 there)
                _raw(900, "2025-09-27", "acc-10k-25",
                     fy=2025, fp="FY", form="10-K", filed="2025-10-31"),
                _raw(900, "2025-09-27", "acc-10q-26",
                     fy=2026, fp="Q2", form="10-Q", filed="2026-05-01"),
                # quarter-end balance
                _raw(910, "2026-03-28", "acc-10q-26",
                     fy=2026, fp="Q2", form="10-Q", filed="2026-05-01"),
            ]}},
        })
        self.facts = extract_financial_facts(123, self.cf)

    def _one(self, metric, start, end):
        rows = [f for f in self.facts if f["metric_key"] == metric
                and f["period_start"] == start and f["period_end"] == end]
        self.assertTrue(rows, f"no fact {metric} {start}->{end}")
        return rows

    def test_comparative_annual_labeled_by_its_own_year(self):
        # both instances of the FY2024 period (incl. the one from the FY2025
        # 10-K) must read 2024/FY
        for f in self._one("revenue", "2023-10-01", "2024-09-28"):
            self.assertEqual((f["fiscal_year"], f["fiscal_period"]), (2024, "FY"),
                             f"accn={f['accession_number']}")

    def test_current_annual_labeled_correctly(self):
        for f in self._one("revenue", "2024-09-29", "2025-09-27"):
            self.assertEqual((f["fiscal_year"], f["fiscal_period"]), (2025, "FY"))

    def test_ytd_and_discrete_quarter_are_distinct(self):
        (q,) = self._one("net_income", "2025-12-28", "2026-03-28")
        (ytd,) = self._one("net_income", "2025-09-28", "2026-03-28")
        self.assertEqual((q["fiscal_year"], q["fiscal_period"]), (2026, "Q2"))
        self.assertEqual((ytd["fiscal_year"], ytd["fiscal_period"]), (2026, "6M"))
        self.assertNotEqual(q["fiscal_period"], ytd["fiscal_period"])

    def test_fye_balance_is_fy_even_when_rereported_in_a_10q(self):
        for f in self._one("total_assets", "2025-09-27", "2025-09-27"):
            self.assertEqual((f["fiscal_year"], f["fiscal_period"]), (2025, "FY"),
                             f"accn={f['accession_number']}")

    def test_quarter_end_balance_labeled_by_quarter(self):
        (f,) = self._one("total_assets", "2026-03-28", "2026-03-28")
        self.assertEqual((f["fiscal_year"], f["fiscal_period"]), (2026, "Q2"))

    def test_forward_extrapolation_beyond_latest_annual(self):
        # the Q2 facts end 2026-03-28, inside the not-yet-filed FY2026 -> the
        # fiscal window is extrapolated from FY2025 and numbered fy+1
        (q,) = self._one("net_income", "2025-12-28", "2026-03-28")
        self.assertEqual(q["fiscal_year"], 2026)

    def test_derived_q4_ocf_labeled_q4(self):
        cf = _company_facts({
            "Revenues": {"units": {"USD": [
                _raw(1_000, "2025-12-31", "acc-fy", start="2025-01-01",
                     fy=2025, fp="FY", form="10-K", filed="2026-02-15"),
            ]}},
            "NetCashProvidedByUsedInOperatingActivities": {"units": {"USD": [
                _raw(350, "2025-09-30", "acc-q3", start="2025-01-01",
                     fy=2025, fp="Q3", form="10-Q", filed="2025-11-01"),
                _raw(500, "2025-12-31", "acc-fy", start="2025-01-01",
                     fy=2025, fp="FY", form="10-K", filed="2026-02-15"),
            ]}},
        })
        facts = extract_financial_facts(123, cf)
        (q4,) = [f for f in facts if f["is_derived"]]
        self.assertEqual(q4["value"], 150)
        self.assertEqual((q4["fiscal_year"], q4["fiscal_period"]), (2025, "Q4"))
        # and the 9-month YTD source fact is 9M, not Q3
        (ytd,) = [f for f in facts if f["metric_key"] == "operating_cash_flow"
                  and f["period_end"] == "2025-09-30" and not f["is_derived"]]
        self.assertEqual(ytd["fiscal_period"], "9M")

    def test_issuer_numbering_survives_january_fye(self):
        # NVDA-like: year ending Jan 2026 is the issuer's FY2026, not FY2025
        cf = _company_facts({
            "Revenues": {"units": {"USD": [
                _raw(100, "2025-01-26", "acc-25", start="2024-01-29",
                     fy=2025, fp="FY", form="10-K", filed="2025-02-26"),
                _raw(200, "2026-01-25", "acc-26", start="2025-01-27",
                     fy=2026, fp="FY", form="10-K", filed="2026-02-25"),
                # Q1 of the in-progress FY2027
                _raw(80, "2026-04-26", "acc-q1", start="2026-01-26",
                     fy=2027, fp="Q1", form="10-Q", filed="2026-05-20"),
            ]}},
        })
        facts = extract_financial_facts(123, cf)
        by_end = {f["period_end"]: f for f in facts}
        self.assertEqual((by_end["2025-01-26"]["fiscal_year"],
                          by_end["2025-01-26"]["fiscal_period"]), (2025, "FY"))
        self.assertEqual((by_end["2026-01-25"]["fiscal_year"],
                          by_end["2026-01-25"]["fiscal_period"]), (2026, "FY"))
        self.assertEqual((by_end["2026-04-26"]["fiscal_year"],
                          by_end["2026-04-26"]["fiscal_period"]), (2027, "Q1"))


class WindowBuilderHardeningTests(unittest.TestCase):
    """Phase-2 hardening: spurious TTM windows, corrupt anchors, boundary
    jitter, and off-by-one anchor sequences must not poison fiscal labels."""

    @staticmethod
    def _annual(val, start, end, accn, fy, filed):
        return _raw(val, end, accn, start=start, fy=fy, fp="FY",
                    form="10-K", filed=filed)

    def test_ttm_facts_are_excluded_not_mislabeled(self):
        # AMZN-style: rolling 12-month spans tagged in 10-Qs alongside real
        # calendar fiscal years
        cf = _company_facts({
            "NetCashProvidedByUsedInOperatingActivities": {"units": {"USD": [
                self._annual(500, "2024-01-01", "2024-12-31", "acc-fy24", 2024, "2025-02-01"),
                self._annual(600, "2025-01-01", "2025-12-31", "acc-fy25", 2025, "2026-02-01"),
                # TTM: Apr->Mar rolling year inside a 10-Q
                _raw(550, "2025-03-31", "acc-q1-26", start="2024-04-01",
                     fy=2025, fp="Q1", form="10-Q", filed="2025-04-30"),
            ]}},
        })
        facts = extract_financial_facts(123, cf)
        spans = {(f["period_start"], f["period_end"]) for f in facts}
        self.assertNotIn(("2024-04-01", "2025-03-31"), spans)  # TTM gone
        by_end = {f["period_end"]: f for f in facts if not f["is_derived"]}
        self.assertEqual((by_end["2024-12-31"]["fiscal_year"],
                          by_end["2024-12-31"]["fiscal_period"]), (2024, "FY"))
        self.assertEqual((by_end["2025-12-31"]["fiscal_year"],
                          by_end["2025-12-31"]["fiscal_period"]), (2025, "FY"))

    def test_corrupt_anchor_rejected(self):
        # STX-style: SEC metadata says fy=2027 on the year ending 2025-06-27
        cf = _company_facts({
            "Revenues": {"units": {"USD": [
                self._annual(100, "2023-07-01", "2024-06-28", "acc-24", 2024, "2024-08-10"),
                self._annual(110, "2024-06-29", "2025-06-27", "acc-25", 2027, "2025-08-10"),
            ]}},
        })
        facts = extract_financial_facts(123, cf)
        latest = max(facts, key=lambda f: f["period_end"])
        self.assertEqual((latest["fiscal_year"], latest["fiscal_period"]),
                         (2025, "FY"))

    def test_jitter_windows_merge(self):
        # GS-style: the same fiscal year tagged with 2008-11-28 and 2008-11-30
        # ends in different filings; both facts must label identically
        cf = _company_facts({
            "Revenues": {"units": {"USD": [
                self._annual(90, "2006-12-01", "2007-11-30", "acc-07", 2007, "2008-01-25"),
                self._annual(100, "2007-12-01", "2008-11-28", "acc-08a", 2008, "2009-01-25"),
                self._annual(100, "2007-12-01", "2008-11-30", "acc-08b", 2008, "2009-01-27"),
            ]}},
        })
        facts = extract_financial_facts(123, cf)
        fy08 = [f for f in facts if f["period_end"].startswith("2008-11")]
        self.assertEqual(len(fy08), 2)
        for f in fy08:
            self.assertEqual((f["fiscal_year"], f["fiscal_period"]), (2008, "FY"))

    def test_off_by_one_anchor_sequence_repaired(self):
        # GS-style: original filing carries fy=2006 for the year ending
        # 2007-11-30; neighbors + modal offset repair it to 2007
        cf = _company_facts({
            "Revenues": {"units": {"USD": [
                self._annual(80, "2005-11-26", "2006-11-24", "acc-06", 2006, "2007-01-25"),
                self._annual(90, "2006-11-25", "2007-11-30", "acc-07", 2006, "2008-01-25"),
                self._annual(100, "2007-12-01", "2008-11-28", "acc-08", 2008, "2009-01-25"),
            ]}},
        })
        facts = extract_financial_facts(123, cf)
        mid = next(f for f in facts if f["period_end"] == "2007-11-30")
        self.assertEqual(mid["fiscal_year"], 2007)

    def test_new_year_straddling_53_week_years_survive(self):
        # FYE "Saturday nearest Dec 31": ends 2019-12-28, 2021-01-01(!),
        # 2021-12-31 are fiscal 2019, 2020, 2021 - repair must NOT renumber
        cf = _company_facts({
            "Revenues": {"units": {"USD": [
                self._annual(80, "2018-12-30", "2019-12-28", "acc-19", 2019, "2020-02-20"),
                self._annual(90, "2019-12-29", "2021-01-01", "acc-20", 2020, "2021-02-20"),
                self._annual(100, "2021-01-02", "2021-12-31", "acc-21", 2021, "2022-02-20"),
            ]}},
        })
        facts = extract_financial_facts(123, cf)
        by_end = {f["period_end"]: f for f in facts}
        self.assertEqual(by_end["2019-12-28"]["fiscal_year"], 2019)
        self.assertEqual(by_end["2021-01-01"]["fiscal_year"], 2020)
        self.assertEqual(by_end["2021-12-31"]["fiscal_year"], 2021)

    def test_misaligned_six_month_span_stays_unlabeled(self):
        # a 6-month duration NOT starting at fiscal-year start is not "6M" YTD
        cf = _company_facts({
            "Revenues": {"units": {"USD": [
                self._annual(100, "2025-01-01", "2025-12-31", "acc-fy", 2025, "2026-02-15"),
                _raw(50, "2025-09-30", "acc-q", start="2025-04-01",
                     fy=2025, fp="Q3", form="10-Q", filed="2025-11-01"),
            ]}},
        })
        facts = extract_financial_facts(123, cf)
        mid = next(f for f in facts if f["period_start"] == "2025-04-01")
        self.assertIsNone(mid["fiscal_period"])
        self.assertEqual(mid["fiscal_year"], 2025)


class ReportedDiscreteQuarterDedupTests(unittest.TestCase):
    """Issuers that tag the discrete quarter ALONGSIDE YTD (Celestica, Reddit)
    must not produce duplicate (accession, tag, period, unit) rows: the
    reported fact wins over the identical ytd_diff derivation."""

    def setUp(self):
        ocf = "NetCashProvidedByUsedInOperatingActivities"
        self.cf = _company_facts({
            "Revenues": {"units": {"USD": [
                _raw(1_000, "2025-12-31", "acc-fy", start="2025-01-01",
                     fy=2025, fp="FY", form="10-K", filed="2026-02-15"),
            ]}},
            ocf: {"units": {"USD": [
                # YTD series
                _raw(100, "2025-03-31", "acc-q1", start="2025-01-01",
                     fy=2025, fp="Q1", form="10-Q", filed="2025-05-01"),
                _raw(220, "2025-06-30", "acc-q2", start="2025-01-01",
                     fy=2025, fp="Q2", form="10-Q", filed="2025-08-01"),
                # the SAME filing also reports the discrete quarter
                _raw(120, "2025-06-30", "acc-q2", start="2025-04-01",
                     fy=2025, fp="Q2", form="10-Q", filed="2025-08-01"),
            ]}},
        })
        self.facts = extract_financial_facts(123, self.cf)

    def test_no_duplicate_storage_keys(self):
        keys = [(f["accession_number"], f["concept_tag"], f["period_start"],
                 f["period_end"], f["unit"]) for f in self.facts]
        self.assertEqual(len(keys), len(set(keys)))

    def test_reported_fact_wins_over_derivation(self):
        (q2,) = [f for f in self.facts
                 if f["metric_key"] == "operating_cash_flow"
                 and f["period_start"] == "2025-04-01"
                 and f["period_end"] == "2025-06-30"]
        self.assertFalse(q2["is_derived"])
        self.assertEqual(q2["value"], 120)
        self.assertEqual(q2["fiscal_period"], "Q2")


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
