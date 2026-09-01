"""Name agreement between one of our company names and an authority name.

ONE policy, shared by every site that writes an identifier onto a company
row. Before this module there were three, and none of them checked the name:

  * edgar.cik_mapping._update_companies_sec_cik joined companies to
    cik_tickers on TICKER and stamped sec_cik with no name check at all.
  * entity_resolver.populate_sec_cik_for_mint carried an existence guard
    and no name check.
  * finnhub_helper._pick_us_primary took the first accepted /search
    candidate, so a fuzzy name search wrote whatever Finnhub ranked first.

The third one is the author of the cross-wires. 'Ola' searched Finnhub, got
Coca-Cola back at rank 1, and companies.ticker became KO. The first one is
the amplifier: it turns a wrong ticker into a wrong CIK.

DESIGN RULE: FAIL OPEN. When there is no authority to check against, ALLOW
the write. The local cik_tickers table is bulk-loaded and ACCRETIVE, so a row
that has an authority name today keeps it tomorrow; staleness can only ADD
authority rows, never remove them. A gate that failed closed on a missing or
stale authority would blank companies that are correctly stamped today.

The gate governs WRITES ONLY. It never clears an existing sec_cik or ticker.
A rejection means "do not stamp", so its cost is a MISSING identifier, never
a WRONG one. Every tuning choice below resolves ties in that direction.

Keep in lockstep with src/lib/name-agreement.ts. The fixture list in
backend/tests/test_cik_stamp_name_agreement.py is mirrored by
src/lib/name-agreement.test.ts.
"""
from __future__ import annotations

import difflib
import re
from typing import Optional

# Pure legal-form tokens. These carry no identity in ANY name, and stripping
# them can never remove a distinguishing word.
_LEGAL = {
    "inc", "incorporated", "corp", "corporation", "co", "company", "companies",
    "ltd", "limited", "plc", "llc", "lp", "sa", "nv", "ag", "se", "ab", "as",
    "spa", "the", "class", "common", "stock", "and", "of",
}

# Weak-identity tokens: real words, but so generic that two names sharing only
# these have not agreed on anything. Dropped for the set/subset/ratio
# comparisons, KEPT for the acronym test, where they are load-bearing:
# 'INTERNATIONAL BUSINESS MACHINES' loses its I if 'international' is dropped,
# and IBM stops matching itself.
_WEAK = {
    "holdings", "holding", "group", "trust", "intl", "international", "new",
}

_SUFFIXES = _LEGAL | _WEAK

# Ratio on joined normalized strings above which we accept outright.
RATIO_ACCEPT = 0.80
# Minimum shared identity tokens for a subset relationship to be accepted.
MIN_SHARED_TOKENS = 2

# Minimum letters for an acronym match. Two-letter acronyms collide far too
# freely to be evidence: 'HP Inc.' vs 'Helmerich & Payne, Inc.' matches on
# {h,p} and is a real cross-wire in prod (companies.ticker HP, CIK 46765,
# which is Helmerich & Payne; HP Inc. is HPQ, CIK 47217). Three letters is
# where the birthday collision stops being cheap. Cost of the floor: genuine
# two-letter acronyms such as 'GE' vs 'GENERAL ELECTRIC' are rejected and go
# unstamped, which is the cheap direction.
MIN_ACRONYM_LEN = 3

# A short name that forms the LEADING run of the authority name is the same
# company only when the authority adds almost nothing. Bounding the extra by
# ONE identity token is what separates the two shapes that are otherwise
# identical as strings:
#
#   'Coinbase'  in 'Coinbase Global, Inc.'                 -> +1  same company
#   'Chime'     in 'Chime Financial, Inc.'                 -> +1  same company
#   'Fidelity'  in 'Fidelity National Information Services'-> +3  NOT the same
#   'BNY'       in 'BNY MELLON STRATEGIC MUNICIPALS, INC.' -> +3  NOT the same
#   'xAI'       in 'XAI Floating Rate & Alternative Income'-> +4  NOT the same
#
# An unbounded head-prefix rule accepts all five. That is why the previous
# revision of this module shipped head-prefix matching OFF: it could not
# reject Fidelity. The bound rejects Fidelity, BNY and xAI while keeping
# Coinbase and Chime, so the rule is now ON by default.
#
# Position is load-bearing and cannot be relaxed to "appears anywhere":
# 'Vanguard' is a +1 interior token of 'AMERICAN VANGUARD CORP' and is a real
# cross-wire in prod. Requiring the LEADING position rejects it.
MAX_HEAD_PREFIX_EXTRA = 1


def _tokens(name: str, drop: set[str]) -> list[str]:
    """Ordered tokens. Drops a trailing '/ QUALIFIER' (SEC writes state of
    incorporation that way: 'Columbia Financial, Inc./MD/'), strips
    punctuation, then removes `drop` and every single-character token.

    Single characters are always debris, never identity. Stripping the dots
    out of the legal forms 'S.A.', 'N.V.', 'S.p.A.' leaves loose letters
    behind, and those letters then count as identity tokens that the other
    side cannot match: 'Globant' vs 'Globant S.A.' scored one shared token
    out of three and was rejected as a disagreement.
    """
    n = re.sub(r"/.*$", " ", (name or "").lower())
    n = re.sub(r"[^a-z0-9 ]", " ", n)
    return [t for t in n.split() if len(t) > 1 and t not in drop]


def normalize_tokens(name: str) -> set[str]:
    """Identity tokens: legal forms and weak-identity words removed."""
    return set(_tokens(name, _SUFFIXES))


def _identity_seq(name: str) -> list[str]:
    """Ordered tokens with ONLY legal forms removed. Weak-identity words are
    kept because they still occupy a position and still contribute an
    initial."""
    return _tokens(name, _LEGAL)


def _acronym_of(short: set[str], long_seq: list[str]) -> bool:
    """'IBM' vs 'INTERNATIONAL BUSINESS MACHINES'. Compares as a multiset of
    initials so word order does not matter, but the counts must match
    exactly."""
    if len(short) != 1:
        return False
    (s,) = short
    if len(s) < MIN_ACRONYM_LEN or len(s) != len(long_seq):
        return False
    return sorted(t[0] for t in long_seq) == sorted(s)


def _head_prefix_agrees(our_name: str, authority_name: str) -> bool:
    """Our tokens form a LEADING run of the authority's token sequence AND
    the authority adds at most MAX_HEAD_PREFIX_EXTRA identity tokens.

    The positional test runs on RAW tokens, with nothing dropped but
    single-character debris. Stripping legal forms from our side first would
    let a brand whose name genuinely ENDS in one masquerade as a bare
    prefix: 'Urban Company' reduces to ['urban'], which is a head prefix of
    'URBAN OUTFITTERS INC' with one extra token, and Urban Company is an
    Indian home-services firm that has nothing to do with Urban Outfitters.
    On raw tokens ['urban', 'company'] vs ['urban', 'outfitters', 'inc'] the
    second position disagrees and the rule declines.

    Nothing is lost by being strict here: a name that differs from the
    authority only in its legal form ('Foo Inc' vs 'Foo Corporation') has
    already been accepted by the token-set equality test above.
    """
    ours_seq = _tokens(our_name, set())
    theirs_seq = _tokens(authority_name, set())
    if not ours_seq or theirs_seq[: len(ours_seq)] != ours_seq:
        return False
    extra = normalize_tokens(authority_name) - normalize_tokens(our_name)
    return len(extra) <= MAX_HEAD_PREFIX_EXTRA


def names_agree(
    our_name: str, authority_name: Optional[str]
) -> tuple[bool, str]:
    """(agrees, reason). FAIL OPEN when either side carries no identity."""
    if not authority_name or not str(authority_name).strip():
        return True, "fail-open: no authority name"
    ours = normalize_tokens(our_name)
    theirs = normalize_tokens(authority_name)
    if not ours:
        return True, "fail-open: our name has no identity tokens"
    if not theirs:
        return True, "fail-open: authority name has no identity tokens"

    if ours == theirs:
        return True, "token sets equal"

    shared = ours & theirs
    if (ours <= theirs or theirs <= ours) and len(shared) >= MIN_SHARED_TOKENS:
        return True, f"subset with {len(shared)} shared tokens"

    a, b = " ".join(sorted(ours)), " ".join(sorted(theirs))
    ratio = difflib.SequenceMatcher(None, a, b).ratio()
    # Truncate rather than round for display. Python's format() rounds
    # half-to-even and JavaScript's toFixed does not, so a ratio of exactly
    # 0.625 renders as 0.62 here and 0.63 in the TS mirror. Truncation is the
    # one rule both languages implement identically, which keeps the parity
    # test able to assert on the reason string and not just the verdict.
    shown = int(ratio * 100) / 100
    if ratio >= RATIO_ACCEPT:
        return True, f"ratio {shown:.2f}"

    ours_seq, theirs_seq = _identity_seq(our_name), _identity_seq(authority_name)
    if _acronym_of(ours, theirs_seq) or _acronym_of(theirs, ours_seq):
        return True, "acronym"

    if _head_prefix_agrees(our_name, authority_name):
        return True, "head prefix, authority adds <= 1 identity token"

    return False, f"disagree (shared={len(shared)} ratio={shown:.2f})"
