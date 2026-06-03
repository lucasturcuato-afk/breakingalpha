"""Unit tests for backend/edgar/xbrl_validation.py (offline; the network
cross-endpoint check is exercised via a stub fetcher).

Run: python -m unittest backend.tests.test_xbrl_validation
"""
import unittest

from backend.edgar.xbrl_validation import (
    QUARANTINED,
    VALIDATED,
    validate_facts,
    validated_only,
)

CIK = 123


def fact(metric, value, ps, pe, *, unit="USD", ptype="duration", tag=None,
         accn="acc-1", filed="2026-02-15", derived=False, derivation=None):
    return {
        "metric_key": metric, "taxonomy": "us-gaap",
        "concept_tag": tag or metric, "value": value, "unit": unit,
        "period_type": ptype, "period_start": ps, "period_end": pe,
        "fiscal_year": 2025, "fiscal_period": "FY", "sec_frame": None,
        "form": "10-K", "filed_date": filed, "accession_number": accn,
        "is_derived": derived, "derivation": derivation, "cik": CIK,
        "filing_url": "https://example.test/filing/",
    }


def annual(metric, value, **kw):
    return fact(metric, value, "2025-01-01", "2025-12-31", **kw)


def instant(metric, value, **kw):
    return fact(metric, value, "2025-12-31", "2025-12-31",
                ptype="instant", **kw)


def clean_company():
    """A coherent fact set that must fully validate (AAPL-like shape)."""
    return [
        annual("revenue", 1_000_000_000),
        annual("cost_of_revenue", 600_000_000),
        annual("gross_profit", 400_000_000),
        annual("net_income", 200_000_000),
        annual("eps_basic", 2.00, unit="USD/shares"),
        annual("eps_diluted", 2.00, unit="USD/shares"),
        annual("shares_basic", 100_000_000, unit="shares"),
        annual("shares_diluted", 100_000_000, unit="shares"),
        instant("total_assets", 900_000_000),
        instant("total_liabilities", 500_000_000),
        instant("stockholders_equity", 400_000_000),
    ]


class TieOutTests(unittest.TestCase):
    def test_clean_company_fully_validates(self):
        facts = clean_company()
        summary = validate_facts(facts, CIK, concept_fetcher=None)
        self.assertEqual(summary["quarantined"], 0)
        self.assertEqual(len(validated_only(facts)), len(facts))

    def test_gross_profit_mismatch_quarantines_all_three_sides(self):
        facts = clean_company()
        next(f for f in facts if f["metric_key"] == "gross_profit")["value"] = 999_000_000
        validate_facts(facts, CIK, concept_fetcher=None)
        bad = {f["metric_key"] for f in facts
               if f["validation_status"] == QUARANTINED}
        self.assertEqual(bad, {"revenue", "cost_of_revenue", "gross_profit"})
        reason = next(f for f in facts if f["metric_key"] == "revenue")["validation_reason"]
        self.assertIn("tieout_gross_profit", reason)

    def test_the_570_percent_margin_case_is_quarantined(self):
        # The spike's failure mode: stale revenue far below gross profit.
        facts = clean_company()
        next(f for f in facts if f["metric_key"] == "revenue")["value"] = 70_000_000
        validate_facts(facts, CIK, concept_fetcher=None)
        rev = next(f for f in facts if f["metric_key"] == "revenue")
        self.assertEqual(rev["validation_status"], QUARANTINED)
        self.assertIn("bounds_gross_margin", rev["validation_reason"])

    def test_balance_sheet_mismatch_quarantines_the_equation(self):
        facts = clean_company()
        next(f for f in facts if f["metric_key"] == "total_assets")["value"] = 2_000_000_000
        validate_facts(facts, CIK, concept_fetcher=None)
        bad = {f["metric_key"] for f in facts
               if f["validation_status"] == QUARANTINED}
        self.assertEqual(
            bad, {"total_assets", "total_liabilities", "stockholders_equity"})

    def test_balance_sheet_reconciles_parent_equity_via_nci(self):
        # RTX-style: parent-only equity + reported MinorityInterest must tie
        facts = clean_company()
        next(f for f in facts if f["metric_key"] == "stockholders_equity")["value"] = 360_000_000
        facts.append(instant("minority_interest", 40_000_000))
        summary = validate_facts(facts, CIK, concept_fetcher=None)
        self.assertEqual(summary["quarantined"], 0)

    def test_balance_sheet_tolerates_small_nci_gap(self):
        facts = clean_company()
        # 0.6% gap (< 1% tolerance), e.g. parent-only equity vs total
        next(f for f in facts if f["metric_key"] == "stockholders_equity")["value"] = 394_600_000
        summary = validate_facts(facts, CIK, concept_fetcher=None)
        self.assertEqual(summary["quarantined"], 0)

    def test_eps_scale_error_quarantines_eps_only(self):
        facts = clean_company()
        next(f for f in facts if f["metric_key"] == "eps_diluted")["value"] = 200.0
        validate_facts(facts, CIK, concept_fetcher=None)
        bad = {f["metric_key"] for f in facts
               if f["validation_status"] == QUARANTINED}
        self.assertEqual(bad, {"eps_diluted"})

    def test_eps_tolerates_rounding_and_small_numerator_adjustments(self):
        facts = clean_company()
        # implied 2.00, reported 1.97 (rounding + preferred dividends)
        next(f for f in facts if f["metric_key"] == "eps_basic")["value"] = 1.97
        summary = validate_facts(facts, CIK, concept_fetcher=None)
        self.assertEqual(summary["quarantined"], 0)


class CashFlowRollTests(unittest.TestCase):
    M = 1_000_000  # realistic magnitudes: the roll tolerance is $5M absolute

    def _year(self, q2_value):
        mk = "operating_cash_flow"
        M = self.M
        return [
            fact(mk, 500 * M, "2025-01-01", "2025-12-31", accn="acc-fy"),
            fact(mk, 100 * M, "2025-01-01", "2025-03-31", accn="acc-q1"),
            fact(mk, q2_value, "2025-04-01", "2025-06-30", accn="acc-q2",
                 derived=True, derivation="ytd_diff: ..."),
            fact(mk, 130 * M, "2025-07-01", "2025-09-30", accn="acc-q3",
                 derived=True, derivation="ytd_diff: ..."),
            fact(mk, 150 * M, "2025-10-01", "2025-12-31", accn="acc-fy",
                 derived=True, derivation="ytd_diff: ..."),
        ]

    def test_consistent_roll_validates(self):
        facts = self._year(q2_value=120 * self.M)  # 100+120+130+150 == 500
        summary = validate_facts(facts, CIK, concept_fetcher=None)
        self.assertEqual(summary["quarantined"], 0)

    def test_broken_roll_quarantines_derived_quarters(self):
        facts = self._year(q2_value=999 * self.M)
        validate_facts(facts, CIK, concept_fetcher=None)
        derived = [f for f in facts if f["is_derived"]]
        self.assertTrue(all(f["validation_status"] == QUARANTINED for f in derived))
        self.assertIn("tieout_cf_roll", derived[0]["validation_reason"])
        fy = next(f for f in facts if f["period_start"] == "2025-01-01"
                  and f["period_end"] == "2025-12-31")
        self.assertEqual(fy["validation_status"], VALIDATED)  # reported fact stands


class BoundsTests(unittest.TestCase):
    def test_negative_revenue_quarantined(self):
        facts = [annual("revenue", -5_000_000)]
        validate_facts(facts, CIK, concept_fetcher=None)
        self.assertEqual(facts[0]["validation_status"], QUARANTINED)
        self.assertIn("bounds_negative_revenue", facts[0]["validation_reason"])

    def test_implausible_qoq_jump_quarantined(self):
        facts = [
            fact("revenue", 20_000_000, "2025-01-01", "2025-03-31", accn="q1"),
            fact("revenue", 900_000_000, "2025-04-01", "2025-06-30", accn="q2"),
        ]
        validate_facts(facts, CIK, concept_fetcher=None)
        q2 = next(f for f in facts if f["accession_number"] == "q2")
        self.assertEqual(q2["validation_status"], QUARANTINED)
        self.assertIn("bounds_qoq_jump", q2["validation_reason"])

    def test_strong_but_plausible_growth_passes(self):
        facts = [
            fact("revenue", 20_000_000, "2025-01-01", "2025-03-31", accn="q1"),
            fact("revenue", 60_000_000, "2025-04-01", "2025-06-30", accn="q2"),
        ]
        summary = validate_facts(facts, CIK, concept_fetcher=None)
        self.assertEqual(summary["quarantined"], 0)

    def test_eps_magnitude_bound_allows_berkshire_but_not_unit_errors(self):
        ok = [annual("eps_basic", 59_000.0, unit="USD/shares")]
        validate_facts(ok, CIK, concept_fetcher=None)
        self.assertEqual(ok[0]["validation_status"], VALIDATED)

        bad = [annual("eps_basic", 2_000_000.0, unit="USD/shares")]
        validate_facts(bad, CIK, concept_fetcher=None)
        self.assertEqual(bad[0]["validation_status"], QUARANTINED)


class CrossEndpointTests(unittest.TestCase):
    def _concept_doc(self, val):
        return {"units": {"USD": [{
            "start": "2025-01-01", "end": "2025-12-31",
            "accn": "acc-1", "val": val,
        }]}}

    def test_agreement_validates(self):
        facts = [annual("revenue", 1_000)]
        summary = validate_facts(
            facts, CIK, concept_fetcher=lambda c, t, g: self._concept_doc(1_000))
        self.assertEqual(summary["quarantined"], 0)

    def test_dollar_mismatch_quarantines(self):
        facts = [annual("revenue", 1_000)]
        validate_facts(
            facts, CIK, concept_fetcher=lambda c, t, g: self._concept_doc(1_001))
        self.assertEqual(facts[0]["validation_status"], QUARANTINED)
        self.assertIn("cross_endpoint_mismatch", facts[0]["validation_reason"])

    def test_unreachable_oracle_fails_closed(self):
        facts = [annual("revenue", 1_000)]
        validate_facts(facts, CIK, concept_fetcher=lambda c, t, g: None)
        self.assertEqual(facts[0]["validation_status"], QUARANTINED)
        self.assertIn("cross_endpoint_unavailable", facts[0]["validation_reason"])

    def test_derived_facts_skip_direct_reconciliation(self):
        facts = [fact("operating_cash_flow", 120, "2025-04-01", "2025-06-30",
                      derived=True, derivation="ytd_diff: ...")]
        summary = validate_facts(
            facts, CIK, concept_fetcher=lambda c, t, g: None)
        self.assertEqual(summary["quarantined"], 0)


class FailClosedTests(unittest.TestCase):
    def test_validated_only_excludes_quarantined(self):
        facts = clean_company()
        next(f for f in facts if f["metric_key"] == "revenue")["value"] = -1
        validate_facts(facts, CIK, concept_fetcher=None)
        published = validated_only(facts)
        self.assertNotIn("revenue", {f["metric_key"] for f in published})

    def test_every_fact_gets_an_explicit_status(self):
        facts = clean_company()
        validate_facts(facts, CIK, concept_fetcher=None)
        for f in facts:
            self.assertIn(f["validation_status"], (VALIDATED, QUARANTINED))

    def test_facts_without_status_are_never_published(self):
        # a fact that somehow skipped the gate has no status -> not published
        published = validated_only([annual("revenue", 1_000)])
        self.assertEqual(published, [])


if __name__ == "__main__":
    unittest.main()
