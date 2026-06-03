"""
Unit tests for embedding_job's unembedded-content fetch (scale fix).

The prior code did articles?id=not.in.(<all embedded ids>); at ~800 embedded
ids that URL overflowed the proxy limit (raw 400) and embedding_job silently
embedded nothing in pipeline run #142. The fix loads the embedded-id set
(paginated, no 1000-row cap) and filters candidates IN MEMORY -- no id list in
any URL. NO production calls; a FakeSupabase models the tables and FLAGS any
.in_ / .not_ use so an oversized-URL regression fails the test.

Run from the repo root:
    python -m unittest backend.tests.test_embedding_scale
"""
import os
import sys
import unittest

os.environ.setdefault("GEMINI_API_KEY", "dummy-key-not-used")
os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_ANON_KEY", "dummy-anon-not-used")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import embedding_job  # noqa: E402


class _Resp:
    def __init__(self, data):
        self.data = data


class _Q:
    def __init__(self, fake, table):
        self.fake = fake
        self.table = table
        self._eq = {}
        self._range = None

    def select(self, cols):
        return self

    def eq(self, col, val):
        self._eq[col] = val
        return self

    def order(self, col, desc=False):
        self.fake.orders.setdefault(self.table, []).append((col, desc))
        return self

    def range(self, a, b):
        self._range = (a, b)
        self.fake.ranges.setdefault(self.table, []).append((a, b))
        return self

    def limit(self, n):  # must never be combined with an id-list filter now
        self._range = (0, n - 1)
        return self

    def in_(self, *a, **k):
        self.fake.in_calls += 1          # regression: id list went into the URL
        return self

    @property
    def not_(self):
        self.fake.not_used = True        # regression: not.in. path
        return self

    def execute(self):
        rows = self.fake.rows_for(self.table, self._eq)
        if self._range is not None:
            a, b = self._range
            rows = rows[a:b + 1]
        return _Resp(list(rows))


class _Fake:
    def __init__(self, embeddings, articles=None, theses=None):
        self.embeddings = embeddings      # [{content_id, content_type}]
        self.articles = articles or []
        self.theses = theses or []
        self.in_calls = 0
        self.not_used = False
        self.ranges = {}                  # table -> [(a,b), ...]
        self.orders = {}                  # table -> [(col, desc), ...]

    def table(self, name):
        return _Q(self, name)

    def rows_for(self, table, eq):
        if table == "content_embeddings":
            ct = eq.get("content_type")
            return [r for r in self.embeddings if r["content_type"] == ct]
        if table == "articles":
            return self.articles
        if table == "theses":
            return self.theses
        return []


def _embeddings(content_type, n):
    return [{"content_id": f"{content_type}{i}", "content_type": content_type} for i in range(n)]


def _articles(n):
    return [{"id": f"article{i}", "title": f"t{i}", "summary": "s"} for i in range(n)]


class EmbeddingScaleTest(unittest.TestCase):

    def _install(self, fake):
        orig = embedding_job.supabase
        embedding_job.supabase = fake
        self.addCleanup(lambda: setattr(embedding_job, "supabase", orig))
        return fake

    def test_no_id_list_in_url(self):
        # 1500 embedded (forces >1000 pagination), 2500 articles.
        fake = self._install(_Fake(_embeddings("article", 1500), _articles(2500)))
        embedding_job._fetch_unembedded_articles(200)
        self.assertEqual(fake.in_calls, 0, "no .in_ id-list filter in the URL")
        self.assertFalse(fake.not_used, "no not.in. path")

    def test_returns_only_unembedded_at_volume(self):
        fake = self._install(_Fake(_embeddings("article", 1500), _articles(2500)))
        rows = embedding_job._fetch_unembedded_articles(200)
        embedded = {f"article{i}" for i in range(1500)}
        self.assertEqual(len(rows), 200)
        self.assertTrue(all(r["id"] not in embedded for r in rows), "all returned rows are unembedded")
        # The unembedded ids start at article1500.
        self.assertEqual(rows[0]["id"], "article1500")

    def test_embedded_id_set_paginated_past_1000(self):
        fake = self._install(_Fake(_embeddings("article", 1500), _articles(2500)))
        embedding_job._fetch_unembedded_articles(50)
        ce_ranges = fake.ranges.get("content_embeddings", [])
        self.assertGreaterEqual(len(ce_ranges), 2, "embedded-id load paginated past the 1000 cap")

    def test_candidate_scan_pages_until_limit(self):
        # First 1000 articles all embedded -> must page to find unembedded ones.
        fake = self._install(_Fake(_embeddings("article", 1500), _articles(2500)))
        rows = embedding_job._fetch_unembedded_articles(200)
        art_ranges = fake.ranges.get("articles", [])
        self.assertGreaterEqual(len(art_ranges), 2, "candidate scan paged past the all-embedded first page")
        self.assertEqual(len(rows), 200)

    def test_stable_pagination_tiebreaker(self):
        # Candidate pages must order by the recency column AND a stable `id`
        # tiebreaker, or ties at a page boundary duplicate/skip rows (the bug
        # that produced ~262 duplicate embeddings + ~262 skips in the backfill).
        fake = self._install(_Fake(_embeddings("article", 1500), _articles(2500)))
        embedding_job._fetch_unembedded_articles(50)
        art_orders = fake.orders.get("articles", [])
        self.assertIn(("ingested_at", True), art_orders, "ordered newest-first by ingested_at")
        self.assertIn(("id", True), art_orders, "stable id tiebreaker present")

    def test_no_duplicate_ids_returned(self):
        fake = self._install(_Fake(_embeddings("article", 1500), _articles(2500)))
        rows = embedding_job._fetch_unembedded_articles(200)
        ids = [r["id"] for r in rows]
        self.assertEqual(len(ids), len(set(ids)), "no row returned twice")

    def test_fewer_than_limit_available(self):
        # Only 100 unembedded exist -> return all 100, terminate (no infinite loop).
        fake = self._install(_Fake(_embeddings("article", 2400), _articles(2500)))
        rows = embedding_job._fetch_unembedded_articles(200)
        self.assertEqual(len(rows), 100)


if __name__ == "__main__":
    unittest.main()
