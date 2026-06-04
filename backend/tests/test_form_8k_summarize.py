"""Unit tests for the 8-K summarize path (google-genai SDK) and the bounded
self-heal re-summarize eligibility/backoff. Run: python -m unittest
backend.tests.test_form_8k_summarize"""
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

from backend.edgar.forms import form_8k
from backend.ingest_sec import _resummarize_eligible, _parse_ts


class Summarize8kTests(unittest.TestCase):
    """summarize_8k must call the google-genai client and behave on edge cases."""

    def _client_returning(self, text):
        client = mock.Mock()
        client.models.generate_content.return_value = mock.Mock(text=text)
        return client

    def test_returns_stripped_summary_via_new_sdk(self):
        client = self._client_returning("  FedEx completed the spin-off.  ")
        with mock.patch.object(form_8k, "_gemini_client", client):
            out = form_8k.summarize_8k("body text", ["2.01"], "FDX", "FedEx Corp")
        self.assertEqual(out, "FedEx completed the spin-off.")
        # called the new-SDK surface with the canonical model
        call = client.models.generate_content.call_args
        self.assertEqual(call.kwargs["model"], form_8k.GEMINI_MODEL)
        self.assertIn("body text", call.kwargs["contents"])
        self.assertIn("FedEx Corp", call.kwargs["contents"])

    def test_empty_text_returns_none(self):
        client = self._client_returning("   ")
        with mock.patch.object(form_8k, "_gemini_client", client):
            self.assertIsNone(form_8k.summarize_8k("x", ["7.01"], "T", "T Inc"))

    def test_none_text_returns_none(self):
        client = self._client_returning(None)
        with mock.patch.object(form_8k, "_gemini_client", client):
            self.assertIsNone(form_8k.summarize_8k("x", ["7.01"], "T", "T Inc"))

    def test_exception_returns_none(self):
        client = mock.Mock()
        client.models.generate_content.side_effect = RuntimeError("rate limit")
        with mock.patch.object(form_8k, "_gemini_client", client):
            self.assertIsNone(form_8k.summarize_8k("x", ["7.01"], "T", "T Inc"))

    def test_no_client_returns_none(self):
        with mock.patch.object(form_8k, "_gemini_client", None), \
             mock.patch.dict("os.environ", {}, clear=True):
            self.assertIsNone(form_8k.summarize_8k("x", ["7.01"], "T", "T Inc"))


class ResummarizeEligibleTests(unittest.TestCase):
    NOW = datetime(2026, 6, 4, 12, 0, 0, tzinfo=timezone.utc)
    KW = {"max_attempts": 4, "base_backoff_hours": 3}

    def test_never_attempted_is_eligible(self):
        self.assertTrue(_resummarize_eligible(0, None, self.NOW, **self.KW))

    def test_attempt_cap_blocks(self):
        self.assertFalse(_resummarize_eligible(4, None, self.NOW, **self.KW))
        self.assertFalse(_resummarize_eligible(5, self.NOW, self.NOW, **self.KW))

    def test_within_backoff_not_eligible(self):
        # after 1 attempt, wait = 3 * 2**1 = 6h; only 5h elapsed -> blocked
        last = self.NOW - timedelta(hours=5)
        self.assertFalse(_resummarize_eligible(1, last, self.NOW, **self.KW))

    def test_past_backoff_eligible(self):
        # after 1 attempt, wait = 6h; 7h elapsed -> eligible
        last = self.NOW - timedelta(hours=7)
        self.assertTrue(_resummarize_eligible(1, last, self.NOW, **self.KW))

    def test_backoff_grows_exponentially(self):
        # after 2 attempts, wait = 3 * 2**2 = 12h
        self.assertFalse(
            _resummarize_eligible(2, self.NOW - timedelta(hours=11), self.NOW, **self.KW)
        )
        self.assertTrue(
            _resummarize_eligible(2, self.NOW - timedelta(hours=13), self.NOW, **self.KW)
        )


class ParseTsTests(unittest.TestCase):
    def test_none_and_empty(self):
        self.assertIsNone(_parse_ts(None))
        self.assertIsNone(_parse_ts(""))

    def test_supabase_space_and_short_offset(self):
        dt = _parse_ts("2026-06-03 04:46:46.677104+00")
        self.assertIsNotNone(dt)
        self.assertEqual(dt.year, 2026)
        self.assertEqual(dt.utcoffset(), timedelta(0))

    def test_iso_passthrough(self):
        dt = _parse_ts("2026-06-03T04:46:46+00:00")
        self.assertIsNotNone(dt)
        self.assertEqual(dt.hour, 4)

    def test_garbage_returns_none(self):
        self.assertIsNone(_parse_ts("not-a-date"))


if __name__ == "__main__":
    unittest.main()
