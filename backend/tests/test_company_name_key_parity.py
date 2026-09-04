"""The drift alarm between sql/0039 and backend/company_match.py.

WHY THIS FILE EXISTS
--------------------
sql/0039_companies_name_norm_unique_widen.sql puts a UNIQUE index on
public.company_name_key(name). backend/company_match.py folds the same names
in Python to decide whether a company is already indexed. THAT IS TWO PATHS TO
ONE FACT, and nothing in Postgres can make a Python edit fail.

The drift is silent in the worst possible direction: it does not show up when
the two disagree, it shows up later, as an INSERT raising 23505 on a name the
application had already concluded was new. By then the pipeline is throwing on
live data and the cause is two files that were edited weeks apart.

This test reads BOTH ARTIFACTS DIRECTLY. It parses the suffix alternation out
of the SQL file rather than restating it, and it replays the SQL file's own
fixture table through the REAL imported normalize_company_key rather than
against a hand-written expectation. It cannot pass by agreeing with itself:
delete a token from either side and it goes red naming the token.

The drift it is guarding is not hypothetical. company_match.py's docstring
records that its EXTRA_SUFFIXES list is already a divergence from
sql/proposals/0020_normalize_lookup_key_v2.sql, whose list is BASE only. 0039
carries BASE + EXTRA precisely so that the index matches the application and
not the older proposal, and this test is what holds that true.
"""
import os
import re
import unittest

from backend.company_match import (
    BASE_SUFFIXES,
    EXTRA_SUFFIXES,
    normalize_company_key,
)

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.dirname(os.path.dirname(_HERE))
SQL_PATH = os.path.join(_REPO, "sql", "0039_companies_name_norm_unique_widen.sql")

INDEX_NAME = "companies_name_key_unique_idx"
FUNCTION_NAME = "public.company_name_key"


def _sql_text():
    with open(SQL_PATH, encoding="utf-8") as fh:
        return fh.read()


def _block(text, name):
    """Return the text between -- PARITY-<name>-BEGIN and -- PARITY-<name>-END."""
    m = re.search(
        r"PARITY-%s-BEGIN(?P<body>.*?)PARITY-%s-END" % (name, name),
        text,
        re.S,
    )
    if not m:
        raise AssertionError(
            "sql/0039 is missing the PARITY-%s-BEGIN/END markers. They are not "
            "decoration: this test reads the SQL through them, and without them "
            "the index expression and company_match.py have no guard at all." % name
        )
    return m.group("body")


def _unquote(sql_literal):
    """'Moody''s Analytics' -> Moody's Analytics"""
    return sql_literal[1:-1].replace("''", "'")


_LIT = r"'(?:[^']|'')*'"
_FIXTURE_RE = re.compile(
    r"company_name_key\(\s*(?P<inp>%s)\s*\)\s*=\s*(?P<exp>%s)\s+AS\s+f\d+" % (_LIT, _LIT)
)


class SuffixListParityTests(unittest.TestCase):
    """SIDE A (the index expression) must strip exactly what SIDE B strips."""

    def test_sql_suffix_alternation_equals_python_constants(self):
        body = _block(_sql_text(), "SUFFIXES")
        # Concatenate the adjacent SQL string literals the way the server does,
        # then read the alternation out of the assembled regex.
        joined = "".join(_unquote(lit) for lit in re.findall(_LIT, body))
        m = re.search(r"\\s\+\((?P<alt>[^)]*)\)\$", joined)
        self.assertIsNotNone(
            m,
            "could not find the \\s+(...)$ suffix alternation inside the "
            "PARITY-SUFFIXES block of sql/0039. Assembled: %r" % joined,
        )
        sql_tokens = tuple(m.group("alt").split("|"))
        python_tokens = tuple(BASE_SUFFIXES) + tuple(EXTRA_SUFFIXES)
        self.assertEqual(
            sql_tokens,
            python_tokens,
            "DRIFT. The index expression in sql/0039 and "
            "normalize_company_key in backend/company_match.py no longer strip "
            "the same suffix tokens.\n"
            "  only in SQL   : %s\n"
            "  only in python: %s\n"
            "Fix both files in one commit. Applying the index in this state "
            "makes ingest raise 23505 on names the application thinks are new."
            % (
                sorted(set(sql_tokens) - set(python_tokens)),
                sorted(set(python_tokens) - set(sql_tokens)),
            ),
        )

    def test_sql_does_not_silently_reorder_the_alternation(self):
        # Order is not semantically load-bearing in the regex, but a reordering
        # is the cheapest possible sign that one list was hand-retyped rather
        # than kept in step, so the equality above is deliberately ordered and
        # this names why.
        body = _block(_sql_text(), "SUFFIXES")
        joined = "".join(_unquote(lit) for lit in re.findall(_LIT, body))
        alt = re.search(r"\\s\+\((?P<alt>[^)]*)\)\$", joined).group("alt").split("|")
        self.assertEqual(
            alt[: len(BASE_SUFFIXES)],
            list(BASE_SUFFIXES),
            "the BASE block of the SQL alternation diverged from BASE_SUFFIXES",
        )
        self.assertEqual(
            alt[len(BASE_SUFFIXES):],
            list(EXTRA_SUFFIXES),
            "the EXTRA block of the SQL alternation diverged from EXTRA_SUFFIXES",
        )


class FixtureParityTests(unittest.TestCase):
    """SIDE A's own fixture table, replayed through SIDE B.

    The suffix list is only one of the ways these two can drift. This replays
    the behaviour end to end: v1 folding, dot and apostrophe deletion,
    punctuation to space, whitespace collapse, three suffix passes and the
    empty guard.
    """

    def test_fixture_table_is_present_and_non_trivial(self):
        fixtures = _FIXTURE_RE.findall(_block(_sql_text(), "FIXTURES"))
        self.assertGreaterEqual(
            len(fixtures),
            16,
            "sql/0039's fixture table shrank. It is the behavioural half of "
            "the drift guard; do not trim it.",
        )

    def test_every_sql_fixture_matches_the_real_python_normalizer(self):
        body = _block(_sql_text(), "FIXTURES")
        fixtures = _FIXTURE_RE.findall(body)
        self.assertTrue(fixtures, "no fixtures parsed out of sql/0039")
        for raw_in, raw_exp in fixtures:
            got = normalize_company_key(_unquote(raw_in))
            self.assertEqual(
                got,
                _unquote(raw_exp),
                "DRIFT on %r: sql/0039 asserts the index expression yields %r, "
                "backend/company_match.normalize_company_key yields %r."
                % (_unquote(raw_in), _unquote(raw_exp), got),
            )

    def test_the_european_suffix_cases_are_actually_covered(self):
        # EXTRA_SUFFIXES is the half that diverges from sql/proposals/0020, so
        # it is the half most likely to be dropped by someone syncing 0039 to
        # that proposal. Fail loudly rather than quietly losing the coverage.
        body = _block(_sql_text(), "FIXTURES")
        inputs = [_unquote(i) for i, _ in _FIXTURE_RE.findall(body)]
        covered = {
            tok
            for tok in EXTRA_SUFFIXES
            for name in inputs
            if name.lower().split()[-1:] == [tok]
        }
        self.assertTrue(
            covered,
            "no fixture in sql/0039 exercises any EXTRA_SUFFIXES token, so the "
            "fixture table can no longer detect 0039 being reverted to the "
            "BASE-only list in sql/proposals/0020",
        )


class IndexShapeTests(unittest.TestCase):
    """The index has to use the expression this file guards, and no predicate."""

    def test_the_create_statement_uses_the_guarded_function(self):
        text = _sql_text()
        m = re.search(
            r"CREATE UNIQUE INDEX CONCURRENTLY[^\n]*%s(?P<rest>.*?);" % INDEX_NAME,
            text,
            re.S,
        )
        self.assertIsNotNone(
            m,
            "sql/0039 no longer contains a CREATE UNIQUE INDEX CONCURRENTLY "
            "for %s. Everything this test guards is about that statement."
            % INDEX_NAME,
        )
        self.assertIn(
            FUNCTION_NAME + "(name)",
            m.group("rest"),
            "the index is no longer built on %s(name), so this parity test is "
            "guarding an expression the index does not use." % FUNCTION_NAME,
        )

    def test_the_index_is_not_partial(self):
        # The entire point of the change: unique REGARDLESS of sec_cik. A
        # predicate creeping back in would restore the defect while leaving
        # every other assertion here green.
        text = _sql_text()
        m = re.search(
            r"CREATE UNIQUE INDEX CONCURRENTLY[^\n]*%s(?P<rest>.*?);" % INDEX_NAME,
            text,
            re.S,
        )
        self.assertNotIn(
            "WHERE",
            m.group("rest").upper(),
            "sql/0039's index grew a WHERE predicate. A partial unique index "
            "is the defect this migration exists to remove: a row outside the "
            "predicate cannot collide with anything.",
        )

    def test_the_guard_query_measures_the_index_expression(self):
        # The guard has to BE the violation query for the index expression. A
        # guard over a different expression can return zero while the CREATE
        # still fails, which is exactly how an INVALID index gets built.
        text = _sql_text()
        m = re.search(
            r"1d\.(?P<body>.*?)(?=\n--\s*1e\.)", text, re.S
        )
        self.assertIsNotNone(m, "sql/0039 lost its phase 1d guard section")
        guard = m.group("body")
        self.assertIn(FUNCTION_NAME + "(name)", guard)
        self.assertIn("HAVING count(*) > 1", guard)
        self.assertIn("FROM public.companies", guard)
        # The guard must scan EVERY row. Only a row-level WHERE can narrow it,
        # so look between FROM and GROUP BY and nowhere else. Checking for the
        # bare word "WHERE" anywhere in the section is not the same test and
        # gives a false positive on the aggregate FILTER (WHERE ...) clauses
        # that decorate the output columns.
        row_scope = re.search(
            r"FROM public\.companies(?P<span>.*?)GROUP BY", guard, re.S
        )
        self.assertIsNotNone(row_scope, "guard query lost its FROM/GROUP BY shape")
        self.assertNotIn(
            "WHERE",
            row_scope.group("span").upper(),
            "the guard query grew a row-level WHERE clause, so it measures a "
            "subset of what the unpartitioned index will enforce and can "
            "return zero rows while the CREATE still fails",
        )


if __name__ == "__main__":
    unittest.main()
