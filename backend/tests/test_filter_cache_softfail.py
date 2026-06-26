"""
Unit tests for the FILTER_PROMPT_CACHE reorder + explicit-cache path
(backend/ingest.py). Fully mocked: NO production Gemini calls are made.

What is verified here:
  1. Flag OFF -> filter_article sends the ORIGINAL FILTER_PROMPT order with no
     cache reference (byte-identical to today).
  2. Flag ON + live cache -> the request carries only the fields tail and
     references the cached static prefix.
  3. Flag ON + cache create failure -> _create_filter_cache soft-fails to None
     and the call falls back to the UNCACHED reordered prompt; the article is
     still graded, never skipped.
  4. End to end: when cache creation raises, filter_articles still returns the
     parsed result (the cache failure degrades cost, not correctness).

ingest.py uses bare sibling imports, so we put backend/ on sys.path and import
`ingest` the same way run.py does (cwd=backend). Dummy creds let the
module-level genai/supabase clients construct offline.
"""
import json
import os
import sys
import unittest
from unittest.mock import MagicMock, patch

os.environ.setdefault("GEMINI_API_KEY", "dummy-key-not-used")
os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_ANON_KEY", "dummy-anon-not-used")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "dummy-service-not-used")

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import ingest  # noqa: E402


_ARTICLE = {
    "title": "LongRange to acquire Pizza Hut for $1.2bn",
    "summary": "All-cash deal announced Monday; close expected Q4.",
    "source": "Reuters",
}

_VALID_PAYLOAD = {
    "relevant": True,
    "relevance_score": 9,
    "relevance_reason": "Named M&A with figure.",
    "industry_verticals": ["Consumer & Retail"],
    "activity_types": ["Mergers & Acquisitions"],
    "companies": [{"name": "LongRange", "entity_type": "company"}],
    "themes": ["M&A"],
    "sentiment": "neutral",
    "sentiment_reason": "Acquisition announced.",
    "deal_type": "M&A",
    "primary_company": "Pizza Hut",
}


class _FakeResp:
    """Minimal stand-in for a google-genai GenerateContentResponse."""

    def __init__(self, payload):
        self.text = json.dumps(payload)
        self.usage_metadata = None


def _mock_generate_content():
    """A MagicMock that captures call args and returns a valid filter payload."""
    return MagicMock(return_value=_FakeResp(_VALID_PAYLOAD))


class FilterCacheSoftFailTest(unittest.TestCase):
    def _last_call(self, gen_mock):
        kwargs = gen_mock.call_args.kwargs
        return kwargs["contents"], kwargs["config"].cached_content

    def test_flag_off_is_original_prompt_and_no_cache(self):
        gen = _mock_generate_content()
        with patch.object(ingest, "FILTER_PROMPT_CACHE", False), \
                patch.object(ingest.gemini_client.models, "generate_content", gen):
            out = ingest.filter_article(_ARTICLE, cache_name=None)
        contents, cached = self._last_call(gen)
        self.assertEqual(out["deal_type"], "M&A")
        self.assertEqual(contents, ingest.FILTER_PROMPT.format(**_ARTICLE))
        self.assertIsNone(cached)

    def test_flag_on_with_cache_sends_fields_tail_and_reference(self):
        gen = _mock_generate_content()
        with patch.object(ingest, "FILTER_PROMPT_CACHE", True), \
                patch.object(ingest.gemini_client.models, "generate_content", gen):
            out = ingest.filter_article(_ARTICLE, cache_name="caches/abc123")
        contents, cached = self._last_call(gen)
        self.assertEqual(out["deal_type"], "M&A")
        self.assertEqual(contents, ingest._FILTER_FIELDS_TAIL.format(**_ARTICLE))
        self.assertEqual(cached, "caches/abc123")
        # The static rubric must NOT be re-sent on the cached path.
        self.assertNotIn("senior analyst", contents)

    def test_softfail_falls_back_to_uncached_reordered_prompt(self):
        gen = _mock_generate_content()
        with patch.object(ingest, "FILTER_PROMPT_CACHE", True), \
                patch.object(ingest.gemini_client.models, "generate_content", gen):
            # cache_name=None simulates a failed/absent cache.
            out = ingest.filter_article(_ARTICLE, cache_name=None)
        contents, cached = self._last_call(gen)
        # Article is still graded (NOT skipped) ...
        self.assertEqual(out["deal_type"], "M&A")
        # ... via the full reordered prompt, uncached.
        self.assertEqual(contents, ingest.FILTER_PROMPT_REORDERED.format(**_ARTICLE))
        self.assertIsNone(cached)
        self.assertIn("senior analyst", contents)

    def test_create_filter_cache_returns_none_on_failure(self):
        broken = MagicMock()
        broken.caches.create.side_effect = RuntimeError("cache backend down")
        with patch.object(ingest, "gemini_client", broken):
            self.assertIsNone(ingest._create_filter_cache())

    def test_filter_articles_softfail_keeps_article_end_to_end(self):
        gen = _mock_generate_content()
        fake_client = MagicMock()
        fake_client.caches.create.side_effect = RuntimeError("cache backend down")
        fake_client.models.generate_content = gen
        with patch.object(ingest, "FILTER_PROMPT_CACHE", True), \
                patch.object(ingest, "gemini_client", fake_client):
            results = ingest.filter_articles([_ARTICLE])
        # Cache creation was attempted ...
        self.assertTrue(fake_client.caches.create.called)
        # ... it failed, yet the article was graded, not dropped.
        self.assertEqual(len(results), 1)
        self.assertIsNotNone(results[0])
        self.assertEqual(results[0]["deal_type"], "M&A")
        # And the uncached reordered prompt carried the full rubric.
        contents, cached = self._last_call(gen)
        self.assertEqual(contents, ingest.FILTER_PROMPT_REORDERED.format(**_ARTICLE))
        self.assertIsNone(cached)


if __name__ == "__main__":
    unittest.main()
