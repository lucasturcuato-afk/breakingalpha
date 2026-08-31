"""Name agreement between our companies.name and an SEC registrant name.

ONE policy, shared by every site that stamps companies.sec_cik. Before this
module there were two: the mint-time path (entity_resolver.populate_sec_cik_
for_mint) carried an existence guard and no name check, and the sync-time path
(edgar.cik_mapping._update_companies_sec_cik) carried neither. Same column,
two policies.

DESIGN RULE: FAIL OPEN. When there is no authority to check against, ALLOW the
write. The local cik_tickers table is bulk-loaded and ACCRETIVE, so a row that
has an authority name today keeps it tomorrow; staleness can only ADD authority
rows, never remove them. A gate that failed closed on a missing or stale
authority would blank companies that are correctly stamped today.

The gate governs WRITES ONLY. It never clears an existing sec_cik. A rejection
means "do not stamp", so its cost is a missing CIK, not a wrong identity.
"""
from __future__ import annotations

import difflib
import re
from typing import Optional

# Legal / structural tokens that carry no identity signal.
_SUFFIXES = {
    "inc", "incorporated", "corp", "corporation", "co", "company", "companies",
    "ltd", "limited", "plc", "llc", "lp", "sa", "nv", "ag", "se", "ab", "as",
    "spa", "holdings", "holding", "group", "the", "trust", "intl",
    "international", "class", "common", "stock", "and", "of", "new",
}

# Ratio on joined normalized strings above which we accept outright.
RATIO_ACCEPT = 0.80
# Minimum shared identity tokens for a subset relationship to be accepted.
MIN_SHARED_TOKENS = 2

# OFF by default, and deliberately so. When True, a short name that forms the
# LEADING run of the registrant name is accepted ("Cisco" -> "CISCO SYSTEMS
# INC"). Measured on prod 2026-08-31: over the 793 stamped rows this converts
# 47 rejections into acceptances, of which roughly 41 are genuinely the same
# company and at least one is NOT ("Fidelity" -> "Fidelity National
# Information Services", which is FIS, not Fidelity Investments).
#
# The line between "Fidelity" inside "Fidelity National Information Services"
# and "Chime" inside "Chime Financial" does not exist in the string. Turning
# this on trades a specific, named false acceptance for ~41 fewer false
# rejections. That is a product call, not a code call, so it ships off and the
# numbers ship with it. See docs/cik-stamp-name-agreement.md.
ALLOW_HEAD_PREFIX = False


def normalize_tokens(name: str) -> set[str]:
    """Lowercase, drop a trailing '/ QUALIFIER', strip punctuation, drop
    legal-form stopwords. What remains is identity."""
    n = re.sub(r"/.*$", " ", (name or "").lower())
    n = re.sub(r"[^a-z0-9 ]", " ", n)
    return {t for t in n.split() if t and t not in _SUFFIXES}


def _acronym_of(short: set[str], long_: set[str]) -> bool:
    """'IBM' vs 'INTERNATIONAL BUSINESS MACHINES'."""
    if len(short) != 1:
        return False
    (s,) = short
    if len(s) < 2 or len(s) != len(long_):
        return False
    initials = "".join(sorted(t[0] for t in long_))
    return initials == "".join(sorted(s))


def _is_head_prefix(our_name: str, registrant_name: str) -> bool:
    """Our tokens form a LEADING run of the registrant's token sequence.
    Order matters: it accepts 'Cisco' in 'CISCO SYSTEMS INC' and still
    rejects 'Vanguard' in 'AMERICAN VANGUARD CORP'."""
    def seq(n: str) -> list[str]:
        n = re.sub(r"/.*$", " ", (n or "").lower())
        return [t for t in re.sub(r"[^a-z0-9 ]", " ", n).split() if t]
    ours, theirs = seq(our_name), seq(registrant_name)
    return bool(ours) and theirs[:len(ours)] == ours


def names_agree(our_name: str, registrant_name: Optional[str]) -> tuple[bool, str]:
    """(agrees, reason). FAIL OPEN when either side carries no identity."""
    if not registrant_name or not str(registrant_name).strip():
        return True, "fail-open: no authority name"
    ours = normalize_tokens(our_name)
    theirs = normalize_tokens(registrant_name)
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
    if ratio >= RATIO_ACCEPT:
        return True, f"ratio {ratio:.2f}"

    short, long_ = (ours, theirs) if len(ours) <= len(theirs) else (theirs, ours)
    if _acronym_of(short, long_):
        return True, "acronym"

    if ALLOW_HEAD_PREFIX and _is_head_prefix(our_name, registrant_name):
        return True, "head prefix of registrant name"

    return False, (
        f"disagree (shared={len(shared)} ratio={ratio:.2f})"
    )
