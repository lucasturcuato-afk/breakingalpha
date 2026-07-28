"""Unit cover for the deterministic lead-eligibility rules in impact_ranking:

  RULE 1 (L1, pre-existing): analyst rating / price-target clusters are barred
          from the LEAD unconditionally.
  RULE 2 (L2, this change): rumor / preview clusters are barred from the LEAD only
          when a confirmed alternative exists that day (mega-deal / tier-1 macro /
          article-side confirmed $1B+ deal).

Both rules run through the SHARED _lead_bar_reason gate used by BOTH the live path
(compute_shadow_lead / compute_lead) and the unified contest (compute_unified_lead),
so they survive the UNIFIED_LEAD flip. Deterministic; no network, no LLM.
"""
import datetime
import unittest

import impact_ranking as ir

NOW = datetime.datetime(2026, 7, 21, 13, 45, tzinfo=datetime.timezone.utc)


def _art(title, source="Reuters", companies=None, dtype=None, rel=8):
    return {
        "title": title, "summary": "", "source": source,
        "companies": companies or [], "deal_type": dtype,
        "relevance_score": rel,
        "published_at": (NOW - datetime.timedelta(hours=2)).isoformat(),
    }


class TestDetectors(unittest.TestCase):
    def test_rumor_preview_detector_fires_on_real_prod_titles(self):
        for t in [
            "The One Deal That Could End Micron Stock’s Old Boom-and-Bust Cycle",
            "Tesla (TSLA) Tests Semi On Chicago Routes As Fair Value Debate Heats Up",
            "Booz Allen Hamilton (BAH) To Report Earnings Tomorrow: Here Is What To Expect",
            "Waymo explores ending Uber partnership, Financial Times reports",
            "Prentis in talks to raise $100M",
        ]:
            self.assertTrue(ir.is_rumor_or_preview_lead({"title": t}), t)

    def test_rumor_detector_does_not_fire_on_confirmed_events(self):
        for t in [
            "Mitie agrees £3.1bn takeover by OCS in blow to London stock market",
            "Nvidia to Invest $1 Billion in Naver and Expand SK Group Accord",
            "Brookfield, CPP Investments to buy LXP Trust for $5.2B cash",
            "First Bancorp (FBNC) Stock Faces Stability Test As Net Interest Margin Narrows",
            "Booz Allen Hamilton (BAH) Q1 Earnings Top Estimates",
        ]:
            self.assertFalse(ir.is_rumor_or_preview_lead({"title": t}), t)

    def test_title_confirms_mega_deal(self):
        self.assertTrue(ir._title_confirms_mega_deal(
            {"title": "Mitie agrees £3.1bn takeover by OCS"}, 1.0))
        self.assertTrue(ir._title_confirms_mega_deal(
            {"title": "Hut 8 signs $9.8 billion AI data center lease in Texas"}, 1.0))
        # below floor -> not an alternative
        self.assertFalse(ir._title_confirms_mega_deal(
            {"title": "Acme acquires Beta for $200 million"}, 1.0))
        # rumor framing -> not confirmed
        self.assertFalse(ir._title_confirms_mega_deal(
            {"title": "Acme in talks to acquire Beta for $4 billion"}, 1.0))


class TestConditionalBar(unittest.TestCase):
    def _score(self, pool, mega=None):
        return ir.score_clusters(pool, NOW, mega_deal_urls=mega or set())

    def test_rumor_barred_only_when_confirmed_alt_present(self):
        rumor = _art("Tesla (TSLA) Tests Semi On Chicago Routes", companies=["Tesla"])
        deal = _art("Mitie agrees £3.1bn takeover by OCS")
        # With the confirmed deal present, the rumor cluster is lead-ineligible.
        scored = self._score([rumor, deal])
        active = ir._confirmed_alternative_exists(scored, NOW)
        self.assertTrue(active)
        rk = ir.cluster_key(rumor)
        rc = next(c for c in scored if c["cluster_key"] == rk)
        self.assertEqual(
            ir._lead_bar_reason(rc, NOW, rumor_bar_active=active),
            "rumor_preview_alt_exists")
        # Without a confirmed alternative, the SAME rumor may lead.
        scored2 = self._score([rumor, _art("Some minor stock drifts higher", companies=["Zeta"])])
        active2 = ir._confirmed_alternative_exists(scored2, NOW)
        self.assertFalse(active2)
        rc2 = next(c for c in scored2 if c["cluster_key"] == ir.cluster_key(rumor))
        self.assertIsNone(ir._lead_bar_reason(rc2, NOW, rumor_bar_active=active2))

    def test_live_and_unified_paths_bar_identically(self):
        rumor = _art("Micron Explores Strategic Deal to Stabilize Revenue", companies=["Micron"])
        deal = _art("Mitie agrees £3.1bn takeover by OCS")
        pool = [rumor, deal]
        live = ir.compute_lead(pool, NOW)
        uni = ir.compute_unified_lead(pool, NOW, tape=None)
        # Neither path leads with the rumor; both drop it for the confirmed deal.
        self.assertNotIn("Explores", live["article"]["title"])
        self.assertNotIn("Explores", uni["article"]["title"])
        # The unified audit marks the rumor cluster barred with the L2 reason.
        rk = ir.cluster_key(rumor)
        row = next((c for c in uni["unified_candidates"] if c["cluster_key"] == rk), None)
        if row is not None:
            self.assertTrue(row["lead_barred"])
            self.assertEqual(row["lead_bar_reason"], "rumor_preview_alt_exists")

    def test_analyst_pt_cluster_barred_unconditionally(self):
        pt = _art("UBS Raises Micron Price Target on Robust Free Cash Flow", companies=["Micron"])
        scored = self._score([pt])
        c = scored[0]
        # Analyst bar does not depend on rumor_bar_active.
        self.assertEqual(ir._lead_bar_reason(c, NOW, rumor_bar_active=False),
                         "analyst_rating_pt")


if __name__ == "__main__":
    unittest.main()
