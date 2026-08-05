"""
Generation must not weight on the immature learned signals.

Two signals, one root cause: both `source_credibility.win_rate` and
`pattern_library.win_rate` divide confirmations by a denominator that counts
UNRESOLVED theses (inconclusive, ungradable) as failures. Measured against
production, 18 of 22 sources read 0.0 and 24 of 27 pattern buckets read 0.0,
almost none of them because anything was wrong.

These tests exist because the removed wiring was silent. A cluster multiplied to
zero looks exactly like a weak cluster; a "boost" that can only ever subtract
15% looks exactly like a boost; and a prompt block headed "prefer thesis
framings that match high-win-rate patterns" looks exactly like a good
instruction even when the single qualifying row reads 0/7. Nothing failed
loudly, so nothing caught it for two phases.

The load-bearing test is
TestClusterStrengthIsUnweighted::test_strength_is_exactly_the_unweighted_score.
It pins the pipeline value to the scoring function, so ANY multiplier
reintroduced between them fails here, named.

Deliberately source-level rather than behavioural: both paths read module-level
caches and live tables, so the honest way to prove they are gone is to prove the
code is gone.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
TREND_MAPPER = BACKEND / "trend_mapper.py"
FEEDBACK_LOOP = BACKEND / "brief_feedback_loop.py"
SUMMARIZE = BACKEND / "summarize.py"
THESES_ROUTE = REPO / "src" / "app" / "api" / "theses" / "route.ts"


def _source(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _strip_docstrings(tree: ast.AST) -> ast.AST:
    """Drop the leading string expression from every module/class/function."""
    for node in ast.walk(tree):
        if not isinstance(
            node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)
        ):
            continue
        body = getattr(node, "body", None)
        if (
            body
            and isinstance(body[0], ast.Expr)
            and isinstance(body[0].value, ast.Constant)
            and isinstance(body[0].value.value, str)
        ):
            node.body = body[1:] or [ast.Pass()]
    return tree


def _code(path: Path) -> str:
    """Executable code only: no comments, no docstrings.

    The removal is documented in long comment and docstring blocks that
    necessarily NAME `source_credibility` and `_apply_source_credibility` in
    order to explain why they are gone. A naive substring search over the raw
    file matches that explanation and reports a false failure, which is exactly
    what happened when this file was first written. Round-tripping through the
    AST drops comments, and _strip_docstrings drops the rest.
    """
    tree = _strip_docstrings(ast.parse(_source(path)))
    return ast.unparse(tree)


#: `strength = <fn>(cluster, strength)` -- the shape every cluster-strength
#: multiplier took. Captures the function name so the test can assert on the set.
_STRENGTH_MULTIPLIER = re.compile(r"strength\s*=\s*(\w+)\(cluster,\s*strength\)")


def _ts_code(path: Path) -> str:
    """TypeScript source with whole-line `//` comments removed.

    Same problem as the Python files: the removal is documented in a comment
    block that necessarily quotes the prompt header it deleted, so asserting
    against raw source matches the explanation. Only lines whose first
    non-whitespace characters are `//` are dropped, so a `https://` inside a
    string literal is never touched and no real code can go missing.
    """
    return "\n".join(
        line
        for line in path.read_text(encoding="utf-8").splitlines()
        if not line.lstrip().startswith("//")
    )


def _find_dict_assign(path: Path, name: str) -> set[str]:
    """Return the literal string keys of `name = {...}` in a module."""
    found = None
    for node in ast.walk(ast.parse(_source(path))):
        if isinstance(node, ast.Assign):
            for tgt in node.targets:
                if isinstance(tgt, ast.Name) and tgt.id == name:
                    found = node.value
    assert isinstance(found, ast.Dict), f"{name} dict literal not found in {path.name}"
    return {k.value for k in found.keys if isinstance(k, ast.Constant)}


class TestTrendMapperHasNoCredibilityPath:
    def test_the_multiplier_function_is_gone(self):
        assert "_apply_source_credibility" not in _code(TREND_MAPPER)

    def test_the_loader_and_its_cache_are_gone(self):
        code = _code(TREND_MAPPER)
        for symbol in (
            "_get_source_win_rates",
            "_SOURCE_WIN_RATES",
            "_SOURCE_WIN_RATE_DEFAULT",
            "load_win_rates",
        ):
            assert symbol not in code, f"{symbol} still referenced in code"

    def test_source_credibility_is_not_imported(self):
        tree = ast.parse(_source(TREND_MAPPER))
        imported: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported.update(a.name for a in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported.add(node.module)
        assert "source_credibility" not in imported

    def test_no_lingering_reference_in_executable_code(self):
        assert "source_credibility" not in _code(TREND_MAPPER)


class TestClusterStrengthIsUnweighted:
    def test_the_base_score_still_feeds_the_pipeline(self):
        assert "score_cluster_strength(cluster)" in _code(TREND_MAPPER)

    def test_strength_is_exactly_the_unweighted_score(self):
        """THE load-bearing assertion.

        Every cluster-strength multiplier took the shape
        `strength = <fn>(cluster, strength)`. Both are now gone, so the set must
        be EMPTY. Any multiplier reintroduced between the base score and the
        persisted value fails here, named.
        """
        multipliers = set(_STRENGTH_MULTIPLIER.findall(_code(TREND_MAPPER)))
        assert multipliers == set(), (
            f"learned strength weighting reintroduced: {sorted(multipliers)}"
        )

    @pytest.mark.parametrize(
        "fn", ["_apply_source_credibility", "_apply_pattern_boost"]
    )
    def test_the_removed_multipliers_specifically_cannot_return(self, fn):
        assert fn not in _STRENGTH_MULTIPLIER.findall(_code(TREND_MAPPER))


class TestTrendMapperHasNoPatternPath:
    def test_the_boost_function_is_gone(self):
        assert "_apply_pattern_boost" not in _code(TREND_MAPPER)

    def test_the_loader_and_its_cache_are_gone(self):
        code = _code(TREND_MAPPER)
        for symbol in (
            "_get_pattern_sector_rates",
            "_PATTERN_SECTOR_RATES",
            "query_relevant_patterns",
        ):
            assert symbol not in code, f"{symbol} still referenced in code"

    def test_pattern_memory_is_not_imported(self):
        tree = ast.parse(_source(TREND_MAPPER))
        imported: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported.update(a.name for a in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported.add(node.module)
        assert "pattern_memory" not in imported

    def test_no_lingering_reference_in_executable_code(self):
        code = _code(TREND_MAPPER)
        assert "pattern_memory" not in code
        assert "pattern_library" not in code


class TestFeedbackAddendumHasNoLearnedSignals:
    @pytest.mark.parametrize(
        "symbol",
        ["source_credibility", "pattern_library", "top_sources", "top_patterns"],
    )
    def test_signal_is_not_queried_or_shipped(self, symbol):
        assert symbol not in _code(FEEDBACK_LOOP)

    def test_prompt_no_longer_asks_the_model_to_lean_into_anything(self):
        code = _code(FEEDBACK_LOOP)
        assert "to lean into" not in code
        # The two dimensions that remain are real brief-quality feedback.
        assert "Recurring weaknesses to avoid" in code


class TestWeeklyDigestAddendumHasNoPatterns:
    """summarize.py fed pattern win rates into the THESIS generation prompt and
    instructed the model to reproduce the percentages verbatim."""

    @pytest.mark.parametrize(
        "symbol",
        ["pattern_memory", "pattern_phrasings", "top_pattern_rows", "top_patterns"],
    )
    def test_pattern_plumbing_is_gone(self, symbol):
        assert symbol not in _code(SUMMARIZE)

    def test_the_verbatim_percentage_instruction_is_gone(self):
        code = _code(SUMMARIZE)
        assert "VERBATIM" not in code
        assert "must stay numerically" not in code

    def test_addendum_input_keys_are_the_expected_remainder(self):
        found = _find_dict_assign(SUMMARIZE, "addendum_input")
        assert found == {
            "recurring_soft_flags",
            "underrepresented_clusters",
            "recurring_themes",
            "total_missed_score10",
        }


class TestTheAggregatesPayloadStillWorks:
    """Removing keys must not break the payload the prompt is built from."""

    def test_aggregates_dict_keys_are_intact(self):
        assert _find_dict_assign(FEEDBACK_LOOP, "aggregates") == {
            "score_averages",
            "recurring_weaknesses",
            "n_briefs_analyzed",
        }


class TestThesesRouteHasNoPatternBlock:
    """The TS thesis generator injected a HISTORICAL PATTERN PERFORMANCE block
    telling the model to prefer framings matching high-win-rate patterns. The
    single qualifying row read 0/7."""

    def test_route_exists(self):
        assert THESES_ROUTE.is_file(), f"missing {THESES_ROUTE}"

    def test_pattern_library_is_not_queried(self):
        assert '.from("pattern_library")' not in _ts_code(THESES_ROUTE)

    def test_the_prompt_header_is_gone(self):
        code = _ts_code(THESES_ROUTE)
        assert "HISTORICAL PATTERN PERFORMANCE" not in code
        assert "high-win-rate patterns" not in code

    def test_pattern_block_is_a_neutral_empty_string(self):
        """The variable stays so the template literal keeps compiling, but it
        must be a constant empty string, never repopulated."""
        code = _ts_code(THESES_ROUTE)
        assert 'const patternBlock = "";' in code
        assert "patternBlock =" not in code.replace('const patternBlock = "";', "")


class TestModulesStillImportCleanly:
    """The removal must not leave a NameError behind a rarely-taken branch."""

    @pytest.mark.parametrize("path", [TREND_MAPPER, FEEDBACK_LOOP])
    def test_module_compiles(self, path):
        compile(_source(path), str(path), "exec")

    @pytest.mark.parametrize("path", [TREND_MAPPER, FEEDBACK_LOOP])
    def test_no_undefined_credibility_symbols_remain(self, path):
        """Catch a half-removal: a call left behind after its definition went."""
        tree = ast.parse(_source(path))
        called = {
            node.func.id
            for node in ast.walk(tree)
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
        }
        defined = {
            node.name
            for node in ast.walk(tree)
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        }
        for name in called:
            if "credibility" in name or "win_rate" in name:
                assert name in defined, f"{name} called but not defined"
