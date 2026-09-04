"""Tests for backend/company_conflict.py, the 23505 lost-race recovery.

The defect these guard against is specific: `companies` has THREE unique
indexes, two of them partial, and the old recovery probed exactly one of them
(`.eq("name", ...)`). A conflict raised by companies_name_norm_unique
(UNIQUE lower(btrim(name)) WHERE sec_cik IS NULL) names a row spelled
differently in case or whitespace, so the exact-name probe returned zero rows
and the caller concluded the company did not exist. The row was sitting there.

Every fixture below uses the live Exxon cluster, because it is the case this
will hit most often and because it is the one where "resolve to the existing
row" resolves to a row that is itself a duplicate.
"""
import re
import unittest
from unittest.mock import MagicMock

from backend.company_conflict import (
    INDEX_PROBE_HINT,
    PROBE_EXACT_NAME,
    PROBE_LADDER,
    PROBE_NORM_NAME_ANY,
    PROBE_NORM_NAME_CIK_NULL,
    PROBE_SEC_CIK,
    CompanyConflictUnresolved,
    conflicting_index_name,
    escape_like,
    is_unique_violation,
    probe_order,
    resolve_conflicting_company,
)

# The live rows, read from prod 2026-09-04, SELECT only. Note the inversion:
# the busier row is the one with NO ticker and NO cik.
EXXONMOBIL = {
    "id": "ab4bcf16-d848-43a8-9020-5d012a812f89",
    "name": "ExxonMobil",
    "ticker": None,
    "sec_cik": None,
}
EXXON = {
    "id": "3fdd6b31-746b-4605-9da5-5bbff329eec1",
    "name": "Exxon",
    "ticker": "XOM",
    "sec_cik": 34088,
}


def _ilike_regex(pattern: str):
    """Postgres ILIKE semantics, faithfully enough for the escape to matter.

    A BARE `%` or `_` is a WILDCARD; `\\%`, `\\_` and `\\\\` are literals. The
    fake has to model this, not just strip the escapes: a fake that treats an
    unescaped `%` as a literal makes escape_like untestable, because deleting
    the escape changes nothing it can see. Found by mutation, which is the only
    way this kind of fidelity gap shows up.
    """
    out = []
    i = 0
    while i < len(pattern):
        ch = pattern[i]
        if ch == "\\" and i + 1 < len(pattern):
            out.append(re.escape(pattern[i + 1]))
            i += 2
            continue
        if ch == "%":
            out.append(".*")
        elif ch == "_":
            out.append(".")
        else:
            out.append(re.escape(ch))
        i += 1
    return re.compile("".join(out) + r"\Z", re.IGNORECASE | re.DOTALL)


class _Q:
    """Records one supabase-py chain and answers from a router callable."""

    def __init__(self, parent, table):
        self.parent = parent
        self.table_name = table
        self.op = None
        self.payload = None
        self.filters = []

    def select(self, cols):
        self.op, self.payload = "select", cols
        return self

    def insert(self, payload):
        self.op, self.payload = "insert", payload
        return self

    def upsert(self, payload, **kw):
        self.op, self.payload = "upsert", payload
        return self

    def update(self, payload):
        self.op, self.payload = "update", payload
        return self

    def eq(self, col, val):
        self.filters.append(("eq", col, val))
        return self

    def ilike(self, col, pattern):
        self.filters.append(("ilike", col, pattern))
        return self

    def is_(self, col, val):
        self.filters.append(("is", col, val))
        return self

    def limit(self, n):
        return self

    def execute(self):
        call = {
            "table": self.table_name,
            "op": self.op,
            "payload": self.payload,
            "filters": list(self.filters),
        }
        self.parent.calls.append(call)
        resp = MagicMock()
        resp.data = self.parent.router(call)
        return resp


class FakeDB:
    """A `companies` table that answers each probe the way Postgres would.

    `rows` is the live table. The router below evaluates each probe's filters
    against it, so the test never hand-feeds an answer per probe: the fixture
    is the DATA, and which probe finds what falls out of it. A test that
    hand-fed answers would pass no matter which probes ran.
    """

    def __init__(self, rows):
        self.rows = rows
        self.calls = []

    def table(self, name):
        return _Q(self, name)

    def router(self, call):
        if call["op"] != "select":
            return []
        out = list(self.rows)
        for kind, col, val in call["filters"]:
            if kind == "eq":
                out = [r for r in out if r.get(col) == val]
            elif kind == "is":
                assert val == "null", f"unexpected is_ value {val!r}"
                out = [r for r in out if r.get(col) is None]
            elif kind == "ilike":
                rx = _ilike_regex(val)
                out = [r for r in out if rx.match((r.get(col) or ""))]
        return out

    def selects(self):
        return [c for c in self.calls if c["op"] == "select"]

    def writes(self):
        return [c for c in self.calls if c["op"] in ("insert", "update", "upsert")]


def norm_index_error():
    exc = Exception(
        'duplicate key value violates unique constraint '
        '"companies_name_norm_unique"'
    )
    exc.code = "23505"
    exc.message = (
        'duplicate key value violates unique constraint '
        '"companies_name_norm_unique"'
    )
    return exc


def name_key_error():
    exc = Exception(
        'duplicate key value violates unique constraint "companies_name_key"'
    )
    exc.code = "23505"
    exc.message = (
        'duplicate key value violates unique constraint "companies_name_key"'
    )
    return exc


class NormIndexRecoveryTests(unittest.TestCase):
    """The case the exact-name probe cannot see."""

    def test_norm_index_conflict_resolves_a_row_the_exact_name_probe_misses(self):
        # We tried to insert "EXXONMOBIL". The winner is stored as
        # "ExxonMobil". `exc=None` so no index hint reorders the ladder and the
        # exact-name probe runs FIRST, exactly as the old code did. It returns
        # zero rows; the normalized probe returns the winner. Before this
        # module, the zero rows were the whole answer and the caller raised.
        db = FakeDB([EXXONMOBIL, EXXON])
        row = resolve_conflicting_company(
            supabase=db, name="EXXONMOBIL", exc=None
        )
        self.assertEqual(row["id"], EXXONMOBIL["id"])
        # Prove the exact-name probe genuinely ran and genuinely missed, so the
        # pass is not an accident of probe ordering.
        exact = [
            c
            for c in db.selects()
            if ("eq", "name", "EXXONMOBIL") in c["filters"]
        ]
        self.assertEqual(len(exact), 1)
        self.assertEqual(db.router(exact[0]), [])

    def test_the_index_hint_skips_straight_to_the_probe_that_can_answer(self):
        # With the index named, the normalized probe runs first and the
        # exact-name probe is never issued. One round trip, not two.
        db = FakeDB([EXXONMOBIL, EXXON])
        row = resolve_conflicting_company(
            supabase=db, name="EXXONMOBIL", exc=norm_index_error()
        )
        self.assertEqual(row["id"], EXXONMOBIL["id"])
        self.assertEqual(len(db.selects()), 1)
        self.assertIn(("ilike", "name", "EXXONMOBIL"), db.selects()[0]["filters"])

    def test_whitespace_only_difference_also_resolves(self):
        # btrim is the other half of the index expression. A needle with
        # surrounding whitespace matches nothing under ILIKE, which is why the
        # module strips before probing.
        db = FakeDB([EXXONMOBIL])
        row = resolve_conflicting_company(
            supabase=db, name="  ExxonMobil  ", exc=norm_index_error()
        )
        self.assertEqual(row["id"], EXXONMOBIL["id"])


class DuplicateWinnerPolicyTests(unittest.TestCase):
    """What happens when the row that won is itself a duplicate."""

    def test_resolves_to_the_conflicting_row_not_the_better_duplicate(self):
        # "ExxonMobil" (no ticker, no cik) and "Exxon" (XOM, cik 34088) are one
        # company in two rows. A lost race on "ExxonMobil" resolves to
        # "ExxonMobil". Resolving to "Exxon" would be a merge, and a merge has
        # no defensible default here: the busier row is the identifier-less one.
        db = FakeDB([EXXONMOBIL, EXXON])
        row = resolve_conflicting_company(
            supabase=db, name="ExxonMobil", exc=name_key_error()
        )
        self.assertEqual(row["id"], EXXONMOBIL["id"])
        self.assertEqual(row["name"], "ExxonMobil")
        self.assertIsNone(row["ticker"])
        self.assertIsNone(row["sec_cik"])

    def test_recovery_performs_no_writes(self):
        # Merge-neutral by construction: it cannot deepen an existing duplicate
        # because it never writes to companies.
        db = FakeDB([EXXONMOBIL, EXXON])
        resolve_conflicting_company(
            supabase=db, name="EXXONMOBIL", exc=norm_index_error()
        )
        self.assertEqual(db.writes(), [])

    def test_the_cik_null_probe_disambiguates_a_pair_the_broad_probe_cannot(self):
        # Two rows share a normalized name; one carries a cik and is therefore
        # OUTSIDE companies_name_norm_unique. Our insert writes sec_cik NULL, so
        # the row we collided with is the one inside the index. The cik-null
        # probe is the index's own predicate and picks it out. The broad probe
        # would see two and refuse.
        twin = dict(EXXONMOBIL, id="twin-id", sec_cik=99999)
        db = FakeDB([EXXONMOBIL, twin])
        row = resolve_conflicting_company(
            supabase=db, name="exxonmobil", exc=norm_index_error()
        )
        self.assertEqual(row["id"], EXXONMOBIL["id"])

    def test_ambiguous_probe_result_is_refused_rather_than_guessed(self):
        # Both candidates carry a cik, so the cik-null probe sees nothing and
        # the broad probe sees two. Picking either would be a coin flip on which
        # company a mention belongs to, so the handler raises instead. Reachable
        # whenever companies_name_norm_unique is absent or its predicate has
        # moved, which is exactly the window the follow-up widening PR opens.
        a = dict(EXXONMOBIL, id="dup-a", sec_cik=111)
        b = dict(EXXONMOBIL, id="dup-b", sec_cik=222)
        db = FakeDB([a, b])
        with self.assertRaises(CompanyConflictUnresolved):
            resolve_conflicting_company(
                supabase=db, name="exxonmobil", exc=None
            )


class LoudFailureTests(unittest.TestCase):
    def test_unrecovered_conflict_raises_and_never_returns_none(self):
        # The database said a row exists and no probe found it. Returning None
        # would read as "no such company" at every call site, which is the
        # silent wrong answer this whole module exists to prevent.
        db = FakeDB([])
        with self.assertRaises(CompanyConflictUnresolved) as ctx:
            resolve_conflicting_company(
                supabase=db, name="Nowhere Corp", exc=norm_index_error()
            )
        msg = str(ctx.exception)
        self.assertIn("UNRECOVERED", msg)
        self.assertIn("Nowhere Corp", msg)
        # The probes it ran are named, so the log says what was looked at.
        self.assertIn(PROBE_EXACT_NAME, msg)
        self.assertIn(PROBE_NORM_NAME_CIK_NULL, msg)

    def test_stored_side_whitespace_is_a_known_gap_and_it_fails_loudly(self):
        """The one shape the ladder cannot reach, pinned so it stays honest.

        The index folds BOTH sides: `lower(btrim(name))`. `ilike` folds case on
        both sides but trims NEITHER, and PostgREST cannot express a function
        call on a column, so a winner stored with surrounding whitespace is
        unreachable by any probe here. Measured against the live REST API: a
        needle with surrounding spaces returns zero rows.

        What matters is the DEGRADATION. It raises, so the mention is dropped
        with a named log line, rather than resolving to some other row or
        answering "no such company". Closing it needs a generated column or an
        RPC; both are schema changes and neither belongs in this PR, which
        widens nothing.
        """
        stored_with_space = dict(EXXONMOBIL, name="ExxonMobil ")
        db = FakeDB([stored_with_space])
        with self.assertRaises(CompanyConflictUnresolved):
            resolve_conflicting_company(
                supabase=db, name="ExxonMobil", exc=norm_index_error()
            )

    def test_non_unique_error_is_not_classified_as_a_race(self):
        # The old test was a substring scan including "conflict", broad enough
        # to swallow unrelated failures as races. SQLSTATE wins when present.
        exc = Exception("could not serialize access due to conflict with concurrent update")
        exc.code = "40001"
        self.assertFalse(is_unique_violation(exc))

    def test_sqlstate_23505_is_a_race_whatever_the_message_says(self):
        exc = Exception("something opaque")
        exc.code = "23505"
        self.assertTrue(is_unique_violation(exc))

    def test_bare_exception_from_a_test_double_still_reads_as_a_race(self):
        self.assertTrue(
            is_unique_violation(
                Exception("duplicate key value violates unique constraint")
            )
        )


class LadderShapeTests(unittest.TestCase):
    def test_probe_order_hints_first_but_still_runs_every_probe(self):
        # The index name is a hint, not a filter. A ladder that trusted it to be
        # exhaustive would break silently the day PostgREST stops echoing it.
        order = probe_order("companies_name_norm_unique")
        self.assertEqual(order[0], PROBE_NORM_NAME_CIK_NULL)
        self.assertEqual(sorted(order), sorted(PROBE_LADDER))

    def test_unknown_index_runs_the_full_ladder_in_declared_order(self):
        # The order is spelled out, not compared to PROBE_LADDER. Comparing
        # probe_order's output to the constant probe_order returns is a
        # tautology: it passes for every possible order. Reordering the ladder
        # left this test green until the literal went in. Parity with the same
        # assertion in tests/unit/company-lost-race-recovery.test.ts.
        expected = (
            PROBE_EXACT_NAME,
            PROBE_NORM_NAME_CIK_NULL,
            PROBE_NORM_NAME_ANY,
            PROBE_SEC_CIK,
        )
        self.assertEqual(PROBE_LADDER, expected)
        self.assertEqual(probe_order("some_index_we_do_not_model"), expected)
        self.assertEqual(probe_order(None), expected)

    def test_every_hinted_probe_is_in_the_ladder(self):
        for index_name, probe in INDEX_PROBE_HINT.items():
            self.assertIn(probe, PROBE_LADDER, index_name)

    def test_conflicting_index_name_reads_the_index_off_the_message(self):
        self.assertEqual(
            conflicting_index_name(norm_index_error()),
            "companies_name_norm_unique",
        )
        self.assertEqual(
            conflicting_index_name(name_key_error()), "companies_name_key"
        )
        self.assertIsNone(conflicting_index_name(Exception("no index here")))


class WidenedIndexTests(unittest.TestCase):
    """Forward cover for the constraint-widening PR that follows this one."""

    def test_a_winner_carrying_a_cik_is_still_found(self):
        # Today companies_name_norm_unique is partial on `sec_cik IS NULL`, so
        # PROBE_NORM_NAME_CIK_NULL matches its predicate exactly. If that
        # predicate is dropped, the winner may carry a cik and that probe goes
        # blind. PROBE_NORM_NAME_ANY is what covers it, which is why the ladder
        # carries both and why this handler does not need to know which shape of
        # the index is in force.
        db = FakeDB([EXXON])
        row = resolve_conflicting_company(
            supabase=db, name="EXXON", exc=norm_index_error()
        )
        self.assertEqual(row["id"], EXXON["id"])
        cik_null_probe = [
            c for c in db.selects() if ("is", "sec_cik", "null") in c["filters"]
        ]
        self.assertEqual(len(cik_null_probe), 1)
        self.assertEqual(db.router(cik_null_probe[0]), [])

    def test_sec_cik_probe_covers_companies_sec_cik_unique(self):
        db = FakeDB([EXXON])
        row = resolve_conflicting_company(
            supabase=db,
            name="Some Other Spelling",
            sec_cik=34088,
            exc=Exception(
                'duplicate key value violates unique constraint '
                '"companies_sec_cik_unique"'
            ),
        )
        self.assertEqual(row["id"], EXXON["id"])
        self.assertEqual(probe_order("companies_sec_cik_unique")[0], PROBE_SEC_CIK)

    def test_sec_cik_probe_is_skipped_when_the_insert_carried_no_cik(self):
        # Both live insert paths write sec_cik NULL. Probing eq(sec_cik, None)
        # would match every identifier-less row in the table.
        db = FakeDB([EXXONMOBIL, EXXON])
        with self.assertRaises(CompanyConflictUnresolved):
            resolve_conflicting_company(
                supabase=db, name="Nowhere Corp", sec_cik=None, exc=None
            )
        self.assertEqual(
            [c for c in db.selects() if any(f[1] == "sec_cik" and f[0] == "eq"
                                            for f in c["filters"])],
            [],
        )


class NoNormalizerTests(unittest.TestCase):
    """The handler must work whichever name normalizer is declared canonical."""

    def test_the_probe_needle_is_the_raw_trimmed_name_not_a_normalizer_key(self):
        # v1 (normalize.normalize_lookup_key) would lowercase this; v2
        # (company_match.normalize_company_key) would additionally delete the
        # dot and strip the "Inc" suffix, yielding "acme". Either key sent as an
        # ILIKE needle finds nothing, because the stored value is the raw name.
        # The needle must be the name itself, trimmed, and Postgres does the
        # case fold.
        db = FakeDB([])
        with self.assertRaises(CompanyConflictUnresolved):
            resolve_conflicting_company(
                supabase=db, name="  Acme Inc.  ", exc=norm_index_error()
            )
        needles = [
            f[2]
            for c in db.selects()
            for f in c["filters"]
            if f[0] == "ilike"
        ]
        self.assertTrue(needles)
        for needle in needles:
            self.assertEqual(needle, "Acme Inc.")
            self.assertNotEqual(needle, "acme inc.")   # v1
            self.assertNotEqual(needle, "acme")        # v2

    def test_both_import_paths_yield_one_exception_class(self):
        # The backend's dual-path import convention loads a module twice, once
        # as `x` and once as `backend.x`, giving two copies of every class in
        # it. `except CompanyConflictUnresolved` compares class identity, so
        # two copies mean the except clause silently fails to match the raise.
        # entity_resolver imports the bare path; this file imports the package
        # path. They must be the same object.
        import company_conflict as bare
        import backend.company_conflict as pkg

        self.assertIs(bare, pkg)
        self.assertIs(
            bare.CompanyConflictUnresolved, pkg.CompanyConflictUnresolved
        )

    def test_module_imports_neither_normalizer(self):
        # A regression fence. The moment this module imports v1 or v2 it has
        # created a third definition of "same name", and a third definition that
        # disagrees with lower(btrim(name)) turns a recovery into a miss.
        import backend.company_conflict as mod

        source = open(mod.__file__).read()
        code = "\n".join(
            line for line in source.splitlines() if not line.strip().startswith("#")
        )
        body = code.split('"""', 2)[-1]
        self.assertNotIn("normalize_lookup_key", body)
        self.assertNotIn("normalize_company_key", body)


class EscapeLikeTests(unittest.TestCase):
    def test_percent_underscore_and_backslash_are_escaped(self):
        self.assertEqual(escape_like("50% off"), "50\\% off")
        self.assertEqual(escape_like("a_b"), "a\\_b")
        self.assertEqual(escape_like("a\\b"), "a\\\\b")

    def test_backslash_is_escaped_before_the_wildcards(self):
        # Escaping % first and \ second would double-escape the escape and turn
        # a literal percent back into a wildcard.
        self.assertEqual(escape_like("\\%"), "\\\\\\%")

    def test_a_name_with_a_wildcard_cannot_widen_into_a_wrong_answer(self):
        # "Exxon%" unescaped would ILIKE-match all three Exxon rows. Escaped, it
        # matches none of them, so the ladder raises instead of returning one of
        # the three at random.
        db = FakeDB([EXXONMOBIL, EXXON])
        with self.assertRaises(CompanyConflictUnresolved):
            resolve_conflicting_company(
                supabase=db, name="Exxon%", exc=norm_index_error()
            )


if __name__ == "__main__":
    unittest.main()
