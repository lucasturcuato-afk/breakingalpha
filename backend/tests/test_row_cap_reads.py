"""Unit tests for _fetch_all_rows: the PostgREST row-cap guard in ingest.

WHY THIS EXISTS. PostgREST caps every response at db-max-rows (1000 here) and
does NOT error when it truncates. `companies WHERE ticker IS NOT NULL` is the
Google News ticker universe; it measured 961 during the row-cap sweep and 900 on
2026-09-03, and the unbounded read it used would have started returning exactly
1000 on the day it crossed -- silently, with no deploy to correlate against.

These tests pin the two properties that make that impossible:
  1. a read that spans pages returns EVERY row, not the first page;
  2. a read that cannot reach its own count(*) RAISES rather than returning
     short. That is the whole point: the failure has to be loud.

Plus the call-site contract: TruncatedReadError must NOT be swallowed by the
broad `except Exception` that keeps a network blip from killing the run.

No network. The Supabase client is a fake that mimics PostgREST's cap.

Runs under pytest and `python -m unittest backend.tests.test_row_cap_reads`.
"""

import os
import sys
import unittest

# Hard override (NOT setdefault) so a real key in the shell can never leak in.
for _k, _v in {
    "GEMINI_API_KEY": "dummy-gemini-key-not-used",
    "SUPABASE_URL": "http://localhost:54321",
    "SUPABASE_SERVICE_ROLE_KEY": "dummy-service-role-not-used",
    "SUPABASE_ANON_KEY": "dummy-anon-not-used",
    "NEWS_API_KEY": "dummy-news-key-not-used",
}.items():
    os.environ[_k] = _v

_HERE = os.path.dirname(os.path.abspath(__file__))
for _p in (os.path.dirname(_HERE), os.path.dirname(os.path.dirname(_HERE))):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import ingest  # noqa: E402


class _Resp:
    def __init__(self, data, count=None):
        self.data = data
        self.count = count


class FakeQuery:
    """Mimics the PostgREST builder, including the silent row cap.

    `server_cap` is db-max-rows: a page larger than it comes back SHORT with no
    error, which is exactly the behaviour that makes the real bug invisible.
    """

    def __init__(self, rows, count_mode, server_cap=1000, count_override=None):
        self._rows = rows
        self._count_mode = count_mode
        self._cap = server_cap
        self._count_override = count_override
        self._lo = 0
        self._hi = None
        self._limit = None

    # filters used by the call sites; all no-ops on the fake
    def eq(self, *a, **k):
        return self

    @property
    def not_(self):
        return self

    def is_(self, *a, **k):
        return self

    def order(self, *a, **k):
        return self

    def range(self, lo, hi):
        self._lo, self._hi = lo, hi
        return self

    def limit(self, n):
        self._limit = n
        return self

    def execute(self):
        count = None
        if self._count_mode == "exact":
            count = (self._count_override
                     if self._count_override is not None else len(self._rows))
        if self._limit is not None and self._hi is None:
            return _Resp(self._rows[:self._limit], count)
        hi = len(self._rows) if self._hi is None else self._hi + 1
        page = self._rows[self._lo:hi]
        return _Resp(page[:self._cap], count)          # the silent truncation


class FakeSupabase:
    """Table-AWARE on purpose.

    An earlier version returned the same rows for every table, which made
    test_get_gnews_tickers_propagates_truncation pass for the wrong reason: the
    watchlist leg raised first and the companies leg -- the one the fix exists
    for -- was never reached. A mutation that deleted the companies call site's
    `raise` still passed. Per-table config is what makes these tests target the
    read they name.
    """

    def __init__(self, rows, server_cap=1000, count_override=None, per_table=None):
        self._rows = rows
        self._cap = server_cap
        self._count_override = count_override
        self._per_table = per_table or {}
        self._table = None
        self.selects = 0

    def table(self, name):
        self._table = name
        return self

    def select(self, _cols, count=None):
        self.selects += 1
        cfg = self._per_table.get(self._table)
        rows = self._rows if cfg is None else cfg.get("rows", self._rows)
        override = (self._count_override if cfg is None
                    else cfg.get("count_override"))
        return FakeQuery(rows, count, self._cap, override)


def _rows(n, key="ticker"):
    return [{key: f"T{i:05d}", "name": f"Company {i}"} for i in range(n)]


class FetchAllRowsTests(unittest.TestCase):
    def setUp(self):
        self._real_sb = ingest.supabase
        self._real_page = ingest._READ_PAGE_SIZE

    def tearDown(self):
        ingest.supabase = self._real_sb
        ingest._READ_PAGE_SIZE = self._real_page

    def test_reads_every_row_past_the_cap(self):
        """1,400 rows behind a 1,000-row cap: all 1,400 come back."""
        ingest.supabase = FakeSupabase(_rows(1400))
        got = ingest._fetch_all_rows("companies", "ticker")
        self.assertEqual(len(got), 1400)
        self.assertEqual(got[0]["ticker"], "T00000")
        self.assertEqual(got[-1]["ticker"], "T01399")

    def test_the_bug_it_replaces(self):
        """A single uncapped .execute() returns 1,000 of 1,400 and looks fine.

        This is the behaviour being removed; pinning it here is what makes the
        test above meaningful rather than tautological.
        """
        sb = FakeSupabase(_rows(1400))
        resp = sb.table("companies").select("ticker").not_.is_("ticker", "null").execute()
        self.assertEqual(len(resp.data), 1000)   # silently short
        self.assertIsNone(resp.count)            # and nothing says so

    def test_exactly_at_the_cap_is_not_a_false_alarm(self):
        """1,000 rows is the suspicious number; it must still read cleanly."""
        ingest.supabase = FakeSupabase(_rows(1000))
        self.assertEqual(len(ingest._fetch_all_rows("companies", "ticker")), 1000)

    def test_short_read_raises(self):
        """count(*) says 1,500 but only 900 are reachable -> loud failure."""
        ingest.supabase = FakeSupabase(_rows(900), count_override=1500)
        with self.assertRaises(ingest.TruncatedReadError) as cm:
            ingest._fetch_all_rows("companies", "ticker", label="companies universe")
        msg = str(cm.exception)
        self.assertIn("TRUNCATED READ", msg)
        self.assertIn("1500", msg)
        self.assertIn("900", msg)
        self.assertIn("companies universe", msg)   # the label names the read

    def test_missing_count_raises(self):
        """No exact count means the read cannot be verified -> refuse it."""

        class NoCount(FakeSupabase):
            def select(self, _cols, count=None):
                return FakeQuery(self._rows, None)   # never returns a count

        ingest.supabase = NoCount(_rows(50))
        with self.assertRaises(ingest.TruncatedReadError):
            ingest._fetch_all_rows("companies", "ticker")

    def test_empty_result_is_not_an_error(self):
        ingest.supabase = FakeSupabase([])
        self.assertEqual(ingest._fetch_all_rows("companies", "ticker"), [])

    def test_page_size_never_exceeds_the_server_cap(self):
        """A page larger than db-max-rows short-reads every page, forever."""
        self.assertLessEqual(ingest._READ_PAGE_SIZE, 1000)

    def test_filters_are_applied_to_both_count_and_pages(self):
        """The assertion is meaningless if the count and the pages disagree."""
        seen = []
        ingest.supabase = FakeSupabase(_rows(20))

        def apply_filters(b):
            seen.append(b)
            return b.not_.is_("ticker", "null")

        ingest._fetch_all_rows("companies", "ticker", apply_filters)
        # once for the count head, at least once for the page reads
        self.assertGreaterEqual(len(seen), 2)


class CallSiteContractTests(unittest.TestCase):
    """TruncatedReadError must survive the broad except at both call sites."""

    def setUp(self):
        self._real_sb = ingest.supabase
        ingest._TICKER_COMPANY_NAMES.clear()

    def tearDown(self):
        ingest.supabase = self._real_sb
        ingest._TICKER_COMPANY_NAMES.clear()

    def test_get_gnews_tickers_propagates_truncation_from_COMPANIES(self):
        """Isolates the companies leg: watchlist reads cleanly, companies truncates.

        Without the isolation this passes even if the companies call site stops
        re-raising, because the watchlist leg raises first. Verified by mutation.
        """
        ingest.supabase = FakeSupabase(_rows(10), per_table={
            "watchlist": {"rows": _rows(10, key="identifier")},          # clean
            "companies": {"rows": _rows(900), "count_override": 1500},   # truncated
        })
        with self.assertRaises(ingest.TruncatedReadError):
            ingest._get_gnews_tickers()

    def test_get_gnews_tickers_propagates_truncation_from_WATCHLIST(self):
        ingest.supabase = FakeSupabase(_rows(10), per_table={
            "watchlist": {"rows": _rows(900, key="identifier"), "count_override": 1500},
            "companies": {"rows": _rows(10)},
        })
        with self.assertRaises(ingest.TruncatedReadError):
            ingest._get_gnews_tickers()

    def test_clean_watchlist_plus_clean_companies_returns_the_union(self):
        """Guards the isolation above: this config must NOT raise."""
        ingest.supabase = FakeSupabase(_rows(10), per_table={
            "watchlist": {"rows": [{"identifier": "AAPL"}, {"identifier": "MSFT"}]},
            "companies": {"rows": [{"ticker": "MSFT"}, {"ticker": "NVDA"}]},
        })
        self.assertEqual(ingest._get_gnews_tickers(), ["AAPL", "MSFT", "NVDA"])

    def test_load_ticker_company_names_propagates_truncation(self):
        ingest.supabase = FakeSupabase(_rows(900), count_override=1500)
        with self.assertRaises(ingest.TruncatedReadError):
            ingest._load_ticker_company_names()

    def test_ordinary_read_failure_is_still_soft(self):
        """A network blip must NOT become fatal -- only truncation does."""

        class Boom(FakeSupabase):
            def select(self, _cols, count=None):
                raise RuntimeError("connection reset")

        ingest.supabase = Boom([])
        self.assertEqual(ingest._get_gnews_tickers(), [])          # degraded, not raised
        self.assertEqual(ingest._load_ticker_company_names(), {})


if __name__ == "__main__":
    unittest.main()
