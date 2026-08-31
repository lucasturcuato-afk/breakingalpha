"""companies.sec_cik must not be stamped from a bare ticker join.

Regression cover for three defects found in prod on 2026-08-31:

  1. SILENT TRUNCATION. _update_companies_sec_cik read cik_tickers with a
     bare .execute(), which PostgREST caps at 1000 rows with no error. The
     table holds 11,072, so the job saw 9 percent of it, matched nothing it
     had not already matched, and reported companies_updated=0 as a success
     on every hourly run.
  2. LAST-WRITE-WINS on duplicate tickers, which resolved XOM to
     'ExxonMobil Holdings Corp' instead of 'EXXON MOBIL CORP'.
  3. NO NAME CHECK and NO EXISTENCE GUARD, while the mint-time twin
     (entity_resolver.populate_sec_cik_for_mint) had the existence guard.
     Same column, two policies.

Every write path here runs against a FAKE CLIENT. No database is touched.
"""
from __future__ import annotations

import unittest

from backend.edgar.cik_mapping import (
    _build_ticker_index,
    _page_all,
    _update_companies_sec_cik,
)
from backend.edgar.name_agreement import names_agree


class _Resp:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, parent, table):
        self.p, self.t = parent, table
        self.filters = []
        self.lo, self.hi = None, None
        self.op = "select"
        self.payload = None

    def select(self, *_a, **_k):
        self.op = "select"
        return self

    def update(self, payload):
        self.op, self.payload = "update", payload
        return self

    def order(self, *_a, **_k):
        return self

    def range(self, lo, hi):
        self.lo, self.hi = lo, hi
        return self

    def eq(self, col, val):
        self.filters.append((col, val))
        return self

    def execute(self):
        if self.op == "update":
            self.p.writes.append((self.t, self.payload, list(self.filters)))
            return _Resp([])
        rows = list(self.p.tables.get(self.t, []))
        for col, val in self.filters:
            rows = [r for r in rows if r.get(col) == val]
        self.p.reads.append((self.t, self.lo, self.hi))
        if self.lo is None:
            # PostgREST's DEFAULT MAX-ROWS CAP, silent by design.
            return _Resp(rows[: self.p.cap])
        return _Resp(rows[self.lo : self.hi + 1])


class FakeSB:
    """Offline supabase-py shim with PostgREST's silent 1000-row cap."""

    def __init__(self, tables, cap=1000):
        self.tables, self.cap = tables, cap
        self.writes, self.reads = [], []

    def table(self, name):
        return _Query(self, name)


def _mapping(cik, ticker, name):
    return {"cik": cik, "ticker": ticker, "company_name": name}


class PaginationTests(unittest.TestCase):
    def test_page_all_reads_past_the_silent_1000_row_cap(self):
        rows = [_mapping(i, f"T{i}", f"Co {i}") for i in range(1, 11073)]
        sb = FakeSB({"cik_tickers": rows})
        got = _page_all(sb, "cik_tickers", "cik, ticker, company_name", "cik")
        self.assertEqual(len(got), 11072)

    def test_bare_execute_would_have_returned_only_the_cap(self):
        """Pins the defect itself, so a regression is visible as a diff."""
        rows = [_mapping(i, f"T{i}", f"Co {i}") for i in range(1, 11073)]
        sb = FakeSB({"cik_tickers": rows})
        self.assertEqual(len(sb.table("cik_tickers").select("*").execute().data), 1000)


class DuplicateTickerTests(unittest.TestCase):
    def test_duplicate_ticker_resolves_to_smallest_cik(self):
        idx = _build_ticker_index([
            _mapping(34088, "XOM", "EXXON MOBIL CORP"),
            _mapping(2115436, "XOM", "ExxonMobil Holdings Corp"),
        ])
        self.assertEqual(idx["XOM"], (34088, "EXXON MOBIL CORP"))

    def test_matches_entity_resolver_rule_on_paramount(self):
        idx = _build_ticker_index([
            _mapping(1826011, "PARA", "Banzai International, Inc."),
            _mapping(813828, "PARA", "Paramount Global"),
        ])
        self.assertEqual(idx["PARA"][0], 813828)


class NameAgreementTests(unittest.TestCase):
    def test_fails_open_without_an_authority_name(self):
        for absent in (None, "", "   "):
            agrees, why = names_agree("Anything", absent)
            self.assertTrue(agrees, why)
            self.assertIn("fail-open", why)

    def test_blocks_the_named_prod_cross_wires(self):
        for ours, registrant in [
            ("Ola", "COCA COLA CO"),
            ("Vanguard", "AMERICAN VANGUARD CORP"),
            ("Gett", "Rigetti Computing, Inc."),
            ("AXT Inc.", "BAXTER INTERNATIONAL INC"),
            ("Fidelity", "Fidelity National Information Services, Inc."),
            ("BYD", "BOYD GAMING CORP"),
            ("CSL", "CARLISLE COMPANIES INC"),
            ("AWS", "Jaws Mustang Acquisition Corp"),
        ]:
            self.assertFalse(names_agree(ours, registrant)[0], f"{ours} / {registrant}")

    def test_admits_the_rows_a_fail_closed_gate_would_have_blanked(self):
        for ours, registrant in [
            ("Electronic Arts", "ELECTRONIC ARTS INC"),
            ("Chart Industries", "CHART INDUSTRIES INC"),
            ("Twist Bioscience Corp", "Twist Bioscience Corp"),
            ("Apple", "Apple Inc."),
            ("Alight, Inc.", "Alight, Inc. / Delaware"),
        ]:
            self.assertTrue(names_agree(ours, registrant)[0], f"{ours} / {registrant}")


class UpdateCompaniesTests(unittest.TestCase):
    def _run(self, companies, mappings, cap=1000):
        sb = FakeSB({"companies": companies, "cik_tickers": mappings}, cap=cap)
        return sb, _update_companies_sec_cik(sb)

    def test_stamps_a_clean_match(self):
        sb, stats = self._run(
            [{"id": "c1", "name": "Apple", "ticker": "AAPL", "sec_cik": None}],
            [_mapping(320193, "AAPL", "Apple Inc.")],
        )
        self.assertEqual(stats["updated"], 1)
        self.assertEqual(sb.writes, [("companies", {"sec_cik": 320193}, [("id", "c1")])])

    def test_name_gate_blocks_the_ola_coca_cola_stamp(self):
        sb, stats = self._run(
            [{"id": "c1", "name": "Ola", "ticker": "KO", "sec_cik": None}],
            [_mapping(21344, "KO", "COCA COLA CO")],
        )
        self.assertEqual(stats["blocked_name"], 1)
        self.assertEqual(stats["updated"], 0)
        self.assertEqual(sb.writes, [], "no write may reach the database")

    def test_gate_never_clears_an_existing_cik(self):
        sb, stats = self._run(
            [{"id": "c1", "name": "Exxon", "ticker": "XOM", "sec_cik": 34088}],
            [
                _mapping(34088, "XOM", "EXXON MOBIL CORP"),
                _mapping(2115436, "XOM", "ExxonMobil Holdings Corp"),
            ],
        )
        self.assertEqual(sb.writes, [])
        self.assertEqual(stats["updated"], 0)

    def test_existence_guard_refuses_a_second_holder(self):
        sb, stats = self._run(
            [
                {"id": "held", "name": "Apple Inc.", "ticker": "AAPL", "sec_cik": 320193},
                {"id": "dupe", "name": "Apple", "ticker": "AAPL", "sec_cik": None},
            ],
            [_mapping(320193, "AAPL", "Apple Inc.")],
        )
        self.assertEqual(stats["blocked_holder"], 1)
        self.assertEqual(sb.writes, [])

    def test_fails_open_when_cik_tickers_has_no_registrant_name(self):
        sb, stats = self._run(
            [{"id": "c1", "name": "Whatever Holdings", "ticker": "WAT", "sec_cik": None}],
            [{"cik": 999, "ticker": "WAT", "company_name": None}],
        )
        self.assertEqual(stats["updated"], 1, "staleness must not block a write")

    def test_reads_every_page_so_a_late_ticker_is_still_matched(self):
        """The prod failure: the target ticker sat past row 1000."""
        mappings = [_mapping(i, f"T{i}", f"Co {i}") for i in range(1, 11073)]
        mappings.append(_mapping(320193, "AAPL", "Apple Inc."))
        sb, stats = self._run(
            [{"id": "c1", "name": "Apple", "ticker": "AAPL", "sec_cik": None}],
            mappings,
        )
        self.assertEqual(stats["updated"], 1)


if __name__ == "__main__":
    unittest.main()
