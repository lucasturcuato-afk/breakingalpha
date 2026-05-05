"""Shared Finnhub helpers. Reused by entity_resolver.py for ticker
population on canonical company creation, and elsewhere for any
other Finnhub /api/v1/search calls that should follow the same
matching rules."""
import os
import requests
from typing import Optional


def search_finnhub_ticker(name: str) -> Optional[str]:
    """Returns best-match Common Stock ticker from Finnhub /search, or None.

    Matching rules (canonical across W2-C ticker workstreams):
    - Filter to type == "Common Stock"
    - Prefer US primary listing (no exchange suffix in displaySymbol)
    - First remaining candidate by Finnhub's default ranking

    Failures are silent. 5s timeout. Caller MUST handle None.
    """
    key = os.environ.get("FINNHUB_API_KEY")
    if not key:
        return None
    try:
        r = requests.get(
            "https://finnhub.io/api/v1/search",
            params={"q": name},
            headers={"X-Finnhub-Token": key},
            timeout=5,
        )
        if r.status_code != 200:
            return None
        results = r.json().get("result") or []
        candidates = [c for c in results if c.get("type") == "Common Stock"]
        if not candidates:
            return None
        primary = [c for c in candidates if "." not in (c.get("displaySymbol") or "")]
        chosen = primary[0] if primary else candidates[0]
        return chosen.get("symbol")
    except Exception:
        return None
