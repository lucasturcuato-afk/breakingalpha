"""Unit tests for brief synthesis retry (stub-prevention).

Incident 2026-06-16, run #165: one un-retried Gemini failure stubbed the whole
morning brief, the GitHub job still went green, and the frontend (which filters
stubs) kept serving the prior day. These tests pin the fix: a single transient
failure must recover instead of stubbing, and only a sustained failure returns
None (which the caller turns into the stub).

No network and no DB: backend.synthesize builds its Supabase and Gemini clients
at import time from env vars, so dummy values are set BEFORE the import (client
construction is offline; nothing is sent). gemini_generate is mocked.

Run from repo root: python -m unittest backend.tests.test_brief_synth_retry
"""
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

# Dummy env so importing synthesize does not raise on missing keys. These never
# leave the process; no client makes a network call at construction.
os.environ.setdefault("SUPABASE_URL", "http://localhost")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service")
os.environ.setdefault("GEMINI_API_KEY", "test-gemini")

# synthesize.py uses bare sibling imports (from ingest, from outputs, ...) that
# resolve only with backend/ on sys.path, the same cwd=backend/ context the
# pipeline runs run.py in.
_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

import synthesize  # noqa: E402

_VALID = '{"headline": "Real Brief", "summary": "ok", "sections": {}}'


class ParseBriefJson(unittest.TestCase):
    def test_plain_json(self):
        self.assertEqual(synthesize._parse_brief_json(_VALID)["headline"], "Real Brief")

    def test_code_fenced(self):
        fenced = "```json\n" + _VALID + "\n```"
        self.assertEqual(synthesize._parse_brief_json(fenced)["headline"], "Real Brief")

    def test_extracts_first_block_from_noise(self):
        noisy = "here you go:\n" + _VALID + "\nthanks"
        self.assertEqual(synthesize._parse_brief_json(noisy)["summary"], "ok")

    def test_unparseable_returns_none(self):
        self.assertIsNone(synthesize._parse_brief_json("not json at all"))

    def test_none_input_returns_none(self):
        self.assertIsNone(synthesize._parse_brief_json(None))


class GenerateBriefJsonRetry(unittest.TestCase):
    def test_first_attempt_success(self):
        with mock.patch.object(synthesize, "gemini_generate", return_value=_VALID) as gg:
            out = synthesize._generate_brief_json("sys", "user", backoff_s=0)
        self.assertEqual(out["headline"], "Real Brief")
        self.assertEqual(gg.call_count, 1)

    def test_transient_raise_then_recovers(self):
        # The exact 2026-06-16 failure mode: first call raises, retry succeeds.
        calls = [RuntimeError("503 model overloaded"), _VALID]

        def side_effect(*a, **k):
            v = calls.pop(0)
            if isinstance(v, Exception):
                raise v
            return v

        with mock.patch.object(synthesize, "gemini_generate", side_effect=side_effect) as gg:
            out = synthesize._generate_brief_json("sys", "user", backoff_s=0)
        self.assertIsNotNone(out)
        self.assertEqual(out["headline"], "Real Brief")
        self.assertEqual(gg.call_count, 2)

    def test_unparseable_then_valid_recovers(self):
        calls = ["garbage not json", _VALID]
        with mock.patch.object(synthesize, "gemini_generate", side_effect=calls) as gg:
            out = synthesize._generate_brief_json("sys", "user", backoff_s=0)
        self.assertEqual(out["headline"], "Real Brief")
        self.assertEqual(gg.call_count, 2)

    def test_all_attempts_fail_returns_none(self):
        # Sustained failure: every attempt raises -> None (caller writes stub).
        with mock.patch.object(
            synthesize, "gemini_generate", side_effect=RuntimeError("rate limit")
        ) as gg:
            out = synthesize._generate_brief_json(
                "sys", "user", max_attempts=3, backoff_s=0
            )
        self.assertIsNone(out)
        self.assertEqual(gg.call_count, 3)

    def test_exhausts_configured_attempts(self):
        with mock.patch.object(
            synthesize, "gemini_generate", side_effect=RuntimeError("boom")
        ) as gg:
            synthesize._generate_brief_json("sys", "user", max_attempts=5, backoff_s=0)
        self.assertEqual(gg.call_count, 5)


if __name__ == "__main__":
    unittest.main()
