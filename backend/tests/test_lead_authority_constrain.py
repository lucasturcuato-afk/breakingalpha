"""Agent CONSTRAIN - O2/O3 candidate lanes + LLM-picks-from-shortlist authority.

Offline, stdlib unittest (this repo has no pytest runner for logic tests). Pure:
no network, no supabase. Proves:
  O2  article-side mega lane: a confirmed >= $1B deal with NO deal_flow row still
      enters as a mega candidate.
  O3  company-join mega lane: a confirmed $1B+ closed deal_flow row whose Google-RSS
      source_url does not string-match the article url is recovered by entity name.
  Authority: build_lead_shortlist removes barred classes, GUARANTEES the mega is
      present, names the deterministic winner; match_pick_to_shortlist validates an
      LLM pick (in-set / out-of-set); G3 all-barred keeps a best-barred fallback.
Guardrail: the existing L1 analyst-PT / L2 rumor bars are unchanged (asserted).
"""
import datetime
import unittest

import impact_ranking as ir

NOW = datetime.datetime(2026, 7, 27, 13, 0, tzinfo=datetime.timezone.utc)


def _art(title, **kw):
    d = {
        "title": title,
        "summary": kw.get("summary", ""),
        "url": kw.get("url", "https://ex.com/" + title[:20].replace(" ", "-")),
        "source": kw.get("source", "Reuters"),
        "companies": kw.get("companies", []),
        "deal_type": kw.get("deal_type", ""),
        "relevance_score": kw.get("relevance_score", 8),
        "published_at": kw.get("published_at", "2026-07-27T11:00:00+00:00"),
        "ingested_at": kw.get("ingested_at", "2026-07-27T11:30:00+00:00"),
    }
    return d


class ArticleSideMegaLane(unittest.TestCase):
    """O2: confirmed >= $1B deal with NO deal_flow row is still a mega candidate."""

    def test_confirmed_takeover_title_no_dealflow_is_mega(self):
        # Arlington-shaped: "agrees ... GBP/$ 1.45bn takeover", no deal_flow row.
        pool = [_art("Arlington agrees $1.45bn takeover of Rival Corp",
                     companies=["Arlington"], deal_type="M&A")]
        scored = ir.score_clusters(pool, NOW, mega_deal_urls=set())
        self.assertTrue(scored[0]["is_mega_deal"],
                        "article-side confirmed $1B+ takeover must be mega with no deal_flow row")

    def test_seller_verb_divest_closes_gap(self):
        # #505 seller-verb gap: exits/sells/divests must count as confirmed action.
        pool = [_art("HSBC to Divest Singapore Insurance Unit to Allianz for $2.09B",
                     companies=["HSBC"], deal_type="M&A")]
        scored = ir.score_clusters(pool, NOW, mega_deal_urls=set())
        self.assertTrue(scored[0]["is_mega_deal"])

    def test_rumor_with_value_is_not_mega(self):
        # A rumored/"in talks" $30B is NOT confirmed -> not mega (Cognition defense).
        pool = [_art("Rival reportedly in talks for potential $30B takeover",
                     companies=["Rival"], deal_type="M&A")]
        scored = ir.score_clusters(pool, NOW, mega_deal_urls=set())
        self.assertFalse(scored[0]["is_mega_deal"])

    def test_thirteen_f_stake_without_value_is_not_mega(self):
        # BlackRock 13G/A class: a stake disclosure with no explicit $Bn value.
        pool = [_art("BlackRock discloses 17.3% Enphase Energy ownership in 13G/A",
                     companies=["BlackRock", "Enphase"], deal_type="Other")]
        scored = ir.score_clusters(pool, NOW, mega_deal_urls=set())
        self.assertFalse(scored[0]["is_mega_deal"])

    def test_kill_switch_restores_prod(self):
        pool = [_art("Arlington agrees $1.45bn takeover of Rival Corp",
                     companies=["Arlington"], deal_type="M&A")]
        ir.ARTICLE_SIDE_MEGA_LANE = False
        try:
            scored = ir.score_clusters(pool, NOW, mega_deal_urls=set())
            self.assertFalse(scored[0]["is_mega_deal"])
        finally:
            ir.ARTICLE_SIDE_MEGA_LANE = True


class CompanyJoinMegaLane(unittest.TestCase):
    """O3: confirmed $1B+ deal_flow row joins by entity name when the url fails."""

    def test_rss_url_mismatch_recovered_by_company(self):
        # The Uber/Delivery Hero shape: closed $14.8B deal_flow row, Google-RSS
        # source_url that does not match the article url; article title omits value.
        deal_rows = [{
            "company": "Delivery Hero", "acquirer": "Uber Technologies",
            "deal_type": "M&A", "stage": "closed", "valuation": "$14.8B",
            "source_url": "https://news.google.com/rss/articles/OPAQUE-RSS-ID",
        }]
        pool = [_art("Uber to Acquire Delivery Hero in Major Takeover",
                     url="https://sfgate.com/uber-delivery-hero",
                     companies=["Uber", "Delivery Hero"], deal_type="M&A")]
        urls = ir.confirmed_mega_deal_urls(deal_rows, pool)
        self.assertIn("https://sfgate.com/uber-delivery-hero", urls,
                      "company-join must recover a confirmed $1B+ deal when the url mismatches")

    def test_exact_url_still_works(self):
        deal_rows = [{
            "company": "Tegna", "acquirer": "Nexstar", "deal_type": "M&A",
            "stage": "closed", "valuation": "$6.2B",
            "source_url": "https://deadline.com/tegna",
        }]
        pool = [_art("Nexstar to buy Tegna in $6.2B deal",
                     url="https://deadline.com/tegna", companies=["Tegna"], deal_type="M&A")]
        self.assertIn("https://deadline.com/tegna", ir.confirmed_mega_deal_urls(deal_rows, pool))

    def test_company_join_does_not_promote_unrelated_story(self):
        # Same company, but the pool article is an analyst note, not a deal.
        deal_rows = [{
            "company": "Uber Technologies", "acquirer": "Uber Technologies",
            "deal_type": "M&A", "stage": "closed", "valuation": "$14.8B",
            "source_url": "https://news.google.com/rss/OPAQUE",
        }]
        pool = [_art("Uber stock upgraded to Buy at Morgan Stanley",
                     url="https://x.com/uber-upgrade", companies=["Uber"], deal_type="")]
        self.assertNotIn("https://x.com/uber-upgrade",
                         ir.confirmed_mega_deal_urls(deal_rows, pool))

    def test_subthreshold_dealflow_not_mega(self):
        # 13F noise: closed but sub-$1B (Renaissance/SoFi style) -> excluded.
        deal_rows = [{
            "company": "SoFi Technologies", "acquirer": "Renaissance Technologies",
            "deal_type": "M&A", "stage": "closed", "valuation": "$36.80M",
            "source_url": "https://news.google.com/rss/OPAQUE2",
        }]
        pool = [_art("SoFi shares acquired by Renaissance Technologies",
                     url="https://x.com/sofi", companies=["SoFi"], deal_type="M&A")]
        self.assertEqual(ir.confirmed_mega_deal_urls(deal_rows, pool), set())


class Shortlist(unittest.TestCase):
    """Authority: eligibility-filtered, scored shortlist with mega guaranteed."""

    def _pool(self):
        return [
            _art("Mega Corp agrees $9.8bn takeover of Target Inc",
                 companies=["Mega Corp"], deal_type="M&A", relevance_score=9),
            _art("UBS Raises Micron Price Target on Robust Free Cash Flow",
                 companies=["Micron"], deal_type="", relevance_score=9),
            _art("Booz Allen To Report Earnings Tomorrow: Here Is What To Expect",
                 companies=["Booz Allen"], deal_type="", relevance_score=8),
            _art("Broad market rallies as stocks climb on soft CPI",
                 companies=[], deal_type="Macro", relevance_score=9),
        ]

    def test_mega_present_and_barred_removed(self):
        sl = ir.build_lead_shortlist(self._pool(), NOW, mega_deal_urls=set())
        self.assertIsNotNone(sl)
        self.assertTrue(sl["mega_in_shortlist"])
        titles = " || ".join(str(r["title"]) for r in sl["shortlist"])
        self.assertIn("Mega Corp agrees $9.8bn", titles)
        # L1 analyst-PT title must not appear as a shortlist candidate.
        self.assertNotIn("UBS Raises Micron Price Target", titles)
        self.assertEqual(sl["candidate_gen_regime"], ir.CANDIDATE_GEN_REGIME)

    def test_match_in_set(self):
        sl = ir.build_lead_shortlist(self._pool(), NOW, mega_deal_urls=set())
        pid = sl["shortlist"][0]["pick_id"]
        self.assertIsNotNone(ir.match_pick_to_shortlist(pid, sl))

    def test_match_by_title_prefix(self):
        sl = ir.build_lead_shortlist(self._pool(), NOW, mega_deal_urls=set())
        # LLM echoes the full headline rather than the truncated id.
        self.assertIsNotNone(
            ir.match_pick_to_shortlist("Mega Corp agrees $9.8bn takeover of Target Inc", sl))

    def test_out_of_set_returns_none(self):
        sl = ir.build_lead_shortlist(self._pool(), NOW, mega_deal_urls=set())
        self.assertIsNone(ir.match_pick_to_shortlist("Some invented headline not in list", sl))

    def test_directive_lists_mega_tag(self):
        sl = ir.build_lead_shortlist(self._pool(), NOW, mega_deal_urls=set())
        d = ir.build_shortlist_directive(sl)
        self.assertIn("LEAD SHORTLIST", d)
        self.assertIn("CONFIRMED $1B+ DEAL", d)


class G3AllBarredFallback(unittest.TestCase):
    """G3: when every candidate is barred, a best-barred fallback still ships."""

    def test_all_analyst_pt_keeps_best_barred(self):
        pool = [
            _art("UBS Raises Micron Price Target to $200", companies=["Micron"]),
            _art("Morgan Stanley downgrades Tesla to Underweight", companies=["Tesla"]),
        ]
        sl = ir.build_lead_shortlist(pool, NOW, mega_deal_urls=set())
        self.assertTrue(sl["all_barred"])
        self.assertEqual(len(sl["shortlist"]), 1)
        self.assertTrue(sl["shortlist"][0]["lead_barred"])


class GuardrailsUnchanged(unittest.TestCase):
    """The L1/L2 detectors must be byte-unchanged by the new lanes."""

    def test_analyst_bar_still_fires(self):
        self.assertTrue(ir.is_analyst_rating_lead(
            {"title": "UBS Raises Micron Price Target on Robust Free Cash Flow"}))

    def test_rumor_bar_still_fires(self):
        self.assertTrue(ir.is_rumor_or_preview_lead(
            {"title": "Micron Explores Strategic Deal to Stabilize Revenue"}))

    def test_confirmed_not_flagged_rumor(self):
        self.assertFalse(ir.is_rumor_or_preview_lead(
            {"title": "Mega Corp agrees $9.8bn takeover of Target Inc"}))


if __name__ == "__main__":
    unittest.main()
