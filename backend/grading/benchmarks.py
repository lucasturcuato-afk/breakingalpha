"""
Benchmark mapping for call grading.

Single home for the sector -> sector ETF map (moved out of
grade_brief_calls.py so the attribution grader can import it without a
circular import) plus index proxy normalization and the companies-table
ticker -> sector lookup used to pick a ticker's sector benchmark.
"""

from __future__ import annotations

from typing import Any


# Sector -> sector ETF (SPDR Select) mapping. Keys are lower-cased
# normalized sector labels that the claim extractor is likely to emit.
SECTOR_ETF_MAP = {
    "technology": "XLK",
    "tech": "XLK",
    "software": "XLK",
    "semiconductors": "XLK",
    "energy": "XLE",
    "oil": "XLE",
    "gas": "XLE",
    "financials": "XLF",
    "financial": "XLF",
    "banks": "XLF",
    "bank": "XLF",
    "healthcare": "XLV",
    "health": "XLV",
    "biotech": "XLV",
    "pharma": "XLV",
    "consumer discretionary": "XLY",
    "consumer disc": "XLY",
    "retail": "XLY",
    "consumer staples": "XLP",
    "staples": "XLP",
    "industrials": "XLI",
    "industrial": "XLI",
    "manufacturing": "XLI",
    "materials": "XLB",
    "mining": "XLB",
    "real estate": "XLRE",
    "reit": "XLRE",
    "utilities": "XLU",
    "utility": "XLU",
    "communications": "XLC",
    "telecom": "XLC",
    "media": "XLC",
}

SECTOR_ETF_SYMBOLS = {
    "XLK",
    "XLE",
    "XLF",
    "XLV",
    "XLY",
    "XLP",
    "XLI",
    "XLB",
    "XLRE",
    "XLU",
    "XLC",
}

# Broad-market ETFs. A "ticker" claim naming one of these is really an index
# claim and gets the broad-index treatment (no benchmark, tighter bar).
BROAD_INDEX_ETFS = {"SPY", "QQQ", "DIA", "IWM", "VTI", "VOO"}

# Common raw index symbols the extractor might emit, normalized to a
# tradeable ETF proxy so the Finnhub candle endpoint can price them.
INDEX_PROXIES = {
    "SPX": "SPY",
    "^GSPC": "SPY",
    "GSPC": "SPY",
    "NDX": "QQQ",
    "^NDX": "QQQ",
    "IXIC": "QQQ",
    "^IXIC": "QQQ",
    "COMP": "QQQ",
    "DJI": "DIA",
    "^DJI": "DIA",
    "DJIA": "DIA",
    "RUT": "IWM",
    "^RUT": "IWM",
}

MARKET_BENCHMARK = "SPY"


def sector_etf_for_label(label: str | None) -> str | None:
    """Resolve a sector label (or an already-passed ETF symbol) to its ETF."""
    if not label:
        return None
    if label.upper() in SECTOR_ETF_SYMBOLS:
        return label.upper()
    return SECTOR_ETF_MAP.get(label.strip().lower())


def normalize_index_symbol(symbol: str | None) -> str | None:
    """Map a raw index symbol to a priceable ETF proxy; pass ETFs through."""
    if not symbol:
        return None
    sym = symbol.strip().upper()
    return INDEX_PROXIES.get(sym, sym)


def sectors_for_tickers(sb: Any, tickers: set[str]) -> dict[str, str]:
    """
    Batched companies-table lookup: ticker -> canonical sector label.
    One .in_() query for the whole run. Missing or blank sectors are
    omitted so callers fall back to a market-only benchmark.
    """
    wanted = sorted({t.upper() for t in tickers if t})
    if not wanted:
        return {}
    resp = (
        sb.table("companies")
        .select("ticker, sector")
        .in_("ticker", wanted)
        .execute()
    )
    out: dict[str, str] = {}
    for row in resp.data or []:
        tick = (row.get("ticker") or "").strip().upper()
        sec = (row.get("sector") or "").strip()
        if tick and sec and tick not in out:
            out[tick] = sec
    return out
