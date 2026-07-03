"""
Deterministic tests for the attribution-aware call grader.

Pure logic only: classify_attribution matrix, router dispatch, and the
grader's ungradable paths with injected fake candle fetchers. No network,
no secrets, no Supabase.
"""

from datetime import date

import pytest

from backend.grading.price_attribution import (
    TIER_BROAD_INDEX,
    TIER_SECTOR_ETF,
    TIER_SINGLE_STOCK,
    BenchmarkMove,
    PriceAttributionGrader,
    classify_attribution,
    resolve_tier,
)
from backend.grading.resolver import (
    ATTRIBUTION_CLEAN,
    ATTRIBUTION_CONFOUNDED,
    ATTRIBUTION_INCONCLUSIVE,
    REASON_NO_BENCHMARK_DATA,
    REASON_NO_HONEST_GRADER,
    REASON_NO_PRICE_DATA,
    REASON_UNMAPPED_SYMBOL,
    VERDICT_CORRECT,
    VERDICT_PARTIAL,
    VERDICT_UNGRADABLE,
    VERDICT_WRONG,
    default_resolver,
)

SPY_BAR = TIER_BROAD_INDEX.min_excess_pct
XLK_BAR = TIER_SECTOR_ETF.min_excess_pct


def bench(spy_pct, xlk_pct=None):
    moves = []
    if xlk_pct is not None:
        moves.append(BenchmarkMove("XLK", "sector", xlk_pct, XLK_BAR))
    moves.append(BenchmarkMove("SPY", "market", spy_pct, SPY_BAR))
    return moves


class TestClassifyAttribution:
    def test_clean_hit_beyond_both_benchmarks(self):
        # Stock +2.5% while sector +0.3% and market +0.1%: a real call.
        r = classify_attribution("bullish", 2.5, bench(0.1, 0.3), TIER_SINGLE_STOCK)
        assert r.verdict == VERDICT_CORRECT
        assert r.attribution == ATTRIBUTION_CLEAN
        assert r.realized_direction == "up"
        assert r.attribution_confidence >= 0.8

    def test_market_rally_is_confounded_not_correct(self):
        # The core credibility case: stock +1.2% but the whole market +1.0%.
        r = classify_attribution("bullish", 1.2, bench(1.0, 1.1), TIER_SINGLE_STOCK)
        assert r.verdict == VERDICT_PARTIAL
        assert r.attribution == ATTRIBUTION_CONFOUNDED

    def test_sector_rally_alone_confounds(self):
        # Market flat but the sector carried it.
        r = classify_attribution("bullish", 1.0, bench(0.05, 0.9), TIER_SINGLE_STOCK)
        assert r.verdict == VERDICT_PARTIAL
        assert r.attribution == ATTRIBUTION_CONFOUNDED

    def test_below_bar_with_quiet_benchmarks_is_inconclusive(self):
        # Moved up on its own but did not clear the crediting bar.
        r = classify_attribution("bullish", 0.6, bench(0.05, 0.1), TIER_SINGLE_STOCK)
        assert r.verdict == VERDICT_PARTIAL
        assert r.attribution == ATTRIBUTION_INCONCLUSIVE

    def test_opposite_move_is_wrong(self):
        r = classify_attribution("bullish", -2.0, bench(-0.1, -0.2), TIER_SINGLE_STOCK)
        assert r.verdict == VERDICT_WRONG

    def test_wrong_call_dragged_by_market_selloff_tagged_confounded(self):
        r = classify_attribution("bullish", -1.2, bench(-1.0, -1.1), TIER_SINGLE_STOCK)
        assert r.verdict == VERDICT_WRONG
        assert r.attribution == ATTRIBUTION_CONFOUNDED

    def test_flat_on_directional_call_is_partial(self):
        r = classify_attribution("bullish", 0.1, bench(0.0, 0.0), TIER_SINGLE_STOCK)
        assert r.verdict == VERDICT_PARTIAL
        assert r.realized_direction == "flat"

    def test_relative_outperformance_never_upgrades_a_flat_miss(self):
        # Stock flat while market fell 2%: relative win, absolute miss.
        r = classify_attribution("bullish", 0.1, bench(-2.0, -1.8), TIER_SINGLE_STOCK)
        assert r.verdict == VERDICT_PARTIAL

    def test_bearish_mirror_clean(self):
        r = classify_attribution("bearish", -2.5, bench(-0.1, -0.2), TIER_SINGLE_STOCK)
        assert r.verdict == VERDICT_CORRECT
        assert r.attribution == ATTRIBUTION_CLEAN

    def test_bearish_confounded_by_selloff(self):
        r = classify_attribution("bearish", -1.3, bench(-1.1, -1.2), TIER_SINGLE_STOCK)
        assert r.verdict == VERDICT_PARTIAL
        assert r.attribution == ATTRIBUTION_CONFOUNDED

    def test_neutral_flat_against_moving_market_is_clean_correct(self):
        r = classify_attribution("neutral", 0.1, bench(1.5, 1.2), TIER_SINGLE_STOCK)
        assert r.verdict == VERDICT_CORRECT
        assert r.attribution == ATTRIBUTION_CLEAN

    def test_neutral_flat_in_flat_market_gets_no_credit(self):
        r = classify_attribution("neutral", 0.05, bench(0.05, 0.02), TIER_SINGLE_STOCK)
        assert r.verdict == VERDICT_PARTIAL
        assert r.attribution == ATTRIBUTION_CONFOUNDED

    def test_index_clean_needs_the_absolute_bar(self):
        # Broad index has no benchmark; 0.35% clears the dead band but
        # not the crediting bar.
        r = classify_attribution("bullish", 0.35, [], TIER_BROAD_INDEX)
        assert r.verdict == VERDICT_PARTIAL
        assert r.attribution == ATTRIBUTION_INCONCLUSIVE
        r2 = classify_attribution("bullish", 0.8, [], TIER_BROAD_INDEX)
        assert r2.verdict == VERDICT_CORRECT
        assert r2.attribution == ATTRIBUTION_CLEAN

    def test_confidence_scales_with_excess_margin(self):
        barely = classify_attribution("bullish", 0.9, bench(0.0, 0.1), TIER_SINGLE_STOCK)
        decisive = classify_attribution("bullish", 4.0, bench(0.0, 0.1), TIER_SINGLE_STOCK)
        assert barely.attribution == decisive.attribution == ATTRIBUTION_CLEAN
        assert decisive.attribution_confidence > barely.attribution_confidence

    def test_never_reads_call_confidence(self):
        # classify_attribution has no confidence parameter at all; this
        # locks the signature so one cannot be threaded in casually.
        import inspect

        params = inspect.signature(classify_attribution).parameters
        assert "confidence" not in params


class TestResolveTier:
    def test_tiers(self):
        assert resolve_tier("ticker", "AAPL") is TIER_SINGLE_STOCK
        assert resolve_tier("ticker", "TSLA").name == "high_vol"
        assert resolve_tier("sector", "XLK") is TIER_SECTOR_ETF
        assert resolve_tier("index", "SPY") is TIER_BROAD_INDEX
        # A "ticker" claim naming a broad ETF gets index treatment.
        assert resolve_tier("ticker", "QQQ") is TIER_BROAD_INDEX


def make_call(**over):
    call = {
        "id": "call-1",
        "brief_date": date(2026, 7, 2).isoformat(),
        "claim_text": "NVDA rips on AI demand",
        "claim_type": "ticker",
        "target_symbol": "NVDA",
        "expected_direction": "bullish",
        "confidence": 0.7,
    }
    call.update(over)
    return call


def fake_fetcher(prices):
    """prices: symbol -> (open, close). Missing symbol returns None."""

    def fetch(symbol, from_ts, to_ts):
        pair = prices.get(symbol.upper())
        if not pair:
            return None
        o, c = pair
        return {
            "open_price": o,
            "close_price": c,
            "pct_change": round((c - o) / o * 100, 2),
            "candle_count": 1,
            "from_ts": from_ts.isoformat(),
            "to_ts": to_ts.isoformat(),
        }

    return fetch


class TestPriceAttributionGrader:
    def test_full_clean_grade_with_sector_benchmark(self):
        grader = PriceAttributionGrader(
            ticker_sectors={"NVDA": "technology"},
            fetch_candle=fake_fetcher(
                {"NVDA": (100.0, 103.0), "XLK": (200.0, 200.4), "SPY": (500.0, 500.5)}
            ),
        )
        out = grader.resolve(make_call())
        assert out.verdict == VERDICT_CORRECT
        assert out.attribution == ATTRIBUTION_CLEAN
        assert out.actual_pct_change == pytest.approx(0.03)
        assert out.metadata["benchmark_coverage"] == "sector_and_market"
        assert {b["symbol"] for b in out.metadata["benchmarks"]} == {"XLK", "SPY"}
        assert out.metadata["attribution_confidence"] > 0

    def test_unknown_sector_grades_market_only_with_penalty(self):
        prices = {"ZZZZ": (10.0, 10.5), "SPY": (500.0, 500.2)}
        with_sector = PriceAttributionGrader(
            ticker_sectors={"ZZZZ": "technology"},
            fetch_candle=fake_fetcher({**prices, "XLK": (200.0, 200.1)}),
        ).resolve(make_call(target_symbol="ZZZZ"))
        without = PriceAttributionGrader(
            ticker_sectors={}, fetch_candle=fake_fetcher(prices)
        ).resolve(make_call(target_symbol="ZZZZ"))
        assert without.metadata["benchmark_coverage"] == "market_only"
        assert (
            without.metadata["attribution_confidence"]
            < with_sector.metadata["attribution_confidence"]
        )

    def test_known_sector_with_failed_etf_data_is_ungradable(self):
        grader = PriceAttributionGrader(
            ticker_sectors={"NVDA": "technology"},
            fetch_candle=fake_fetcher({"NVDA": (100.0, 103.0), "SPY": (500.0, 500.5)}),
        )
        out = grader.resolve(make_call())
        assert out.verdict == VERDICT_UNGRADABLE
        assert out.metadata["ungradable_reason"] == REASON_NO_BENCHMARK_DATA

    def test_no_entity_price_data_is_ungradable(self):
        grader = PriceAttributionGrader(fetch_candle=fake_fetcher({}))
        out = grader.resolve(make_call(target_symbol="AAPL"))
        assert out.verdict == VERDICT_UNGRADABLE
        assert out.metadata["ungradable_reason"] == REASON_NO_PRICE_DATA

    def test_unmapped_sector_label_is_ungradable(self):
        grader = PriceAttributionGrader(fetch_candle=fake_fetcher({}))
        out = grader.resolve(
            make_call(claim_type="sector", target_symbol="quantum widgets")
        )
        assert out.verdict == VERDICT_UNGRADABLE
        assert out.metadata["ungradable_reason"] == REASON_UNMAPPED_SYMBOL

    def test_missing_ticker_symbol_is_ungradable(self):
        grader = PriceAttributionGrader(fetch_candle=fake_fetcher({}))
        out = grader.resolve(make_call(target_symbol=None))
        assert out.verdict == VERDICT_UNGRADABLE
        assert out.metadata["ungradable_reason"] == REASON_UNMAPPED_SYMBOL

    def test_index_claim_graded_absolute_no_benchmark(self):
        grader = PriceAttributionGrader(
            fetch_candle=fake_fetcher({"SPY": (500.0, 504.0)})
        )
        out = grader.resolve(
            make_call(claim_type="index", target_symbol="SPX")
        )
        assert out.verdict == VERDICT_CORRECT
        assert out.metadata["entity_symbol"] == "SPY"
        assert out.metadata["benchmark_coverage"] == "none"

    def test_stored_pct_change_stays_a_fraction(self):
        grader = PriceAttributionGrader(
            fetch_candle=fake_fetcher({"SPY": (500.0, 504.0)})
        )
        out = grader.resolve(make_call(claim_type="index", target_symbol="SPY"))
        assert out.actual_pct_change == pytest.approx(0.008)
        assert out.metadata["entity_move_pct"] == pytest.approx(0.8)


class TestRouter:
    def test_aggregate_routes_to_honest_refusal(self):
        resolver = default_resolver(PriceAttributionGrader(fetch_candle=fake_fetcher({})))
        out = resolver.resolve(make_call(claim_type="aggregate", target_symbol=None))
        assert out.verdict == VERDICT_UNGRADABLE
        assert out.metadata["ungradable_reason"] == REASON_NO_HONEST_GRADER
        assert not out.is_gradable

    def test_unknown_claim_type_routes_to_honest_refusal(self):
        resolver = default_resolver(PriceAttributionGrader(fetch_candle=fake_fetcher({})))
        out = resolver.resolve(make_call(claim_type="vibes"))
        assert out.verdict == VERDICT_UNGRADABLE
        assert out.metadata["ungradable_reason"] == REASON_NO_HONEST_GRADER

    def test_ticker_routes_to_price_grader(self):
        resolver = default_resolver(
            PriceAttributionGrader(
                fetch_candle=fake_fetcher(
                    {"NVDA": (100.0, 103.0), "SPY": (500.0, 500.5)}
                )
            )
        )
        out = resolver.resolve(make_call())
        assert out.is_gradable
        assert out.metadata["grader"] == "price_attribution_v1"
