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
        self._is_probe = False

    def select(self, *a, **k):
        self._op = "select"
        return self

    def order(self, *a, **k):
        return self

    def in_(self, column, values):
        self._in_ids = list(values)
        return self

    def limit(self, *a, **k):
        # Used by the watchlist_match column probe. Marks the query so the
        # probe's select is not counted as a candidate fetch.
        self._is_probe = True
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
        if self._is_probe:
            # watchlist_match column probe. Raise when the fake says the
            # migration has not been applied, mirroring PostgREST's 42703.
            if not self.fake.has_match_column:
                raise RuntimeError("column articles.watchlist_match does not exist")
            return _Resp([])
        # articles select
        if self._in_ids is None:
            self.fake.unfiltered_selects += 1
            rows = list(self.fake.articles.values())
        else:
            self.fake.in_chunks.append(list(self._in_ids))
            rows = [self.fake.articles[i] for i in self._in_ids if i in self.fake.articles]
        return _Resp(rows)


class _FakeSupabase:
    def __init__(self, watchlist=None, articles=None, has_match_column=True):
        self.watchlist = watchlist or []
        self.articles = articles or {}        # id -> row
        self.in_chunks = []                   # list of id-lists passed to .in_
        self.unfiltered_selects = 0
        self.updates = []                     # (id, payload)
        self.has_match_column = has_match_column

    def table(self, name):
        return _Query(self, name)


def _articles(ids):
    return {i: {"id": i, "title": f"t {i}", "summary": "", "companies": [],
                "relevance_score": 5} for i in ids}


class _BoostTestBase(unittest.TestCase):

    def _patch(self, fake):
        self._orig = watchlist.supabase
        watchlist.supabase = fake
        self.addCleanup(lambda: setattr(watchlist, "supabase", self._orig))
        # The column probe memoizes into a module global; reset it per test so
        # one test's verdict cannot leak into the next.
        watchlist._WATCHLIST_MATCH_COLUMN_AVAILABLE = None
        self.addCleanup(
            lambda: setattr(watchlist, "_WATCHLIST_MATCH_COLUMN_AVAILABLE", None)
        )


class WatchlistBoostChunkTest(_BoostTestBase):

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

    def test_match_processes_all_chunks(self):
        # End-to-end: a watchlist hit in the last chunk is still recorded (proves
        # the chunked candidates are all scanned, not just the first batch).
        ids = [f"id-{i}" for i in range(1156)]
        arts = _articles(ids)
        arts["id-1155"]["title"] = "AAPL surges on earnings"  # last chunk
        arts["id-3"]["title"] = "aapl dips"                    # first chunk
        fake = _FakeSupabase(watchlist=[{"identifier": "AAPL"}], articles=arts)
        self._patch(fake)
        matched = watchlist.record_watchlist_matches(ids)
        self.assertEqual(matched, 2, "both the first- and last-chunk matches recorded")
        matched_ids = {i for i, _p in fake.updates}
        self.assertEqual(matched_ids, {"id-3", "id-1155"})
        self.assertEqual(len(fake.in_chunks), math.ceil(1156 / watchlist.WATCHLIST_BOOST_CHUNK))


class WatchlistTokenMatchTest(_BoostTestBase):
    """The substring-matching defect: two-letter tickers matched inside words."""

    def _run(self, identifiers, articles, has_column=True):
        fake = _FakeSupabase(
            watchlist=[{"identifier": i} for i in identifiers],
            articles=articles,
            has_match_column=has_column,
        )
        self._patch(fake)
        count = watchlist.record_watchlist_matches(list(articles))
        return fake, count

    def test_short_ticker_does_not_match_inside_a_word(self):
        # The exact corpus-wide failure: DE matched "demand"/"provide", V matched
        # any title containing the letter v, BA matched "based".
        arts = {
            "a": {"id": "a", "title": "Strong demand for cloud, based upon provider data",
                  "summary": "", "companies": [], "relevance_score": 5},
            "b": {"id": "b", "title": "Every vendor raises guidance",
                  "summary": "revenue moved higher", "companies": [], "relevance_score": 5},
        }
        fake, count = self._run(["DE", "V", "BA", "ON", "GE", "GS"], arts)
        self.assertEqual(count, 0, "no bare-substring match survives token anchoring")
        self.assertEqual(fake.updates, [], "nothing written when nothing matches")

    def test_short_ticker_still_matches_as_a_token(self):
        arts = {
            "a": {"id": "a", "title": "DE beats on farm equipment sales",
                  "summary": "", "companies": [], "relevance_score": 5},
            "b": {"id": "b", "title": "Analysts lift $V price target",
                  "summary": "", "companies": [], "relevance_score": 5},
            "c": {"id": "c", "title": "Boeing (BA) wins order",
                  "summary": "", "companies": [], "relevance_score": 5},
        }
        fake, count = self._run(["DE", "V", "BA"], arts)
        self.assertEqual(count, 3, "bare, $-prefixed and (parenthesised) forms all match")
        self.assertEqual({i for i, _p in fake.updates}, {"a", "b", "c"})

    def test_relevance_score_is_never_written(self):
        arts = {"a": {"id": "a", "title": "AAPL posts record quarter",
                      "summary": "", "companies": [], "relevance_score": 6}}
        fake, count = self._run(["AAPL"], arts)
        self.assertEqual(count, 1)
        payloads = [p for _i, p in fake.updates]
        self.assertEqual(payloads, [{"watchlist_match": ["aapl"]}])
        for payload in payloads:
            self.assertNotIn("relevance_score", payload,
                             "the grader's score must never be rewritten")

    def test_match_is_recorded_deduped_lowercased_and_sorted(self):
        arts = {"a": {"id": "a", "title": "NVDA and AAPL rally; nvda leads",
                      "summary": "AAPL guidance raised",
                      "companies": ["Nvidia"], "relevance_score": 5}}
        fake, count = self._run(["AAPL", "NVDA", "Nvidia"], arts)
        self.assertEqual(count, 1)
        self.assertEqual(fake.updates[0][1], {"watchlist_match": ["aapl", "nvda", "nvidia"]})

    def test_embedded_dot_identifier_matches_whole(self):
        # \b would fire mid-identifier on BRK.B; the lookarounds must not.
        arts = {
            "a": {"id": "a", "title": "BRK.B climbs after buyback",
                  "summary": "", "companies": [], "relevance_score": 5},
            "b": {"id": "b", "title": "BRK.BX is a different instrument",
                  "summary": "", "companies": [], "relevance_score": 5},
        }
        fake, count = self._run(["BRK.B"], arts)
        self.assertEqual(count, 1, "BRK.B matches; BRK.BX does not")
        self.assertEqual(fake.updates[0][0], "a")

    def test_companies_array_is_scanned(self):
        arts = {"a": {"id": "a", "title": "Quiet session", "summary": "",
                      "companies": ["SpaceX"], "relevance_score": 5}}
        fake, count = self._run(["SpaceX"], arts)
        self.assertEqual(count, 1)
        self.assertEqual(fake.updates[0][1], {"watchlist_match": ["spacex"]})

    def test_missing_column_counts_but_does_not_write(self):
        # Hand-apply contract: before sql/0029 lands the pass must not 400.
        arts = {"a": {"id": "a", "title": "AAPL posts record quarter",
                      "summary": "", "companies": [], "relevance_score": 5}}
        fake, count = self._run(["AAPL"], arts, has_column=False)
        self.assertEqual(count, 1, "match still detected and counted")
        self.assertEqual(fake.updates, [], "no write attempted without the column")

    def test_longest_identifier_wins(self):
        arts = {"a": {"id": "a", "title": "GE Aerospace lifts guidance",
                      "summary": "", "companies": [], "relevance_score": 5}}
        fake, count = self._run(["GE", "GE Aerospace"], arts)
        self.assertEqual(count, 1)
        self.assertEqual(fake.updates[0][1], {"watchlist_match": ["ge aerospace"]},
                         "longer alternative must not be shadowed by its prefix")

    def test_empty_and_whitespace_identifiers_are_ignored(self):
        arts = {"a": {"id": "a", "title": "Markets drift", "summary": "",
                      "companies": [], "relevance_score": 5}}
        fake, count = self._run(["", "   "], arts)
        self.assertEqual(count, 0, "a blank identifier must not match everything")
        self.assertEqual(fake.updates, [])

    def test_english_word_ticker_rejected_when_all_lowercase(self):
        # Token anchoring alone does not save ON: "rose on earnings" contains a
        # standalone "on". Case is what separates the ticker from the preposition.
        arts = {
            "a": {"id": "a", "title": "Shares rose on strong earnings",
                  "summary": "gains net of tax", "companies": [], "relevance_score": 5},
            "b": {"id": "b", "title": "ON Semiconductor lifts guidance",
                  "summary": "", "companies": [], "relevance_score": 5},
            "c": {"id": "c", "title": "Analysts back On Holding",
                  "summary": "", "companies": [], "relevance_score": 5},
        }
        fake, count = self._run(["ON", "NET"], arts)
        self.assertEqual(count, 2, "lowercase prose rejected; ON and On kept")
        self.assertEqual({i for i, _p in fake.updates}, {"b", "c"})

    def test_capitalisation_rule_does_not_apply_to_other_identifiers(self):
        arts = {"a": {"id": "a", "title": "aapl dips in late trading",
                      "summary": "", "companies": [], "relevance_score": 5}}
        fake, count = self._run(["AAPL"], arts)
        self.assertEqual(count, 1, "ordinary tickers stay case-insensitive")
        self.assertEqual(fake.updates[0][1], {"watchlist_match": ["aapl"]})

    def test_legacy_alias_still_callable(self):
        arts = {"a": {"id": "a", "title": "AAPL posts record quarter",
                      "summary": "", "companies": [], "relevance_score": 5}}
        fake = _FakeSupabase(watchlist=[{"identifier": "AAPL"}], articles=arts)
        self._patch(fake)
        self.assertEqual(watchlist.boost_watchlist_relevance(["a"]), 1,
                         "ingest.py's import name keeps working")


if __name__ == "__main__":
    unittest.main()
