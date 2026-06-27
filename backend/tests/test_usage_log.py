"""Unit tests for the soft-fail Gemini usage logger.

No live API, no live DB. Everything is mocked. The point is to prove the logger
never raises into the generation path, including when the gemini_usage table or
the client is unavailable, and that token math is correct when it does write.
"""
import unittest

from backend import usage_log


class _UM:
    """Stand-in for response.usage_metadata.

    cached defaults to None and, when None, the cached_content_token_count
    attribute is left UNSET so the logger sees the same shape as a response that
    used no prompt cache (which proves cached defaults to 0)."""

    def __init__(self, prompt, candidates, thoughts, total, cached=None):
        self.prompt_token_count = prompt
        self.candidates_token_count = candidates
        self.thoughts_token_count = thoughts
        self.total_token_count = total
        if cached is not None:
            self.cached_content_token_count = cached


class _Resp:
    def __init__(self, um):
        self.usage_metadata = um


class _RaisingClient:
    """A client whose insert always blows up, to prove soft-fail."""

    def table(self, *a, **k):
        return self

    def insert(self, *a, **k):
        return self

    def execute(self, *a, **k):
        raise RuntimeError("gemini_usage table does not exist yet")


class _ColumnMissingClient:
    """Simulates a pre-migration table: rejects any insert payload that still
    carries the cached_content_token_count column, accepts it once that key is
    stripped. Captures the accepted payload."""

    def __init__(self):
        self.accepted = None
        self._pending = None

    def table(self, name):
        return self

    def insert(self, payload):
        self._pending = payload
        return self

    def execute(self):
        payload = self._pending
        items = payload if isinstance(payload, list) else [payload]
        if any("cached_content_token_count" in r for r in items):
            raise RuntimeError('column "cached_content_token_count" does not exist')
        self.accepted = payload
        return self


class _RecordingClient:
    """Captures the rows passed to insert()."""

    def __init__(self):
        self.rows = None

    def table(self, name):
        self.last_table = name
        return self

    def insert(self, rows):
        self.rows = rows
        return self

    def execute(self):
        return self


class UsageLogSoftFailTests(unittest.TestCase):
    def setUp(self):
        # Reset the in-memory accumulator and cached client between tests.
        with usage_log._ACC_LOCK:
            usage_log._ACC.clear()
        usage_log._client = None

    def tearDown(self):
        usage_log._client = None

    def test_write_failure_is_swallowed(self):
        usage_log._get_client = lambda: _RaisingClient()
        resp = _Resp(_UM(100, 20, 5, 125))
        # Must not raise even though execute() throws.
        usage_log.log_gemini_usage("filter", "gemini-2.5-flash-lite", resp)

    def test_missing_client_is_noop(self):
        usage_log._get_client = lambda: None
        resp = _Resp(_UM(100, 20, 5, 125))
        usage_log.log_gemini_usage("filter", "gemini-2.5-flash-lite", resp)

    def test_none_usage_metadata_is_noop(self):
        rec = _RecordingClient()
        usage_log._get_client = lambda: rec
        usage_log.log_gemini_usage("filter", "m", _Resp(None))
        self.assertIsNone(rec.rows)

    def test_log_writes_one_row_with_correct_tokens(self):
        rec = _RecordingClient()
        usage_log._get_client = lambda: rec
        usage_log.log_gemini_usage("form_8k", "gemini-2.5-flash", _Resp(_UM(300, 40, 10, 350)))
        self.assertEqual(rec.rows["step"], "form_8k")
        self.assertEqual(rec.rows["model"], "gemini-2.5-flash")
        self.assertEqual(rec.rows["calls"], 1)
        self.assertEqual(rec.rows["prompt_tokens"], 300)
        self.assertEqual(rec.rows["candidates_tokens"], 40)
        self.assertEqual(rec.rows["thoughts_tokens"], 10)
        self.assertEqual(rec.rows["total_tokens"], 350)

    def test_accumulate_then_flush_sums_per_bucket(self):
        rec = _RecordingClient()
        usage_log._get_client = lambda: rec
        usage_log.accumulate_gemini_usage("filter", "gemini-2.5-flash-lite", _Resp(_UM(100, 10, 0, 110)))
        usage_log.accumulate_gemini_usage("filter", "gemini-2.5-flash-lite", _Resp(_UM(50, 5, 0, 55)))
        usage_log.flush_gemini_usage(run_id="run-123")
        self.assertEqual(len(rec.rows), 1)
        row = rec.rows[0]
        self.assertEqual(row["step"], "filter")
        self.assertEqual(row["calls"], 2)
        self.assertEqual(row["prompt_tokens"], 150)
        self.assertEqual(row["candidates_tokens"], 15)
        self.assertEqual(row["total_tokens"], 165)
        self.assertEqual(row["run_id"], "run-123")

    def test_flush_write_failure_is_swallowed(self):
        usage_log._get_client = lambda: _RaisingClient()
        usage_log.accumulate_gemini_usage("filter", "m", _Resp(_UM(1, 1, 0, 2)))
        # Must not raise even though execute() throws.
        usage_log.flush_gemini_usage()

    def test_flush_with_no_data_is_noop(self):
        rec = _RecordingClient()
        usage_log._get_client = lambda: rec
        usage_log.flush_gemini_usage()
        self.assertIsNone(rec.rows)

    def test_missing_cached_metadata_defaults_to_zero(self):
        rec = _RecordingClient()
        usage_log._get_client = lambda: rec
        # _UM without a cached arg leaves the attribute unset (pre-cache shape).
        usage_log.log_gemini_usage("form_8k", "m", _Resp(_UM(300, 40, 10, 350)))
        self.assertEqual(rec.rows["cached_content_token_count"], 0)

    def test_log_persists_cached_when_present(self):
        rec = _RecordingClient()
        usage_log._get_client = lambda: rec
        usage_log.log_gemini_usage("filter", "m", _Resp(_UM(100, 20, 5, 125, cached=80)))
        self.assertEqual(rec.rows["cached_content_token_count"], 80)

    def test_flush_persists_summed_cached(self):
        rec = _RecordingClient()
        usage_log._get_client = lambda: rec
        usage_log.accumulate_gemini_usage("filter", "m", _Resp(_UM(100, 10, 0, 110, cached=60)))
        usage_log.accumulate_gemini_usage("filter", "m", _Resp(_UM(50, 5, 0, 55, cached=40)))
        usage_log.flush_gemini_usage(run_id="r")
        self.assertEqual(rec.rows[0]["cached_content_token_count"], 100)

    def test_premigration_missing_column_log_falls_back_and_records(self):
        # Simulate the column not existing yet: the first insert (with the cached
        # key) is rejected, the stripped retry is accepted. Logging must not raise
        # and the other columns must still land.
        client = _ColumnMissingClient()
        usage_log._get_client = lambda: client
        usage_log.log_gemini_usage("filter", "m", _Resp(_UM(100, 20, 5, 125, cached=80)))
        self.assertIsNotNone(client.accepted)
        self.assertNotIn("cached_content_token_count", client.accepted)
        self.assertEqual(client.accepted["prompt_tokens"], 100)

    def test_premigration_missing_column_flush_falls_back_and_records(self):
        client = _ColumnMissingClient()
        usage_log._get_client = lambda: client
        usage_log.accumulate_gemini_usage("filter", "m", _Resp(_UM(100, 10, 0, 110, cached=60)))
        usage_log.flush_gemini_usage(run_id="r")
        self.assertIsNotNone(client.accepted)
        self.assertNotIn("cached_content_token_count", client.accepted[0])
        self.assertEqual(client.accepted[0]["prompt_tokens"], 100)


if __name__ == "__main__":
    unittest.main()
