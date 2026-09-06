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
    _ticker_already_held,
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
