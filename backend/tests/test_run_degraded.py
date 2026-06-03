"""
Unit tests for run.py's run-level degraded-visibility (no step green-washes).

Steps 1-16 and the [POST] feedback steps each catch-and-continue. #302 wired only
step 1 (ingest) to surface as a failed run; every other step left the run GREEN,
so a synthesize / embedding / scoring failure degraded the feed silently. Each
green-washing except now calls _mark_degraded(); _finalize_exit_code() exits 1 if
any step degraded, AFTER the brief generates. Control flow is unchanged: every
step still continues on failure.

We execute the REAL __main__ flow via runpy with every heavy step module replaced
by a MagicMock (one pulls in numpy; all do network), and catch the SystemExit
from the final _finalize_exit_code(). Asserting a later step still ran proves
"continue on failure"; the exit code proves visibility. NO production calls.

Run from the repo root:
    python -m unittest backend.tests.test_run_degraded
"""
import os
import runpy
import sys
import unittest
from unittest.mock import MagicMock

os.environ.setdefault("GEMINI_API_KEY", "dummy-key-not-used")
os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_ANON_KEY", "dummy-anon-not-used")

_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _BACKEND)
_RUN_PATH = os.path.join(_BACKEND, "run.py")

_STUBS = [
    "ingest", "synthesize", "deal_extractor", "observe", "critique", "audit",
    "trend_mapper", "summarize", "thesis_grader", "pattern_memory",
    "source_credibility", "adversarial", "watchlist_sync", "user_synthesis",
    "user_signal_aggregator", "embedding_job", "thesis_generator",
    "sector_backfill", "brief_feedback_loop", "lead_preselect", "backfill_content",
]


class RunDegradedTest(unittest.TestCase):

    def setUp(self):
        self._saved = {}
        for name in _STUBS:
            self._saved[name] = sys.modules.get(name)
            sys.modules[name] = MagicMock(name=name)
        # Defaults that let the whole flow run cleanly (happy path).
        sys.modules["ingest"].run_ingestion = MagicMock(return_value=7)
        sys.modules["synthesize"].run = MagicMock(return_value={"brief_text": "today's brief"})
        sys.modules["deal_extractor"].run = MagicMock(return_value={"upserted": 3})
        # Keep the addendum block from touching real Supabase: nothing to improve.
        sys.modules["brief_feedback_loop"].build_brief_improvement_addendum = MagicMock(return_value="")
        sys.argv = ["run.py", "morning"]
        os.environ["RUN_BACKFILL"] = "false"

    def tearDown(self):
        for name, mod in self._saved.items():
            if mod is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = mod

    def _run(self):
        """Execute run.py __main__; return its sys.exit code."""
        try:
            runpy.run_path(_RUN_PATH, run_name="__main__")
            return 0  # _finalize_exit_code always sys.exits, so we never get here
        except SystemExit as se:
            return se.code or 0

    # Happy path -------------------------------------------------------------
    def test_happy_path_exit_zero(self):
        self.assertEqual(self._run(), 0)

    # A mid-pipeline 2-16 step failing -> degraded + continues --------------
    def test_representative_step_failure_degrades_and_continues(self):
        sys.modules["critique"].score_run = MagicMock(side_effect=RuntimeError("critique boom"))
        code = self._run()
        self.assertEqual(code, 1, "a failed step surfaces the run as degraded")
        # A later step (8 SUMMARY) still ran -> continue-on-failure preserved.
        self.assertTrue(sys.modules["summarize"].print_summary.called)

    # embedding_job by name --------------------------------------------------
    def test_embedding_job_failure_degrades_and_continues(self):
        sys.modules["embedding_job"].main = MagicMock(side_effect=RuntimeError("embed boom"))
        code = self._run()
        self.assertEqual(code, 1)
        # A later step (15 USER SYNTHESIS) still ran.
        self.assertTrue(sys.modules["user_synthesis"].run.called)

    # [POST] BRIEF SCORING real failure -> degraded -------------------------
    def test_post_scoring_failure_degrades(self):
        sys.modules["synthesize"].run = MagicMock(return_value={"brief_text": "real brief"})
        sys.modules["brief_feedback_loop"].score_brief = MagicMock(side_effect=RuntimeError("score boom"))
        self.assertEqual(self._run(), 1)

    # Benign skips do NOT degrade -------------------------------------------
    def test_benign_no_brief_scoring_skip_stays_green(self):
        # No brief_text -> BRIEF SCORING benign-skips (not an exception).
        sys.modules["synthesize"].run = MagicMock(return_value={})
        self.assertEqual(self._run(), 0)

    def test_benign_addendum_nothing_to_improve_stays_green(self):
        # build_brief_improvement_addendum returns "" (falsy) -> skipped, no error.
        sys.modules["brief_feedback_loop"].build_brief_improvement_addendum = MagicMock(return_value="")
        self.assertEqual(self._run(), 0)

    # Step 1 ingest: unified onto the shared flag (no #302 regression) -------
    def test_step1_ingest_failure_degrades_and_brief_still_runs(self):
        sys.modules["ingest"].run_ingestion = MagicMock(side_effect=RuntimeError("ingest boom"))
        code = self._run()
        self.assertEqual(code, 1, "ingest failure still surfaces as failed (#302 behavior)")
        # The brief (step 3 synthesize) still generated from stored articles.
        self.assertTrue(sys.modules["synthesize"].run.called)


if __name__ == "__main__":
    unittest.main()
