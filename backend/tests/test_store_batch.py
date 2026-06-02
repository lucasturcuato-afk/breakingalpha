"""
Unit tests for the store-scale fix in backend/ingest.py:
  - within-run entity memoization (_resolve_company_valid / _resolve_company_id)
  - batched dedup reads + bulk inserts (store_articles_batch)
  - the ingest-phase wall-clock budget (graceful partial degradation)

NO production DB / Wikidata / Gemini calls. A FakeSupabase records the chained
calls so we can assert the batch path collapses the per-article round-trips and
preserves dedup semantics. is_valid_company / register_entity are patched with
call-counters (the real ones live in wikidata.py / entity_resolver.py, outside
this PR's scope).

Run from the repo root:
    python -m unittest backend.tests.test_store_batch
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


class _Resp:
    def __init__(self, data):
        self.data = data


class _Query:
    """Records one supabase-py call chain and returns canned data."""

    def __init__(self, fake, table):
        self.fake = fake
        self.table = table
        self._op = None
        self._rows = None

    def select(self, *a, **k):
        self._op = "select"
        return self

    def gte(self, *a, **k):
        return self

    def eq(self, *a, **k):
        return self

    def range(self, *a, **k):
        return self

    def insert(self, rows):
        self._op = "insert"
        self._rows = rows if isinstance(rows, list) else [rows]
        return self

    def execute(self):
        if self._op == "select":
            self.fake.select_calls += 1
            # dedup preload: return any pre-seeded existing rows for this table
            return _Resp(list(self.fake.existing.get(self.table, [])))
        if self._op == "insert":
            self.fake.insert_calls.append((self.table, len(self._rows)))
            out = []
            for r in self._rows:
                self.fake._id += 1
                row = dict(r)
                row["id"] = f"id-{self.fake._id}"
                out.append(row)
                self.fake.inserted.setdefault(self.table, []).append(row)
            return _Resp(out)
        return _Resp([])


class _FakeSupabase:
    def __init__(self, existing=None):
        self.existing = existing or {}
        self.insert_calls = []   # (table, nrows)
        self.inserted = {}       # table -> [rows]
        self.select_calls = 0
        self._id = 0

    def table(self, name):
        return _Query(self, name)

    def n_inserted(self, table):
        return len(self.inserted.get(table, []))

    def n_insert_calls(self, table):
        return sum(1 for (t, _n) in self.insert_calls if t == table)


def _pairs(n, companies_per=("AcmeCorp",), unique_company=False):
    """Build n (article, analysis) pairs with unique urls/titles."""
    out = []
    for i in range(n):
        comps = [f"Company{i}"] if unique_company else list(companies_per)
        article = {
            "title": f"Story number {i} about markets",
            "summary": f"summary {i}",
            "url": f"https://example.com/{i}",
            "source": "Google News (TEST)",
            "published_at": "2026-06-02T00:00:00Z",
            "content_type": "snippet",
        }
        analysis = {
            "relevant": True, "relevance_score": 8, "relevance_reason": "r",
            "companies": comps, "themes": ["t"], "sentiment": "neutral",
            "industry_verticals": [], "activity_types": [],
        }
        out.append((article, analysis))
    return out


class StoreBatchTest(unittest.TestCase):

    def setUp(self):
        ingest._reset_run_entity_caches()
        self.fake = _FakeSupabase()
        # Patch the module-level singleton + entity helpers used by the store path.
        self.p_sb = patch.object(ingest, "supabase", self.fake)
        self.p_block = patch.object(ingest, "is_blocked_entity", lambda name: False)
        self.p_valid = patch.object(ingest, "is_valid_company", self._valid_counter())
        self.p_reg = patch.object(ingest, "register_entity", self._reg_counter())
        self.p_sb.start(); self.p_block.start(); self.p_valid.start(); self.p_reg.start()
        self.addCleanup(self.p_sb.stop)
        self.addCleanup(self.p_block.stop)
        self.addCleanup(self.p_valid.stop)
        self.addCleanup(self.p_reg.stop)

    def _valid_counter(self):
        self.valid_calls = []

        def _f(name, supabase):
            self.valid_calls.append(name)
            return True
        return _f

    def _reg_counter(self):
        self.reg_calls = []

        def _f(name, supabase, themes=None, sentiment=None, _attempt=0):
            self.reg_calls.append(name)
            return f"cid-{name}"
        return _f

    # --- Memoization: N articles, K unique names -> K resolutions, not N -----
    def test_entity_resolution_memoized_per_unique_name(self):
        relevant = _pairs(10, companies_per=("AcmeCorp",))  # 1 unique name x10
        stored, dupes = ingest.store_articles_batch(relevant)
        self.assertEqual(len(stored), 10)
        self.assertEqual(len(set(self.valid_calls)), 1)
        self.assertEqual(len(self.valid_calls), 1, "is_valid_company memoized to 1 call")
        self.assertEqual(len(self.reg_calls), 1, "register_entity memoized to 1 call")
        # Every mention still recorded (memo caches the id, not the linkage).
        self.assertEqual(self.fake.n_inserted("company_mentions"), 10)

    def test_resolution_count_equals_unique_names(self):
        # 12 articles, 3 distinct company names interleaved.
        relevant = []
        for i in range(12):
            a, an = _pairs(1)[0]
            a["url"] = f"https://example.com/x{i}"
            a["title"] = f"distinct title {i}"
            an["companies"] = [f"Name{i % 3}"]
            relevant.append((a, an))
        ingest.store_articles_batch(relevant)
        self.assertEqual(len(self.reg_calls), 3, "3 unique names -> 3 register_entity")
        self.assertEqual(len(self.valid_calls), 3)

    # --- Batching collapses round-trips -------------------------------------
    def test_batched_round_trips_collapse(self):
        relevant = _pairs(1000, companies_per=("AcmeCorp",))
        stored, dupes = ingest.store_articles_batch(relevant)
        self.assertEqual(len(stored), 1000)
        # Articles: 1000 / STORE_CHUNK_SIZE(500) = 2 bulk inserts (not ~1000).
        self.assertEqual(self.fake.n_insert_calls("articles"), 2)
        self.assertEqual(self.fake.n_inserted("articles"), 1000)
        # Mentions: 1000 mentions / 500 = 2 bulk inserts.
        self.assertEqual(self.fake.n_insert_calls("company_mentions"), 2)
        # Dedup preload is a small paginated set of SELECTs, not per-article.
        self.assertLessEqual(self.fake.select_calls, 4)

    # --- Dedup semantics preserved ------------------------------------------
    def test_dedup_against_existing_and_within_batch(self):
        existing = {"articles": [{"url": "https://example.com/0", "title": "dup"}]}
        self.fake = _FakeSupabase(existing=existing)
        with patch.object(ingest, "supabase", self.fake):
            relevant = _pairs(5)  # url .../0 already exists -> dropped
            # add an intra-batch duplicate url
            relevant.append(relevant[2])
            stored, dupes = ingest.store_articles_batch(relevant)
        urls = {r["url"] for r in self.fake.inserted.get("articles", [])}
        self.assertNotIn("https://example.com/0", urls, "existing-URL dup dropped")
        self.assertEqual(len(urls), 4, "5 minus existing-dup; intra-batch dup also dropped")
        self.assertGreaterEqual(dupes, 2)

    # --- Resilience: a raising register_entity must not propagate ------------
    def test_register_entity_error_does_not_propagate(self):
        def _boom(name, supabase, themes=None, sentiment=None, _attempt=0):
            raise RuntimeError("429 RESOURCE_EXHAUSTED simulated")
        with patch.object(ingest, "register_entity", _boom):
            stored, dupes = ingest.store_articles_batch(_pairs(3))
        self.assertEqual(len(stored), 3, "articles still stored")
        self.assertEqual(self.fake.n_inserted("company_mentions"), 0, "no mentions on resolve failure")

    # --- Budget: degrade to partial, stop, proceed --------------------------
    def test_budget_stops_and_returns_partial(self):
        # A clock that advances 1s per call; deadline trips after 3 articles.
        ticks = iter(range(0, 10_000))

        def _clock():
            return next(ticks)
        with patch.object(ingest.time, "time", _clock):
            # first time() read here is the deadline base; set deadline = base+3
            base = ingest.time.time()
            stored, dupes = ingest.store_articles_batch(_pairs(50), deadline=base + 3)
        self.assertLess(len(stored), 50, "budget cut the store short")
        self.assertGreater(len(stored), 0, "but some were stored before the cut")
        # Returned pairs are well-formed (id, article) and aligned.
        for aid, art in stored:
            self.assertTrue(aid)
            self.assertIn("url", art)

    def test_budget_none_stores_all(self):
        stored, _d = ingest.store_articles_batch(_pairs(20), deadline=None)
        self.assertEqual(len(stored), 20)


if __name__ == "__main__":
    unittest.main()
