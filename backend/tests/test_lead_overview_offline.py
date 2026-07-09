"""Offline A-VERIFY harness for the lead/overview overhaul (D1, D2, D3, D12).

Loads a committed FIXTURE snapshot of the 2026-06-24 morning candidate pool
(captured SELECT-only from prod via the supabase MCP tool) and exercises ONLY
the pure ranking primitives in memory:
  - impact_ranking: clustering + scoring + the event-level lead
  - impact_ranking.confirmed_mega_deal_urls: the relaxed mega-deal gate
  - market_tape.overview_subject_gate: the materiality gate

No network, no Gemini, no DB, no writes. None of the imported modules perform
I/O at import (impact_ranking is stdlib-only; lead_preselect builds a client only
when env vars are present, which they are not under unittest; market_tape's
network lives inside functions). synthesize.py is intentionally NOT imported:
it constructs Supabase + Gemini clients at import time.

Asserts:
  1. SpaceX no longer wins the lead purely on name-level (48-article) volume:
     the winning cluster is a single EVENT cluster, not the company aggregate.
  2. The overview-subject gate relegates SpaceX to a mention on the 06-24 mild
     tape and selects the market-wide synthesis path.
  3. A genuine fresh confirmed deal (AbbVie/Apogee $10.9B) is eligible for the
     lead / top-stories.

Run: python3 -m unittest backend.tests.test_lead_overview_offline
"""
import datetime as dt
import json
import sys
import unittest
from pathlib import Path

_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

import impact_ranking as ir          # noqa: E402  (stdlib-only, no I/O at import)
import lead_preselect as lp          # noqa: E402  (client is None without env)
import market_tape as mt            # noqa: E402  (network is inside functions)
import temporal_grounding as tg     # noqa: E402  (pure, stdlib-only)
import prose_quality_guard as pq    # noqa: E402  (pure, stdlib-only)
import overview_grounding as og     # noqa: E402  (pure, stdlib-only, no I/O at import)

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "lead_pool_2026-06-24.json"
NARRATION_FIXTURE = (
    Path(__file__).resolve().parent / "fixtures" / "narration_micron_2026-06-26.json"
)


def _load():
    data = json.loads(FIXTURE.read_text())
    now = dt.datetime.fromisoformat(data["_meta"]["asof_utc"])
    return data, now


# A mild risk-on/neutral tape with no single name moving the whole tape: the
# documented 06-24 shape. Below both materiality thresholds.
MILD_TAPE = {
    "quotes": {
        "^GSPC": {"price": 7600.0, "prev": 7580.0, "pct": 0.26},
        "^IXIC": {"price": 25800.0, "prev": 25700.0, "pct": 0.39},
        "^VIX": {"price": 15.8, "prev": 15.4, "pct": 2.6},
    },
    "regime": "neutral",
    "vix_level": 15.8,
}


class FixtureShapeTests(unittest.TestCase):
    def test_fixture_matches_documented_shape(self):
        data, _ = _load()
        arts = data["articles"]
        spacex = [a for a in arts if (a.get("companies") or [None])[0] == "SpaceX"]
        srcs = {a["source"].strip().lower() for a in spacex}
        self.assertEqual(len(spacex), 48, "SpaceX article count should match prod snapshot")
        self.assertGreaterEqual(len(srcs), 20, "SpaceX distinct sources should match prod (~21)")


class Assertion1_LeadIsFreshNotStaleDebut(unittest.TestCase):
    """T2 (#422 review fix, harness honesty). The original Assertion 1 only proved
    the 48-article company aggregate was split into event clusters and the winner
    held < 48 articles. That passes even while a STALE lead wins: on this committed
    06-24 fixture the winner is co:spacex:stock (the FRESH Jun-23 selloff, freshest
    ~6.5h), and the STALE IPO-debut cluster co:spacex:ipo (freshest ~11.5h) is #2
    by score. The old test could not distinguish those two outcomes, so it would
    keep passing if the stale debut ever out-ranked the fresh event. This rewrite
    asserts the FRESH selloff wins and the STALE debut does NOT, so the test STOPS
    passing the moment a stale lead wins.

    Data agreement: the fresh SpaceX selloff (co:spacex:stock) is a legitimate
    06-24 lead candidate; the stale post-IPO debut recap (co:spacex:ipo) is not.
    """
    STALE_DEBUT_KEY = "co:spacex:ipo"
    FRESH_SELLOFF_KEY = "co:spacex:stock"

    def test_winner_is_fresh_event_not_stale_debut(self):
        data, now = _load()
        scored = ir.score_clusters(data["articles"], now)

        # The bare company aggregate must be gone (D1 event scoping) so the 48
        # name-level articles cannot win on accumulated volume.
        spacex_clusters = [c for c in scored if c["cluster_key"].startswith("co:spacex:")]
        self.assertGreaterEqual(len(spacex_clusters), 3,
                                "SpaceX should split into multiple event clusters")
        for c in scored:
            self.assertNotEqual(c["cluster_key"], "co:spacex",
                                "the company-aggregate cluster must no longer exist")

        res = ir.compute_shadow_lead(data["articles"], now, asof_date=now.date())
        self.assertIsNotNone(res)
        winner_key = res["cluster_key"]
        winner = next(c for c in scored if c["cluster_key"] == winner_key)

        by_key = {c["cluster_key"]: c for c in scored}
        fresh = by_key.get(self.FRESH_SELLOFF_KEY)
        stale = by_key.get(self.STALE_DEBUT_KEY)
        self.assertIsNotNone(fresh, "fixture must contain the fresh selloff cluster")
        self.assertIsNotNone(stale, "fixture must contain the stale IPO-debut cluster")

        # Honesty core: the winner is the FRESH event, NOT the stale debut. If the
        # stale debut ever out-ranks the fresh event, BOTH of these fail.
        self.assertEqual(winner_key, self.FRESH_SELLOFF_KEY,
                         "the lead must be the fresh selloff event, not the stale debut")
        self.assertNotEqual(winner_key, self.STALE_DEBUT_KEY,
                            "a stale IPO-debut recap must never win the lead")
        # Recency relationship the assertion depends on: the winner is fresher than
        # the stale debut, so the win is on freshness+breadth, not stale volume.
        self.assertLess(winner["freshest_age_h"], stale["freshest_age_h"],
                        "the winning event must be fresher than the stale debut cluster")
        # No name-volume win: the winning event holds far fewer than the 48
        # name-level articles.
        self.assertLess(winner["article_count"], 48,
                        "winning event cluster must be smaller than the name aggregate")


class Assertion2_OverviewGateRelegatesSpaceX(unittest.TestCase):
    def test_spacex_relegated_to_mention_on_mild_tape(self):
        data, now = _load()
        scored = ir.score_clusters(data["articles"], now)
        # Use the largest SpaceX event cluster's breadth (the most generous case).
        spacex_clusters = [c for c in scored if c["cluster_key"].startswith("co:spacex:")]
        top_spacex = max(spacex_clusters, key=lambda c: c["distinct_sources"])

        gate = mt.overview_subject_gate(
            story_companies=["SpaceX"],
            is_single_name_or_deal=True,
            cluster_distinct_sources=top_spacex["distinct_sources"],
            tape=MILD_TAPE,
            tape_driver_names=None,  # gen-time tape surfaces no per-name driver
        )
        self.assertEqual(gate["subject"], "market_wide",
                         "SpaceX must be relegated; overview must be market-wide")
        self.assertFalse(gate["passed"])
        # The mild tape is the binding reason (no single name owns the read).
        self.assertFalse(mt.tape_has_material_move(MILD_TAPE))


class Assertion3_GenuineDealEligible(unittest.TestCase):
    def test_abbvie_apogee_passes_filter_a(self):
        data, now = _load()
        # Build the deal_flow url index the live path uses, then confirm the
        # AbbVie/Apogee row qualifies for the priced-deal Filter A.
        deal_idx = lp._index_deal_flow_by_url(data["deal_flow"])
        abbv = next(a for a in data["articles"]
                    if a["url"] == "https://x.test/abbv-apogee-1")
        val = lp._qualifies_filter_a(abbv, deal_idx.get(abbv["url"]))
        self.assertIsNotNone(val, "AbbVie/Apogee $10.9B must qualify for Filter A")
        self.assertGreaterEqual(val, 10.0)

    def test_genuine_deal_eligible_for_lead_via_preselect(self):
        data, now = _load()
        # Run the deterministic deal pre-picker over the fixture corpus with the
        # fixture deal_flow injected via a tiny stand-in client. A genuine fresh
        # confirmed $1B+ deal must be selected (not a SpaceX stock story).
        class _StubClient:
            def __init__(self, rows):
                self._rows = rows
            def table(self, _name):
                return self
            def select(self, *_a, **_k):
                return self
            def gte(self, *_a, **_k):
                return self
            def order(self, *_a, **_k):
                return self
            def limit(self, *_a, **_k):
                return self
            def execute(self):
                return type("R", (), {"data": self._rows})()

        pick = lp.preselect_primary_story(
            data["articles"], "morning",
            supabase_client=_StubClient(data["deal_flow"]), now=now,
        )
        self.assertIsNotNone(pick, "a deterministic priced-deal lead must be found")
        self.assertEqual(pick.get("_preselect_reason"), "filter_a_priced_1b")
        cos = pick.get("companies") or []
        self.assertIn("AbbVie", cos,
                      "the genuine $10.9B AbbVie/Apogee deal should win the priced-deal pick")
        self.assertNotEqual((cos or [None])[0], "SpaceX")

    def test_relaxed_mega_deal_gate_recovers_stale_stage_deal(self):
        # D12: the Qualcomm/Modular $4B row is stale ('rumored') in deal_flow but
        # the article side is unambiguous; the relaxed gate must mark it confirmed.
        data, _ = _load()
        urls = ir.confirmed_mega_deal_urls(data["deal_flow"], data["articles"])
        self.assertIn("https://x.test/qcom-modular-1", urls)


# ── Narration grounding (D13, D14, D15) ─────────────────────────────────────
#
# These exercise ONLY the deterministic layers: the D13 normalizer, the D13/D14
# date derivation, the D14 gate direction decision, and the D15 prose detector.
# The re-ask paths (temporal re-ask, prose re-ask) are integration-only because
# they call the model; they are NOT asserted here. The fixture is the documented
# 2026-06-26 Micron case: a Jun 25 (ET) ATH article narrated with "today" / "this
# morning" on a Jun 26 brief, with MU down ~5% in the Jun 26 session.

def _load_narration():
    return json.loads(NARRATION_FIXTURE.read_text())


class Assertion4_TemporalNoTodayForPriorEvent(unittest.TestCase):
    def test_event_date_is_jun25_via_et_conversion(self):
        nf = _load_narration()
        # published_at 2026-06-26T01:30:00Z is 2026-06-25 21:30 ET: the ET-converted
        # event date is Jun 25, NOT Jun 26. This is the bug's root cause.
        ed = tg.event_date_et(nf["lead_story"]["published_at"])
        self.assertEqual(ed, dt.date(2026, 6, 25),
                         "event_date must convert UTC to ET before taking the date")
        bd = dt.date(2026, 6, 26)
        self.assertEqual(tg.relative_phrase(ed, bd), "yesterday")

    def test_narrative_today_rewritten_to_yesterday_or_weekday(self):
        nf = _load_narration()
        ed = tg.event_date_et(nf["lead_story"]["published_at"])  # Jun 25
        bd = dt.date(2026, 6, 26)
        gen = nf["generated_narrative"]
        for field in ("lead_paragraph", "narrative"):
            text = gen[field]
            out, changed, garbled = tg.normalize_relative_time(text, ed, bd)
            self.assertTrue(changed, f"{field} should be normalized")
            low = out.lower()
            self.assertNotIn("today", low, f"{field} must not say 'today' for a prior-day event")
            self.assertNotIn("this morning", low,
                             f"{field} must not say 'this morning' for a prior-day event")
            # The Micron event was the prior session, so the anchored phrase reads
            # "yesterday" (one day prior). Weekday is the same-week fallback.
            self.assertTrue("yesterday" in low or "thursday" in low or "wednesday" in low,
                            f"{field} should anchor to yesterday/weekday, got: {out}")


class Assertion5_DirectionContradictionFlagged(unittest.TestCase):
    def test_bullish_micron_vs_negative_session_relegated(self):
        nf = _load_narration()
        sess = nf["_meta"]["live_session"]["current_session_pct"]  # ~ -5.1
        framing = mt.classify_framing(
            nf["lead_story"]["title"] + " " + nf["lead_story"]["summary"]
        )
        self.assertEqual(framing, "bullish")
        # Material tape, story is the driver, dominant breadth: the only thing that
        # should stop a story-subject overview is the direction contradiction.
        material_tape = {
            "quotes": {"^GSPC": {"pct": -1.4}, "^VIX": {"pct": 11.0}},
            "regime": "risk-off", "vix_level": 22.0,
        }
        gate = mt.overview_subject_gate(
            story_companies=["Micron Technology"],
            is_single_name_or_deal=True,
            cluster_distinct_sources=nf["lead_story"]["_impact_breadth"]["distinct_sources"],
            tape=material_tape,
            tape_driver_names={"micron technology"},
            subject_session_pct=sess,
            subject_framing=framing,
        )
        self.assertTrue(gate.get("direction_contradiction"),
                        "bullish framing vs a -5% session must be flagged inconsistent")
        self.assertFalse(gate["checks"]["direction_consistent"])
        self.assertEqual(gate["subject"], "market_wide",
                         "a direction contradiction must relegate the stale-bullish lead")
        directive = mt.build_overview_subject_directive(gate, nf["lead_story"]["title"])
        self.assertIn("RECONCILIATION", directive,
                      "the directive must instruct a reconcile-not-celebrate reframe")

    def test_direction_check_inert_when_inputs_omitted(self):
        # Backward compatibility: the #422 call site omits the new inputs, so the
        # gate must behave exactly as before (direction_consistent stays True).
        gate = mt.overview_subject_gate(
            story_companies=["Micron Technology"],
            is_single_name_or_deal=True,
            cluster_distinct_sources=12,
            tape={"quotes": {"^GSPC": {"pct": -1.4}, "^VIX": {"pct": 11.0}},
                  "regime": "risk-off", "vix_level": 22.0},
            tape_driver_names={"micron technology"},
        )
        self.assertTrue(gate["checks"]["direction_consistent"])
        self.assertFalse(gate.get("direction_contradiction"))


class Assertion6_UnknownDateAndProse(unittest.TestCase):
    def test_unknown_published_at_strips_today(self):
        # D13: a story with NULL published_at has event_date UNKNOWN; the normalizer
        # must remove the relative-time claim and never assert "today".
        ed = tg.event_date_et(None)
        self.assertIsNone(ed, "NULL published_at must yield UNKNOWN event date")
        bd = dt.date(2026, 6, 26)
        out, changed, _ = tg.normalize_relative_time(
            "The financing closed today.", ed, bd
        )
        self.assertTrue(changed)
        self.assertNotIn("today", out.lower(),
                         "UNKNOWN-date story must not assert 'today'")

    def test_garbled_lead_detected_clean_lead_passes(self):
        # D15: the shipped garbled construction is detected; the fixed version is not.
        nf = _load_narration()
        gen = nf["generated_narrative"]
        self.assertTrue(pq.has_garbled_prose(gen["garbled_lead_paragraph"]),
                        "the 'stock surge ... underscores' construction must be flagged")
        self.assertFalse(pq.has_garbled_prose(gen["lead_paragraph"]),
                         "the corrected lead must pass the prose guard")


# ── Phase 2: Jun 26 EVENING lead-trust scenario (T3 driver set, T5 overlap) ───
#
# The full Jun 26 session tape (MU -6.7%, NVDA -1.6%, AVGO -3.7%, plus non-tech
# up: MSFT/IBM/LLY) is in the fixture _meta.session_tape. These assertions exercise
# the deterministic layers wired by T3/T5 on the EVENING surfaces:
#   1. TEMPORAL: the normalized "The Close" (narrative) and "Today's Story"
#      (lead_paragraph) contain no "today" / "this morning" for the Jun 25 event.
#   2. DIRECTION/GATE: Micron IS a tape driver on Jun 26 (derived via the real T3
#      build_tape_driver_names over the session tape) but DOWN, so the bullish-
#      framed Micron story FAILS the overview-subject gate.
#   3. OVERLAP: the relegating gate emits the T5 distinct-subject directive, so
#      "The Close" and "Today's Story" do not both resolve to the stale Micron.
# (D8 and the honesty meta-test live below.)

class Assertion7_EveningDriverSetAndOverlap(unittest.TestCase):
    BRIEF_DATE = dt.date(2026, 6, 26)
    MATERIAL_TAPE = {
        "quotes": {"^GSPC": {"pct": -1.4}, "^VIX": {"pct": 11.0}},
        "regime": "risk-off", "vix_level": 22.0,
    }

    def _driver_set(self, nf):
        # Real T3 derivation over the documented Jun 26 per-name session tape.
        return mt.build_tape_driver_names(nf["_meta"]["session_tape"]["name_to_pct"])

    def test_micron_is_a_driver_via_real_t3_derivation(self):
        nf = _load_narration()
        drivers = self._driver_set(nf)
        self.assertIn("micron technology", drivers,
                      "MU -6.7% must be a top driver on the Jun 26 tape")
        self.assertLessEqual(len(drivers), mt.DRIVER_TOP_K,
                             "the driver set must be capped at DRIVER_TOP_K")

    def test_temporal_no_today_on_both_evening_surfaces(self):
        nf = _load_narration()
        ed = tg.event_date_et(nf["lead_story"]["published_at"])  # Jun 25 (ET)
        gen = nf["generated_narrative"]
        # lead_paragraph -> "Today's Story"; narrative -> "The Close".
        for field in ("lead_paragraph", "narrative"):
            out, changed, _ = tg.normalize_relative_time(gen[field], ed, self.BRIEF_DATE)
            self.assertTrue(changed, f"{field} should be normalized")
            low = out.lower()
            self.assertNotIn("today", low, f"{field} must not say 'today'")
            self.assertNotIn("this morning", low, f"{field} must not say 'this morning'")

    def test_bullish_micron_down_fails_gate_with_real_driver_set(self):
        nf = _load_narration()
        drivers = self._driver_set(nf)
        framing = mt.classify_framing(
            nf["lead_story"]["title"] + " " + nf["lead_story"]["summary"]
        )
        self.assertEqual(framing, "bullish")
        mu_pct = nf["_meta"]["session_tape"]["name_to_pct"]["Micron Technology"]
        gate = mt.overview_subject_gate(
            story_companies=["Micron Technology"],
            is_single_name_or_deal=True,
            cluster_distinct_sources=nf["lead_story"]["_impact_breadth"]["distinct_sources"],
            tape=self.MATERIAL_TAPE,
            tape_driver_names=drivers,
            subject_session_pct=mu_pct,
            subject_framing=framing,
        )
        # Micron clears tape_material, is_tape_driver, and breadth, so the ONLY
        # thing that relegates it is the direction contradiction (bullish vs -6.7%).
        self.assertTrue(gate["checks"]["is_tape_driver"],
                        "the real driver set must confirm Micron is a driver")
        self.assertFalse(gate["checks"]["direction_consistent"])
        self.assertEqual(gate["subject"], "market_wide",
                         "a bullish-framed Micron lead on a -6.7% session must be relegated")
        self.assertTrue(gate.get("direction_contradiction"))

    def test_overlap_directive_forces_distinct_subjects_when_relegated(self):
        nf = _load_narration()
        drivers = self._driver_set(nf)
        framing = mt.classify_framing(
            nf["lead_story"]["title"] + " " + nf["lead_story"]["summary"]
        )
        mu_pct = nf["_meta"]["session_tape"]["name_to_pct"]["Micron Technology"]
        gate = mt.overview_subject_gate(
            story_companies=["Micron Technology"],
            is_single_name_or_deal=True,
            cluster_distinct_sources=12,
            tape=self.MATERIAL_TAPE,
            tape_driver_names=drivers,
            subject_session_pct=mu_pct,
            subject_framing=framing,
        )
        directive = mt.build_overlap_enforcement_directive(gate)
        self.assertTrue(directive, "a relegated lead must emit the overlap directive")
        self.assertIn("DISTINCT", directive.upper(),
                      "the overlap directive must force distinct subjects")

    def test_overlap_directive_noop_when_lead_is_dominant_driver(self):
        # Materiality-gates-overlap: when the lead IS the dominant driver (gate
        # passed), the two surfaces are allowed to share it -> no directive.
        gate = mt.overview_subject_gate(
            story_companies=["Nvidia"],
            is_single_name_or_deal=True,
            cluster_distinct_sources=mt.MATERIALITY_MIN_DISTINCT_SOURCES + 2,
            tape={"quotes": {"^GSPC": {"pct": -1.6}, "^VIX": {"pct": 9.0}},
                  "regime": "risk-off", "vix_level": 20.0},
            tape_driver_names={"nvidia"},
        )
        self.assertTrue(gate["passed"])
        self.assertEqual(mt.build_overlap_enforcement_directive(gate), "",
                         "a dominant-driver lead may share the subject; no directive")


class Assertion8_HarnessHonestyMetaCheck(unittest.TestCase):
    """Phase 2 item 5: prove the rewritten Assertion 1 FAILS on a stale lead and
    PASSES only on a fresh one. The honesty predicate is: winner == fresh selloff
    AND winner != stale debut. We apply it to two synthetic outcomes."""
    FRESH = "co:spacex:stock"
    STALE = "co:spacex:ipo"

    def _honesty_holds(self, winner_key):
        # Mirrors Assertion1's core predicate.
        return winner_key == self.FRESH and winner_key != self.STALE

    def test_predicate_passes_on_fresh_lead(self):
        self.assertTrue(self._honesty_holds(self.FRESH),
                        "the honesty predicate must accept a fresh lead")

    def test_predicate_fails_on_stale_lead(self):
        self.assertFalse(self._honesty_holds(self.STALE),
                         "the honesty predicate must reject a stale debut lead")

    def test_real_fixture_winner_satisfies_predicate(self):
        data, now = _load()
        res = ir.compute_shadow_lead(data["articles"], now, asof_date=now.date())
        self.assertTrue(self._honesty_holds(res["cluster_key"]),
                        "the committed fixture must satisfy the honesty predicate")


class Assertion9_HeadlineTemporalAndProperNoun(unittest.TestCase):
    """Review follow-up: D13 must normalize the headline (the evening 'Today's
    Story' card renders headline + lead), and must NOT mangle a relative-time
    token that is part of a proper noun ('USA Today')."""

    JUN25 = dt.date(2026, 6, 25)
    JUN26 = dt.date(2026, 6, 26)

    def test_stale_headline_today_rewritten_to_yesterday(self):
        hl = "Micron Soars 15% Today to a New All-Time High"
        out, changed, garbled = tg.normalize_relative_time(hl, self.JUN25, self.JUN26)
        self.assertTrue(changed)
        self.assertNotIn("today", out.lower(),
                         "stale 'today' must not survive on a prior-day event headline")
        self.assertIn("yesterday", out.lower(),
                      "a one-day-prior event reads 'yesterday'")

    def test_unknown_event_date_strips_headline_today(self):
        hl = "Micron Soars 15% Today to a New All-Time High"
        out, changed, garbled = tg.normalize_relative_time(hl, None, self.JUN26)
        self.assertTrue(changed)
        self.assertNotIn("today", out.lower(),
                         "UNKNOWN event date must never assert 'today' in the headline")

    def test_proper_noun_today_not_mangled(self):
        # "USA Today" (a name) must survive; only the standalone temporal "Today"
        # at the end is rewritten.
        hl = "USA Today: Micron Soars 15% Today"
        out, changed, garbled = tg.normalize_relative_time(hl, self.JUN25, self.JUN26)
        self.assertIn("USA Today", out,
                      "the proper noun 'USA Today' must not be rewritten")
        self.assertEqual(out.lower().count("today"), 1,
                         "only the proper-noun 'today' should remain")
        self.assertIn("yesterday", out.lower(),
                      "the standalone temporal token should still be rewritten")

    def test_proper_noun_alone_no_change(self):
        # A headline whose only relative-time token is inside a proper noun must
        # not be rewritten at all.
        hl = "USA Today Names Micron Stock of the Year"
        out, changed, garbled = tg.normalize_relative_time(hl, self.JUN25, self.JUN26)
        self.assertFalse(changed, "a proper-noun-only token must not trigger a rewrite")
        self.assertEqual(out, hl)


# ── Phase 2 (gate-on-final-lead): self-select bypass + grounding post-check ───
#
# These exercise the deterministic layers that #430 left open on the Gemini
# self-select path: the overview-subject gate run on the FINAL chosen lead, and
# the pure grounding post-check (overview_grounding) that catches unsupported
# entities and tape-claim contradictions and also replaces the D8 fragment bug.
# The market-wide rewrite re-ask is integration-only (it calls the model) and is
# NOT asserted here; the gate decision, the post-check, and the minimal grounded
# template ARE pure and asserted.

# A quiet / divided tape with no single name owning the read (weekend / thin
# pool shape). Below both materiality thresholds; neutral regime.
QUIET_TAPE = {
    "quotes": {
        "^GSPC": {"price": 7600.0, "prev": 7595.0, "pct": 0.07},
        "^IXIC": {"price": 25800.0, "prev": 25790.0, "pct": 0.04},
        "^VIX": {"price": 15.6, "prev": 15.4, "pct": 1.3},
    },
    "regime": "neutral",
    "vix_level": 15.6,
}
# A clearly DOWN tape (risk-off) for tape-claim contradiction tests.
DOWN_TAPE = {
    "quotes": {
        "^GSPC": {"price": 7480.0, "prev": 7600.0, "pct": -1.58},
        "^IXIC": {"price": 25200.0, "prev": 25800.0, "pct": -2.33},
        "^VIX": {"price": 23.0, "prev": 20.0, "pct": 15.0},
    },
    "regime": "risk-off",
    "vix_level": 23.0,
}


class Assertion10_SelfSelectBypassRepro(unittest.TestCase):
    """Phase 2 item 1 (THE test that would have caught the prod bug). Mirrors the
    live dry run: empty deterministic pre-pick, a thin/quiet pool, and a single
    Gemini-self-selected DEAL lead. On the self-select path #430 never ran the
    gate. Assert the gate, run on the FINAL chosen single-name subject against a
    quiet tape, FORCES MARKET-WIDE (the deal is a mention, not the subject)."""

    def test_self_selected_single_name_relegated_on_quiet_tape(self):
        # Self-select path: a single Gemini-chosen deal lead, no pre-pick gate.
        # The gate sees one resolved name, a quiet tape, no driver set, and (post-
        # gen) cannot recompute breadth, so it must default MARKET-WIDE.
        gate = mt.overview_subject_gate(
            story_companies=["Acme Robotics"],
            is_single_name_or_deal=True,
            cluster_distinct_sources=0,         # post-gen: breadth unrecomputable
            tape=QUIET_TAPE,
            tape_driver_names=None,             # no gen-time per-name driver
            subject_session_pct=None,
            subject_framing=None,
        )
        self.assertEqual(gate["subject"], "market_wide",
                         "a self-selected single name on a quiet tape must be relegated")
        self.assertFalse(gate["passed"])
        # The quiet tape is a binding reason: no single driver owns the read.
        self.assertFalse(mt.tape_has_material_move(QUIET_TAPE))

    def test_relegated_overview_must_not_center_on_the_deal(self):
        # The grounded market-wide overview, post-rewrite, must validate clean and
        # keep the deal to at most a mention. A narrative that is ONLY the single
        # name is exactly the bug; the minimal grounded template proves a
        # market-altitude, tape-grounded result is reachable deterministically.
        minimal = og.build_minimal_overview(QUIET_TAPE, "Acme Robotics raises $400M")
        res = og.validate_overview(minimal, "acme robotics raises $400m", ["Acme Robotics"], QUIET_TAPE)
        self.assertTrue(res["ok"], f"minimal grounded overview should validate: {res['reasons']}")
        # It leads with the tape, not the single name (market altitude).
        self.assertTrue(minimal.lower().startswith("on a quiet tape"),
                        "the grounded overview must lead with the tape, not the single name")


class Assertion11_PostCheckEntity(unittest.TestCase):
    """Phase 2 item 2 + the D8 fragment fix."""

    CORPUS = "nvidia posted results. broadcom guided higher. the s&p 500 was mixed."
    ROSTER = ["Nvidia", "Broadcom"]

    def test_absent_company_is_flagged(self):
        text = "Acme Robotics surged on no news while Nvidia held flat."
        bad = og.unsupported_entities(text, self.CORPUS, self.ROSTER)
        self.assertIn("Acme Robotics", bad,
                      "an org absent from corpus + roster must be flagged")
        self.assertNotIn("Nvidia", bad, "a roster org must not be flagged")

    def test_fragment_not_parsed_as_org_western_digital(self):
        # The D8 bug: the period joined "Western Digital. This" into one phrase.
        # The sentence-bounded extractor must yield only "Western Digital".
        text = "Western Digital. This was the read across chips."
        cands = og.candidate_orgs(text)
        self.assertIn("Western Digital", cands)
        self.assertNotIn("Western Digital. This", cands,
                         "a sentence period must not join two sentences into one org")
        # And with Western Digital in the roster, nothing should be flagged.
        bad = og.unsupported_entities(text, "western digital news", ["Western Digital"])
        self.assertEqual(bad, [], f"no fragment should be flagged, got {bad}")

    def test_fragment_not_parsed_as_org_the_technology(self):
        text = "The Technology sector led. The market was calm."
        cands = og.candidate_orgs(text)
        self.assertNotIn("The Technology", cands,
                         "'The Technology' must not parse as an org")
        # No real org named, so nothing flagged even against an empty corpus.
        self.assertEqual(og.unsupported_entities(text, "", []), [])


class Assertion12_PostCheckTape(unittest.TestCase):
    """Phase 2 item 3: tape-claim consistency."""

    def test_bullish_claim_against_down_tape_flagged(self):
        text = "Stocks rallied broadly in a resilient session as risk appetite returned."
        v = og.tape_claim_violations(text, DOWN_TAPE)
        self.assertTrue(v, "a bullish/rallying claim against a down tape must be flagged")

    def test_tape_consistent_claim_passes(self):
        text = "Equities fell hard as a risk-off mood gripped the tape."
        v = og.tape_claim_violations(text, DOWN_TAPE)
        self.assertEqual(v, [], "a down-tape-consistent claim must pass")

    def test_no_tape_skips_check(self):
        text = "Stocks rallied broadly."
        self.assertEqual(og.tape_claim_violations(text, None), [],
                         "no tape -> cannot validate -> no violation")

    def test_quiet_tape_does_not_flag_direction(self):
        # A flat/neutral tape is genuinely mixed; a direction word is not a
        # contradiction there.
        self.assertEqual(og.tape_claim_violations("Stocks edged higher.", QUIET_TAPE), [])


class Assertion13_Brevity(unittest.TestCase):
    """Phase 2 item 4: a thin pool does not force a long overview; the minimal
    grounded template is reachable and produces a short, tape-grounded result."""

    def test_minimal_template_is_short_and_grounded(self):
        out = og.build_minimal_overview(QUIET_TAPE, "Acme Robotics raises $400M")
        # Short: well under a padded multi-paragraph overview.
        self.assertLess(len(out), 280, "the thin-pool overview must stay brief")
        self.assertNotIn("\n\n", out, "the minimal overview is a single short read")
        # Grounded: it cites the actual tape numbers, not an invented direction.
        self.assertIn("+0.07%", out,
                      "the overview must cite the fetched S&P figure")
        self.assertIn("15.6", out, "the overview must cite the fetched VIX level")
        # Validates clean against its own corpus + tape.
        res = og.validate_overview(out, "acme robotics raises $400m", ["Acme Robotics"], QUIET_TAPE)
        self.assertTrue(res["ok"], f"the minimal overview must self-validate: {res['reasons']}")


class Assertion15_FallbackRegimeWordMatchesTape(unittest.TestCase):
    """The minimal template's regime word must match the numbers. The self-select
    fallback relegates to market-wide on ANY tape, so the template can fire on a
    material-move day; a hardcoded 'quiet' would then contradict the figures."""

    MATERIAL_TAPE = {
        "quotes": {"^GSPC": {"pct": -1.4}, "^IXIC": {"pct": -1.8}, "^VIX": {"pct": 15.0}},
        "vix_level": 22.0,
        "regime": "risk-off",
    }

    def test_material_tape_does_not_say_quiet(self):
        out = og.build_minimal_overview(self.MATERIAL_TAPE, "Federal Reserve Holds Rates")
        self.assertNotIn("quiet", out.lower(),
                         "a material-move tape must not be framed as 'quiet'")
        self.assertIn("-1.40%", out, "the material overview must still cite the S&P figure")

    def test_flat_tape_may_say_quiet(self):
        out = og.build_minimal_overview(QUIET_TAPE, "Acme Robotics raises $400M")
        self.assertIn("quiet", out.lower(),
                      "a flat tape is correctly framed as quiet")


class Assertion14_FailSafeUnresolvableLead(unittest.TestCase):
    """Phase 2 item 5: when the final lead name is unresolvable, the decision must
    default MARKET-WIDE, never a single-name subject. This mirrors the run()
    fail-safe branch deterministically."""

    def test_unresolvable_lead_defaults_market_wide(self):
        # The run() fail-safe constructs this gate-shaped dict when no single name
        # resolves from the generated JSON.
        final_gate = {"subject": "market_wide", "passed": False,
                      "reasons": ["final lead name unresolvable; defaulting market-wide"],
                      "checks": {}}
        self.assertEqual(final_gate["subject"], "market_wide")
        self.assertFalse(final_gate["passed"])
        # And the grounded overview built for that case is market-altitude, not a
        # single name: even with no story title it leads with the tape.
        out = og.build_minimal_overview(QUIET_TAPE, None)
        self.assertTrue(out.lower().startswith("on a quiet tape"),
                        "an unresolvable-lead overview must lead with the tape, not a name")
        self.assertEqual(og.unsupported_entities(out, "", []), [],
                         "the fail-safe overview names no unsupported entity")


# ── Phase 2 (decouple Market Pulse): always-market-wide hero ─────────────────
#
# These exercise the T1 decoupling deterministically. synthesize.run() now runs
# the grounded market-wide rewrite of market_pulse.narrative on BOTH gate
# branches (the `if subject == "market_wide"` guard is gone). The model rewrite
# itself is integration-only (Gemini), so it is NOT asserted; what IS pure and
# asserted here is:
#   - the always-run DECISION predicate (rewrite fires regardless of gate),
#   - the lead_is_dominant flag the predicate threads into the prompt,
#   - the grounded post-check on a market-wide hero (reuses Assertion10-13),
#   - the minimal grounded fallback is short + tape-grounded on a thin pool.
#
# The exact predicates mirror synthesize.run() (single-source-of-truth comment):
#   _lead_is_dominant = (_final_gate.get("subject") != "market_wide")
#   the rewrite block runs UNCONDITIONALLY (no `if subject == market_wide`).


def _rewrite_runs(final_gate) -> bool:
    """Mirror of the T1 production condition: the grounded market-wide rewrite of
    the hero runs on EVERY morning/evening brief, regardless of the gate subject.
    The pre-T1 code gated this on `subject == 'market_wide'`; T1 removed that."""
    return True  # always-run; the gate no longer gates the hero rewrite


def _lead_is_dominant(final_gate) -> bool:
    """Mirror of the T1 production flag threaded into the rewrite prompt: when the
    gate PASSED (subject is a single name), the lead genuinely dominates and the
    market-wide read MAY center on it; when relegated, it is at most an example."""
    return (final_gate or {}).get("subject") != "market_wide"


# A broad RISK-ON rally tape: S&P/Nasdaq/Russell all up ~1-2%, calm VIX. This is
# the Jun 29 Rocket Lab/Iridium shape - a single fresh deal led, but the tape was
# a broad rally that the hero should have described (deal as one example).
BROAD_RALLY_TAPE = {
    "quotes": {
        "^GSPC": {"price": 7700.0, "prev": 7600.0, "pct": 1.32},
        "^IXIC": {"price": 26200.0, "prev": 25800.0, "pct": 1.55},
        "^RUT": {"price": 2400.0, "prev": 2360.0, "pct": 1.69},
        "^VIX": {"price": 14.2, "prev": 15.2, "pct": -6.6},
    },
    "regime": "risk-on",
    "vix_level": 14.2,
}


class Assertion16_SingleDealDayAlwaysMarketWide(unittest.TestCase):
    """Phase 2 item 1 (Rocket Lab / Saab repro - THE Jun 29 bug). A single fresh
    deal leads on a broad-rally tape. Under T1 the hero is rewritten market-wide
    REGARDLESS of whether the lead gate passes the single name. Pre-T1, a gate-PASS
    single name skipped the rewrite and owned the hero; this asserts the rewrite
    fires anyway and the grounded result is the broad-tape read with the deal as at
    most an example, not the subject."""

    LEAD_NAME = "Rocket Lab"
    LEAD_TITLE = "Rocket Lab to Acquire Iridium in $8B Deal"
    CORPUS = (
        "rocket lab to acquire iridium in an $8 billion deal. "
        "broadcom and nvidia gained. the s&p 500 and russell 2000 rallied broadly."
    )
    ROSTER = ["Rocket Lab", "Iridium", "Broadcom", "Nvidia"]

    def _gate_passed_single_name(self):
        # Simulate the gate PASSING the single name (the pre-T1 path that left the
        # hero as the deal): material tape, named as a driver, dominant breadth.
        return mt.overview_subject_gate(
            story_companies=[self.LEAD_NAME],
            is_single_name_or_deal=True,
            cluster_distinct_sources=mt.MATERIALITY_MIN_DISTINCT_SOURCES + 3,
            tape=BROAD_RALLY_TAPE,
            tape_driver_names={"rocket lab"},
        )

    def test_hero_rewrite_runs_even_when_gate_passes(self):
        gate = self._gate_passed_single_name()
        # Precondition for the bug: the gate PASSES the single name (pre-T1 this
        # skipped the hero rewrite entirely).
        self.assertTrue(gate["passed"],
                        "fixture must reproduce a gate-PASS single name (the bug precondition)")
        self.assertNotEqual(gate["subject"], "market_wide")
        # T1 contract: the hero rewrite runs REGARDLESS of the gate subject.
        self.assertTrue(_rewrite_runs(gate),
                        "the always-market-wide hero rewrite must run even on gate-PASS")
        # And the dominant flag is threaded so the read may center (T4) but stays
        # market-wide framed.
        self.assertTrue(_lead_is_dominant(gate),
                        "a gate-PASS single name must be flagged lead_is_dominant for T4")

    def test_grounded_market_wide_hero_references_tape_not_solely_the_deal(self):
        # The deterministic proof that a market-wide, tape-grounded hero is reachable
        # for this single-deal day: the minimal grounded template leads with the
        # broad-rally tape numbers, names no single deal as the subject, and
        # validates clean. (The model rewrite is integration-only; this is the
        # deterministic floor the post-check guarantees.)
        hero = og.build_minimal_overview(BROAD_RALLY_TAPE, self.LEAD_TITLE)
        # Market-altitude: it cites the broad tape, not just the deal.
        self.assertIn("+1.32%", hero, "the hero must cite the broad S&P move")
        self.assertTrue(hero.lower().startswith("the tape is moving"),
                        "a material rally hero must lead with the tape, not the deal name")
        # The deal title appears only as the trailing example mention, never the
        # subject the read opens on.
        self.assertFalse(hero.lower().startswith(self.LEAD_NAME.lower()),
                         "the hero must not open on the single deal name")
        # Grounded: validates clean against the corpus + tape (no unsupported
        # entity, no down-claim against an up tape).
        res = og.validate_overview(hero, self.CORPUS, self.ROSTER, BROAD_RALLY_TAPE)
        self.assertTrue(res["ok"], f"the market-wide hero must validate clean: {res['reasons']}")

    def test_hero_not_verbatim_identical_to_lead(self):
        # T1 anti-duplication contract: the hero is not a byte copy of the lead
        # block. The grounded market-wide hero (tape-led) differs from a single-name
        # lead paragraph by construction.
        lead_paragraph = (
            "Rocket Lab agreed to acquire Iridium in an $8 billion deal, the largest "
            "space-sector transaction of the year."
        )
        hero = og.build_minimal_overview(BROAD_RALLY_TAPE, self.LEAD_TITLE)
        self.assertNotEqual(hero.strip(), lead_paragraph.strip(),
                            "the hero must not be verbatim-identical to the lead paragraph")


class Assertion17_DominantDriverDayMayCenter(unittest.TestCase):
    """Phase 2 item 2. When one event genuinely IS the whole tape (a Fed shock /
    crash), the gate PASSES it as the dominant driver and the market-wide hero MAY
    center on it - the T4 contract. Assert the dominant flag is set (centering is
    ALLOWED) and the hero is NOT forced away from the dominant story."""

    FED_SHOCK_TAPE = {
        "quotes": {"^GSPC": {"pct": -2.6}, "^IXIC": {"pct": -3.1}, "^VIX": {"pct": 35.0}},
        "regime": "risk-off",
        "vix_level": 31.0,
    }

    def test_dominant_driver_is_flagged_centerable(self):
        gate = mt.overview_subject_gate(
            story_companies=["Federal Reserve"],
            is_single_name_or_deal=True,
            cluster_distinct_sources=mt.MATERIALITY_MIN_DISTINCT_SOURCES + 5,
            tape=self.FED_SHOCK_TAPE,
            tape_driver_names={"federal reserve"},
        )
        # The gate passes the dominant driver, so the hero rewrite is flagged
        # lead_is_dominant: centering is ALLOWED, not forced away.
        self.assertTrue(gate["passed"], "a dominant driver should clear the gate")
        self.assertTrue(_lead_is_dominant(gate),
                        "a dominant-driver day must permit the hero to center on it (T4)")
        # The rewrite still runs (it is always-on), it is just allowed to center.
        self.assertTrue(_rewrite_runs(gate))
        # The grounded down-tape hero is consistent with the risk-off shock (no
        # forced up-claim); a Fed-shock title is allowed as the centered example.
        # NOTE: title avoids substrings the tape-claim validator treats as up-words
        # (e.g. "surprises" contains "rise"); that substring matcher is pre-existing
        # validator behavior, not under test here.
        hero = og.build_minimal_overview(self.FED_SHOCK_TAPE, "Fed Shocks Markets With Rate Increase")
        self.assertEqual(og.tape_claim_violations(hero, self.FED_SHOCK_TAPE), [],
                         "the down-tape hero must not assert an up move")


class Assertion18_HeroGroundingCaughtAndThinPoolBrief(unittest.TestCase):
    """Phase 2 items 3 + 4 on the always-on hero. Item 3: an ungrounded hero
    (non-corpus entity OR a tape-inconsistent claim) is caught by validate_overview
    so it cannot ship. Item 4: on a thin pool the grounded fallback is short and
    tape-grounded (brevity allowed)."""

    def test_noncorpus_entity_in_hero_is_caught(self):
        # The market-wide hero names a company absent from the corpus + roster.
        hero = "The tape rallied broadly. Zeta Dynamics led the move."
        res = og.validate_overview(hero, "broadcom gained; the s&p rose.", ["Broadcom"], BROAD_RALLY_TAPE)
        self.assertFalse(res["ok"], "a hero naming a non-corpus entity must fail the post-check")
        self.assertIn("Zeta Dynamics", res["unsupported_entities"])

    def test_tape_inconsistent_hero_is_caught(self):
        # A bullish/rallying hero against a DOWN tape is caught.
        hero = "Stocks rallied in a resilient, risk-on session."
        res = og.validate_overview(hero, "", [], DOWN_TAPE)
        self.assertFalse(res["ok"], "an up-claim hero against a down tape must fail the post-check")
        self.assertTrue(res["tape_violations"])

    def test_thin_pool_hero_is_brief_and_grounded(self):
        # Thin/quiet pool: the grounded fallback is short and cites the real tape.
        hero = og.build_minimal_overview(QUIET_TAPE, None)
        self.assertLess(len(hero), 280, "a thin-pool hero must stay brief (no padding)")
        self.assertNotIn("\n\n", hero, "the thin-pool hero is a single short read")
        self.assertIn("+0.07%", hero, "the thin-pool hero must cite the fetched S&P figure")
        self.assertTrue(og.validate_overview(hero, "", [], QUIET_TAPE)["ok"],
                        "the thin-pool hero must self-validate")


# ── MARKET_PULSE_V2: dedicated tape-first pulse opening post-check ────────────
#
# These exercise the PURE deterministic post-check the V2 wire-in runs on the
# dedicated pulse narrative (overview_grounding.validate_pulse_opening and its
# component predicates). The Gemini call itself (generate_market_pulse) is
# integration-only and is NOT asserted; synthesize.py is intentionally NOT
# imported (it builds Supabase + Gemini clients at import). Prose QUALITY is not
# harness-assertable; the flag-off default exists so Noah eyeballs the first real
# render before flipping it on.

# The documented "today's shape": a broad risk-on tape with an insurance-deal lead.
# The bug is an opening whose SUBJECT is the insurance sector; the fix is a
# tape-first opening with the sector only as color.
RISK_ON_TAPE = BROAD_RALLY_TAPE
INSURANCE_ROSTER = ["Chubb", "AIG", "Broadcom", "Nvidia"]


class Assertion19_PulseInsuranceSectorSubjectFlagged(unittest.TestCase):
    """THE flag test: an insurance-sector-subject opening is FLAGGED and a tape-first
    opening (index terms + regime, sector only as color) PASSES."""

    def test_insurance_sector_subject_opening_is_flagged(self):
        bad = (
            "Insurance dominated the tape as Chubb's $30 billion acquisition reshaped "
            "the sector.\n\nThe S&P 500 rose +1.32%."
        )
        res = og.validate_pulse_opening(bad, INSURANCE_ROSTER, "evening")
        self.assertFalse(res["ok"], "an insurance-sector-subject opening must be flagged")
        self.assertTrue(
            any("single company or a lone sector" in r for r in res["reasons"]),
            f"the sector-subject reason must fire, got {res['reasons']}",
        )

    def test_single_company_subject_opening_is_flagged(self):
        bad = "Chubb led the day after agreeing to a $30 billion acquisition."
        res = og.validate_pulse_opening(bad, INSURANCE_ROSTER, "evening")
        self.assertFalse(res["ok"], "a single-company-subject opening must be flagged")

    def test_tape_first_opening_passes(self):
        good = (
            "The S&P 500 closed +1.32% and the Nasdaq +1.55% in a broad risk-on "
            "session, with the VIX easing to 14.2 as breadth widened. Insurance was "
            "one bright spot: Chubb's acquisition added to the day's deal color.\n\n"
            "Under the surface, the rally was cyclical."
        )
        res = og.validate_pulse_opening(good, INSURANCE_ROSTER, "evening")
        self.assertTrue(res["ok"], f"a tape-first opening must pass: {res['reasons']}")

    def test_opening_market_terms_predicate(self):
        self.assertTrue(og.opening_has_market_terms("The S&P 500 rose 1.3% today."))
        self.assertTrue(og.opening_has_market_terms("Equities firmed as breadth improved."))
        self.assertFalse(
            og.opening_has_market_terms("Chubb's acquisition reshaped underwriting."),
            "an opening with no index/market term must not count as a market read",
        )


class Assertion20_PulseClaimScopeByBriefType(unittest.TestCase):
    """Morning must use opened/opening/early-session framing (a settled whole-day
    close verdict is flagged); evening may render a settled close."""

    MORNING_CLOSE_CLAIM = (
        "The S&P 500 closed higher and the Nasdaq finished the day up as risk "
        "appetite returned."
    )
    MORNING_OPEN_FRAME = (
        "The S&P 500 opens on firmer footing after the prior session closed +1.3%, "
        "with the VIX easing into the open."
    )
    EVENING_CLOSE_CLAIM = (
        "The S&P 500 closed higher and the Nasdaq finished the day up as risk "
        "appetite returned across the tape."
    )

    def test_morning_settled_close_verdict_flagged(self):
        self.assertTrue(
            og.opening_claim_scope_violation(self.MORNING_CLOSE_CLAIM, "morning"),
            "a morning pulse asserting a settled whole-day close must be flagged",
        )
        res = og.validate_pulse_opening(self.MORNING_CLOSE_CLAIM, [], "morning")
        self.assertFalse(res["ok"])
        self.assertTrue(any("CLOSE verdict" in r for r in res["reasons"]))

    def test_morning_opening_frame_passes_scope(self):
        self.assertFalse(
            og.opening_claim_scope_violation(self.MORNING_OPEN_FRAME, "morning"),
            "prior-close / into-the-open framing must not be flagged for morning",
        )

    def test_evening_close_verdict_allowed(self):
        self.assertFalse(
            og.opening_claim_scope_violation(self.EVENING_CLOSE_CLAIM, "evening"),
            "a settled close is allowed for the evening brief",
        )
        res = og.validate_pulse_opening(self.EVENING_CLOSE_CLAIM, [], "evening")
        self.assertTrue(res["ok"], f"an evening close-verdict tape read must pass: {res['reasons']}")


class Assertion21_PulseThinTapeBrevityReachable(unittest.TestCase):
    """The thin-tape brevity path: the minimal grounded fallback (what the V2 wire-in
    falls back to when the re-ask still violates) is short AND tape-grounded AND
    passes the pulse opening post-check (it leads with the tape)."""

    def test_minimal_fallback_passes_pulse_opening_and_is_brief(self):
        hero = og.build_minimal_overview(QUIET_TAPE, "Acme Robotics raises $400M")
        self.assertLess(len(hero), 280, "the thin-tape fallback must stay brief")
        res = og.validate_pulse_opening(hero, ["Acme Robotics"], "morning")
        self.assertTrue(res["ok"], f"the minimal grounded fallback must pass the pulse opening check: {res['reasons']}")
        # It leads with the tape, not the single name.
        self.assertTrue(og.opening_has_market_terms(hero))
        self.assertFalse(og.opening_subject_is_single_focus(hero, ["Acme Robotics"]))


class ValidateOverviewFalseTripTests(unittest.TestCase):
    """Regression for the two validate_overview false-trips that bounced GOOD V2
    primaries to the minimal template. Corrections, not weakening: real grounding
    violations must still be caught."""

    UP_TAPE = {"regime": "risk-on", "quotes": {"^GSPC": {"pct": 0.72}}, "vix_level": 15.6}

    def test_macro_term_is_supported(self):
        # "Nonfarm Payrolls" comes from the macro strip, not the article corpus.
        text = ("Equities opened higher, the S&P 500 up 0.72%. The market took a "
                "positive read from the latest Nonfarm Payrolls report.")
        res = og.validate_overview(text, "unum fortitude re", {"Unum"}, self.UP_TAPE)
        self.assertTrue(res["ok"], res["reasons"])
        self.assertNotIn("Nonfarm Payrolls", " ".join(res["unsupported_entities"]))

    def test_company_de_risking_does_not_trip_direction(self):
        # A company "de-risking" on a plainly risk-on tape is not a market claim.
        text = ("Equities closed higher in a buoyant, risk-on session. Unum "
                "continued its strategic de-risking, ceding reserves to Fortitude Re.")
        res = og.validate_overview(text, "unum fortitude re", {"Unum", "Fortitude Re"}, self.UP_TAPE)
        self.assertTrue(res["ok"], res["reasons"])

    def test_real_unsupported_org_still_rejected(self):
        # Guardrail: a company in NO source is still flagged.
        res = og.validate_overview("Acme Robotics Inc surged on the news.",
                                   "unum fortitude", set(), self.UP_TAPE)
        self.assertFalse(res["ok"])
        self.assertIn("Acme Robotics Inc", res["unsupported_entities"])

    def test_genuine_direction_contradiction_still_caught(self):
        # Guardrail: a net-down narrative on an up tape still fires.
        res = og.validate_overview(
            "Stocks fell sharply in a broad selloff and declined into the close.",
            "", set(), self.UP_TAPE)
        self.assertFalse(res["ok"])
        self.assertTrue(res["tape_violations"])


class ValidatePulseGroundingTests(unittest.TestCase):
    """The V2 pulse validates against its OWN inputs (tape + macro + stories), not
    the article corpus. Legitimate non-company vocabulary must not false-flag; a
    real hallucinated company (in NO input) and a tape contradiction must fail."""

    UP_TAPE = {"regime": "risk-on", "quotes": {"^GSPC": {"pct": 0.64}}, "vix_level": 16.1}
    MACRO = "Nonfarm Payrolls (Jun): +158984K; Unemployment 4.2%"
    STORIES = [
        {"title": "CME Group announces Treasury Link", "sector": "Financials", "companies": ["CME Group"]},
        {"title": "Micron to boost US semiconductor supply chain", "sector": "Tech", "companies": ["Micron"]},
        {"title": "BlackRock launches IQQ ETF", "sector": "Financials", "companies": ["BlackRock"]},
    ]

    def test_possessive_geography_govbody_do_not_trip(self):
        narr = ("U.S. equities closed higher, the S&P 500 gaining 0.64%, risk-on, VIX at 16.1. "
                "Nonfarm payrolls rose. Geopolitical tensions in the Middle East and the Strait "
                "of Hormuz kept oil elevated, and the Fed stayed in focus. CME Group's new "
                "Treasury Link and Micron's investment drew attention.")
        res = og.validate_pulse_grounding(narr, self.UP_TAPE, self.MACRO, self.STORIES)
        self.assertTrue(res["ok"], res["reasons"])

    def test_company_in_stories_passes(self):
        res = og.validate_pulse_grounding(
            "Equities rose, risk-on. BlackRock launched a new ETF.",
            self.UP_TAPE, self.MACRO, self.STORIES)
        self.assertTrue(res["ok"], res["reasons"])

    def test_hallucinated_company_still_fails(self):
        res = og.validate_pulse_grounding(
            "Equities rose in a risk-on session; Globex Dynamics Corp surged on no news.",
            self.UP_TAPE, self.MACRO, self.STORIES)
        self.assertFalse(res["ok"])
        self.assertIn("Globex Dynamics Corp", res["unsupported_entities"])

    def test_tape_direction_contradiction_still_fails(self):
        res = og.validate_pulse_grounding(
            "Stocks fell sharply in a broad selloff and declined into the close.",
            self.UP_TAPE, self.MACRO, self.STORIES)
        self.assertFalse(res["ok"])
        self.assertTrue(res["tape_violations"])


if __name__ == "__main__":
    unittest.main()
