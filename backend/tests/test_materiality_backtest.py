"""Offline test wrapper for tools/materiality_backtest.py.

Keeps the labeled-day backtest green in the unittest suite: the keystone
(06-30 evening does NOT lead Rocket Lab) and 100% mode-agreement on every
ratified day that has a frozen-pool fixture. Pure / offline (no env, no network).

Run from repo root: python -m unittest backend.tests.test_materiality_backtest
"""
import os
import sys
import unittest
from pathlib import Path

_REPO = Path(__file__).resolve().parent.parent.parent
_TOOLS = _REPO / "tools"
for _p in (str(_REPO), str(_TOOLS)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import materiality_backtest as mb  # noqa: E402


class BacktestTests(unittest.TestCase):
    def setUp(self):
        self.rows = mb.read_ratified_rows()
        self.graded = [mb.grade_row(r) for r in self.rows]

    def test_at_least_one_ratified_row(self):
        self.assertTrue(self.rows, "expected at least the 06-30 evening ratified row")

    def test_keystone_not_rocket_lab(self):
        ok, g = mb.check_keystone(self.graded)
        self.assertIsNotNone(ok, "keystone row must be graded (fixture present)")
        self.assertTrue(ok, f"keystone failed: materiality lead was {g and g['materiality_lead']!r}")

    def test_all_graded_rows_agree(self):
        graded = [g for g in self.graded if g["status"] == "GRADED"]
        self.assertTrue(graded, "expected at least one gradeable ratified row")
        disagree = [g["date"] for g in graded if not g["agrees"]]
        self.assertFalse(disagree, f"ratified days disagreed with the materiality mode: {disagree}")

    def test_ratified_days_landed_market_wide(self):
        # Both currently-ratified days are mode A (market-wide); the materiality
        # ranker must land market-wide on each.
        for g in self.graded:
            if g["status"] == "GRADED":
                self.assertEqual(g["materiality_mode"], "A", f"{g['date']} did not land market-wide")

    def test_main_returns_zero(self):
        # The harness exit code is a gate; keep it green.
        self.assertEqual(mb.main(), 0)


if __name__ == "__main__":
    unittest.main()
