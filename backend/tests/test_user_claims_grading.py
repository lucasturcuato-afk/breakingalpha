"""
Tests for the user-claims grading extension: sqrt-scaled multi-session
windows, the claim -> call mapping, and the guarantee that the brief-call
(single-session) path is unchanged. No network, no Supabase.
"""

from datetime import date, datetime, timezone

import pytest

from backend.grading.grade_user_claims import claim_to_call, is_price_gradeable
from backend.grading.price_attribution import (
    TIER_SINGLE_STOCK,
    PriceAttributionGrader,
    scale_tier_for_sessions,
    window_scale,
    _grading_window,
)
from backend.grading.resolver import VERDICT_CORRECT, VERDICT_PARTIAL


def fake_fetcher(prices, candle_counts=None):
    """prices: symbol -> (open, close); candle_counts: symbol -> n."""

    def fetch(symbol, from_ts, to_ts):
        pair = prices.get(symbol.upper())
        if not pair:
            return None
        o, c = pair
        return {
            "open_price": o,
            "close_price": c,
            "pct_change": round((c - o) / o * 100, 2),
            "candle_count": (candle_counts or {}).get(symbol.upper(), 1),
            "from_ts": from_ts.isoformat(),
            "to_ts": to_ts.isoformat(),
        }

    return fetch


class TestWindowScaling:
    def test_single_session_scale_is_exactly_one(self):
        assert window_scale(1) == 1.0
        assert window_scale(0) == 1.0
        assert scale_tier_for_sessions(TIER_SINGLE_STOCK, 1) is TIER_SINGLE_STOCK

    def test_sqrt_scaling(self):
        assert window_scale(4) == 2.0
        t = scale_tier_for_sessions(TIER_SINGLE_STOCK, 4)
        assert t.dead_band_pct == TIER_SINGLE_STOCK.dead_band_pct * 2
        assert t.min_excess_pct == TIER_SINGLE_STOCK.min_excess_pct * 2
        assert t.name == TIER_SINGLE_STOCK.name

    def test_grading_window_widens_with_start(self):
        w = _grading_window("2026-07-03", "2026-06-29")
        assert w[0] == datetime(2026, 6, 29, 0, 0, tzinfo=timezone.utc)
        assert w[1].date() == date(2026, 7, 3)

    def test_invalid_or_later_start_is_ignored(self):
        single = _grading_window("2026-07-03")
        assert _grading_window("2026-07-03", "not-a-date") == single
        assert _grading_window("2026-07-03", "2026-07-05") == single
        assert _grading_window("2026-07-03", None) == single


class TestMultiSessionGrading:
    def make_claim_call(self, **over):
        call = {
            "id": "claim-1",
            "claim_type": "ticker",
            "target_symbol": "NVDA",
            "expected_direction": "bullish",
            "brief_date": "2026-07-03",
            "window_start": "2026-06-29",
        }
        call.update(over)
        return call

    def test_multi_session_scales_thresholds_and_records_metadata(self):
        # 5 sessions: bar scales by sqrt(5) ~ 2.236 (min_excess 0.75 ->
        # ~1.68). A +1.5% move that would be a clean daily hit is below
        # the scaled bar over a week.
        grader = PriceAttributionGrader(
            ticker_sectors={"NVDA": "technology"},
            fetch_candle=fake_fetcher(
                {"NVDA": (100.0, 101.5), "XLK": (200.0, 200.2), "SPY": (500.0, 500.5)},
                candle_counts={"NVDA": 5, "XLK": 5, "SPY": 5},
            ),
        )
        out = grader.resolve(self.make_claim_call())
        assert out.metadata["window_sessions"] == 5
        assert out.metadata["threshold_scale"] == pytest.approx(5 ** 0.5, abs=0.001)
        assert out.metadata["thresholds_pct"]["min_excess"] == pytest.approx(
            0.75 * 5 ** 0.5, abs=0.01
        )
        assert out.verdict == VERDICT_PARTIAL  # below the scaled bar

    def test_decisive_multi_session_move_still_grades_clean(self):
        grader = PriceAttributionGrader(
            ticker_sectors={"NVDA": "technology"},
            fetch_candle=fake_fetcher(
                {"NVDA": (100.0, 112.0), "XLK": (200.0, 201.0), "SPY": (500.0, 501.0)},
                candle_counts={"NVDA": 5, "XLK": 5, "SPY": 5},
            ),
        )
        out = grader.resolve(self.make_claim_call())
        assert out.verdict == VERDICT_CORRECT
        assert out.attribution == "clean"

    def test_brief_call_path_has_no_window_keys(self):
        # No window_start: single-session grading, metadata byte-identical
        # to the pre-extension shape (no window_sessions/threshold_scale).
        grader = PriceAttributionGrader(
            ticker_sectors={"NVDA": "technology"},
            fetch_candle=fake_fetcher(
                {"NVDA": (100.0, 103.0), "XLK": (200.0, 200.4), "SPY": (500.0, 500.5)}
            ),
        )
        out = grader.resolve(
            {
                "id": "call-1",
                "claim_type": "ticker",
                "target_symbol": "NVDA",
                "expected_direction": "bullish",
                "brief_date": "2026-07-02",
            }
        )
        assert out.verdict == VERDICT_CORRECT
        assert "window_sessions" not in out.metadata
        assert "threshold_scale" not in out.metadata
        assert out.metadata["thresholds_pct"] == {"dead_band": 0.5, "min_excess": 0.75}


class TestClaimMapping:
    def test_claim_to_call_shape(self):
        call = claim_to_call(
            {
                "id": "c1",
                "claim_type": "ticker",
                "target_symbol": "AMD",
                "expected_direction": "bearish",
                "resolution_window_start": "2026-07-01",
                "resolution_window_end": "2026-07-10",
                "user_claim": "AMD gives back the ramp hype by mid-July",
            }
        )
        assert call["brief_date"] == "2026-07-10"
        assert call["window_start"] == "2026-07-01"
        assert call["target_symbol"] == "AMD"

    def test_price_gradeable_filter(self):
        assert is_price_gradeable(
            {"gradeable": True, "resolution_method": {"method": "price_attribution"}}
        )
        assert not is_price_gradeable(
            {"gradeable": False, "resolution_method": {"method": "price_attribution"}}
        )
        assert not is_price_gradeable(
            {"gradeable": True, "resolution_method": {"method": "event_confirmation"}}
        )
        assert not is_price_gradeable({"gradeable": True, "resolution_method": None})
