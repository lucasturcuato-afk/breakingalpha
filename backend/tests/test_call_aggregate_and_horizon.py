"""Tests for the falsifiability gate: aggregate rejection and the horizon floor.

TWO DISTINCT THINGS ARE PINNED HERE, and the distinction matters.

1. AGGREGATE (changed by this PR). A claim naming the market as a whole is now
   rejected instead of being reshaped onto SPY. Before this, the last PROXY_MAP
   entry caught "broad market", "equities" and "stock market" and mapped them to
   SPY/index, which invents a target the claim never made and then grades it
   confidently against a bar nobody set. Live record: 26 graded aggregate calls,
   ZERO clean reads, 18 ungradable.

2. HORIZON (shipped by #523, NOT changed by this PR). The prompt guidance and
   the deterministic horizon_floor were both added hours before this PR, and
   every call in the database predates them, so they had never been exercised
   against anything. These tests are the first exercise: they are regression
   pins on someone else's work, not a claim to have fixed it.

No network, no DB, no Gemini. Pure functions only.

Run from repo root: python -m unittest backend.tests.test_call_aggregate_and_horizon
"""
import unittest

from backend.call_falsifiability import (
    KEEP,
    REJECT,
    RESHAPE,
    apply_gate,
    classify_horizon_days,
    evaluate_claim,
    find_proxy,
    horizon_floor_days,
)


def claim(**over) -> dict:
    base = {
        "claim_text": "NVDA rallies today on its AI guidance",
        "claim_type": "ticker",
        "target_symbol": "NVDA",
        "expected_direction": "bullish",
        "horizon_days": 0,
    }
    base.update(over)
    return base


# ---------------------------------------------------------------------------
# 1. Aggregate does not ship, and is not reshaped onto a broad index
# ---------------------------------------------------------------------------


class TestAggregateRejected(unittest.TestCase):
    VAGUE = [
        "The broad market grinds higher into the close",
        "Equities push higher on a dovish tone",
        "The stock market rallies after the print",
        "Equity markets advance on easing rate fears",
        "Stocks climb as risk appetite improves",
        "The market drifts higher through the session",
    ]

    def test_an_aggregate_candidate_does_not_ship(self):
        for text in self.VAGUE:
            with self.subTest(text):
                v = evaluate_claim(claim(
                    claim_text=text, claim_type="aggregate",
                    target_symbol=None, expected_direction="bullish",
                ))
                self.assertEqual(v.status, REJECT, f"{text!r} shipped")
                self.assertFalse(v.kept)

    def test_it_is_NOT_reshaped_onto_a_broad_index(self):
        for text in self.VAGUE:
            with self.subTest(text):
                v = evaluate_claim(claim(
                    claim_text=text, claim_type="aggregate",
                    target_symbol=None, expected_direction="bullish",
                ))
                # The whole point: no invented target survives the gate.
                self.assertNotEqual(v.claim.get("target_symbol"), "SPY")
                self.assertNotEqual(v.claim.get("claim_type"), "index")

    def test_the_drop_reason_names_the_real_problem(self):
        v = evaluate_claim(claim(
            claim_text="Equities stay volatile", claim_type="aggregate",
            target_symbol=None, expected_direction="bullish",
        ))
        self.assertEqual(v.status, REJECT)
        self.assertIn("market as a whole", v.reason)
        self.assertIn("invent a target", v.reason)

    def test_find_proxy_no_longer_maps_collective_nouns_to_SPY(self):
        for text in ["the broad market", "equities", "the stock market", "equity markets"]:
            with self.subTest(text):
                self.assertIsNone(find_proxy(text), f"{text!r} still proxies")

    def test_an_aggregate_claim_carrying_SPY_is_still_rejected(self):
        # The old prompt told the model to put SPY on aggregate claims. Even so,
        # aggregate is not in PRICEABLE_TYPES, so the symbol does not rescue it.
        v = evaluate_claim(claim(
            claim_text="Stocks end the session higher", claim_type="aggregate",
            target_symbol="SPY", expected_direction="bullish",
        ))
        self.assertEqual(v.status, REJECT)


class TestNamedIndexStillWorks(unittest.TestCase):
    """Naming an instrument is different from naming the market. Do not overshoot."""

    def test_a_named_index_claim_still_ships(self):
        v = evaluate_claim(claim(
            claim_text="The S&P 500 closes higher on a dovish Fed tone",
            claim_type="index", target_symbol="SPY", expected_direction="bullish",
        ))
        self.assertIn(v.status, (KEEP, RESHAPE))
        self.assertTrue(v.kept)
        self.assertEqual(v.claim["target_symbol"], "SPY")

    def test_s_and_p_is_still_a_usable_proxy_when_the_type_is_wrong(self):
        # "S&P 500" names an instrument, so reshaping it is a correction, not an
        # invention. This is the line between the two cases.
        self.assertEqual(find_proxy("the S&P 500 rallies"), ("SPY", "index"))

    def test_sector_and_ticker_claims_are_untouched(self):
        for ct, sym, txt in [
            ("sector", "XLE", "Energy slides today as crude gives back gains"),
            ("ticker", "NVDA", "NVDA rallies today on its AI guidance"),
        ]:
            with self.subTest(ct):
                v = evaluate_claim(claim(
                    claim_text=txt, claim_type=ct, target_symbol=sym,
                    expected_direction="bullish",
                ))
                self.assertTrue(v.kept)
                self.assertEqual(v.claim["target_symbol"], sym)


# ---------------------------------------------------------------------------
# 2. Horizon floor: regression pins on #523, first exercise of untested code
# ---------------------------------------------------------------------------


class TestHorizonFloor(unittest.TestCase):
    def test_a_single_name_result_read_across_a_sector_is_NOT_session(self):
        # The real 2026-07-27 claim that shipped as same-session and motivated
        # the floor. The model still says session; the floor must upgrade it.
        text = ("The healthcare services sector may face headwinds due to Ensign "
                "Group's Q2 sales being below analyst estimates")
        floor, reason = horizon_floor_days(text, "sector")
        self.assertEqual(floor, 7, reason)
        chosen, _ = classify_horizon_days(text, "sector", 0)
        self.assertEqual(chosen, 7)

    def test_explicit_read_through_language_is_at_least_week(self):
        for text in [
            "The read-through for the semiconductor sector is negative",
            "There are implications for the sector after the miss",
            "A bellwether print points lower for the group",
        ]:
            with self.subTest(text):
                chosen, _ = classify_horizon_days(text, "sector", 0)
                self.assertGreaterEqual(chosen, 7)

    def test_consolidation_and_MA_language_is_multiweek(self):
        text = "The Healthcare & Biotech sector will see continued M&A activity and consolidation."
        floor, reason = horizon_floor_days(text, "sector")
        self.assertEqual(floor, 21, reason)
        chosen, _ = classify_horizon_days(text, "sector", 0)
        self.assertEqual(chosen, 21)

    def test_policy_language_is_at_least_week(self):
        chosen, _ = classify_horizon_days(
            "New tariffs pressure industrials", "sector", 0)
        self.assertEqual(chosen, 7)

    def test_a_direct_same_day_repricing_candidate_STAYS_session(self):
        for text in [
            "NVDA rallies today on its AI guidance",
            "Crude jumps overnight on the geopolitical headline",
            "The index moves lower this session after the Fed decision",
            "XLE gaps higher at the open",
        ]:
            with self.subTest(text):
                chosen, _ = classify_horizon_days(text, "ticker", 0)
                self.assertEqual(chosen, 0, f"{text!r} was upgraded")

    def test_the_floor_is_upgrade_only_and_never_shortens(self):
        # A model that asks for multiweek is never talked down.
        chosen, _ = classify_horizon_days("NVDA rallies today", "ticker", 21)
        self.assertEqual(chosen, 21)
        chosen, _ = classify_horizon_days("New tariffs pressure industrials", "sector", 21)
        self.assertEqual(chosen, 21)

    def test_policy_with_a_direct_repricing_marker_stays_session(self):
        chosen, _ = classify_horizon_days(
            "Tariff headlines hit industrials today", "sector", 0)
        self.assertEqual(chosen, 0)

    def test_a_read_through_stays_slow_even_with_a_today_marker(self):
        # Deliberate asymmetry: a read-through is slow even when the headline is
        # new, so direct-repricing does not override it the way it does policy.
        chosen, _ = classify_horizon_days(
            "The read-through for the sector lands today", "sector", 0)
        self.assertGreaterEqual(chosen, 7)


class TestHorizonFallback(unittest.TestCase):
    def test_horizon_days_absent_falls_back_to_session_without_crashing(self):
        v = evaluate_claim({
            "claim_text": "NVDA rallies today on its AI guidance",
            "claim_type": "ticker", "target_symbol": "NVDA",
            "expected_direction": "bullish",
            # horizon_days deliberately absent
        })
        self.assertTrue(v.kept)
        self.assertEqual(v.claim["horizon_days"], 0)

    def test_unrecognized_and_malformed_horizons_fall_back_without_crashing(self):
        # The bucket names the model used to send are now nonsense values, and
        # they must degrade the same way anything else unusable does.
        for bad in [None, "", "  ", "event", "quarter", "session", [], {},
                    "SESSIONS", -5, True, float("nan")]:
            with self.subTest(repr(bad)):
                v = evaluate_claim(claim(horizon_days=bad))
                self.assertTrue(v.kept)
                self.assertEqual(v.claim["horizon_days"], 0)

    def test_a_malformed_horizon_still_gets_the_floor_upgrade(self):
        v = evaluate_claim(claim(
            claim_text="The sector will see continued M&A activity and consolidation",
            claim_type="sector", target_symbol="XLV",
            expected_direction="bullish", horizon_days=None,
        ))
        self.assertTrue(v.kept)
        self.assertEqual(v.claim["horizon_days"], 21)


# ---------------------------------------------------------------------------
# 3. The mix over a realistic fixture set
# ---------------------------------------------------------------------------


class TestRealisticMix(unittest.TestCase):
    """A brief-shaped batch. The failure this whole PR exists to catch is a mix
    that collapses to all-session, so assert the mix directly."""

    FIXTURES = [
        # Direct same-day repricing. Should stay session.
        claim(claim_text="NVDA rallies today on its AI guidance",
              claim_type="ticker", target_symbol="NVDA", horizon_days=0),
        claim(claim_text="Crude gives back gains overnight, pressuring energy",
              claim_type="sector", target_symbol="XLE",
              expected_direction="bearish", horizon_days=0),
        # Read-through. Model says session; the floor must upgrade.
        claim(claim_text=("The healthcare services sector may face headwinds due to "
                          "Ensign Group's Q2 sales being below analyst estimates"),
              claim_type="sector", target_symbol="XLV",
              expected_direction="bearish", horizon_days=0),
        # Structural. Model says session; floor must upgrade to multiweek.
        claim(claim_text="Healthcare will see continued M&A activity and consolidation",
              claim_type="sector", target_symbol="XLV", horizon_days=0),
        # Policy. Model says session; floor must upgrade to week.
        claim(claim_text="New tariffs pressure industrial manufacturers",
              claim_type="sector", target_symbol="XLI",
              expected_direction="bearish", horizon_days=0),
        # Aggregate. Must be dropped entirely.
        claim(claim_text="Equities drift higher as risk appetite improves",
              claim_type="aggregate", target_symbol=None, horizon_days=0),
    ]

    def test_the_mix_is_NOT_all_session(self):
        kept, _ = apply_gate(self.FIXTURES)
        horizons = [c["horizon_days"] for c in kept]
        self.assertGreater(len(set(horizons)), 1,
                           f"every kept call collapsed to one horizon: {horizons}")
        self.assertIn(0, horizons)
        self.assertIn(7, horizons)
        self.assertIn(21, horizons)

    def test_the_aggregate_candidate_is_the_one_that_does_not_ship(self):
        kept, verdicts = apply_gate(self.FIXTURES)
        self.assertEqual(len(kept), len(self.FIXTURES) - 1)
        rejected = [v for v in verdicts if v.status == REJECT]
        self.assertEqual(len(rejected), 1)
        self.assertIn("market as a whole", rejected[0].reason)
        for c in kept:
            self.assertNotEqual(c.get("claim_type"), "aggregate")

    def test_no_kept_call_carries_an_invented_broad_index_target(self):
        kept, _ = apply_gate(self.FIXTURES)
        # None of these fixtures names an index, so SPY must appear nowhere.
        self.assertEqual([c for c in kept if c.get("target_symbol") == "SPY"], [])

    def test_apply_gate_never_raises_on_junk(self):
        kept, verdicts = apply_gate([None, "not a dict", 42, {}, claim()])
        self.assertEqual(len(verdicts), 5)
        self.assertEqual(len(kept), 1)


if __name__ == "__main__":
    unittest.main()
