"""Link SEC registry rows to Company Intel companies rows, by name.

There is no shared identifier. A companies row carries a name, sometimes a
ticker, rarely a CIK; the ADV roster carries a CRD and a filed business name;
the 13F index carries a manager CIK and a filer name. Only the names overlap, so
the link is a name match and a name match on financial firms is HARD:

    "BNP Paribas"        -> "BNP PARIBAS ASSET MANAGEMENT USA, INC."
    "J.P. Morgan"        -> "J.P. MORGAN SECURITIES LLC"
    "GE Vernova"         -> "GE VERNOVA INVESTMENT ADVISERS, LLC"

Each of those is a real, correctly-spelled hit on a real registered entity that
is NOT the company on the page. Every large financial group has registered
subsidiaries whose names begin with the group name, and their RAUM is a fraction
of the parent's. So the matcher does not return a boolean. It returns a TIER,
and the tier is stored so a read path can decide what to trust and an auditor
can replay the decision without re-running the ingest.

    exact   normalized registry name == normalized company name.
            "Thoma Bravo" == "THOMA BRAVO".
    core    equal after BOTH sides drop legal suffixes and generic corporate
            words. "Needham" == "NEEDHAM & COMPANY, LLC";
            "Vanguard" == "VANGUARD GROUP INC".
    prefix  the registry name STARTS WITH the company name but carries extra
            substantive words. This is the affiliate-shaped tier and it is the
            one that produces the wrong-company hits above.

TWO GUARDS, BOTH LEARNED FROM THE HITS ABOVE
--------------------------------------------
1. AMBIGUITY. A company name that prefix-matches many registry rows has not
   identified anything. "Blackstone" prefixes dozens of registered entities.
   When more than MAX_PREFIX_CANDIDATES registry rows prefix-match, the match is
   dropped rather than resolved arbitrarily.
2. ADJUDICATION. backend/data/adviser_link_overrides.json is the source of truth
   for names a human has ruled on, in the same spirit as HARD_TICKER_OVERRIDES.
   A blocked entry is never linked at any tier. A confirmed entry is linked at
   the recorded key and flagged match_confirmed. The matcher NEVER writes to it.

SHORT NAMES ARE NOT MATCHED AT THE PREFIX TIER. A three-character company name
prefixes an enormous number of registered firms, and "ARK" or "GI" landing on
the first alphabetical hit is not a match, it is a coin flip.
"""
from __future__ import annotations

import json
import os
import re
from collections import defaultdict
from dataclasses import dataclass
from typing import Iterable, Optional, Sequence

# Above this many prefix candidates a company name is ambiguous, not matched.
MAX_PREFIX_CANDIDATES = 3
# Minimum normalized length for a name to be eligible for the prefix tier.
MIN_PREFIX_NAME_LEN = 6

OVERRIDES_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data",
    "adviser_link_overrides.json",
)

# Legal-entity suffixes. Dropped from the END of a name only.
LEGAL_SUFFIXES = {
    "inc", "incorporated", "corp", "corporation", "co", "company", "llc", "llp",
    "lp", "llp", "plc", "ltd", "limited", "lc", "pc", "pllc", "sa", "nv", "ag",
    "gmbh", "ab", "as", "bv", "kk", "pte", "sarl", "spa", "srl", "oy", "aps",
}

# Generic words that carry no identity on their own. Dropped ANYWHERE in the
# name for the `core` tier only. Deliberately short: "capital", "partners",
# "advisors" and "securities" are NOT here, because dropping them collapses
# "Charlesbank" into "Charlesbank Capital Partners" and that is exactly the
# affiliate confusion the tiers exist to keep visible.
GENERIC_WORDS = {
    "group", "holdings", "holding", "international", "global", "usa", "us",
    "america", "american", "na", "the", "and",
}

_PUNCT_RE = re.compile(r"[^\w\s]+")
_WS_RE = re.compile(r"\s+")


def normalize(name: Optional[str]) -> str:
    """Casefold, strip punctuation, collapse whitespace.

    'J.P. Morgan Securities, LLC.' -> 'jp morgan securities llc'
    Accented characters are left alone: 'Credit Agricole' and
    'Credit Agricole' with an accent are different strings on purpose, because
    silently folding them would merge two distinct registered entities.
    """
    if not name:
        return ""
    s = _PUNCT_RE.sub(" ", name.strip().lower())
    # 'j p morgan' from 'J.P. Morgan': rejoin single letters split by punctuation
    s = re.sub(r"\b([a-z])\s+(?=[a-z]\b)", r"\1", s)
    return _WS_RE.sub(" ", s).strip()


def _tokens(name: str) -> list[str]:
    return [t for t in normalize(name).split(" ") if t]


def core_tokens(name: str) -> tuple[str, ...]:
    """Identity-bearing tokens: legal suffixes off the end, generics dropped."""
    toks = _tokens(name)
    while toks and toks[-1] in LEGAL_SUFFIXES:
        toks.pop()
    return tuple(t for t in toks if t not in GENERIC_WORDS and t not in LEGAL_SUFFIXES)


def match_tier(company_name: str, registry_name: str) -> Optional[str]:
    """Return 'exact' | 'core' | 'prefix' | None for one candidate pair."""
    c_norm = normalize(company_name)
    r_norm = normalize(registry_name)
    if not c_norm or not r_norm:
        return None
    if c_norm == r_norm:
        return "exact"

    c_core = core_tokens(company_name)
    r_core = core_tokens(registry_name)
    if c_core and c_core == r_core:
        return "core"

    # Prefix: the registry name begins with the whole company name, on a word
    # boundary, and the company name is long enough to be distinctive.
    if len(c_norm) >= MIN_PREFIX_NAME_LEN and (
        r_norm.startswith(c_norm + " ")
    ):
        return "prefix"
    return None


TIER_RANK = {"exact": 0, "core": 1, "prefix": 2}


@dataclass(frozen=True)
class LinkOverride:
    """One human ruling on a company -> registry link."""

    blocked: bool
    crd: Optional[int]
    cik: Optional[int]
    reason: str


def load_overrides(path: str = OVERRIDES_PATH) -> dict[str, LinkOverride]:
    """Read the adjudication file, keyed on normalized company name.

    A missing file is a normal state: the matcher then runs unadjudicated and
    every link carries match_confirmed=false.
    """
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as fh:
        raw = json.load(fh)
    out: dict[str, LinkOverride] = {}
    for entry in raw.get("links", []):
        key = normalize(entry.get("company"))
        if not key:
            continue
        out[key] = LinkOverride(
            blocked=bool(entry.get("blocked", False)),
            crd=entry.get("crd"),
            cik=entry.get("cik"),
            reason=entry.get("reason", ""),
        )
    return out


@dataclass(frozen=True)
class Link:
    """One resolved company -> registry link."""

    company_id: str
    company_name: str
    registry_key: int          # CRD for advisers, manager CIK for 13F
    registry_name: str
    tier: str
    confirmed: bool


def _index_by_first_token(registry: Sequence[tuple[int, str]]) -> dict[str, list[tuple[int, str]]]:
    """Bucket registry rows by their first normalized token.

    A full cross product of 4,260 companies against 16,876 advisers is 72M
    comparisons. Every tier this matcher supports requires the FIRST identity
    token to agree, so bucketing on it makes the pass linear without changing a
    single verdict.
    """
    buckets: dict[str, list[tuple[int, str]]] = defaultdict(list)
    for key, name in registry:
        toks = _tokens(name)
        if toks:
            buckets[toks[0]].append((key, name))
    return buckets


def link_companies(
    companies: Iterable[dict],
    registry: Sequence[tuple[int, str]],
    *,
    overrides: Optional[dict[str, LinkOverride]] = None,
    override_field: str = "crd",
) -> list[Link]:
    """Match companies rows against (registry_key, registry_name) pairs.

    `companies` rows need `id` and `name`. `override_field` selects which key an
    override entry supplies for this registry ('crd' or 'cik').

    Returns at most one Link per company: the best tier, and within a tier the
    shortest registry name, because a shorter name at the same tier is the less
    qualified entity and therefore the closer one to the company itself.
    """
    ov = load_overrides() if overrides is None else overrides
    by_key = {key: name for key, name in registry}
    buckets = _index_by_first_token(registry)
    links: list[Link] = []

    for row in companies:
        cid, cname = row.get("id"), (row.get("name") or "").strip()
        if not cid or not cname:
            continue
        rule = ov.get(normalize(cname))
        if rule is not None:
            if rule.blocked:
                continue
            forced = getattr(rule, override_field)
            if forced is not None and forced in by_key:
                links.append(
                    Link(
                        company_id=cid,
                        company_name=cname,
                        registry_key=forced,
                        registry_name=by_key[forced],
                        tier="exact",
                        confirmed=True,
                    )
                )
                continue
            # An override that names the other registry says nothing about this
            # one, so fall through to the matcher rather than dropping the name.

        toks = _tokens(cname)
        if not toks:
            continue
        candidates = buckets.get(toks[0], ())
        scored: list[tuple[int, int, int, str]] = []
        prefix_firms: set[int] = set()
        for key, rname in candidates:
            tier = match_tier(cname, rname)
            if tier is None:
                continue
            if tier == "prefix":
                # DISTINCT FIRMS, not distinct name strings. One CRD supplies
                # both a primary business name and a legal name, and for most
                # advisers the two are the same string, so counting hits made
                # every two-entity group look like a four-way ambiguity and
                # dropped links that were never ambiguous (Eaton Vance: 4 hits,
                # 2 firms).
                prefix_firms.add(key)
            scored.append((TIER_RANK[tier], len(normalize(rname)), key, rname))
        if not scored:
            continue
        scored.sort()
        rank, _, key, rname = scored[0]
        tier = next(t for t, r in TIER_RANK.items() if r == rank)
        # Ambiguity guard applies only when the WINNER is a prefix match: an
        # exact or core hit is already specific, however many affiliates share
        # the company's first token.
        if tier == "prefix" and len(prefix_firms) > MAX_PREFIX_CANDIDATES:
            continue
        links.append(
            Link(
                company_id=cid,
                company_name=cname,
                registry_key=key,
                registry_name=rname,
                tier=tier,
                confirmed=False,
            )
        )
    return links
