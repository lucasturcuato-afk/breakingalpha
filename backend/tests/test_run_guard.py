"""
Unit tests for run.py's ingest soft-fail guard (fix B).

run.py:68 previously called run_ingest() bare, so an ingest-tail failure (the
boost_watchlist_relevance 400 in run #141) crashed the whole pipeline and the
brief never generated. _run_ingest_guarded() now mirrors the steps 2-16
try/except: it catches, logs the traceback, and returns a degraded flag so the
pipeline continues to synthesize; _finalize_exit_code() then surfaces the run as
failed (exit 1) after the brief has generated, so it is never green-washed.

run.py imports ~18 heavy backend modules (one pulls in numpy), so we stub them
in sys.modules before importing `run`, isolating the orchestrator's own logic.
NO production calls.

Run from the repo root:
    python -m unittest backend.tests.test_run_guard
"""
import os
import sys
import types
import unittest
from unittest.mock import MagicMock

os.environ.setdefault("GEMINI_API_KEY", "dummy-key-not-used")
os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_ANON_KEY", "dummy-anon-not-used")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Stub every module run.py imports at top so importing it is offline + cheap and
# does not drag in numpy/network. Each becomes a MagicMock module.
_STUB_MODULES = [
    "ingest", "synthesize", "deal_extractor", "observe", "critique", "audit",
    "trend_mapper", "summarize", "thesis_grader", "pattern_memory",
    "source_credibility", "adversarial", "watchlist_sync", "user_synthesis",
    "user_signal_aggregator", "embedding_job", "thesis_generator",
    "sector_backfill", "brief_feedback_loop", "lead_preselect",
]
for _name in _STUB_MODULES:
    mod = types.ModuleType(_name)
    # ingest.run_ingestion + synthesize.run are imported by-name; give them attrs.
    mod.run_ingestion = MagicMock(name="run_ingestion")
    mod.run = MagicMock(name="run", return_value={})
    sys.modules.setdefault(_name, mod)

import run  # noqa: E402


class RunIngestGuardTest(unittest.TestCase):
    # The ingest-only degraded flag from #302 was unified into the shared
    # _DEGRADED_STEPS list that every step now uses; _run_ingest_guarded returns
    # just the count and records degradation centrally, and _finalize_exit_code
    # reads the shared flag. These tests assert the step-1 path on the new
    # contract (no regression).

    def setUp(self):
        run._DEGRADED_STEPS.clear()

    def test_guard_success_returns_count(self):
        with unittest.mock.patch.object(run, "run_ingest", return_value=42):
            count = run._run_ingest_guarded()
        self.assertEqual(count, 42)
        self.assertEqual(run._DEGRADED_STEPS, [], "success does not degrade")

    def test_guard_swallows_exception_and_flags_degraded(self):
        def _boom():
            raise RuntimeError("postgrest 400 Bad Request (URI too large)")
        with unittest.mock.patch.object(run, "run_ingest", _boom):
            try:
                count = run._run_ingest_guarded()
            except Exception as e:  # must NOT propagate -> steps 2-16 can run
                self.fail(f"ingest failure propagated past the guard: {e!r}")
        self.assertEqual(count, 0)
        self.assertEqual(len(run._DEGRADED_STEPS), 1, "ingest recorded on the shared flag")
        self.assertEqual(run._DEGRADED_STEPS[0][0], "[1/16] INGEST")
        self.assertEqual(run._finalize_exit_code(), 1, "shared flag -> exit 1")

    def test_finalize_exit_code_degraded_is_one(self):
        run._mark_degraded("[X] SOME STEP", RuntimeError("boom"))
        self.assertEqual(run._finalize_exit_code(), 1)

    def test_finalize_exit_code_healthy_is_zero(self):
        self.assertEqual(run._finalize_exit_code(), 0)


if __name__ == "__main__":
    unittest.main()
