"""Unit tests for thesis_recommendation_guard.py. Pure, deterministic, no
network, no secrets. Mirrors the PR #389 / #393 brief-guard test cases plus the
thesis-specific directional-title and recommended-vehicle guarantees.

Run: python -m pytest backend/test_thesis_recommendation_guard.py
 or: python -m unittest backend.test_thesis_recommendation_guard
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from thesis_recommendation_guard import (  # noqa: E402
    detect_thesis_violations,
    enforce_thesis_recommendation,
    has_thesis_violation,
    redact_rationale,
    strip_directional_title,
    violation_count,
)


# A clean, descriptive, informational thesis that must pass untouched.
CLEAN_TITLE = "AeroVironment Backlog Strengthens on New Orders"
CLEAN_RATIONALE = (
    "AeroVironment's order book is widening as allied drone procurement "
    "accelerates, and the backlog is not yet reflected in consensus. The "
    "asymmetry is whether deliveries convert the backlog on schedule. What "
    "invalidates this: a delivery slip disclosed at the next earnings call."
)


class TestDetect(unittest.TestCase):
    def test_clean_thesis_passes(self):
        v = detect_thesis_violations(CLEAN_TITLE, CLEAN_RATIONALE)
        self.assertEqual(violation_count(v), 0)
        self.assertFalse(has_thesis_violation(CLEAN_TITLE, CLEAN_RATIONALE))

    def test_directional_title_rejected(self):
        for title in (
            "Buy AeroVironment on Backlog Strength",
            "Long JPMorgan's European Retail Expansion",
            "Short Defense Suppliers Two Layers Down",
            "Avoid Regional Banks Into the Print",
            "Watch Optical Computing Reseller Spillover",
        ):
            with self.subTest(title=title):
                v = detect_thesis_violations(title, CLEAN_RATIONALE)
                self.assertTrue(v.directional_title, f"prefix not caught: {title}")
                self.assertTrue(has_thesis_violation(title, CLEAN_RATIONALE))

    def test_cleanest_expression_rejected(self):
        rationale = (
            "The setup is asymmetric. The cleanest expression is AVAV, because "
            "it carries the purest drone exposure."
        )
        v = detect_thesis_violations(CLEAN_TITLE, rationale)
        self.assertTrue(v.vehicle)
        self.assertTrue(has_thesis_violation(CLEAN_TITLE, rationale))

    def test_recommendation_phrases_rejected(self):
        for phrase in (
            "We recommend the name here.",
            "Investors should overweight the sector.",
            "You should add to the position now.",
            "The best way to play this is the ETF.",
            "Buy the dip on this name.",
            "Go long the supplier basket.",
            "Increase exposure to industrials.",
        ):
            with self.subTest(phrase=phrase):
                self.assertTrue(
                    has_thesis_violation(CLEAN_TITLE, phrase),
                    f"recommendation not caught: {phrase}",
                )

    def test_near_miss_tokens_do_not_trip(self):
        # "sell-side", "buy-side", "sell-off" must not match; descriptive
        # "longer", "shorter" must not match the long/short word boundary.
        safe = (
            "Sell-side desks turned constructive after the sell-off. The "
            "buy-side rotated into longer-duration names as the cycle shortened."
        )
        self.assertFalse(has_thesis_violation(CLEAN_TITLE, safe))


class TestRedaction(unittest.TestCase):
    def test_strip_directional_title(self):
        self.assertEqual(
            strip_directional_title("Buy AeroVironment on Backlog Strength"),
            "AeroVironment on Backlog Strength",
        )
        self.assertEqual(
            strip_directional_title("Short Defense Suppliers"),
            "Defense Suppliers",
        )
        # Descriptive title untouched.
        self.assertEqual(strip_directional_title(CLEAN_TITLE), CLEAN_TITLE)

    def test_stacked_prefix_fully_stripped(self):
        # A stacked directional prefix must not survive the fail-closed strip.
        from thesis_recommendation_guard import sanitize_title

        out = sanitize_title("Buy Long AeroVironment Backlog")
        self.assertEqual(violation_count(detect_thesis_violations(out, "")), 0)
        out2 = sanitize_title("Overweight Defense Suppliers")
        self.assertEqual(violation_count(detect_thesis_violations(out2, "")), 0)

    def test_failclosed_stacked_prefix_clean(self):
        res = enforce_thesis_recommendation(
            "Buy Long AeroVironment Backlog",
            "Overweight the name here. What invalidates this: a slip.",
            lambda c: None,
            max_reasks=1,
        )
        self.assertEqual(
            violation_count(detect_thesis_violations(res.title, res.rationale)), 0
        )

    def test_strip_is_idempotent(self):
        once = strip_directional_title("Long JPMorgan Retail Expansion")
        twice = strip_directional_title(once)
        self.assertEqual(once, twice)

    def test_redact_rationale_removes_vehicle_keeps_invalidation(self):
        rationale = (
            "AeroVironment's backlog is widening. The cleanest expression is "
            "AVAV, because it is the purest play. What invalidates this: a "
            "delivery slip at the next print."
        )
        out = redact_rationale(rationale)
        self.assertEqual(violation_count(detect_thesis_violations("", out)), 0)
        self.assertIn("What invalidates this", out)
        self.assertNotIn("cleanest expression", out.lower())


class TestEnforce(unittest.TestCase):
    def test_clean_returns_unchanged_no_reask(self):
        res = enforce_thesis_recommendation(
            CLEAN_TITLE, CLEAN_RATIONALE, lambda c: self.fail("should not re-ask")
        )
        self.assertEqual(res.title, CLEAN_TITLE)
        self.assertEqual(res.rationale, CLEAN_RATIONALE)
        self.assertFalse(res.reasked)
        self.assertFalse(res.still_violating)

    def test_reask_adopts_clean_draft(self):
        res = enforce_thesis_recommendation(
            "Buy AeroVironment on Backlog Strength",
            "The cleanest expression is AVAV.",
            lambda c: (CLEAN_TITLE, CLEAN_RATIONALE),
            max_reasks=1,
        )
        self.assertEqual(res.title, CLEAN_TITLE)
        self.assertTrue(res.reasked)
        self.assertFalse(res.still_violating)

    def test_failclosed_when_reask_returns_none(self):
        res = enforce_thesis_recommendation(
            "Buy AeroVironment on Backlog Strength",
            "AVAV is the asymmetric name. The cleanest expression is AVAV. "
            "What invalidates this: a delivery slip.",
            lambda c: None,
            max_reasks=1,
        )
        # Surfaced text must be provably clean.
        self.assertEqual(
            violation_count(detect_thesis_violations(res.title, res.rationale)), 0
        )
        self.assertFalse(res.title.lower().startswith("buy"))
        self.assertNotIn("cleanest expression", res.rationale.lower())
        self.assertIn("What invalidates this", res.rationale)

    def test_failclosed_when_reask_still_violates(self):
        res = enforce_thesis_recommendation(
            "Long JPMorgan Retail Expansion",
            "Go long JPM here.",
            lambda c: ("Short JPMorgan Retail", "Sell JPM into strength."),
            max_reasks=1,
        )
        self.assertEqual(
            violation_count(detect_thesis_violations(res.title, res.rationale)), 0
        )


class TestAuditProbe(unittest.TestCase):
    """The exact audit probe from the task: a directive title + recommended-
    vehicle body must surface clean, while structured direction (conviction) is
    untouched by the guard (the guard never receives or returns it)."""

    def test_audit_probe(self):
        thesis = {
            "title": "Buy AeroVironment on Backlog Strength",
            "rationale": "The cleanest expression is AVAV.",
            "conviction": "HIGH",
            "ticker": "AVAV",
            "horizon": "90d",
        }
        res = enforce_thesis_recommendation(
            thesis["title"], thesis["rationale"], lambda c: None, max_reasks=1
        )
        # Surfaced title + rationale: no directional prefix, no recommendation.
        self.assertEqual(
            violation_count(detect_thesis_violations(res.title, res.rationale)), 0
        )
        self.assertFalse(res.title.lower().startswith(("buy", "long", "short")))
        self.assertNotIn("cleanest expression", res.rationale.lower())
        # Structured direction inputs are preserved (guard never touches them).
        self.assertEqual(thesis["conviction"], "HIGH")
        self.assertEqual(thesis["ticker"], "AVAV")


if __name__ == "__main__":
    unittest.main()
