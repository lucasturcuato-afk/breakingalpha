"""Unit tests for get_xbrl_ciks (backend/edgar/submissions.py).

The XBRL daily refresh needs its own UNCAPPED resolver so widening its
universe never amplifies into EDGAR's hourly poll (which keeps using
get_watchlist_ciks). PostgREST returns at most 1000 rows per request, so the
resolver must page with .range() or it silently truncates once the sec_cik
universe outgrows one page.

NO production DB calls: a FakeSupabase serves canned pages and records the
requested ranges (pattern borrowed from test_watchlist_boost.py).

Run: python -m unittest backend.tests.test_xbrl_resolver
"""
import unittest

from backend.edgar.submissions import get_xbrl_ciks


class _Resp:
    def __init__(self, data):
        self.data = data


class _Query:
    """Chained query stub: records the .range() bounds, serves page slices."""

    def __init__(self, rows, calls):
        self._rows = rows
        self._calls = calls
        self._range = None

    def select(self, *_a, **_k):
        return self

    @property
    def not_(self):
        return self

    def is_(self, *_a, **_k):
        return self

    def order(self, *_a, **_k):
        return self

    def range(self, lo, hi):
        self._range = (lo, hi)
        return self

    def execute(self):
        lo, hi = self._range
        self._calls.append((lo, hi))
        return _Resp(self._rows[lo:hi + 1])


class FakeSupabase:
    def __init__(self, rows):
        self.rows = rows
        self.range_calls = []

    def table(self, name):
        assert name == "companies"
        return _Query(self.rows, self.range_calls)


def _company(i, cik):
    return {"id": f"id-{i}", "ticker": f"t{i}", "sec_cik": cik,
            "name": f"Company {i}"}


class GetXbrlCiksTests(unittest.TestCase):
    def test_returns_all_rows_beyond_one_page(self):
        # 2,345 companies: a single un-paged PostgREST call would return
        # only the first 1000
        rows = [_company(i, 100_000 + i) for i in range(2_345)]
        sb = FakeSupabase(rows)
        out = get_xbrl_ciks(sb)
        self.assertEqual(len(out), 2_345)  # uncapped, fully paged
        self.assertEqual(sb.range_calls,
                         [(0, 999), (1000, 1999), (2000, 2999)])

    def test_dedupes_on_sec_cik(self):
        rows = [_company(1, 111), _company(2, 222), _company(3, 111)]
        out = get_xbrl_ciks(FakeSupabase(rows))
        self.assertEqual([r["cik"] for r in out], [111, 222])
        self.assertEqual(out[0]["company_id"], "id-1")  # first occurrence wins

    def test_shape_matches_get_watchlist_ciks(self):
        out = get_xbrl_ciks(FakeSupabase([_company(7, 777)]))
        self.assertEqual(out, [{
            "cik": 777,
            "ticker": "T7",          # uppercased like get_watchlist_ciks
            "company_id": "id-7",
            "company_name": "Company 7",
        }])

    def test_null_ticker_tolerated(self):
        rows = [dict(_company(1, 111), ticker=None)]
        out = get_xbrl_ciks(FakeSupabase(rows))
        self.assertEqual(out[0]["ticker"], "")

    def test_exact_page_boundary_terminates(self):
        # exactly 1000 rows: page 2 returns empty and the loop must stop
        rows = [_company(i, 200_000 + i) for i in range(1_000)]
        sb = FakeSupabase(rows)
        out = get_xbrl_ciks(sb)
        self.assertEqual(len(out), 1_000)
        self.assertEqual(sb.range_calls, [(0, 999), (1000, 1999)])


if __name__ == "__main__":
    unittest.main()
