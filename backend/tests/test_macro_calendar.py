"""Unit tests for backend/macro_calendar.py (Stage 1a, BLS-only).

No network: every test runs against checked-in fixtures matching the exact
BLS API v2 response shape. Covers latest-point selection, SA-vs-NSA routing
(m/m from SA, y/y from NSA), payroll m/m-change-from-net_changes, prior
selection, vintage/footnote labeling, confidence marking, and fail-soft on
malformed / empty / calculations-missing responses.

Run from repo root: python -m unittest backend.tests.test_macro_calendar
"""
import json
import unittest
from pathlib import Path
from unittest import mock

from backend import macro_calendar as mc

FIX = Path(__file__).resolve().parent / "fixtures"


def _load(name: str) -> dict:
    return json.loads((FIX / name).read_text())


def _releases_by_key(fixture_name: str) -> dict:
    raw = _load(fixture_name)
    rels = mc.build_releases(mc._index_series(raw))
    return {r.key: r for r in rels}


def _fig(release, label: str):
    return next(f for f in release.figures if f.label == label)


class LatestPointSelection(unittest.TestCase):
    def test_picks_newest_month_even_when_out_of_order(self):
        # CUSR0000SA0 fixture lists April before May and includes an annual M13.
        rels = _releases_by_key("bls_success.json")
        self.assertIn("cpi", rels)
        self.assertEqual(rels["cpi"].period, "May 2026")

    def test_month_num_filters_annual_and_malformed(self):
        self.assertEqual(mc._month_num("M05"), 5)
        self.assertIsNone(mc._month_num("M13"))  # annual average
        self.assertIsNone(mc._month_num("Q01"))
        self.assertIsNone(mc._month_num(None))

    def test_monthly_sorted_drops_annual(self):
        raw = _load("bls_success.json")
        data = mc._index_series(raw)["CUSR0000SA0"]
        rows = mc._monthly_sorted(data)
        self.assertEqual([r["period"] for r in rows], ["M05", "M04"])  # M13 dropped


class SaNsaRouting(unittest.TestCase):
    def setUp(self):
        self.rels = _releases_by_key("bls_success.json")

    def test_cpi_mm_from_SA_yy_from_NSA(self):
        cpi = self.rels["cpi"]
        mm = _fig(cpi, "m/m (SA)")
        yy = _fig(cpi, "y/y (NSA)")
        # m/m must be the SA series' pct_changes["1"] = 0.2 (NOT the NSA 5.5)
        self.assertEqual(mm.value, 0.2)
        # y/y must be the NSA series' pct_changes["12"] = 3.4 (NOT the SA decoy 9.9)
        self.assertEqual(yy.value, 3.4)

    def test_core_cpi_routing(self):
        core = self.rels["core_cpi"]
        self.assertEqual(_fig(core, "m/m (SA)").value, 0.3)
        self.assertEqual(_fig(core, "y/y (NSA)").value, 3.8)

    def test_ppi_routing(self):
        ppi = self.rels["ppi"]
        self.assertEqual(_fig(ppi, "m/m (SA)").value, 0.1)
        self.assertEqual(_fig(ppi, "y/y (NSA)").value, 2.6)


class PayrollsAndUnemployment(unittest.TestCase):
    def setUp(self):
        self.rels = _releases_by_key("bls_success.json")

    def test_payroll_change_from_net_changes_and_level_from_value(self):
        p = self.rels["nonfarm_payrolls"]
        change = _fig(p, "m/m change (SA)")
        level = _fig(p, "level (SA)")
        self.assertEqual(change.value, 175.0)   # net_changes["1"]
        self.assertEqual(change.unit, "K")
        self.assertEqual(level.value, 159000.0)  # value
        self.assertEqual(change.prior, 160.0)    # prior net_changes["1"]
        self.assertEqual(level.prior, 158825.0)  # prior value

    def test_unemployment_rate_and_change(self):
        u = self.rels["unemployment"]
        rate = _fig(u, "rate (SA)")
        change = _fig(u, "change vs prior")
        self.assertEqual(rate.value, 4.1)
        self.assertEqual(rate.prior, 4.0)
        self.assertEqual(change.value, 0.1)   # net_changes["1"]
        self.assertEqual(change.unit, "pp")


class PriorSelection(unittest.TestCase):
    def test_cpi_prior_is_preceding_month(self):
        cpi = _releases_by_key("bls_success.json")["cpi"]
        # SA prior m/m = April pct_changes["1"] = 0.3
        self.assertEqual(_fig(cpi, "m/m (SA)").prior, 0.3)
        # NSA prior y/y = April pct_changes["12"] = 3.2
        self.assertEqual(_fig(cpi, "y/y (NSA)").prior, 3.2)


class VintageAndConfidence(unittest.TestCase):
    def setUp(self):
        self.rels = _releases_by_key("bls_success.json")

    def test_vintage_note_present(self):
        for r in self.rels.values():
            self.assertTrue(r.vintage_note)
            self.assertIn("revis", r.vintage_note.lower())

    def test_preliminary_footnote_surfaced_on_payrolls(self):
        self.assertIn("Preliminary", self.rels["nonfarm_payrolls"].footnotes)

    def test_confidence_marking(self):
        self.assertEqual(self.rels["cpi"].confidence, "confirmed")
        self.assertEqual(self.rels["unemployment"].confidence, "confirmed")
        self.assertEqual(self.rels["nonfarm_payrolls"].confidence, "confirmed")
        # core CPI (L1E) and PPI are assumed -> VERIFY-LIVE
        self.assertIn("assumed", self.rels["core_cpi"].confidence)
        self.assertIn("VERIFY-LIVE", self.rels["core_cpi"].confidence)
        self.assertIn("assumed", self.rels["ppi"].confidence)


class FailSoft(unittest.TestCase):
    def test_empty_results_yields_no_releases(self):
        rels = _releases_by_key("bls_empty.json")
        self.assertEqual(rels, {})

    def test_malformed_missing_results(self):
        self.assertEqual(mc._index_series({}), {})
        self.assertEqual(mc._index_series({"Results": {}}), {})
        self.assertEqual(mc.build_releases({}), [])

    def test_no_calculations_skips_pct_releases_but_keeps_value_releases(self):
        rels = _releases_by_key("bls_no_calculations.json")
        # CPI needs pct_changes -> skipped when calculations absent (fail-soft)
        self.assertNotIn("cpi", rels)
        # Unemployment rate comes from `value`, so it still resolves, and the
        # change falls back to (latest - prior) when net_changes is absent.
        self.assertIn("unemployment", rels)
        self.assertEqual(_fig(rels["unemployment"], "rate (SA)").value, 4.1)
        self.assertEqual(_fig(rels["unemployment"], "change vs prior").value, 0.1)

    def test_to_float_tolerates_commas_and_junk(self):
        self.assertEqual(mc._to_float("1,234.5"), 1234.5)
        self.assertIsNone(mc._to_float("n/a"))
        self.assertIsNone(mc._to_float(None))


class FetchWrapper(unittest.TestCase):
    def test_fetch_returns_empty_on_none_response(self):
        with mock.patch.object(mc, "_post_bls", return_value=None):
            self.assertEqual(mc.fetch_macro_releases(), [])

    def test_fetch_builds_panel_from_success_payload(self):
        raw = _load("bls_success.json")
        with mock.patch.object(mc, "_post_bls", return_value=raw):
            rels = mc.fetch_macro_releases()
        keys = {r.key for r in rels}
        self.assertEqual(
            keys, {"cpi", "core_cpi", "nonfarm_payrolls", "unemployment", "ppi"}
        )

    def test_fetch_swallows_exceptions(self):
        with mock.patch.object(mc, "_post_bls", side_effect=RuntimeError("boom")):
            self.assertEqual(mc.fetch_macro_releases(), [])


if __name__ == "__main__":
    unittest.main()
