"""The primary-company fold must reach resolve_entity, and the article row must
not move while it does.

Three properties are pinned here.

1. WHAT _article_row WRITES DOES NOT CHANGE. On main the fold was applied inside
   _article_row, so the row carried fold(clean_companies). This change moves the
   fold to the source, so _article_row is handed an already-folded list and
   writes it verbatim. The row's companies[] must still equal
   fold(clean_companies) exactly, on both store paths and in both flag states.
   That is the byte-identity condition stated as an invariant.

2. THE SAME LIST REACHES THE RESOLVER. On main the batch path carried the
   UNFOLDED list at index 2 of its `stored` tuple, so resolve_entity never saw a
   folded name. Both store paths must now hand the folded list to
   _resolve_company_entity.

3. IT IS A WIDENING, NOT A MINT BAN. A name with no match anywhere must still
   mint a companies row.

No network and no live Supabase: every table lands on the in-memory fake from
backend/resolver_wiring_probe.py, which records writes and models the
UNIQUE(companies.name) constraint that resolve_entity's race recovery needs.
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
    "DISABLE_TICKER_POPULATION": "1",
}.items():
    os.environ[_k] = _v

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import ingest  # noqa: E402
import resolver_wiring_probe as probe  # noqa: E402


ARTICLE = {
    "title": "Probe", "summary": "s", "url": "https://example.invalid/a",
    "source": "probe", "published_at": "2026-01-01T00:00:00+00:00",
    "content_type": "snippet",
}
ANALYSIS = {
    "companies": [probe.CO_MENTION], "primary_company": probe.PRIMARY_INPUT,
    "relevance_score": 9, "relevance_reason": "r", "themes": [],
    "sentiment": "neutral", "sentiment_reason": None,
    "industry_verticals": [], "activity_types": [], "deal_type": None,
}


class _Case(unittest.TestCase):
    def setUp(self):
        self.sb = probe.FakeSupabase(probe._SEED)
        self._patches = [
            patch.object(ingest, "supabase", self.sb),
            patch.object(ingest, "is_valid_company", return_value=True),
            patch.object(ingest, "is_blocked_entity", return_value=False),
        ]
        for p in self._patches:
            p.start()
        self._flag = ingest.TAGGING_PRIMARY_FOLD_ENABLED
        self._pub = ingest._PUBLISHER_COLUMNS_AVAILABLE
        self._grade = ingest._GRADE_SOURCE_COLUMN_AVAILABLE
        ingest._PUBLISHER_COLUMNS_AVAILABLE = False
        ingest._GRADE_SOURCE_COLUMN_AVAILABLE = False
        self._reset()

    def tearDown(self):
        ingest.TAGGING_PRIMARY_FOLD_ENABLED = self._flag
        ingest._PUBLISHER_COLUMNS_AVAILABLE = self._pub
        ingest._GRADE_SOURCE_COLUMN_AVAILABLE = self._grade
        for p in self._patches:
            p.stop()
        self._reset()

    def _reset(self):
        ingest._PRIMARY_INDEXED_CACHE.clear()
        ingest._ENTITY_SNAPSHOT = None
        ingest._RUN_VALID_COMPANY_CACHE.clear()
        ingest._RUN_ENTITY_RESOLUTION_CACHE.clear()
        ingest._RUN_COMPANY_MENTION_TALLY.clear()
        ingest._RUN_ALIAS_MENTION_TALLY.clear()

    def _flagged(self, on):
        ingest.TAGGING_PRIMARY_FOLD_ENABLED = on
        self._reset()


# ---------------------------------------------------------------------------
# 1. The article row does not move
# ---------------------------------------------------------------------------
class ArticleRowUnchangedTest(_Case):
    def test_row_carries_the_fold_of_the_raw_list_in_both_flag_states(self):
        """Main wrote fold(clean_companies) into the row. So must this."""
        for on in (False, True):
            with self.subTest(flag=on):
                self._flagged(on)
                clean = [probe.CO_MENTION]
                expected = ingest._fold_primary_into_companies(clean, ANALYSIS)
                folded = ingest._fold_primary_into_companies(clean, ANALYSIS)
                row = ingest._article_row(ARTICLE, ANALYSIS, folded)
                self.assertEqual(row["companies"], expected)

    def test_the_fold_is_idempotent_so_folding_at_the_source_cannot_double(self):
        self._flagged(True)
        once = ingest._fold_primary_into_companies([probe.CO_MENTION], ANALYSIS)
        twice = ingest._fold_primary_into_companies(once, ANALYSIS)
        self.assertEqual(once, twice)
        self.assertEqual(once, [probe.CO_MENTION, probe.CANONICAL_NAME])

    def test_article_row_no_longer_folds_on_its_own(self):
        """It writes what it is handed. Otherwise the source fold would be a
        second application and the two branches could drift apart again."""
        self._flagged(True)
        row = ingest._article_row(ARTICLE, ANALYSIS, [probe.CO_MENTION])
        self.assertEqual(row["companies"], [probe.CO_MENTION])

    def test_flag_off_row_is_the_raw_list(self):
        self._flagged(False)
        clean = [probe.CO_MENTION]
        row = ingest._article_row(
            ARTICLE, ANALYSIS, ingest._fold_primary_into_companies(clean, ANALYSIS))
        self.assertEqual(row["companies"], clean)


# ---------------------------------------------------------------------------
# 2. The folded list reaches the resolver, on BOTH store paths
# ---------------------------------------------------------------------------
class ResolverSeesTheFoldTest(_Case):
    def _resolved_names(self, run):
        seen = []
        real = ingest._resolve_company_entity

        def spy(company, themes, sentiment):
            seen.append(company)
            return real(company, themes, sentiment)

        with patch.object(ingest, "_resolve_company_entity", side_effect=spy):
            run()
        return seen

    def test_batch_path_hands_the_folded_name_to_the_resolver(self):
        self._flagged(True)
        seen = self._resolved_names(lambda: ingest.store_articles_batch(
            [(dict(ARTICLE), dict(ANALYSIS))], dedup_sets=(set(), set())))
        self.assertIn(probe.CANONICAL_NAME, seen)
        self.assertIn(probe.CO_MENTION, seen)

    def test_legacy_path_hands_the_folded_name_to_the_resolver(self):
        self._flagged(True)
        seen = self._resolved_names(
            lambda: ingest.store_article(dict(ARTICLE), dict(ANALYSIS)))
        self.assertIn(probe.CANONICAL_NAME, seen)
        self.assertIn(probe.CO_MENTION, seen)

    def test_flag_off_hands_the_resolver_nothing_extra_on_either_path(self):
        for label, run in (
            ("batch", lambda: ingest.store_articles_batch(
                [(dict(ARTICLE), dict(ANALYSIS))], dedup_sets=(set(), set()))),
            ("legacy", lambda: ingest.store_article(dict(ARTICLE), dict(ANALYSIS))),
        ):
            with self.subTest(path=label):
                self.setUp()
                self._flagged(False)
                seen = self._resolved_names(run)
                self.assertEqual(seen, [probe.CO_MENTION])

    def test_the_folded_name_resolves_and_does_not_mint(self):
        self._flagged(True)
        before = {r["name"] for r in self.sb.data["companies"]}
        ingest.store_articles_batch(
            [(dict(ARTICLE), dict(ANALYSIS))], dedup_sets=(set(), set()))
        after = {r["name"] for r in self.sb.data["companies"]}
        self.assertNotIn(probe.CANONICAL_NAME, after - before)
        self.assertTrue(any(m["company_id"] == probe.CANONICAL_ID
                            for m in self.sb.data["company_mentions"]))


# ---------------------------------------------------------------------------
# 3. Still a widening, not a mint ban
# ---------------------------------------------------------------------------
class StillMintsOnAGenuineMissTest(_Case):
    def test_an_unindexed_name_still_mints(self):
        self._flagged(True)
        before = {r["name"] for r in self.sb.data["companies"]}
        ingest.store_articles_batch(
            [(dict(ARTICLE), dict(ANALYSIS))], dedup_sets=(set(), set()))
        after = {r["name"] for r in self.sb.data["companies"]}
        self.assertEqual(after - before, {probe.CO_MENTION})


# ---------------------------------------------------------------------------
# 4. The behavioural probe itself
# ---------------------------------------------------------------------------
class BehaviouralProbeTest(unittest.TestCase):
    def test_probe_reports_the_fold_is_wired(self):
        out = probe.probe_resolver_wiring()
        self.assertTrue(out["fold_reaches_resolver"],
                        "the fold does not reach resolve_entity; the wiring regressed")
        self.assertEqual(out["version"], 2)

    def test_probe_is_behavioural_not_structural(self):
        """The structural keys are true on main too. Only the behavioural key
        separates a wired fold from a module that merely exists."""
        out = probe.probe_resolver_wiring()
        self.assertTrue(out["widened"])
        self.assertTrue(out["index_merged"])
        self.assertIn("fold_reaches_resolver", out)

    def test_probe_proves_the_canonical_resolved_rather_than_minted(self):
        out = probe.probe_resolver_wiring()
        self.assertFalse(out["canonical_was_minted"])
        self.assertEqual(out["minted_names"], [probe.CO_MENTION])

    def test_probe_leaves_the_deployed_flag_untouched(self):
        before = ingest.TAGGING_PRIMARY_FOLD_ENABLED
        probe.probe_resolver_wiring()
        self.assertEqual(ingest.TAGGING_PRIMARY_FOLD_ENABLED, before)


if __name__ == "__main__":
    unittest.main()
