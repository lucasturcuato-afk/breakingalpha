"""Unit tests for the O2 guaranteed lane + O3 event-theme merge (Agent HARD).

Pure / offline: impact_ranking imports only stdlib, so no env and no network.
Run from repo root: python -m unittest backend.tests.test_guaranteed_lane
"""
import datetime as dt
import sys
import unittest
from pathlib import Path

_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

import impact_ranking as ir  # noqa: E402

NOW = dt.datetime(2026, 7, 27, 15, 0, tzinfo=dt.timezone.utc)


def art(title, source="PE Hub", rel=10, hours_ago=2, companies=None, url=None):
    ts = (NOW - dt.timedelta(hours=hours_ago)).isoformat()
    return {"title": title, "summary": "", "source": source, "relevance_score": rel,
            "companies": companies or [], "url": url or ("http://x/" + title[:20]),
            "published_at": ts, "ingested_at": ts, "deal_type": "M&A"}


class GuaranteedLane(unittest.TestCase):
    def test_flags_confirmed_seller_verb_deal_with_no_dealflow_row(self):
        # Arlington 07-27: no deal_flow row at all; recovered off the TITLE.
        pool = [art("Arlington exits Riverpoint to Novanta in $1.45bn deal", url="u1"),
                art("Arlington closes $1.45bn sale of Riverpoint to Novanta", url="u2")]
        got = ir.article_side_mega_deal_urls(pool)
        self.assertEqual(got, {"u1", "u2"})

    def test_flags_confirmed_buyer_verb_deal(self):
        # Uber 07-17: deal_flow valuation NULL; recovered off the TITLE.
        pool = [art("Uber Buys Delivery Hero in $14.8B Stock Deal", url="u3", companies=["Uber"])]
        self.assertEqual(ir.article_side_mega_deal_urls(pool), {"u3"})

    def test_does_not_flag_rumor(self):
        pool = [art("Uber explores potential $14.8B bid for Delivery Hero", url="r1")]
        self.assertEqual(ir.article_side_mega_deal_urls(pool), set())

    def test_does_not_flag_subthreshold_value(self):
        pool = [art("Acme acquires Beta in $400M deal", url="s1")]
        self.assertEqual(ir.article_side_mega_deal_urls(pool), set())

    def test_union_into_confirmed_mega_deal_urls_with_empty_dealflow(self):
        pool = [art("Arlington exits Riverpoint to Novanta in $1.45bn deal", url="u1")]
        self.assertIn("u1", ir.confirmed_mega_deal_urls([], pool))

    def test_theme_merge_past_tense_and_seller_converge_on_ma(self):
        # O3: past-tense / seller framing of ONE deal must land on the :ma theme so
        # distinct sources of the same event are not split across sub-clusters.
        for title in ("Uber Just Bought Delivery Hero for $14.8B, Big for the Stock",
                      "Arlington closes $1.45bn sale of Riverpoint to Novanta"):
            key = ir.cluster_key({"title": title, "summary": "",
                                  "companies": ["Uber"]})
            self.assertTrue(key.endswith(":ma"), f"{title!r} -> {key}")

    def test_bare_share_sale_stays_offering_not_ma(self):
        # Precision guard: an equity raise ("share sale") must NOT be pulled into :ma.
        key = ir.cluster_key({"title": "Acme prices $1.2B share sale", "summary": "",
                              "companies": ["Acme"]})
        self.assertFalse(key.endswith(":ma"), key)

    def test_mega_deal_gets_materiality_floor_on_quiet_tape(self):
        # O3 floor: a confirmed mega-deal is material by value even on a flat tape.
        cluster = {"cluster_key": "co:uber:ma", "distinct_sources": 2,
                   "is_mega_deal": True,
                   "_articles": [art("Uber Buys Delivery Hero in $14.8B Stock Deal",
                                     companies=["Uber"])]}
        comp, reasons = ir._unified_materiality(cluster, tape=None, driver_names=set(),
                                                name_session_pct=None)
        self.assertGreaterEqual(comp, ir._MEGA_MAT_FLOOR_MIN)
        self.assertLess(comp, 0.5 + ir._MAT_WIDE_EDGE_MAX + 1e-9)  # stays under macro cap


if __name__ == "__main__":
    unittest.main()
