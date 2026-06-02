"""
Unit tests for the chunked boost query in backend/watchlist.py.

The unbatched .in_("id", article_ids) GET overflowed the proxy URL limit at
1,156 ids (~52 KB querystring -> raw 400 'Bad Request') and crashed pipeline
run #141. _fetch_boost_candidates now chunks the read into WATCHLIST_BOOST_CHUNK
(200) batches. NO production DB calls -- a FakeSupabase records the .in_ chunks.

Run from the repo root:
    python -m unittest backend.tests.test_watchlist_boost
"""
import math
import os
import sys
import unittest

os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_ANON_KEY", "dummy-anon-not-used")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import watchlist  # noqa: E402


class _Resp:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, fake, table):
        self.fake = fake
        self.table = table
        self._op = None
        self._in_ids = None
        self._update = None
        self._eq_id = None

    def select(self, *a, **k):
        self._op = "select"
        return self

    def order(self, *a, **k):
        return self

    def in_(self, column, values):
        self._in_ids = list(values)
        return self

    def update(self, payload):
        self._op = "update"
        self._update = payload
        return self

    def eq(self, column, value):
        self._eq_id = value
        return self

    def execute(self):
        if self.table == "watchlist":
            return _Resp(list(self.fake.watchlist))
        if self._op == "update":
            self.fake.updates.append((self._eq_id, self._update))
            return _Resp([{"id": self._eq_id}])
        # articles select
        if self._in_ids is None:
            self.fake.unfiltered_selects += 1
            rows = list(self.fake.articles.values())
        else:
            self.fake.in_chunks.append(list(self._in_ids))
            rows = [self.fake.articles[i] for i in self._in_ids if i in self.fake.articles]
        return _Resp(rows)


class _FakeSupabase:
    def __init__(self, watchlist=None, articles=None):
        self.watchlist = watchlist or []
        self.articles = articles or {}        # id -> row
        self.in_chunks = []                   # list of id-lists passed to .in_
        self.unfiltered_selects = 0
        self.updates = []                     # (id, payload)

    def table(self, name):
        return _Query(self, name)


def _articles(ids):
    return {i: {"id": i, "title": f"t {i}", "summary": "", "companies": [],
                "relevance_score": 5} for i in ids}


class WatchlistBoostChunkTest(unittest.TestCase):

    def _patch(self, fake):
        self._orig = watchlist.supabase
        watchlist.supabase = fake
        self.addCleanup(lambda: setattr(watchlist, "supabase", self._orig))

    def test_fetch_chunks_large_id_list(self):
        ids = [f"id-{i}" for i in range(1156)]
        fake = _FakeSupabase(articles=_articles(ids))
        self._patch(fake)
        rows = watchlist._fetch_boost_candidates(ids)
        chunk = watchlist.WATCHLIST_BOOST_CHUNK
        self.assertEqual(len(fake.in_chunks), math.ceil(1156 / chunk), "ceil(1156/chunk) .in_ calls")
        self.assertTrue(all(len(c) <= chunk for c in fake.in_chunks), "no chunk exceeds the limit")
        # Unioned result equals the mocked rows, in input order.
        self.assertEqual([r["id"] for r in rows], ids)

    def test_single_batch_is_one_call(self):
        ids = [f"id-{i}" for i in range(watchlist.WATCHLIST_BOOST_CHUNK)]  # exactly one batch
        fake = _FakeSupabase(articles=_articles(ids))
        self._patch(fake)
        rows = watchlist._fetch_boost_candidates(ids)
        self.assertEqual(len(fake.in_chunks), 1, "<= chunk ids -> exactly one .in_ call")
        self.assertEqual(len(rows), len(ids))

    def test_empty_preserves_unfiltered_query(self):
        # Preserved current behaviour: empty/None -> single unfiltered query, no .in_.
        fake = _FakeSupabase(articles=_articles(["a", "b"]))
        self._patch(fake)
        rows = watchlist._fetch_boost_candidates(None)
        self.assertEqual(len(fake.in_chunks), 0)
        self.assertEqual(fake.unfiltered_selects, 1)
        self.assertEqual(len(rows), 2)

    def test_boost_processes_all_chunks(self):
        # End-to-end: a watchlist hit in chunk 6 still gets boosted (proves the
        # chunked candidates are all scanned, not just the first batch).
        ids = [f"id-{i}" for i in range(1156)]
        arts = _articles(ids)
        arts["id-1155"]["title"] = "AAPL surges on earnings"  # last chunk
        arts["id-3"]["title"] = "aapl dips"                    # first chunk
        fake = _FakeSupabase(watchlist=[{"identifier": "AAPL"}], articles=arts)
        self._patch(fake)
        boosted = watchlist.boost_watchlist_relevance(ids)
        self.assertEqual(boosted, 2, "both the first- and last-chunk matches boosted")
        boosted_ids = {i for i, _p in fake.updates}
        self.assertEqual(boosted_ids, {"id-3", "id-1155"})
        self.assertEqual(len(fake.in_chunks), math.ceil(1156 / watchlist.WATCHLIST_BOOST_CHUNK))


if __name__ == "__main__":
    unittest.main()
