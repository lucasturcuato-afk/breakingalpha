"""Regression guard for the C1 candidate log: the LEAD-BAR verdict must persist.

THE DEFECT THIS PINS. impact_ranking.compute_unified_lead stamps `lead_barred` +
`lead_bar_reason` on every audit row on EVERY run, flag on or off. synthesize's
`_cand_c1` mapper, which turns those audit rows into the
preselect_decision.unified.candidates rows that actually reach Postgres, listed its
output keys by hand and did not copy them. Measured consequence: lead_barred=True on
0 of 292 stored candidates across 28 runs, while an offline replay of those SAME runs
with the SAME code fired the bar on 14 of 287 candidates. The bars were evaluating;
the log was blind.

A dict-literal mapper is exactly the kind of code that silently drops a field a
producer later adds, so this test asserts the contract structurally (AST over the
mapper's returned dict literal), not by running the pipeline. No network, no LLM.
"""
import ast
import os
import unittest

_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_SYNTH = os.path.join(_BACKEND, "synthesize.py")

# Keys the calibrator + the bar audit both depend on. Adding to this set is a
# deliberate contract change; removing one is the bug above.
REQUIRED_C1_KEYS = {
    "title", "cluster", "source", "is_shipped_lead", "components",
    "weighted_score", "below_cap", "lead_barred", "lead_bar_reason",
}


def _find_func(tree, name):
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            return node
    return None


def _returned_dict_keys(func):
    """The literal string keys of the dict this function returns."""
    for node in ast.walk(func):
        if isinstance(node, ast.Return) and isinstance(node.value, ast.Dict):
            return {k.value for k in node.value.keys
                    if isinstance(k, ast.Constant) and isinstance(k.value, str)}
    return set()


class TestC1CandidateShape(unittest.TestCase):
    def setUp(self):
        with open(_SYNTH, "r", encoding="utf-8") as fh:
            self.tree = ast.parse(fh.read(), filename=_SYNTH)

    def test_cand_c1_mapper_exists(self):
        self.assertIsNotNone(_find_func(self.tree, "_cand_c1"),
                             "synthesize._cand_c1 is the only writer of the C1 "
                             "candidate rows; if it was renamed, re-point this guard")

    def test_cand_c1_persists_the_lead_bar_verdict(self):
        keys = _returned_dict_keys(_find_func(self.tree, "_cand_c1"))
        missing = REQUIRED_C1_KEYS - keys
        self.assertFalse(missing, f"_cand_c1 drops C1 keys: {sorted(missing)}")

    def test_impact_ranking_audit_row_supplies_both_bar_fields(self):
        """The producer side: the audit row _cand_c1 reads from must emit both
        fields, or the mapper copies None forever and the log stays blind."""
        with open(os.path.join(_BACKEND, "impact_ranking.py"), "r", encoding="utf-8") as fh:
            ir_tree = ast.parse(fh.read())
        keys = _returned_dict_keys(_find_func(ir_tree, "_audit_row"))
        for k in ("lead_barred", "lead_bar_reason"):
            self.assertIn(k, keys, f"impact_ranking._audit_row no longer emits {k}")


if __name__ == "__main__":
    unittest.main()
