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


class Assertion1_SpaceXNotWinByVolume(unittest.TestCase):
    def test_winner_is_an_event_cluster_not_company_aggregate(self):
        data, now = _load()
        scored = ir.score_clusters(data["articles"], now)

        # No cluster is the bare company aggregate any more: every SpaceX cluster
        # is event-scoped (co:spacex:<theme|sig:...>), so the 48 articles are
        # split across distinct events rather than one mega-cluster.
        spacex_clusters = [c for c in scored if c["cluster_key"].startswith("co:spacex:")]
        self.assertGreaterEqual(len(spacex_clusters), 3,
                                "SpaceX should split into multiple event clusters")
        for c in scored:
            self.assertNotEqual(c["cluster_key"], "co:spacex",
                                "the company-aggregate cluster must no longer exist")

        # The lead is drawn from a single EVENT cluster, and that cluster holds
        # far fewer than the 48 name-level articles (no name-volume win).
        res = ir.compute_shadow_lead(data["articles"], now, asof_date=now.date())
        self.assertIsNotNone(res)
        winner = next(c for c in scored if c["cluster_key"] == res["cluster_key"])
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


if __name__ == "__main__":
    unittest.main()
