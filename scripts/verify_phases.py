"""
verify_phases.py — Signalera Phase 2-6 verification harness

Imports every new module, probes every new Supabase table / column, and
prints a ✅ / ❌ summary. On any ❌ the corresponding module-level DDL
constant is printed so the operator can paste it straight into the
Supabase SQL editor.

This script is read-only — it performs a single `.limit(1).execute()`
against each table/column combination it validates. It never writes.

Usage
-----
    cd backend && python ../scripts/verify_phases.py

It must be run from a working directory where `backend/` is on
sys.path so that module imports resolve. A safeguard below adds
`backend/` to sys.path automatically when the script is invoked from
the repo root.
"""

from __future__ import annotations

import os
import sys
import traceback
from dataclasses import dataclass, field


# ---------------------------------------------------------------------------
# sys.path bootstrap — allow running from either `backend/` or repo root
# ---------------------------------------------------------------------------
HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(HERE, ".."))
BACKEND = os.path.join(REPO_ROOT, "backend")
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)


# ---------------------------------------------------------------------------
# Env bootstrap — load .env.local (repo root) and map NEXT_PUBLIC_* fallbacks
# so backend modules using SUPABASE_URL / SUPABASE_ANON_KEY can import cleanly
# whether or not the operator has already exported the variables.
# ---------------------------------------------------------------------------
def _load_dotenv_quiet(path: str) -> None:
    if not os.path.isfile(path):
        return
    try:
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                key = key.strip()
                val = val.strip().strip('"').strip("'")
                os.environ.setdefault(key, val)
    except Exception:
        pass


_load_dotenv_quiet(os.path.join(REPO_ROOT, ".env.local"))
_load_dotenv_quiet(os.path.join(REPO_ROOT, ".env"))

# NEXT_PUBLIC_* → SUPABASE_URL / SUPABASE_ANON_KEY fallback
if "SUPABASE_URL" not in os.environ and "NEXT_PUBLIC_SUPABASE_URL" in os.environ:
    os.environ["SUPABASE_URL"] = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
if (
    "SUPABASE_ANON_KEY" not in os.environ
    and "NEXT_PUBLIC_SUPABASE_ANON_KEY" in os.environ
):
    os.environ["SUPABASE_ANON_KEY"] = os.environ["NEXT_PUBLIC_SUPABASE_ANON_KEY"]


# ---------------------------------------------------------------------------
# Result accumulator
# ---------------------------------------------------------------------------

@dataclass
class CheckResult:
    name: str
    ok: bool
    detail: str = ""


@dataclass
class Report:
    results: list[CheckResult] = field(default_factory=list)
    failed_modules: set[str] = field(default_factory=set)

    def ok(self, name: str, detail: str = ""):
        self.results.append(CheckResult(name, True, detail))

    def fail(self, name: str, detail: str, module_tag: str | None = None):
        self.results.append(CheckResult(name, False, detail))
        if module_tag:
            self.failed_modules.add(module_tag)

    def print_summary(self):
        print()
        print("=" * 60)
        print("Signalera Phase Verification")
        print("=" * 60)
        n_pass = sum(1 for r in self.results if r.ok)
        n_fail = len(self.results) - n_pass
        for r in self.results:
            mark = "✅" if r.ok else "❌"
            line = f"{mark} {r.name}"
            if r.detail:
                line += f"  — {r.detail}"
            print(line)
        print("-" * 60)
        print(f"  passed: {n_pass}")
        print(f"  failed: {n_fail}")
        print("=" * 60)
        return n_fail == 0


# ---------------------------------------------------------------------------
# Module import checks
# ---------------------------------------------------------------------------

def check_imports(report: Report) -> dict[str, object]:
    modules: dict[str, object] = {}
    for name in (
        "thesis_grader",
        "pattern_memory",
        "adversarial",
        "source_credibility",
    ):
        try:
            modules[name] = __import__(name)
            report.ok(f"import {name}")
        except Exception as e:
            report.fail(
                f"import {name}",
                f"{type(e).__name__}: {e}",
                module_tag=name,
            )
    return modules


# ---------------------------------------------------------------------------
# Schema probes
# ---------------------------------------------------------------------------

def _probe(supabase, table: str, select: str):
    """Return (ok, detail). Soft-fail; never raises."""
    try:
        supabase.table(table).select(select).limit(1).execute()
        return True, ""
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"


def check_theses_columns(report: Report, supabase) -> None:
    """Verify every new column added to `theses` across phases 2-4."""
    columns = [
        # Phase 2
        "horizon",
        "check_after",
        "verifiable_signal",
        "ticker",
        "outcome",
        "outcome_notes",
        "outcome_checked_at",
        # Phase 3
        "signal_breakdown",
        # Phase 4
        "bear_case",
        "adversarial_score",
        "passed_adversarial",
    ]
    for col in columns:
        ok, detail = _probe(supabase, "theses", f"id, {col}")
        if ok:
            report.ok(f"theses.{col}")
        else:
            report.fail(
                f"theses.{col}",
                detail,
                module_tag=(
                    "adversarial"
                    if col in ("bear_case", "adversarial_score", "passed_adversarial")
                    else "thesis_grader"
                ),
            )


def check_pattern_library(report: Report, supabase) -> None:
    ok, detail = _probe(
        supabase,
        "pattern_library",
        "pattern_key, sector, horizon, dominant_signal, "
        "n_observed, n_confirmed, n_invalidated, win_rate, last_updated",
    )
    if ok:
        report.ok("table pattern_library")
    else:
        report.fail("table pattern_library", detail, module_tag="pattern_memory")


def check_source_credibility(report: Report, supabase) -> None:
    ok, detail = _probe(
        supabase,
        "source_credibility",
        "source, n_theses, n_confirmed, n_invalidated, win_rate, updated_at",
    )
    if ok:
        report.ok("table source_credibility")
    else:
        report.fail(
            "table source_credibility", detail, module_tag="source_credibility",
        )


# ---------------------------------------------------------------------------
# DDL dumping for failed modules
# ---------------------------------------------------------------------------

DDL_CONSTANTS = {
    "thesis_grader": ("THESES_GRADING_DDL", "Phase 2+3 theses columns"),
    "pattern_memory": ("PATTERN_LIBRARY_DDL", "Phase 3 pattern_library table"),
    "adversarial": ("ADVERSARIAL_DDL", "Phase 4 adversarial columns on theses"),
    "source_credibility": (
        "SOURCE_CREDIBILITY_DDL",
        "Phase 5 source_credibility table",
    ),
}


def _extract_ddl_from_source(module_name: str, const_name: str) -> str | None:
    """
    Fallback DDL extractor: parse the module file directly and pull the
    named string constant. Used when the module failed to import (for
    example, due to Python-version mismatches on the verifier host).
    """
    try:
        import ast

        path = os.path.join(BACKEND, f"{module_name}.py")
        if not os.path.isfile(path):
            return None
        with open(path, "r", encoding="utf-8") as fh:
            tree = ast.parse(fh.read())
        for node in tree.body:
            if isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Name) and target.id == const_name:
                        if isinstance(node.value, ast.Constant) and isinstance(
                            node.value.value, str
                        ):
                            return node.value.value
        return None
    except Exception:
        return None


def dump_ddl_for_failures(report: Report, modules: dict[str, object]) -> None:
    if not report.failed_modules:
        return
    print()
    print("=" * 60)
    print("DDL TO RUN IN SUPABASE SQL EDITOR")
    print("=" * 60)
    for tag in sorted(report.failed_modules):
        const_name, label = DDL_CONSTANTS.get(tag, (None, None))
        if not const_name:
            continue
        mod = modules.get(tag)
        ddl = None
        if mod is not None:
            ddl = getattr(mod, const_name, None)
        if not ddl:
            ddl = _extract_ddl_from_source(tag, const_name)
        if not ddl:
            print(
                f"\n-- {label} (module {tag}: unable to locate {const_name})"
            )
            continue
        print(f"\n-- {label}")
        print(ddl.strip())
    print()


# ---------------------------------------------------------------------------
# main()
# ---------------------------------------------------------------------------

def main() -> int:
    report = Report()
    modules = check_imports(report)

    # Only probe tables if at least one module imported successfully — the
    # Supabase client lives inside the modules themselves.
    supabase = None
    for tag in ("thesis_grader", "pattern_memory", "adversarial", "source_credibility"):
        mod = modules.get(tag)
        if mod is not None and hasattr(mod, "supabase"):
            supabase = getattr(mod, "supabase")
            break

    if supabase is None:
        report.fail(
            "supabase client bootstrap",
            "no imported module exposed a supabase client",
        )
    else:
        try:
            check_theses_columns(report, supabase)
            check_pattern_library(report, supabase)
            check_source_credibility(report, supabase)
        except Exception as e:
            report.fail(
                "schema probe harness",
                f"{type(e).__name__}: {e}\n{traceback.format_exc()}",
            )

    all_passed = report.print_summary()
    dump_ddl_for_failures(report, modules)
    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(main())
