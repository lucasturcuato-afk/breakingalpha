"""Unit tests for backend/impact_ranking.py (SHADOW market-impact lead ranking).

Pure / offline: impact_ranking imports only stdlib, so no env and no network.

Run from repo root: python -m unittest backend.tests.test_impact_ranking
"""
import datetime as dt
import sys
import unittest
from pathlib import Path

_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

import impact_ranking as ir  # noqa: E402

NOW = dt.datetime(2026, 6, 18, 14, 0, tzinfo=dt.timezone.utc)


def art(title, source, rel=8, hours_ago=4, companies=None, url=None, summary=""):
    ts = (NOW - dt.timedelta(hours=hours_ago)).isoformat()
    return {
        "title": title, "summary": summary, "source": source,
        "relevance_score": rel, "companies": companies or [],
        "url": url or f"http://x/{abs(hash(title)) % 99999}",
        "published_at": ts, "ingested_at": ts,
    }


def fed_corpus(n_sources):
    return [art("Fed holds rates in a hawkish FOMC decision; dot plot shifts",
                f"Outlet{i}", rel=9) for i in range(n_sources)]


class ClusterKeyTests(unittest.TestCase):
    def test_fed_bucket(self):
        self.assertEqual(ir.cluster_key(art("FOMC rate decision: a hawkish hold", "FT")), "macro:fed")

    def test_powell_mccormick_is_not_fed(self):
        # bare "powell" was removed precisely so unrelated names do not cluster as Fed
        k = ir.cluster_key(art("Dina Powell McCormick opens door to Wall Street", "Axios",
                               companies=["Meta"]))
        self.assertNotEqual(k, "macro:fed")
        self.assertEqual(k, "co:meta")

    def test_company_cluster(self):
        self.assertEqual(ir.cluster_key(art("Nvidia ships new chip", "Reuters", companies=["Nvidia"])),
                         "co:nvidia")

    def test_no_sector_megacluster(self):
        # No company, no macro keyword -> singleton, NOT a sector bucket.
        k = ir.cluster_key(art("Some niche tech gadget launches", "Blog", companies=[]))
        self.assertTrue(k.startswith("one:"))

    def test_company_array_text(self):
        self.assertEqual(ir.cluster_key(art("X", "S", companies="{Eightco,OpenAI}")), "co:eightco")


class RecentEventTests(unittest.TestCase):
    def test_fomc_within_48h(self):
        # 2026-06-17 FOMC, asof 2026-06-18 -> recent fed
        self.assertIn("fed", ir.recent_tier1_events(dt.date(2026, 6, 18)))

    def test_fomc_outside_window(self):
        self.assertNotIn("fed", ir.recent_tier1_events(dt.date(2026, 6, 25)))

    def test_cpi_release_detected(self):
        # CPI released 2026-06-10; asof 2026-06-11 -> recent cpi
        self.assertIn("cpi", ir.recent_tier1_events(dt.date(2026, 6, 11)))


class AcceptanceShapeTests(unittest.TestCase):
    """The June 18 shape: a micro-cap single-name (max relevance, one source) must
    lose to a broadly-covered recent Fed event."""

    def test_fed_beats_microcap(self):
        eightco = art("Eightco reports $472M in holdings including OpenAI stake",
                      "Google News (ORBS)", rel=10, companies=["Eightco"])
        eightco_dup = art("Eightco $472M holdings (syndicated copy)",
                          "Google News (ORBS)", rel=10, companies=["Eightco"])  # same source
        pool = fed_corpus(12) + [eightco, eightco_dup]
        res = ir.compute_shadow_lead(pool, NOW, asof_date=dt.date(2026, 6, 18))
        self.assertEqual(res["cluster_key"], "macro:fed")
        self.assertIn("fed", res["recent_events"])

    def test_distinct_sources_resist_syndication_spam(self):
        # 8 copies of one promo story from ONE source must not out-rank a 5-source event.
        spam = [art(f"PROMO microcap moonshot {i}", "Google News (XYZ)", rel=10, companies=["XYZ"])
                for i in range(8)]
        real = fed_corpus(5)
        res = ir.compute_shadow_lead(spam + real, NOW, asof_date=dt.date(2026, 6, 18))
        self.assertEqual(res["cluster_key"], "macro:fed")


class MegaDealTests(unittest.TestCase):
    def test_mega_deal_leads_on_quiet_day(self):
        # No recent tier-1 macro; a $1B+ deal with broad coverage should lead.
        deal_url = "http://deal/spacex"
        deal = [art("SpaceX to acquire AI startup for $60 billion", f"Wire{i}",
                    rel=9, companies=["SpaceX"], url=(deal_url if i == 0 else None))
                for i in range(6)]
        quiet = [art("Small cap update", f"Blog{i}", rel=7, companies=[f"Tiny{i}"]) for i in range(3)]
        res = ir.compute_shadow_lead(deal + quiet, NOW, asof_date=dt.date(2026, 7, 20),
                                     mega_deal_urls={deal_url})
        self.assertEqual(res["cluster_key"], "co:spacex")
        self.assertTrue(res["top_clusters"][0]["is_mega_deal"])

    def test_empty_pool(self):
        self.assertIsNone(ir.compute_shadow_lead([], NOW))


class ScoringTests(unittest.TestCase):
    def test_recent_tier1_outscores_equal_coverage_nonmacro(self):
        fed = fed_corpus(5)
        co = [art(f"Acme earnings beat", f"Src{i}", rel=9, companies=["Acme"]) for i in range(5)]
        scored = ir.score_clusters(fed + co, NOW, recent_events={"fed"})
        top = scored[0]
        self.assertEqual(top["cluster_key"], "macro:fed")
        self.assertTrue(top["is_recent"] and top["is_tier1"])


if __name__ == "__main__":
    unittest.main()
