"""
Unit tests for dedup-before-filter in backend/ingest.py:
  - partition_unseen_articles() splits a fetched pool on the SAME dedup key the
    store uses (exact url 30d OR normalized title 24h), keeping genuinely-new
    and dropping already-in-DB.
  - NET BEHAVIOR PRESERVED: routing already-in-DB rows around the Gemini filter
    changes no stored data. The articles stored, the company_mentions written,
    and the companies/aliases mention_count increments are IDENTICAL to the
    pre-change flow (filter-everything, dedup-at-store) for a mix of new and
    already-stored articles -- no double-count, no dropped tally.

NO production DB / Wikidata / Gemini calls. Reuses the FakeSupabase + entity
patches from test_store_batch so the store path is exercised end to end.

Run from the repo root:
    python -m unittest backend.tests.test_dedup_before_filter
"""
import os
import sys
import unittest
from unittest.mock import patch

os.environ.setdefault("GEMINI_API_KEY", "dummy-key-not-used")
os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_ANON_KEY", "dummy-anon-not-used")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import ingest  # noqa: E402
from tests.test_store_batch import _FakeSupabase  # noqa: E402


def _article(url, title, company="AcmeCorp"):
    a = {
        "title": title,
        "summary": "s",
        "url": url,
        "source": "Google News (TEST)",
        "published_at": "2026-06-02T00:00:00Z",
        "content_type": "snippet",
    }
    analysis = {
        "relevant": True, "relevance_score": 8, "relevance_reason": "r",
        "companies": [company], "themes": ["t"], "sentiment": "neutral",
        "industry_verticals": [], "activity_types": [],
    }
    return a, analysis


# A pre-seeded DB with one row that provides an existing URL and one that
# provides an existing (normalized) title -- the two ways the store dedups.
def _existing_db():
    return {"articles": [
        {"url": "https://db.com/by-url", "title": "irrelevant title"},
        {"url": "https://db.com/other", "title": "Already Stored Headline"},
    ]}


class PartitionTest(unittest.TestCase):
    """partition_unseen_articles uses the store's exact key."""

    def _sets(self, fake):
        with patch.object(ingest, "supabase", fake):
            return ingest._load_store_dedup_sets()

    def test_drops_url_and_title_matches_keeps_fresh(self):
        fake = _FakeSupabase(existing=_existing_db())
        existing_urls, recent_titles = self._sets(fake)

        pool = [
            _article("https://db.com/by-url", "brand new title 1")[0],   # url in DB
            _article("https://fresh.com/2", "Already Stored Headline")[0],  # title in DB
            _article("https://fresh.com/3", "genuinely new three")[0],   # fresh
            _article("https://fresh.com/4", "genuinely new four")[0],    # fresh
        ]
        fresh, skipped = ingest.partition_unseen_articles(pool, existing_urls, recent_titles)
        fresh_urls = {a["url"] for a in fresh}
        self.assertEqual(skipped, 2, "url-match + title-match both dropped")
        self.assertEqual(fresh_urls, {"https://fresh.com/3", "https://fresh.com/4"})

    def test_title_match_is_normalized(self):
        # DB title "Already Stored Headline" must match a punctuation/case variant.
        fake = _FakeSupabase(existing=_existing_db())
        existing_urls, recent_titles = self._sets(fake)
        pool = [_article("https://fresh.com/x", "already   stored, headline!!")[0]]
        fresh, skipped = ingest.partition_unseen_articles(pool, existing_urls, recent_titles)
        self.assertEqual(skipped, 1)
        self.assertEqual(fresh, [])

    def test_within_run_title_dupes_not_collapsed_here(self):
        # Two fresh articles with the same normalized title are BOTH kept; the
        # store's in-batch dedup collapses them later, exactly as today (so the
        # filter input matches the current pool minus already-stored rows).
        fake = _FakeSupabase(existing=_existing_db())
        existing_urls, recent_titles = self._sets(fake)
        pool = [
            _article("https://fresh.com/a", "same story today")[0],
            _article("https://fresh.com/b", "same story today")[0],
        ]
        fresh, skipped = ingest.partition_unseen_articles(pool, existing_urls, recent_titles)
        self.assertEqual(skipped, 0)
        self.assertEqual(len(fresh), 2, "in-run title dupes left for the store, not dropped pre-filter")


class _Flow:
    """Run one store flow against a fresh FakeSupabase, capturing what persisted
    and the mention_count increments. Mirrors test_store_batch's patches."""

    def __init__(self, existing):
        self.fake = _FakeSupabase(existing=existing)
        self.inc_calls = []   # (table, {id: delta})

    def __enter__(self):
        def _valid(name, supabase):
            return True

        def _resolve(name, supabase, themes=None, sentiment=None, _attempt=0):
            return {"canonical_id": f"cid-{name}", "alias_id": f"alias-{name}"}

        def _inc(supabase, table, id_to_delta):
            self.inc_calls.append((table, dict(id_to_delta)))

        ingest._reset_run_entity_caches()
        self._patches = [
            patch.object(ingest, "supabase", self.fake),
            patch.object(ingest, "is_blocked_entity", lambda name: False),
            patch.object(ingest, "is_valid_company", _valid),
            patch.object(ingest, "resolve_entity", _resolve),
            patch.object(ingest, "increment_mention_counts", _inc),
        ]
        for p in self._patches:
            p.start()
        return self

    def __exit__(self, *exc):
        for p in self._patches:
            p.stop()
        return False

    def inc_for(self, table):
        for t, d in self.inc_calls:
            if t == table:
                return d
        return {}

    def stored_urls(self):
        return sorted(r["url"] for r in self.fake.inserted.get("articles", []))

    def n_mentions(self):
        return self.fake.n_inserted("company_mentions")


class NetBehaviorPreservedTest(unittest.TestCase):
    """The data written must be byte-for-byte the same whether already-in-DB
    rows are dropped before the filter (post-change) or filtered then dropped at
    the store (pre-change)."""

    def _mixed_pool(self):
        # 3 genuinely-new + 2 already-in-DB (one by url, one by title), every
        # article mentioning AcmeCorp so the tally is easy to reason about.
        return [
            _article("https://fresh.com/1", "fresh story one"),
            _article("https://db.com/by-url", "fresh story two"),       # already (url)
            _article("https://fresh.com/3", "fresh story three"),
            _article("https://fresh.com/4", "Already Stored Headline"),  # already (title)
            _article("https://fresh.com/5", "fresh story five"),
        ]

    def test_mention_count_and_stored_set_identical_pre_and_post(self):
        existing = _existing_db()
        mixed = self._mixed_pool()

        # PRE-change flow: everything was filtered, so the full relevant set
        # (incl. the 2 already-stored) reaches the store, which dedups them.
        with _Flow(existing) as pre:
            dedup_sets = ingest._load_store_dedup_sets()
            pre_stored, pre_dupes = ingest.store_articles_batch(
                list(mixed), dedup_sets=dedup_sets
            )

        # POST-change flow: partition first, so only genuinely-new reach the
        # store. dedup_sets are reused (no second DB read).
        with _Flow(existing) as post:
            dedup_sets = ingest._load_store_dedup_sets()
            articles_only = [a for (a, _an) in mixed]
            fresh, skipped = ingest.partition_unseen_articles(articles_only, *dedup_sets)
            fresh_urls = {a["url"] for a in fresh}
            relevant_fresh = [(a, an) for (a, an) in mixed if a["url"] in fresh_urls]
            post_stored, post_dupes = ingest.store_articles_batch(
                relevant_fresh, dedup_sets=dedup_sets
            )

        # 2 already-in-DB dropped pre-filter; the filter now runs on 3, not 5.
        self.assertEqual(skipped, 2)
        self.assertEqual(len(relevant_fresh), 3)

        # Same 3 articles stored, in both flows.
        self.assertEqual(pre.stored_urls(), post.stored_urls())
        self.assertEqual(
            post.stored_urls(),
            ["https://fresh.com/1", "https://fresh.com/3", "https://fresh.com/5"],
        )
        self.assertEqual(len(pre_stored), 3)
        self.assertEqual(len(post_stored), 3)

        # Same number of mention rows written.
        self.assertEqual(pre.n_mentions(), post.n_mentions())
        self.assertEqual(post.n_mentions(), 3)

        # mention_count increments IDENTICAL: AcmeCorp tallied exactly 3 in both
        # flows -- no double-count from the already-stored rows, no dropped tally.
        self.assertEqual(pre.inc_for("companies"), {"cid-AcmeCorp": 3})
        self.assertEqual(post.inc_for("companies"), pre.inc_for("companies"))
        self.assertEqual(pre.inc_for("aliases"), {"alias-AcmeCorp": 3})
        self.assertEqual(post.inc_for("aliases"), pre.inc_for("aliases"))

    def test_all_already_in_db_stores_nothing(self):
        # If every fetched article is already stored, the filter runs on zero
        # and no data mutates (matches today: all would dedup at the store).
        existing = _existing_db()
        with _Flow(existing) as post:
            dedup_sets = ingest._load_store_dedup_sets()
            pool = [
                _article("https://db.com/by-url", "x")[0],
                _article("https://fresh.com/z", "Already Stored Headline")[0],
            ]
            fresh, skipped = ingest.partition_unseen_articles(pool, *dedup_sets)
            self.assertEqual(skipped, 2)
            self.assertEqual(fresh, [])
            stored, _d = ingest.store_articles_batch([], dedup_sets=dedup_sets)
        self.assertEqual(stored, [])
        self.assertEqual(post.n_mentions(), 0)
        self.assertEqual(post.inc_for("companies"), {})


if __name__ == "__main__":
    unittest.main()
