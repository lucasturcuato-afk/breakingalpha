"""Unit tests for backend/bea_calendar.py (BEA data layer).

No network: real-data tests run against the captured, key-scrubbed fixtures
(bea_T20807_M / bea_T20804_M / bea_T10101_Q); edge cases use small synthetic
BEA-shaped payloads. Covers correct row selection, market-based-line exclusion,
monthly-not-quarterly sourcing, comma/negative parsing, levels-based y/y,
missing-12-month-prior omission, gap-skipping prior selection, and fail-soft.

Run from repo root: python -m unittest backend.tests.test_bea_calendar
"""
import json
import unittest
from pathlib import Path
from unittest import mock

from backend import bea_calendar as bc

FIX = Path(__file__).resolve().parent / "fixtures"


def _load(name: str) -> dict:
    return json.loads((FIX / name).read_text())


def _table(rows: list, notes: list | None = None) -> dict:
    res: dict = {"Data": rows}
    if notes is not None:
        res["Notes"] = notes
    return {"BEAAPI": {"Results": res}}


def _row(series: str, period: str, value: str) -> dict:
    return {
        "SeriesCode": series, "TimePeriod": period, "DataValue": value,
        "LineNumber": "1", "LineDescription": "x",
    }


def _by_key(releases: list) -> dict:
    return {r.key: r for r in releases}


def _fig(release, label: str):
    return next(f for f in release.figures if f.label == label)


# ── Real-fixture (happy path) ─────────────────────────────────────────────────
class RealFixtures(unittest.TestCase):
    def setUp(self):
        self.rels = _by_key(bc.build_releases(
            _load("bea_T20807_M.json"),
            _load("bea_T20804_M.json"),
            _load("bea_T10101_Q.json"),
        ))

    def test_pce_row_selection_and_values(self):
        pce = self.rels["pce"]
        self.assertEqual(pce.period, "April 2026")
        self.assertEqual(pce.series_ids, ["DPCERGM", "DPCERG"])
        self.assertEqual(_fig(pce, "m/m").value, 0.4)
        self.assertEqual(_fig(pce, "m/m").prior, 0.7)
        self.assertEqual(_fig(pce, "y/y").value, 3.8)   # computed from levels
        self.assertEqual(_fig(pce, "y/y").prior, 3.5)

    def test_core_pce_values(self):
        core = self.rels["core_pce"]
        self.assertEqual(core.series_ids, ["DPCCRGM", "DPCCRG"])
        self.assertEqual(_fig(core, "m/m").value, 0.2)
        self.assertEqual(_fig(core, "y/y").value, 3.3)

    def test_market_based_line_not_selected(self):
        core = self.rels["core_pce"]
        # Core uses DPCC... not the market-based DPCM.../DPCX... decoys.
        self.assertFalse(set(core.series_ids) & bc.MARKET_BASED_CODES)
        # And the value is the real core (0.2), not the market-based core (0.3
        # for DPCXRGM in the same fixture month).
        self.assertEqual(_fig(core, "m/m").value, 0.2)

    def test_pce_sourced_monthly_not_quarterly(self):
        # The quarterly PCE line (DPCERL, in the GDP table) must never feed PCE.
        for rel in (self.rels["pce"], self.rels["core_pce"]):
            self.assertNotIn("DPCERL", rel.series_ids)
            self.assertTrue(all(c in {"DPCERGM", "DPCERG", "DPCCRGM", "DPCCRG"} for c in rel.series_ids))

    def test_gdp_values_and_vintage(self):
        gdp = self.rels["gdp"]
        self.assertEqual(gdp.period, "Q1 2026")
        self.assertEqual(gdp.series_ids, ["A191RL"])
        self.assertEqual(_fig(gdp, "q/q annualized").value, 1.6)
        self.assertEqual(_fig(gdp, "q/q annualized").prior, 0.5)
        self.assertIn("May 28, 2026", gdp.vintage_note)

    def test_all_three_releases_present_and_confirmed(self):
        self.assertEqual(set(self.rels), {"pce", "core_pce", "gdp"})
        for r in self.rels.values():
            self.assertEqual(r.confidence, "confirmed")


# ── Parsing helpers ───────────────────────────────────────────────────────────
class Parsing(unittest.TestCase):
    def test_to_float_commas_and_negatives(self):
        self.assertEqual(bc._to_float("1,234.567"), 1234.567)
        self.assertEqual(bc._to_float("-5.4"), -5.4)
        self.assertEqual(bc._to_float(" 0.0 "), 0.0)
        self.assertIsNone(bc._to_float("(NA)"))
        self.assertIsNone(bc._to_float(None))

    def test_parse_period(self):
        self.assertEqual(bc._parse_month("2026M04"), (2026, 4))
        self.assertIsNone(bc._parse_month("2026M13"))
        self.assertIsNone(bc._parse_month("2026Q1"))
        self.assertEqual(bc._parse_quarter("2026Q1"), (2026, 1))
        self.assertIsNone(bc._parse_quarter("2026Q5"))

    def test_period_arithmetic_rollover(self):
        self.assertEqual(bc._month_minus(2026, 1, 1), (2025, 12))
        self.assertEqual(bc._month_minus(2026, 4, 12), (2025, 4))
        self.assertEqual(bc._quarter_minus(2026, 1, 1), (2025, 4))

    def test_yoy_from_levels_unrounded_then_round_1dp(self):
        lvl = {(2026, 4): 130.902, (2025, 4): 126.150}
        self.assertEqual(bc._yoy_from_levels(lvl, 2026, 4), 3.8)
        # missing 12-month prior -> None
        self.assertIsNone(bc._yoy_from_levels({(2026, 4): 130.902}, 2026, 4))
        # zero base guarded
        self.assertIsNone(bc._yoy_from_levels({(2026, 4): 1.0, (2025, 4): 0.0}, 2026, 4))


# ── Edge cases (synthetic) ────────────────────────────────────────────────────
class EdgeCases(unittest.TestCase):
    def test_missing_12_month_prior_omits_yoy_keeps_mm(self):
        mm = _table([_row("DPCERGM", "2026M04", "0.4"), _row("DPCERGM", "2026M03", "0.7")])
        # levels present for the latest month but NOT 12 months prior
        lvl = _table([_row("DPCERG", "2026M04", "130.902"), _row("DPCERG", "2026M03", "130.0")])
        rels = _by_key(bc.build_releases(mm, lvl, None))
        pce = rels["pce"]
        self.assertEqual(_fig(pce, "m/m").value, 0.4)
        self.assertIsNone(_fig(pce, "y/y").value)  # omitted, not computed wrong

    def test_prior_selection_skips_gap(self):
        # latest 2026M04, but 2026M03 missing (gap) -> m/m prior is None, not M02.
        mm = _table([_row("DPCERGM", "2026M04", "0.4"), _row("DPCERGM", "2026M02", "0.9")])
        rels = _by_key(bc.build_releases(mm, _table([]), None))
        pce = rels["pce"]
        self.assertEqual(_fig(pce, "m/m").value, 0.4)
        self.assertIsNone(_fig(pce, "m/m").prior)

    def test_negative_gdp_value_parses(self):
        gdp = _table(
            [_row("A191RL", "2026Q1", "-2.1"), _row("A191RL", "2025Q4", "0.5")],
            notes=[{"NoteRef": "T10101", "NoteText": "... LastRevised: May 28, 2026"}],
        )
        rels = _by_key(bc.build_releases(None, None, gdp))
        self.assertEqual(_fig(rels["gdp"], "q/q annualized").value, -2.1)

    def test_comma_in_level_value(self):
        mm = _table([_row("DPCERGM", "2026M04", "0.4")])
        lvl = _table([_row("DPCERG", "2026M04", "1,300.000"), _row("DPCERG", "2025M04", "1,250.000")])
        rels = _by_key(bc.build_releases(mm, lvl, None))
        # (1300/1250 - 1)*100 = 4.0
        self.assertEqual(_fig(rels["pce"], "y/y").value, 4.0)


# ── Fail-soft ─────────────────────────────────────────────────────────────────
class FailSoft(unittest.TestCase):
    def test_all_none_yields_empty(self):
        self.assertEqual(bc.build_releases(None, None, None), [])

    def test_malformed_payloads_yield_empty(self):
        self.assertEqual(bc.build_releases({}, {}, {}), [])
        self.assertEqual(bc.build_releases({"BEAAPI": {}}, {"junk": 1}, []), [])

    def test_index_table_tolerant(self):
        self.assertEqual(bc._index_table(None), [])
        self.assertEqual(bc._index_table({"BEAAPI": {"Results": {}}}), [])

    def test_one_bad_release_does_not_sink_others(self):
        # GDP resolves; PCE tables are garbage -> only gdp comes back.
        gdp = _table([_row("A191RL", "2026Q1", "1.6"), _row("A191RL", "2025Q4", "0.5")])
        rels = _by_key(bc.build_releases({"oops": True}, None, gdp))
        self.assertEqual(set(rels), {"gdp"})

    def test_fetch_returns_empty_when_no_key(self):
        with mock.patch.object(bc, "_get_bea", return_value=None):
            self.assertEqual(bc.fetch_bea_releases(), [])

    def test_fetch_swallows_exceptions(self):
        with mock.patch.object(bc, "_get_bea", side_effect=RuntimeError("boom")):
            self.assertEqual(bc.fetch_bea_releases(), [])

    def test_fetch_builds_from_real_fixtures(self):
        side = [
            _load("bea_T20807_M.json"),
            _load("bea_T20804_M.json"),
            _load("bea_T10101_Q.json"),
        ]
        with mock.patch.object(bc, "_get_bea", side_effect=side):
            keys = {r.key for r in bc.fetch_bea_releases()}
        self.assertEqual(keys, {"pce", "core_pce", "gdp"})


if __name__ == "__main__":
    unittest.main()
