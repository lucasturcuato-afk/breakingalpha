"""Unit tests for the lead-thesis opener guard detector (fix/thesis-opener-reliability).

Deterministic, no LLM call and no network: imports synthesize (offline client
construction with dummy env) and exercises _is_opener_recap / _opener_first_sentence
on real openers harvested from the experiment. The re-ask (_regenerate_opener)
makes a live Gemini call and is verified separately in the PR validation, not here.

Run from repo root: python -m unittest backend.tests.test_opener_guard
"""
import os
import sys
import unittest
from pathlib import Path

os.environ.setdefault("SUPABASE_URL", "http://localhost")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service")
os.environ.setdefault("GEMINI_API_KEY", "test-gemini")

_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

import synthesize  # noqa: E402

# Real mood/index recap openers produced by the model across the experiment.
RECAPS = [
    "The market remains heavy, anchored by the prior session's broad index declines.",
    "Capital markets are heavy today, anchored by the prior session's broad index declines.",
    "Capital markets are entering the session with a defensive posture, anchored by the prior session's broad index declines and elevated volatility.",
    "Capital markets are in a defensive posture, anchored by broad index declines from the prior session.",
    "The market closed heavy today, driven by broad de-risking across major indices.",
    "Today's tape reflected broad de-risking, with major indices closing significantly lower as investors pulled back from risk assets.",
    "Today's tape was characterized by broad de-risking, with major indices closing significantly lower.",
    "The S&P 500 fell 0.57%, the Nasdaq Composite by 1.15%.",
    "Capital markets maintain a defensive posture following yesterday's broad index declines and a notable VIX spike.",
]

# Genuine named-driver / through-line openers that must pass.
THESES = [
    "Paramount Skydance (PSKY) securing China's approval for its $110 billion transaction was the day's pivotal event, signaling a thaw in cross-border media M&A.",
    "Despite a significant market debut from SpaceX, the broader market remains fragile, anchored by the prior session's broad index declines.",
    "The session sets up around this afternoon's FOMC decision; the deal flow underneath is secondary.",
    "Tech sold off while the Dow closed at a record, a rotation into cyclicals rather than broad de-risking.",
    "SpaceX's $60 billion acquisition reframes how the market prices pre-IPO scale.",
    "A soft aftermarket for Kokusai Electric would mark the USD945 million block as overpriced.",
    "Lockheed Martin's $10 billion award signals defense budgets are insulating the sector from the broad risk-off tape.",
]


class OpenerDetector(unittest.TestCase):
    def test_recaps_are_flagged(self):
        for s in RECAPS:
            recap, why = synthesize._is_opener_recap(s)
            self.assertTrue(recap, f"missed recap: {s!r}")
            self.assertTrue(why)

    def test_theses_pass(self):
        for s in THESES:
            recap, why = synthesize._is_opener_recap(s)
            self.assertFalse(recap, f"false-flagged thesis ({why}): {s!r}")

    def test_empty_is_recap(self):
        self.assertTrue(synthesize._is_opener_recap("")[0])
        self.assertTrue(synthesize._is_opener_recap(None)[0])

    def test_first_sentence_extraction(self):
        narr = "Driver X did Y, which means Z. Second sentence here.\n\nNext paragraph."
        self.assertEqual(
            synthesize._opener_first_sentence(narr),
            "Driver X did Y, which means Z.",
        )

    def test_named_driver_helper(self):
        self.assertTrue(synthesize._opener_has_named_driver("Paramount Skydance secured approval"))
        self.assertTrue(synthesize._opener_has_named_driver("a $110 billion transaction cleared"))
        self.assertFalse(synthesize._opener_has_named_driver("the market is broadly heavy today"))


if __name__ == "__main__":
    unittest.main()
