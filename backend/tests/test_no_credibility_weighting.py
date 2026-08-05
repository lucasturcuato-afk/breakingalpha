"""
Generation must not weight on the old source_credibility signal.

These tests exist because the removed wiring was silent: a cluster multiplied to
zero looks exactly like a weak cluster, and a synthesis prompt naming a source
"to lean into" looks exactly like a good instruction. Nothing failed loudly, so
nothing caught it for two phases.

The load-bearing test is
TestClusterStrengthIsUnweighted::test_strength_is_exactly_the_unweighted_score.
It pins the pipeline value to the scoring function, so ANY multiplier
reintroduced between them fails here.

Deliberately source-level rather than behavioural: the credibility path read a
module-level cache and a live table, so the honest way to prove it is gone is to
prove the code is gone.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
TREND_MAPPER = BACKEND / "trend_mapper.py"
FEEDBACK_LOOP = BACKEND / "brief_feedback_loop.py"


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
        `strength = <fn>(cluster, strength)`. After this change the only one
        permitted is the BOUNDED pattern boost. Any third function reintroduced
        between the base score and the persisted value fails here, named.
        """
        multipliers = set(_STRENGTH_MULTIPLIER.findall(_code(TREND_MAPPER)))
        assert multipliers <= {"_apply_pattern_boost"}, (
            f"unbounded or unreviewed strength weighting reintroduced: "
            f"{sorted(multipliers - {'_apply_pattern_boost'})}"
        )

    def test_the_removed_multiplier_specifically_cannot_return(self):
        assert "_apply_source_credibility" not in _STRENGTH_MULTIPLIER.findall(
            _code(TREND_MAPPER)
        )

    def test_pattern_boost_if_present_is_still_bounded(self):
        """Not the target of this change, but it is the one multiplier left, so
        pin the fact that it has a floor and a ceiling."""
        src = _source(TREND_MAPPER)
        if "_apply_pattern_boost" in src:
            assert "max(0.85, min(1.15, mult))" in src


class TestFeedbackAddendumHasNoCredibility:
    def test_source_credibility_is_not_queried(self):
        assert "source_credibility" not in _code(FEEDBACK_LOOP)

    def test_top_sources_is_not_in_the_prompt_payload(self):
        assert "top_sources" not in _code(FEEDBACK_LOOP)

    def test_prompt_no_longer_asks_the_model_to_lean_into_sources(self):
        src = _source(FEEDBACK_LOOP)
        assert "patterns and sources to lean into" not in src
        assert "High-win-rate patterns to lean into" in src


class TestTheAggregatesPayloadStillWorks:
    """Removing a key must not break the payload the prompt is built from."""

    def test_aggregates_dict_keys_are_intact(self):
        src = _source(FEEDBACK_LOOP)
        tree = ast.parse(src)
        found = None
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign):
                for tgt in node.targets:
                    if isinstance(tgt, ast.Name) and tgt.id == "aggregates":
                        found = node.value
        assert isinstance(found, ast.Dict), "aggregates literal not found"
        keys = {k.value for k in found.keys if isinstance(k, ast.Constant)}
        assert keys == {
            "score_averages",
            "recurring_weaknesses",
            "n_briefs_analyzed",
            "top_patterns",
        }


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
