"""Unit tests for the ingest-tail HTTP/2 GOAWAY fix (run #166).

Two defenses in backend/supabase_client.py:
1. get_service_client rebuilds the PostgREST session over HTTP/1.1 (no
   per-connection stream cap, so the GOAWAY-on-exhaustion cannot occur).
2. execute_with_retry replays a write once the connection is recycled mid-flight.

No network: get_service_client builds the client offline (construction makes no
request), and execute_with_retry is exercised with a callable that raises the
exact exception observed in run #166.

Run from repo root: python -m unittest backend.tests.test_supabase_conn_resilience
"""
import os
import sys
import unittest
from pathlib import Path

import httpx

os.environ.setdefault("SUPABASE_URL", "https://abcdefgh.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "service.role.key")

_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

import supabase_client  # noqa: E402


def _http2_enabled(session):
    return session._transport._pool._http2


class DisableHttp2(unittest.TestCase):
    def test_service_client_built_with_http2_off(self):
        client = supabase_client.get_service_client()
        # The PostgREST session is the one every pipeline writer uses.
        self.assertFalse(
            _http2_enabled(client.postgrest.session),
            "PostgREST session must be HTTP/1.1 so the GOAWAY-on-exhaustion class is gone",
        )

    def test_auth_headers_preserved_after_swap(self):
        client = supabase_client.get_service_client()
        headers = {k.lower() for k in dict(client.postgrest.session.headers)}
        self.assertIn("apikey", headers)
        self.assertIn("authorization", headers)


class ExecuteWithRetry(unittest.TestCase):
    def test_recovers_after_one_remote_protocol_error(self):
        # The exact run #166 failure: httpx.RemoteProtocolError raised once
        # (server GOAWAY / ConnectionTerminated), then the replay succeeds.
        calls = {"n": 0}

        def thunk():
            calls["n"] += 1
            if calls["n"] == 1:
                raise httpx.RemoteProtocolError(
                    "<ConnectionTerminated error_code:0, last_stream_id:19999>"
                )
            return "ok"

        out = supabase_client.execute_with_retry(thunk, attempts=3, backoff_s=0, what="test")
        self.assertEqual(out, "ok")
        self.assertEqual(calls["n"], 2)

    def test_recovers_on_connect_error(self):
        calls = {"n": 0}

        def thunk():
            calls["n"] += 1
            if calls["n"] < 3:
                raise httpx.ConnectError("connection refused")
            return "ok"

        out = supabase_client.execute_with_retry(thunk, attempts=3, backoff_s=0, what="test")
        self.assertEqual(out, "ok")
        self.assertEqual(calls["n"], 3)

    def test_reraises_after_exhausting_attempts(self):
        def thunk():
            raise httpx.RemoteProtocolError("GOAWAY every time")

        with self.assertRaises(httpx.RemoteProtocolError):
            supabase_client.execute_with_retry(thunk, attempts=3, backoff_s=0, what="test")

    def test_does_not_catch_status_errors(self):
        # A genuine PostgREST error (e.g. 400) must surface immediately, not be
        # retried and swallowed, so real failures still degrade the run.
        class FakeAPIError(Exception):
            pass

        calls = {"n": 0}

        def thunk():
            calls["n"] += 1
            raise FakeAPIError("PGRST204 column not found")

        with self.assertRaises(FakeAPIError):
            supabase_client.execute_with_retry(thunk, attempts=3, backoff_s=0, what="test")
        self.assertEqual(calls["n"], 1, "status errors must not be retried")

    def test_first_try_success_no_retry(self):
        out = supabase_client.execute_with_retry(lambda: 42, attempts=3, backoff_s=0)
        self.assertEqual(out, 42)


if __name__ == "__main__":
    unittest.main()
