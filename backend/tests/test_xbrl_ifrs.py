"""Unit tests for the ifrs-full taxonomy layer in backend/edgar/xbrl_facts.py.

Offline, synthetic fixtures shaped after the real TSMC (CIK 1046179) and Novo
Nordisk (CIK 353278) companyfacts payloads: 20-F only, a primary reporting
currency (TWD / DKK), and in TSMC's case a USD convenience translation of the
same periods inside the same accession.

Run: python -m unittest backend.tests.test_xbrl_ifrs
"""
import unittest

from backend.edgar.xbrl_facts import (
    _currency_of,
    _primary_currency,
    IFRS_CONCEPTS,
    extract_financial_facts,
)


def _dur(val, year, accn, *, form="20-F"):
    return {"val": val, "start": f"{year}-01-01", "end": f"{year}-12-31",
            "accn": accn, "fy": year, "fp": "FY", "form": form,
            "filed": f"{year + 1}-04-17", "frame": f"CY{year}"}


def _inst(val, year, accn, *, form="20-F"):
    return {"val": val, "end": f"{year}-12-31", "accn": accn, "fy": year,
            "fp": "FY", "form": form, "filed": f"{year + 1}-04-17"}


A24, A23 = "0001193125-25-083423", "0001193125-24-099840"


def _tsmc_like():
    """Two fiscal years, TWD primary plus a USD convenience translation."""
    return {"facts": {"ifrs-full": {
        "Revenue": {"units": {
            "TWD": [_dur(2_161_735_800_000, 2023, A23),
                    _dur(2_161_735_800_000, 2023, A24),
                    _dur(2_894_307_700_000, 2024, A24)],
            "USD": [_dur(68_000_000_000, 2023, A24),
                    _dur(88_268_000_000, 2024, A24)],
        }},
        # IFRS-15 contract subtotal: narrower than Revenue, must never win
        "RevenueFromContractsWithCustomers": {"units": {
            "TWD": [_dur(2_000_000_000_000, 2024, A24)],
        }},
        "CostOfSales": {"units": {
            "TWD": [_dur(986_625_600_000, 2023, A24),
                    _dur(1_269_452_800_000, 2024, A24)],
        }},
        "GrossProfit": {"units": {
            "TWD": [_dur(1_175_110_200_000, 2023, A24),
                    _dur(1_624_854_900_000, 2024, A24)],
        }},
        "ProfitLossFromOperatingActivities": {"units": {
            "TWD": [_dur(921_141_000_000, 2023, A24),
                    _dur(1_320_753_400_000, 2024, A24)],
        }},
        # both tagged: the parent-only split must win over consolidated
        "ProfitLoss": {"units": {
            "TWD": [_dur(838_497_700_000, 2023, A24),
                    _dur(1_157_523_900_000, 2024, A24)],
        }},
        "ProfitLossAttributableToOwnersOfParent": {"units": {
            "TWD": [_dur(838_497_700_000, 2023, A24),
                    _dur(1_158_380_200_000, 2024, A24)],
        }},
        "BasicEarningsLossPerShare": {"units": {
            "TWD/shares": [_dur(32.34, 2023, A24), _dur(44.68, 2024, A24)],
            "USD/shares": [_dur(1.00, 2023, A24), _dur(1.36, 2024, A24)],
        }},
        "DilutedEarningsLossPerShare": {"units": {
            "TWD/shares": [_dur(32.34, 2023, A24), _dur(44.68, 2024, A24)],
        }},
        "WeightedAverageShares": {"units": {
            "shares": [_dur(25_930_380_458, 2023, A24),
                       _dur(25_930_380_458, 2024, A24)],
        }},
        "AdjustedWeightedAverageShares": {"units": {
            "shares": [_dur(25_930_380_458, 2024, A24)],
        }},
        "CashFlowsFromUsedInOperatingActivities": {"units": {
            "TWD": [_dur(1_242_302_500_000, 2023, A24),
                    _dur(1_826_486_100_000, 2024, A24)],
        }},
        "Assets": {"units": {
            "TWD": [_inst(5_532_197_600_000, 2023, A24),
                    _inst(6_691_760_800_000, 2024, A24)],
            "USD": [_inst(204_000_000_000, 2024, A24)],
        }},
        "Liabilities": {"units": {
            "TWD": [_inst(1_600_000_000_000, 2023, A24),
                    _inst(2_000_000_000_000, 2024, A24)],
        }},
        "Equity": {"units": {
            "TWD": [_inst(3_932_197_600_000, 2023, A24),
                    _inst(4_691_760_800_000, 2024, A24)],
        }},
        "NoncontrollingInterests": {"units": {
            "TWD": [_inst(11_000_000_000, 2024, A24)],
        }},
        "CashAndCashEquivalents": {"units": {
            "TWD": [_inst(1_465_427_400_000, 2023, A24),
                    _inst(2_127_729_100_000, 2024, A24)],
        }},
        # furnished interim report: same exclusion as the 8-K on the us-gaap path
        "OtherOperatingIncomeExpense": {"units": {
            "TWD": [_dur(1_000_000, 2024, "6k-accn", form="6-K")],
        }},
    }}}


def _by(facts, metric_key):
    return {f["period_end"]: f for f in facts if f["metric_key"] == metric_key}


class CurrencyHelperTests(unittest.TestCase):

    def test_currency_of(self):
        self.assertEqual(_currency_of("TWD"), "TWD")
        self.assertEqual(_currency_of("DKK/shares"), "DKK")
        self.assertEqual(_currency_of("USD"), "USD")
        self.assertIsNone(_currency_of("shares"))
        self.assertIsNone(_currency_of("pure"))
        self.assertIsNone(_currency_of("BillionsCubicFeet"))
        self.assertIsNone(_currency_of(""))

    def test_primary_currency_prefers_the_reporting_currency(self):
        cf = _tsmc_like()["facts"]["ifrs-full"]
        self.assertEqual(_primary_currency(cf, IFRS_CONCEPTS), "TWD")

    def test_primary_currency_none_when_nothing_mapped(self):
        self.assertIsNone(_primary_currency({}, IFRS_CONCEPTS))


class IfrsExtractionTests(unittest.TestCase):

    def setUp(self):
        self.facts = extract_financial_facts(1046179, _tsmc_like())

    def test_ifrs_filer_yields_facts(self):
        self.assertTrue(self.facts)
        self.assertEqual({f["taxonomy"] for f in self.facts}, {"ifrs-full"})

    def test_every_v1_income_and_balance_metric_is_populated(self):
        got = {f["metric_key"] for f in self.facts}
        for metric in ("revenue", "cost_of_revenue", "gross_profit",
                       "operating_income", "net_income", "eps_basic",
                       "eps_diluted", "shares_basic", "shares_diluted",
                       "operating_cash_flow", "total_assets",
                       "total_liabilities", "stockholders_equity",
                       "cash_and_equivalents"):
            self.assertIn(metric, got, metric)

    def test_revenue_uses_the_statement_total_not_the_contract_subtotal(self):
        rev = _by(self.facts, "revenue")["2024-12-31"]
        self.assertEqual(rev["concept_tag"], "Revenue")
        self.assertEqual(rev["value"], 2_894_307_700_000)

    def test_net_income_prefers_the_parent_only_split(self):
        ni = _by(self.facts, "net_income")["2024-12-31"]
        self.assertEqual(ni["concept_tag"], "ProfitLossAttributableToOwnersOfParent")
        self.assertEqual(ni["value"], 1_158_380_200_000)

    def test_instant_metrics_keep_instant_period_shape(self):
        assets = _by(self.facts, "total_assets")["2024-12-31"]
        self.assertEqual(assets["period_type"], "instant")
        self.assertEqual(assets["period_start"], assets["period_end"])

    def test_furnished_6k_facts_are_excluded(self):
        self.assertNotIn("6-K", {f["form"] for f in self.facts})

    def test_restatement_history_is_preserved(self):
        rev_2023 = [f for f in self.facts
                    if f["metric_key"] == "revenue"
                    and f["period_end"] == "2023-12-31"]
        self.assertEqual({f["accession_number"] for f in rev_2023}, {A23, A24})

    def test_fiscal_labels_are_period_derived(self):
        rev = _by(self.facts, "revenue")["2024-12-31"]
        self.assertEqual((rev["fiscal_year"], rev["fiscal_period"]), (2024, "FY"))

    def test_provenance_is_stamped(self):
        for f in self.facts:
            self.assertEqual(f["cik"], 1046179)
            self.assertTrue(f["filing_url"].startswith(
                "https://www.sec.gov/Archives/edgar/data/1046179/"))


class CurrencyClampTests(unittest.TestCase):
    """The hard requirement: one metric series, one currency, never mixed."""

    def setUp(self):
        self.facts = extract_financial_facts(1046179, _tsmc_like())

    def test_convenience_translation_rows_are_dropped(self):
        self.assertEqual({f["unit"] for f in self.facts},
                         {"TWD", "TWD/shares", "shares"})

    def test_no_metric_carries_two_currencies(self):
        by_metric: dict[str, set] = {}
        for f in self.facts:
            cur = _currency_of(f["unit"])
            if cur is not None:
                by_metric.setdefault(f["metric_key"], set()).add(cur)
        for metric, currencies in by_metric.items():
            self.assertEqual(len(currencies), 1, f"{metric}: {currencies}")

    def test_reported_unit_is_recorded_verbatim(self):
        self.assertEqual(_by(self.facts, "revenue")["2024-12-31"]["unit"], "TWD")
        self.assertEqual(_by(self.facts, "eps_basic")["2024-12-31"]["unit"],
                         "TWD/shares")
        self.assertEqual(_by(self.facts, "shares_basic")["2024-12-31"]["unit"],
                         "shares")

    def test_dkk_filer_without_a_usd_translation(self):
        cf = {"facts": {"ifrs-full": {
            "Revenue": {"units": {"DKK": [_dur(309_064_000_000, 2025, "acc-1")]}},
            "ProfitLoss": {"units": {"DKK": [_dur(102_434_000_000, 2025, "acc-1")]}},
            "Assets": {"units": {"DKK": [_inst(350_000_000_000, 2025, "acc-1")]}},
        }}}
        facts = extract_financial_facts(353278, cf)
        self.assertEqual({f["unit"] for f in facts}, {"DKK"})
        self.assertEqual(_by(facts, "net_income")["2025-12-31"]["concept_tag"],
                         "ProfitLoss")


class UsGaapUntouchedTests(unittest.TestCase):
    """A us-gaap block stays authoritative and its output does not move."""

    def _us_gaap_only(self):
        return {"facts": {"us-gaap": {
            "Revenues": {"units": {"USD": [
                {"val": 1000, "start": "2024-01-01", "end": "2024-12-31",
                 "accn": "acc-1", "fy": 2024, "fp": "FY", "form": "10-K",
                 "filed": "2025-02-15"}]}},
        }}}

    def test_us_gaap_filer_rows_are_tagged_us_gaap(self):
        facts = extract_financial_facts(2488, self._us_gaap_only())
        self.assertEqual({f["taxonomy"] for f in facts}, {"us-gaap"})
        self.assertEqual(_by(facts, "revenue")["2024-12-31"]["value"], 1000)

    def test_ifrs_block_is_ignored_when_us_gaap_exists(self):
        cf = self._us_gaap_only()
        cf["facts"]["ifrs-full"] = {
            "Revenue": {"units": {"EUR": [_dur(9999, 2024, "acc-x")]}},
        }
        facts = extract_financial_facts(2488, cf)
        self.assertEqual({f["taxonomy"] for f in facts}, {"us-gaap"})
        self.assertEqual({f["unit"] for f in facts}, {"USD"})

    def test_no_taxonomy_at_all_returns_nothing(self):
        self.assertEqual(extract_financial_facts(1, {"facts": {"dei": {}}}), [])


if __name__ == "__main__":
    unittest.main()
