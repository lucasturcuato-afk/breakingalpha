"""Read-only company-name matching for the primary_company fold.

WHY THIS IS NOT normalize.py
----------------------------
`normalize.normalize_lookup_key` (v1) is the WRITE key for the `aliases` table.
Every alias row in prod is keyed on it, and per
`docs/normalize-lookup-key-v2-design.md` the miss path in
`entity_resolver.resolve_entity` CREATES A COMPANY. So changing v1, or feeding
a v2 key into the resolver, turns ~2,172 alias lookups into misses and mints
duplicate company rows. That is the single most dangerous thing anyone could do
in this area.

This module therefore defines a SEPARATE, strictly READ-ONLY key. It is used
only to decide whether a primary_company string names a company the index
already contains. It never reaches resolve_entity, never becomes a stored key,
and never causes a write.

`normalize_company_key` is a faithful Python port of
`norm_v2.lookup_key_v2` in `sql/proposals/0020_normalize_lookup_key_v2.sql`,
including its fixtures (mirrored in the tests). Porting rather than inventing
keeps ONE definition of "same company" in the project: when 0020 is eventually
applied, this gate already agrees with it. If you change one, change both.
"""

import re
import string

try:
    from normalize import normalize_lookup_key  # cron context: cwd=backend/
except ImportError:  # pragma: no cover - import-style shim, mirrors entity_resolver
    from backend.normalize import normalize_lookup_key  # test/dev context: cwd=repo-root


#: Trailing corporate-suffix tokens, stripped repeatedly.
#:
#: BASE is verbatim from norm_v2.lookup_key_v2 in sql/proposals/0020.
BASE_SUFFIXES = (
    "inc", "incorporated", "corp", "corporation", "co", "company", "llc",
    "ltd", "limited", "plc", "sa", "ag", "nv", "ab", "holdings", "group",
)

#: EXTRA is a DIVERGENCE FROM 0020, added here and measured.
#:
#: 0020's list is Anglo-centric and misses the European forms. The measured
#: consequence: "SAP SE" (52 rows in the diagnosis, listed there as a
#: formatting near-miss onto the indexed "SAP") does not collapse under BASE
#: alone, because SE is Societas Europaea and is absent from the list.
#:
#: Each token below was kept only because `tools/primary_fold_eval.py
#: --suffix-audit` measured it resolving additional rows over the full corpus.
#: Measured contribution, added to BASE alone (170,178 rows, 2026-08-15):
#:     se   +113 rows   spa  +2   oyj  +2   asa  +4   pte  +1   pty  +1
#: Tried and DROPPED rather than carried on principle:
#:     sas  +0   gmbh +0   kgaa +0 rows but +5 new ambiguous collisions
#: "se" also adds 26 ambiguous collisions. Those cost nothing: an ambiguous key
#: is refused, which is exactly the pre-existing no-fold outcome.
#:
#: If 0020 is ever applied, fold these into it so the two agree again.
EXTRA_SUFFIXES = ("se", "spa", "oyj", "asa", "pte", "pty")

#: The leading \s+ is load-bearing: it means a single-token name that IS a
#: suffix word ("Group") can never be emptied by the strip loop.
_SUFFIX_RE = re.compile(
    r"\s+(" + "|".join(BASE_SUFFIXES + EXTRA_SUFFIXES) + r")$"
)

#: NOT STRIPPED: a leading "The".
#:
#: This was tried and reverted on evidence. The diagnosis lists "Coca-Cola"
#: (123 rows) against the indexed "The Coca-Cola Company" as a near-miss, which
#: makes leading-article stripping look obviously right. Measured over the full
#: corpus it recovered ZERO additional rows and created 65 new ambiguous
#: collisions, because the index holds BOTH "The Coca-Cola" and "The Coca-Cola
#: Company" as separate rows: folding the article makes duplicates collide with
#: each other, and the uniqueness guard then correctly refuses both.
#:
#: That case is index duplication, not a normalization gap. It belongs to the
#: sql/proposals/0020 merge. Do not re-add this without re-measuring.

#: POSIX [[:punct:]]. Spelled out rather than using \W so that accented letters
#: survive: v1 deliberately preserves them (Estee Lauder keeps its accent), and
#: \W would strip them.
_PUNCT_TO_SPACE_RE = re.compile(f"[{re.escape(string.punctuation)}]")

#: Deleted outright rather than spaced, so "Inc." -> "inc" and "Moody's" ->
#: "moodys". U+2019 is already folded to "'" by v1; kept here defensively so the
#: port matches the SQL character class exactly.
_PUNCT_TO_DELETE_RE = re.compile(r"[.'’]")

_SUFFIX_PASSES = 3


def normalize_company_key(s: str) -> str:
    """Fold a company surface form onto a comparison key.

    v1, then delete dots/apostrophes, then other punctuation to space, then
    collapse whitespace, then strip trailing corporate suffixes (up to 3
    passes). Never returns "" for non-empty input.

    READ-ONLY. Never store this value. See the module docstring.
    """
    base = normalize_lookup_key(s or "")
    punct = _PUNCT_TO_DELETE_RE.sub("", base)
    punct = _PUNCT_TO_SPACE_RE.sub(" ", punct)
    punct = re.sub(r"\s+", " ", punct).strip()

    out = punct
    for _ in range(_SUFFIX_PASSES):
        prev = out
        out = _SUFFIX_RE.sub("", out)
        if out == prev:
            break

    # Empty guard: "Inc." alone must not normalize to nothing.
    return out or punct


#: A bare exchange symbol. Measured shape of the cluster (ADP, GM, ONDS, FIS,
#: RELX, TSM, HIMS): 1-5 uppercase letters, optionally a share-class suffix.
#: Tested against the RAW string, before lowercasing, because the all-caps form
#: is most of the signal. A lowercase word like "arm" is not a ticker claim.
_TICKER_RE = re.compile(r"^[A-Z]{1,5}(\.[A-Z])?$")


def looks_like_ticker(s: str) -> bool:
    """True when `s` is shaped like a bare exchange symbol rather than a name.

    Shape only. It says nothing about whether the symbol resolves; the caller
    still requires a unique hit against companies.ticker, so ETFs (SPY, QQQ)
    and typos (APPL) match this predicate and then resolve to nothing.
    """
    return bool(_TICKER_RE.match((s or "").strip()))
