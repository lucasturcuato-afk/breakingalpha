"""
Shared Finnhub /api/v1/search helper. Single source of truth for the
W2-C ticker matching algorithm. Used by:

  - backend/entity_resolver.py (web-fallback ticker population on
    canonical company creation; effectively gated to no-op for new rows
    by the mention_count >= 2 rule)
  - backend/scripts/backfill_tickers.py (one-time bulk backfill against
    the existing companies rows)

The TypeScript twin at src/lib/finnhub-ticker.ts (lazy lookup at detail-
page request time) MUST stay logically identical to this file.

Match algorithm (canonical):
  1. Mention-count gate: skip rows where mention_count < 2. The Warner
     false positive that sparked this rewrite had mention_count=1, the
     actual signal that the row is Gemini extraction noise. False
     positive cost (wrong ticker persisted) >> miss cost (stays NULL,
     next backfill catches if mention_count climbs).
  2. Query Finnhub /search with the name as-is.
  3. Filter to type IN ('Common Stock', 'ADR') so foreign companies
     with US-listed depositary receipts (BABA, TSM, BUD, TM) qualify.
  4. Prefer matches whose displaySymbol does NOT contain a period (US
     primary listing). If no US-primary match exists, return None;
     foreign-only listings (.KS, .TO, .L, .DE, .HK, etc.) are NEVER
     written. The chart proxy can render some foreign tickers, but
     consistency with Yahoo's primary-symbol convention is the goal.
  5. If the primary call misses (no US-primary candidate), retry with:
     a. Trailing corporate suffix stripped ("Hologic Inc." -> "Hologic")
     b. Internal periods stripped ("Warner Bros." -> "Warner Bros")
     c. First-2-tokens kept ("Warner Bros Discovery" -> "Warner Bros"),
        guarded by an ambiguous-prefix denylist so generic words like
        "Bank", "Capital", "Apple" don't fire false positives.
  6. If every retry misses: return None.

Failures are silent. 5s timeout. Caller MUST handle None.

The original (pre-tuning) version of this module shipped in PR #198 with
divergent rules from the bulk backfill. This rewrite aligns all three
matchers and adds the mention_count gate per Amendment 3 of the rules-
alignment sprint.
"""
from __future__ import annotations

import os
import time
from typing import Iterable, Optional

import requests

FINNHUB_SEARCH_URL = "https://finnhub.io/api/v1/search"
FINNHUB_TIMEOUT_SEC = 5
RATE_LIMIT_SLEEP_SEC = 60

# Mention-count gate. Names with fewer mentions than this are treated as
# Gemini extraction noise and not Finnhub-matched.
MIN_MENTION_COUNT_FOR_LOOKUP = 2

# Yahoo / Finnhub type whitelist. ADRs cover foreign companies whose US
# primary listing is via depositary receipts.
ACCEPTED_FINNHUB_TYPES = frozenset({"Common Stock", "ADR"})

# Trailing corporate suffixes to strip on retry. Order does not affect
# matching (we test endswith() with each in turn), but listing the
# longer / more-specific entries first keeps the comprehension readable.
# Case-insensitive, whitespace-and-comma tolerant on the boundary.
_CORPORATE_SUFFIXES = (
    "Corporation",
    "Incorporated",
    "Limited",
    "Company",
    "Holdings",
    "Holding",
    "Corp.",
    "Corp",
    "Inc.",
    "Inc",
    "Ltd.",
    "Ltd",
    "Co.",
    "Co",
    "LLC",
    "L.L.C.",
    "PLC",
    "plc",
    "P.L.C.",
    "S.A.",
    "SA",
    "N.V.",
    "NV",
    "GmbH",
    "AG",
    "SE",
)

# First-token denylist for the first-2-tokens retry. If the first token
# of the truncated candidate is in this set, the retry is SKIPPED. The
# denylist contains words common enough that matching a 1-2 token
# truncation would produce false-positive tickers that look plausible
# but point at the wrong company.
#
# Two categories:
#   - Hot brand names that resolve to one canonical (Apple -> AAPL,
#     Google -> GOOGL) but ALSO appear as the leading word of unrelated
#     entities (Apple Bank, Apple Hospitality, Google Cloud SaaS, etc.)
#   - Generic finance-industry descriptors (Bank, Capital, Holdings,
#     Partners, Asset, Investments, Securities, Financial, Global,
#     International, Strategic, Ventures, Fund, Trust, Group, Corp)
#     that appear in many real company names but produce too-broad
#     Finnhub matches when truncated to.
_AMBIGUOUS_FIRST_TOKENS = frozenset(
    t.lower()
    for t in (
        # Hot single-name brands
        "Apple",
        "Google",
        "Meta",
        "Amazon",
        "Microsoft",
        "Tesla",
        "Twitter",
        "Apollo",
        # Generic finance descriptors
        "Capital",
        "Group",
        "Bank",
        "Holdings",
        "Partners",
        "Asset",
        "Investments",
        "Securities",
        "Financial",
        "Global",
        "International",
        "Strategic",
        "Ventures",
        "Fund",
        "Trust",
        "Corp",
    )
)


def _strip_corporate_suffix(name: str) -> Optional[str]:
    """Strip a trailing corporate suffix; return None if none matched."""
    base = name.strip()
    base_lower = base.lower()
    for suffix in _CORPORATE_SUFFIXES:
        sl = suffix.lower()
        for boundary in (" ", ",", ", "):
            tail = boundary + sl
            if base_lower.endswith(tail):
                stripped = base[: -len(tail)].rstrip(" ,").strip()
                if stripped and stripped != base:
                    return stripped
                return None
    return None


def _strip_internal_periods(name: str) -> Optional[str]:
    """Remove all `.` characters; return None if no periods present."""
    if "." not in name:
        return None
    cleaned = " ".join(name.replace(".", " ").split())
    if not cleaned or cleaned == name.strip():
        return None
    return cleaned


def _first_two_tokens(name: str) -> Optional[str]:
    """
    Return the first two whitespace-separated tokens of `name`, with
    any internal periods stripped. The combined operation is the one
    that actually rescues "Warner Bros. Discovery": first-2-tokens on
    its own yields "Warner Bros." (with period) which Finnhub still
    fails to tokenize; chaining the period-strip yields "Warner Bros"
    which matches WBD.

    Returns None when:
      - the original has fewer than 3 tokens (full name was already tried)
      - the first token is in the ambiguous-prefix denylist
      - the candidate is empty after stripping
    """
    parts = name.split()
    if len(parts) < 3:
        return None
    first = parts[0]
    if first.lower() in _AMBIGUOUS_FIRST_TOKENS:
        return None
    raw = f"{parts[0]} {parts[1]}"
    candidate = " ".join(raw.replace(".", " ").split())
    if not candidate:
        return None
    return candidate


def _do_finnhub_call(
    query: str, finnhub_key: str, *, timeout_sec: int = FINNHUB_TIMEOUT_SEC
) -> Optional[Iterable[dict]]:
    """One Finnhub /search call. Returns the raw `result` list or None on
    any error / non-200 / 429 (with one 60s retry)."""
    params = {"q": query}
    headers = {"X-Finnhub-Token": finnhub_key}

    def _get():
        return requests.get(
            FINNHUB_SEARCH_URL, params=params, headers=headers, timeout=timeout_sec
        )

    try:
        resp = _get()
    except Exception:
        return None

    if resp.status_code == 429:
        time.sleep(RATE_LIMIT_SLEEP_SEC)
        try:
            resp = _get()
        except Exception:
            return None

    if resp.status_code != 200:
        return None

    try:
        data = resp.json() or {}
    except Exception:
        return None

    result = data.get("result") or []
    return result if isinstance(result, list) else None


def _pick_us_primary(result: Iterable[dict]) -> Optional[str]:
    """
    Apply the canonical W2-C type + US-primary filters to a Finnhub
    /search result list. Returns the chosen symbol or None.

    No fallback to foreign-only listings: if every accepted candidate
    has '.' in its displaySymbol, return None. The cost of writing a
    foreign symbol that the chart UI may not handle gracefully is
    higher than the cost of leaving the row NULL and letting the lazy
    lookup retry next visit.
    """
    candidates = [
        c
        for c in result
        if isinstance(c, dict) and c.get("type") in ACCEPTED_FINNHUB_TYPES
    ]
    if not candidates:
        return None

    primary = [
        c for c in candidates if "." not in (c.get("displaySymbol") or "")
    ]
    if not primary:
        return None

    sym = primary[0].get("symbol")
    if not sym or not isinstance(sym, str):
        return None
    return sym.strip() or None


def search_finnhub_ticker(
    name: str,
    *,
    mention_count: Optional[int] = None,
    finnhub_key: Optional[str] = None,
) -> Optional[str]:
    """
    Best-match US-primary ticker for `name`, or None.

    Args:
      name: Raw company name as it appears in companies.name.
      mention_count: Optional. If provided and < MIN_MENTION_COUNT_FOR_LOOKUP,
        return None immediately without calling Finnhub. Bulk backfill
        and lazy lookup pass this; the gate prevents 1-mention noise
        rows from ever being matched.
      finnhub_key: Optional override. Defaults to FINNHUB_API_KEY env var.

    Failure mode: silent. None on any error, gate failure, or no match.
    """
    if (
        mention_count is not None
        and mention_count < MIN_MENTION_COUNT_FOR_LOOKUP
    ):
        return None

    key = finnhub_key or os.environ.get("FINNHUB_API_KEY")
    if not key:
        return None

    base = (name or "").strip()
    if not base:
        return None

    # Try the name as-is first.
    result = _do_finnhub_call(base, key)
    if result is not None:
        sym = _pick_us_primary(result)
        if sym:
            return sym

    # Retry chain. Each pass adds one Finnhub call (1.1s rate-limit
    # spacing baked in by callers). Order goes from cheapest semantic
    # change to most aggressive.
    seen = {base}
    for transform in (
        _strip_corporate_suffix,
        _strip_internal_periods,
        _first_two_tokens,
    ):
        candidate = transform(base)
        if candidate is None or candidate in seen:
            continue
        seen.add(candidate)
        retry = _do_finnhub_call(candidate, key)
        if retry is None:
            continue
        sym = _pick_us_primary(retry)
        if sym:
            return sym

    return None
