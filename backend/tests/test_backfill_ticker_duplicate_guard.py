"""backfill_tickers must not write a ticker a different row already holds.

There is NO UNIQUE INDEX behind companies.ticker. Nothing in the database
refuses a second holder and nothing reports one, so the backfill wrote
duplicates freely: eleven symbols were carried by more than one row, and a
ticker follow in src/app/api/radar/follows/route.ts takes its display name
from whichever of them Postgres hands back first.

Runs against a FAKE CLIENT. No database is touched.
"""
from __future__ import annotations

import unittest

from backend.scripts.backfill_tickers import (
    CLEARED_TICKER_VIEW,
    JournalUnavailable,
    _ticker_already_held,
    load_cleared_tickers,
    write_ticker_guarded,
)


class _Resp:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, rows, writes=None):
        self.rows = rows
        self.writes = writes if writes is not None else []
        self.payload = None
        self.ticker = None
        self.exclude = None
        self.limited = None

    def select(self, *_a, **_k):
        return self

    def update(self, payload):
        self.payload = payload
        return self

    def eq(self, col, val):
        assert col == "id", col
        self.exclude = val
        return self

    def ilike(self, col, val):
        assert col == "ticker", col
        self.ticker = val
        return self

    def neq(self, col, val):
        assert col == "id", col
        self.exclude = val
        return self

    def limit(self, n):
        self.limited = n
        return self

    def execute(self):
        if self.payload is not None:
            self.writes.append((self.exclude, self.payload))
            return _Resp([])
        hits = [
            r
            for r in self.rows
            if (r["ticker"] or "").upper() == (self.ticker or "").upper()
            and r["id"] != self.exclude
        ]
        return _Resp(hits[: self.limited or len(hits)])


class _Client:
    def __init__(self, rows):
        self.rows = rows
        self.last = None

    def __init__(self, rows):  # noqa: F811
        self.rows = rows
        self.last = None
        self.writes = []

    def table(self, name):
        assert name == "companies", name
        self.last = _Query(self.rows, self.writes)
        return self.last


ROWS = [
    {"id": "row-nclh-real", "name": "Norwegian Cruise Line", "ticker": "NCLH"},
    {"id": "row-clearwater", "name": "Clearwater", "ticker": "CWAN"},
    {"id": "row-bare", "name": "NCLH", "ticker": None},
]


class DuplicateHolderGuard(unittest.TestCase):
    def test_reports_the_existing_holder_by_name(self):
        # This is the exact write that recreated the NCLH duplicate: the row
        # named "NCLH" matches Norwegian Cruise Line by acronym, correctly, and
        # the symbol is already carried.
        holder = _ticker_already_held(_Client(ROWS), "NCLH", "row-bare")
        self.assertEqual(holder, "Norwegian Cruise Line")

    def test_is_case_insensitive(self):
        # The duplicates in prod differ by case as well as by row.
        self.assertEqual(
            _ticker_already_held(_Client(ROWS), "nclh", "row-bare"),
            "Norwegian Cruise Line",
        )

    def test_allows_a_symbol_no_other_row_holds(self):
        self.assertIsNone(_ticker_already_held(_Client(ROWS), "MARA", "row-bare"))

    def test_does_not_count_the_row_being_written(self):
        # Re-running the backfill over a row that already carries the symbol
        # must not report the row against itself.
        self.assertIsNone(
            _ticker_already_held(_Client(ROWS), "NCLH", "row-nclh-real")
        )

    def test_asks_for_existence_not_a_count(self):
        c = _Client(ROWS)
        _ticker_already_held(c, "NCLH", "row-bare")
        # limit(1) is existence only. Its length is never read as a holder
        # count, which is the error that reported 192 when the number was 919.
        self.assertEqual(c.last.limited, 1)
        self.assertEqual(c.last.exclude, "row-bare")


class GuardedWriteRefusesTheDuplicate(unittest.TestCase):
    """Covers the DECISION NOT TO WRITE, not just the lookup.

    A test that exercises only _ticker_already_held stays green when the call
    is deleted from the write loop. That was true of the first version of this
    file and is exactly a guard with no proof behind it.
    """

    def test_a_held_symbol_produces_no_write_at_all(self):
        c = _Client(list(ROWS))
        outcome = write_ticker_guarded(c, "row-bare", "NCLH", "NCLH")
        self.assertEqual(outcome, "duplicate")
        self.assertEqual(c.writes, [], "a duplicate must not reach the database")

    def test_a_free_symbol_is_written_once(self):
        c = _Client(list(ROWS))
        outcome = write_ticker_guarded(c, "row-bare", "Marathon Digital", "MARA")
        self.assertEqual(outcome, "written")
        self.assertEqual(c.writes, [("row-bare", {"ticker": "MARA"})])


class _JournalQuery:
    def __init__(self, rows, fail=False):
        self.rows, self.fail = rows, fail
        self.lo = self.hi = None

    def select(self, *_a, **_k):
        return self

    def order(self, *_a, **_k):
        return self

    def range(self, lo, hi):
        self.lo, self.hi = lo, hi
        return self

    def execute(self):
        if self.fail:
            raise RuntimeError('{"code":"PGRST205","message":"Could not find the table"}')
        return _Resp(self.rows[self.lo : self.hi + 1])


class _JournalClient:
    def __init__(self, rows, fail=False):
        self.rows, self.fail = rows, fail

    def table(self, name):
        assert name == CLEARED_TICKER_VIEW, name
        return _JournalQuery(self.rows, self.fail)


class ClearedTickerJournal(unittest.TestCase):
    """A ticker cleared on purpose must not be re-proposed.

    0038 retired 'EP PR C' from both holders by hand. The backfill selects on
    ticker IS NULL, which is exactly the state that clear creates, and Finnhub
    returns the same symbol for the same name. Without the journal the clear
    reverses itself on the next run.
    """

    def test_reads_the_cleared_pairs(self):
        rows = [
            {"row_id": "row-a", "cleared_ticker": "EP PR C"},
            {"row_id": "row-b", "cleared_ticker": "NCLH"},
        ]
        got = load_cleared_tickers(_JournalClient(rows))
        self.assertEqual(got, {"row-a": {"EP PR C"}, "row-b": {"NCLH"}})

    def test_normalises_case_so_a_lowercase_match_still_blocks(self):
        rows = [{"row_id": "row-a", "cleared_ticker": " nclh "}]
        self.assertEqual(load_cleared_tickers(_JournalClient(rows)), {"row-a": {"NCLH"}})

    def test_pages_past_the_silent_1000_row_cap(self):
        rows = [
            {"row_id": "row-{}".format(i), "cleared_ticker": "T{}".format(i)}
            for i in range(1500)
        ]
        got = load_cleared_tickers(_JournalClient(rows))
        # A bare .execute() is capped at 1000 with no error, and a silently
        # short journal is a silently disabled guard.
        self.assertEqual(len(got), 1500)

    def test_an_unreadable_journal_refuses_to_run_rather_than_proceeding(self):
        # FAILS CLOSED, unlike the names_agree gate upstream. A missing journal
        # is indistinguishable from an empty one, and proceeding would
        # re-propose exactly what a human cleared.
        with self.assertRaises(JournalUnavailable):
            load_cleared_tickers(_JournalClient([], fail=True))


class GuardedWriteConsultsTheJournal(unittest.TestCase):
    """Covers the DECISION, not just the loader. Same lesson as the duplicate
    guard: a test that exercises only load_cleared_tickers stays green when the
    consult is deleted from the write path."""

    def test_a_cleared_ticker_produces_no_write_and_no_holder_lookup(self):
        c = _Client(list(ROWS))
        out = write_ticker_guarded(
            c, "row-ecp", "Energy Capital Partners", "EP PR C",
            {"row-ecp": {"EP PR C"}},
        )
        self.assertEqual(out, "cleared")
        self.assertEqual(c.writes, [], "a cleared ticker must not reach the database")

    def test_the_journal_is_consulted_before_the_duplicate_check(self):
        # Both guards would refuse NCLH. The journal reason is the specific one
        # and is the one worth printing.
        c = _Client(list(ROWS))
        out = write_ticker_guarded(
            c, "row-bare", "NCLH", "NCLH", {"row-bare": {"NCLH"}}
        )
        self.assertEqual(out, "cleared")
        self.assertEqual(c.writes, [])

    def test_a_clear_on_a_different_row_does_not_block_this_one(self):
        c = _Client(list(ROWS))
        out = write_ticker_guarded(
            c, "row-bare", "Marathon Digital", "MARA", {"some-other-row": {"MARA"}}
        )
        self.assertEqual(out, "written")
        self.assertEqual(c.writes, [("row-bare", {"ticker": "MARA"})])
