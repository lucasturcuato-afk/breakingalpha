"""Unit tests for the PR1 tape-aware materiality re-rank in backend/impact_ranking.py.

Pure / offline: impact_ranking imports only stdlib (+ event_calendar); the
materiality path takes the tape and any per-name session moves as ARGUMENTS and
makes no network call. No env, no secrets.

Run from repo root: python -m unittest backend.tests.test_materiality_ranking
"""
import datetime as dt
import sys
import unittest
from pathlib import Path

_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

import impact_ranking as ir  # noqa: E402

NOW = dt.datetime(2026, 6, 30, 22, 30, tzinfo=dt.timezone.utc)


def art(title, source, rel=8, hrs=3, companies=None, url=None, summary="", deal_type=None):
    ts = (NOW - dt.timedelta(hours=hrs)).isoformat()
    return {
        "title": title, "summary": summary, "source": source,
        "relevance_score": rel, "companies": companies or [],
        "url": url or f"http://x/{abs(hash(title)) % 99999}",
        "published_at": ts, "ingested_at": ts, "deal_type": deal_type,
    }


# 06-30 evening: narrow tech-led risk-on rally (S&P +1.18, Nasdaq +2.07, VIX -4.13%).
TAPE_0630_EVENING = {
    "quotes": {
        "^GSPC": {"pct": 1.18, "price": 6200}, "^IXIC": {"pct": 2.07, "price": 20000},
        "^DJI": {"pct": 0.59, "price": 40000}, "^RUT": {"pct": 0.01, "price": 2200},
        "^VIX": {"pct": -4.13, "price": 17.65},
    },
    "regime": "risk-on", "vix_level": 17.65,
}


def rocket_lab_evening_pool():
    """Frozen candidate pool for the ratified 06-30 evening keystone: the $8B
    Rocket Lab/Iridium deal (the brief's actual lead) against the day's genuine
    market-wide + sector clusters from the CSV's press_cause_urls."""
    return [
        art("Rocket Lab Acquires Iridium for $8 Billion to Challenge SpaceX's Starlink",
            "Reuters", rel=9, companies=["Rocket Lab"], deal_type="m&a", url="u_rklb1"),
        art("Rocket Lab, Iridium ink $8B cash-and-stock takeover",
            "Bloomberg", rel=9, companies=["Rocket Lab"], deal_type="m&a", url="u_rklb2"),
        art("Stocks Rally to Start a Big Holiday Week as Nasdaq climbs",
            "Yahoo", rel=8, url="u_rally1"),
        art("Wall Street rallies, Nasdaq leads broad market gains",
            "MarketWatch", rel=8, url="u_rally2"),
        art("SK chipmakers commit over $550B to ease 'RAMageddon' memory shortage",
            "TechCrunch", rel=8, companies=["SK Hynix"], url="u_ram1"),
        art("Super Micro slides 8% on Taiwan chip-smuggling raid",
            "FT", rel=8, companies=["Super Micro"], url="u_smci1"),
    ]


class KeystoneTests(unittest.TestCase):
    """The discriminating assertion: on the ratified 06-30 evening tape the new
    ranker does NOT lead with the single Rocket Lab deal (matches NOAH mode A)."""

    def test_base_ranker_leads_rocket_lab(self):
        # Sanity: the tape-BLIND base ranker picks the mega-deal (the live failure).
        base = ir.compute_lead(rocket_lab_evening_pool(), NOW,
                               mega_deal_urls={"u_rklb1", "u_rklb2"})
        self.assertIn("rocket lab", base["article"]["title"].lower())

    def test_materiality_does_not_lead_rocket_lab(self):
        mat = ir.compute_materiality_lead(
            rocket_lab_evening_pool(), NOW,
            tape=TAPE_0630_EVENING,
            name_session_pct={"Super Micro": -8.0},
            mega_deal_urls={"u_rklb1", "u_rklb2"},
        )
        self.assertNotIn("rocket lab", mat["article"]["title"].lower(),
                         "KEYSTONE: new ranker must not lead with the single Rocket Lab deal")
        self.assertTrue(mat["diverged_from_base"])
        # The Rocket Lab cluster took the deal-not-driver demotion.
        self.assertEqual(mat["base_cluster_key"], "co:rocket lab:ma")

    def test_materiality_leads_market_wide(self):
        mat = ir.compute_materiality_lead(
            rocket_lab_evening_pool(), NOW,
            tape=TAPE_0630_EVENING,
            name_session_pct={"Super Micro": -8.0},
            mega_deal_urls={"u_rklb1", "u_rklb2"},
        )
        # The winner is a market-wide read (matches ratified mode A).
        self.assertTrue(ir._is_market_wide_cluster(
            mat["cluster_key"], mat["article"]["title"].lower()))


class UsIrrelevanceTests(unittest.TestCase):
    def test_foreign_rupee_deal_demoted(self):
        pool = [
            art("GIC to sell rupee-denominated stake in Genus Power for Rs 4,000 crore",
                "Reuters", rel=9, companies=["Genus Power"], deal_type="stake sale",
                url="g1", summary="India's Genus, GIC Singapore rupee"),
            art("GIC offloads Genus Power stake in India block deal",
                "Bloomberg", rel=9, companies=["Genus Power"], deal_type="stake sale",
                url="g2", summary="rupee crore India"),
            art("Stocks drop ahead of payrolls, Wall Street risk-off",
                "Yahoo", rel=8, url="r1"),
        ]
        tape = {
            "quotes": {"^GSPC": {"pct": -1.2}, "^IXIC": {"pct": -1.5},
                       "^DJI": {"pct": -0.9}, "^RUT": {"pct": -1.1},
                       "^VIX": {"pct": 9.0, "price": 21}},
            "regime": "risk-off", "vix_level": 21,
        }
        mat = ir.compute_materiality_lead(pool, NOW, tape=tape,
                                          mega_deal_urls={"g1", "g2"})
        self.assertNotIn("genus", mat["article"]["title"].lower())
        # The GIC/Genus cluster carries both the US-irrelevance and deal penalties.
        genus = [c for c in mat["top_clusters"] if c["cluster_key"].startswith("co:genus")]
        self.assertTrue(genus and all(c["materiality_delta"] < 0 for c in genus))


class FailSafeTests(unittest.TestCase):
    """Shadow-first safety. NO tape at all (weekend / fetch failure) is a strict
    no-op. A present tape applies penalties at any magnitude (that is what makes the
    immaterial 07-01 GIC/Genus case resolve) but leaves an ordinary pool untouched."""

    MILD = {
        "quotes": {"^GSPC": {"pct": 0.2}, "^IXIC": {"pct": 0.3},
                   "^DJI": {"pct": 0.1}, "^RUT": {"pct": 0.1},
                   "^VIX": {"pct": -1.0, "price": 16}},
        "regime": "neutral", "vix_level": 16,
    }

    def test_no_tape_is_noop(self):
        base = ir.compute_lead(rocket_lab_evening_pool(), NOW,
                               mega_deal_urls={"u_rklb1", "u_rklb2"})
        mat = ir.compute_materiality_lead(rocket_lab_evening_pool(), NOW, tape=None,
                                          mega_deal_urls={"u_rklb1", "u_rklb2"})
        self.assertEqual(base["cluster_key"], mat["cluster_key"])

    def test_ordinary_pool_mild_tape_unchanged(self):
        # No foreign deal, no narrow pure-deal, no market-wide leader -> no penalty
        # fires -> a mild present tape does not reshuffle the order.
        pool = [
            art("Nvidia unveils Blackwell Ultra at GTC", "Reuters", rel=9,
                companies=["Nvidia"], url="n1"),
            art("Nvidia GTC keynote: new datacenter roadmap", "CNBC", rel=8,
                companies=["Nvidia"], url="n2"),
            art("Boeing wins new widebody order from United", "WSJ", rel=7,
                companies=["Boeing"], url="b1"),
        ]
        base = ir.compute_lead(pool, NOW)
        mat = ir.compute_materiality_lead(pool, NOW, tape=self.MILD)
        self.assertEqual(base["cluster_key"], mat["cluster_key"])
        self.assertFalse(mat["diverged_from_base"])

    def test_mild_present_tape_penalizes_narrow_deal(self):
        # Tiered design: a narrow single-name pure deal takes the deal-not-driver
        # penalty even on an immaterial (present) tape. The penalty alone may not
        # dethrone it here (no material tape -> no market-wide BONUS to lift a
        # competitor), but the demotion is what lets a tier-1 / broadly-covered
        # market-wide story win on a real quiet day (e.g. 07-01's ADP print).
        mat = ir.compute_materiality_lead(rocket_lab_evening_pool(), NOW, tape=self.MILD,
                                          mega_deal_urls={"u_rklb1", "u_rklb2"})
        rk = [c for c in mat["top_clusters"] if c["cluster_key"] == "co:rocket lab:ma"]
        self.assertTrue(rk and rk[0]["materiality_delta"] < 0,
                        "narrow pure deal should be penalized even on a mild present tape")


class ContinuityTests(unittest.TestCase):
    def _pool(self):
        return [
            art("Rocket Lab Acquires Iridium for $8 Billion", "Reuters", rel=9,
                companies=["Rocket Lab"], deal_type="m&a", url="rk1"),
            art("Rocket Lab/Iridium $8B takeover confirmed", "Bloomberg", rel=9,
                companies=["Rocket Lab"], deal_type="m&a", url="rk2"),
            art("Nvidia unveils new Blackwell chip at GTC", "Reuters", rel=8,
                companies=["Nvidia"], url="nv1"),
        ]

    def test_no_prior_lead_leads_rocket_lab(self):
        res = ir.compute_materiality_lead(self._pool(), NOW, tape=None,
                                          mega_deal_urls={"rk1", "rk2"})
        self.assertIn("rocket lab", res["article"]["title"].lower())

    def test_prior_lead_rocket_lab_is_decayed(self):
        res = ir.compute_materiality_lead(
            self._pool(), NOW, tape=None, mega_deal_urls={"rk1", "rk2"},
            prior_lead_title="Rocket Lab Acquires Iridium for $8 Billion to Challenge Starlink",
        )
        self.assertNotIn("rocket lab", res["article"]["title"].lower())
        # The Rocket Lab cluster shows a continuity decay in the breakdown.
        rk = [c for c in res["top_clusters"] if c["cluster_key"].startswith("co:rocket")]
        self.assertTrue(rk and all(c["continuity_delta"] < 0 for c in rk))


class TapeHelperTests(unittest.TestCase):
    def test_tape_pcts_live_and_snapshot(self):
        live = ir.tape_pcts(TAPE_0630_EVENING)
        self.assertAlmostEqual(live["spx"], 1.18)
        self.assertAlmostEqual(live["nasdaq"], 2.07)
        snap = ir.tape_pcts({"indices": {"sp500": {"pct": -0.9}, "nasdaq": {"pct": -1.2}},
                             "vix_pct": 7.5})
        self.assertAlmostEqual(snap["spx"], -0.9)
        self.assertAlmostEqual(snap["vix"], 7.5)

    def test_material_and_broad(self):
        self.assertTrue(ir.tape_is_material(TAPE_0630_EVENING))
        self.assertTrue(ir.tape_is_broad(TAPE_0630_EVENING))
        self.assertFalse(ir.tape_is_material(
            {"quotes": {"^GSPC": {"pct": 0.2}, "^VIX": {"pct": -1.0}}}))


class NameMovesActivateDriverTierTests(unittest.TestCase):
    """Regression for the shadow call-site fix (synthesize threads name_session_pct):
    the per-name driver tier (4, tape-driver-direction-consistent) can ONLY fire
    when per-name session moves are supplied. The pre-fix call site omitted
    name_session_pct, so this tier was structurally dead -> empty reasons + degraded
    passthrough. This pins the mechanism the fix restores."""

    TAPE_UP = {
        "quotes": {"^GSPC": {"pct": 1.2, "price": 6200}, "^VIX": {"pct": -4.0, "price": 16}},
        "regime": "risk-on", "vix_level": 16,
    }

    def _nvidia_cluster(self):
        pool = [
            art("Nvidia jumps as AI demand accelerates", "Reuters", rel=9, companies=["Nvidia"], url="u_nv1"),
            art("Nvidia rallies on data-center strength", "Bloomberg", rel=9, companies=["Nvidia"], url="u_nv2"),
            art("Nvidia shares climb to a record", "CNBC", rel=9, companies=["Nvidia"], url="u_nv3"),
        ]
        scored = ir.score_clusters(pool, NOW)
        return next(c for c in scored if c["cluster_key"].startswith("co:nvidia"))

    def test_driver_tier_fires_with_name_moves(self):
        c = self._nvidia_cluster()
        d = ir.materiality_delta(
            c, tape=self.TAPE_UP,
            driver_names=ir._driver_names_from_moves({"Nvidia": 6.0}),
            name_session_pct={"Nvidia": 6.0},
        )
        self.assertTrue(any("tape driver" in r for r in d["reasons"]),
                        f"driver tier must fire when name moves are supplied; reasons={d['reasons']}")
        self.assertGreater(d["delta"], 0)

    def test_driver_tier_silent_without_name_moves(self):
        # The exact pre-fix bug: no name moves -> empty driver set -> tier (4) dead.
        c = self._nvidia_cluster()
        d = ir.materiality_delta(
            c, tape=self.TAPE_UP,
            driver_names=ir._driver_names_from_moves(None),
            name_session_pct=None,
        )
        self.assertFalse(any("tape driver" in r for r in d["reasons"]),
                         f"without name moves the driver tier must stay silent; reasons={d['reasons']}")


if __name__ == "__main__":
    unittest.main()
