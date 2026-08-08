"""Tests for the transient-vs-permanent missing-candle fix.

A same-session call graded before its EOD candle is published must be DEFERRED
(no row written, re-scanned next run), not locked ungradable forever. A genuinely
past, still-empty session stays ungradable. Pure logic, injected fake candle
fetcher and clock. No network, no DB, no secrets.

Run from repo root: python -m unittest backend.tests.test_ungradable_transient
"""
import os
import sys
import unittest
from datetime import datetime, timezone

_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.dirname(_HERE)
_REPO = os.path.dirname(_BACKEND)
for _p in (_BACKEND, _REPO):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from backend.grading.price_attribution import PriceAttributionGrader  # noqa: E402
from backend.grading.resolver import REASON_NO_PRICE_DATA  # noqa: E402


def _clock(iso: str):
    return lambda: datetime.fromisoformat(iso).replace(tzinfo=timezone.utc)


def _valid_candle(_sym, _start, _end):
    """A published daily candle for any symbol. Target moves +5%, which the
    default benchmark move (also this candle) does not swamp."""
    return {
        "open_price": 100.0,
        "close_price": 105.0,
        "pct_change": 5.0,
        "candle_count": 1,
        "bars": [{"date": "2026-08-07", "open": 100.0, "close": 105.0}],
    }


def _empty_candle(_sym, _start, _end):
    return None  # what fetch_historical_candle returns when Tiingo has no bar


CALL = {
    "id": "c1",
    "claim_type": "ticker",
    "target_symbol": "GILD",
    "expected_direction": "bullish",
    "brief_date": "2026-08-07",
}


class TransientMissingCandleTests(unittest.TestCase):
    def test_same_session_before_candle_exists_is_deferred_not_ungradable(self):
        # Run fires on the SAME UTC day as the session, candle not published yet.
        g = PriceAttributionGrader(fetch_candle=_empty_candle, now=_clock("2026-08-07T22:36:00"))
        out = g.resolve(CALL)
        self.assertTrue(out.is_deferred, "same-session missing candle must defer")
        self.assertFalse(out.is_gradable)
        self.assertEqual(out.metadata.get("absence"), "transient")
        # A deferred outcome is never written: the runner skips on is_deferred.
        self.assertEqual(out.verdict, "deferred")

    def test_same_call_after_candle_exists_resolves_normally(self):
        # Candle now published; the empty branch is never reached.
        g = PriceAttributionGrader(fetch_candle=_valid_candle, now=_clock("2026-08-10T22:00:00"))
        out = g.resolve(CALL)
        self.assertFalse(out.is_deferred)
        self.assertTrue(out.is_gradable, "a published candle must grade")
        self.assertIn(out.verdict, ("correct", "wrong", "partial"))

    def test_genuinely_unpriceable_past_session_still_ungradable(self):
        # A PAST session that is still empty is a real ungradable (permanent).
        g = PriceAttributionGrader(fetch_candle=_empty_candle, now=_clock("2026-08-11T12:00:00"))
        out = g.resolve(CALL)
        self.assertFalse(out.is_deferred)
        self.assertFalse(out.is_gradable)
        self.assertEqual(out.verdict, "ungradable")
        self.assertEqual(out.metadata.get("ungradable_reason"), REASON_NO_PRICE_DATA)
        self.assertEqual(out.metadata.get("absence"), "permanent")

    def test_existing_outcomes_untouched_deferred_writes_no_row(self):
        # The runner contract: it inserts only for non-deferred outcomes and never
        # updates existing rows. A deferred outcome must therefore write nothing.
        g = PriceAttributionGrader(fetch_candle=_empty_candle, now=_clock("2026-08-07T22:36:00"))
        deferred_out = g.resolve(CALL)
        # `if outcome.is_deferred: continue` is the exact write gate in both
        # runners; a True here means no insert and no status change for this call.
        self.assertTrue(deferred_out.is_deferred)

        # A gradable/permanent outcome still writes (behavior unchanged): only
        # NEW rows are ever inserted, existing rows are never rewritten.
        gradable = PriceAttributionGrader(fetch_candle=_valid_candle, now=_clock("2026-08-10T22:00:00")).resolve(CALL)
        self.assertFalse(gradable.is_deferred)
        permanent = PriceAttributionGrader(fetch_candle=_empty_candle, now=_clock("2026-08-11T12:00:00")).resolve(CALL)
        self.assertFalse(permanent.is_deferred)

    def test_boundary_session_equals_today_defers(self):
        # Exactly today (UTC) counts as not-yet-published: defer, do not lock.
        g = PriceAttributionGrader(fetch_candle=_empty_candle, now=_clock("2026-08-07T20:05:00"))
        self.assertTrue(g.resolve(CALL).is_deferred)


if __name__ == "__main__":
    unittest.main()
