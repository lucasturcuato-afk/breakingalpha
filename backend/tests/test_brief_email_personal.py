"""
The per-recipient "Your names" block.

Two properties matter more than the rendering:

  1. It is a PROJECTION. personal_block() takes no client, so "no per-user
     model call" is enforced by the type signature, not by a promise. The
     end-to-end test also counts queries across a multi-recipient run and
     asserts the count does not grow with recipients.
  2. An empty reader gets NO SECTION. Only 13 user_claims exist product-wide,
     so the claims half renders for almost nobody. A rendered empty state would
     read as a broken email.

Run: python -m unittest backend.tests.test_brief_email_personal -v
"""

from __future__ import annotations

import os
import sys
import unittest
from datetime import datetime, timedelta, timezone

_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.dirname(_HERE)
_REPO = os.path.dirname(_BACKEND)
for _p in (_BACKEND, _REPO):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from brief_email_personal import (  # noqa: E402
    MAX_PER_LIST,
    PersonalContext,
    bucket_by,
    personal_block,
    story_matches_watch,
)
from brief_email_render import PersonalBlock, render_email  # noqa: E402
from brief_email_send import maybe_send_brief_email  # noqa: E402
from backend.tests.test_brief_email import (  # noqa: E402
    BASE_ENV,
    RecordingSender,
    _payload,
    make_client,
)

NOW = datetime(2026, 8, 10, 12, 0, tzinfo=timezone.utc)
USER = "user-sub"
OTHER = "user-nobody"

STORIES = [
    {"id": "a1", "title": "Nvidia (NVDA) beats on data center revenue",
     "primary_company": "Nvidia", "companies": ["Nvidia"]},
    {"id": "a2", "title": "Unilever trims its outlook",
     "primary_company": "Unilever PLC", "companies": ["Unilever PLC"]},
    {"id": "a3", "title": "Fed minutes land at 2pm",
     "primary_company": None, "companies": []},
]


def _ctx(**kw) -> PersonalContext:
    base = dict(story_rows=STORIES)
    base.update(kw)
    return PersonalContext(**base)


class TestWatchlistMatching(unittest.TestCase):
    def test_a_ticker_in_the_headline_matches(self):
        self.assertTrue(
            story_matches_watch(STORIES[0], {"identifier": "NVDA", "display_name": None})
        )

    def test_a_company_name_matches_even_without_the_ticker(self):
        self.assertTrue(
            story_matches_watch(
                STORIES[1], {"identifier": "ULVR.L", "display_name": "Unilever PLC"}
            )
        )

    def test_an_exchange_suffix_is_stripped_before_matching(self):
        story = {"title": "ULVR leads the FTSE", "primary_company": None,
                 "companies": []}
        self.assertTrue(
            story_matches_watch(story, {"identifier": "ULVR.L", "display_name": None})
        )

    def test_an_exchange_tag_is_not_a_mention_of_the_exchange(self):
        # Found on real data: a reader watching NASDAQ was shown every story
        # whose headline carried a "(NASDAQ: X)" ticker tag.
        for tagged in ("NASDAQ", "NYSE", "LSE"):
            story = {"title": f"eBay ({tagged}: EBAY) posts Q2 results",
                     "primary_company": "eBay", "companies": ["eBay"]}
            self.assertFalse(
                story_matches_watch(story, {"identifier": tagged,
                                            "display_name": None}),
                tagged,
            )

    def test_stripping_the_tag_leaves_the_ticker_matchable(self):
        story = {"title": "eBay (NASDAQ: EBAY) posts Q2 results",
                 "primary_company": "eBay", "companies": ["eBay"]}
        self.assertTrue(
            story_matches_watch(story, {"identifier": "EBAY", "display_name": None})
        )

    def test_an_unrelated_story_does_not_match(self):
        self.assertFalse(
            story_matches_watch(STORIES[2], {"identifier": "NVDA", "display_name": None})
        )

    def test_a_short_ticker_never_matches_prose(self):
        # "IT" and "ON" are real tickers and would otherwise hit every headline.
        story = {"title": "IT spending is on the rise", "primary_company": None,
                 "companies": []}
        for short in ("IT", "ON", "A"):
            self.assertFalse(
                story_matches_watch(story, {"identifier": short, "display_name": None}),
                short,
            )

    def test_matching_is_case_sensitive_for_tickers(self):
        story = {"title": "the road ahead for infrastructure",
                 "primary_company": None, "companies": []}
        self.assertFalse(
            story_matches_watch(story, {"identifier": "ROAD", "display_name": None})
        )


class TestReaderWithMatches(unittest.TestCase):
    def test_a_watchlist_match_alone_renders_the_block(self):
        block = personal_block(
            USER,
            _ctx(watchlist_by_user={USER: [{"identifier": "NVDA", "display_name": None}]}),
            now=NOW,
        )
        self.assertIsNotNone(block)
        self.assertEqual(block.watchlist_stories, [("NVDA", STORIES[0]["title"])])

    def test_a_claim_resolved_since_the_last_send_renders(self):
        block = personal_block(
            USER,
            _ctx(
                claims_by_user={USER: [{
                    "id": "c1", "user_claim": "Nvidia holds its lead.",
                    "target_symbol": "NVDA", "resolution_window_end": "2026-08-09",
                }]},
                outcomes_by_claim={"c1": {
                    "claim_id": "c1", "verdict": "correct",
                    "actual_pct_change": 0.0231,
                    "graded_at": "2026-08-10T02:00:00+00:00",
                }},
                last_send_by_user={USER: "2026-08-09T11:00:00+00:00"},
            ),
            now=NOW,
        )
        self.assertEqual(len(block.resolved), 1)
        self.assertEqual(block.resolved[0].verdict, "Supported")
        self.assertIn("+2.31%", block.resolved[0].detail)

    def test_a_claim_graded_before_the_last_send_is_not_repeated(self):
        block = personal_block(
            USER,
            _ctx(
                claims_by_user={USER: [{"id": "c1", "user_claim": "x",
                                        "target_symbol": "NVDA"}]},
                outcomes_by_claim={"c1": {"claim_id": "c1", "verdict": "correct",
                                          "graded_at": "2026-08-01T02:00:00+00:00"}},
                last_send_by_user={USER: "2026-08-09T11:00:00+00:00"},
            ),
            now=NOW,
        )
        self.assertIsNone(block, "already-mailed resolutions must not resend")

    def test_an_open_claim_resolving_soon_renders_with_its_window(self):
        block = personal_block(
            USER,
            _ctx(claims_by_user={USER: [{
                "id": "c2", "user_claim": "Crude stays bid.",
                "target_symbol": "USO",
                "resolution_window_end": (NOW + timedelta(days=3)).date().isoformat(),
            }]}),
            now=NOW,
        )
        self.assertEqual(len(block.upcoming), 1)
        self.assertIsNone(block.upcoming[0].verdict)
        self.assertEqual(block.upcoming[0].detail, "Resolves in 3 days.")

    def test_a_claim_resolving_far_out_is_not_surfaced_yet(self):
        block = personal_block(
            USER,
            _ctx(claims_by_user={USER: [{
                "id": "c3", "user_claim": "x", "target_symbol": "USO",
                "resolution_window_end": (NOW + timedelta(days=60)).date().isoformat(),
            }]}),
            now=NOW,
        )
        self.assertIsNone(block)

    def test_each_list_is_capped(self):
        watch = [{"identifier": f"TCK{i}", "display_name": None} for i in range(9)]
        stories = [{"id": str(i), "title": f"TCK{i} moves", "primary_company": None,
                    "companies": []} for i in range(9)]
        block = personal_block(
            USER,
            PersonalContext(watchlist_by_user={USER: watch}, story_rows=stories),
            now=NOW,
        )
        self.assertLessEqual(len(block.watchlist_stories), MAX_PER_LIST)

    def test_the_same_story_is_never_listed_twice(self):
        watch = [{"identifier": "NVDA", "display_name": "Nvidia"},
                 {"identifier": "NVDA", "display_name": None}]
        block = personal_block(
            USER, _ctx(watchlist_by_user={USER: watch}), now=NOW
        )
        titles = [t for _tk, t in block.watchlist_stories]
        self.assertEqual(len(titles), len(set(titles)))


class TestReaderWithNothing(unittest.TestCase):
    def test_no_data_means_no_block_at_all(self):
        self.assertIsNone(personal_block(OTHER, _ctx(), now=NOW))

    def test_a_watchlist_that_matches_nothing_today_means_no_block(self):
        block = personal_block(
            OTHER,
            _ctx(watchlist_by_user={OTHER: [{"identifier": "ZZZZ",
                                             "display_name": "Nothing Corp"}]}),
            now=NOW,
        )
        self.assertIsNone(block)

    def test_an_empty_block_is_never_rendered(self):
        payload = _payload()
        payload.personal = PersonalBlock()
        out = render_email(payload)
        for body in (out["text"], out["html"]):
            self.assertNotIn("YOUR NAMES", body.upper())

    def test_none_renders_no_section_and_the_rest_of_the_email_is_intact(self):
        payload = _payload()
        payload.personal = None
        out = render_email(payload)
        self.assertNotIn("YOUR NAMES", out["text"].upper())
        self.assertIn("MARKET PULSE", out["text"])
        self.assertIn("THE LEAD", out["text"])


class TestPlacementAndRendering(unittest.TestCase):
    def setUp(self):
        self.payload = _payload()
        self.payload.personal = PersonalBlock(
            watchlist_stories=[("NVDA", "Nvidia beats on data center revenue")]
        )

    def test_it_sits_after_the_pulse_and_before_the_desk_record(self):
        text = render_email(self.payload)["text"]
        self.assertLess(text.index("MARKET PULSE"), text.index("YOUR NAMES"))
        self.assertLess(
            text.index("YOUR NAMES"),
            text.index("HOW THE LAST SESSION'S CALLS RESOLVED"),
        )

    def test_the_html_places_it_in_the_same_order(self):
        html = render_email(self.payload)["html"]
        self.assertLess(html.index("Market pulse"), html.index("Your names"))
        self.assertLess(
            html.index("Your names"),
            html.index("How the last session&#x27;s calls resolved"),
        )

    def test_it_is_its_own_bordered_block(self):
        html = render_email(self.payload)["html"]
        self.assertEqual(html.count("border-radius:12px"), 6)


class TestNoPerUserModelCall(unittest.TestCase):
    def test_the_builder_takes_no_client_so_it_cannot_call_anything(self):
        import inspect

        params = set(inspect.signature(personal_block).parameters)
        for forbidden in ("sb", "client", "supabase", "model", "gemini"):
            self.assertNotIn(forbidden, params)

    def test_the_module_imports_no_model_or_network_client(self):
        path = os.path.join(_BACKEND, "brief_email_personal.py")
        with open(path, encoding="utf-8") as fh:
            source = fh.read()
        for banned in ("genai", "gemini", "openai", "requests", "httpx",
                       "supabase", "urllib"):
            self.assertNotIn(f"import {banned}", source, banned)

    def test_query_count_does_not_grow_with_recipient_count(self):
        def run(n):
            users = [{"id": f"u{i}", "email": f"u{i}@example.com"} for i in range(n)]
            client = make_client(
                users=users,
                profiles=[],
                extra_tables={
                    "watchlist": [
                        {"user_id": u["id"], "identifier": "NVDA",
                         "display_name": "Nvidia"} for u in users
                    ],
                    "articles": STORIES,
                },
            )
            sender = RecordingSender()
            result = maybe_send_brief_email(
                "morning", client=client, sender=sender, env=BASE_ENV
            )
            return result, client, sender

        one, client_one, _s1 = run(1)
        many, client_many, sender_many = run(12)

        self.assertEqual(one["sent"], 1)
        self.assertEqual(many["sent"], 12)
        # Reads are shared. Only the per-send ledger INSERT scales, and that is
        # a write we already made before this feature existed.
        reads_one = [t for t in client_one.table_calls if t != "brief_email_sends"]
        reads_many = [t for t in client_many.table_calls if t != "brief_email_sends"]
        self.assertEqual(
            len(reads_one), len(reads_many),
            f"reads grew with recipients: {len(reads_one)} -> {len(reads_many)}",
        )
        self.assertIn("user_claims", reads_many)
        self.assertIn("watchlist", reads_many)

    def test_bucketing_is_a_single_pass(self):
        rows = [{"user_id": "a", "x": 1}, {"user_id": "b", "x": 2},
                {"user_id": "a", "x": 3}, {"user_id": "", "x": 4}]
        got = bucket_by(rows, "user_id")
        self.assertEqual(sorted(got), ["a", "b"])
        self.assertEqual(len(got["a"]), 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
