"""Unit tests for the leading-token fold, resolution surface 6.

WHY THIS SURFACE EXISTS. Measured over the 2026-07-14 to 2026-08-19 ingest
window, the largest remaining matching failure is a company the index ALREADY
HOLDS under a shorter or longer surface form, where the difference is a real
word rather than a legal suffix:

    "Truist Financial"        vs indexed "Truist"        [TFC, cik 92230]
    "Sterling Infrastructure" vs indexed "Sterling"      [STRL, cik 874238]
    "Rivian Automotive"       vs indexed "Rivian"        [RIVN]
    "Klaviyo"                 vs indexed "Klaviyo Inc-A" [KVYO]

normalize_company_key cannot bridge those, so the fold missed them and the
article never reached the company page.

WHY THE GUARDS ARE THE POINT. Prefix widening is dangerous. "Crown Castle" is
not "Crown Holdings" and "American Integrity Insurance" is not American Express.
Every guard below was added because it removed a MEASURED false fold, and the
tests pin the false folds as hard as they pin the true ones.

NO production Gemini or Supabase calls. The Supabase client is replaced with the
in-memory fake from test_primary_fold_resolution, which records any write.

Run:
    python -m unittest backend.tests.test_token_fold_resolution
"""

import os
import sys
import unittest
from unittest.mock import patch

for _k, _v in {
    "GEMINI_API_KEY": "dummy-gemini-key-not-used",
    "SUPABASE_URL": "http://localhost:54321",
    "SUPABASE_SERVICE_ROLE_KEY": "dummy-service-role-not-used",
    "SUPABASE_ANON_KEY": "dummy-anon-not-used",
    "NEWS_API_KEY": "dummy-news-key-not-used",
    "FINNHUB_API_KEY": "dummy-finnhub-key-not-used",
}.items():
    os.environ[_k] = _v

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
#: The parity test reads the two tools alongside ingest. They import
#: backend modules by bare name, so backend/ must already be on the path.
_REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(_REPO, "tools"))

import ingest  # noqa: E402
from company_match import (  # noqa: E402
    TOKEN_FOLD_MAX_EXTRA_TOKENS,
    TOKEN_FOLD_MAX_STEM_CLOSURE,
    company_key_tokens,
    guarded_fold_candidates,
    index_tokens,
    leading_stems,
    normalize_company_key,
    stem_is_foldable,
    token_fold_candidates,
)

from backend.tests.test_primary_fold_resolution import FakeSupabase  # noqa: E402


COMPANIES = [
    # Direction A: an indexed name is a leading prefix of the article's string.
    {"id": "t1", "name": "Truist", "ticker": "TFC"},
    {"id": "t2", "name": "Kratos Defense", "ticker": "KTOS"},
    # Direction B: the article's string is a leading prefix of an indexed name.
    {"id": "t3", "name": "Klaviyo Inc-A", "ticker": "KVYO"},
    # Direction B with two supersets at DIFFERENT distances: the closer one wins.
    {"id": "t4", "name": "Eos Energy Enterprises", "ticker": "EOSE"},
    {"id": "t5", "name": "Eos Energy Enterprises International", "ticker": None},
    # Direction B with two supersets at the SAME distance: ambiguous, refuse.
    {"id": "t6", "name": "Vertex Alpha", "ticker": None},
    {"id": "t7", "name": "Vertex Beta", "ticker": None},
    # A generic stem carrying a wrong identity. The row is real; folding a
    # longer, unrelated name onto it is the failure.
    {"id": "t8", "name": "Crown Holdings", "ticker": "CCK"},
    # A family prefix: many indexed companies start with "american", so the
    # fragment row named "American" must never absorb them.
    {"id": "t9", "name": "American", "ticker": "AXP"},
    {"id": "t10", "name": "American Airlines", "ticker": "AAL"},
    {"id": "t11", "name": "American Water Works", "ticker": "AWK"},
    {"id": "t12", "name": "American Battery Technology", "ticker": "ABAT"},
    # A duplicate cluster: three rows, one company. The closure guard must NOT
    # treat this as a family prefix, or it refuses a correct fold because of an
    # index defect.
    {"id": "t13", "name": "Teva", "ticker": "TEVA"},
    {"id": "t14", "name": "Teva Pharma", "ticker": None},
    {"id": "t15", "name": "Teva Pharms Intl GMBH", "ticker": None},
    # A two-character stem. Too short to fold onto whatever follows it.
    {"id": "t16", "name": "GE", "ticker": "GE"},
    # --- Step-5 REFUSAL fixtures (see TokenFoldStepFiveRefusalTest) ---
    # Two rows collapse to the single-token key "southern", so surface 5 is
    # AMBIGUOUS for anything keying to it. A third, unrelated row extends that
    # token, which is what direction B used to grab.
    {"id": "t19", "name": "Southern Co", "ticker": "SO"},
    {"id": "t20", "name": "Southern Company", "ticker": None},
    {"id": "t21", "name": "Southern Tooling Inc", "ticker": None},
    # The same shape with a TWO-token key, so the case is not only about
    # single-token queries: "dominos pizza" is ambiguous on surface 5, and
    # "Domino's Pizza China" is the unrelated extension.
    {"id": "t22", "name": "Domino's Pizza Inc", "ticker": "DPZ"},
    {"id": "t23", "name": "Domino's Pizza Corp", "ticker": None},
    {"id": "t24", "name": "Domino's Pizza China", "ticker": None},
    # --- CONFIRMATORY fixture (see TokenFoldStepFiveRefusalTest) ---
    # Verbatim shape of the prod rows for Spotify. The index holds the SAME
    # company twice, and an alias on the second row's spelled-out form keys to
    # the first, so surface 5 sees two ids for "spotify technology". They are
    # not two companies; they are one company and an index defect. The fold
    # narrows that pair to the canonical short row, which is INSIDE the pair,
    # so it disambiguates rather than overrules. 83 prod rows ride on this.
    {"id": "t25", "name": "Spotify", "ticker": "SPOT"},
    {"id": "t26", "name": "Spotify Technology SA", "ticker": None},
    # --- A bucket with NO ANCHOR (see TokenFoldStepFiveRefusalTest) ---
    # Verbatim shape of the prod 'Aecon' case. Two rows collapse to the key
    # "aecon" and NEITHER carries a ticker or a CIK, so the guard has nothing
    # to elect and still refuses. A third, unrelated row extends the token,
    # which is what direction B reaches for. This is the shape the Southern and
    # Domino's fixtures used to have before those two acquired an anchor; 325
    # of the 828 ambiguous prod buckets look like this, so it is the common
    # case, not a contrived one.
    {"id": "t27", "name": "Aecon", "ticker": None},
    {"id": "t28", "name": "Aecon Co", "ticker": None},
    {"id": "t29", "name": "Aecon Utilities", "ticker": None},
]

ALIASES = [
    # A one-token ALIAS key must not become a fold stem. In prod the alias
    # "rocket" points at Rocket Lab, and "Rocket Seals" is a different company.
    {"lookup_key": "rocket", "canonical_id": "t17"},
    {"lookup_key": "hillman", "canonical_id": "t18"},
    # The second half of the Spotify shape. normalize_company_key folds the
    # trailing "sa", so this alias key lands on the same normalized key as the
    # t26 NAME while pointing at t25. That, and not a real ambiguity, is what
    # makes surface 5 refuse. The key deliberately is not "spotify technology":
    # in prod it is not, which is why surface 3 misses and the case reaches
    # surface 5 at all.
    {"lookup_key": "spotify technology sa", "canonical_id": "t25"},
]

MORE_COMPANIES = [
    {"id": "t17", "name": "Rocket Lab", "ticker": "RKLB"},
    # Direction B may use an ALIAS surface: the alias is the longer side there,
    # so it is not acting as a stem.
    {"id": "t18", "name": "Hillman Solutions Corp.", "ticker": "HLMN"},
]


class _FoldCase(unittest.TestCase):
    def setUp(self):
        self.sb = FakeSupabase(COMPANIES + MORE_COMPANIES, ALIASES)
        self._patch = patch.object(ingest, "supabase", self.sb)
        self._patch.start()
        ingest._PRIMARY_INDEXED_CACHE.clear()
        # The snapshot cache lives in entity_ladder now, shared with the
        # entity_resolver write path. Reached through `ingest` so this is the
        # SAME module object ingest resolved, not a second copy.
        ingest.entity_ladder.reset_snapshot()

    def tearDown(self):
        self._patch.stop()
        ingest._PRIMARY_INDEXED_CACHE.clear()
        # The snapshot cache lives in entity_ladder now, shared with the
        # entity_resolver write path. Reached through `ingest` so this is the
        # SAME module object ingest resolved, not a second copy.
        ingest.entity_ladder.reset_snapshot()

    def resolve(self, name):
        return ingest._resolve_primary_to_canonical(name)


# ---------------------------------------------------------------------------
# 1. The primitives
# ---------------------------------------------------------------------------
class TokenPrimitivesTest(unittest.TestCase):
    def test_key_tokens_use_the_v2_key(self):
        self.assertEqual(
            company_key_tokens("Kratos Defense & Security Solutions, Inc."),
            ("kratos", "defense", "security", "solutions"),
        )

    def test_leading_stems_are_longest_first_and_capped(self):
        stems = list(leading_stems(("a", "b", "c", "d")))
        self.assertEqual(stems, [("a", "b", "c"), ("a", "b")])
        self.assertLessEqual(len(("a", "b", "c", "d")) - len(stems[-1]),
                             TOKEN_FOLD_MAX_EXTRA_TOKENS)

    def test_short_and_generic_stems_are_refused(self):
        self.assertFalse(stem_is_foldable(()))
        self.assertFalse(stem_is_foldable(("ge",)))        # too short
        self.assertFalse(stem_is_foldable(("capital",)))   # generic descriptor
        self.assertFalse(stem_is_foldable(("crown",)))     # measured false fold
        self.assertTrue(stem_is_foldable(("truist",)))

    def test_candidates_never_mutate_the_maps(self):
        by_name, by_prefix = {}, {}
        index_tokens(by_name, by_prefix, ("truist",), "t1", from_name=True)
        before = ({k: set(v) for k, v in by_name.items()},
                  {k: set(v) for k, v in by_prefix.items()})
        token_fold_candidates(by_name, by_prefix, "Truist Financial")
        self.assertEqual(before[0], by_name)
        self.assertEqual(before[1], by_prefix)


# ---------------------------------------------------------------------------
# 2. The recoveries this surface exists for
# ---------------------------------------------------------------------------
class TokenFoldRecoveryTest(_FoldCase):
    def test_extra_descriptor_token_folds_onto_the_indexed_stem(self):
        """"Truist Financial" is 46 gate-lost articles in the measured window."""
        self.assertEqual(self.resolve("Truist Financial"), "Truist")
        self.assertEqual(self.resolve("Truist Financial Corporation"), "Truist")

    def test_longest_stem_wins(self):
        """"Kratos Defense" must beat a bare "Kratos" stem, which is why
        leading_stems yields longest first."""
        self.assertEqual(
            self.resolve("Kratos Defense & Security Solutions"), "Kratos Defense")

    def test_article_name_shorter_than_the_indexed_name_folds(self):
        self.assertEqual(self.resolve("Klaviyo"), "Klaviyo Inc-A")

    def test_closest_superset_wins_over_a_farther_one(self):
        """Two supersets at different distances is not an ambiguity: the nearer
        one is the answer, and counting both would refuse a fold the nearer one
        earned on its own."""
        self.assertEqual(self.resolve("Eos Energy"), "Eos Energy Enterprises")

    def test_duplicate_index_rows_do_not_block_a_correct_fold(self):
        """Teva / Teva Pharma / Teva Pharms Intl are three rows and one company.
        The closure guard has to tolerate that, or an index defect becomes a
        resolution failure."""
        self.assertEqual(self.resolve("Teva Pharmaceutical Industries"), "Teva")

    def test_direction_b_may_use_an_alias_surface(self):
        self.assertEqual(self.resolve("Hillman"), "Hillman Solutions Corp.")


# ---------------------------------------------------------------------------
# 3. The guards. Each of these was a MEASURED false fold.
# ---------------------------------------------------------------------------
class TokenFoldGuardsTest(_FoldCase):
    def test_generic_stem_refuses(self):
        """"Crown Castle" is not "Crown Holdings"."""
        self.assertIsNone(self.resolve("Crown Castle"))

    def test_family_prefix_refuses(self):
        """"american" leads four indexed companies here and 22 in prod, so the
        fragment row named "American" [AXP] must not absorb an unrelated
        insurer. Fails closed rather than falling back to a shorter stem."""
        self.assertIsNone(self.resolve("American Integrity Insurance"))

    def test_two_supersets_at_the_same_distance_refuse(self):
        self.assertIsNone(self.resolve("Vertex"))

    def test_short_stem_refuses(self):
        """"GE Aerospace" must not fold onto a two-character row."""
        self.assertIsNone(self.resolve("GE Aerospace"))

    def test_one_token_alias_key_is_not_a_stem(self):
        """The prod alias "rocket" points at Rocket Lab. "Rocket Seals" is a
        different company, and an alias key is a weaker identity claim than a
        company row's own name, so direction A reads names only."""
        self.assertIsNone(self.resolve("Rocket Seals"))

    def test_too_many_extra_tokens_refuse(self):
        self.assertIsNone(self.resolve("Truist Financial Services Group Advisors"))

    def test_closure_threshold_is_above_one(self):
        """Pinned as a constant because setting it to 1 would refuse every
        company whose index carries duplicate rows, which is most of the
        interesting ones."""
        self.assertGreater(TOKEN_FOLD_MAX_STEM_CLOSURE, 1)


# ---------------------------------------------------------------------------
# 4. The two properties that must never regress
# ---------------------------------------------------------------------------
class TokenFoldSafetyTest(_FoldCase):
    def test_resolution_writes_nothing(self):
        for name in ("Truist Financial", "Klaviyo", "Crown Castle",
                     "American Integrity Insurance", "Rocket Seals"):
            self.resolve(name)
        self.assertEqual(self.sb.writes, [])

    def test_resolution_never_calls_resolve_entity(self):
        """A fold that reached resolve_entity would write a permanent alias, and
        a wrong permanent alias has no detection path. The surface must stay
        read-only by construction."""
        with patch.object(ingest, "resolve_entity") as mock:
            self.resolve("Truist Financial")
            self.resolve("Klaviyo")
            mock.assert_not_called()

    def test_unresolvable_name_still_returns_none(self):
        self.assertIsNone(self.resolve("Some Company Nobody Indexed"))


# ---------------------------------------------------------------------------
# 4. Surface 6 must not fire on a surface 5 REFUSAL
# ---------------------------------------------------------------------------
class TokenFoldStepFiveRefusalTest(_FoldCase):
    """_unique_company_name yields None for an EMPTY candidate set and for an
    AMBIGUOUS one alike, so `resolved is None` cannot tell "surface 5 found
    nothing" from "surface 5 refused to choose". Chaining surface 6 off that
    None let a weaker relationship pick a company the stronger surface had
    already declined to pick between.

    Measured false folds this produced in prod:
        'Southern Co.'          -> 'Southern Tooling, Inc.'
        'DOMINOS PIZZA INC'     -> "Domino's Pizza China"
        "Domino's Pizza Group"  -> "Domino's Pizza China"
        'Aecon'                 -> 'Aecon Utilities'
    """

    def test_an_ambiguous_key_with_one_anchor_elects_it_and_not_the_fold(self):
        """Single-token key. 'Southern Co.' keys to ('southern',), which two
        indexed rows share: 'Southern Co' [SO] and the bare 'Southern Company'.

        THIS ASSERTION CHANGED, and the change is the point of the ladder. It
        used to be assertIsNone. Refusing was safe but it was also the reason
        the name minted a THIRD Southern row, and the same refusal is what
        splits ONEOK into three and IDACORP into three in prod. One row in the
        bucket carries identifiers and the other differs from it by a legal
        form alone, so there is a defensible answer and the guard now gives it.

        What has NOT changed is the thing the guard exists for: the unrelated
        'Southern Tooling Inc' must still never come back.
        """
        self.assertEqual(self.resolve("Southern Co."), "Southern Co")
        self.assertNotEqual(self.resolve("Southern Co."), "Southern Tooling Inc")

    def test_the_election_is_not_only_about_single_token_keys(self):
        """Two-token key. 'DOMINOS PIZZA INC' keys to ('dominos', 'pizza'),
        shared by two rows, and direction B would reach the three-token
        "Domino's Pizza China". The apostrophe keeps the exact and
        case-insensitive name surfaces from short-circuiting the case, exactly
        as the prod strings did.

        Also changed from assertIsNone. The bucket holds "Domino's Pizza Inc"
        [DPZ] and a bare "Domino's Pizza Corp", one anchor and one legal-form
        variant, so it elects. "Domino's Pizza China" is still refused, which
        is the assertion that was ever load-bearing.
        """
        self.assertEqual(self.resolve("DOMINOS PIZZA INC"), "Domino's Pizza Inc")
        self.assertNotEqual(self.resolve("DOMINOS PIZZA INC"), "Domino's Pizza China")

    def test_a_bucket_with_no_anchor_still_refuses_and_the_fold_may_not_overrule(self):
        """The refusal path, on a bucket the election cannot rescue.

        'Aecon' and 'Aecon Co' both key to ('aecon',) and NEITHER carries a
        ticker or a CIK. There is no identity to elect on, so surface 5 refuses
        exactly as it always did, and surface 6 must not then hand back the
        unrelated 'Aecon Utilities'. 325 of the 828 ambiguous prod buckets have
        no anchor, so this is where most of the old behavior still lives.
        """
        self.assertIsNone(self.resolve("Aecon Group"))

    def test_a_clean_miss_on_surface_five_still_reaches_the_fold(self):
        """The guard must cost nothing when surface 5 genuinely found nothing.
        'Truist Financial' keys to ('truist', 'financial'), which no indexed
        row carries, so the candidate set is empty rather than ambiguous and
        the fold still runs."""
        self.assertEqual(self.resolve("Truist Financial"), "Truist")

    def test_the_guard_reads_the_candidate_set_not_the_resolved_value(self):
        """Direct on the mechanism: the ambiguous key has more than one id, and
        that is the signal the guard keys on."""
        snap = ingest._entity_snapshot()
        from company_match import normalize_company_key as _nk

        self.assertGreater(len(snap["by_norm"].get(_nk("Southern Co."), ())), 1)
        self.assertIsNone(ingest._unique_company_name(
            snap, snap["by_norm"].get(_nk("Southern Co."))))
        # And the fold, run unguarded, WOULD have produced the wrong answer.
        self.assertEqual(
            ingest._unique_company_name(snap, token_fold_candidates(
                snap["by_name_tokens"], snap["by_token_prefix"], "Southern Co.")),
            "Southern Tooling Inc",
        )

    def test_fold_may_confirm_a_refusal_it_may_not_overrule_one(self):
        """The narrow guard. Surface 5 refuses "Spotify Technology" because the
        index holds the company twice, not because two companies compete. The
        fold's answer lies INSIDE the pair surface 5 was choosing between, so it
        narrows rather than overrules, and the fold is allowed.

        Contrast 'Southern Co.' above, where the fold's answer lies OUTSIDE
        surface 5's pair and is refused. Inside versus outside is the whole
        rule. Blanket-refusing every ambiguous surface 5 would cost 87 correct
        prod rows over 3 strings and prevent no wrong answer.
        """
        self.assertEqual(self.resolve("Spotify Technology"), "Spotify")

    def test_the_confirmatory_case_really_is_a_surface_five_refusal(self):
        """Pins the premise, so the test above cannot pass for the wrong reason
        (an alias or exact hit short-circuiting before surface 5)."""
        snap = ingest._entity_snapshot()
        from company_match import normalize_company_key as _nk
        from normalize import normalize_lookup_key as _lk

        # Surfaces 1-2: no company is NAMED "Spotify Technology", in any case.
        names = {c["name"] for c in COMPANIES + MORE_COMPANIES}
        self.assertNotIn("Spotify Technology", names)
        self.assertNotIn("spotify technology", {n.lower() for n in names})
        # Surface 3: the alias key is "spotify technology sa", so this misses.
        self.assertIsNone(snap["by_alias"].get(_lk("Spotify Technology")))
        # Surface 5: two ids, so it refuses.
        norm_ids = snap["by_norm"].get(_nk("Spotify Technology"))
        self.assertEqual(len(norm_ids), 2)
        self.assertIsNone(ingest._unique_company_name(snap, norm_ids))
        fold = token_fold_candidates(
            snap["by_name_tokens"], snap["by_token_prefix"], "Spotify Technology")
        self.assertTrue(set(fold) <= set(norm_ids))


# ---------------------------------------------------------------------------
# 5. The guard has ONE definition, and three call sites must share it
# ---------------------------------------------------------------------------
class GuardedFoldCandidatesTest(unittest.TestCase):
    """Unit-level, on the rule itself rather than through a resolver."""

    def test_empty_surface_five_lets_the_fold_run_free(self):
        self.assertEqual(guarded_fold_candidates(set(), {"a"}), {"a"})
        self.assertEqual(guarded_fold_candidates(None, {"a"}), {"a"})

    def test_fold_inside_the_refused_set_is_kept(self):
        self.assertEqual(guarded_fold_candidates({"a", "b"}, {"a"}), {"a"})

    def test_fold_outside_the_refused_set_is_dropped(self):
        self.assertEqual(guarded_fold_candidates({"a", "b"}, {"c"}), set())

    def test_partial_overlap_is_dropped(self):
        """Not "intersects": a fold straddling the boundary is not narrowing an
        ambiguity, it is adding a candidate surface 5 never had."""
        self.assertEqual(guarded_fold_candidates({"a", "b"}, {"a", "c"}), set())

    def test_empty_fold_against_a_refusal_stays_empty(self):
        self.assertEqual(guarded_fold_candidates({"a", "b"}, set()), set())


class ResolverParityTest(_FoldCase):
    """THE REGRESSION THIS PR EXISTS FOR.

    Three functions resolve a primary_company and every one of them must agree:
      backend/ingest.py                    the live pipeline
      tools/primary_fold_eval.py           what backfill --apply WRITES
      tools/wikidata_gate_recovery.py      how the recovery is sized

    The guard reached the first and third and missed the second, and nothing
    failed, because each looked correct read on its own. This test reads all
    three against ONE index and fails the moment they diverge.
    """

    @staticmethod
    def _tool_index():
        import primary_fold_eval

        idx = {
            "name_by_id": {}, "row_by_id": {},
            "by_alias": {}, "by_ticker": {}, "by_norm": {},
            "exact_names": set(), "lower_names": {},
            "by_name_tokens": {}, "by_token_prefix": {},
        }
        from collections import defaultdict
        for k in ("by_alias", "by_ticker", "by_norm"):
            idx[k] = defaultdict(set)
        for r in COMPANIES + MORE_COMPANIES:
            cid, name = r["id"], r["name"]
            idx["name_by_id"][cid] = name
            # The ambiguity guard elects on identifiers, so it reads them by id.
            idx["row_by_id"][cid] = {
                "name": name, "ticker": r.get("ticker"),
                "sec_cik": r.get("sec_cik"), "mention_count": r.get("mention_count"),
            }
            idx["exact_names"].add(name)
            idx["lower_names"].setdefault(name.lower(), name)
            idx["by_norm"][normalize_company_key(name)].add(cid)
            index_tokens(idx["by_name_tokens"], idx["by_token_prefix"],
                         company_key_tokens(name), cid, from_name=True)
            if r.get("ticker"):
                idx["by_ticker"][r["ticker"].upper()].add(cid)
        for a in ALIASES:
            key, cid = a["lookup_key"], a["canonical_id"]
            idx["by_alias"][key].add(cid)
            idx["by_norm"][normalize_company_key(key)].add(cid)
            index_tokens(idx["by_name_tokens"], idx["by_token_prefix"],
                         company_key_tokens(key), cid, from_name=False)
        return primary_fold_eval, idx

    #: Every string the three resolvers must agree on. The first block is the
    #: measured false folds, the second the measured correct ones, the third
    #: the confirmatory case that separates the narrow guard from a blunt one.
    NAMES = (
        "Southern Co.", "DOMINOS PIZZA INC", "Domino's Pizza Group", "Aecon",
        "Aecon Group",
        "Truist Financial", "Klaviyo", "Kratos Defense & Security Solutions",
        "Eos Energy", "Teva Pharmaceuticals", "Crown Castle", "GE Vernova",
        "Spotify Technology", "Spotify", "Vertex", "American Express",
        "Rocket Seals", "Hillman", "nonexistent company xyz",
    )

    def test_all_three_resolvers_agree_on_every_measured_string(self):
        pfe, idx = self._tool_index()
        import wikidata_gate_recovery as wgr

        for name in self.NAMES:
            with self.subTest(name=name):
                live = ingest._resolve_primary_to_canonical(name)
                tool = pfe.resolve_after(idx, name)
                recov = wgr.resolve_widened(idx, name)
                self.assertEqual(live, tool, f"ingest vs primary_fold_eval on {name!r}")
                self.assertEqual(live, recov, f"ingest vs wikidata_gate_recovery on {name!r}")

    def test_the_unguarded_resolver_still_produces_the_false_folds(self):
        """Proof the parity test above has teeth: with the guard switched off,
        the same index yields the wrong answers the guard exists to stop."""
        _, idx = self._tool_index()
        import wikidata_gate_recovery as wgr

        # 'Aecon Group' rather than 'Southern Co.': the Southern and Domino's
        # buckets each acquired an identifier anchor, so surface 5 now ELECTS
        # for them and they never reach the fold at all. The Aecon bucket has no
        # anchor, so it still refuses, and the fold still has to be stopped from
        # overruling that refusal.
        self.assertEqual(
            wgr.resolve_widened(idx, "Aecon Group", guard_step_five_refusals=False),
            "Aecon Utilities")
        self.assertIsNone(wgr.resolve_widened(idx, "Aecon Group"))


if __name__ == "__main__":
    unittest.main()
