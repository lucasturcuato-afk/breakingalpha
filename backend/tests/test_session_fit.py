"""Unit tests for backend/session_fit.py (deterministic session-fit detector).

Pure / offline: session_fit imports only stdlib, so no env and no network.

These pin the DETECTOR's behavior only. The full "the futures preview LOSES the
lead contest" outcome is proven at Agent U's INTEGRATION (impact_ranking /
synthesize). This module owns the detector, not the contest: the job here is
that the detector SCORES the 07-15 evening futures preview ~0 and confirmed
same-session stories high, without over-suppressing.

Run from repo root: python -m unittest backend.tests.test_session_fit
"""
import datetime as dt
import sys
import unittest
from pathlib import Path

_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

import session_fit as sf  # noqa: E402

# ~10:40pm ET on 2026-07-15 == 02:40 UTC 2026-07-16 (the real evening run time).
EVENING_NOW = dt.datetime(2026, 7, 16, 2, 40, tzinfo=dt.timezone.utc)
# ~06:00 ET on 2026-07-15 == 10:00 UTC (a representative morning run time).
MORNING_NOW = dt.datetime(2026, 7, 15, 10, 0, tzinfo=dt.timezone.utc)

# The ACTUAL 07-15 evening lead: a pre-market futures preview that wrongly led a
# post-close wrap because compute_lead had no session awareness.
JUL15_EVENING_FUTURES = {
    "title": ("Stock market today: Dow, S&P 500, Nasdaq futures extend gains "
              "ahead of earnings, wholesale inflation data"),
    "url": "https://news.google.com/rss/articles/CBMi6g...",
    "source": "Google News (NASDAQ)",
    "published_at": "2026-07-15 09:18:13+00",  # 05:18 ET, pre-market
    "ingested_at": "2026-07-16 02:26:33.494818+00",
    "deal_type": "Macro & Policy",
}


class EveningFuturesPreview(unittest.TestCase):
    def test_jul15_futures_preview_scores_near_zero(self):
        score = sf.session_fit_score(JUL15_EVENING_FUTURES, "evening", EVENING_NOW)
        self.assertLessEqual(
            score, 0.1,
            f"07-15 evening futures preview must score ~0, got {score}")
        self.assertEqual(score, sf.PREVIEW_ON_EVENING)

    def test_ahead_of_without_premarket_ts_still_demoted(self):
        # Two preview tells ("futures", "ahead of") near-veto regardless of ts.
        c = {"title": "Nasdaq futures rise ahead of jobs data",
             "published_at": "2026-07-15 20:00:00+00"}
        self.assertLessEqual(sf.session_fit_score(c, "evening", EVENING_NOW), 0.1)

    def test_single_soft_preview_no_premarket_not_floored(self):
        # A lone "preview" token, intraday timestamp: demoted, not at the floor.
        c = {"title": "Earnings preview: what analysts expect",
             "published_at": "2026-07-15 18:00:00+00"}
        s = sf.session_fit_score(c, "evening", EVENING_NOW)
        self.assertGreater(s, sf.PREVIEW_ON_EVENING)
        self.assertLess(s, sf.NEUTRAL)


class EveningSameSessionConfirmed(unittest.TestCase):
    CONFIRMED = [
        {"title": "Home Bancshares (NYSE:HOMB) Exceeds Q2 CY2026 Expectations",
         "published_at": "2026-07-15 21:59:49+00"},
        {"title": "AEHR Stock Skyrockets After Q2 Earnings Beat-and-Raise",
         "published_at": "2026-07-15 21:41:13+00"},
        {"title": "Home BancShares reports Q2 earnings, completes acquisition",
         "published_at": "2026-07-15 22:09:27+00"},
        {"title": "Data Center Firm Csquare Is Said to Price IPO at $21 Per Share",
         "published_at": "2026-07-15 22:47:04+00"},
    ]

    def test_confirmed_same_session_scores_high(self):
        for c in self.CONFIRMED:
            s = sf.session_fit_score(c, "evening", EVENING_NOW)
            self.assertGreaterEqual(
                s, 0.8, f"same-session confirmed should score high: {c['title']}")

    def test_confirmed_beats_preview(self):
        # The detector must separate the two by a wide margin (contest is U's).
        preview = sf.session_fit_score(JUL15_EVENING_FUTURES, "evening", EVENING_NOW)
        confirmed = sf.session_fit_score(self.CONFIRMED[0], "evening", EVENING_NOW)
        self.assertGreater(confirmed - preview, 0.5)

    def test_forward_framed_evening_story_demoted(self):
        # "seen hitting" is a forward preview even at night; demote it.
        c = {"title": "TSMC's second-quarter profit seen hitting record on AI boom",
             "published_at": "2026-07-15 23:03:05+00"}
        self.assertLess(sf.session_fit_score(c, "evening", EVENING_NOW), sf.NEUTRAL)


class MorningFraming(unittest.TestCase):
    def test_opening_framing_high(self):
        c = {"title": "Stocks open higher at the opening bell as futures point to gains",
             "published_at": "2026-07-15 09:35:00+00"}
        self.assertGreaterEqual(
            sf.session_fit_score(c, "morning", MORNING_NOW), 0.85)

    def test_week_old_preview_low(self):
        c = {"title": "Nvidia futures point higher ahead of earnings",
             "published_at": "2026-07-08 09:00:00+00"}
        self.assertLessEqual(
            sf.session_fit_score(c, "morning", MORNING_NOW), 0.3)

    def test_near_term_preview_ok_on_morning(self):
        # A fresh pre-market preview is legitimately on-session for a morning
        # brief (unlike the evening wrap), so it is NOT floored.
        c = {"title": "Nasdaq futures point higher ahead of the open",
             "published_at": "2026-07-15 09:00:00+00"}
        s = sf.session_fit_score(c, "morning", MORNING_NOW)
        self.assertGreater(s, 0.5)

    def test_same_session_confirmed_high(self):
        c = {"title": "Home Bancshares beats Q2 expectations",
             "published_at": "2026-07-15 04:00:00+00"}
        self.assertGreaterEqual(
            sf.session_fit_score(c, "morning", MORNING_NOW), 0.7)


class DefensiveInput(unittest.TestCase):
    def test_never_raises_on_bad_input(self):
        for bad in (None, {}, {"title": None}, {"published_at": "not-a-date"},
                    [], "string", 42):
            # Must return a float in [0,1] and not raise.
            s = sf.session_fit_score(bad, "evening", EVENING_NOW)
            self.assertIsInstance(s, float)
            self.assertGreaterEqual(s, 0.0)
            self.assertLessEqual(s, 1.0)

    def test_unknown_brief_type_neutral(self):
        self.assertEqual(
            sf.session_fit_score(JUL15_EVENING_FUTURES, "weekly", EVENING_NOW),
            sf.NEUTRAL)

    def test_bad_now_does_not_raise(self):
        s = sf.session_fit_score(JUL15_EVENING_FUTURES, "evening", "not-a-time")
        self.assertIsInstance(s, float)

    def test_missing_timestamp_uses_framing_only(self):
        c = {"title": "Company beats Q2 earnings"}  # no timestamp
        s = sf.session_fit_score(c, "evening", EVENING_NOW)
        self.assertGreaterEqual(s, 0.8)


if __name__ == "__main__":
    unittest.main()
