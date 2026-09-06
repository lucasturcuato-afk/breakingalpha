"""Hermetic tests for the read shell. No DB, no network, no credentials.

THESE ARE THE LOUDNESS TESTS. The classifier can be perfect and the check
still worthless if a truncated or failed read renders as "zero orphans". That
is not a hypothetical failure mode, it is the one this whole feature exists to
close, one level down: the 2026-09-02 EDGAR strip was `status = success` with
`errors = 0` while shards went unpolled, because the run counted caught
exceptions instead of asking whether the data was right afterwards.

So the properties asserted here are:

  * a skip-scan that stops early is DETECTED, not returned
  * a pagination that comes up short of count=exact is DETECTED
  * every failure path exits 2, and 2 is never a pass
  * the scan uses no OFFSET, because an offset walk of financial_facts
    returns HTTP 500 against prod and an offset walk of anything can silently
    skip rows under concurrent writes

A FakeSupabase serves canned rows and RECORDS EVERY OPERATION, so the last one
can be asserted on rather than assumed. Same shape as
backend/tests/test_cik_at_mint.py.

Run: python -m pytest backend/tests/test_cik_reconcile_reads.py
"""
import importlib.util
import os
import unittest

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_SRC = os.path.join(REPO, "tools", "edgar_cik_reconcile.py")

_spec = importlib.util.spec_from_file_location("edgar_cik_reconcile_tool", _SRC)
TOOL = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(TOOL)


class FakeQuery:
    """Just enough of the postgrest builder to drive the read helpers."""

    def __init__(self, table, rows, log, count_mode=None):
        self.table, self.rows, self.log = table, rows, log
        self.count_mode = count_mode
        self._order, self._desc, self._limit = None, False, None
        self._gt = None
        self._eq = {}
        self._not_in = None
        self.raise_on_execute = None

    def order(self, col, desc=False):
        self._order, self._desc = col, desc
        return self

    def limit(self, n):
        self._limit = n
        return self

    def gt(self, col, val):
        self._gt = (col, val)
        return self

    def eq(self, col, val):
        self._eq[col] = val
        return self

    @property
    def not_(self):
        return self

    def in_(self, col, vals):
        self._not_in = (col, set(vals))
        return self

    def execute(self):
        self.log.append(
            {"table": self.table, "order": self._order, "desc": self._desc,
             "limit": self._limit, "gt": self._gt, "eq": dict(self._eq),
             "not_in": self._not_in is not None}
        )
        rows = list(self.rows)
        for col, val in self._eq.items():
            rows = [r for r in rows if r.get(col) == val]
        if self._not_in:
            col, vals = self._not_in
            rows = [r for r in rows if r.get(col) not in vals]
        if self._gt:
            col, val = self._gt
            rows = [r for r in rows if r.get(col) > val]
        if self._order:
            rows.sort(key=lambda r: r[self._order], reverse=self._desc)
        total = len(rows)
        if self._limit is not None:
            rows = rows[: self._limit]
        return type("Resp", (), {"data": rows, "count": total if self.count_mode else None})()


class FakeSupabase:
    def __init__(self, tables):
        self.tables = tables
        self.log = []
        self.cap = None  # simulate a truncating read

    def table(self, name):
        self._t = name
        return self

    def select(self, cols, count=None):
        rows = self.tables.get(self._t, [])
        if self.cap is not None and self._t in self.cap[0]:
            rows = [r for r in rows if r["cik"] <= self.cap[1]]
        return FakeQuery(self._t, rows, self.log, count_mode=count)


FACTS = [{"cik": c, "company_id": None} for c in (100, 200, 300, 400)]
FILINGS = [{"cik": c} for c in (100, 200, 500)]
COMPANIES = [{"id": f"id-{i}", "name": f"C{i}", "ticker": None, "sec_cik": c}
             for i, c in enumerate((100, 200, 300, 400, 500))]


def fake():
    return FakeSupabase({
        "financial_facts": FACTS, "sec_filings": FILINGS,
        "companies": COMPANIES, "cik_tickers": [],
    })


class TestTheSkipScan(unittest.TestCase):
    def test_it_returns_every_distinct_value_in_order(self):
        sb = fake()
        self.assertEqual(
            TOOL.skip_scan_distinct(sb, "financial_facts"), [100, 200, 300, 400]
        )

    def test_it_never_uses_an_offset_or_a_range(self):
        """An offset walk of financial_facts returns HTTP 500 against prod, and
        an offset walk of anything can skip rows under concurrent writes. Every
        probe must be a keyset seek."""
        sb = fake()
        TOOL.skip_scan_distinct(sb, "financial_facts")
        self.assertTrue(sb.log)
        for op in sb.log:
            self.assertEqual(op["limit"], 1)
            self.assertEqual(op["order"], "cik")
        # every probe after the first is bounded by the previous value
        self.assertIsNone(sb.log[0]["gt"])
        self.assertTrue(all(op["gt"] is not None for op in sb.log[1:]))

    def test_a_non_advancing_scan_is_stopped_rather_than_looping_forever(self):
        class Stuck(FakeSupabase):
            def select(self, cols, count=None):
                q = super().select(cols, count)
                q.gt = lambda col, val: q  # ignore the keyset bound
                return q

        sb = Stuck({"financial_facts": FACTS})
        TOOL.RUNAWAY_CIKS, keep = 10, TOOL.RUNAWAY_CIKS
        try:
            with self.assertRaisesRegex(TOOL.CouldNotRun, "non-advancing loop"):
                TOOL.skip_scan_distinct(sb, "financial_facts")
        finally:
            TOOL.RUNAWAY_CIKS = keep


class TestTruncationIsDetected(unittest.TestCase):
    def test_a_whole_scan_passes_the_endpoint_assertion(self):
        sb = fake()
        TOOL.assert_scan_is_whole(sb, "financial_facts", [100, 200, 300, 400])

    def test_a_scan_that_stopped_early_is_caught_by_the_endpoint_assertion(self):
        """THE point. A truncated skip-scan returns a sorted, non-empty,
        entirely plausible list. Nothing about the list says what is missing.
        Reading the true endpoints by a different query is what makes it loud.
        """
        sb = fake()
        with self.assertRaisesRegex(TOOL.CouldNotRun, "truncated"):
            TOOL.assert_scan_is_whole(sb, "financial_facts", [100, 200, 300])

    def test_an_empty_scan_is_a_failure_not_a_clean_universe(self):
        sb = fake()
        with self.assertRaisesRegex(TOOL.CouldNotRun, "returned nothing at all"):
            TOOL.assert_scan_is_whole(sb, "financial_facts", [])


class TruncatingScan(FakeSupabase):
    """Its keyset probes stop early; its endpoint reads do not.

    That combination is the whole hazard. The scan comes back sorted,
    non-empty and plausible, and only a read taken a different way can say it
    is short.
    """

    def __init__(self, tables, table, stop_after):
        super().__init__(tables)
        self.stop_table, self.stop_after = table, stop_after

    def select(self, cols, count=None):
        q = super().select(cols, count)
        if self._t != self.stop_table:
            return q
        real_gt = q.gt

        def gt(col, val):
            if val >= self.stop_after:
                q.rows = []
            return real_gt(col, val)

        q.gt = gt
        return q


class TestReadProdActuallyRunsTheCanary(unittest.TestCase):
    """Found by mutation. Deleting `assert_scan_is_whole(sb, "financial_facts",
    ...)` from read_prod left every test green, because the suite exercised the
    canary in isolation and never asserted that the caller reaches for it. An
    assertion helper nothing calls is documentation with an exit code.
    """

    def test_a_truncated_financial_facts_scan_fails_the_whole_read(self):
        sb = TruncatingScan(
            {"financial_facts": FACTS, "sec_filings": FILINGS,
             "companies": COMPANIES, "cik_tickers": []},
            "financial_facts", 200,
        )
        with self.assertRaisesRegex(TOOL.CouldNotRun, "truncated"):
            TOOL.read_prod(sb, log=lambda *a, **k: None)

    def test_a_truncated_sec_filings_scan_fails_the_whole_read(self):
        sb = TruncatingScan(
            {"financial_facts": FACTS, "sec_filings": FILINGS,
             "companies": COMPANIES, "cik_tickers": []},
            "sec_filings", 100,
        )
        with self.assertRaisesRegex(TOOL.CouldNotRun, "truncated"):
            TOOL.read_prod(sb, log=lambda *a, **k: None)


class TestReadProd(unittest.TestCase):
    def test_a_short_companies_pagination_is_caught_against_count_exact(self):
        class ShortPage(FakeSupabase):
            def select(self, cols, count=None):
                q = super().select(cols, count)
                if self._t == "companies" and count is None:
                    q.rows = q.rows[:2]  # the page lies, the count does not
                return q

        sb = ShortPage({"financial_facts": FACTS, "sec_filings": FILINGS,
                        "companies": COMPANIES, "cik_tickers": []})
        with self.assertRaisesRegex(TOOL.CouldNotRun, "count=exact says"):
            TOOL.read_prod(sb, log=lambda *a, **k: None)

    def test_a_clean_read_reports_the_universe_it_actually_saw(self):
        raw = TOOL.read_prod(fake(), log=lambda *a, **k: None)
        self.assertEqual(raw["fact_ciks"], [100, 200, 300, 400])
        self.assertEqual(raw["filing_ciks"], [100, 200, 500])


class TestExitCodes(unittest.TestCase):
    """0 clean, 1 findings, 2 COULD NOT RUN. Two is never a pass."""

    def test_missing_credentials_exit_two_and_not_zero(self):
        keep = dict(os.environ)
        for k in ("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL",
                  "SUPABASE_SERVICE_ROLE_KEY"):
            os.environ.pop(k, None)
        keep_env = TOOL._client
        try:
            def no_creds():
                raise TOOL.CouldNotRun("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.")
            TOOL._client = no_creds
            rc = TOOL.main(["--quiet"])
        finally:
            TOOL._client = keep_env
            os.environ.clear()
            os.environ.update(keep)
        self.assertEqual(rc, TOOL.EXIT_COULD_NOT_RUN)
        self.assertNotEqual(rc, TOOL.EXIT_CLEAN)

    def test_an_unexpected_exception_exits_two_and_not_zero(self):
        keep = TOOL._client
        try:
            def boom():
                raise TimeoutError("statement timeout")
            TOOL._client = boom
            rc = TOOL.main(["--quiet"])
        finally:
            TOOL._client = keep
        self.assertEqual(rc, TOOL.EXIT_COULD_NOT_RUN)

    def test_a_missing_expectations_file_exits_two_rather_than_flooding(self):
        with self.assertRaisesRegex(TOOL.CouldNotRun, "is missing"):
            TOOL.load_expectations("/nonexistent/cik_expectations.json")

    def test_the_shipped_expectations_file_loads(self):
        exp = TOOL.load_expectations()
        self.assertIn("no_facts", exp)
        self.assertIn("no_company_row", exp)


if __name__ == "__main__":
    unittest.main()
