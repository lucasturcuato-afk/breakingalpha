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

This module therefore defines a SEPARATE key that IS NEVER STORED. It never
becomes an aliases.lookup_key, so the 6,237 alias rows keyed on v1 keep
resolving exactly as they do today. That is the invariant, and it still holds.

WHAT CHANGED, DELIBERATELY. The original wording here also said this module
"never reaches resolve_entity". It does now. `resolve_entity` used to have
exactly one lookup surface, aliases.lookup_key equality, and minted a new
company on the first miss; measured on a 300-name sample, 93.7% minted.
`resolve_against_index` below is the shared read ladder the resolver now
consults BEFORE minting. The v2 key is used to FIND an existing canonical row.
The key WRITTEN to aliases.lookup_key is still v1, from
`normalize.normalize_lookup_key`. Read key and write key stay separate, which
is the part that was actually load-bearing.

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


# ---------------------------------------------------------------------------
# The ambiguity guard, and the narrow case where it ELECTS instead of refusing
# ---------------------------------------------------------------------------
#: Suffix tokens from BASE_SUFFIXES that can DISTINGUISH two real companies
#: rather than merely naming a legal form.
#:
#: This split exists because of a measured false fold. The `eqt` normalized
#: bucket holds three prod rows: 'EQT' [EQT, cik 33213], which is EQT
#: Corporation the US natural-gas producer, plus 'EQT Holdings' and 'EQT
#: Holdings Ltd.', which are EQT Holdings Limited, the Australian company
#: formerly named Equity Trustees. Those are two different companies. Only the
#: first carries identifiers, so a rule that elects on carrier count alone
#: elects EQT Corporation for an EQT Holdings string. That is the
#: "filled-and-wrong" outcome, which is worse than resolving to nothing.
#:
#: "inc" / "corp" / "ltd" and friends never distinguish: 'ONEOK', 'ONEOK Inc'
#: and 'ONEOK, Inc.' are one company written three ways. "holdings" and "group"
#: sometimes do. So election requires that every row in the bucket agree once
#: ONLY the pure legal-form tokens are stripped.
#:
#: Measured over prod on 2026-08-31 (5,610 companies rows, 828 ambiguous
#: normalized buckets): carrier counting alone elects in 502 buckets; adding
#: this condition elects in 446 and refuses 56, EQT among them.
ENTITY_DISTINGUISHING_SUFFIXES = ("holdings", "group")

#: BASE + EXTRA minus the distinguishing tokens. Every token left names a legal
#: form and nothing else.
LEGAL_FORM_SUFFIXES = tuple(
    t for t in BASE_SUFFIXES if t not in ENTITY_DISTINGUISHING_SUFFIXES
) + EXTRA_SUFFIXES

_LEGAL_FORM_RE = re.compile(
    r"\s+(" + "|".join(LEGAL_FORM_SUFFIXES) + r")$"
)


def legal_form_key(s: str) -> str:
    """normalize_company_key, but stripping ONLY pure legal-form suffixes.

    Strictly less aggressive than normalize_company_key: it leaves "holdings"
    and "group" in place. Two names with the same normalize_company_key but
    DIFFERENT legal_form_key differ by a word that can name a different
    company. READ-ONLY, same contract as the rest of this module.
    """
    base = normalize_lookup_key(s or "")
    punct = _PUNCT_TO_DELETE_RE.sub("", base)
    punct = _PUNCT_TO_SPACE_RE.sub(" ", punct)
    punct = re.sub(r"\s+", " ", punct).strip()

    out = punct
    for _ in range(_SUFFIX_PASSES):
        prev = out
        out = _LEGAL_FORM_RE.sub("", out)
        if out == prev:
            break
    return out or punct


def carries_identifier(row) -> bool:
    """True when the row carries an exchange ticker or an SEC CIK.

    Identifiers are the only evidence in this table that a row is the indexed,
    resolvable instance of a company rather than a bare duplicate minted from a
    surface form. 39.9% of companies rows sit in an ambiguous normalized
    bucket; identifier-bearing rows are the anchors inside them.
    """
    if not row:
        return False
    return bool((row.get("ticker") or "").strip()) or row.get("sec_cik") is not None


def elect_canonical_id(row_by_id, ids):
    """THE ONE DEFINITION of the ambiguity guard. Returns a canonical id or None.

    `row_by_id` maps canonical id -> {"name", "ticker", "sec_cik",
    "mention_count"}. `ids` is a candidate set from any resolution surface.

    Unchanged from the original guard for the two easy cases: no candidates
    yields None, exactly one candidate yields it.

    THE CHANGE. The original guard refused every set larger than one, and that
    refusal SELF-DEFEATS on the case it most needs to handle. All ten indexed
    ONEOK surface forms normalize to `oneok`; the bucket holds three ids, so
    the guard refused, the token fold was then guarded off the same refusal and
    returned nothing, and the name minted a FOURTH ONEOK row. The mechanism
    meant to prevent the split was driving it.

    Two conditions, both required, or it still refuses:

      1. IDENTITY IS NOT IN CONFLICT. Either exactly one row in the bucket
         carries identifiers, or every carrier agrees on ticker and on CIK.
         Two carriers that DISAGREE are two companies and the guard refuses:
         the `hp` bucket holds 'HP Inc' [HPQ, cik 47217] and 'HP Inc.'
         [HP, cik 46765], the second carrying Helmerich and Payne's identifiers,
         and nothing here can say which one an article meant.

      2. THE NAMES DIFFER BY LEGAL FORM ALONE. See
         ENTITY_DISTINGUISHING_SUFFIXES. This is the condition that refuses
         EQT, where carrier counting alone would have elected.

    The winner is the highest-mention_count carrier, ties broken on id so the
    result is deterministic across processes rather than set-iteration order.

    NOTE what this does NOT do. It never merges rows and never writes. It
    chooses which existing row a name resolves TO. The duplicates stay until a
    repointing migration a human applies.
    """
    ids = list(ids or [])
    if not ids:
        return None
    if len(ids) == 1:
        return ids[0]

    rows = [row_by_id.get(i) for i in ids]
    if any(r is None for r in rows):
        # A candidate we have no row for. Fail closed rather than electing on a
        # partial view of the bucket.
        return None

    carriers = [(i, r) for i, r in zip(ids, rows) if carries_identifier(r)]
    if not carriers:
        return None

    tickers = {(r.get("ticker") or "").strip().upper()
               for _, r in carriers if (r.get("ticker") or "").strip()}
    ciks = {r["sec_cik"] for _, r in carriers if r.get("sec_cik") is not None}
    if len(tickers) > 1 or len(ciks) > 1:
        return None

    if len({legal_form_key(r.get("name") or "") for r in rows}) != 1:
        return None

    return max(carriers, key=lambda pair: ((pair[1].get("mention_count") or 0), pair[0]))[0]


def resolve_against_index(idx, name):
    """The INDEX half of the resolution ladder. Returns a canonical id or None.

    THE ONE IMPLEMENTATION of resolution surfaces 3-6, shared by every caller
    that resolves a company name against the entity index:

        backend/entity_ladder.resolve_to_canonical_id   the ingest WRITE path,
                                                        via entity_resolver
        backend/ingest._resolve_primary_to_canonical    the article tagging fold
        tools/primary_fold_eval.resolve_after           what backfill --apply writes
        tools/wikidata_gate_recovery.resolve_widened    how the recovery is sized

    Surfaces 1-2 (exact and case-insensitive companies.name) stay with the
    callers, because the pipeline callers run them as LIVE queries so a company
    minted earlier in the same run is still visible.

      3. aliases.lookup_key   the project's own stored resolution surface
      4. companies.ticker     bare symbols, guarded by looks_like_ticker
      5. normalized key       suffix and punctuation folding
      6. leading-token fold   guarded by guarded_fold_candidates

    ORDER. Surfaces 3-4 come before 5-6 because an exact stored key is a
    stronger identity claim than a suffix-folded one. This matters: 'EQT
    Holdings' has its own indexed row, so putting the normalized surface ahead
    of the exact ones would fold it into EQT Corporation. Reordering here is
    not free, and the ONEOK forms do not need it.

    `idx` needs: by_alias (key -> ids), by_ticker, by_norm, by_name_tokens,
    by_token_prefix, row_by_id. READ-ONLY: writes nothing.
    """
    def elect(ids):
        return elect_canonical_id(idx["row_by_id"], ids)

    cid = elect(idx["by_alias"].get(normalize_lookup_key(name)))
    if cid:
        return cid

    if looks_like_ticker(name):
        cid = elect(idx["by_ticker"].get(name.strip().upper()))
        if cid:
            return cid

    norm_ids = idx["by_norm"].get(normalize_company_key(name))
    cid = elect(norm_ids)
    if cid:
        return cid

    # SURFACE 6 KEEPS THE STRICT GUARD. This is measured, not cautious by
    # temperament.
    #
    # Election is safe on surfaces 3-5 because the query MATCHES THE BUCKET'S
    # KEY: every row under `oneok` and the string 'ONEOK Incorporated' are the
    # same normalized name, so the only open question is which of several rows
    # for one company to pick, and the two conditions answer it.
    #
    # Surface 6 is a different claim. The query only shares a LEADING STEM with
    # the candidates, so a consistent bucket does not mean the query belongs to
    # it. Measured over 2,000 recent article rows, electing here produced:
    #     'Science Applications International Corp'
    #         -> 'Science Corp.', a row carrying GILEAD's ticker
    #     'National Healthcare Properties, Inc.'
    #         -> 'NATIONAL HEALTHCARE CORP' [NHC], a different company
    # It also produced three correct folds ('Cheniere' -> Cheniere Energy,
    # 'Hyatt' -> Hyatt Hotels, 'Patterson-UTI' -> Patterson-UTI Energy). Three
    # right for two wrong is not a trade worth taking when the wrong ones fill a
    # company page with another company's filings. Filled-and-wrong is worse
    # than empty, so surface 6 still requires exactly one candidate.
    fold_ids = guarded_fold_candidates(norm_ids, token_fold_candidates(
        idx["by_name_tokens"], idx["by_token_prefix"], name))
    fold_ids = list(fold_ids or [])
    return fold_ids[0] if len(fold_ids) == 1 else None
