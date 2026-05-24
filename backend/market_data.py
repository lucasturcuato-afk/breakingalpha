"""Finnhub market data helpers. Used by outcome graders for price evidence."""
from __future__ import annotations

import os
import time
import logging
from datetime import datetime
from typing import Optional

import requests

logger = logging.getLogger(__name__)

FINNHUB_KEY = os.environ.get("FINNHUB_API_KEY")
FINNHUB_BASE = "https://finnhub.io/api/v1"
PACING_SEC = 0.5  # match thesis_grader.py rate-limit pattern

_last_call_ts = 0.0


def _pace() -> None:
    global _last_call_ts
    now = time.time()
    elapsed = now - _last_call_ts
    if elapsed < PACING_SEC:
        time.sleep(PACING_SEC - elapsed)
    _last_call_ts = time.time()


def fetch_historical_candle(
    ticker: str,
    from_ts: datetime,
    to_ts: datetime,
    resolution: str = "D",
) -> Optional[dict]:
    """
    Fetch OHLC candles for a ticker between timestamps.
    Returns {open_price, close_price, pct_change, candle_count} or None.
    """
    if not FINNHUB_KEY or not ticker:
        return None
    try:
        _pace()
        resp = requests.get(
            f"{FINNHUB_BASE}/stock/candle",
            params={
                "symbol": ticker.upper(),
                "resolution": resolution,
                "from": int(from_ts.timestamp()),
                "to": int(to_ts.timestamp()),
                "token": FINNHUB_KEY,
            },
            timeout=10,
        )
        if resp.status_code == 429:
            logger.warning("market_data: rate limited on %s", ticker)
            return None
        if resp.status_code != 200:
            logger.warning("market_data: %s returned %d", ticker, resp.status_code)
            return None
        data = resp.json()
        if data.get("s") != "ok" or not data.get("o") or not data.get("c"):
            return None
        open_price = float(data["o"][0])
        close_price = float(data["c"][-1])
        pct_change = ((close_price - open_price) / open_price) * 100 if open_price else 0.0
        return {
            "open_price": round(open_price, 2),
            "close_price": round(close_price, 2),
            "pct_change": round(pct_change, 2),
            "candle_count": len(data["c"]),
            "from_ts": from_ts.isoformat(),
            "to_ts": to_ts.isoformat(),
        }
    except Exception as e:
        logger.error("market_data: fetch_historical_candle(%s) failed: %s", ticker, e)
        return None


def fetch_index_performance(
    index_symbol: str, from_ts: datetime, to_ts: datetime
) -> Optional[dict]:
    """Convenience wrapper for SPY/QQQ/DXY/TNX index tracking."""
    return fetch_historical_candle(index_symbol, from_ts, to_ts)
