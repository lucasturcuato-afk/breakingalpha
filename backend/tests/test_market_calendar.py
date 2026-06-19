"""Unit tests for backend/market_calendar.py (US equities trading-day calendar).

Pure / offline: market_calendar imports only stdlib, no env, no network.

Run from repo root: python -m unittest backend.tests.test_market_calendar
"""
import datetime as dt
import sys
import unittest
from pathlib import Path

_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

import market_calendar as mc  # noqa: E402


class IsTradingDay(unittest.TestCase):
    def test_normal_weekday_open(self):
        # 2026-06-18 (Thursday) is a normal trading day
        self.assertTrue(mc.is_trading_day(dt.date(2026, 6, 18)))

    def test_juneteenth_closed(self):
        # 2026-06-19 (Friday) Juneteenth, full closure
        self.assertFalse(mc.is_trading_day(dt.date(2026, 6, 19)))
        self.assertEqual(mc.holiday_name(dt.date(2026, 6, 19)),
                         "Juneteenth National Independence Day")

    def test_weekend_closed(self):
        self.assertFalse(mc.is_trading_day(dt.date(2026, 6, 20)))  # Saturday
        self.assertFalse(mc.is_trading_day(dt.date(2026, 6, 21)))  # Sunday

    def test_observed_shift_independence_day(self):
        # 2026-07-04 is a Saturday -> observed Friday 2026-07-03 is the closure
        self.assertFalse(mc.is_trading_day(dt.date(2026, 7, 3)))
        self.assertIn("Independence Day", mc.holiday_name(dt.date(2026, 7, 3)))
        # July 4 itself (Saturday) is closed as a weekend, not a named holiday here
        self.assertFalse(mc.is_trading_day(dt.date(2026, 7, 4)))

    def test_year_boundary_2027(self):
        self.assertFalse(mc.is_trading_day(dt.date(2027, 1, 1)))  # New Year's Day
        self.assertFalse(mc.is_trading_day(dt.date(2027, 6, 18)))  # Juneteenth observed
        self.assertTrue(mc.is_trading_day(dt.date(2027, 6, 17)))

    def test_holiday_name_none_on_trading_day(self):
        self.assertIsNone(mc.holiday_name(dt.date(2026, 6, 18)))

    def test_fail_open_on_garbage(self):
        self.assertTrue(mc.is_trading_day("not-a-date"))  # fail-open, not falsely closed


class LastTradingSession(unittest.TestCase):
    def test_normal_day_is_itself(self):
        self.assertEqual(mc.last_trading_session(dt.date(2026, 6, 18)), dt.date(2026, 6, 18))

    def test_juneteenth_returns_prior_thursday(self):
        # Juneteenth 2026-06-19 -> last session is Thursday 2026-06-18
        self.assertEqual(mc.last_trading_session(dt.date(2026, 6, 19)), dt.date(2026, 6, 18))

    def test_monday_holiday_returns_prior_friday(self):
        # Memorial Day 2026-05-25 (Monday) -> last session Friday 2026-05-22
        self.assertEqual(mc.last_trading_session(dt.date(2026, 5, 25)), dt.date(2026, 5, 22))

    def test_sunday_returns_prior_friday(self):
        self.assertEqual(mc.last_trading_session(dt.date(2026, 6, 21)), dt.date(2026, 6, 19)
                         if mc.is_trading_day(dt.date(2026, 6, 19)) else dt.date(2026, 6, 18))


class MarketStatus(unittest.TestCase):
    def test_closed_holiday(self):
        s = mc.market_status(dt.date(2026, 6, 19))
        self.assertTrue(s["market_closed"])
        self.assertEqual(s["holiday_name"], "Juneteenth National Independence Day")
        self.assertEqual(s["last_trading_session"], "2026-06-18")

    def test_open_day(self):
        s = mc.market_status(dt.date(2026, 6, 18))
        self.assertFalse(s["market_closed"])
        self.assertIsNone(s["holiday_name"])
        self.assertEqual(s["last_trading_session"], "2026-06-18")

    def test_weekend_named_weekend(self):
        s = mc.market_status(dt.date(2026, 6, 20))  # Saturday
        self.assertTrue(s["market_closed"])
        self.assertEqual(s["holiday_name"], "Weekend")

    def test_accepts_datetime_and_iso(self):
        self.assertTrue(mc.market_status(dt.datetime(2026, 6, 19, 12, 0))["market_closed"])
        self.assertTrue(mc.market_status("2026-06-19")["market_closed"])


if __name__ == "__main__":
    unittest.main()
