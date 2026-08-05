"""
Unit tests for embedding_job's unembedded-content fetch (scale + disk-IO fix).

History, in two layers:

1. SCALE (run #142). The original code did articles?id=not.in.(<all embedded
   ids>); at ~800 embedded ids that URL overflowed the proxy limit (raw 400) and
   embedding_job silently embedded nothing. The fix removed the id EXCLUSION
   filter from the URL. That invariant is still enforced here: no not.in. path,
   ever, and no unbounded id list in any request.

2. DISK IO (this change). The #142 fix answered membership by paginating the
   ENTIRE content_embeddings table into a Python set on every run, using
   .range() -- LIMIT/OFFSET, which is O(offset). At ~55k rows that is ~1.5M row
   visits per call, twice per run, on a twice-daily pipeline, and it was the
   single largest disk-IO consumer in the system. It is now a bounded membership
   PROBE against the UNIQUE(content_type, content_id) index.

   The distinction that matters: an id list used to EXCLUDE must cover every
   embedded id and therefore grows without bound (forbidden). An id list used to
   PROBE covers only the candidates in hand and is chunked (safe, and the
   established pattern elsewhere in this codebase).

NO production calls; a FakeSupabase models the tables, FLAGS any .not_ use, and
FAILS any .in_ list larger than the declared chunk size.

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
        self._in = None
        self._range = None
        self._orders = []

    def select(self, cols):
        return self

    def eq(self, col, val):
        self._eq[col] = val
        return self

    def order(self, col, desc=False):
        self._orders.append((col, desc))
        self.fake.orders.setdefault(self.table, []).append((col, desc))
        return self

    def range(self, a, b):
        self._range = (a, b)
        self.fake.ranges.setdefault(self.table, []).append((a, b))
        return self

    def limit(self, n):
        self._range = (0, n - 1)
        return self

    def in_(self, col, values):
        vals = list(values)
        self.fake.in_calls += 1
        self.fake.in_sizes.append(len(vals))
        self._in = (col, set(vals))
        return self

    @property
    def not_(self):
        self.fake.not_used = True        # regression: not.in. exclusion path
        return self

    def execute(self):
        rows = self.fake.rows_for(self.table, self._eq)

        # Honor the requested ordering. The job pages candidates NEWEST-FIRST,
        # and newest content is exactly the content that is not yet embedded, so
        # a fake that returns insertion order would model a scan depth the real
        # query never pays. Ids are zero-padded so lexicographic == numeric.
        for col, desc in reversed(self._orders):
            if rows and col in rows[0]:
                rows = sorted(rows, key=lambda r: r[col], reverse=desc)

        if self._in is not None:
            col, wanted = self._in
            rows = [r for r in rows if r.get(col) in wanted]
            # IO model: an equality probe on an indexed column costs about one
            # index lookup per id asked for, independent of table size.
            self.fake.io_units[self.table] = (
                self.fake.io_units.get(self.table, 0) + len(wanted)
            )
        elif self._range is not None:
            a, b = self._range
            # IO model: LIMIT/OFFSET makes Postgres produce and DISCARD the
            # first `a` rows before returning the window, so a page at offset
            # `a` costs ~(a + page_size) row visits, not page_size.
            self.fake.io_units[self.table] = (
                self.fake.io_units.get(self.table, 0) + min(b + 1, len(rows))
            )
        else:
            self.fake.io_units[self.table] = (
                self.fake.io_units.get(self.table, 0) + len(rows)
            )

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
        self.in_sizes = []                # every .in_ list length seen
        self.not_used = False
        self.ranges = {}                  # table -> [(a,b), ...]
        self.orders = {}                  # table -> [(col, desc), ...]
        self.io_units = {}                # table -> modelled row visits

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


# Zero-padded so lexicographic order == numeric order, which lets the fake model
# "newest-first" as "highest id first" the way the real ingested_at DESC ordering
# does. Article i is newer than article i-1; embeddings cover the OLDEST n, so
# the newest rows are the unembedded ones, matching production.
def _aid(i):
    return f"article{i:06d}"


def _embeddings(content_type, n):
    prefix = "article" if content_type == "article" else content_type
    return [{"content_id": f"{prefix}{i:06d}", "content_type": content_type} for i in range(n)]


def _articles(n):
    return [{"id": _aid(i), "title": f"t{i}", "summary": "s"} for i in range(n)]


def _embeddings_for(indexes):
    """Embeddings covering an explicit set of article indexes. Used to build the
    'the newest page is already embedded' fixture, which is the only case that
    forces the candidate scan to page."""
    return [{"content_id": _aid(i), "content_type": "article"} for i in indexes]


class EmbeddingScaleTest(unittest.TestCase):

    def _install(self, fake):
        orig = embedding_job.supabase
        embedding_job.supabase = fake
        self.addCleanup(lambda: setattr(embedding_job, "supabase", orig))
        return fake

    # --- Invariant 1: no id EXCLUSION filter, no unbounded id list -----------

    def test_no_exclusion_filter_and_bounded_id_lists(self):
        # 1500 embedded (forces >1000 pagination), 2500 articles.
        fake = self._install(_Fake(_embeddings("article", 1500), _articles(2500)))
        embedding_job._fetch_unembedded_articles(200)
        self.assertFalse(fake.not_used, "no not.in. exclusion path")
        self.assertTrue(
            all(n <= embedding_job._PROBE_CHUNK for n in fake.in_sizes),
            f"every id list stays within _PROBE_CHUNK; saw {sorted(set(fake.in_sizes))}",
        )

    def test_probe_list_never_grows_with_corpus_size(self):
        # The #142 failure mode was an id list that grew with the corpus. Probe
        # sizes must be identical at 1.5k and at 40k embedded rows.
        small = self._install(_Fake(_embeddings("article", 1500), _articles(2500)))
        embedding_job._fetch_unembedded_articles(200)
        small_max = max(small.in_sizes, default=0)

        big = self._install(_Fake(_embeddings("article", 40000), _articles(41000)))
        embedding_job._fetch_unembedded_articles(200)
        big_max = max(big.in_sizes, default=0)

        self.assertEqual(small_max, big_max, "probe chunk size is corpus-independent")
        self.assertLessEqual(big_max, embedding_job._PROBE_CHUNK)

    # --- Invariant 2: behavior is unchanged ---------------------------------

    def test_returns_only_unembedded_at_volume(self):
        self._install(_Fake(_embeddings("article", 1500), _articles(2500)))
        rows = embedding_job._fetch_unembedded_articles(200)
        embedded = {_aid(i) for i in range(1500)}
        self.assertEqual(len(rows), 200)
        self.assertTrue(all(r["id"] not in embedded for r in rows), "all returned rows are unembedded")
        # Newest-first: the newest article is unembedded and comes back first.
        self.assertEqual(rows[0]["id"], _aid(2499))

    def test_candidate_scan_pages_until_limit(self):
        # The NEWEST 1200 are embedded, so the newest page yields nothing and the
        # scan must page to reach unembedded rows.
        fake = self._install(_Fake(_embeddings_for(range(1300, 2500)), _articles(2500)))
        rows = embedding_job._fetch_unembedded_articles(200)
        art_ranges = fake.ranges.get("articles", [])
        self.assertGreaterEqual(len(art_ranges), 2, "candidate scan paged past the all-embedded first page")
        self.assertEqual(len(rows), 200)
        self.assertEqual(rows[0]["id"], _aid(1299))

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
        self._install(_Fake(_embeddings("article", 1500), _articles(2500)))
        rows = embedding_job._fetch_unembedded_articles(200)
        ids = [r["id"] for r in rows]
        self.assertEqual(len(ids), len(set(ids)), "no row returned twice")

    def test_fewer_than_limit_available(self):
        # Only 100 unembedded exist -> return all 100, terminate (no infinite loop).
        self._install(_Fake(_embeddings("article", 2400), _articles(2500)))
        rows = embedding_job._fetch_unembedded_articles(200)
        self.assertEqual(len(rows), 100)

    def test_exclude_ids_are_not_returned(self):
        # The priority tier hands its ids down so the newest-fill neither probes
        # nor re-embeds them.
        self._install(_Fake(_embeddings("article", 1500), _articles(2500)))
        excluded = {_aid(2499), _aid(2498), _aid(2497)}
        rows = embedding_job._fetch_unembedded_articles(50, exclude_ids=excluded)
        self.assertTrue(all(r["id"] not in excluded for r in rows))
        self.assertEqual(rows[0]["id"], _aid(2496))

    def test_candidate_page_scan_is_capped(self):
        # Fully caught-up corpus: every article embedded. The scan must stop at
        # the page cap instead of paging the whole table to prove there is
        # nothing to do.
        fake = self._install(_Fake(_embeddings("article", 60000), _articles(60000)))
        rows = embedding_job._fetch_unembedded_articles(200)
        self.assertEqual(rows, [])
        self.assertLessEqual(
            len(fake.ranges.get("articles", [])), embedding_job._MAX_CANDIDATE_PAGES,
            "candidate scan respects _MAX_CANDIDATE_PAGES",
        )

    # --- Invariant 3: the disk-IO reduction itself --------------------------

    def test_embeddings_io_does_not_scale_with_corpus(self):
        """The whole point. Modelled content_embeddings row visits must stay
        flat as the embedded corpus grows 1.5k -> 40k. The old full-set pull was
        quadratic in the table size; the probe is linear in candidates."""
        small = self._install(_Fake(_embeddings("article", 1500), _articles(2500)))
        embedding_job._fetch_unembedded_articles(200)
        small_io = small.io_units.get("content_embeddings", 0)

        big = self._install(_Fake(_embeddings("article", 40000), _articles(41000)))
        embedding_job._fetch_unembedded_articles(200)
        big_io = big.io_units.get("content_embeddings", 0)

        self.assertEqual(
            small_io, big_io,
            f"content_embeddings IO must be corpus-independent (1.5k={small_io}, 40k={big_io})",
        )

    def test_embeddings_io_beats_the_full_set_pull(self):
        """Against the exact pattern this change replaced, on the same IO model.

        Old shape: paginate every embedded id with .range() (LIMIT/OFFSET).
        New shape: probe only the candidate ids actually under consideration.
        """
        n_embedded = 40000

        # Reconstruct the OLD full-set pull cost on the same IO model.
        old_fake = self._install(_Fake(_embeddings("article", n_embedded), _articles(41000)))
        page = 0
        while True:
            rows = (
                old_fake.table("content_embeddings")
                .select("content_id")
                .eq("content_type", "article")
                .range(page * embedding_job._PAGE_SIZE,
                       page * embedding_job._PAGE_SIZE + embedding_job._PAGE_SIZE - 1)
                .execute()
                .data
            )
            if len(rows) < embedding_job._PAGE_SIZE:
                break
            page += 1
        old_io = old_fake.io_units.get("content_embeddings", 0)

        new_fake = self._install(_Fake(_embeddings("article", n_embedded), _articles(41000)))
        embedding_job._fetch_unembedded_articles(200)
        new_io = new_fake.io_units.get("content_embeddings", 0)

        self.assertGreater(old_io, new_io * 100,
                           f"expected a >100x reduction; old={old_io} new={new_io}")
        print(f"\n  [io model] content_embeddings row visits @ {n_embedded} embedded: "
              f"old={old_io:,} new={new_io:,} ({old_io / max(new_io, 1):.0f}x reduction)")


if __name__ == "__main__":
    unittest.main()
