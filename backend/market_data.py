"""
Tiingo daily price helpers. The single candle/EOD price source for all
graders (attribution grader, memo, contrarian, brief_section).

Replaced the Finnhub /stock/candle path, which is blocked on our plan.
Finnhub remains in use elsewhere for quotes/news (thesis_grader.py,
finnhub_helper.py); daily bars come from Tiingo only.

Prices are split/dividend adjusted (adjOpen/adjClose) so historical
splits do not create false verdicts.

Cost control (Tiingo free tier: 50 req/hour, 1000/day, 500 unique
symbols/month):
  - Per-symbol-per-day bar cache shared across the whole process, so a
    benchmark like SPY is fetched once per session date and reused by
    every call that references it, never re-fetched per call.
  - The cache persists to a JSON file (default <repo>/.cache/
    tiingo_prices.json, override with TIINGO_CACHE_PATH), so repeated
    runs on the same day, e.g. dry-run iterations, do not re-fetch.
  - Empty responses are NEVER persisted: "no data yet" for today's
    session must not poison later re-runs after Tiingo posts EOD data.
  - A rolling request log in the same file enforces the hourly/daily
    request budget. On budget exhaustion, fetches return None and the
    caller degrades honestly (the resolver emits an explicit ungradable
    outcome); nothing crashes.
  - Requests are paced (PACING_SEC apart) on top of the budget.

Single-threaded by design, like the grading jobs that use it; the cache
file is written atomically (temp + rename) but there is no cross-process
locking.

The public interface is unchanged from the Finnhub era so existing
consumers keep working: fetch_historical_candle(ticker, from_ts, to_ts)
returns {open_price, close_price, pct_change, candle_count, from_ts,
to_ts} or None.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
import time
from datetime import datetime
from typing import Optional

import requests

logger = logging.getLogger(__name__)

TIINGO_BASE = "https://api.tiingo.com/tiingo/daily"
PACING_SEC = 1.0
HOURLY_REQUEST_BUDGET = 45   # headroom under Tiingo's 50/hour
DAILY_REQUEST_BUDGET = 950   # headroom under Tiingo's 1000/day

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_DEFAULT_CACHE_PATH = os.path.join(_REPO_ROOT, ".cache", "tiingo_prices.json")

_last_call_ts = 0.0


def _pace() -> None:
    global _last_call_ts
    now = time.time()
    elapsed = now - _last_call_ts
    if elapsed < PACING_SEC:
        time.sleep(PACING_SEC - elapsed)
    _last_call_ts = time.time()


# --- Cache -----------------------------------------------------------------
# Layout of the persisted JSON:
#   bars:     "SPY:2026-07-02" -> {"date","open","close","adjOpen","adjClose"}
#   ranges:   "SPY:2026-07-01:2026-07-02" -> ["2026-07-01","2026-07-02"]
#             (which bar dates a fetched window contained, so multi-day
#             windows can be rebuilt from bars without re-fetching, and a
#             legitimately empty trading window is not re-fetched forever)
#   requests: [unix_ts, ...] rolling log for the hourly/daily budget

_cache: dict | None = None
_cache_path_loaded: str | None = None


def _cache_path() -> str:
    return os.environ.get("TIINGO_CACHE_PATH") or _DEFAULT_CACHE_PATH


def _get_cache() -> dict:
    global _cache, _cache_path_loaded
    path = _cache_path()
    if _cache is not None and _cache_path_loaded == path:
        return _cache
    loaded: dict = {"bars": {}, "ranges": {}, "requests": []}
    try:
        with open(path) as f:
            raw = json.load(f)
        if isinstance(raw, dict):
            loaded["bars"] = dict(raw.get("bars") or {})
            loaded["ranges"] = dict(raw.get("ranges") or {})
            loaded["requests"] = list(raw.get("requests") or [])
    except FileNotFoundError:
        pass
    except Exception as e:
        logger.warning("market_data: unreadable cache %s (%s), starting fresh", path, e)
    _cache = loaded
    _cache_path_loaded = path
    return _cache


def _save_cache() -> None:
    cache = _get_cache()
    path = _cache_path()
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
        with os.fdopen(fd, "w") as f:
            json.dump(cache, f)
        os.replace(tmp, path)
    except Exception as e:
        # Cache persistence is best-effort; grading must not fail on it.
        logger.warning("market_data: could not persist cache to %s: %s", path, e)


def _budget_allows_request() -> bool:
    cache = _get_cache()
    now = time.time()
    cache["requests"] = [t for t in cache["requests"] if now - t < 86400]
    hour_count = sum(1 for t in cache["requests"] if now - t < 3600)
    if hour_count >= HOURLY_REQUEST_BUDGET:
        logger.warning(
            "market_data: hourly Tiingo budget reached (%d/hr), degrading to no-data",
            HOURLY_REQUEST_BUDGET,
        )
        return False
    if len(cache["requests"]) >= DAILY_REQUEST_BUDGET:
        logger.warning(
            "market_data: daily Tiingo budget reached (%d/day), degrading to no-data",
            DAILY_REQUEST_BUDGET,
        )
        return False
    return True


def _record_request() -> None:
    _get_cache()["requests"].append(time.time())


# --- Fetch -----------------------------------------------------------------


def _bar_key(symbol: str, iso_date: str) -> str:
    return f"{symbol}:{iso_date}"


def _range_key(symbol: str, start: str, end: str) -> str:
    return f"{symbol}:{start}:{end}"


def _cached_bars(symbol: str, start: str, end: str) -> list[dict] | None:
    """Rebuild a window from cache. None means not cached (fetch needed);
    a list (possibly empty) is an authoritative cached answer."""
    cache = _get_cache()
    if start == end:
        bar = cache["bars"].get(_bar_key(symbol, start))
        if bar is not None:
            return [bar]
    dates = cache["ranges"].get(_range_key(symbol, start, end))
    if dates is None:
        return None
    bars = []
    for d in dates:
        bar = cache["bars"].get(_bar_key(symbol, d))
        if bar is None:
            return None  # partially evicted; re-fetch
        bars.append(bar)
    return bars


def _store_bars(symbol: str, start: str, end: str, bars: list[dict]) -> None:
    """Cache a non-empty fetch result. Empty results are deliberately not
    stored: today's session may simply not be posted yet."""
    if not bars:
        return
    cache = _get_cache()
    dates = []
    for bar in bars:
        d = (bar.get("date") or "")[:10]
        if not d:
            continue
        dates.append(d)
        cache["bars"][_bar_key(symbol, d)] = {
            "date": d,
            "open": bar.get("open"),
            "close": bar.get("close"),
            "adjOpen": bar.get("adjOpen"),
            "adjClose": bar.get("adjClose"),
        }
    cache["ranges"][_range_key(symbol, start, end)] = dates
    _save_cache()


def _fetch_daily_bars(symbol: str, start: str, end: str) -> list[dict] | None:
    """
    Daily bars for symbol in [start, end], cache-first.
    Returns a list (empty = Tiingo has no data for that window, e.g.
    weekend, holiday, unknown ticker, or EOD not posted yet) or None on
    error/budget exhaustion. Symbols are plain tickers (SPY, XLK), which
    is Tiingo's native format.
    """
    api_key = os.environ.get("TIINGO_API_KEY")
    if not api_key or not symbol:
        return None
    sym = symbol.strip().upper()

    cached = _cached_bars(sym, start, end)
    if cached is not None:
        return cached

    if not _budget_allows_request():
        return None

    try:
        _pace()
        _record_request()
        resp = requests.get(
            f"{TIINGO_BASE}/{sym}/prices",
            params={"startDate": start, "endDate": end, "token": api_key},
            timeout=10,
        )
        if resp.status_code == 429:
            logger.warning("market_data: Tiingo rate limited on %s", sym)
            _save_cache()  # keep the request log accurate
            return None
        if resp.status_code == 404:
            # Unknown ticker: no data, same contract as an empty window.
            _save_cache()
            return []
        if resp.status_code != 200:
            logger.warning("market_data: Tiingo %s returned %d", sym, resp.status_code)
            _save_cache()
            return None
        data = resp.json()
        if not isinstance(data, list):
            logger.warning("market_data: Tiingo %s returned non-list payload", sym)
            _save_cache()
            return None
        _store_bars(sym, start, end, data)
        if not data:
            _save_cache()  # persist the request log even when not caching
        return data
    except Exception as e:
        logger.error("market_data: Tiingo fetch(%s) failed: %s", sym, e)
        _save_cache()
        return None


def _bar_open_close(bar: dict) -> tuple[float, float] | None:
    """Adjusted prices, falling back to raw only when both adj fields are
    absent (never mixing adjusted and raw within one bar)."""
    o, c = bar.get("adjOpen"), bar.get("adjClose")
    if o is None or c is None:
        o, c = bar.get("open"), bar.get("close")
    if o is None or c is None:
        return None
    return float(o), float(c)


def fetch_historical_candle(
    ticker: str,
    from_ts: datetime,
    to_ts: datetime,
    resolution: str = "D",
) -> Optional[dict]:
    """
    OHLC summary for a ticker between timestamps, from Tiingo daily bars.
    Returns {open_price, close_price, pct_change, candle_count} or None.
    Same contract as the old Finnhub version; only daily resolution is
    supported now (all existing callers already used "D").
    """
    if not ticker:
        return None
    if resolution != "D":
        logger.warning(
            "market_data: resolution %r unsupported on Tiingo daily, using D",
            resolution,
        )
    start = (from_ts.date() if isinstance(from_ts, datetime) else from_ts).isoformat()
    end = (to_ts.date() if isinstance(to_ts, datetime) else to_ts).isoformat()

    bars = _fetch_daily_bars(ticker, start, end)
    if not bars:
        return None
    first = _bar_open_close(bars[0])
    last = _bar_open_close(bars[-1])
    if not first or not last or not first[0]:
        return None
    open_price, close_price = first[0], last[1]
    pct_change = ((close_price - open_price) / open_price) * 100 if open_price else 0.0

    # Per-session series, carried alongside the summary.
    #
    # The bars were already fetched and were previously discarded, keeping only
    # first-open and last-close. The long-horizon checkpoint panel
    # (backend/grading/price_attribution.py) reads interim points off THIS list
    # rather than issuing extra requests, so checkpoints cost zero additional
    # Tiingo calls against the 45/hour, 950/day budget. Adjusted prices only,
    # same as the summary, so a split cannot skew an interim read.
    series: list[dict] = []
    for bar in bars:
        oc = _bar_open_close(bar)
        day = (bar.get("date") or "")[:10]
        if oc is None or not day:
            continue
        series.append({"date": day, "open": oc[0], "close": oc[1]})

    return {
        "open_price": round(open_price, 2),
        "close_price": round(close_price, 2),
        "pct_change": round(pct_change, 2),
        "candle_count": len(bars),
        "from_ts": from_ts.isoformat(),
        "to_ts": to_ts.isoformat(),
        "bars": series,
    }


def fetch_index_performance(
    index_symbol: str, from_ts: datetime, to_ts: datetime
) -> Optional[dict]:
    """Convenience wrapper for SPY/QQQ/DIA index tracking."""
    return fetch_historical_candle(index_symbol, from_ts, to_ts)
