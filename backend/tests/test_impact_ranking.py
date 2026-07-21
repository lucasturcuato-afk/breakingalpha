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
        # D1: company cluster is now company+event-scoped.
        self.assertTrue(k.startswith("co:meta:"))

    def test_company_cluster(self):
        # D1: company clusters carry an event sub-key (here a product launch).
        k = ir.cluster_key(art("Nvidia ships new chip", "Reuters", companies=["Nvidia"]))
        self.assertTrue(k.startswith("co:nvidia:"))

    def test_company_event_subcluster_splits_distinct_events(self):
        # D1 core: one company, two unrelated events -> two distinct clusters.
        deal = ir.cluster_key(art("SpaceX to acquire AI startup for $6.3 billion",
                                   "FT", companies=["SpaceX"]))
        bond = ir.cluster_key(art("SpaceX pitches investors juicy yields in $25bn bond deal",
                                   "Bloomberg", companies=["SpaceX"]))
        self.assertNotEqual(deal, bond)
        self.assertTrue(deal.startswith("co:spacex:"))
        self.assertTrue(bond.startswith("co:spacex:"))

    def test_company_event_subcluster_merges_syndicated_dupes(self):
        # Same event, two outlets, same theme -> SAME cluster (breadth counts).
        a = ir.cluster_key(art("SpaceX to acquire AI startup for $6.3 billion",
                               "FT", companies=["SpaceX"]))
        b = ir.cluster_key(art("SpaceX to acquire AI startup in $6.3B deal",
                               "Reuters", companies=["SpaceX"]))
        self.assertEqual(a, b)

    def test_no_sector_megacluster(self):
        # No company, no macro keyword -> singleton, NOT a sector bucket.
        k = ir.cluster_key(art("Some niche tech gadget", "Blog", companies=[]))
        self.assertTrue(k.startswith("one:"))

    def test_company_array_text(self):
        self.assertTrue(ir.cluster_key(art("X update", "S", companies="{Eightco,OpenAI}"))
                        .startswith("co:eightco:"))


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
        self.assertEqual(res["cluster_key"], "co:spacex:ma")
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


class StaleEventBackstopTests(unittest.TestCase):
    """D4: a stale-but-broadly-covered non-macro event must not out-rank a fresh
    event of equal breadth."""

    def test_fresh_event_beats_stale_equal_breadth(self):
        fresh = [art("Acme launches new platform", f"FreshSrc{i}", rel=8,
                     companies=["Acme"], hours_ago=3) for i in range(5)]
        stale = [art("Beta unveils gadget rollout", f"StaleSrc{i}", rel=8,
                     companies=["Beta"], hours_ago=40) for i in range(5)]
        scored = ir.score_clusters(fresh + stale, NOW)
        self.assertTrue(scored[0]["cluster_key"].startswith("co:acme:"))
        # The stale cluster carries the staleness reason.
        stale_c = next(c for c in scored if c["cluster_key"].startswith("co:beta:"))
        self.assertIn("stale event", stale_c["reason"])


class MegaDealRelaxTests(unittest.TestCase):
    """D12: a genuine confirmed same-day deal with a STALE deal_flow stage still
    gets the mega-deal boost when the article side is unambiguous."""

    def test_stale_stage_relaxed_when_article_confirmed(self):
        url = "http://deal/qcom-modular"
        deal_arts = [
            art("Qualcomm to acquire AI chip startup Modular Inc in $4 billion deal",
                "Bloomberg", rel=10, companies=["Qualcomm"], url=url,
                summary="Qualcomm agreed to acquire Modular Inc for $4 billion in a definitive agreement."),
            art("Qualcomm buys Modular for $4B to bolster AI chip software stack",
                "Reuters", rel=9, companies=["Qualcomm"],
                summary="Qualcomm signed an agreement to acquire Modular Inc for $4 billion."),
        ]
        deal_rows = [{"company": "Modular Inc", "acquirer": "Qualcomm", "deal_type": "M&A",
                      "stage": "rumored", "valuation": "$4B", "source_url": url}]
        urls = ir.confirmed_mega_deal_urls(deal_rows, deal_arts)
        self.assertIn(url, urls)

    def test_stale_stage_speculative_headline_still_blocked(self):
        url = "http://deal/spec"
        spec_arts = [
            art("Foo in talks to acquire Bar for $5 billion", "Bloomberg", rel=10,
                companies=["Foo"], url=url, summary="Foo is in talks to acquire Bar."),
        ]
        deal_rows = [{"company": "Bar", "acquirer": "Foo", "deal_type": "M&A",
                      "stage": "rumored", "valuation": "$5B", "source_url": url}]
        urls = ir.confirmed_mega_deal_urls(deal_rows, spec_arts)
        self.assertNotIn(url, urls)

    def test_confirmed_stage_path_preserved(self):
        url = "http://deal/closed"
        arts = [art("X completes acquisition of Y for $3B", "Wire", rel=8,
                    companies=["X"], url=url)]
        deal_rows = [{"company": "Y", "acquirer": "X", "deal_type": "M&A",
                      "stage": "closed", "valuation": "$3B", "source_url": url}]
        self.assertIn(url, ir.confirmed_mega_deal_urls(deal_rows, arts))


class TestAnalystRatingBar(unittest.TestCase):
    """L1: analyst rating / price-target stories are barred from LEADING."""

    ANALYST_TITLES = [
        "UBS raises Micron stock price target on strong free cash flow outlook",
        "UBS lowers Walt Disney stock price target on fiscal outlook",
        "Jefferies raises Arm Holdings stock price target on AI chip demand",
        "BMO downgrades Charles Schwab stock rating on valuation concerns",
        "CLSA initiates Adobe stock coverage with outperform rating",
        "Textron (NYSE:TXT) Upgraded by Wall Street Zen to Buy Rating",
        "GPN Upgraded by Morgan Stanley -- Price Target Raised to $100",
        "DDOG Maintained by Oppenheimer -- Price Target Raised to $300",
        "Oppenheimer reiterates Veeva Systems stock rating at Outperform",
        "Roblox Corporation (NYSE:RBLX) Given Average Rating of \"Moderate Buy\" by Analysts",
    ]
    # Company-own-guidance / non-analyst titles that must NOT be flagged.
    NOT_ANALYST_TITLES = [
        "IREN stock jumps 7% on $2.8bn AI contracts, raises ARR target",
        "What Levi Strauss (LEVI)'s Upgraded Outlook and Higher Dividend Means For Shareholders",
        "Strategy (MSTR) Maintains Bitcoin Holdings While Raising Cash Reserves",
        "Taiwan Stocks Attempt to Recover from 2-Month Low",
        "Micron (MU) Reaches $1 Trillion Value As Auto AI Deals Deepen",
        "Micron Explores Strategic Deal to Stabilize Revenue",
        "Planet Fitness (PLNT) Announces Acquisition of Bravo Fitness for $2B",
        "UBS: Micron could repurchase more than 40% of shares by 2028",
    ]

    def test_detector_matches_analyst_pt(self):
        for t in self.ANALYST_TITLES:
            self.assertTrue(ir.is_analyst_rating_lead({"title": t}),
                            f"should flag analyst-PT: {t}")

    def test_detector_ignores_company_guidance(self):
        for t in self.NOT_ANALYST_TITLES:
            self.assertFalse(ir.is_analyst_rating_lead({"title": t}),
                             f"should NOT flag: {t}")

    def test_analyst_pt_barred_from_lead_but_stays_in_pool(self):
        # A cluster whose top article is analyst-PT falls back to its best non-PT
        # member; the served lead is never an analyst-PT story.
        pt = art("UBS raises Micron stock price target on strong free cash flow outlook",
                 "Google News (UBS)", rel=10, hours_ago=1, companies=["Micron"])
        alt = art("Micron says memory chip supply will stay tight beyond 2027",
                  "Yahoo", rel=7, hours_ago=2, companies=["Micron"])
        macro = [art(f"Fed holds rates, signals hawkish path (v{i})", f"Src{i}",
                     rel=9, hours_ago=3) for i in range(6)]
        pool = [pt, alt] + macro
        res = ir.compute_lead(pool, NOW, mega_deal_urls=set())
        self.assertFalse(ir.is_analyst_rating_lead(res["article"]),
                         "lead must not be an analyst-PT story")
        # The barred story is still in the pool as an ordinary article.
        self.assertTrue(any(a is pt for a in pool))

    def test_cluster_of_only_analyst_pt_is_barred(self):
        pt = art("UBS raises Snap stock price target to $20", "UBS", rel=9,
                 hours_ago=1, companies=["Snap"])
        c = {"cluster_key": "co:snap:rating", "_articles": [pt]}
        self.assertTrue(ir._cluster_lead_barred(c, NOW))
        self.assertIsNone(ir._lead_representative(c, NOW))


if __name__ == "__main__":
    unittest.main()
