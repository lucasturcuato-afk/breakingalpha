"""
Tests for the Tiingo-backed market_data helper: response parsing,
adjusted-price usage, the shared per-symbol-per-day cache, persistence
across simulated processes, budget degradation, and honest no-data
handling. All HTTP is faked; no network, no secrets.
"""

import json
import time
from datetime import datetime, timezone

import pytest

import backend.market_data as md


def utc(y, m, d, hh=0, mm=0, ss=0):
    return datetime(y, m, d, hh, mm, ss, tzinfo=timezone.utc)


def tiingo_bar(iso_date, open_, close, adj_open=None, adj_close=None):
    return {
        "date": f"{iso_date}T00:00:00.000Z",
        "open": open_,
        "close": close,
        "high": max(open_, close),
        "low": min(open_, close),
        "adjOpen": adj_open if adj_open is not None else open_,
        "adjClose": adj_close if adj_close is not None else close,
    }


class FakeResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code

    def json(self):
        return self._payload


@pytest.fixture
def tiingo_env(tmp_path, monkeypatch):
    """Isolated cache file + dummy key + no pacing sleeps + HTTP recorder."""
    monkeypatch.setenv("TIINGO_API_KEY", "test-key")
    monkeypatch.setenv("TIINGO_CACHE_PATH", str(tmp_path / "tiingo_cache.json"))
    monkeypatch.setattr(md, "_pace", lambda: None)
    # Force a fresh in-memory cache pointed at the tmp file.
    monkeypatch.setattr(md, "_cache", None)
    monkeypatch.setattr(md, "_cache_path_loaded", None)

    calls = []

    def install(responses):
        """responses: dict symbol -> FakeResponse (or list to pop from)."""

        def fake_get(url, params=None, timeout=None):
            sym = url.rstrip("/").split("/")[-2]
            calls.append((sym, params["startDate"], params["endDate"]))
            r = responses[sym]
            if isinstance(r, list):
                return r.pop(0)
            return r

        monkeypatch.setattr(md.requests, "get", fake_get)
        return calls

    return install, calls, tmp_path


def test_parses_bars_and_uses_adjusted_prices(tiingo_env):
    install, calls, _ = tiingo_env
    # Raw prices reflect a 2:1 split mid-window; adjusted prices do not.
    install({"AAPL": FakeResponse([
        tiingo_bar("2026-07-01", 200.0, 202.0, adj_open=100.0, adj_close=101.0),
        tiingo_bar("2026-07-02", 101.0, 103.0),
    ])})
    out = md.fetch_historical_candle("AAPL", utc(2026, 7, 1), utc(2026, 7, 2))
    assert out["open_price"] == 100.0   # adjOpen of first bar, not raw 200
    assert out["close_price"] == 103.0  # adjClose of last bar
    assert out["pct_change"] == 3.0     # no false 48% "crash" from the split
    assert out["candle_count"] == 2
    assert calls == [("AAPL", "2026-07-01", "2026-07-02")]


def test_empty_array_means_no_data_not_error(tiingo_env):
    install, calls, _ = tiingo_env
    install({"SPY": FakeResponse([])})
    assert md.fetch_historical_candle("SPY", utc(2026, 7, 4), utc(2026, 7, 4)) is None


def test_benchmark_fetched_once_per_day_across_calls(tiingo_env):
    install, calls, _ = tiingo_env
    install({
        "SPY": FakeResponse([tiingo_bar("2026-07-02", 500.0, 501.0)]),
        "NVDA": FakeResponse([tiingo_bar("2026-07-02", 100.0, 103.0)]),
        "AMD": FakeResponse([tiingo_bar("2026-07-02", 50.0, 51.0)]),
    })
    # Three grader calls on the same session all reference SPY.
    for sym in ("NVDA", "SPY", "AMD", "SPY", "SPY"):
        assert md.fetch_historical_candle(sym, utc(2026, 7, 2), utc(2026, 7, 2))
    fetched = [c[0] for c in calls]
    assert fetched.count("SPY") == 1
    assert len(fetched) == 3


def test_cache_persists_across_processes(tiingo_env, monkeypatch):
    install, calls, tmp_path = tiingo_env
    install({"SPY": FakeResponse([tiingo_bar("2026-07-02", 500.0, 505.0)])})
    first = md.fetch_historical_candle("SPY", utc(2026, 7, 2), utc(2026, 7, 2))
    # Simulate a new process: drop in-memory state, keep the file.
    monkeypatch.setattr(md, "_cache", None)
    monkeypatch.setattr(md, "_cache_path_loaded", None)
    second = md.fetch_historical_candle("SPY", utc(2026, 7, 2), utc(2026, 7, 2))
    assert second == first
    assert len(calls) == 1  # the second run never hit HTTP


def test_empty_results_are_never_cached(tiingo_env):
    install, calls, _ = tiingo_env
    # First run: EOD not posted yet. Second run: data has landed.
    install({"SPY": [
        FakeResponse([]),
        FakeResponse([tiingo_bar("2026-07-02", 500.0, 505.0)]),
    ]})
    assert md.fetch_historical_candle("SPY", utc(2026, 7, 2), utc(2026, 7, 2)) is None
    out = md.fetch_historical_candle("SPY", utc(2026, 7, 2), utc(2026, 7, 2))
    assert out is not None and out["close_price"] == 505.0
    assert len(calls) == 2


def test_hourly_budget_degrades_to_none_without_http(tiingo_env):
    install, calls, _ = tiingo_env
    install({"SPY": FakeResponse([tiingo_bar("2026-07-02", 500.0, 505.0)])})
    now = time.time()
    md._get_cache()["requests"] = [now - 10] * md.HOURLY_REQUEST_BUDGET
    assert md.fetch_historical_candle("SPY", utc(2026, 7, 2), utc(2026, 7, 2)) is None
    assert calls == []  # never went to the network


def test_budget_check_still_serves_from_cache(tiingo_env):
    install, calls, _ = tiingo_env
    install({"SPY": FakeResponse([tiingo_bar("2026-07-02", 500.0, 505.0)])})
    assert md.fetch_historical_candle("SPY", utc(2026, 7, 2), utc(2026, 7, 2))
    md._get_cache()["requests"] = [time.time() - 10] * md.HOURLY_REQUEST_BUDGET
    # Cache hits must keep working after the budget is exhausted.
    assert md.fetch_historical_candle("SPY", utc(2026, 7, 2), utc(2026, 7, 2))
    assert len(calls) == 1


def test_rate_limit_response_returns_none(tiingo_env):
    install, calls, _ = tiingo_env
    install({"SPY": FakeResponse({"detail": "rate limited"}, status_code=429)})
    assert md.fetch_historical_candle("SPY", utc(2026, 7, 2), utc(2026, 7, 2)) is None


def test_unknown_ticker_404_is_no_data(tiingo_env):
    install, calls, _ = tiingo_env
    install({"ZZZZZ": FakeResponse({"detail": "not found"}, status_code=404)})
    assert md.fetch_historical_candle("ZZZZZ", utc(2026, 7, 2), utc(2026, 7, 2)) is None


def test_missing_api_key_returns_none(tiingo_env, monkeypatch):
    install, calls, _ = tiingo_env
    install({})
    monkeypatch.delenv("TIINGO_API_KEY")
    assert md.fetch_historical_candle("SPY", utc(2026, 7, 2), utc(2026, 7, 2)) is None
    assert calls == []


def test_multi_day_window_uses_first_open_last_close(tiingo_env):
    install, calls, _ = tiingo_env
    install({"MSFT": FakeResponse([
        tiingo_bar("2026-06-29", 100.0, 101.0),
        tiingo_bar("2026-06-30", 101.0, 99.0),
        tiingo_bar("2026-07-01", 99.0, 104.0),
    ])})
    out = md.fetch_historical_candle("MSFT", utc(2026, 6, 29), utc(2026, 7, 1))
    assert out["open_price"] == 100.0
    assert out["close_price"] == 104.0
    assert out["candle_count"] == 3
    # And the multi-day window itself is cached for a repeat run.
    out2 = md.fetch_historical_candle("MSFT", utc(2026, 6, 29), utc(2026, 7, 1))
    assert out2 == out
    assert len(calls) == 1


def test_cache_file_is_valid_json_with_request_log(tiingo_env):
    install, _, tmp_path = tiingo_env
    install({"SPY": FakeResponse([tiingo_bar("2026-07-02", 500.0, 505.0)])})
    md.fetch_historical_candle("SPY", utc(2026, 7, 2), utc(2026, 7, 2))
    with open(tmp_path / "tiingo_cache.json") as f:
        raw = json.load(f)
    assert "SPY:2026-07-02" in raw["bars"]
    assert len(raw["requests"]) == 1


def test_index_performance_wrapper(tiingo_env):
    install, _, _ = tiingo_env
    install({"SPY": FakeResponse([tiingo_bar("2026-07-02", 500.0, 505.0)])})
    out = md.fetch_index_performance("SPY", utc(2026, 7, 2), utc(2026, 7, 2))
    assert out["pct_change"] == 1.0
