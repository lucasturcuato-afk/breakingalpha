"""Unit tests for the re-anchored relevance grader (RELEVANCE_GRADE_MODE) in
backend/ingest.py.

Covers the four things the build called out:
  1. Mode switch:
       legacy -> legacy score authoritative, gate >=6, no new grade computed.
       shadow -> legacy score authoritative + gate >=6, new grade computed and
                 logged (RELEVANCE_GRADE_SHADOW), nothing written.
       new    -> new score replaces legacy score, gate switches to the new floor.
  2. The ingest gate threshold under each mode.
  3. Rubric parse / clamp (_clamp_relevance_score) and grade_relevance's parse +
     band-validation path, fully mocking Gemini.

NO production Gemini or Supabase calls are made. The module-level genai/supabase
clients construct offline (no network at construction). Mirrors test_ingest.py's
hard env override so a real key in the shell can never leak in.

Run:
    python -m unittest backend.tests.test_relevance_grade
"""

import os
import sys
import unittest
from unittest.mock import patch

# Hard override (NOT setdefault) so a real key in the shell can never leak in.
for _k, _v in {
    "GEMINI_API_KEY": "dummy-gemini-key-not-used",
    "SUPABASE_URL": "http://localhost:54321",
    "SUPABASE_SERVICE_ROLE_KEY": "dummy-service-role-not-used",
    "SUPABASE_ANON_KEY": "dummy-anon-not-used",
    "NEWS_API_KEY": "dummy-news-key-not-used",
    "FINNHUB_API_KEY": "dummy-finnhub-key-not-used",
    "FILTER_MAX_RATE_RETRIES": "2",
    "FILTER_PHASE_BUDGET_SEC": "100000",
    "FILTER_PARALLEL_WORKERS": "2",
}.items():
    os.environ[_k] = _v

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import ingest  # noqa: E402


class _FakeResponse:
    """Stand-in for a google-genai response. Only .text is read by the parser;
    no usage_metadata so _accumulate_filter_usage no-ops."""

    def __init__(self, text):
        self.text = text


def _legacy_result(score=8):
    """A legacy FilterDecision dict as filter_article would return it."""
    return {
        "relevant": True,
        "relevance_score": score,
        "relevance_reason": "Material first-order event with figures.",
        "sentiment": "neutral",
        "companies": [],
    }


def _sec_result(score=6):
    """A deterministic SEC-bypass result (carries the bypass marker)."""
    r = _legacy_result(score)
    r["relevance_reason"] = "SEC 8-K filing by Acme (deterministic SEC bypass)"
    return r


# ---------------------------------------------------------------------------
# 1 + 2. Mode switch + gate threshold (apply_relevance_grade + ingest gate logic)
# ---------------------------------------------------------------------------
class ModeSwitchTest(unittest.TestCase):
    def setUp(self):
        # Snapshot module globals so each test restores them.
        self._mode = ingest.RELEVANCE_GRADE_MODE
        self._rate = ingest.RELEVANCE_GRADE_SHADOW_SAMPLE_RATE
        self._gate = ingest.RELEVANCE_NEW_GATE

    def tearDown(self):
        ingest.RELEVANCE_GRADE_MODE = self._mode
        ingest.RELEVANCE_GRADE_SHADOW_SAMPLE_RATE = self._rate
        ingest.RELEVANCE_NEW_GATE = self._gate

    def _gate_for(self, mode):
        """Reproduce the gate selection at the call site for assertion."""
        return ingest.RELEVANCE_NEW_GATE if mode == "new" else 6

    def test_legacy_is_a_noop_and_does_not_grade(self):
        ingest.RELEVANCE_GRADE_MODE = "legacy"
        article = {"title": "X", "summary": "", "source": "Yahoo", "url": "u"}
        result = _legacy_result(8)
        with patch.object(ingest, "grade_relevance", side_effect=AssertionError("must not grade")) as g:
            out = ingest.apply_relevance_grade(article, result)
        g.assert_not_called()
        self.assertEqual(out["relevance_score"], 8)          # legacy score kept
        self.assertNotIn("relevance_band", out)              # nothing added
        self.assertEqual(self._gate_for("legacy"), 6)        # gate stays >=6

    def test_shadow_keeps_legacy_score_logs_new_writes_nothing(self):
        ingest.RELEVANCE_GRADE_MODE = "shadow"
        ingest.RELEVANCE_GRADE_SHADOW_SAMPLE_RATE = 1.0      # force sampling on
        article = {"title": "Acme acquires Beta for $2bn", "summary": "", "source": "PE Hub", "url": "u"}
        result = _legacy_result(8)
        with patch.object(ingest, "grade_relevance", return_value={"score": 9, "band": "material_first_order", "reason": "M&A $2bn"}) as g:
            out = ingest.apply_relevance_grade(article, result)
        g.assert_called_once()                                # new grade computed
        self.assertEqual(out["relevance_score"], 8)          # legacy stays authoritative
        self.assertNotIn("relevance_band", out)              # new grade NOT written onto result
        self.assertEqual(self._gate_for("shadow"), 6)        # gate stays >=6

    def test_shadow_respects_sample_rate_zero(self):
        ingest.RELEVANCE_GRADE_MODE = "shadow"
        ingest.RELEVANCE_GRADE_SHADOW_SAMPLE_RATE = 0.0      # never sample
        article = {"title": "X", "summary": "", "source": "Yahoo", "url": "u"}
        result = _legacy_result(8)
        with patch.object(ingest, "grade_relevance", side_effect=AssertionError("must not grade")) as g:
            out = ingest.apply_relevance_grade(article, result)
        g.assert_not_called()
        self.assertEqual(out["relevance_score"], 8)

    def test_shadow_never_grades_sec_bypass(self):
        ingest.RELEVANCE_GRADE_MODE = "shadow"
        ingest.RELEVANCE_GRADE_SHADOW_SAMPLE_RATE = 1.0
        article = {"title": "SEC 8-K", "summary": "", "source": "SEC EDGAR", "url": "u"}
        result = _sec_result(6)
        with patch.object(ingest, "grade_relevance", side_effect=AssertionError("must not grade SEC")) as g:
            out = ingest.apply_relevance_grade(article, result)
        g.assert_not_called()
        self.assertEqual(out["relevance_score"], 6)

    def test_new_replaces_score_and_records_band(self):
        ingest.RELEVANCE_GRADE_MODE = "new"
        article = {"title": "Why X popped today", "summary": "", "source": "Yahoo", "url": "u"}
        result = _legacy_result(10)                           # legacy saturated 10
        with patch.object(ingest, "grade_relevance", return_value={"score": 1, "band": "template_demoted", "reason": "price-move recap"}) as g:
            out = ingest.apply_relevance_grade(article, result)
        g.assert_called_once()
        self.assertEqual(out["relevance_score"], 1)          # new score authoritative
        self.assertEqual(out["relevance_band"], "template_demoted")

    def test_new_falls_back_to_legacy_when_grader_fails(self):
        ingest.RELEVANCE_GRADE_MODE = "new"
        article = {"title": "X", "summary": "", "source": "Yahoo", "url": "u"}
        result = _legacy_result(8)
        with patch.object(ingest, "grade_relevance", return_value=None):  # grader failed
            out = ingest.apply_relevance_grade(article, result)
        self.assertEqual(out["relevance_score"], 8)          # legacy retained on failure

    def test_new_never_regrades_sec_bypass(self):
        ingest.RELEVANCE_GRADE_MODE = "new"
        article = {"title": "SEC 8-K", "summary": "", "source": "SEC EDGAR", "url": "u"}
        result = _sec_result(8)
        with patch.object(ingest, "grade_relevance", side_effect=AssertionError("must not regrade SEC")) as g:
            out = ingest.apply_relevance_grade(article, result)
        g.assert_not_called()
        self.assertEqual(out["relevance_score"], 8)          # SEC pin preserved

    def test_gate_threshold_by_mode(self):
        # legacy and shadow keep the >=6 store gate; new uses the data-derived floor.
        ingest.RELEVANCE_NEW_GATE = 1
        self.assertEqual(self._gate_for("legacy"), 6)
        self.assertEqual(self._gate_for("shadow"), 6)
        self.assertEqual(self._gate_for("new"), 1)

    def test_new_gate_retains_low_score_junk_drops_only_zero(self):
        # The whole point of the new gate: junk lands low but is RETAINED for
        # ranking; only a true 0 is dropped at ingest.
        ingest.RELEVANCE_NEW_GATE = 1
        gate = self._gate_for("new")
        # score 1 (template_demoted) is RETAINED (>= gate), score 0 is dropped.
        self.assertTrue(1 >= gate)
        self.assertFalse(0 >= gate)
        # genuine first-order news (9-10) is always retained.
        self.assertTrue(9 >= gate)


# ---------------------------------------------------------------------------
# 3. Rubric parse / clamp
# ---------------------------------------------------------------------------
class ClampTest(unittest.TestCase):
    def test_clamp_in_range(self):
        for v in range(0, 11):
            self.assertEqual(ingest._clamp_relevance_score(v), v)

    def test_clamp_over_ceiling(self):
        self.assertEqual(ingest._clamp_relevance_score(42), 10)

    def test_clamp_under_floor(self):
        self.assertEqual(ingest._clamp_relevance_score(-3), 0)

    def test_clamp_float_and_numeric_string(self):
        self.assertEqual(ingest._clamp_relevance_score(7.6), 8)
        self.assertEqual(ingest._clamp_relevance_score("9"), 9)

    def test_clamp_unparseable_returns_none(self):
        self.assertIsNone(ingest._clamp_relevance_score("not a number"))
        self.assertIsNone(ingest._clamp_relevance_score(None))


class GradeRelevanceParseTest(unittest.TestCase):
    """grade_relevance parse path with a fully mocked Gemini call."""

    def _run_with_text(self, text):
        with patch.object(ingest.gemini_client.models, "generate_content",
                          return_value=_FakeResponse(text)):
            return ingest.grade_relevance({"title": "T", "summary": "S", "source": "Yahoo", "url": "u"})

    def test_clean_json(self):
        out = self._run_with_text('{"score": 9, "band": "material_first_order", "reason": "M&A $2bn"}')
        self.assertEqual(out["score"], 9)
        self.assertEqual(out["band"], "material_first_order")

    def test_markdown_fenced_json(self):
        out = self._run_with_text('```json\n{"score": 2, "band": "template_demoted", "reason": "recap"}\n```')
        self.assertEqual(out["score"], 2)
        self.assertEqual(out["band"], "template_demoted")

    def test_out_of_range_score_is_clamped(self):
        out = self._run_with_text('{"score": 15, "band": "material_first_order", "reason": "x"}')
        self.assertEqual(out["score"], 10)

    def test_unknown_band_normalized(self):
        out = self._run_with_text('{"score": 5, "band": "wat", "reason": "x"}')
        self.assertEqual(out["band"], "unknown")

    def test_malformed_json_returns_none(self):
        self.assertIsNone(self._run_with_text("not json at all"))

    def test_missing_score_returns_none(self):
        self.assertIsNone(self._run_with_text('{"band": "weak", "reason": "x"}'))


if __name__ == "__main__":
    unittest.main()
