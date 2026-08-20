"""
wikidata.py — Entity validation via Wikidata search API with Supabase cache.

Public API:
    is_valid_company(name: str, supabase) -> bool
        Returns True if name is (or likely is) a real operating company.
        Checks Supabase cache first; calls Wikidata API on cache miss.

THE FETCH BUG THIS MODULE USED TO HAVE (fixed here, read before changing pacing).
    The old _fetch_wikidata_description caught EVERY exception and returned None,
    and is_valid_company then wrote that None into wikidata_entity_cache, a table
    with no TTL and no invalidation path. So a single throttled second produced a
    permanent verdict about a company that Wikidata never actually answered for.
    The cache physically could not tell "Wikidata says there is no such entity"
    apart from "we failed to ask". Measured on the live table on 2026-08-20:
      24,537 cache rows, 18,732 with a NULL description = 76.34%
      is_company verdicts: True 2,587 (10.5%), None 21,668 (88.3%), False 282 (1.1%)
    and the NULL writes cluster at exactly 60.0 second periodicity, which is the
    signature of a per-minute token bucket. No property of a NAME produces
    60-second periodicity. The old _REQUEST_DELAY = 0.15 was believed to be
    "well within Wikidata limits"; its measured SUSTAINED rate is 3.62 req/s,
    roughly 214 requests per minute against an anonymous budget of about 10 to 11
    successful wbsearchentities calls per minute. About 19x over.

Four things follow from that, and all four live below:
    1. Retries that honor Retry-After in full, with bounded attempts.
    2. A FAILED fetch is never written to the cache as a verdict. Only an answer
       from Wikidata is cacheable. See STATUS_OK / STATUS_NO_RESULT / STATUS_FAILED.
    3. Pacing matched to the MEASURED budget, not to a guess. Note that
       scripts/validate_wikidata_gate.py already paces at 1.2s with 429 backoff
       and says so in a comment; that is still ~50/min, about 5x the real budget,
       so do not copy it.
    4. A top-N scan with an exact label check, because result[0] is often the
       wrong entity and a naive "any company in the top N" scan is worse than
       trusting result[0]. See _pick_description.
"""

import os
import re
import threading
import time
from collections import deque
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import NamedTuple

import requests

WIKIDATA_API = "https://www.wikidata.org/w/api.php"
_USER_AGENT = "BreakingAlpha/1.0 (company intel entity quality; contact via github)"

# --------------------------------------------------------------------------
# Fetch pacing, retry and per-run budget.
# --------------------------------------------------------------------------
# _REQUEST_DELAY = 0.15 is GONE. It was a flat pre-sleep whose sustained rate was
# 3.62 req/s. Pacing now happens per outbound call through _RATE_LIMITER, so a
# cache HIT still costs nothing and only real network calls are metered.
#
# The anonymous budget measured against the live API is 10 to 11 successful
# wbsearchentities calls per ~52s window. We sit at the bottom of that band.
_RATE_WINDOW_SECONDS = 60.0
_DEFAULT_CALLS_PER_WINDOW = 10

# Wall-clock guard. At 10 calls/min a run that misses the cache N times spends
# N/10 minutes inside this module, so the budget IS the time budget. Measured
# from wikidata_entity_cache.checked_at (one row written per cache miss) across
# 107 days with writes: median 195 misses/day, p90 310, recent daily range
# 62-418. 300 calls is p90 plus headroom, and caps this module at ~30 minutes.
# Past the budget we stop calling out entirely and cache nothing, so the names
# we skipped are retried on the next run instead of being permanently mislabeled.
_DEFAULT_CALLS_PER_RUN = 300

_MAX_ATTEMPTS = 3               # 1 initial + 2 retries
_BACKOFF_BASE_SECONDS = 1.0     # 1s, then 2s. Deterministic, no jitter.
_MAX_RETRY_AFTER_SECONDS = 120.0
_HTTP_TIMEOUT = 8
_SEARCH_LIMIT = 5               # top-N. Was 1, which is the result[0] bug.
_RETRY_STATUS_CODES = frozenset({429, 500, 502, 503, 504})


def _env_positive_int(var: str, default: int) -> int:
    """Read a positive int from the environment, falling back on anything
    unparseable or non-positive. Ops knob, not a code path."""
    try:
        value = int((os.environ.get(var) or "").strip())
    except (TypeError, ValueError):
        return default
    return value if value > 0 else default


_MAX_CALLS_PER_WINDOW = _env_positive_int(
    "WIKIDATA_MAX_CALLS_PER_MINUTE", _DEFAULT_CALLS_PER_WINDOW)
_MAX_CALLS_PER_RUN = _env_positive_int(
    "WIKIDATA_MAX_CALLS_PER_RUN", _DEFAULT_CALLS_PER_RUN)


def _sleep(seconds: float) -> None:
    """Single choke point for every wait this module takes. Indirection on
    purpose: tests replace THIS, not time.sleep, so patching a stdlib global
    never leaks into another test in the same process."""
    time.sleep(seconds)


class _SlidingWindowLimiter:
    """Meter outbound calls to at most `max_calls` per `window_seconds`.

    A sliding window rather than a flat inter-call sleep because the measured
    server-side limiter is a per-minute token bucket: a run with 6 cache misses
    should pay nothing, and a run with 600 should pay the steady-state rate. A
    flat sleep taxes both equally and still bursts over the bucket.

    acquire() sleeps AT MOST ONCE and then records the call unconditionally. It
    deliberately does not spin until a slot frees: a retry loop around a patched
    time.sleep would spin hot, and this is a politeness pacer, not a hard
    guarantee. Locked because ingest.py runs parallel workers elsewhere in the
    same process; the validation path is serial today and this keeps it correct
    if that ever changes.
    """

    def __init__(self, max_calls: int, window_seconds: float):
        self._max_calls = max(1, int(max_calls))
        self._window = float(window_seconds)
        self._calls: deque = deque()
        self._lock = threading.Lock()

    def _prune(self, now: float) -> None:
        while self._calls and (now - self._calls[0]) >= self._window:
            self._calls.popleft()

    def acquire(self) -> float:
        """Block until this call fits the window. Returns the seconds slept."""
        with self._lock:
            now = time.monotonic()
            self._prune(now)
            if len(self._calls) < self._max_calls:
                self._calls.append(now)
                return 0.0
            wait = self._window - (now - self._calls[0])
        if wait > 0:
            _sleep(wait)
        with self._lock:
            now = time.monotonic()
            self._prune(now)
            while len(self._calls) >= self._max_calls:
                self._calls.popleft()
            self._calls.append(now)
        return max(wait, 0.0)

    def reset(self) -> None:
        with self._lock:
            self._calls.clear()


_RATE_LIMITER = _SlidingWindowLimiter(_MAX_CALLS_PER_WINDOW, _RATE_WINDOW_SECONDS)

# Outbound calls made by THIS process. Each production run is a fresh process,
# so this is effectively per-run; reset_run_fetch_budget() is called from
# ingest._reset_run_entity_caches for a long-lived process, matching the
# belt-and-suspenders pattern the other per-run caches already use.
_RUN_FETCH_COUNT = 0
_RUN_BUDGET_EXHAUSTED_LOGGED = False
_BUDGET_LOCK = threading.Lock()


def reset_run_fetch_budget() -> None:
    """Clear the per-run outbound call counter. Safe to call at run start."""
    global _RUN_FETCH_COUNT, _RUN_BUDGET_EXHAUSTED_LOGGED
    with _BUDGET_LOCK:
        _RUN_FETCH_COUNT = 0
        _RUN_BUDGET_EXHAUSTED_LOGGED = False
    _RATE_LIMITER.reset()


def _claim_fetch_budget() -> bool:
    """Reserve one outbound call. False once the per-run budget is spent."""
    global _RUN_FETCH_COUNT, _RUN_BUDGET_EXHAUSTED_LOGGED
    with _BUDGET_LOCK:
        if _RUN_FETCH_COUNT >= _MAX_CALLS_PER_RUN:
            first = not _RUN_BUDGET_EXHAUSTED_LOGGED
            _RUN_BUDGET_EXHAUSTED_LOGGED = True
            if first:
                print(f"  Wikidata: per-run fetch budget of {_MAX_CALLS_PER_RUN} calls "
                      f"spent. Remaining names are left UNCACHED and retried next run.")
            return False
        _RUN_FETCH_COUNT += 1
        return True


# Descriptions that confirm the entity is NOT a company. Checked as substrings on
# the lowercased Wikidata description. Change (2) splits the original single drop
# list into HARD and SOFT, with every original keyword preserved in exactly one:
#   HARD: entity types that are categorically never a company. A HARD hit drops
#         even when a company word is also present.
#   SOFT: sector or instrument words that can co-occur with a real company. A SOFT
#         hit drops only when no company (KEEP) signal is present, so a description
#         like "company that operates a cryptocurrency exchange" is kept (the
#         Coinbase bug). A bare "cryptocurrency" with no company word still drops.
_HARD_DROP_DESCRIPTION_KEYWORDS = [
    "country", "sovereign state", "nation state", "government", "federal agency",
    "regulatory agency", "independent agency", "government agency", "central bank",
    "military branch", "armed forces", "intelligence agency",
    "natural person", "politician", "head of state", "president of",
    "prime minister", "secretary of", "businessman",  # individuals often described as "businessman"
    "political party", "religious organization", "advocacy group",
]
_SOFT_DROP_DESCRIPTION_KEYWORDS = [
    "cryptocurrency", "digital currency", "crypto asset", "digital cash",
    "stock market index", "stock index", "financial index", "market index",
    "sovereign wealth fund", "investment trust", "special purpose",
    "news agency", "news wire",
]

# Two of the HARD checks above cannot be plain substrings, because a short
# keyword is a substring of a longer phrase that means something else entirely.
#
# (a) "human" was in the HARD list to catch a bare natural person, whose
#     Wikidata description is the word itself. As a raw substring it also
#     matched "american human resources management software company" (ADP),
#     "human settlement in ..." (Madrigal, Seaboard, Peraso, Erasca),
#     "intended for human use" (Intuitive) and "understood by humans" (xAI).
#     Every occurrence of "human" in the live cache was one of those, not a
#     person. It moves out of the substring list into an anchored pattern: the
#     description must BE the person type, not merely mention humans. The
#     descriptions that actually identify a person ("american businessman",
#     "american politician", "natural person") are matched by other keywords
#     and are unaffected.
_HARD_DROP_DESCRIPTION_PATTERNS = [
    re.compile(r"^humans?\b(?!\s+\w)"),
]

# (b) Wikidata's top search hit for a bare exchange ticker is very often the
#     ISO 3166 country that shares those letters: GM -> The Gambia, GE ->
#     Georgia, ARM -> Armenia, MA -> Morocco, VZ -> Venezuela, CZR -> Czechia.
#     The description really is a country description, so the sovereignty
#     keywords hard-drop a real company on its own ticker. ISO 3166 codes are
#     exactly two or three letters, which is also the shape of a short ticker,
#     so for a name of that shape a sovereignty description is a code collision
#     rather than evidence, and those keywords are skipped. The verdict falls
#     through to the rest of the classifier (usually ambiguous, where
#     NONE_KEEP_MODE decides). Longer names such as "Iraq", "Greece" and
#     "Vietnam" are not ticker-shaped and still hard-drop.
_TICKER_SHAPED_NAME_RE = re.compile(r"^[A-Z]{1,3}$")
_SOVEREIGNTY_DROP_KEYWORDS = frozenset({"country", "sovereign state", "nation state"})

# Descriptions that confirm the entity IS a company.
_KEEP_DESCRIPTION_KEYWORDS = [
    "company", "corporation", "incorporated", "limited company",
    "enterprise", "conglomerate", "holding company",
    "bank", "financial institution", "investment bank",
    "startup", "tech company", "software company",
    "manufacturer", "retailer",
    "private equity", "venture capital",  # PE/VC firms are companies
]

# If Wikidata returns no result AND the name contains any of these substrings → drop.
# These are heuristics for abstract phrases the model shouldn't have extracted.
_NO_RESULT_DROP_SUBSTRINGS = [
    "makers", "sector", "model for", "backed by", "drone", " card",
    " stocks", " stock ", " party", " forces", "military", "trust vehicle",
    "fund vehicle", " index", "currency", "bloc", " coalition",
]


# Change (1): None (ambiguous) handling policy.
# Today is_valid_company returns `is_co is True`, so a None (ambiguous) verdict
# drops, against the classifier docstring and the module docstring (both say keep).
# None is the dominant case (about 89 percent of cached verdicts), and about 46
# percent of real indexed companies are dropped by it. We stop dropping None.
#
# Conservative default: on None, keep ONLY when the name is an already-indexed
# company (we already track it, so it is real), otherwise drop. This recovers the
# indexed false-drops without admitting every ambiguous unknown. Loosen later to
# keep all None by flipping NONE_KEEP_MODE to "keep_all" (a one-line change); the
# offline harness quantifies that loosening cost before anyone flips it.
NONE_KEEP_MODE = "indexed_only"  # or "keep_all"

# Lazily loaded, module-cached set of normalized indexed company names. The lookup
# must be an in-memory set membership test, never a per-call DB query (the gate
# runs per extracted entity, many per article). Tests may inject this directly.
_INDEXED_NAMES_CACHE = None

_LEGAL_SUFFIX_RE = re.compile(
    r"\b(incorporated|corporation|company|holdings|limited|inc|corp|co|ltd)\b\.?",
    re.IGNORECASE,
)


def _normalize_company_name(name: str | None) -> str:
    """Normalize a name for indexed-set membership: lowercase, strip legal suffixes
    (Inc/Corp/Co/Ltd/Company/Holdings and full forms), drop punctuation, collapse
    whitespace. The set and the candidate name MUST be normalized the same way."""
    n = (name or "").lower()
    n = _LEGAL_SUFFIX_RE.sub(" ", n)
    n = re.sub(r"[^a-z0-9 ]", " ", n)
    n = re.sub(r"\s+", " ", n).strip()
    return n


def _load_indexed_names(supabase) -> set:
    """Load and cache the normalized set of indexed company names ONCE. Paginated
    SELECT (read-only). On any error, returns an empty set so the None policy falls
    back to drop (fail-closed, never a per-call query)."""
    global _INDEXED_NAMES_CACHE
    if _INDEXED_NAMES_CACHE is not None:
        return _INDEXED_NAMES_CACHE
    names: set = set()
    try:
        page, size = 0, 1000
        while True:
            resp = (supabase.table("companies").select("name").order("id")
                    .range(page * size, page * size + size - 1).execute())
            rows = resp.data or []
            for r in rows:
                norm = _normalize_company_name(r.get("name"))
                if norm:
                    names.add(norm)
            if len(rows) < size:
                break
            page += 1
    except Exception as ex:
        print(f"  Wikidata: indexed-name load failed (None falls back to drop): {ex}")
    _INDEXED_NAMES_CACHE = names
    return names


def _name_is_indexed_company(name: str, supabase) -> bool:
    norm = _normalize_company_name(name)
    return bool(norm) and norm in _load_indexed_names(supabase)


def _resolve_keep(is_co: bool | None, name: str, supabase) -> bool:
    """Map a _classify verdict to keep (True) or drop (False). True keeps, False
    drops. None (ambiguous) keeps per NONE_KEEP_MODE: keep_all keeps unconditionally;
    indexed_only (default) keeps only an already-indexed company."""
    if is_co is True:
        return True
    if is_co is False:
        return False
    if NONE_KEEP_MODE == "keep_all":
        return True
    return _name_is_indexed_company(name, supabase)


# --------------------------------------------------------------------------
# Fetch. THE ONE INVARIANT: an answer from Wikidata and a failure to reach
# Wikidata are different things, and only the first one is cacheable.
# --------------------------------------------------------------------------
STATUS_OK = "ok"                # Wikidata answered, a label-matched entity has a description
STATUS_NO_RESULT = "no_result"  # Wikidata answered, nothing matched the name. Real information.
STATUS_FAILED = "failed"        # We never got an answer. NOT information. Never cache this.


class WikidataLookup(NamedTuple):
    status: str
    description: str | None


def _parse_retry_after(value: str | None) -> float | None:
    """Seconds to wait per an HTTP Retry-After header. Handles both legal forms,
    delta-seconds and HTTP-date. None when absent or unparseable."""
    if not value:
        return None
    raw = value.strip()
    try:
        return max(0.0, float(int(raw)))
    except ValueError:
        pass
    try:
        when = parsedate_to_datetime(raw)
    except (TypeError, ValueError, IndexError):
        return None
    if when is None:
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return max(0.0, (when - datetime.now(timezone.utc)).total_seconds())


def _sleep_before_retry(attempt: int, retry_after: float | None,
                        query: str, reason: str) -> bool:
    """Wait before the next attempt. Returns False when there is no attempt left,
    or when the server asked for a longer pause than a pipeline run can hold.

    NEVER sleeps LESS than a Retry-After the server sent. It either waits the
    full amount or declines to retry at all. Backing off less than asked is how
    a client earns a longer ban, and the whole point of this module's fix is to
    stop generating 429s.
    """
    if attempt >= _MAX_ATTEMPTS - 1:
        return False
    wait = _BACKOFF_BASE_SECONDS * (2 ** attempt)
    if retry_after is not None:
        if retry_after > _MAX_RETRY_AFTER_SECONDS:
            print(f"  Wikidata Retry-After {retry_after:.0f}s exceeds the "
                  f"{_MAX_RETRY_AFTER_SECONDS:.0f}s ceiling [{query!r}]: giving up, "
                  f"not caching")
            return False
        wait = max(retry_after, wait)  # honor in full, never less
    print(f"  Wikidata retry {attempt + 2}/{_MAX_ATTEMPTS} in {wait:.1f}s "
          f"[{query!r}]: {reason}")
    _sleep(wait)
    return True


def _search_wikidata(query: str) -> tuple[str, list]:
    """One wbsearchentities query, paced and retried. Returns (status, results).

    STATUS_FAILED is returned for every case where we did not get an answer:
    429 after the retries, a 5xx, a timeout, a transport error, an unparseable
    body. The caller must not turn that into a cache row.
    """
    last_error: object = None
    for attempt in range(_MAX_ATTEMPTS):
        if not _claim_fetch_budget():
            return STATUS_FAILED, []
        _RATE_LIMITER.acquire()
        try:
            resp = requests.get(
                WIKIDATA_API,
                params={
                    "action": "wbsearchentities",
                    "search": query,
                    "language": "en",
                    "format": "json",
                    "limit": _SEARCH_LIMIT,
                },
                timeout=_HTTP_TIMEOUT,
                headers={"User-Agent": _USER_AGENT},
            )
        except Exception as ex:
            last_error = f"transport error: {ex}"
            if not _sleep_before_retry(attempt, None, query, str(last_error)):
                break
            continue

        if resp.status_code in _RETRY_STATUS_CODES:
            retry_after = _parse_retry_after(resp.headers.get("Retry-After"))
            last_error = (f"HTTP {resp.status_code}"
                          + (f" Retry-After={retry_after:.0f}s" if retry_after is not None else ""))
            if not _sleep_before_retry(attempt, retry_after, query, str(last_error)):
                break
            continue

        if resp.status_code >= 400:
            print(f"  Wikidata search failed [{query!r}]: HTTP {resp.status_code} (not cached)")
            return STATUS_FAILED, []

        try:
            results = (resp.json() or {}).get("search") or []
        except Exception as ex:
            print(f"  Wikidata search failed [{query!r}]: unparseable body: {ex} (not cached)")
            return STATUS_FAILED, []

        return (STATUS_OK if results else STATUS_NO_RESULT), results

    print(f"  Wikidata search gave up after {_MAX_ATTEMPTS} attempt(s) "
          f"[{query!r}]: {last_error} (not cached)")
    return STATUS_FAILED, []


# --------------------------------------------------------------------------
# Label matching and the query ladder.
# --------------------------------------------------------------------------
_LEADING_ARTICLE_RE = re.compile(r"^the\s+")
_LEGAL_TOKENS = r"incorporated|corporation|company|holdings?|limited|inc|corp|co|ltd|plc|ag|nv|sa"
_TRAILING_LEGAL_RE = re.compile(rf"\s+(?:{_LEGAL_TOKENS})$")
_QUERY_SUFFIX_RE = re.compile(rf"[,\s]+(?:{_LEGAL_TOKENS})\.?\s*$", re.IGNORECASE)


def _normalize_label(value: str | None) -> str:
    """Normalize a name for label comparison: lowercase, punctuation to space,
    drop a leading article, then strip the TRAILING run of legal-entity tokens.

    Trailing-only on purpose. Stripping those tokens anywhere in the string
    folds unrelated names together; stripping them at the end is exactly what
    makes 'Truist Financial Corporation' equal the label 'Truist Financial' and
    'The Coca-Cola Company' equal the query 'Coca-Cola', while leaving
    'Coca-Cola Europacific Partners' different from 'Coca-Cola'.

    Separate from _normalize_company_name on purpose: that one feeds the indexed
    name set and its behavior is load-bearing for the None policy.
    """
    n = (value or "").lower()
    n = re.sub(r"[^a-z0-9]+", " ", n)
    n = re.sub(r"\s+", " ", n).strip()
    n = _LEADING_ARTICLE_RE.sub("", n)
    while True:
        stripped = _TRAILING_LEGAL_RE.sub("", n).strip()
        if stripped == n:
            return n
        n = stripped


def _strip_query_suffix(name: str) -> str | None:
    """'Truist Financial Corporation' -> 'Truist Financial'.

    Wikidata's search index does not always carry the full legal name. The
    corporate form returns ZERO hits for Truist Financial Corporation, while
    'Truist Financial' returns "american bank holding company". Same for
    O'Reilly, Republic Services, Howmet, Murphy USA and Corpay. Returns None
    when there is nothing to strip, so the caller does not issue a duplicate
    query.
    """
    original = (name or "").strip()
    out = original
    while True:
        nxt = _QUERY_SUFFIX_RE.sub("", out).strip()
        if nxt == out or not nxt:
            break
        out = nxt
    return out if out and out != original else None


def _result_labels(result: dict) -> list:
    """Every string on a search result that names the entity: its label, the
    text that matched, and its aliases. An alias is an official name for the
    same entity, so accepting one widens recall without loosening precision."""
    labels = [result.get("label")]
    match = result.get("match")
    if isinstance(match, dict):
        labels.append(match.get("text"))
    aliases = result.get("aliases")
    if isinstance(aliases, list):
        labels.extend(aliases)
    return [s for s in labels if isinstance(s, str) and s]


def _pick_description(results: list, target: str) -> str | None:
    """First result whose label or alias normalizes to `target`.

    Returns the lowercased description, "" when a label matched but carries no
    description (preserving the old empty-string-is-ambiguous behavior), or None
    when nothing in the top N actually names this company.

    THE LABEL CHECK IS THE POINT. Scanning the top N without it is worse than
    trusting result[0]: 47.5% of non-top results have labels unrelated to the
    query. 'Coca-Cola' returns Coca-Cola Europacific Partners, which classifies
    True and is a DIFFERENT company; 'Raintree' returns a 1957 film. A plain
    "any True in the top N" scan admits both. Requiring an exact normalized
    label match is what separates a legal-suffix variant of the same company
    from extra words that name a different one.
    """
    matched_any = False
    for result in results:
        if not isinstance(result, dict):
            continue
        if not any(_normalize_label(s) == target for s in _result_labels(result)):
            continue
        matched_any = True
        description = (result.get("description") or "").lower().strip()
        if description:
            return description
    return "" if matched_any else None


def _lookup_wikidata(name: str) -> WikidataLookup:
    """Resolve `name` to a Wikidata description, keeping the three outcomes apart.

    Queries the verbatim name first, then the legal-suffix-stripped form if the
    first query produced no label match. A FAILED first query short-circuits:
    we cannot tell a real miss from a throttled one, so we do not spend a second
    call and we do not return a verdict.
    """
    target = _normalize_label(name)
    queries = [name]
    stripped = _strip_query_suffix(name)
    if stripped and _normalize_label(stripped) == target:
        queries.append(stripped)

    for query in queries:
        status, results = _search_wikidata(query)
        if status == STATUS_FAILED:
            return WikidataLookup(STATUS_FAILED, None)
        description = _pick_description(results, target)
        if description is not None:
            return WikidataLookup(STATUS_OK, description)
    return WikidataLookup(STATUS_NO_RESULT, None)


def _classify(description: str | None, name: str) -> bool | None:
    """
    Classify an entity based on its Wikidata description.

    Returns:
        False  — confirmed not a company (drop)
        True   — confirmed company (keep)
        None   — ambiguous or unknown (keep by default)
    """
    if description is None:
        # No Wikidata entry — check abstract phrase heuristics
        low = name.lower()
        for sub in _NO_RESULT_DROP_SUBSTRINGS:
            if sub in low:
                return False
        return None  # Unknown — keep (likely small/private company)

    # Change (2) ordering: HARD drop wins over everything (a categorical
    # non-company). A clear company signal (KEEP) then beats a SOFT sector or
    # instrument word. SOFT drops only when no company signal was found.
    for pat in _HARD_DROP_DESCRIPTION_PATTERNS:
        if pat.search(description):
            return False

    ticker_shaped = bool(_TICKER_SHAPED_NAME_RE.match((name or "").strip()))
    for kw in _HARD_DROP_DESCRIPTION_KEYWORDS:
        if kw in description:
            if ticker_shaped and kw in _SOVEREIGNTY_DROP_KEYWORDS:
                continue  # ISO 3166 code collision on a ticker, not evidence
            return False

    for kw in _KEEP_DESCRIPTION_KEYWORDS:
        if kw in description:
            return True

    for kw in _SOFT_DROP_DESCRIPTION_KEYWORDS:
        if kw in description:
            return False

    return None  # Ambiguous


def is_valid_company(name: str, supabase) -> bool:
    """
    Returns True if `name` is (or likely is) a real operating company.

    Decision logic:
      - Cache hit: apply _resolve_keep to the cached verdict (True keeps, False
        drops, None keeps only an indexed company per NONE_KEEP_MODE)
      - Cache miss + Wikidata ANSWERED: classify, write the verdict to cache,
        then apply _resolve_keep. Both an answer with a description and a
        genuine no-result are answers and are cached.
      - Cache miss + fetch FAILED: write NOTHING, apply the ambiguous policy for
        this run only, retry on the next run. See the branch below.
      - Cache read error: keep (fail-open on infra error, unchanged)

    Logs every drop decision with the Wikidata description as evidence.
    """
    # 1. Check cache
    try:
        row = supabase.table("wikidata_entity_cache") \
            .select("is_company,wikidata_description") \
            .eq("name", name) \
            .execute()
        if row.data:
            cached = row.data[0]
            is_co = cached.get("is_company")
            # Change (1): None no longer drops unconditionally. _resolve_keep applies
            # the None policy (keep when the name is an indexed company).
            keep = _resolve_keep(is_co, name, supabase)
            if not keep:
                desc = (cached.get("wikidata_description") or "no description")[:70]
                print(f"  ⊘ Wikidata(cache) drop [{desc}]: {name}")
            return keep
    except Exception as ex:
        print(f"  Wikidata cache read error [{name!r}]: {ex}")
        return True  # Cache error → keep

    # 2. Cache miss — ask Wikidata
    lookup = _lookup_wikidata(name)

    # 2b. A FAILED fetch is NOT a verdict, so it gets no cache row.
    #
    # This branch is the bug fix. Before it existed, a 429 (or a timeout, or an
    # unparseable body) returned None from the fetcher, fell through _classify as
    # if Wikidata had answered "no such entity", and was written to a table with
    # no TTL and no invalidation. One throttled second, one permanently wrong
    # verdict. Writing nothing means the next run asks again, which is the only
    # honest thing to do with an unanswered question.
    #
    # The in-memory keep/drop for THIS run stays exactly what the ambiguous path
    # already did (keep only an already-indexed company). Deliberately not
    # fail-open: fail-open keep would push unvalidated surface forms into
    # resolve_entity, which INSERTs on a miss, and minting duplicate companies is
    # the failure mode this whole workstream is trying to shrink.
    if lookup.status == STATUS_FAILED:
        keep = _resolve_keep(None, name, supabase)
        print(f"  ⚠ Wikidata fetch failed, NOT cached "
              f"({'keep' if keep else 'drop'} for this run only): {name}")
        return keep

    description = lookup.description
    is_co = _classify(description, name)

    # 3. Write result to cache. Only reached when Wikidata actually answered:
    #    either with a label-matched description, or with a genuine no-result.
    try:
        supabase.table("wikidata_entity_cache").upsert({
            "name": name,
            "wikidata_description": description,
            "is_company": is_co,
        }).execute()
    except Exception as ex:
        print(f"  Wikidata cache write error [{name!r}]: {ex}")

    # 4. Resolve, log, return. The cached value above is the classifier verdict
    # (is_co, possibly None); the keep/drop decision applies the None policy here.
    keep = _resolve_keep(is_co, name, supabase)
    desc_display = (description or "no Wikidata result")[:70]
    if is_co is True:
        print(f"  ✓ Wikidata keep [{desc_display}]: {name}")
    elif is_co is False:
        print(f"  ⊘ Wikidata drop [{desc_display}]: {name}")
    elif keep:
        print(f"  ✓ Wikidata ambiguous-keep (indexed) [{desc_display}]: {name}")
    else:
        print(f"  ⊘ Wikidata ambiguous-drop (not indexed) [{desc_display}]: {name}")

    return keep
