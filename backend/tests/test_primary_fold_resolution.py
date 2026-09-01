"""Unit tests for primary_company fold resolution.

Context: scratch/A-primary-company-fold-failure.md measured that 27% of rows
carry a primary_company absent from companies[], costing 12.9% retrieval over
68 tracked tickers. The gate consulted only companies.name by exact/ilike
compare, so bare tickers, legal-suffix variants, formatting near-misses and
known aliases all failed to resolve.

These tests pin the four resolution surfaces, the ambiguity guards that keep
widening from inventing wrong answers, and the two properties that must not
regress: the fold writes nothing, and it never mints a company.

NO production Gemini or Supabase calls. The Supabase client is replaced with an
in-memory fake that records any write attempt.

Run:
    python -m unittest backend.tests.test_primary_fold_resolution
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
from company_match import normalize_company_key, looks_like_ticker  # noqa: E402


# ---------------------------------------------------------------------------
# 1. normalize_company_key: the sql/proposals/0020 fixtures, verbatim
# ---------------------------------------------------------------------------
class NormalizeCompanyKeyTest(unittest.TestCase):
    """These are the sanity fixtures from norm_v2.lookup_key_v2 in
    sql/proposals/0020_normalize_lookup_key_v2.sql. If this port and that SQL
    ever disagree, the gate and the eventual migration disagree about what
    counts as the same company."""

    FIXTURES = [
        ("Caterpillar", "caterpillar"),
        ("Caterpillar Inc", "caterpillar"),
        ("Caterpillar Inc.", "caterpillar"),
        ("Archer-Daniels-Midland", "archer daniels midland"),
        ("Kioxia Holdings Corp.", "kioxia"),
        ("Estée Lauder", "estée lauder"),
        ("Group", "group"),
        ("Moody's Analytics", "moodys analytics"),
        ("BP p.l.c.", "bp"),
        ("  Tesla  ", "tesla"),
    ]

    def test_sql_fixtures(self):
        for raw, expected in self.FIXTURES:
            with self.subTest(raw=raw):
                self.assertEqual(normalize_company_key(raw), expected)

    def test_accents_survive(self):
        """v1 deliberately preserves accents, so the punctuation pass must not
        use \\W, which would strip them."""
        self.assertEqual(normalize_company_key("Pampa Energía"), "pampa energía")

    def test_typographic_apostrophe_folds_onto_ascii(self):
        """Cluster 2 of the diagnosis: U+2019, not foreign text."""
        self.assertEqual(
            normalize_company_key("Jersey Mike’s"), normalize_company_key("Jersey Mike's")
        )

    def test_leading_the_is_deliberately_not_stripped(self):
        """Measured, not assumed. Stripping a leading article looks obviously
        right (the diagnosis lists Coca-Cola vs The Coca-Cola Company), but over
        the full corpus it recovered ZERO rows and created 65 new ambiguous
        collisions, because the index holds both "The Coca-Cola" and "The
        Coca-Cola Company". See the note in company_match.py before re-adding."""
        self.assertNotEqual(
            normalize_company_key("Coca-Cola"),
            normalize_company_key("The Coca-Cola Company"),
        )

    def test_extra_suffixes_are_only_the_ones_that_measured(self):
        """--suffix-audit over 170,178 rows. kgaa bought 0 rows and added 5
        ambiguous collisions; sas and gmbh bought nothing. Carrying a suffix
        that pays nothing is cost without benefit."""
        import company_match

        for dropped in ("sas", "gmbh", "kgaa"):
            self.assertNotIn(dropped, company_match.EXTRA_SUFFIXES)
        self.assertIn("se", company_match.EXTRA_SUFFIXES)  # +113 rows, the big one

    def test_suffix_stripping_never_empties_a_name(self):
        for raw in ("Inc.", "Group", "Holdings", "Co"):
            with self.subTest(raw=raw):
                self.assertTrue(normalize_company_key(raw))

    def test_empty_input_is_safe(self):
        self.assertEqual(normalize_company_key(""), "")
        self.assertEqual(normalize_company_key(None), "")


class LooksLikeTickerTest(unittest.TestCase):
    def test_bare_symbols_match(self):
        for s in ("ARM", "V", "ADP", "ONDS", "RELX", "BRK.B"):
            self.assertTrue(looks_like_ticker(s), s)

    def test_names_do_not_match(self):
        for s in ("Arm Holdings", "arm", "Visa Inc.", "MicroStrategy", "GE Aerospace", ""):
            self.assertFalse(looks_like_ticker(s), s)


# ---------------------------------------------------------------------------
# In-memory Supabase fake
# ---------------------------------------------------------------------------
class _Resp:
    def __init__(self, data):
        self.data = data


class _Table:
    def __init__(self, sb, name):
        self.sb, self.name, self.filters, self.rng = sb, name, [], None

    def select(self, *a, **k):
        return self

    def eq(self, key, val):
        self.filters.append(("eq", key, val))
        return self

    def ilike(self, key, val):
        self.filters.append(("ilike", key, val))
        return self

    def limit(self, _n):
        return self

    def range(self, a, b):
        self.rng = (a, b)
        return self

    # Any write is a test failure by construction; record and let the test assert.
    def insert(self, *a, **k):
        self.sb.writes.append(("insert", self.name))
        return self

    def update(self, *a, **k):
        self.sb.writes.append(("update", self.name))
        return self

    def upsert(self, *a, **k):
        self.sb.writes.append(("upsert", self.name))
        return self

    def delete(self, *a, **k):
        self.sb.writes.append(("delete", self.name))
        return self

    def execute(self):
        rows = list(self.sb.data.get(self.name, []))
        for op, key, val in self.filters:
            if op == "eq":
                rows = [r for r in rows if r.get(key) == val]
            elif op == "ilike":
                rows = [r for r in rows if str(r.get(key) or "").lower() == str(val).lower()]
        if self.rng is not None:
            lo, hi = self.rng
            rows = rows[lo:hi + 1]
        return _Resp(rows)


class FakeSupabase:
    def __init__(self, companies=(), aliases=()):
        self.data = {"companies": list(companies), "aliases": list(aliases)}
        self.writes = []

    def table(self, name):
        return _Table(self, name)


COMPANIES = [
    {"id": "c1", "name": "Arm Holdings", "ticker": "ARM"},
    {"id": "c2", "name": "Visa Inc.", "ticker": "V"},
    {"id": "c3", "name": "SAP", "ticker": "SAP"},
    {"id": "c4", "name": "The Coca-Cola Company", "ticker": "KO"},
    {"id": "c5", "name": "Sony", "ticker": None},
    {"id": "c6", "name": "Paychex", "ticker": "PAYX"},
    # Two companies sharing a ticker: ambiguity guard for the ticker surface.
    {"id": "c7", "name": "Acme Alpha", "ticker": "DUP"},
    {"id": "c8", "name": "Acme Beta", "ticker": "DUP"},
    # Two companies normalizing to the same key: ambiguity guard for the
    # normalized surface. Both keep distinct exact names.
    {"id": "c9", "name": "Globex Inc", "ticker": None},
    {"id": "c10", "name": "Globex Corp", "ticker": None},
]

ALIASES = [
    {"lookup_key": "sony group", "canonical_id": "c5"},
    {"lookup_key": "coca cola", "canonical_id": "c4"},
    # Dangling alias: points at a company row that does not exist.
    {"lookup_key": "ghost industries", "canonical_id": "c999"},
]


class _ResolutionCase(unittest.TestCase):
    def setUp(self):
        self.sb = FakeSupabase(COMPANIES, ALIASES)
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
# 2. The four resolution surfaces
# ---------------------------------------------------------------------------
class ResolutionSurfacesTest(_ResolutionCase):
    def test_exact_name_still_resolves(self):
        self.assertEqual(self.resolve("Arm Holdings"), "Arm Holdings")

    def test_case_insensitive_returns_canonical_casing(self):
        """Bucket B of the diagnosis. PostgREST .contains is case-SENSITIVE, so
        folding the article's casing kept the row invisible even when ilike
        matched. The canonical casing is what makes it retrievable."""
        self.assertEqual(self.resolve("PAYCHEX"), "Paychex")

    def test_alias_lookup_key_resolves(self):
        """Bucket C, 1,744 rows: the gate never read aliases."""
        self.assertEqual(self.resolve("Sony Group"), "Sony")

    def test_bare_ticker_resolves_to_the_company_name(self):
        """Cluster 1, 23.9% of bucket D: tickers live in a separate column, so a
        bare symbol could never match on name."""
        self.assertEqual(self.resolve("ARM"), "Arm Holdings")
        self.assertEqual(self.resolve("V"), "Visa Inc.")

    def test_legal_suffix_variant_resolves(self):
        """Cluster 5: 'SAP SE' vs indexed 'SAP'."""
        self.assertEqual(self.resolve("SAP SE"), "SAP")

    def test_hyphen_near_miss_resolves_through_the_alias_surface(self):
        """"Coca-Cola" reaches the company through the alias key, NOT through
        normalization: a leading "The" is deliberately not stripped, so
        "coca cola" and "the coca cola" stay distinct keys. In prod there is no
        such alias, which is why the diagnosis's 157 Coca-Cola rows are in the
        measured residual rather than fixed by this change."""
        self.assertEqual(self.resolve("Coca-Cola"), "The Coca-Cola Company")

    def test_punctuation_only_near_miss_resolves_by_normalization(self):
        """Cluster 3 proper: no alias involved, the key alone carries it."""
        self.assertEqual(self.resolve("S.A.P."), "SAP")


# ---------------------------------------------------------------------------
# 3. Guards: widening must not invent answers
# ---------------------------------------------------------------------------
class ResolutionGuardsTest(_ResolutionCase):
    def test_ambiguous_ticker_refuses(self):
        self.assertIsNone(self.resolve("DUP"))

    def test_ambiguous_normalized_key_refuses(self):
        """'Globex' reaches both Globex Inc and Globex Corp. A wrong fold is
        worse than a miss, so this must fail closed."""
        self.assertIsNone(self.resolve("Globex"))

    def test_exact_name_still_wins_over_an_ambiguous_normalization(self):
        self.assertEqual(self.resolve("Globex Inc"), "Globex Inc")

    def test_unindexed_name_resolves_to_nothing(self):
        """Cluster 6, 48.1% of bucket D. Genuinely absent from the index;
        fixing it would require minting, which is out of scope."""
        for name in ("MicroStrategy", "GE Aerospace", "Howmet Aerospace"):
            self.assertIsNone(self.resolve(name), name)

    def test_etfs_and_typos_resolve_to_nothing(self):
        """These are ticker-SHAPED but index to nothing, so the shape predicate
        alone must not be enough to fold."""
        for name in ("SPY", "QQQ", "APPL"):
            self.assertIsNone(self.resolve(name), name)

    def test_dangling_alias_is_ignored(self):
        self.assertIsNone(self.resolve("Ghost Industries"))

    def test_resolution_never_writes(self):
        for name in ("ARM", "SAP SE", "Coca-Cola", "MicroStrategy", "DUP", "Sony Group"):
            self.resolve(name)
        self.assertEqual(self.sb.writes, [], "the fold gate must be SELECT-only")

    def test_resolution_is_memoized(self):
        self.assertEqual(self.resolve("ARM"), "Arm Holdings")
        self.assertIn("ARM", ingest._PRIMARY_INDEXED_CACHE)
        # A negative result is cached too, so an unresolvable name is not
        # re-queried once per article.
        self.assertIsNone(self.resolve("MicroStrategy"))
        self.assertIn("MicroStrategy", ingest._PRIMARY_INDEXED_CACHE)

    def test_snapshot_load_failure_degrades_to_name_only(self):
        """Fail-soft: a broken snapshot must leave the pre-existing eq/ilike
        behavior working rather than breaking ingest."""
        with patch.object(ingest.entity_ladder, "select_all_rows",
                          side_effect=RuntimeError("boom")):
            ingest.entity_ladder.reset_snapshot()
            ingest._PRIMARY_INDEXED_CACHE.clear()
            self.assertEqual(self.resolve("Arm Holdings"), "Arm Holdings")  # live query
            self.assertIsNone(self.resolve("ARM"))                          # snapshot surface gone


# ---------------------------------------------------------------------------
# 4. The fold itself
# ---------------------------------------------------------------------------
class FoldBehaviourTest(_ResolutionCase):
    def setUp(self):
        super().setUp()
        self._flag = ingest.TAGGING_PRIMARY_FOLD_ENABLED
        ingest.TAGGING_PRIMARY_FOLD_ENABLED = True

    def tearDown(self):
        ingest.TAGGING_PRIMARY_FOLD_ENABLED = self._flag
        super().tearDown()

    def test_folds_the_canonical_name_not_the_raw_string(self):
        """The whole point. Appending 'ARM' does nothing for a reader querying
        'Arm Holdings'."""
        out = ingest._fold_primary_into_companies(["Nvidia"], {"primary_company": "ARM"})
        self.assertEqual(out, ["Nvidia", "Arm Holdings"])

    def test_does_not_mutate_the_input_list(self):
        clean = ["Nvidia"]
        ingest._fold_primary_into_companies(clean, {"primary_company": "ARM"})
        self.assertEqual(clean, ["Nvidia"])

    def test_no_duplicate_when_canonical_already_present(self):
        out = ingest._fold_primary_into_companies(["arm holdings"], {"primary_company": "ARM"})
        self.assertEqual(out, ["arm holdings"])

    def test_unresolvable_primary_folds_nothing(self):
        out = ingest._fold_primary_into_companies(["Nvidia"], {"primary_company": "MicroStrategy"})
        self.assertEqual(out, ["Nvidia"])

    def test_flag_off_is_byte_identical(self):
        ingest.TAGGING_PRIMARY_FOLD_ENABLED = False
        clean = ["Nvidia"]
        out = ingest._fold_primary_into_companies(clean, {"primary_company": "ARM"})
        self.assertIs(out, clean)

    def test_blocklist_still_applies_before_resolution(self):
        with patch.object(ingest, "is_blocked_entity", return_value=True):
            out = ingest._fold_primary_into_companies(["Nvidia"], {"primary_company": "ARM"})
        self.assertEqual(out, ["Nvidia"])

    def test_empty_primary_folds_nothing(self):
        for analysis in ({}, {"primary_company": ""}, {"primary_company": "   "},
                         {"primary_company": None}):
            out = ingest._fold_primary_into_companies(["Nvidia"], analysis)
            self.assertEqual(out, ["Nvidia"])

    def test_fold_never_writes(self):
        for primary in ("ARM", "SAP SE", "MicroStrategy", "Coca-Cola"):
            ingest._fold_primary_into_companies(["Nvidia"], {"primary_company": primary})
        self.assertEqual(self.sb.writes, [])


if __name__ == "__main__":
    unittest.main()
