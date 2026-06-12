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

Algorithm: mention-count gate -> canonicalize -> Finnhub /search ->
filter to ACCEPTED_FINNHUB_TYPES -> prefer no-period symbols + class-
share allowlist -> retry chain (suffix-strip, period-strip, first-2-
tokens, space-collapse, camelCase-split) -> q-too-long recovery at
call level.

Patch J changes:
  (a) Class-share allowlist `^[A-Z]{1,5}\\.(A|B)$` (BRK.A, BRK.B).
  (b) ACCEPTED_FINNHUB_TYPES extended with 'NY Reg Shrs' (ASML).
  (c) `q too long` -> retry with first-token only.
  (d) Space-collapse retry ("JP Morgan" -> "JPMorgan").
  (e) Pre-call canonicalize (Google -> Alphabet, Facebook -> Meta).
  (f) CamelCase split retry ("ExxonMobil" -> "Exxon Mobil").

Failures are silent. 5s timeout. Caller MUST handle None.
"""
from __future__ import annotations

import os
import re
import time
from typing import Iterable, Optional

import requests

FINNHUB_SEARCH_URL = "https://finnhub.io/api/v1/search"
FINNHUB_TIMEOUT_SEC = 5
RATE_LIMIT_SLEEP_SEC = 60

# Mention-count gate. Names with fewer mentions than this are treated as
# Gemini extraction noise and not Finnhub-matched.
MIN_MENTION_COUNT_FOR_LOOKUP = 2

# Patch J (b): 'NY Reg Shrs' admits ASML and similar NY-registered
# foreign issuers that Finnhub returns under that type rather than ADR.
ACCEPTED_FINNHUB_TYPES = frozenset({"Common Stock", "ADR", "NY Reg Shrs"})

# Patch J (a): class-share allowlist re-admits US class shares (BRK.A,
# BRK.B) that the default no-period filter rejects.
_CLASS_SHARE_RE = re.compile(r"^[A-Z]{1,5}\.(A|B)$")

# Hard overrides for names where Finnhub /search returns a worse-than-desired
# ticker (e.g. BRK.A, ~$700K/share with thin volume) but the better one (BRK.B)
# is reachable only by direct symbol query. Keys are lowercase post-canonicalize.
HARD_TICKER_OVERRIDES = {
    "berkshire hathaway": "BRK.B",
    # SpaceX -> SPCX (Nasdaq, IPO 2026-06-12). Pinned so the bulk backfill /
    # entity-creation write path resolves SPCX without trusting Finnhub's
    # fresh-listing index, which is unreliable on listing day. Parity with the
    # TS twin in src/lib/finnhub-ticker.ts.
    "spacex": "SPCX",
}

# Patch J (e): canonical-name overrides mirror the brand-substitution
# entries in CANONICAL from src/lib/company-intel.ts. Pass-through for
# unknown names. Suffix variants are intentionally excluded; the
# existing _strip_corporate_suffix transform handles those.
CANONICAL_OVERRIDES = {
    "google": "Alphabet",
    "google llc": "Alphabet",
    "google inc": "Alphabet",
    "facebook": "Meta",
    "meta platforms": "Meta",
    "amazon.com": "Amazon",
    "jp morgan": "JPMorgan Chase",
    "jpmorgan": "JPMorgan Chase",
    "tsmc": "Taiwan Semiconductor",
    "samsung electronics": "Samsung",
    "hon hai": "Foxconn",
}

# Patch J (f): brands where camelCase IS the canonical spelling -- skip
# the camelCase-split transform for these so we do not produce garbage.
_CAMELCASE_DENYLIST = frozenset({"iphone", "ebay", "paypal", "ipad", "imac"})

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


# Patch J (e): brand-canonicalize. Returns canonical name if matched,
# else returns `name` unchanged (pure pass-through for unknowns).
def _apply_canonical_override(name: str) -> str:
    trimmed = name.strip().rstrip(".,").strip()
    key = trimmed.lower()
    if key in CANONICAL_OVERRIDES:
        return CANONICAL_OVERRIDES[key]
    return trimmed if trimmed else name


# Patch J (d): "JP Morgan" -> "JPMorgan". Skip if <3 chars.
def _collapse_spaces(name: str) -> Optional[str]:
    collapsed = name.replace(" ", "")
    if len(collapsed) < 3 or collapsed == name.strip():
        return None
    return collapsed


# Patch J (f): "ExxonMobil" -> "Exxon Mobil". Skip on no boundary or denylist.
def _camelcase_split(name: str) -> Optional[str]:
    trimmed = name.strip()
    if trimmed.lower() in _CAMELCASE_DENYLIST:
        return None
    split = re.sub(r"([a-z])([A-Z])", r"\1 \2", trimmed)
    if split == trimmed:
        return None
    return split


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
    query: str, finnhub_key: str, *, timeout_sec: int = FINNHUB_TIMEOUT_SEC,
    _allow_q_too_long_retry: bool = True,
) -> Optional[Iterable[dict]]:
    """One Finnhub /search call. Returns raw `result` list or None.

    Patch J (c): on non-200 with body containing `q too long`, retry
    once with only the first whitespace-separated token. The recursive
    retry is guarded by `_allow_q_too_long_retry=False`.
    """
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
        # Patch J (c): inspect the body for `q too long` and recover.
        if _allow_q_too_long_retry:
            try:
                body = resp.text or ""
            except Exception:
                body = ""
            if "q too long" in body:
                first_token = query.strip().split()[0] if query.strip() else ""
                if first_token and first_token != query.strip():
                    return _do_finnhub_call(
                        first_token,
                        finnhub_key,
                        timeout_sec=timeout_sec,
                        _allow_q_too_long_retry=False,
                    )
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

    # Patch J (a): admit class-share symbols (BRK.A, BRK.B).
    def _is_us_primary(c: dict) -> bool:
        ds = c.get("displaySymbol") or ""
        if "." not in ds:
            return True
        return bool(_CLASS_SHARE_RE.match(ds))

    primary = [c for c in candidates if _is_us_primary(c)]
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

    raw_trimmed = (name or "").strip()
    if not raw_trimmed:
        return None

    # Patch J (e): pre-call canonicalize (Google -> Alphabet, etc.).
    base = _apply_canonical_override(raw_trimmed) or raw_trimmed
    if not base:
        return None

    override = HARD_TICKER_OVERRIDES.get(base.lower())
    if override:
        return override

    # Try the (canonicalized) name as-is first.
    result = _do_finnhub_call(base, key)
    if result is not None:
        sym = _pick_us_primary(result)
        if sym:
            return sym

    # Retry chain: cheapest semantic change first. Patch J appends
    # _collapse_spaces and _camelcase_split after the existing transforms.
    seen = {base}
    for transform in (
        _strip_corporate_suffix,
        _strip_internal_periods,
        _first_two_tokens,
        _collapse_spaces,
        _camelcase_split,
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
