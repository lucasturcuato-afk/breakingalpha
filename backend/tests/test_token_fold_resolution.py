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

import ingest  # noqa: E402
from company_match import (  # noqa: E402
    TOKEN_FOLD_MAX_EXTRA_TOKENS,
    TOKEN_FOLD_MAX_STEM_CLOSURE,
    company_key_tokens,
    index_tokens,
    leading_stems,
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
]

ALIASES = [
    # A one-token ALIAS key must not become a fold stem. In prod the alias
    # "rocket" points at Rocket Lab, and "Rocket Seals" is a different company.
    {"lookup_key": "rocket", "canonical_id": "t17"},
    {"lookup_key": "hillman", "canonical_id": "t18"},
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
        ingest._ENTITY_SNAPSHOT = None

    def tearDown(self):
        self._patch.stop()
        ingest._PRIMARY_INDEXED_CACHE.clear()
        ingest._ENTITY_SNAPSHOT = None

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


if __name__ == "__main__":
    unittest.main()
