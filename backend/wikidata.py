"""
wikidata.py — Entity validation via Wikidata search API with Supabase cache.

Public API:
    is_valid_company(name: str, supabase) -> bool
        Returns True if name is (or likely is) a real operating company.
        Checks Supabase cache first; calls Wikidata API on cache miss.
        Defaults to True (keep) on ambiguous results or API errors.
"""

import time
import requests

WIKIDATA_API = "https://www.wikidata.org/w/api.php"
_USER_AGENT = "BreakingAlpha/1.0 (company intel entity quality; contact via github)"
_REQUEST_DELAY = 0.15  # seconds between uncached API calls — well within Wikidata limits

# Descriptions that confirm the entity is NOT a company.
# All checked as substrings on the lowercased Wikidata description.
_DROP_DESCRIPTION_KEYWORDS = [
    "country", "sovereign state", "nation state", "government", "federal agency",
    "regulatory agency", "independent agency", "government agency", "central bank",
    "military branch", "armed forces", "intelligence agency",
    "natural person", "human", "politician", "head of state", "president of",
    "prime minister", "secretary of", "businessman",  # individuals often described as "businessman"
    "cryptocurrency", "digital currency", "crypto asset", "digital cash",
    "stock market index", "stock index", "financial index", "market index",
    "political party", "religious organization", "advocacy group",
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

    for kw in _DROP_DESCRIPTION_KEYWORDS:
        if kw in description:
            return False

    for kw in _KEEP_DESCRIPTION_KEYWORDS:
        if kw in description:
            return True

    return None  # Ambiguous — keep


def is_valid_company(name: str, supabase) -> bool:
    """
    Returns True if `name` is (or likely is) a real operating company.

    Decision logic:
      - Cache hit: return cached result immediately (is_company=False → drop, else keep)
      - Cache miss: call Wikidata API, classify, write to cache, return result
      - API error or ambiguous result: default to True (keep)

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
            if is_co is False:
                desc = (cached.get("wikidata_description") or "no description")[:70]
                print(f"  ⊘ Wikidata(cache) drop [{desc}]: {name}")
            return is_co is True  # None → drop, True → keep, False → drop
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

    # 4. Log and return
    desc_display = (description or "no Wikidata result")[:70]
    if is_co is False:
        print(f"  ⊘ Wikidata drop [{desc_display}]: {name}")
    elif is_co is True:
        print(f"  ✓ Wikidata keep [{desc_display}]: {name}")
    else:
        print(f"  ⊘ Wikidata ambiguous (drop) [{desc_display}]: {name}")

    return is_co is True
