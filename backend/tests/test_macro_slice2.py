"""Unit tests for macro render slice 2: release detection (phase 1) and the
gated read (phase 2).

No network and no DB: backend.synthesize constructs its Supabase and Gemini
clients at import time from env vars, so dummy values are set BEFORE the import
(client construction is offline; nothing is sent). The Gemini read call is
mocked in the phase-2 tests.

Run from repo root: python -m unittest backend.tests.test_macro_slice2
"""
import os
import sys
import unittest
from pathlib import Path

# Dummy env so importing synthesize does not raise on missing keys. These never
# leave the process; no client makes a network call at construction.
os.environ.setdefault("SUPABASE_URL", "http://localhost")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service")
os.environ.setdefault("GEMINI_API_KEY", "test-gemini")

# synthesize.py uses bare sibling imports (from ingest, from outputs, ...) that
# resolve only with backend/ on sys.path, the same cwd=backend/ context the
# pipeline runs run.py in. Import it that way, not as backend.synthesize.
_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

import synthesize  # noqa: E402


class DetectFiredReleases(unittest.TestCase):
    def test_advance_fires(self):
        self.assertEqual(
            synthesize.detect_fired_releases({"cpi": "April 2026"}, {"cpi": "May 2026"}),
            ["cpi"],
        )

    def test_same_period_does_not_fire(self):
        self.assertEqual(
            synthesize.detect_fired_releases({"cpi": "May 2026"}, {"cpi": "May 2026"}),
            [],
        )

    def test_cold_start_no_prior_does_not_fire(self):
        # No previous row at all.
        self.assertEqual(synthesize.detect_fired_releases({}, {"cpi": "May 2026"}), [])
        self.assertEqual(synthesize.detect_fired_releases(None, {"cpi": "May 2026"}), [])

    def test_key_missing_from_previous_does_not_fire(self):
        # gdp present in both and unchanged; cpi is new (absent from previous).
        self.assertEqual(
            synthesize.detect_fired_releases(
                {"gdp": "Q1 2026"},
                {"gdp": "Q1 2026", "cpi": "May 2026"},
            ),
            [],
        )

    def test_value_change_without_period_change_does_not_fire(self):
        # Detection is on periods only; identical period never fires, even if the
        # underlying numbers were revised.
        self.assertEqual(
            synthesize.detect_fired_releases({"cpi": "May 2026"}, {"cpi": "May 2026"}),
            [],
        )

    def test_backward_period_does_not_fire(self):
        self.assertEqual(
            synthesize.detect_fired_releases({"cpi": "May 2026"}, {"cpi": "April 2026"}),
            [],
        )

    def test_quarterly_advance_fires(self):
        self.assertEqual(
            synthesize.detect_fired_releases({"gdp": "Q1 2026"}, {"gdp": "Q2 2026"}),
            ["gdp"],
        )

    def test_year_rollover_advance_fires(self):
        self.assertEqual(
            synthesize.detect_fired_releases({"cpi": "December 2025"}, {"cpi": "January 2026"}),
            ["cpi"],
        )

    def test_multiple_fired_sorted(self):
        self.assertEqual(
            synthesize.detect_fired_releases(
                {"cpi": "April 2026", "core_pce": "March 2026", "gdp": "Q1 2026"},
                {"cpi": "May 2026", "core_pce": "April 2026", "gdp": "Q1 2026"},
            ),
            ["core_pce", "cpi"],
        )

    def test_unparseable_period_does_not_fire(self):
        self.assertEqual(
            synthesize.detect_fired_releases({"cpi": "???"}, {"cpi": "May 2026"}),
            [],
        )
        self.assertEqual(
            synthesize.detect_fired_releases({"cpi": "May 2026"}, {"cpi": "n/a"}),
            [],
        )

    def test_none_inputs_safe(self):
        self.assertEqual(synthesize.detect_fired_releases(None, None), [])

    def test_period_ordinal_parsing(self):
        self.assertEqual(synthesize._macro_period_ordinal("May 2026"), (2026, 5))
        self.assertEqual(synthesize._macro_period_ordinal("Q3 2026"), (2026, 3))
        self.assertIsNone(synthesize._macro_period_ordinal("May"))
        self.assertIsNone(synthesize._macro_period_ordinal(""))
        self.assertIsNone(synthesize._macro_period_ordinal(None))


if __name__ == "__main__":
    unittest.main()
