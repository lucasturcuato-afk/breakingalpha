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
from unittest import mock

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


_CPI_RELEASE = {
    "key": "cpi",
    "name": "CPI",
    "period": "May 2026",
    "figures": [
        {"label": "m/m (SA)", "value": 0.5, "unit": "%", "prior": 0.6},
        {"label": "y/y (NSA)", "value": 4.2, "unit": "%", "prior": 3.8},
    ],
}
_GDP_RELEASE = {
    "key": "gdp",
    "name": "Real GDP",
    "period": "Q1 2026",
    "figures": [{"label": "q/q annualized", "value": 1.6, "unit": "%", "prior": 0.5}],
}


class GatedMacroRead(unittest.TestCase):
    def test_read_produced_when_fired_nonempty(self):
        with mock.patch.object(
            synthesize, "gemini_generate",
            return_value='{"read": "Sticky inflation keeps the Fed on hold; fade rate-cut bets."}',
        ) as g:
            out = synthesize._generate_macro_read(["cpi"], [_CPI_RELEASE, _GDP_RELEASE], None)
        self.assertEqual(out, "Sticky inflation keeps the Fed on hold; fade rate-cut bets.")
        g.assert_called_once()

    def test_no_call_and_no_read_when_fired_empty(self):
        with mock.patch.object(synthesize, "gemini_generate") as g:
            out = synthesize._generate_macro_read([], [_CPI_RELEASE], None)
        self.assertIsNone(out)
        g.assert_not_called()  # no read call when nothing fired

    def test_read_exception_does_not_raise(self):
        with mock.patch.object(synthesize, "gemini_generate", side_effect=RuntimeError("boom")):
            out = synthesize._generate_macro_read(["cpi"], [_CPI_RELEASE], None)
        self.assertIsNone(out)

    def test_fired_key_not_in_releases_returns_none_without_call(self):
        with mock.patch.object(synthesize, "gemini_generate") as g:
            out = synthesize._generate_macro_read(["ppi"], [_CPI_RELEASE], None)
        self.assertIsNone(out)
        g.assert_not_called()

    def test_malformed_model_output_returns_none(self):
        with mock.patch.object(synthesize, "gemini_generate", return_value="not json at all"):
            out = synthesize._generate_macro_read(["cpi"], [_CPI_RELEASE], None)
        self.assertIsNone(out)

    def test_empty_read_string_returns_none(self):
        with mock.patch.object(synthesize, "gemini_generate", return_value='{"read": "   "}'):
            out = synthesize._generate_macro_read(["cpi"], [_CPI_RELEASE], None)
        self.assertIsNone(out)

    def test_read_grounds_on_tape_when_present(self):
        tape = {"regime": "risk-off", "vix_level": 22.5, "quotes": {}}
        captured = {}

        def fake_gen(system, user_content, **kwargs):
            captured["user"] = user_content
            return '{"read": "Risk-off tape amplifies the hot print."}'

        with mock.patch.object(synthesize, "gemini_generate", side_effect=fake_gen):
            out = synthesize._generate_macro_read(["cpi"], [_CPI_RELEASE], tape)
        self.assertTrue(out)
        # the deterministic prints and the tape both reach the prompt
        self.assertIn("CPI (May 2026)", captured["user"])
        self.assertIn("risk-off", captured["user"])

    def test_tape_formatting(self):
        self.assertEqual(synthesize._format_tape_for_read(None), "Market tape unavailable.")
        self.assertIn("regime", synthesize._format_tape_for_read({"regime": "neutral", "vix_level": 15.0}))


# ── Regression: the 2026-07-10 module-constant collision ─────────────────────
# A second module-level `_MACRO_MONTHS` (lowercase keys, added for
# _macro_period_month) shadowed the capitalized one used by
# _macro_period_ordinal. Every MONTHLY period stopped parsing, so monthly
# releases could never fire; quarterly GDP still parsed and still fired. That is
# exactly the prod signature: fired=[] on the 2026-08-07 payroll day and
# fired=['gdp'] on the 2026-07-30 GDP+PCE day. These cases replay the period
# dicts persisted on the real briefings rows, offline.
_PERIODS_AUG06 = {
    "cpi": "June 2026", "core_cpi": "June 2026", "ppi": "June 2026",
    "gdp": "Q2 2026", "pce": "June 2026", "core_pce": "June 2026",
    "unemployment": "June 2026", "nonfarm_payrolls": "June 2026",
}
_PERIODS_AUG07 = {**_PERIODS_AUG06, "unemployment": "July 2026", "nonfarm_payrolls": "July 2026"}
_PERIODS_JUL29 = {
    "cpi": "June 2026", "core_cpi": "June 2026", "ppi": "June 2026",
    "gdp": "Q1 2026", "pce": "May 2026", "core_pce": "May 2026",
    "unemployment": "June 2026", "nonfarm_payrolls": "June 2026",
}
_PERIODS_JUL30 = {
    "cpi": "June 2026", "core_cpi": "June 2026", "ppi": "June 2026",
    "gdp": "Q2 2026", "pce": "June 2026", "core_pce": "June 2026",
    "unemployment": "June 2026", "nonfarm_payrolls": "June 2026",
}


class MacroConstantCollision(unittest.TestCase):
    def test_no_module_level_constant_is_assigned_twice(self):
        """A duplicate module-level CONSTANT name silently rebinds the first
        definition for every reader below it. That is what broke detection for
        four weeks with no error, no log line and no failing import."""
        import ast
        import collections

        src = Path(synthesize.__file__).read_text()
        counts = collections.Counter()
        for node in ast.parse(src).body:
            if isinstance(node, ast.Assign):
                for target in node.targets:
                    name = getattr(target, "id", None)
                    if name and name.lstrip("_").isupper():
                        counts[name] += 1
        self.assertEqual(
            [n for n, c in counts.items() if c > 1], [],
            "module-level constant assigned more than once; the later one shadows the earlier",
        )

    def test_every_month_name_parses(self):
        months = [
            "January", "February", "March", "April", "May", "June", "July",
            "August", "September", "October", "November", "December",
        ]
        for i, m in enumerate(months, start=1):
            self.assertEqual(synthesize._macro_period_ordinal(f"{m} 2026"), (2026, i), m)

    def test_payroll_day_fires_both_series(self):
        self.assertEqual(
            synthesize.detect_fired_releases(_PERIODS_AUG06, _PERIODS_AUG07),
            ["nonfarm_payrolls", "unemployment"],
        )

    def test_gdp_pce_day_fires_all_three(self):
        self.assertEqual(
            synthesize.detect_fired_releases(_PERIODS_JUL29, _PERIODS_JUL30),
            ["core_pce", "gdp", "pce"],
        )

    def test_non_release_day_stays_empty(self):
        self.assertEqual(
            synthesize.detect_fired_releases(_PERIODS_AUG06, _PERIODS_AUG06), []
        )


if __name__ == "__main__":
    unittest.main()
