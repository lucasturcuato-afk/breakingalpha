"""Unit tests for backend/event_calendar.py (scheduled-catalyst system).

Pure / offline: event_calendar imports only requests + stdlib, so it loads with
no env vars and makes no network call unless FRED_API_KEY is set. The live layer
is exercised by monkeypatching _fred_latest_two; no real HTTP.

Run from repo root: python -m unittest backend.tests.test_event_calendar
"""
import datetime as dt
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

import event_calendar as ec  # noqa: E402


class FloorTests(unittest.TestCase):
    def test_fomc_today_and_dotplot(self):
        # 2026-06-17 is an FOMC decision day with a dot plot (SEP meeting).
        cs = ec.get_upcoming_catalysts(dt.date(2026, 6, 16), window_days=2)
        fomc = [c for c in cs if c.type == "fomc"]
        self.assertEqual(len(fomc), 1)
        self.assertEqual(fomc[0].date, "2026-06-17")
        self.assertTrue(fomc[0].has_dot_plot)
        self.assertEqual(fomc[0].time_et, "2:00pm ET")

    def test_non_sep_meeting_has_no_dotplot(self):
        cs = ec.get_upcoming_catalysts(dt.date(2026, 7, 28), window_days=2)
        fomc = [c for c in cs if c.type == "fomc"]
        self.assertEqual(len(fomc), 1)  # 2026-07-29
        self.assertFalse(fomc[0].has_dot_plot)

    def test_upcoming_print_in_window(self):
        # asof 2026-06-18, 7d window -> PCE (May 2026) releases 2026-06-25.
        cs = ec.get_upcoming_catalysts(dt.date(2026, 6, 18), window_days=7)
        pce = [c for c in cs if c.type == "pce"]
        self.assertEqual(len(pce), 1)
        self.assertEqual(pce[0].date, "2026-06-25")
        self.assertIn("PCE", pce[0].name)

    def test_sorted_by_date(self):
        cs = ec.get_upcoming_catalysts(dt.date(2026, 7, 1), window_days=14)
        dates = [c.date for c in cs]
        self.assertEqual(dates, sorted(dates))
        self.assertIn("2026-07-02", dates)  # NFP Jun
        self.assertIn("2026-07-14", dates)  # CPI Jun

    def test_empty_window_soft_fail(self):
        # Late December 2026 past the last encoded print and before 2027 FOMC.
        cs = ec.get_upcoming_catalysts(dt.date(2026, 12, 28), window_days=10)
        self.assertEqual(cs, [])

    def test_year_boundary_into_2027(self):
        cs = ec.get_upcoming_catalysts(dt.date(2027, 1, 25), window_days=5)
        fomc = [c for c in cs if c.type == "fomc"]
        self.assertEqual(len(fomc), 1)
        self.assertEqual(fomc[0].date, "2027-01-27")

    def test_never_raises_on_garbage(self):
        self.assertEqual(ec.get_upcoming_catalysts(dt.date(1900, 1, 1), 1), [])

    def test_when_label(self):
        asof = dt.date(2026, 6, 18)
        self.assertEqual(ec.when_label(asof, "2026-06-18"), "today")
        self.assertEqual(ec.when_label(asof, "2026-06-19"), "tomorrow")
        self.assertTrue(ec.when_label(asof, "2026-06-21").startswith("in 3 days"))
        self.assertNotIn("days", ec.when_label(asof, "2026-07-14"))  # absolute date


class LiveTests(unittest.TestCase):
    def setUp(self):
        self._enabled = ec.LIVE_CALENDAR_ENABLED
        ec.LIVE_CALENDAR_ENABLED = True

    def tearDown(self):
        ec.LIVE_CALENDAR_ENABLED = self._enabled

    def test_enrich_maps_fred_actuals_to_right_events(self):
        floor = ec.get_upcoming_catalysts(dt.date(2026, 7, 1), window_days=14)
        # cpi + nfp present in this window
        fake = {
            "CPIAUCSL": ("3.1", "3.2"),  # pc1 -> "3.1% y/y"
            "PAYEMS": ("142", "150"),    # chg -> "+142K m/m"
            "PCEPI": ("2.8", "2.9"),
        }

        def fake_fetch(series_id, units, timeout):
            return fake.get(series_id, (None, None))

        with mock.patch.dict(os.environ, {"FRED_API_KEY": "x"}), \
                mock.patch.object(ec, "_fred_latest_two", side_effect=fake_fetch):
            enriched = ec.enrich_with_live(floor)
        by_type = {c.type: c for c in enriched}
        self.assertEqual(by_type["cpi"].previous, "3.1% y/y")
        self.assertEqual(by_type["nfp"].previous, "+142K m/m")
        # FOMC is not a FRED print and stays value-free.
        self.assertIsNone(by_type.get("fomc").previous if "fomc" in by_type else None)

    def test_no_key_falls_back_to_floor(self):
        floor = ec.get_upcoming_catalysts(dt.date(2026, 7, 1), window_days=14)
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("FRED_API_KEY", None)
            out = ec.enrich_with_live(floor)
        self.assertTrue(all(c.previous is None for c in out))
        self.assertEqual(len(out), len(floor))

    def test_live_failure_falls_back_to_floor(self):
        floor = ec.get_upcoming_catalysts(dt.date(2026, 7, 1), window_days=14)

        def boom(*a, **k):
            raise RuntimeError("timeout")

        with mock.patch.dict(os.environ, {"FRED_API_KEY": "x"}), \
                mock.patch.object(ec, "_fred_latest_two", side_effect=boom):
            out = ec.enrich_with_live(floor)
        self.assertEqual(len(out), len(floor))
        self.assertTrue(all(c.previous is None for c in out))

    def test_consensus_stays_none_without_paid_source(self):
        floor = ec.get_upcoming_catalysts(dt.date(2026, 7, 1), window_days=14)
        with mock.patch.dict(os.environ, {"FRED_API_KEY": "x"}), \
                mock.patch.object(ec, "_fred_latest_two", return_value=("3.1", "3.2")):
            out = ec.enrich_with_live(floor)
        self.assertTrue(all(c.consensus is None for c in out))

    def test_reconcile_fomc_prefers_static_and_logs(self):
        floor = ec.get_upcoming_catalysts(dt.date(2026, 6, 16), window_days=2)
        with self.assertLogs("event_calendar", level="WARNING") as cm:
            out = ec.reconcile_fomc(floor, {"fomc_june": "2026-06-18"})  # wrong date
        self.assertEqual([c.date for c in out if c.type == "fomc"], ["2026-06-17"])
        self.assertTrue(any("conflicts with static" in m for m in cm.output))


class BlockTests(unittest.TestCase):
    def test_block_with_values(self):
        asof = dt.date(2026, 7, 1)
        cs = ec.get_upcoming_catalysts(asof, window_days=14)
        for c in cs:
            if c.type == "cpi":
                c.previous = "3.1% y/y"
                c.consensus = "3.0% y/y"
        block = ec.build_catalyst_block(cs, asof, "morning")
        self.assertIn("[SCHEDULED CATALYSTS", block)
        self.assertIn("consensus 3.0% y/y", block)
        self.assertIn("prior 3.1% y/y", block)
        self.assertIn("not a prediction", block.lower())
        self.assertIn("USAGE (morning)", block)
        self.assertIn("MUST be named in what_to_watch", block)

    def test_block_schedule_only(self):
        asof = dt.date(2026, 6, 16)
        cs = ec.get_upcoming_catalysts(asof, window_days=2)  # FOMC only, no values
        block = ec.build_catalyst_block(cs, asof, "evening")
        self.assertIn("FOMC rate decision", block)
        self.assertIn("dot plot", block)
        self.assertNotIn("consensus", block)
        self.assertIn("USAGE (evening)", block)
        self.assertIn("tomorrow_setup", block)

    def test_block_empty_window_is_empty_string(self):
        asof = dt.date(2026, 12, 28)
        cs = ec.get_upcoming_catalysts(asof, window_days=10)
        self.assertEqual(ec.build_catalyst_block(cs, asof, "morning"), "")

    def test_render_payload_shape(self):
        asof = dt.date(2026, 6, 16)
        cs = ec.get_upcoming_catalysts(asof, window_days=2)
        payload = ec.to_render_payload(cs, asof)
        self.assertTrue(payload)
        row = payload[0]
        for k in ("date", "when", "name", "type", "time_et", "has_dot_plot", "impact"):
            self.assertIn(k, row)
        self.assertEqual(row["when"], "tomorrow")


if __name__ == "__main__":
    unittest.main()
