"""Unit tests for morning-brief tape grounding (fix/morning-tape-grounding).

Root cause being pinned: tape grounding used to be gated behind
brief_type == "evening", so the morning brief received no index / VIX / regime
input and could write "risk-on surge" under a RISK-OFF banner. This fix grounds
the morning brief in the latest completed session close (the same values the
banner reads pre-open), with a SPLIT binding: the sentiment_word / market_tone /
backward-looking posture are bound to the prior-close regime, while the FORWARD
call (what_to_watch, the day's setup) is left free to diverge on overnight
catalysts.

No network and no DB: backend.synthesize builds its Supabase and Gemini clients
at import time from env vars, so dummy values are set BEFORE the import (client
construction is offline; nothing is sent). market_tape.fetch_tape is mocked.

Run from repo root: python -m unittest backend.tests.test_morning_tape_grounding
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

_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

import market_tape  # noqa: E402
import synthesize  # noqa: E402


def _stub_tape(regime="risk-off"):
    """Minimal tape dict shaped like market_tape.fetch_tape() output."""
    return {
        "quotes": {
            "^GSPC": {"pct": -2.64, "price": 5000.0},
            "^IXIC": {"pct": -4.18, "price": 16000.0},
            "^RUT": {"pct": -3.47, "price": 2000.0},
            "^VIX": {"pct": 39.7, "price": 21.5},
        },
        "regime": regime,
        "vix_level": 21.5,
    }


class MorningDirectiveConstruction(unittest.TestCase):
    """Prompt-construction assertions: no LLM call, pure string checks."""

    def test_prior_session_close_block_present(self):
        d = synthesize._build_morning_tape_directive(_stub_tape("risk-off"))
        # (a) labeled PRIOR SESSION CLOSE, never today's tape / how markets closed
        self.assertIn("[PRIOR SESSION CLOSE", d)
        self.assertNotIn("today's tape", d.lower())
        self.assertNotIn("how markets closed", d.lower())
        self.assertNotIn("close-of-day", d.lower())
        # Deterministic numbers carried through
        self.assertIn("S&P 500: -2.64%", d)
        self.assertIn("VIX: 21.5 (+39.7% vs prior close)", d)
        self.assertIn("Computed regime at prior close: RISK-OFF", d)

    def test_regime_subset_vocabulary_injected(self):
        d = synthesize._build_morning_tape_directive(_stub_tape("risk-off"))
        # (b) the regime-subset vocabulary is injected and bound
        vocab_line = next(l for l in d.splitlines() if "sentiment_word MUST" in l)
        self.assertIn(", ".join(market_tape.REGIME_VOCAB["risk-off"]), vocab_line)
        self.assertNotIn("buoyant", vocab_line)  # cross-regime word absent
        self.assertNotIn("mixed", vocab_line)
        self.assertIn("market_tone MUST be RISK-OFF", d)

    def test_forward_call_is_not_bound(self):
        d = synthesize._build_morning_tape_directive(_stub_tape("risk-off"))
        # (c) the FORWARD section is explicitly NOT bound to the prior-close regime
        self.assertIn("FORWARD-looking (what_to_watch", d)
        self.assertIn("FREE to diverge", d)
        self.assertIn("BACKWARD-looking", d)

    def test_neutral_regime_allows_mixed_tone(self):
        d = synthesize._build_morning_tape_directive(_stub_tape("neutral"))
        self.assertIn("market_tone MUST be NEUTRAL", d)
        self.assertIn("MIXED is also acceptable", d)
        self.assertIn(", ".join(market_tape.REGIME_VOCAB["neutral"]), d)

    def test_directive_survives_partial_tape(self):
        t = _stub_tape("risk-off")
        del t["quotes"]["^IXIC"]
        del t["quotes"]["^RUT"]
        d = synthesize._build_morning_tape_directive(t)
        self.assertIn("S&P 500: -2.64%", d)
        self.assertNotIn("Nasdaq", d)

    def test_no_em_dash_in_directive(self):
        em_dash = chr(0x2014)  # build the codepoint so the diff stays em-dash-free
        for regime in ("risk-off", "risk-on", "neutral"):
            d = synthesize._build_morning_tape_directive(_stub_tape(regime))
            self.assertNotIn(em_dash, d, f"em-dash in {regime} morning directive")

    def test_morning_system_prompt_has_split_binding_clause(self):
        sys_prompt = synthesize.MORNING_SYSTEM
        # The split binding clause is wired into the static morning prompt.
        self.assertIn("PRIOR SESSION CLOSE block is present above", sys_prompt)
        self.assertIn("BACKWARD-looking posture", sys_prompt)
        self.assertIn("FORWARD-looking setup", sys_prompt)
        self.assertIn("free to diverge", sys_prompt)


class MorningEnforcement(unittest.TestCase):
    """enforce_tape_consistency applied to a morning payload (same backstop)."""

    def test_out_of_subset_word_overridden_to_default(self):
        data = {"market_tone": "RISK-ON",
                "market_pulse": {"sentiment_word": "buoyant", "narrative": "x"}}
        warnings = market_tape.enforce_tape_consistency(data, "risk-off")
        self.assertEqual(data["market_pulse"]["sentiment_word"],
                         market_tape.REGIME_DEFAULT_WORD["risk-off"])
        self.assertEqual(data["market_tone"], "RISK-OFF")
        self.assertTrue(any("overriding" in w for w in warnings))

    def test_in_subset_word_passes_through(self):
        data = {"market_tone": "RISK-OFF",
                "market_pulse": {"sentiment_word": "heavy", "narrative": "x"}}
        warnings = market_tape.enforce_tape_consistency(data, "risk-off")
        self.assertEqual(data["market_pulse"]["sentiment_word"], "heavy")
        self.assertEqual(warnings, [])

    def test_enforcement_never_touches_forward_call(self):
        # what_to_watch is the morning FORWARD call; enforce must leave it alone.
        data = {
            "market_tone": "RISK-ON",
            "what_to_watch": "Futures point higher on an overnight chip rally.",
            "market_pulse": {"sentiment_word": "buoyant", "narrative": "x"},
        }
        market_tape.enforce_tape_consistency(data, "risk-off")
        self.assertEqual(
            data["what_to_watch"],
            "Futures point higher on an overnight chip rally.",
        )


class MorningSoftFail(unittest.TestCase):
    """Tape fetch fails: no block injected, regime None, no biased default."""

    def test_fetch_raises_injects_nothing(self):
        base = "BASE_SYSTEM_PROMPT"
        with mock.patch.object(synthesize.market_tape, "fetch_tape",
                               side_effect=RuntimeError("yahoo down")):
            system, regime = synthesize._maybe_inject_tape_directive("morning", base)
        self.assertEqual(system, base)          # unchanged
        self.assertIsNone(regime)               # no regime
        self.assertNotIn("PRIOR SESSION CLOSE", system)

    def test_unusable_tape_injects_nothing(self):
        base = "BASE_SYSTEM_PROMPT"
        with mock.patch.object(synthesize.market_tape, "fetch_tape", return_value=None):
            system, regime = synthesize._maybe_inject_tape_directive("morning", base)
        self.assertEqual(system, base)
        self.assertIsNone(regime)

    def test_no_regime_nulls_word_no_biased_default(self):
        data = {"market_tone": "MIXED",
                "market_pulse": {"sentiment_word": "buoyant", "narrative": "x"}}
        warnings = market_tape.enforce_tape_consistency(data, None)
        self.assertIsNone(data["market_pulse"]["sentiment_word"])
        self.assertTrue(any("ungrounded" in w for w in warnings))


class EveningUnchanged(unittest.TestCase):
    """Evening behavior must be byte-identical after the morning lift."""

    def test_evening_uses_close_of_day_directive(self):
        base = "BASE_SYSTEM_PROMPT"
        tape = _stub_tape("risk-off")
        with mock.patch.object(synthesize.market_tape, "fetch_tape", return_value=tape):
            system, regime = synthesize._maybe_inject_tape_directive("evening", base)
        # Identical to the original inline evening path: build_tape_directive + system.
        self.assertEqual(system, market_tape.build_tape_directive(tape) + base)
        self.assertEqual(regime, "risk-off")
        # Evening must NOT pick up the morning framing.
        self.assertNotIn("PRIOR SESSION CLOSE", system)

    def test_morning_and_evening_directives_differ(self):
        tape = _stub_tape("risk-off")
        morning = synthesize._build_morning_tape_directive(tape)
        evening = market_tape.build_tape_directive(tape)
        self.assertNotEqual(morning, evening)
        self.assertIn("[PRIOR SESSION CLOSE", morning)
        self.assertIn("[TAPE FACTS", evening)
        self.assertNotIn("PRIOR SESSION CLOSE", evening)


if __name__ == "__main__":
    unittest.main()
