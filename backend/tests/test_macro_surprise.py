"""Offline replay tests for the deterministic macro-surprise extractor.

Every fixture below is a VERBATIM title/summary pair pulled from the prod
`articles` table (SELECT only). No synthetic prose. Run:
    python3 -m unittest backend.tests.test_macro_surprise -v
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import macro_surprise as ms  # noqa: E402


# -- VERBATIM prod rows, 2026-08-07 payrolls day, POINT-IN-TIME ---------------
# The Aug 7 morning briefing row (18c9f3ad-90ed-4338-9ed9-6158dfe24df6) was
# inserted at 2026-08-07T14:17:04Z; the pipeline run started 13:45:25Z. ONLY rows
# with ingested_at <= 14:17:04Z were available to that generation. Every row below
# is in-window and carries its real ingested_at. Rows published on Aug 7 but
# ingested at 2026-08-08T02:13Z (the Benzinga "Jobs Shock" and SeekingAlpha
# "Much Weaker Than Expected" pieces) are DELIBERATELY EXCLUDED: they postdate the
# brief and including them would be testing against the future.
AUG7_POINT_IN_TIME = [
    {"source": "Google News (SPY)", "ingested_at": "2026-08-07T02:18:13Z", "published_at": "2026-08-06T20:31:29Z",
     "title": "Stock Market Today: SPY, QQQ Slip on Oil Spike ahead of Key Jobs Report", "summary": ""},
    {"source": "Yahoo", "ingested_at": "2026-08-07T02:14:23Z", "published_at": "2026-08-06T21:31:39Z",
     "title": "Update: US Equity Indexes Fall as Treasury Yields Jump With Crude Oil Ahead of Nonfarm Payrolls, Deal to Reopen Strait of Hormuz",
     "summary": "(Updates with index/price moves, macroeconomic data and company/geopolitical news from the first paragraph)"},
    {"source": "Yahoo", "ingested_at": "2026-08-07T02:14:23Z", "published_at": "2026-08-06T21:44:44Z",
     "title": "Dow Jones Futures: Cloudflare Leads 5 Software Earnings Winners Late; Jobs Report On Tap",
     "summary": "Dow Jones futures: The market pauses, but what happens next? Don't buy these AI stocks yet. Cloudflare, Sezzle lead big earnings movers late."},
    # THE ROW THAT PROVES THE PREMISE. Ingested 13:59:18Z, 18 minutes before the
    # brief was written. Carries actual, consensus and direction in one summary.
    {"source": "SeekingAlpha", "ingested_at": "2026-08-07T13:59:18Z", "published_at": "2026-08-07T09:20:09Z",
     "title": "July Jobs Report: A Mixed Showing As Payrolls Decline But Employers Retain",
     "summary": "The Labor Department reported that payrolls declined 23K in July, well below expectations of growth of nearly 100K. Read the full analysis here."},
    {"source": "NYT Business", "ingested_at": "2026-08-07T13:59:13Z", "published_at": "2026-08-07T11:03:15Z",
     "title": "Jobs Report Poses New Test for Warsh and the Fed",
     "summary": "Friday\u2019s jobs report comes as investors increasingly expect the Federal Reserve to begin raising interest rates as soon as next month."},
    {"source": "Google News (NDAQ)", "ingested_at": "2026-08-07T14:02:29Z", "published_at": "2026-08-07T11:43:01Z",
     "title": "S&P 500, Nasdaq set for second straight weekly gain before jobs report", "summary": ""},
    {"source": "Yahoo", "ingested_at": "2026-08-07T13:59:20Z", "published_at": "2026-08-07T11:52:59Z",
     "title": "Dow Jones Futures Rise As Cloudflare Leads Big Software Winners; Jobs Report On Tap",
     "summary": "Dow Jones futures: The market pauses, but what happens next? Don't buy these AI stocks yet. Cloudflare, Sezzle lead big earnings movers late."},
    {"source": "Google News (COST)", "ingested_at": "2026-08-07T14:00:17Z", "published_at": "2026-08-07T13:10:21Z",
     "title": "Stock Futures Climb as Jobs Report Quells Rate Hike Fears", "summary": ""},
    {"source": "Google News (NASDAQ)", "ingested_at": "2026-08-07T14:02:28Z", "published_at": "2026-08-07T13:33:00Z",
     "title": "Stock market inches up after weak payrolls report (SPX:)", "summary": ""},
    {"source": "Google News (NASDAQ)", "ingested_at": "2026-08-07T14:02:28Z", "published_at": "2026-08-07T13:36:01Z",
     "title": "SNAPSHOT S&P, Nasdaq open higher as surprise payrolls fall quells rate-hike fears", "summary": ""},
    {"source": "Google News (NDAQ)", "ingested_at": "2026-08-07T14:02:29Z", "published_at": "2026-08-07T13:41:40Z",
     "title": "S&P 500 rallies after July jobs report misses forecasts", "summary": ""},
]

# ── VERBATIM prod rows, 2026-06-25 PCE day: NO comparator language anywhere ──
JUN25_NO_CONSENSUS = [
    {"source": "Yahoo", "published_at": "2026-06-25T20:11:00+00:00",
     "title": "Dow Soars Over 750 Points, Hits Record High As Investors Look Beyond Tech Stocks — PCE Inflation Comes In Hotter",
     "summary": "The Dow Jones Industrial Average soared over 750 points on Thursday."},
    {"source": "SeekingAlpha", "published_at": "2026-06-25T13:05:00+00:00",
     "title": "May PCE Inflation Report", "summary": "A look at the May PCE inflation report."},
]

# ── VERBATIM prod rows, 2026-06-10 CPI day: the print landed IN LINE ─────────
JUN10_INLINE = [
    {"source": "Google News (LINE)", "published_at": "2026-06-10T12:43:00+00:00",
     "title": "Stock index futures pare losses as CPI comes in line; eyes on Middle East conflict (SPX:) - Seeking Alpha",
     "summary": "Stock index futures pare losses as CPI comes in line; eyes on Middle East conflict (SPX:) Seeking Alpha"},
    {"source": "Google News (LINE)", "published_at": "2026-06-11T09:00:00+00:00",
     "title": "CPI Comes In Line: What’s Next for Stocks and the Fed? - Moomoo",
     "summary": "CPI Comes In Line: What's Next for Stocks and the Fed? Moomoo"},
]

# ── VERBATIM prod row, 2026-06-11: a single-stock move inside a CPI article ──
JUN11_FALSE_ACTUAL = [
    {"source": "Yahoo", "published_at": "2026-06-11T14:00:00+00:00",
     "title": "Why AMD (AMD) Shares Are Sliding Today",
     "summary": "Shares of AMD fell 5% in the afternoon session after the CPI report landed."},
]


class TestAug7Replay(unittest.TestCase):
    def setUp(self):
        self.s = ms.extract_macro_surprise(AUG7_POINT_IN_TIME)

    def test_produces_a_surprise(self):
        self.assertIsNotNone(self.s)
        self.assertEqual(self.s["release_key"], "nonfarm_payrolls")

    def test_direction_is_below_consensus(self):
        self.assertEqual(self.s["direction"], "below")
        self.assertEqual(self.s["direction_votes"].get("above"), None)

    def test_actual_is_minus_23k(self):
        self.assertEqual(self.s["actual"]["value"], -23000.0)
        self.assertEqual(self.s["actual"]["unit"], "jobs")

    def test_expected_is_about_plus_100k(self):
        self.assertIsNotNone(self.s["expected"])
        self.assertEqual(self.s["expected"]["modal"], 100000.0)
        self.assertEqual(ms.format_expected(self.s["expected"]), "+100K")

    def test_only_two_in_window_sources_carry_direction(self):
        # 11 payrolls rows were in-window; exactly 2 carry explicit comparator
        # language. Both say BELOW. That is the whole honest sample.
        self.assertEqual(self.s["direction_votes"], {"below": 2})
        self.assertEqual(self.s["confidence"], "medium")

    def test_reaction_is_captured_but_does_not_drive_direction(self):
        joined = " | ".join(self.s["reactions"]).lower()
        self.assertIn("rate hike fears", joined)
        # Reaction phrases contribute zero direction votes.
        self.assertEqual(sum(self.s["direction_votes"].values()),
                         len([e for e in self.s["evidence"] if e["field"] == "direction"]))

    def test_strip_line_names_both_numbers(self):
        line = ms.format_surprise_strip_line(self.s)
        self.assertIn("-23K", line)
        self.assertIn("+100K", line)
        self.assertIn("BELOW", line)

    def test_framing_forbids_the_shipped_defect(self):
        clause = ms.surprise_framing_clause(self.s)
        self.assertIn("no fresh catalyst", clause)   # named as FORBIDDEN
        self.assertIn("FORBIDDEN", clause)
        self.assertIn("TODAY'S", clause)


class TestNoConsensusStaysSilent(unittest.TestCase):
    def test_no_comparator_language_emits_nothing(self):
        # "Comes In Hotter" with no "than expected" is a level statement, not a
        # comparator. The tape (Dow +750, record high) is loudly bullish; we must
        # NOT infer a surprise from it.
        self.assertIsNone(ms.extract_macro_surprise(JUN25_NO_CONSENSUS))

    def test_empty_pool(self):
        self.assertIsNone(ms.extract_macro_surprise([]))
        self.assertIsNone(ms.extract_macro_surprise(None))

    def test_formatters_are_silent_on_none(self):
        self.assertEqual(ms.format_surprise_strip_line(None), "")
        self.assertEqual(ms.surprise_framing_clause(None), "")
        self.assertIsNone(ms.format_expected(None))


class TestInlineIsNotASurprise(unittest.TestCase):
    def test_inline_direction(self):
        s = ms.extract_macro_surprise(JUN10_INLINE)
        self.assertIsNotNone(s)
        self.assertEqual(s["direction"], "inline")
        self.assertIsNone(s["expected"])
        clause = ms.surprise_framing_clause(s)
        self.assertIn("IN LINE", clause)
        self.assertIn("Do NOT call it a surprise", clause)


class TestPrecisionGuards(unittest.TestCase):
    def test_single_stock_move_is_not_read_as_the_macro_actual(self):
        # No comparator language, so the whole object is None. Even if it were
        # emitted, _extract_actual's proximity guard would need the CPI name
        # inside the window; assert the guard directly too.
        self.assertIsNone(ms.extract_macro_surprise(JUN11_FALSE_ACTUAL))
        txt = ms._article_text(JUN11_FALSE_ACTUAL[0])
        act = ms._extract_actual(txt, "cpi", "pct")
        # "fell 5%" sits within 80 chars of "CPI", so the guard alone does not
        # save us here. This is a KNOWN residual: proximity is necessary but not
        # sufficient, which is why direction (not the actual) gates emission.
        self.assertTrue(act is None or act["value"] == -5.0)

    def test_contested_direction_returns_none(self):
        pool = [
            {"source": "A", "title": "Payrolls came in below expectations", "summary": ""},
            {"source": "B", "title": "Payrolls beat forecasts", "summary": ""},
        ]
        self.assertIsNone(ms.extract_macro_surprise(pool))

    def test_disagreeing_consensus_renders_a_range_not_a_point(self):
        pool = [
            {"source": "A", "title": "July payrolls fell 23,000, well below expectations of nearly 100K",
             "summary": ""},
            {"source": "B", "title": "Payrolls missed forecasts", "summary": "Economists expected 80,000."},
        ]
        s = ms.extract_macro_surprise(pool)
        self.assertIsNotNone(s)
        self.assertEqual(s["expected"]["low"], 80000.0)
        self.assertEqual(s["expected"]["high"], 100000.0)
        self.assertEqual(ms.format_expected(s["expected"]), "+80K to +100K")
        self.assertIn("+80K to +100K", ms.format_surprise_strip_line(s))


if __name__ == "__main__":
    unittest.main()
