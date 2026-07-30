"""Unit tests for the brief-call falsifiability gate (backend/call_falsifiability.py).

The fixtures are the five calls the brief actually emitted on 2026-07-27, read
verbatim out of morning_brief_calls. Two of them could never have been wrong,
and a third was graded on one afternoon when its thesis needed weeks. Those are
the cases the gate exists for, so those are the cases it is tested against.

Pure module under test: no network, no DB, no Gemini.

Run from repo root: python -m unittest backend.tests.test_call_falsifiability
"""
import unittest

from backend.call_falsifiability import (
    KEEP,
    REJECT,
    RESHAPE,
    apply_gate,
    evaluate_claim,
    find_proxy,
    horizon_floor,
    unfalsifiable_hits,
)

# ---------------------------------------------------------------------------
# The five calls the brief emitted on 2026-07-27, verbatim.
# ---------------------------------------------------------------------------

OIL_IRAN = {
    "claim_text": "Oil prices will decline due to a pause in strikes between the U.S. and Iran.",
    "claim_type": "sector",
    "target_symbol": "XLE",
    "expected_direction": "bearish",
    "horizon_type": "session",
    "confidence": 0.8,
}

HEALTHCARE_MA = {
    "claim_text": "The Healthcare & Biotech sector will see continued M&A activity and consolidation.",
    "claim_type": "sector",
    "target_symbol": "XLV",
    "expected_direction": "bullish",
    "horizon_type": "multiweek",
    "confidence": 0.75,
}

PCE_CONDITIONAL = {
    "claim_text": (
        "Deviation from consensus on the PCE price index could trigger significant "
        "shifts in risk appetite and sector-specific valuations."
    ),
    "claim_type": "aggregate",
    "target_symbol": None,
    "expected_direction": "neutral",
    "horizon_type": "session",
    "confidence": 0.7,
}

ENSIGN_READ_THROUGH = {
    "claim_text": (
        "The healthcare services sector may face headwinds due to Ensign Group's "
        "Q2 CY2026 sales being below analyst estimates."
    ),
    "claim_type": "sector",
    "target_symbol": "XLV",
    "expected_direction": "bearish",
    "horizon_type": "session",
    "confidence": 0.7,
}

FOMC_CONDITIONAL = {
    "claim_text": (
        "A hawkish or dovish surprise from the FOMC rate decision will directly "
        "impact rates and the curve."
    ),
    "claim_type": "aggregate",
    "target_symbol": None,
    "expected_direction": "neutral",
    "horizon_type": "session",
    "confidence": 0.7,
}

TODAYS_FIVE = [OIL_IRAN, HEALTHCARE_MA, PCE_CONDITIONAL, ENSIGN_READ_THROUGH, FOMC_CONDITIONAL]


class TestUnfalsifiableText(unittest.TestCase):
    def test_fomc_conditional_is_two_sided_and_outcome_free(self):
        hits = unfalsifiable_hits(FOMC_CONDITIONAL["claim_text"])
        self.assertTrue(hits, "the FOMC conditional must be flagged")
        self.assertIn("hawkish or dovish", hits)

    def test_pce_conditional_is_outcome_free(self):
        hits = unfalsifiable_hits(PCE_CONDITIONAL["claim_text"])
        self.assertTrue(hits, "the PCE conditional must be flagged")
        self.assertIn("deviation from consensus", hits)

    def test_real_calls_are_not_flagged(self):
        for claim in (OIL_IRAN, HEALTHCARE_MA, ENSIGN_READ_THROUGH):
            with self.subTest(claim=claim["claim_text"][:40]):
                self.assertEqual([], unfalsifiable_hits(claim["claim_text"]))

    def test_impact_with_a_direction_survives(self):
        # The impact family fires only when nothing says which way.
        self.assertEqual(
            [], unfalsifiable_hits("New tariffs will push industrials lower into month end.")
        )
        self.assertTrue(
            unfalsifiable_hits("The ruling will directly impact rates and the curve.")
        )

    def test_empty_text_is_rejected(self):
        self.assertTrue(unfalsifiable_hits(""))
        self.assertTrue(unfalsifiable_hits(None))


class TestTodaysFive(unittest.TestCase):
    def test_fomc_conditional_is_rejected(self):
        v = evaluate_claim(FOMC_CONDITIONAL)
        self.assertEqual(REJECT, v.status)
        self.assertIn("unfalsifiable", v.reason)

    def test_pce_conditional_is_rejected(self):
        v = evaluate_claim(PCE_CONDITIONAL)
        self.assertEqual(REJECT, v.status)
        self.assertIn("unfalsifiable", v.reason)

    def test_ensign_read_through_is_not_same_session(self):
        v = evaluate_claim(ENSIGN_READ_THROUGH)
        self.assertTrue(v.kept, f"the Ensign call is a real call: {v.reason}")
        self.assertIn(v.claim["horizon_type"], ("week", "multiweek"))
        self.assertEqual("week", v.claim["horizon_type"])
        self.assertEqual(RESHAPE, v.status)

    def test_oil_iran_stays_session(self):
        v = evaluate_claim(OIL_IRAN)
        self.assertEqual(KEEP, v.status)
        self.assertEqual("session", v.claim["horizon_type"])
        self.assertEqual("XLE", v.claim["target_symbol"])

    def test_healthcare_ma_stays_multiweek(self):
        v = evaluate_claim(HEALTHCARE_MA)
        self.assertTrue(v.kept)
        self.assertEqual("multiweek", v.claim["horizon_type"])

    def test_the_day_emits_three_not_five(self):
        kept, verdicts = apply_gate(TODAYS_FIVE)
        self.assertEqual(3, len(kept))
        self.assertEqual(2, sum(1 for v in verdicts if v.status == REJECT))
        for claim in kept:
            self.assertIn(claim["expected_direction"], ("bullish", "bearish"))
            self.assertTrue(claim["target_symbol"])


class TestNoBackfill(unittest.TestCase):
    def test_a_day_where_everything_fails_emits_zero(self):
        candidates = [
            FOMC_CONDITIONAL,
            PCE_CONDITIONAL,
            {
                "claim_text": "Watch for a reaction in risk appetite after the print.",
                "claim_type": "aggregate",
                "target_symbol": None,
                "expected_direction": "neutral",
                "horizon_type": "session",
            },
            {
                "claim_text": "Markets could move in either direction on the jobs number.",
                "claim_type": "index",
                "target_symbol": "SPY",
                "expected_direction": "bullish",
                "horizon_type": "session",
            },
        ]
        kept, verdicts = apply_gate(candidates)
        self.assertEqual([], kept, "nothing is fabricated to fill the slot")
        self.assertEqual(4, len(verdicts))
        self.assertTrue(all(v.status == REJECT for v in verdicts))

    def test_empty_input_is_empty_output(self):
        self.assertEqual(([], []), apply_gate([]))
        self.assertEqual(([], []), apply_gate(None))


class TestReshapeBeforeReject(unittest.TestCase):
    def test_rates_claim_maps_to_tlt_with_an_inverted_sign(self):
        v = evaluate_claim({
            "claim_text": "Treasury yields will rise after the hot CPI print.",
            "claim_type": "aggregate",
            "target_symbol": None,
            "expected_direction": "bullish",
            "horizon_type": "session",
        })
        self.assertEqual(RESHAPE, v.status)
        self.assertEqual("TLT", v.claim["target_symbol"])
        # Yields up is bond prices down. A call that shipped bullish TLT here
        # would be confidently backwards.
        self.assertEqual("bearish", v.claim["expected_direction"])

    def test_bond_instrument_claim_keeps_its_sign(self):
        v = evaluate_claim({
            "claim_text": "Long duration bonds rally as growth data softens.",
            "claim_type": "aggregate",
            "target_symbol": None,
            "expected_direction": "bullish",
            "horizon_type": "week",
        })
        self.assertEqual(RESHAPE, v.status)
        self.assertEqual("TLT", v.claim["target_symbol"])
        self.assertEqual("bullish", v.claim["expected_direction"])

    def test_dollar_claim_maps_to_uup(self):
        v = evaluate_claim({
            "claim_text": "The dollar strengthens against the majors on the rate differential.",
            "claim_type": "aggregate",
            "target_symbol": None,
            "expected_direction": "bullish",
            "horizon_type": "week",
        })
        self.assertEqual("UUP", v.claim["target_symbol"])
        self.assertEqual("bullish", v.claim["expected_direction"])

    def test_credit_spreads_map_to_lqd_inverted(self):
        v = evaluate_claim({
            "claim_text": "Credit spreads widen as issuance stalls.",
            "claim_type": "aggregate",
            "target_symbol": None,
            "expected_direction": "bullish",
            "horizon_type": "week",
        })
        self.assertEqual("LQD", v.claim["target_symbol"])
        self.assertEqual("bearish", v.claim["expected_direction"])

    def test_ambiguous_rate_subject_is_dropped_not_guessed(self):
        v = evaluate_claim({
            "claim_text": "Treasuries and yields both move on the auction.",
            "claim_type": "aggregate",
            "target_symbol": None,
            "expected_direction": "bullish",
            "horizon_type": "session",
        })
        self.assertEqual(REJECT, v.status)
        self.assertIn("sign cannot be determined", v.reason)

    def test_unpriceable_with_no_proxy_is_rejected(self):
        v = evaluate_claim({
            "claim_text": "Private credit fundraising accelerates through year end.",
            "claim_type": "aggregate",
            "target_symbol": None,
            "expected_direction": "bullish",
            "horizon_type": "multiweek",
        })
        # "credit" is a listed proxy keyword, so this one reshapes rather than
        # dropping. The genuinely unmappable case is below.
        self.assertEqual("LQD", v.claim["target_symbol"])

        v2 = evaluate_claim({
            "claim_text": "Deal announcements accelerate across the quarter.",
            "claim_type": "aggregate",
            "target_symbol": None,
            "expected_direction": "bullish",
            "horizon_type": "multiweek",
        })
        self.assertEqual(REJECT, v2.status)
        self.assertIn("no listed proxy", v2.reason)

    def test_aggregate_naming_the_whole_market_is_dropped_not_reshaped(self):
        """Contract CHANGED. This test previously asserted the opposite.

        An aggregate claim about the market as a whole used to be reshaped onto
        SPY/index and kept. It is now dropped: "the broad market grinds higher"
        is not the claim "SPY moves more than X", and carrying an invented
        target into the grader produces a confident verdict against a bar the
        claim never set. The live record backs this up: 26 graded aggregate
        calls, zero clean reads, 18 ungradable.

        A claim that NAMES an index still reshapes; see
        test_a_named_index_still_reshapes below.
        """
        v = evaluate_claim({
            "claim_text": "The broad market grinds higher into the close.",
            "claim_type": "aggregate",
            "target_symbol": "SPY",
            "expected_direction": "bullish",
            "horizon_type": "session",
        })
        self.assertFalse(v.kept)
        self.assertIn("market as a whole", v.reason)

    def test_a_named_index_still_reshapes(self):
        """The line held: naming an instrument is not naming the market."""
        v = evaluate_claim({
            "claim_text": "The S&P 500 grinds higher into the close.",
            "claim_type": "aggregate",
            "target_symbol": None,
            "expected_direction": "bullish",
            "horizon_type": "session",
        })
        self.assertTrue(v.kept)
        self.assertEqual("SPY", v.claim["target_symbol"])
        self.assertEqual("index", v.claim["claim_type"])


class TestDirectionRequired(unittest.TestCase):
    def test_neutral_is_not_a_call(self):
        v = evaluate_claim({
            "claim_text": "Energy leads the tape.",
            "claim_type": "sector",
            "target_symbol": "XLE",
            "expected_direction": "neutral",
            "horizon_type": "session",
        })
        self.assertEqual(REJECT, v.status)
        self.assertIn("no explicit direction", v.reason)

    def test_missing_direction_is_not_a_call(self):
        v = evaluate_claim({
            "claim_text": "Energy leads the tape.",
            "claim_type": "sector",
            "target_symbol": "XLE",
            "horizon_type": "session",
        })
        self.assertEqual(REJECT, v.status)


class TestHorizonFloor(unittest.TestCase):
    def test_read_through_floors_at_week(self):
        floor, reason = horizon_floor(ENSIGN_READ_THROUGH["claim_text"], "sector")
        self.assertEqual("week", floor)
        self.assertIn("single-name", reason)

    def test_consolidation_floors_at_multiweek(self):
        floor, _ = horizon_floor(HEALTHCARE_MA["claim_text"], "sector")
        self.assertEqual("multiweek", floor)

    def test_policy_floors_at_week_unless_repriced_today(self):
        floor, _ = horizon_floor("New tariffs push industrials lower.", "sector")
        self.assertEqual("week", floor)
        floor2, _ = horizon_floor("New tariffs push industrials lower today.", "sector")
        self.assertEqual("session", floor2)

    def test_direct_repricing_stays_session(self):
        floor, reason = horizon_floor(OIL_IRAN["claim_text"], "sector")
        self.assertEqual("session", floor)
        self.assertIsNone(reason)

    def test_the_floor_never_shortens_a_longer_model_choice(self):
        v = evaluate_claim({
            "claim_text": "Oil prices will decline on the ceasefire.",
            "claim_type": "sector",
            "target_symbol": "XLE",
            "expected_direction": "bearish",
            "horizon_type": "multiweek",
        })
        self.assertEqual("multiweek", v.claim["horizon_type"])


class TestProxyMapOrdering(unittest.TestCase):
    def test_specific_industry_beats_its_parent_sector(self):
        self.assertEqual(("SMH", "sector"), find_proxy("Semiconductors lead the tape."))
        self.assertEqual(("XHB", "sector"), find_proxy("Homebuilders slide on rates."))

    def test_named_index_is_the_last_read(self):
        # A specific sector still beats the broad-index read.
        self.assertEqual(("XLE", "sector"), find_proxy("Energy leads the broad market higher."))
        # NAMED index: still the last read, still a legitimate reshape.
        self.assertEqual(("SPY", "index"), find_proxy("The S&P 500 grinds higher."))

    def test_the_market_as_a_whole_is_no_longer_a_proxy(self):
        """Contract CHANGED. "The broad market" used to map to SPY.

        Collective nouns for the market name no instrument, so there is nothing
        to reshape onto without inventing the target. They were removed from
        PROXY_MAP; see _BROAD_MARKET_NON_SUBJECTS for the drop reason."""
        for text in ["The broad market grinds higher.", "Equities grind higher.",
                     "The stock market grinds higher.", "Equity markets grind higher."]:
            with self.subTest(text):
                self.assertIsNone(find_proxy(text))

    def test_no_keyword_means_no_proxy(self):
        self.assertIsNone(find_proxy("Deal announcements accelerate."))


if __name__ == "__main__":
    unittest.main()
