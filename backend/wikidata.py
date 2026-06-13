"""
wikidata.py — Entity validation via Wikidata search API with Supabase cache.

Public API:
    is_valid_company(name: str, supabase) -> bool
        Returns True if name is (or likely is) a real operating company.
        Checks Supabase cache first; calls Wikidata API on cache miss.
        Defaults to True (keep) on ambiguous results or API errors.
"""

import re
import time
import requests

WIKIDATA_API = "https://www.wikidata.org/w/api.php"
_USER_AGENT = "BreakingAlpha/1.0 (company intel entity quality; contact via github)"
_REQUEST_DELAY = 0.15  # seconds between uncached API calls — well within Wikidata limits

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
    "natural person", "human", "politician", "head of state", "president of",
    "prime minister", "secretary of", "businessman",  # individuals often described as "businessman"
    "political party", "religious organization", "advocacy group",
]
_SOFT_DROP_DESCRIPTION_KEYWORDS = [
    "cryptocurrency", "digital currency", "crypto asset", "digital cash",
    "stock market index", "stock index", "financial index", "market index",
    "sovereign wealth fund", "investment trust", "special purpose",
    "news agency", "news wire",
]

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
    for kw in _HARD_DROP_DESCRIPTION_KEYWORDS:
        if kw in description:
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
