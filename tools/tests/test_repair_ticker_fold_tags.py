"""The ticker-fold repair removes surface-4 artifacts and NOTHING else.

Four properties are load-bearing and none is obvious from reading the code:

  1. A fold a NAME surface can reproduce is never touched. 'HP' resolves to
     'HP Inc' through the ALIAS surface: prod holds an aliases row with
     lookup_key 'hp' pointing at that company. It is specifically NOT the
     normalize surface, which sees three rows sharing the key 'hp' ('HP Inc',
     'HP Inc.', 'HP, Inc.') and refuses on ambiguity. That distinction is the
     whole test below. Measured on prod 2026-09-02: 'HP Inc' carries 187
     articles and 124 of the backfill ledger's folds. A repair that mistook it
     for a ticker fold would strip a correct 187-article pool. This is THE
     over-reach guard.

  2. A fold whose row still holds the ticker is never touched. HPQ -> 'HP Inc'
     was right when it was written and is still right.

  3. A name that is not a companies row at all is never touched. Those are the
     25,554 extractor orphans sql/0035 section 4b describes: a different defect
     with no fix here.

  4. Removal requires an EXACT primary_company match. 'ARK Invest' is a
     legitimate extractor mention on articles whose primary_company is COIN,
     PYPL, OKLO or TSMC, and a ticker-fold artifact on the two whose
     primary_company is PNNT. The first four must survive and the last two must
     go, from the same name, in the same run.

All four are asserted here rather than left to inspection, because "it only
touches ticker folds" is exactly the kind of claim that stays true until
someone adds a convenience flag.

The module imports with no credentials and no network by design: the Supabase
client is built inside _client(), which these tests never call.
"""
import re
import os
import sys
from collections import Counter

_HERE = os.path.dirname(os.path.abspath(__file__))
_TOOLS = os.path.dirname(_HERE)
_ROOT = os.path.dirname(_TOOLS)
for _p in (_TOOLS, os.path.join(_ROOT, "backend")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import repair_ticker_fold_tags as MOD  # noqa: E402


# ---------------------------------------------------------------------------
# Fixtures. Every row is a real value measured on prod 2026-09-02.
# ---------------------------------------------------------------------------
COMPANIES = [
    # The contaminated rows: identifier cleared, so ticker is NULL today.
    {"id": "c-revolut", "name": "Revolut", "ticker": None},
    {"id": "c-ely", "name": "Ely", "ticker": None},
    {"id": "c-ark", "name": "ARK Invest", "ticker": None},
    {"id": "c-vanguard", "name": "Vanguard", "ticker": None},
    # THE OVER-REACH TRAP, reproduced exactly as prod holds it. Three rows
    # normalize to the same key 'hp', so normalize_company_key is AMBIGUOUS and
    # surface 5 refuses. Only the alias row below resolves 'HP', and it resolves
    # it to the one row that carries the ticker. A guard that only checked the
    # normalize surface would see None here and wrongly conclude the fold was
    # ticker-driven.
    {"id": "c-hp-inc", "name": "HP Inc", "ticker": "HPQ"},
    {"id": "c-hp-dot", "name": "HP Inc.", "ticker": None},
    {"id": "c-hp-comma", "name": "HP, Inc.", "ticker": None},
    # Legitimate co-mention subjects.
    {"id": "c-coin", "name": "COIN", "ticker": "COIN"},
    {"id": "c-paypal", "name": "PayPal", "ticker": "PYPL"},
    {"id": "c-oklo", "name": "Oklo", "ticker": "OKLO"},
    # A ticker whose true owner is alive, so a swap target exists.
    {"id": "c-baxter", "name": "BAXTER INTERNATIONAL", "ticker": "BAX"},
    {"id": "c-axt", "name": "AXT Inc.", "ticker": None},
]
#: The real prod alias row, verbatim: lookup_key 'hp' -> the HPQ row.
ALIASES = [{"lookup_key": "hp", "canonical_id": "c-hp-inc"}]


def _idx(with_ticker):
    return MOD.build_index(COMPANIES, ALIASES, with_ticker=with_ticker)


def _ticker_of_name():
    out = {}
    for r in COMPANIES:
        out.setdefault(r["name"], (r.get("ticker") or "").strip().upper() or None)
    return out


def _classify(attested):
    return MOD.classify_pairs(Counter(attested), _ticker_of_name(), _idx(False))


# ---------------------------------------------------------------------------
# Property 1: the name-surface guard. THE over-reach test.
# ---------------------------------------------------------------------------
def test_name_driven_fold_is_spared():
    """'HP' -> 'HP Inc' is reachable without the ticker surface, so it stays.

    If this test fails, the repair is about to strip a correct 187-article
    pool off a real company page.
    """
    contaminated, kept = _classify({("HP", "HP Inc"): 103})
    assert ("HP", "HP Inc") not in contaminated
    assert MOD.KEEP_NAME_SURFACE in kept[("HP", "HP Inc")][1]


def test_name_surface_guard_fires_without_the_ticker_index():
    """The guard must not depend on the ticker surface it is guarding against.

    Asked WITH the ticker index, 'HP' could resolve through some other row.
    Asked WITHOUT it, the only path left is the name surfaces, which is the
    question the guard actually needs answered.
    """
    assert MOD.resolve(_idx(False), "HP", use_ticker=False) == "HP Inc"


def test_the_guard_survives_an_ambiguous_normalize_surface():
    """It resolves through the ALIAS surface, not the normalize surface.

    Three rows share the normalized key 'hp', so surface 5 sees a set of three
    and refuses. If the guard were written against by_norm alone it would read
    that refusal as "no name surface reaches it" and mark a correct 187-article
    fold contaminated. Surface 3 is what actually answers.
    """
    from company_match import normalize_company_key
    idx = _idx(False)
    assert len(idx["by_norm"][normalize_company_key("HP")]) == 3
    assert MOD._unique(idx, idx["by_norm"][normalize_company_key("HP")]) is None
    assert MOD.resolve(idx, "HP", use_ticker=False) == "HP Inc"


# ---------------------------------------------------------------------------
# Property 2: a still-valid ticker fold is spared.
# ---------------------------------------------------------------------------
def test_fold_whose_row_still_holds_the_ticker_is_spared():
    contaminated, kept = _classify({("HPQ", "HP Inc"): 21})
    assert ("HPQ", "HP Inc") not in contaminated
    assert MOD.KEEP_ROW_HOLDS_TICKER in kept[("HPQ", "HP Inc")][1]


# ---------------------------------------------------------------------------
# Property 3: extractor orphans are not this tool's business.
# ---------------------------------------------------------------------------
def test_name_absent_from_companies_is_spared():
    contaminated, kept = _classify({("TSLA", "NVIDIA"): 9})
    assert ("TSLA", "NVIDIA") not in contaminated
    assert MOD.KEEP_NOT_A_COMPANY in kept[("TSLA", "NVIDIA")][1]


# ---------------------------------------------------------------------------
# The pairs that SHOULD be caught.
# ---------------------------------------------------------------------------
def test_genuine_ticker_fold_artifacts_are_flagged():
    contaminated, kept = _classify({
        ("RVMD", "Revolut"): 43,
        ("ARDX", "Ely"): 21,
        ("PNNT", "ARK Invest"): 2,
        ("AVD", "Vanguard"): 3,
        ("BAX", "AXT Inc."): 14,
    })
    assert set(contaminated) == {("RVMD", "Revolut"), ("ARDX", "Ely"),
                                 ("PNNT", "ARK Invest"), ("AVD", "Vanguard"),
                                 ("BAX", "AXT Inc.")}
    assert kept == {}


def test_the_two_hp_pools_and_the_three_traps_survive_together():
    """The real mix: correct folds and contaminated ones classified in one pass."""
    contaminated, kept = _classify({
        ("HP", "HP Inc"): 103,      # name-driven, spared
        ("HPQ", "HP Inc"): 21,      # still valid, spared
        ("TSLA", "NVIDIA"): 9,      # orphan, spared
        ("RVMD", "Revolut"): 43,    # contaminated
        ("PNNT", "ARK Invest"): 2,  # contaminated
    })
    assert set(contaminated) == {("RVMD", "Revolut"), ("PNNT", "ARK Invest")}
    assert set(kept) == {("HP", "HP Inc"), ("HPQ", "HP Inc"), ("TSLA", "NVIDIA")}


# ---------------------------------------------------------------------------
# Property 4: removal requires an exact primary_company match.
# ---------------------------------------------------------------------------
ARK_ARTICLES = [
    {"id": "a1", "primary_company": "COIN", "companies": ["COIN", "ARK Invest"]},
    {"id": "a2", "primary_company": "PYPL", "companies": ["ARK Invest", "Stripe", "PayPal"]},
    {"id": "a3", "primary_company": "OKLO", "companies": ["OKLO", "ARK Invest"]},
    {"id": "a4", "primary_company": "TSMC", "companies": ["TSMC", "ARK Invest"]},
    {"id": "a5", "primary_company": "PNNT", "companies": ["ARK Invest"]},
    {"id": "a6", "primary_company": "PNNT", "companies": ["ARK Invest"]},
]


def test_same_name_is_removed_only_where_the_ticker_matches():
    changes = MOD.plan(ARK_ARTICLES, {("PNNT", "ARK Invest"): 2})
    assert sorted(c["id"] for c in changes) == ["a5", "a6"]
    assert all(c["after"] == [] for c in changes)


def test_untouched_articles_are_never_rewritten():
    """An article with no contaminated pair produces no change at all, so its
    row is never written and its companies[] cannot drift."""
    changes = MOD.plan(ARK_ARTICLES[:4], {("PNNT", "ARK Invest"): 2})
    assert changes == []


def test_a_name_driven_pool_is_untouched_end_to_end():
    """'HP Inc.' (ticker NULL, 104 articles) has no ledger fold at all, and
    'HP Inc' (ticker HPQ) has only spared ones. Neither pool moves."""
    contaminated, _ = _classify({("HP", "HP Inc"): 103, ("HPQ", "HP Inc"): 21})
    arts = [
        {"id": "h1", "primary_company": "HP", "companies": ["HP Inc"]},
        {"id": "h2", "primary_company": "HPQ", "companies": ["HP Inc"]},
        {"id": "h3", "primary_company": "HPQ", "companies": ["HP Inc.", "HP Inc"]},
    ]
    assert MOD.plan(arts, contaminated) == []


# ---------------------------------------------------------------------------
# Shape and non-widening.
# ---------------------------------------------------------------------------
def test_plan_preserves_order_and_never_appends():
    arts = [{"id": "x", "primary_company": "RVMD",
             "companies": ["RBC Capital", "Revolut", "Citigroup"]}]
    changes = MOD.plan(arts, {("RVMD", "Revolut"): 43})
    assert changes[0]["after"] == ["RBC Capital", "Citigroup"]
    assert len(changes[0]["after"]) < len(changes[0]["before"])
    assert set(changes[0]["after"]).issubset(set(changes[0]["before"]))


def test_plan_ignores_articles_whose_primary_is_not_a_bare_ticker():
    """A name-shaped primary_company can never drive a ticker-fold removal,
    even if some pair key happened to collide with it."""
    arts = [{"id": "n", "primary_company": "Revolution Medicines",
             "companies": ["Revolut"]}]
    assert MOD.plan(arts, {("Revolution Medicines", "Revolut"): 1}) == []


def test_ticker_shape_is_company_match_s_own_predicate():
    """The server-side regex and the Python guard must agree, or the scan and
    the plan disagree about what a ticker is."""
    import re
    server = re.compile(r"^[A-Z]{1,5}(\.[A-Z])?$")
    for s in ["RVMD", "HP", "A", "ABCDE", "BRK.B", "abcd", "ABCDEF", "AB-C",
              "Revolut", "", "HP Inc", "COIN"]:
        assert MOD.TICKER_SHAPE(s) == bool(server.match(s)), s


def test_no_flag_widens_the_contaminated_set():
    """The pair set comes from the backfill ledger, filtered by three refusals.

    No argument may let an operator add to it. --limit and --resume can only
    ever plan LESS work, never different work, so the accepted flag set is
    pinned here: adding one is a deliberate act that has to update this test.
    """
    src = open(os.path.join(_TOOLS, "repair_ticker_fold_tags.py")).read()
    flags = set(re.findall(r'ap\.add_argument\("(--[a-z-]+)"', src))
    assert flags == {"--apply", "--batch", "--limit", "--resume", "--json"}, flags


def test_attested_pairs_come_only_from_bare_ticker_ledger_rows():
    rows = [
        {"primary_company": "RVMD", "resolved_name": "Revolut"},
        {"primary_company": "Fidelity National Information Services Inc",
         "resolved_name": "Fidelity"},
        {"primary_company": "HP", "resolved_name": "HP Inc"},
        {"primary_company": None, "resolved_name": "Revolut"},
    ]
    att = MOD.attested_ticker_folds(rows)
    assert set(att) == {("RVMD", "Revolut"), ("HP", "HP Inc")}


def test_correct_co_mentions_are_never_planned():
    """The rejected "any foreign bare ticker" rule, held out as a test.

    Every pair below is a real prod co-mention where the tagged company IS
    genuinely in the article: 'Pratt & Whitney' is an RTX subsidiary, AMD
    articles discuss Nvidia. They satisfy every symptom of a cross-wire except
    the one that matters, a ledger row attesting that the fold wrote them.
    Measured 2026-09-02: the symptom-only rule reaches 1,893 tags against this
    tool's 465, and the 1,428-tag difference is mostly these.
    """
    arts = [
        {"id": "m1", "primary_company": "AMD", "companies": ["AMD", "Nvidia"]},
        {"id": "m2", "primary_company": "RTX", "companies": ["Raytheon", "Pratt & Whitney"]},
        {"id": "m3", "primary_company": "UPS", "companies": ["UPS", "Amazon"]},
        {"id": "m4", "primary_company": "BYD", "companies": ["BYD", "Tesla"]},
    ]
    contaminated, _ = _classify({("RVMD", "Revolut"): 43})
    assert MOD.plan(arts, contaminated) == []


def test_resume_skips_pairs_already_in_the_ledger():
    changes = MOD.plan(ARK_ARTICLES, {("PNNT", "ARK Invest"): 2},
                       done={("a5", "ARK Invest")})
    assert [c["id"] for c in changes] == ["a6"]
