"""Unit tests for apply_entry_caps: the post-dedup burst ceiling.

WHY THIS EXISTS. The per-feed cap used to slice RAW feed entries, so
already-stored duplicates consumed cap slots. Measured 2026-09-04 mid-day: WSJ
Business offered 85 entries of which 49 were new; CNBC Business offered 30 of
which 8. At a raw cap of 40, CNBC spent 40 slots to reach 8 new articles.

Dedup already runs before the Gemini filter, so a duplicate never cost a filter
call -- it only cost the slot. Moving the cap after dedup is free yield at
identical cost.

These tests pin the properties that make the move safe:
  1. the cap applies ONLY to configured RSS_FEEDS sources -- Google News,
     NewsAPI and Finnhub rows pass through untouched, because each is bounded
     by its own fetch parameters and double-capping would silently shrink them;
  2. order is preserved, so the survivors are the freshest entries;
  3. `capped` is recorded per feed -- that count is the tuning signal, and
     without it a binding cap is indistinguishable from a protecting one.

No network, no DB.

Runs under pytest and `python -m unittest backend.tests.test_entry_caps`.
"""

import os
import sys
import unittest

for _k, _v in {
    "GEMINI_API_KEY": "dummy-gemini-key-not-used",
    "SUPABASE_URL": "http://localhost:54321",
    "SUPABASE_SERVICE_ROLE_KEY": "dummy-service-role-not-used",
    "SUPABASE_ANON_KEY": "dummy-anon-not-used",
    "NEWS_API_KEY": "dummy-news-key-not-used",
}.items():
    os.environ[_k] = _v

_HERE = os.path.dirname(os.path.abspath(__file__))
for _p in (os.path.dirname(_HERE), os.path.dirname(os.path.dirname(_HERE))):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import ingest  # noqa: E402


def _rows(source, n, start=0):
    return [{"source": source, "url": f"{source}-{i}", "title": f"t{i}"}
            for i in range(start, start + n)]


class ApplyEntryCapsTests(unittest.TestCase):
    def test_caps_a_configured_feed_at_the_default(self):
        kept = ingest.apply_entry_caps(_rows("WSJ Business", 60))
        self.assertEqual(len(kept), ingest.ENTRY_CAP_DEFAULT)

    def test_under_cap_feed_is_untouched(self):
        kept = ingest.apply_entry_caps(_rows("CNBC Business", 5))
        self.assertEqual(len(kept), 5)

    def test_google_news_is_never_capped_here(self):
        """gnews has its own GNEWS_ENTRY_CAP at fetch; capping twice would
        silently shrink 88% of the corpus."""
        kept = ingest.apply_entry_caps(_rows("Google News (AAPL)", 100))
        self.assertEqual(len(kept), 100)

    def test_newsapi_and_finnhub_sources_pass_through(self):
        """Their `source` is the outlet name, not an RSS_FEEDS key."""
        for src in ("SeekingAlpha", "Benzinga", "Yahoo", "Finnhub"):
            self.assertEqual(len(ingest.apply_entry_caps(_rows(src, 50))), 50, src)

    def test_each_feed_gets_its_own_budget(self):
        pool = _rows("WSJ Business", 60) + _rows("WSJ Markets", 60)
        kept = ingest.apply_entry_caps(pool)
        self.assertEqual(len(kept), 2 * ingest.ENTRY_CAP_DEFAULT)

    def test_order_is_preserved_so_the_freshest_survive(self):
        kept = ingest.apply_entry_caps(_rows("WSJ Business", 60))
        self.assertEqual([r["url"] for r in kept],
                         [f"WSJ Business-{i}" for i in range(ingest.ENTRY_CAP_DEFAULT)])

    def test_interleaved_sources_do_not_steal_each_others_budget(self):
        pool = []
        for i in range(60):
            pool.append({"source": "WSJ Business", "url": f"a{i}"})
            pool.append({"source": "Google News (X)", "url": f"g{i}"})
        kept = ingest.apply_entry_caps(pool)
        wsj = [r for r in kept if r["source"] == "WSJ Business"]
        gn = [r for r in kept if r["source"] == "Google News (X)"]
        self.assertEqual(len(wsj), ingest.ENTRY_CAP_DEFAULT)
        self.assertEqual(len(gn), 60)

    def test_capped_count_is_recorded_per_feed(self):
        """The tuning signal. Without it, a cap that is BINDING (costing real
        articles) looks identical to one that is merely PROTECTING."""
        stats = {}
        ingest.apply_entry_caps(_rows("WSJ Business", 60), stats=stats)
        self.assertEqual(stats["WSJ Business"]["capped"],
                         60 - ingest.ENTRY_CAP_DEFAULT)

    def test_capped_is_zero_when_nothing_is_held_back(self):
        stats = {"CNBC Business": {"fetched": 5, "fresh": 5, "stale": 0, "capped": 0}}
        ingest.apply_entry_caps(_rows("CNBC Business", 5), stats=stats)
        self.assertEqual(stats["CNBC Business"]["capped"], 0)

    def test_stats_is_optional(self):
        self.assertEqual(len(ingest.apply_entry_caps(_rows("WSJ Business", 60))),
                         ingest.ENTRY_CAP_DEFAULT)

    def test_an_override_still_wins_when_one_is_added(self):
        kept = ingest.apply_entry_caps(
            _rows("WSJ Business", 60), caps={"WSJ Business": 5}, default_cap=40)
        self.assertEqual(len(kept), 5)

    def test_empty_pool(self):
        self.assertEqual(ingest.apply_entry_caps([]), [])


class ConfigTests(unittest.TestCase):
    def test_cap_is_uniform_40(self):
        self.assertEqual(ingest.ENTRY_CAP_DEFAULT, 40)
        self.assertEqual(ingest.ENTRY_CAP_OVERRIDES, {},
                         "40 across the board; a per-feed number goes stale")

    def test_read_ceiling_is_far_above_any_real_feed(self):
        """A safety bound, not a tuning knob. Largest feed measured: 100."""
        self.assertGreaterEqual(ingest.RSS_READ_CEILING, 200)
        self.assertGreater(ingest.RSS_READ_CEILING, ingest.ENTRY_CAP_DEFAULT)

    def test_the_fetch_loop_no_longer_caps_per_feed(self):
        """Regression guard: if the cap moves back to fetch, duplicates start
        consuming slots again and this whole change is silently undone."""
        import inspect
        src = inspect.getsource(ingest.fetch_all_articles)
        self.assertIn("RSS_READ_CEILING", src)
        self.assertNotIn("entries[:entry_cap]", src)


if __name__ == "__main__":
    unittest.main()
