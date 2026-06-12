"""Unit tests for the SpaceX -> SPCX hard override in backend/finnhub_helper.py.

Locks the private-vs-public classification at its root: a name with a hard
override must resolve to a ticker WITHOUT any Finnhub network call, so a
brand-new listing (SPCX) is never at the mercy of Finnhub's fresh-listing
index. See src/lib/finnhub-ticker.ts for the TS twin that must stay in parity.
"""
import unittest

from backend import finnhub_helper
from backend.finnhub_helper import HARD_TICKER_OVERRIDES, search_finnhub_ticker


def _boom(*_args, **_kwargs):
    raise AssertionError("Finnhub was called; override path should short-circuit")


class SpacexOverrideTests(unittest.TestCase):
    def setUp(self):
        # A non-empty key gets us past the key gate so we exercise the override
        # branch. The override returns before _do_finnhub_call, so no network.
        self._orig_call = finnhub_helper._do_finnhub_call

    def tearDown(self):
        finnhub_helper._do_finnhub_call = self._orig_call

    def test_spacex_resolves_to_spcx_without_network(self):
        finnhub_helper._do_finnhub_call = _boom  # any call would raise
        self.assertEqual(
            search_finnhub_ticker("SpaceX", mention_count=1054, finnhub_key="test-key"),
            "SPCX",
        )

    def test_override_key_is_case_insensitive(self):
        finnhub_helper._do_finnhub_call = _boom
        for variant in ("SpaceX", "SPACEX", "spacex", "  SpaceX  "):
            with self.subTest(variant=variant):
                self.assertEqual(
                    search_finnhub_ticker(
                        variant, mention_count=1054, finnhub_key="test-key"
                    ),
                    "SPCX",
                )

    def test_no_override_private_name_returns_none(self):
        # Name with no override and no Finnhub match resolves to None, i.e. it
        # stays private. Stub the network call to simulate "no match".
        finnhub_helper._do_finnhub_call = lambda *_a, **_k: None
        self.assertIsNone(
            search_finnhub_ticker(
                "Totally Private Holdings",
                mention_count=1054,
                finnhub_key="test-key",
            )
        )

    def test_overrides_map_contains_spacex(self):
        # Parity guard (Python side). The TS twin in src/lib/finnhub-ticker.ts
        # must carry the identical "spacex": "SPCX" entry; parsing the TS
        # literal here is fragile, so that half is enforced by code review.
        self.assertEqual(HARD_TICKER_OVERRIDES.get("spacex"), "SPCX")


if __name__ == "__main__":
    unittest.main()
