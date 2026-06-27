"""Unit tests for CIK-at-mint (Gate 2): backend/entity_resolver.

When a new company is minted and a ticker resolves, sec_cik is populated
from the LOCAL cik_tickers table (NO SEC HTTP call) so the row becomes
XBRL-eligible and converges with bulk-loaded rows on CIK identity.

Hermetic: a FakeSupabase serves canned cik_tickers / companies responses
and records every operation. No real DB, no network. UNM = Unum Group is
the known ticker under test (its real SEC CIK is 5513).

Run: python -m unittest backend.tests.test_cik_at_mint
"""
import unittest

from backend.entity_resolver import (
    lookup_cik_for_ticker,
    populate_sec_cik_for_mint,
)

# UNM = Unum Group, real SEC CIK.
UNM_CIK = 5513


class _Resp:
    def __init__(self, data):
        self.data = data


class _Query:
    """Chained query stub: records ops/filters, serves a canned response."""

    def __init__(self, parent, table):
        self.parent = parent
        self.table_name = table
        self.op = None
        self.payload = None
        self.filters = []

    def select(self, *_a, **_k):
        self.op = "select"
        return self

    def update(self, payload):
        self.op = "update"
        self.payload = payload
        return self

    def eq(self, col, val):
        self.filters.append((col, val))
        return self

    def execute(self):
        self.parent.calls.append(
            {
                "table": self.table_name,
                "op": self.op,
                "payload": self.payload,
                "filters": list(self.filters),
            }
        )
        data = self.parent._respond(self.table_name, self.op, self.filters)
        return _Resp(data)


class FakeSupabase:
    """
    Canned, offline supabase-py shim.

    cik_rows: list of {"cik", "ticker"} for the cik_tickers table.
    companies_by_cik: {cik: [ {"id"}... ]} returned for a sec_cik SELECT.
    """

    def __init__(self, cik_rows=None, companies_by_cik=None):
        self.cik_rows = cik_rows or []
        self.companies_by_cik = companies_by_cik or {}
        self.calls = []

    def table(self, name):
        return _Query(self, name)

    def _respond(self, table, op, filters):
        if table == "cik_tickers" and op == "select":
            want = dict(filters).get("ticker")
            return [r for r in self.cik_rows if r["ticker"] == want]
        if table == "companies" and op == "select":
            want_cik = dict(filters).get("sec_cik")
            return list(self.companies_by_cik.get(want_cik, []))
        # companies update: no rows needed by the code under test.
        return []

    def calls_to(self, table, op=None):
        return [
            c
            for c in self.calls
            if c["table"] == table and (op is None or c["op"] == op)
        ]


class LookupCikForTickerTests(unittest.TestCase):
    def test_resolves_known_ticker_offline(self):
        sb = FakeSupabase(cik_rows=[{"cik": UNM_CIK, "ticker": "UNM"}])
        self.assertEqual(lookup_cik_for_ticker(sb, "UNM"), UNM_CIK)
        # No SEC call possible: only cik_tickers was queried, nothing else.
        self.assertEqual(len(sb.calls_to("cik_tickers", "select")), 1)
        self.assertEqual(sb.calls, sb.calls_to("cik_tickers"))

    def test_uppercases_ticker_before_lookup(self):
        sb = FakeSupabase(cik_rows=[{"cik": UNM_CIK, "ticker": "UNM"}])
        self.assertEqual(lookup_cik_for_ticker(sb, "unm"), UNM_CIK)
        sel = sb.calls_to("cik_tickers", "select")[0]
        self.assertEqual(sel["filters"], [("ticker", "UNM")])

    def test_missing_ticker_returns_none(self):
        sb = FakeSupabase(cik_rows=[{"cik": UNM_CIK, "ticker": "UNM"}])
        self.assertIsNone(lookup_cik_for_ticker(sb, "ZZZZ"))

    def test_empty_ticker_returns_none_without_query(self):
        sb = FakeSupabase(cik_rows=[{"cik": UNM_CIK, "ticker": "UNM"}])
        self.assertIsNone(lookup_cik_for_ticker(sb, ""))
        self.assertEqual(len(sb.calls), 0)

    def test_share_class_rows_collapse_to_single_cik(self):
        # Same CIK, two class tickers -> one cik (trivial collapse).
        sb = FakeSupabase(
            cik_rows=[
                {"cik": 1067983, "ticker": "BRK.A"},
                {"cik": 1067983, "ticker": "BRK.B"},
            ]
        )
        self.assertEqual(lookup_cik_for_ticker(sb, "BRK.A"), 1067983)

    def test_multiple_ciks_picks_smallest_deterministically(self):
        # Data anomaly: one ticker maps to two distinct ciks.
        sb = FakeSupabase(
            cik_rows=[
                {"cik": 999, "ticker": "DUP"},
                {"cik": 111, "ticker": "DUP"},
            ]
        )
        self.assertEqual(lookup_cik_for_ticker(sb, "DUP"), 111)


class PopulateSecCikForMintTests(unittest.TestCase):
    def test_minting_unm_writes_cik_when_unclaimed(self):
        sb = FakeSupabase(
            cik_rows=[{"cik": UNM_CIK, "ticker": "UNM"}],
            companies_by_cik={},  # no existing holder
        )
        out = populate_sec_cik_for_mint(
            supabase=sb, company_id="mint-1", ticker="UNM"
        )
        self.assertEqual(out, UNM_CIK)

        # Dedup existence-check path was exercised: a companies SELECT on
        # sec_cik happened BEFORE the update.
        sel = sb.calls_to("companies", "select")
        self.assertEqual(len(sel), 1)
        self.assertEqual(sel[0]["filters"], [("sec_cik", UNM_CIK)])

        # And the minted row got the cik.
        upd = sb.calls_to("companies", "update")
        self.assertEqual(len(upd), 1)
        self.assertEqual(upd[0]["payload"], {"sec_cik": UNM_CIK})
        self.assertEqual(upd[0]["filters"], [("id", "mint-1")])

    def test_dedup_guard_skips_write_when_cik_already_held(self):
        # Another row already holds UNM's cik: do NOT mint a second holder.
        sb = FakeSupabase(
            cik_rows=[{"cik": UNM_CIK, "ticker": "UNM"}],
            companies_by_cik={UNM_CIK: [{"id": "existing-holder"}]},
        )
        out = populate_sec_cik_for_mint(
            supabase=sb, company_id="mint-2", ticker="UNM"
        )
        self.assertIsNone(out)

        # Existence check ran...
        self.assertEqual(len(sb.calls_to("companies", "select")), 1)
        # ...and crucially NO sec_cik update was written.
        self.assertEqual(len(sb.calls_to("companies", "update")), 0)

    def test_self_holder_is_not_treated_as_conflict(self):
        # If the only holder is THIS row (re-run idempotency), still write.
        sb = FakeSupabase(
            cik_rows=[{"cik": UNM_CIK, "ticker": "UNM"}],
            companies_by_cik={UNM_CIK: [{"id": "mint-3"}]},
        )
        out = populate_sec_cik_for_mint(
            supabase=sb, company_id="mint-3", ticker="UNM"
        )
        self.assertEqual(out, UNM_CIK)
        self.assertEqual(len(sb.calls_to("companies", "update")), 1)

    def test_unknown_ticker_writes_nothing(self):
        sb = FakeSupabase(cik_rows=[{"cik": UNM_CIK, "ticker": "UNM"}])
        out = populate_sec_cik_for_mint(
            supabase=sb, company_id="mint-4", ticker="ZZZZ"
        )
        self.assertIsNone(out)
        # No companies touch at all when the ticker has no cik.
        self.assertEqual(len(sb.calls_to("companies")), 0)


if __name__ == "__main__":
    unittest.main()
