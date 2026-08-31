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


# ---------------------------------------------------------------------------
# Token-relationship folding (the "already indexed under a different surface
# form" surface)
# ---------------------------------------------------------------------------
# WHY THIS EXISTS
#
# normalize_company_key folds punctuation and TRAILING LEGAL SUFFIXES. It
# cannot bridge a relationship where the extra token is a real word:
#
#     "Truist Financial"        vs indexed "Truist"          [TFC, cik 92230]
#     "Sterling Infrastructure" vs indexed "Sterling"        [STRL, cik 874238]
#     "Rivian Automotive"       vs indexed "Rivian"          [RIVN, 281 mentions]
#     "Klaviyo"                 vs indexed "Klaviyo Inc-A"   [KVYO]
#
# "financial", "infrastructure", "automotive" are not legal suffixes, so the v2
# key of the two sides differs and the fold misses a company the index already
# holds. Measured over the 2026-07-14..2026-08-19 ingest window, that class is
# the single largest remaining matching failure.
#
# STRICTLY READ-ONLY, same contract as the rest of this module. The output is
# only ever used to decide which ALREADY-INDEXED company a string denotes. It
# never becomes a stored key and never reaches entity_resolver.resolve_entity,
# so it can never mint a company row or write an alias.
#
# PRECISION IS THE WHOLE PROBLEM. Widening a prefix relationship is dangerous on
# short or generic stems ("Crown Castle" is not "Crown Holdings"). Every guard
# below was added because it removed a MEASURED false match, and the caller is
# still required to fail closed on ambiguity exactly as it already does for the
# normalized surface.

#: Cap on how many tokens the two sides may differ by. Measured: raising this
#: past 2 adds no correct match and lets long descriptive strings reach a short
#: stem.
TOKEN_FOLD_MAX_EXTRA_TOKENS = 2

#: A stem shorter than this is not a company name, it is a fragment. Counted
#: over the joined stem with spaces removed.
TOKEN_FOLD_MIN_STEM_CHARS = 4

#: How many DISTINCT indexed companies may sit under a stem before the stem is
#: treated as a family prefix rather than a company.
#:
#: This is the structural half of the precision guard, and it generalizes the
#: hand-written denylist below: "american" leads 22 distinct indexed companies
#: (American Airlines, American Battery Technology, American Rebel Holdings...),
#: so "American Integrity Insurance" must not fold onto the fragment row named
#: "American" [AXP]. "truist" leads exactly one.
#:
#: NOT 1. Measured: the index carries duplicate rows for the same company
#: ("Teva" / "Teva Pharma" / "Teva Pharms. Int'l GMBH" are three rows and one
#: company), so a threshold of 1 refuses folds that are correct and refuses them
#: for a reason that is an index defect, not an ambiguity. 3 is the measured
#: knee: it admits the duplicate clusters and refuses the family prefixes.
TOKEN_FOLD_MAX_STEM_CLOSURE = 3

#: First tokens too generic to fold onto.
#:
#: The first block is imported verbatim from finnhub_helper._AMBIGUOUS_FIRST_TOKENS,
#: which exists for the identical failure mode on the Finnhub side (its comment
#: names "Apple Bank, Apple Hospitality" explicitly). Duplicated as literals
#: rather than imported so this module stays free of the finnhub client and its
#: network config; if you change one, change both.
#:
#: The second block was MEASURED on the development slice of the ingest window
#: (2026-07-14 to 2026-08-05). Every token is there because it produced a false
#: fold on that slice, with the observed pair recorded next to it. They are all
#: common English words that survive as a one-token stem only because
#: normalize_company_key stripped a legal suffix off the indexed row
#: ("Crown Holdings" -> "crown").
_FINNHUB_AMBIGUOUS_FIRST_TOKENS = frozenset({
    "apple", "google", "meta", "amazon", "microsoft", "tesla", "twitter", "apollo",
    "capital", "group", "bank", "holdings", "partners", "asset", "investments",
    "securities", "financial", "global", "international", "strategic", "ventures",
    "fund", "trust", "corp",
})

_MEASURED_AMBIGUOUS_STEMS = frozenset({
    "china",       # "China Resources Land", "China BAK Battery" -> "China"
    "crown",       # "Crown Castle" -> "Crown Holdings"
    "spirit",      # "Spirit Realty" -> "Spirit" [SPR = Spirit AeroSystems]
    "beyond",      # "Beyond Meat" -> "Beyond" [FBYD]
    "universal",   # "Universal Health Services" -> "Universal"
    "alliance",    # "Alliance Laundry" -> "Alliance" [YMM = Full Truck Alliance]
    "vanguard",    # "Vanguard Natural Resources" -> "Vanguard" [AVD = American Vanguard]
    "natural",     # "Natural" -> "Natural Fiber Welding"
    "team",        # "Team Inc." [TISI] -> "Team Recovery Technologies"
    "eastern",     # "Eastern Company" -> "EASTERN BANK"
    "waters",      # "Waters" [WAT] -> "Waters Parkerson"
    "campbell",    # "Campbell" [CPB] -> "Campbell Lutyens"
    "lotus",       # "Lotus" -> "Lotus Seven"
    "cornell",     # "Cornell" -> "Cornell Capital"
    "monogram",    # "Monogram" [MGRM] -> "Monogram Capital Partners"
    "nissan",      # "Nissan" -> "Nissan Chemical Corporation"
    "eaton",       # "Eaton" [ETN] -> "Eaton Vance"
    "evolution",   # "Evolution AB" -> "Evolution Equity Partners"
    "lion",        # "Lion" -> "Lion Finance Group"
    "chesapeake",  # "Chesapeake" -> "Chesapeake Utilities" (the referent is CHK)
    "blackline",   # "BlackLine" [BL] -> "Blackline Safety Corp"
    "american",    # "American Integrity Insurance" -> "American" [AXP]
    "westinghouse",  # "Westinghouse" -> "Westinghouse Air" (Wabtec, not Electric)
    "super",       # "Super Group" [SGHC] -> "Super Micro Computer" [SMCI]
    "energy",      # "Energy Corp" -> "Energy Capital"
})

AMBIGUOUS_STEM_TOKENS = _FINNHUB_AMBIGUOUS_FIRST_TOKENS | _MEASURED_AMBIGUOUS_STEMS


def company_key_tokens(s: str) -> tuple:
    """The v2 comparison key as a token tuple. READ-ONLY, see module docstring."""
    key = normalize_company_key(s or "")
    return tuple(key.split()) if key else ()


def stem_is_foldable(stem) -> bool:
    """Is `stem` specific enough that a longer name starting with it is the
    same company? Fail closed: anything short, generic, or empty is refused."""
    if not stem:
        return False
    if len("".join(stem)) < TOKEN_FOLD_MIN_STEM_CHARS:
        return False
    return stem[0] not in AMBIGUOUS_STEM_TOKENS


def leading_stems(tokens):
    """Every proper leading token-prefix of `tokens`, LONGEST FIRST, that is
    within TOKEN_FOLD_MAX_EXTRA_TOKENS of the full tuple.

    Longest first is deliberate: "Kratos Defense & Security Solutions" must
    reach the indexed "Kratos Defense" before it reaches a bare "Kratos".
    """
    n = len(tokens)
    lo = max(1, n - TOKEN_FOLD_MAX_EXTRA_TOKENS)
    for i in range(n - 1, lo - 1, -1):
        yield tokens[:i]


def index_tokens(by_name_tokens: dict, by_token_prefix: dict, tokens, cid, from_name: bool) -> None:
    """Record one indexed surface in the two maps token_fold_candidates reads.

    by_name_tokens   full token tuple -> ids, from companies.name ONLY. The stem
                     side of the fold is name-only on purpose: the measured
                     false folds "Atlas Energy Solutions" -> Atlassian and
                     "Rocket Seals" -> Rocket Lab both came from a ONE-TOKEN
                     ALIAS key, a much weaker identity claim than a company
                     row's own name.
    by_token_prefix  every proper leading prefix -> {(full_len, id)}, from names
                     AND alias keys. The other direction: the article says
                     "Klaviyo", the index holds "Klaviyo Inc-A".
    """
    if not tokens:
        return
    if from_name:
        by_name_tokens.setdefault(tokens, set()).add(cid)
    n = len(tokens)
    # EVERY proper prefix, not only the ones within TOKEN_FOLD_MAX_EXTRA_TOKENS.
    # The delta filter belongs to direction B, which applies it at lookup time.
    # The full set is what makes the stem-closure guard able to see that
    # "american" leads 22 companies.
    for i in range(1, n):
        by_token_prefix.setdefault(tokens[:i], set()).add((n, cid))


def token_fold_candidates(by_name_tokens: dict, by_token_prefix: dict, name: str) -> set:
    """Companies `name` could denote through a leading-token relationship.

    Two directions, tried in this order, first non-empty wins:

      A. an indexed company NAME is a strict leading prefix of `name`
         "Truist Financial" -> "Truist", "Rivian Automotive" -> "Rivian"
         Longest stem first, so "Kratos Defense & Security Solutions" reaches
         "Kratos Defense" and not a bare "Kratos".

      B. `name` is a strict leading prefix of an indexed name or alias key
         "Klaviyo" -> "Klaviyo Inc-A", "Eos Energy" -> "Eos Energy Enterprises"

    Returns a SET, deliberately. The caller must run it through its own
    uniqueness guard, so two companies behind one relationship refuse the fold
    exactly like every other surface. READ-ONLY: writes nothing.
    """
    tokens = company_key_tokens(name)
    if not tokens:
        return set()

    for stem in leading_stems(tokens):
        if not stem_is_foldable(stem):
            continue
        ids = by_name_tokens.get(stem)
        if not ids:
            continue
        closure = set(ids) | {cid for _, cid in by_token_prefix.get(stem, ())}
        if len(closure) > TOKEN_FOLD_MAX_STEM_CLOSURE:
            # A family prefix, not a company. Fail closed rather than trying a
            # SHORTER stem: shorter is strictly more generic, so a fallback here
            # could only be worse.
            return set()
        return set(ids)

    if not stem_is_foldable(tokens):
        return set()
    longer = {(full_len, cid) for full_len, cid in by_token_prefix.get(tokens, ())
              if full_len - len(tokens) <= TOKEN_FOLD_MAX_EXTRA_TOKENS}
    if not longer:
        return set()
    # Only the CLOSEST superset counts. If the index holds both "Acme Foods" and
    # "Acme Foods Holdings International", widening to both manufactures an
    # ambiguity that refuses a fold the shorter one would have earned alone.
    best = min(full_len for full_len, _ in longer)
    return {cid for full_len, cid in longer if full_len == best}


def guarded_fold_candidates(norm_ids, fold_ids) -> set:
    """Surface 6's candidate set, after the surface-5 ambiguity guard.

    THE ONE DEFINITION OF THE GUARD. Three call sites resolve a
    primary_company: `ingest._resolve_primary_to_canonical`, which the live
    pipeline runs; `tools/primary_fold_eval.resolve_after`, which decides what
    `tools/backfill_primary_fold.py --apply` WRITES; and
    `tools/wikidata_gate_recovery.resolve_widened`, which sizes the recovery.
    They diverged once already, so the rule lives here and all three call it.

    `norm_ids` is surface 5's candidate set, `fold_ids` surface 6's. Callers
    apply their own uniqueness guard to the return value, exactly as they do to
    a bare `token_fold_candidates` result.

    THE PROBLEM. A uniqueness guard yields None for an EMPTY candidate set and
    for an AMBIGUOUS one alike, so `surface_5_result is None` cannot tell
    "surface 5 found nothing" from "surface 5 refused to choose". Chaining
    surface 6 off that None let a weaker relationship pick a company a stronger
    surface had already declined to pick between. Measured false folds:
        'Southern Co.'          -> 'Southern Tooling, Inc.'
        'DOMINOS PIZZA INC'     -> "Domino's Pizza China"
        "Domino's Pizza Group"  -> "Domino's Pizza China"
        'Aecon'                 -> 'Aecon Utilities'

    THE RULE. On a surface-5 refusal, surface 6 may CONFIRM but never OVERRULE:
    its candidates are accepted only when they are a subset of the set surface 5
    already had. The fold then only narrows an ambiguity, and cannot reach
    outside it for a company surface 5 never considered.

    Measured over all 196,056 article rows (2026-08-31, 164,891 with a
    non-empty primary_company) against the blunter alternative of refusing the
    fold outright on any non-empty `norm_ids`:
      - identical on all four false folds above, and on 7 more strings the
        blunt rule also refuses ('Bain & Company' -> 'Bain Capital',
        'NEXTERA ENERGY INC' -> 'NextEra Energy Partners', both Lucid strings,
        both Pershing Square strings, 'Fervo Energy Co')
      - recovers 87 rows over 3 strings the blunt rule refuses, all correct:
        'Spotify Technology' -> 'Spotify' (83 rows),
        'Exxon Mobil Corp.' -> 'Exxon' (3), 'LIONSGATE STUDIOS CORP' ->
        'Lionsgate' (1)
      - adds zero wrong answers: every string on which the two differ resolves
        correctly under this rule.
    """
    if not norm_ids:
        # Surface 5 genuinely found nothing. The fold runs free, as before.
        return fold_ids
    if fold_ids and set(fold_ids) <= set(norm_ids):
        return fold_ids
    return set()
