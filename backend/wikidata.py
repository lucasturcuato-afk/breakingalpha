"""
wikidata.py — Entity validation via Wikidata search API with Supabase cache.

Public API:
    is_valid_company(name: str, supabase) -> bool
        Returns True if name is (or likely is) a real operating company.
        Checks Supabase cache first; calls Wikidata API on cache miss.
        Defaults to True (keep) on ambiguous results or API errors.
"""

import ast
import hashlib
import inspect
import re
import textwrap
import time

import requests

WIKIDATA_API = "https://www.wikidata.org/w/api.php"
_USER_AGENT = "BreakingAlpha/1.0 (company intel entity quality; contact via github)"
_REQUEST_DELAY = 0.15  # seconds between uncached API calls — well within Wikidata limits

# LANE D CONTRACT. This dict is this module's own honest, machine-readable
# description of how _fetch_wikidata_description behaves. It is read by
# backend/wikidata_cache_rebuild.py, which REFUSES to make any network call
# unless the values below clear the measured Wikidata budget.
#
# The values are correct as written for the CURRENT fetcher, and the current
# fetcher is broken:
#   * min_interval_s 0.15 is 400 calls/min against a measured anonymous budget
#     of 10 to 11 calls per 52 seconds. That is roughly 35x over budget and it
#     is why 76.34% of wikidata_entity_cache rows carry a NULL description.
#   * honors_retry_after is False. The except branch swallows HTTP 429 and
#     returns None, indistinguishable from a genuine "Wikidata has no entry".
#   * reports_http_status is False, for the same reason: one None means both
#     "no such entity" and "we got throttled".
#
# LANE D (the 429 fetch fix) MUST update this dict in the same commit that
# fixes the fetcher. Until version reaches 2 with honors_retry_after and
# reports_http_status both True, the cache rebuild will not run. That refusal
# is deliberate: rebuilding into a throttled fetcher re-poisons the cache with
# the same NULLs, at scale, and burns the budget doing it.
FETCH_CONTRACT = {
    "version": 1,
    "min_interval_s": _REQUEST_DELAY,
    "honors_retry_after": False,
    "reports_http_status": False,
}

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


def _fetch_wikidata_description(name: str) -> str | None:
    """
    Call Wikidata search API for `name`. Returns the top result's description
    (lowercased), or None if no results or API error.
    """
    try:
        resp = requests.get(
            WIKIDATA_API,
            params={
                "action": "wbsearchentities",
                "search": name,
                "language": "en",
                "format": "json",
                "limit": 1,
            },
            timeout=8,
            headers={"User-Agent": _USER_AGENT},
        )
        resp.raise_for_status()
        results = resp.json().get("search", [])
        if not results:
            return None
        return (results[0].get("description") or "").lower().strip()
    except Exception as ex:
        print(f"  Wikidata API error [{name!r}]: {ex}")
        return None  # Treat API error as ambiguous → keep


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


# ---------------------------------------------------------------------------
# CLASSIFIER VERSION STAMP
# ---------------------------------------------------------------------------
# wikidata_entity_cache stores _classify's verdict, not its inputs' meaning. So
# when _classify changes, every row written under the old rules is wrong and
# nothing notices. That is not hypothetical: PR #358 shipped the HARD/SOFT split
# on 2026-06-13 specifically so that "american company that operates a
# cryptocurrency exchange platform" would classify as a company, and 68 days
# later Coinbase is still cached False on that exact string, because
# is_valid_company returns from the cache branch without re-classifying.
#
# classifier_version() is the fix for the general case. It fingerprints
# everything that can change a verdict:
#   * all four keyword lists, in order
#   * the parsed logic of _classify itself, so a structural change (a new
#     anchored regex, a reordering, a ticker guard) bumps the version even when
#     no keyword list moved
#   * CLASSIFIER_EPOCH, a manual escape hatch for the rare case where behavior
#     changes from outside this function
#
# Fingerprinting the parsed AST rather than the raw source is deliberate: the
# whole point is that nobody has to remember to bump a number. A hand-bumped
# integer is exactly the discipline that failed for 68 days. Comment and
# docstring edits are stripped before hashing so cosmetic churn does not bump
# the version; a spurious bump would only cost one zero-network re-classify
# pass over the ~5.8k rows that hold a description, which takes under a minute.
#
# NONE_KEEP_MODE is deliberately NOT in the fingerprint. It is applied by
# _resolve_keep at read time and never stored, so changing it invalidates
# nothing in the cache.
CLASSIFIER_EPOCH = 1

_CLASSIFIER_VERSION_CACHE = None


def _classify_logic_fingerprint() -> str:
    """Hash the parsed body of _classify, docstring stripped. Returns the
    sentinel "unavailable" if the source cannot be read (frozen or exec'd
    module). This runs on a background path only; it must never raise into
    ingest, so every failure degrades to the sentinel."""
    try:
        tree = ast.parse(textwrap.dedent(inspect.getsource(_classify)))
        fn = tree.body[0]
        body = getattr(fn, "body", [])
        if (body and isinstance(body[0], ast.Expr)
                and isinstance(getattr(body[0], "value", None), ast.Constant)
                and isinstance(body[0].value.value, str)):
            fn.body = body[1:]
        return hashlib.sha256(ast.dump(tree).encode("utf-8")).hexdigest()[:16]
    except Exception:
        return "unavailable"


def classifier_version() -> str:
    """Stable identifier for the current _classify behavior, e.g. "v1-8f3a...".

    A cache row stamped with a different value was produced by a different
    classifier and is stale by definition. Computed once and memoized; import
    cost is zero because nothing calls this at import time."""
    global _CLASSIFIER_VERSION_CACHE
    if _CLASSIFIER_VERSION_CACHE is not None:
        return _CLASSIFIER_VERSION_CACHE
    parts = [
        f"epoch={CLASSIFIER_EPOCH}",
        "hard=" + "\x1f".join(_HARD_DROP_DESCRIPTION_KEYWORDS),
        "soft=" + "\x1f".join(_SOFT_DROP_DESCRIPTION_KEYWORDS),
        "keep=" + "\x1f".join(_KEEP_DESCRIPTION_KEYWORDS),
        "noresult=" + "\x1f".join(_NO_RESULT_DROP_SUBSTRINGS),
        "logic=" + _classify_logic_fingerprint(),
    ]
    digest = hashlib.sha256("\x1e".join(parts).encode("utf-8")).hexdigest()[:16]
    _CLASSIFIER_VERSION_CACHE = f"v{CLASSIFIER_EPOCH}-{digest}"
    return _CLASSIFIER_VERSION_CACHE


def is_valid_company(name: str, supabase) -> bool:
    """
    Returns True if `name` is (or likely is) a real operating company.

    Decision logic:
      - Cache hit: apply _resolve_keep to the cached verdict (True keeps, False
        drops, None keeps only an indexed company per NONE_KEEP_MODE)
      - Cache miss: call Wikidata API, classify, write the verdict to cache, then
        apply _resolve_keep
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

    # 2. Cache miss — call API
    time.sleep(_REQUEST_DELAY)
    description = _fetch_wikidata_description(name)
    is_co = _classify(description, name)

    # 3. Write result to cache
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
