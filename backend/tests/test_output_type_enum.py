"""
Schema guard for the THIRD output_type list, the Python one.

THE FAILURE THIS EXISTS TO CATCH
--------------------------------
`outputs.output_type` is `public.output_type_enum`. Postgres rejects a
non-member with SQLSTATE 22P02, and the supabase client returns that without
raising, so `record_output` swallows it into a log line inside a pipeline step
nobody watches. A list that claims a value the enum does not have therefore
fails silently, forever, at runtime only. 'company_overview' did exactly that on
the TypeScript side and every Coverage Primer page view re-billed a model call.

There were three statements of one fact and only one of them was guarded:

  A. `OutputType` in backend/outputs.py
     written by: a developer editing Python. Had drifted to 14 members.
  B. `OUTPUT_TYPES` in src/lib/outputs.ts
     written by: a developer editing TypeScript. Guarded since #818 by
     src/lib/outputs.enum.test.ts.
  C. `public.output_type_enum`
     written by: Postgres. Captured verbatim into
     tests/fixtures/output-type-enum.json by scripts/capture-output-type-enum.mjs
     via read-only PostgREST OpenAPI introspection. NOT hand-authored.

This file guards A against C, and guards A against the call sites, which are a
fourth writer again:

  D. every `output_type=` literal any module under backend/ actually passes to
     record_output / record_outputs_batch
     written by: whoever wrote that pipeline step.

WHY THIS IS NOT A TAUTOLOGY
---------------------------
No side is compared to itself and no side is derived from another. A is a hand
edit, C comes out of the database, D is recovered from the real source files by
parsing them with `ast` rather than by restating what they contain. `Literal` is
a typing construct with no runtime enforcement whatsoever, so D can and does
drift from A with nothing to notice.

WHAT THIS PROVES AND WHAT IT DOES NOT
-------------------------------------
PROVES: the Python list cannot gain a member the database will reject, and a
pipeline step cannot write an output_type the list does not carry.
DOES NOT PROVE: that the live database matches the snapshot right now. The
fixture is a point-in-time observation; re-capture it when a migration is
applied.

Run from the repo root:
    python -m unittest backend.tests.test_output_type_enum
"""
from __future__ import annotations

import ast
import json
import os
import sys
import typing
import unittest
from pathlib import Path

os.environ.setdefault("GEMINI_API_KEY", "dummy-key-not-used")
os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_ANON_KEY", "dummy-anon-not-used")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import outputs as outputs_module  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
BACKEND = REPO / "backend"
FIXTURE = REPO / "tests" / "fixtures" / "output-type-enum.json"
MIGRATIONS = REPO / "supabase" / "migrations"

RECORDERS = {"record_output", "record_outputs_batch"}


def _fixture() -> dict:
    with FIXTURE.open(encoding="utf8") as fh:
        return json.load(fh)


def _python_list() -> list[str]:
    """The Literal's members, read off the real type rather than retyped."""
    return list(typing.get_args(outputs_module.OutputType))


def _written_output_types() -> dict[str, list[str]]:
    """
    Every constant output_type any module under backend/ hands to a recorder.

    Recovered by parsing the source, not by grepping and not by importing: many
    of these modules build a Supabase client at import time. Two call shapes are
    in use and both are collected:

        record_output(sb, output_type='brief', ...)          keyword argument
        record_outputs_batch(sb, [{'output_type': 'x', ...}]) dict literal

    A non-constant output_type (a variable, an f-string) is invisible here and
    is NOT counted as a violation. This guard is a floor, not a census.
    """
    found: dict[str, list[str]] = {}

    def note(value: str, where: str) -> None:
        found.setdefault(value, [])
        if where not in found[value]:
            found[value].append(where)

    for path in sorted(BACKEND.rglob("*.py")):
        if "tests" in path.relative_to(BACKEND).parts:
            continue
        if path.name == "outputs.py":
            continue
        try:
            tree = ast.parse(path.read_text(encoding="utf8"), filename=str(path))
        except SyntaxError:  # pragma: no cover - a file that will not parse is a different failure
            continue

        rel = str(path.relative_to(REPO))

        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            fn = node.func
            name = fn.attr if isinstance(fn, ast.Attribute) else getattr(fn, "id", None)
            if name not in RECORDERS:
                continue

            for kw in node.keywords:
                if kw.arg == "output_type" and isinstance(kw.value, ast.Constant):
                    if isinstance(kw.value.value, str):
                        note(kw.value.value, f"{rel}:{kw.value.lineno}")

    # Batch rows are assembled elsewhere and only handed to the recorder later,
    # so the dict literals are collected file-wide rather than at the call node.
    for path in sorted(BACKEND.rglob("*.py")):
        if "tests" in path.relative_to(BACKEND).parts:
            continue
        if path.name == "outputs.py":
            continue
        try:
            tree = ast.parse(path.read_text(encoding="utf8"), filename=str(path))
        except SyntaxError:  # pragma: no cover
            continue
        rel = str(path.relative_to(REPO))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Dict):
                continue
            for key, value in zip(node.keys, node.values):
                if (
                    isinstance(key, ast.Constant)
                    and key.value == "output_type"
                    and isinstance(value, ast.Constant)
                    and isinstance(value.value, str)
                ):
                    note(value.value, f"{rel}:{value.lineno}")

    return found


class TestPythonListMatchesTheDatabaseEnum(unittest.TestCase):
    def test_no_python_output_type_is_rejected_by_the_enum(self):
        """
        A is a claim about C. Every member must either already be in the
        database as of the snapshot, or be added by a migration file on disk.
        """
        fx = _fixture()
        observed = set(fx["observed"])
        pending = {p["value"] for p in fx["pending"]}

        unbacked = [t for t in _python_list() if t not in observed and t not in pending]

        self.assertEqual(
            unbacked,
            [],
            "backend/outputs.py OutputType contains value(s) the database enum "
            f"will reject with 22P02, and no migration declares them: {unbacked}. "
            "Every write of these fails silently. Add a migration adding the "
            "value to output_type_enum and declare it in "
            "tests/fixtures/output-type-enum.json under 'pending'.",
        )

    def test_python_list_carries_every_member_the_enum_has(self):
        """
        The other direction. Not a correctness bug on its own, but it is what
        let three lists drift to 14, 15 and 16 members with nobody noticing.
        Keeping this exact means there is one true statement of what the column
        accepts, in each language, rather than three partial ones.
        """
        fx = _fixture()
        expected = set(fx["observed"]) | {p["value"] for p in fx["pending"]}
        actual = set(_python_list())

        self.assertEqual(
            actual,
            expected,
            "backend/outputs.py OutputType has drifted from the captured enum. "
            f"missing from Python: {sorted(expected - actual)}; "
            f"extra in Python: {sorted(actual - expected)}. "
            "Re-run scripts/capture-output-type-enum.mjs if the database moved.",
        )

    def test_every_pending_member_is_backed_by_a_migration_that_adds_it(self):
        """
        Mirrors the TypeScript guard. Comment-stripped before matching: a
        migration that only MENTIONS the statement inside a `--` comment (this
        one documents it in its header) must not satisfy the check.
        """
        import re

        for p in _fixture()["pending"]:
            path = MIGRATIONS / p["migration"]
            self.assertTrue(
                path.exists(),
                f'pending enum member "{p["value"]}" names migration '
                f'"{p["migration"]}", which does not exist in supabase/migrations',
            )
            raw = path.read_text(encoding="utf8")
            sql = re.sub(r"/\*[\s\S]*?\*/", " ", raw)
            sql = re.sub(r"--[^\n]*", " ", sql)
            stmt = re.compile(
                r"ALTER\s+TYPE\s+(?:public\.)?output_type_enum\s+ADD\s+VALUE\s+"
                r"(?:IF\s+NOT\s+EXISTS\s+)?'" + re.escape(p["value"]) + r"'",
                re.IGNORECASE,
            )
            self.assertRegex(
                sql,
                stmt,
                f'migration "{p["migration"]}" has no EXECUTABLE ALTER TYPE '
                f'output_type_enum ADD VALUE \'{p["value"]}\' statement '
                "(a mention inside a SQL comment does not count)",
            )


class TestEveryWrittenOutputTypeIsDeclared(unittest.TestCase):
    def test_call_sites_write_only_declared_output_types(self):
        """
        D against A. `Literal` is erased at runtime, so a pipeline step can pass
        anything and nothing objects until Postgres does, silently.
        """
        declared = set(_python_list())
        written = _written_output_types()

        undeclared = {v: w for v, w in written.items() if v not in declared}

        self.assertEqual(
            undeclared,
            {},
            "backend module(s) pass an output_type that backend/outputs.py "
            f"OutputType does not declare: {undeclared}. Literal is not enforced "
            "at runtime, so this reaches Postgres and 22P02s into a log.",
        )

    def test_the_scan_actually_found_call_sites(self):
        """
        A guard that silently scans nothing passes forever. If the recorder is
        renamed or the call shape changes, this goes red instead of the scan
        quietly returning an empty set and the guard above passing vacuously.
        """
        written = _written_output_types()
        self.assertGreaterEqual(
            len(written),
            5,
            "the ast scan found almost no output_type call sites; the recorder "
            f"names or call shapes have probably changed. found: {sorted(written)}",
        )


if __name__ == "__main__":
    unittest.main()
