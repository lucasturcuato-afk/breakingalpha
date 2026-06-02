"""
Unit tests for the media-outlet blocklist in backend/ingest.py:
  - is_blocked_entity() strips media outlets / aggregators (Yahoo Finance,
    Seeking Alpha, Stock Titan, ...) by NORMALIZED EXACT name.
  - real companies are kept, including ones whose name merely CONTAINS a
    blocklisted token (exact-match guard, never substring).
  - the strip happens at the _clean_companies finalization step that feeds
    store_articles_batch / company_mentions -- post-extraction, deterministic,
    no Gemini.

NO production DB / Wikidata / Gemini calls (is_blocked_entity is pure; the
_clean_companies test patches the Wikidata validator to True).

Run from the repo root:
    python -m unittest backend.tests.test_outlet_blocklist
"""
import os
import sys
import unittest
from unittest.mock import patch

os.environ.setdefault("GEMINI_API_KEY", "dummy-key-not-used")
os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_ANON_KEY", "dummy-anon-not-used")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import ingest  # noqa: E402


class OutletBlocklistTest(unittest.TestCase):

    # --- direct: outlets blocked, with normalization variants ---------------
    def test_outlets_blocked_with_variants(self):
        for outlet in [
            "Yahoo Finance", "yahoo finance", "Yahoo! Finance", "Yahoo",
            "Seeking Alpha", "TradingView", "Stock Titan", "The Motley Fool",
            "GuruFocus", "Quiver Quantitative", "MarketBeat", "24/7 Wall St.",
            "Benzinga", "Statista", "Insider Monkey", "Stock Traders Daily",
            "Investing.com", "Business Wire", "PR Newswire", "GlobeNewswire",
            "Simply Wall St", "SimplyWall.st", "Trefis", "Moomoo",
        ]:
            self.assertTrue(ingest.is_blocked_entity(outlet),
                            f"outlet not blocked: {outlet!r}")

    # --- real companies kept, including token-containing names --------------
    def test_real_companies_kept(self):
        for company in [
            "Apple", "Microsoft", "Nvidia", "Goldman Sachs", "Blackstone",
            "Yahoo Inc",                 # contains 'Yahoo' but not == 'yahoo'
            "Trading View Holdings",      # contains 'trading view' but != 'tradingview'
            "Benzinga Capital Partners",  # contains 'benzinga' but not == 'benzinga'
            "Fool Industries",            # contains 'fool' but not a blocklist entry
            "Wall Street Bancorp",        # not '24/7 wall st'
        ]:
            self.assertFalse(ingest.is_blocked_entity(company),
                             f"real company wrongly blocked: {company!r}")

    # --- exact-match never strips on substring ------------------------------
    def test_no_substring_stripping(self):
        # 'yahoo' is a blocklist entry; 'yahoo japan corporation' must survive.
        self.assertFalse(ingest.is_blocked_entity("Yahoo Japan Corporation"))
        self.assertFalse(ingest.is_blocked_entity("Statista Research GmbH"))

    # --- normalization helper -----------------------------------------------
    def test_normalize_outlet(self):
        self.assertEqual(ingest._normalize_outlet("Yahoo! Finance"), "yahoo finance")
        self.assertEqual(ingest._normalize_outlet("24/7 Wall St."), "247 wall st")
        self.assertEqual(ingest._normalize_outlet("Investing.com"), "investingcom")

    # --- preexisting blocklist categories still work ------------------------
    def test_existing_categories_unbroken(self):
        self.assertTrue(ingest.is_blocked_entity("Bitcoin"))     # currency
        self.assertTrue(ingest.is_blocked_entity("China"))       # country
        self.assertTrue(ingest.is_blocked_entity("FDA"))         # gov acronym
        self.assertTrue(ingest.is_blocked_entity("Smith & Associates"))  # law

    # --- end to end through the finalization step ---------------------------
    def test_clean_companies_strips_outlets_keeps_real(self):
        analysis = {
            "companies": [
                {"name": "Nvidia", "entity_type": "company"},
                {"name": "Yahoo Finance", "entity_type": "company"},
                {"name": "Marvell", "entity_type": "company"},
                {"name": "Seeking Alpha", "entity_type": "company"},
                {"name": "Stock Titan", "entity_type": "company"},
                {"name": "Yahoo Inc", "entity_type": "company"},
            ],
        }
        # Patch the Wikidata validator so the test stays offline and isolates
        # the blocklist behaviour (real ones pass validation).
        with patch.object(ingest, "_resolve_company_valid", lambda name: True):
            out = ingest._clean_companies(analysis)
        self.assertIn("Nvidia", out)
        self.assertIn("Marvell", out)
        self.assertIn("Yahoo Inc", out)        # token-containing real co kept
        self.assertNotIn("Yahoo Finance", out)
        self.assertNotIn("Seeking Alpha", out)
        self.assertNotIn("Stock Titan", out)
        self.assertEqual(len(out), 3)


if __name__ == "__main__":
    unittest.main()
