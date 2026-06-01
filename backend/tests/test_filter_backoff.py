"""
Unit tests for the 429 / RESOURCE_EXHAUSTED backoff path in
backend/ingest.filter_article (PR #300).

This is the only branch in PR #300 that the live validation never exercised
(the probe key returned zero 429s), so it is verified here with a fully mocked
Gemini call. NO production Gemini calls are made.

The real risk being checked: the backoff detects a rate-limit via str(ex)
("429" / "RESOURCE_EXHAUSTED") inside a broad `except Exception`. If the real
SDK 429 exception did not stringify with those tokens, the backoff would never
fire and the article would be dropped immediately. We therefore raise the EXACT
exception the google-genai SDK raises on a 429 -- google.genai.errors.ClientError
-- and assert the backoff actually engages.

Run from the repo root:
    python -m unittest backend.tests.test_filter_backoff
ingest.py uses bare sibling imports (from watchlist import ...), exactly like
run.py executing with cwd=backend, so we put backend/ on sys.path and import
`ingest` the same way. Dummy creds let the module-level genai/supabase clients
construct offline (neither makes a network call at construction).
"""
import json
import os
import sys
import threading
import unittest
from unittest.mock import patch

os.environ.setdefault("GEMINI_API_KEY", "dummy-key-not-used")
os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_ANON_KEY", "dummy-anon-not-used")

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from google.genai import errors  # noqa: E402

import ingest  # noqa: E402


def _rate_limit_exc():
    """The exact exception google-genai raises on an HTTP 429."""
    return errors.ClientError(
        429,
        {"error": {"code": 429,
                   "message": "Resource has been exhausted (e.g. check quota).",
                   "status": "RESOURCE_EXHAUSTED"}},
    )


_GOOD_JSON = json.dumps(
    {"relevant": True, "relevance_score": 8, "sector": "Technology",
     "primary_company": "TestCo", "deal_type": "Other"}
)


class _FakeResponse:
    def __init__(self, text):
        self.text = text


class _CountingCall:
    """Mock for gemini_client.models.generate_content.

    Raises a 429 for the first `fails` calls, then returns a good response.
    Articles whose prompt contains ALWAYS_429 raise on EVERY call (used to
    prove the filter pass continues past a permanently-throttled article).
    Thread-safe so it can back a multi-worker filter_articles pass.
    """

    def __init__(self, fails=0):
        self.fails = fails
        self.calls = 0
        self._lock = threading.Lock()

    def __call__(self, *args, **kwargs):
        with self._lock:
            self.calls += 1
            n = self.calls
        contents = kwargs.get("contents", "")
        if "ALWAYS_429" in str(contents):
            raise _rate_limit_exc()
        if n <= self.fails:
            raise _rate_limit_exc()
        return _FakeResponse(_GOOD_JSON)


def _article(title="Test story", source="Google News (TEST)"):
    return {"title": title, "summary": "synthetic summary", "source": source}


class FilterBackoffTest(unittest.TestCase):

    def setUp(self):
        # Sanity: the detector must recognise the real SDK 429.
        self.assertTrue(ingest._is_rate_limit_error(_rate_limit_exc()))
        # And must NOT treat an ordinary error as a rate limit.
        self.assertFalse(ingest._is_rate_limit_error(ValueError("boom")))

    # Case (a): N<max 429s then success -> backs off and returns the decision.
    def test_a_backoff_then_success(self):
        fake = _CountingCall(fails=3)  # 3 < FILTER_MAX_RATE_RETRIES (5)
        with patch.object(ingest.gemini_client.models, "generate_content", fake), \
             patch.object(ingest.time, "sleep") as sleep_mock:
            result = ingest.filter_article(_article())
        self.assertIsInstance(result, dict)
        self.assertTrue(result.get("relevant"))
        self.assertEqual(result.get("relevance_score"), 8)
        self.assertEqual(fake.calls, 4, "3 throttled attempts + 1 success")
        self.assertEqual(sleep_mock.call_count, 3, "one backoff sleep per 429")

    # Case (b): 429 on every attempt -> retries exhaust, dropped, no propagation.
    def test_b_backoff_exhausts_and_drops(self):
        fake = _CountingCall(fails=10_000)  # always throttled
        with patch.object(ingest.gemini_client.models, "generate_content", fake), \
             patch.object(ingest.time, "sleep"):
            try:
                result = ingest.filter_article(_article())
            except Exception as ex:  # must NOT propagate
                self.fail(f"429 propagated out of filter_article: {ex!r}")
        self.assertIsNone(result, "exhausted retries -> drop (None)")
        self.assertEqual(
            fake.calls, ingest.FILTER_MAX_RATE_RETRIES + 1,
            "bounded at max retries + the initial attempt",
        )

    # Case (c): bounded, no infinite loop -> exact attempt count.
    def test_c_bounded_attempts_no_infinite_loop(self):
        fake = _CountingCall(fails=10_000)
        with patch.object(ingest.gemini_client.models, "generate_content", fake), \
             patch.object(ingest.time, "sleep"):
            ingest.filter_article(_article())
        self.assertEqual(fake.calls, ingest.FILTER_MAX_RATE_RETRIES + 1)
        self.assertLessEqual(fake.calls, 6, "must stay bounded (5 retries + 1)")

    # The pass continues: a permanently-throttled article is dropped while the
    # rest filter normally, results stay index-aligned, accounting is correct.
    def test_d_filter_pass_continues_with_alignment(self):
        fake = _CountingCall(fails=0)
        articles = [
            _article("Good one", "Google News (AAA)"),
            _article("Bad ALWAYS_429 one", "Google News (BBB)"),
            _article("Good two", "Google News (CCC)"),
        ]
        with patch.object(ingest.gemini_client.models, "generate_content", fake), \
             patch.object(ingest.time, "sleep"):
            results = ingest.filter_articles(articles)
        self.assertEqual(len(results), len(articles), "results index-aligned")
        self.assertIsInstance(results[0], dict)
        self.assertIsNone(results[1], "throttled article dropped")
        self.assertIsInstance(results[2], dict)
        kept = sum(1 for r in results if r is not None)
        dropped = sum(1 for r in results if r is None)
        self.assertEqual((kept, dropped), (2, 1))

    # A non-rate error must NOT be retried (immediate drop, single attempt).
    def test_e_non_rate_error_not_retried(self):
        class _Boom:
            def __init__(self):
                self.calls = 0

            def __call__(self, *a, **k):
                self.calls += 1
                raise ValueError("schema boom, not a rate limit")

        boom = _Boom()
        with patch.object(ingest.gemini_client.models, "generate_content", boom), \
             patch.object(ingest.time, "sleep") as sleep_mock:
            result = ingest.filter_article(_article())
        self.assertIsNone(result)
        self.assertEqual(boom.calls, 1, "non-rate error is not retried by backoff")
        self.assertEqual(sleep_mock.call_count, 0)


if __name__ == "__main__":
    unittest.main()
