"""Unit tests for brief_voice_guard.py. Pure, deterministic, no network, no
secrets. Mirrors the PR #389 TS test cases plus the fail-closed guarantees.

Run: python -m pytest backend/test_brief_voice_guard.py
 or: python -m unittest backend.test_brief_voice_guard
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from brief_voice_guard import (  # noqa: E402
    detect_voice_violations,
    enforce_brief_voice,
    has_voice_violation,
    redact_recommendations,
)


def _recs(text):
    return detect_voice_violations(text).recommendations


# A clean, impersonal, informational narrative that must pass untouched, with
# near-miss tokens that must NOT trip the detector.
CLEAN = (
    "The session turns on the FOMC decision and the first dot plot of the cycle. "
    "Sell-side desks turned constructive after the sell-off as buyers stepped in. "
    "The order book points to structural demand into the Phase I readout."
)


class DetectionTest(unittest.TestCase):
    def test_plural_we_flagged(self):
        self.assertIn("we", detect_voice_violations("We see the tape tightening.").first_person)

    def test_us_our_flagged(self):
        v = detect_voice_violations("This matters to us and to our thesis.")
        self.assertIn("us", v.first_person)
        self.assertIn("our", v.first_person)

    def test_bare_i_and_my_flagged(self):
        v = detect_voice_violations("I believe my read is correct.")
        self.assertIn("i", v.first_person)
        self.assertIn("my", v.first_person)

    def test_enumerators_do_not_trip_bare_i(self):
        v = detect_voice_violations("The Phase I trial and the Class I shares cleared review.")
        self.assertEqual(v.first_person, [])

    def test_recommendation_axes(self):
        v = detect_voice_violations("We recommend increasing exposure into the print.")
        self.assertIn("we", v.first_person)
        self.assertIn("recommend", v.recommendations)
        self.assertTrue(any("exposure" in r for r in v.recommendations))

    def test_buy_sell_flagged(self):
        self.assertIn("buy", _recs("Buy the dip here."))
        self.assertIn("sell", _recs("Sell into strength."))

    def test_near_misses_do_not_false_positive(self):
        v = detect_voice_violations(
            "Sell-side and buy-side desks watched the sell-off as buyers returned."
        )
        self.assertEqual(v.recommendations, [], v.recommendations)

    def test_clean_narrative_zero_violations(self):
        v = detect_voice_violations(CLEAN)
        self.assertEqual(v.first_person, [], v.first_person)
        self.assertEqual(v.recommendations, [], v.recommendations)
        self.assertFalse(has_voice_violation(CLEAN))


class EnforceTest(unittest.TestCase):
    def test_clean_returns_unchanged_no_regenerate(self):
        calls = []

        def regen(_c):
            calls.append(1)
            return "should not be called"

        res = enforce_brief_voice(CLEAN, regen)
        self.assertEqual(calls, [])
        self.assertFalse(res.reasked)
        self.assertFalse(res.still_violating)
        self.assertEqual(res.memo, CLEAN)

    def test_clean_rewrite_adopted(self):
        dirty = "We recommend increasing exposure into the print."
        res = enforce_brief_voice(dirty, lambda _c: CLEAN)
        self.assertTrue(res.reasked)
        self.assertFalse(res.still_violating)
        self.assertEqual(res.memo, CLEAN)
        self.assertIn("we", res.violations_before.first_person)

    def test_recommendation_free_draft_wins_despite_first_person(self):
        # Draft has a recommendation; re-ask drops it but keeps "we". The
        # recommendation-free draft must win; first person may remain.
        dirty = "We recommend buying."
        reask = "We see the order book tightening."  # first person, no recommendation
        res = enforce_brief_voice(dirty, lambda _c: reask)
        self.assertEqual(res.memo, reask)
        self.assertEqual(_recs(res.memo), [])
        self.assertTrue(res.still_violating)  # leftover first person is acceptable

    def test_all_drafts_recommendation_redacts_to_recommendation_free(self):
        dirty = "The filing shifts the capital structure. We recommend increasing exposure."
        reask = "Analysts recommend buying the stock. The order book points to demand."
        res = enforce_brief_voice(dirty, lambda _c: reask)
        self.assertEqual(_recs(res.memo), [], res.memo)
        self.assertIn("order book", res.memo)  # compliant sentence survives
        self.assertNotRegex(res.memo, r"(?i)recommend|\bbuy\b")

    def test_redaction_keeps_first_person_compliant_sentence(self):
        dirty = "We expect demand. We recommend buying."  # compliant fp sentence + offending
        reask = "We recommend selling. We see the order book."
        res = enforce_brief_voice(dirty, lambda _c: reask)
        self.assertEqual(_recs(res.memo), [], res.memo)
        self.assertIn("we", detect_voice_violations(res.memo).first_person)

    def test_none_reask_redacts_original_to_recommendation_free(self):
        dirty = "The filing shifts strategy. We recommend increasing exposure."
        res = enforce_brief_voice(dirty, lambda _c: None)
        self.assertTrue(res.reasked)
        self.assertEqual(_recs(res.memo), [])
        self.assertIn("filing shifts strategy", res.memo)

    def test_failing_reask_is_non_fatal(self):
        # The closure owns its errors and returns None; the guard must not raise.
        def regen(_c):
            return None

        res = enforce_brief_voice("Buy the dip.", regen)
        self.assertEqual(_recs(res.memo), [])

    def test_invariant_no_double_failure_shape_surfaces_a_recommendation(self):
        pairs = [
            ("We recommend increasing exposure.", "Analysts recommend buying the stock."),
            ("Buy the dip.", "Sell into strength."),
            ("Move to overweight here.", "Go underweight instead."),
            ("You should add to position.", "Trim the position into the rally."),
            ("Take profits now.", "We recommend reducing exposure."),
            ("Go long here.", "Go short instead."),
            ("Raise your allocation.", "Cut your stake."),
        ]
        for draft, reask in pairs:
            res = enforce_brief_voice(draft, lambda _c, r=reask: r)
            self.assertEqual(_recs(res.memo), [], f"leaked: draft={draft} reask={reask} memo={res.memo!r}")


class RedactTest(unittest.TestCase):
    def test_redact_is_recommendation_free(self):
        text = "Demand is structural. We recommend buying. The order book tightened."
        out = redact_recommendations(text)
        self.assertEqual(_recs(out), [])
        self.assertIn("order book", out)

    def test_redact_neutralizes_residual_without_terminal_punctuation(self):
        # A recommendation in a heading-like line with no terminal period: the
        # token-neutralize pass must still scrub it.
        out = redact_recommendations("OUTLOOK overweight tech")
        self.assertEqual(_recs(out), [])


if __name__ == "__main__":
    unittest.main()
