"""
Unit tests for the Wikidata fetch fix in backend/wikidata.py.

WHAT THIS IS GUARDING. The old fetcher caught every exception, returned None,
and is_valid_company wrote that None into wikidata_entity_cache, a table with no
TTL and no invalidation. A 429 from Wikidata's ~10 calls/minute anonymous budget
therefore produced a PERMANENT verdict about a company Wikidata never answered
for. 76.34% of the live cache rows carry a NULL description. The regression that
matters most is a cache row appearing after a failed fetch, so
FailedFetchIsNeverCachedTest asserts on the upsert log directly.

NO NETWORK. Every test drives wikidata.requests.get through a scripted fake and
replaces wikidata._sleep, so nothing here reaches the real API and nothing here
actually waits. The sleep indirection exists precisely so these tests never have
to patch the stdlib time module out from under a sibling test.

Run from the repo root:
    python -m unittest backend.tests.test_wikidata_fetch
"""
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import wikidata  # noqa: E402


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------
class _FakeResponse:
    """Minimal stand-in for a requests.Response."""

    def __init__(self, status_code=200, payload=None, headers=None, bad_json=False):
        self.status_code = status_code
        self.headers = headers or {}
        self._payload = payload if payload is not None else {"search": []}
        self._bad_json = bad_json

    def json(self):
        if self._bad_json:
            raise ValueError("Expecting value: line 1 column 1 (char 0)")
        return self._payload


class _ScriptedGet:
    """Replaces wikidata.requests.get. Pops one scripted response per call and
    records the `search` term so the query ladder can be asserted on.

    A scripted entry that is an Exception instance is raised, which is how the
    transport-error path (timeout, connection reset) is exercised.
    """

    def __init__(self, script):
        self._script = list(script)
        self.queries = []

    def __call__(self, url, params=None, timeout=None, headers=None):
        self.queries.append((params or {}).get("search"))
        if not self._script:
            raise AssertionError(
                f"unscripted Wikidata call #{len(self.queries)} for "
                f"{(params or {}).get('search')!r}")
        nxt = self._script.pop(0)
        if isinstance(nxt, Exception):
            raise nxt
        return nxt

    @property
    def call_count(self):
        return len(self.queries)


class _FakeSupabase:
    """Cache table double. Records every upsert payload; select returns whatever
    was seeded as the cache row for that name (empty list = cache miss)."""

    def __init__(self, cache_rows=None):
        self.cache_rows = cache_rows or {}
        self.upserts = []
        self._pending_name = None
        self._op = None

    def table(self, name):
        self._table = name
        return self

    def select(self, *_a):
        self._op = "select"
        return self

    def eq(self, _col, value):
        self._pending_name = value
        return self

    def order(self, *_a, **_kw):
        return self

    def range(self, *_a):
        self._op = "range"
        return self

    def upsert(self, payload):
        self._op = "upsert"
        self.upserts.append(payload)
        return self

    def execute(self):
        if self._op == "upsert":
            return _Result([])
        if self._op == "range":
            return _Result([])          # companies pagination: empty index
        row = self.cache_rows.get(self._pending_name)
        return _Result([row] if row else [])


class _Result:
    def __init__(self, data):
        self.data = data


def _ok(results):
    return _FakeResponse(200, {"search": results})


def _empty():
    return _FakeResponse(200, {"search": []})


def _throttled(retry_after=None):
    headers = {"Retry-After": str(retry_after)} if retry_after is not None else {}
    return _FakeResponse(429, {}, headers)


class _WikidataTestBase(unittest.TestCase):
    """Neutralizes pacing and the per-run budget so each test starts clean."""

    def setUp(self):
        self.sleeps = []
        self._sleep_patch = patch.object(wikidata, "_sleep", self.sleeps.append)
        self._sleep_patch.start()
        self.addCleanup(self._sleep_patch.stop)

        # A limiter wide enough never to pace inside a test. Pacing itself is
        # covered by RateLimiterTest against a fresh instance.
        self._prev_limiter = wikidata._RATE_LIMITER
        wikidata._RATE_LIMITER = wikidata._SlidingWindowLimiter(10_000, 60.0)
        self.addCleanup(lambda: setattr(wikidata, "_RATE_LIMITER", self._prev_limiter))

        wikidata.reset_run_fetch_budget()
        self.addCleanup(wikidata.reset_run_fetch_budget)

        # is_valid_company consults the indexed-name set on an ambiguous verdict.
        self._prev_indexed = wikidata._INDEXED_NAMES_CACHE
        self.addCleanup(
            lambda: setattr(wikidata, "_INDEXED_NAMES_CACHE", self._prev_indexed))

    def script(self, *responses):
        fake = _ScriptedGet(responses)
        p = patch.object(wikidata.requests, "get", fake)
        p.start()
        self.addCleanup(p.stop)
        return fake


# ---------------------------------------------------------------------------
# 1. Retry-After is honored, in full
# ---------------------------------------------------------------------------
class RetryAfterTest(_WikidataTestBase):

    def test_retry_after_seconds_is_waited_in_full(self):
        """A 429 carrying Retry-After: 58 waits 58s, not the 1s backoff."""
        fake = self.script(
            _throttled(58),
            _ok([{"label": "Truist Financial", "description": "American bank holding company"}]),
        )
        result = wikidata._lookup_wikidata("Truist Financial")

        self.assertEqual(self.sleeps, [58.0],
                         "Retry-After must be honored in full, never shortened")
        self.assertEqual(fake.call_count, 2)
        self.assertEqual(result.status, wikidata.STATUS_OK)
        self.assertEqual(result.description, "american bank holding company")

    def test_retry_after_never_shorter_than_the_backoff(self):
        """Retry-After: 0 still backs off. Honoring the header means never
        waiting LESS than it asks; it does not mean hammering when it says 0."""
        self.script(_throttled(0), _ok([{"label": "Acme", "description": "company"}]))
        wikidata._lookup_wikidata("Acme")

        self.assertEqual(len(self.sleeps), 1)
        self.assertGreaterEqual(self.sleeps[0], wikidata._BACKOFF_BASE_SECONDS)

    def test_retry_after_http_date_form_is_parsed(self):
        """RFC 7231 allows an HTTP-date instead of delta-seconds."""
        when = datetime.now(timezone.utc) + timedelta(seconds=30)
        fake = self.script(
            _FakeResponse(429, {}, {"Retry-After": format_datetime(when)}),
            _ok([{"label": "Acme", "description": "company"}]),
        )
        result = wikidata._lookup_wikidata("Acme")

        self.assertEqual(fake.call_count, 2)
        self.assertEqual(len(self.sleeps), 1)
        self.assertTrue(25 <= self.sleeps[0] <= 31, f"slept {self.sleeps[0]}")
        self.assertEqual(result.status, wikidata.STATUS_OK)

    def test_retry_after_above_the_ceiling_gives_up_without_sleeping(self):
        """An hour-long Retry-After is honored by NOT retrying rather than by
        holding the pipeline for an hour. It never sleeps a shortened amount."""
        fake = self.script(_throttled(3600))
        result = wikidata._lookup_wikidata("Acme")

        self.assertEqual(fake.call_count, 1)
        self.assertEqual(self.sleeps, [])
        self.assertEqual(result.status, wikidata.STATUS_FAILED)

    def test_backoff_is_exponential_and_attempts_are_bounded(self):
        """No Retry-After header: 1s then 2s, then stop. Three attempts total."""
        fake = self.script(_throttled(), _throttled(), _throttled())
        result = wikidata._lookup_wikidata("Acme")

        self.assertEqual(fake.call_count, wikidata._MAX_ATTEMPTS)
        self.assertEqual(self.sleeps, [1.0, 2.0])
        self.assertEqual(result.status, wikidata.STATUS_FAILED)

    def test_transport_error_retries_then_fails(self):
        """A timeout is a failure to ask, not an answer of 'no such entity'."""
        fake = self.script(
            OSError("Read timed out"),
            _ok([{"label": "Acme", "description": "american company"}]),
        )
        result = wikidata._lookup_wikidata("Acme")

        self.assertEqual(fake.call_count, 2)
        self.assertEqual(self.sleeps, [1.0])
        self.assertEqual(result.status, wikidata.STATUS_OK)


# ---------------------------------------------------------------------------
# 2. A failed fetch is NEVER cached. This is the core of the bug.
# ---------------------------------------------------------------------------
class FailedFetchIsNeverCachedTest(_WikidataTestBase):

    def test_exhausted_429s_write_no_cache_row(self):
        wikidata._INDEXED_NAMES_CACHE = set()
        sb = _FakeSupabase()
        self.script(_throttled(1), _throttled(1), _throttled(1))

        wikidata.is_valid_company("Some Unknown Manufacturer", sb)

        self.assertEqual(sb.upserts, [],
                         "a throttled fetch must leave NO row in wikidata_entity_cache")

    def test_transport_failure_writes_no_cache_row(self):
        wikidata._INDEXED_NAMES_CACHE = set()
        sb = _FakeSupabase()
        self.script(OSError("connection reset"), OSError("connection reset"),
                    OSError("connection reset"))

        wikidata.is_valid_company("Some Unknown Manufacturer", sb)

        self.assertEqual(sb.upserts, [])

    def test_unparseable_body_writes_no_cache_row(self):
        wikidata._INDEXED_NAMES_CACHE = set()
        sb = _FakeSupabase()
        self.script(_FakeResponse(200, bad_json=True))

        wikidata.is_valid_company("Some Unknown Manufacturer", sb)

        self.assertEqual(sb.upserts, [])

    def test_failed_fetch_keeps_an_indexed_company_for_this_run(self):
        """The in-run decision falls back to the ambiguous policy: an already
        indexed company is kept. Nothing is persisted either way."""
        wikidata._INDEXED_NAMES_CACHE = {wikidata._normalize_company_name("Truist Financial")}
        sb = _FakeSupabase()
        self.script(_throttled(1), _throttled(1), _throttled(1))

        self.assertTrue(wikidata.is_valid_company("Truist Financial", sb))
        self.assertEqual(sb.upserts, [])

    def test_second_query_of_the_ladder_is_not_attempted_after_a_failure(self):
        """A failed verbatim query short-circuits: we cannot tell a real miss
        from a throttled one, so we do not spend a second call on the stripped
        form and we do not produce a verdict."""
        fake = self.script(_throttled(1), _throttled(1), _throttled(1))
        result = wikidata._lookup_wikidata("Truist Financial Corporation")

        self.assertEqual(fake.call_count, wikidata._MAX_ATTEMPTS)
        self.assertEqual(set(fake.queries), {"Truist Financial Corporation"})
        self.assertEqual(result.status, wikidata.STATUS_FAILED)


# ---------------------------------------------------------------------------
# 3. A genuine no-result IS cached, and cached correctly.
# ---------------------------------------------------------------------------
class NoResultIsCachedTest(_WikidataTestBase):

    def test_empty_search_caches_a_null_description(self):
        """Wikidata answered 'nothing found'. That is real information about the
        name and is exactly what the cache is for."""
        wikidata._INDEXED_NAMES_CACHE = set()
        sb = _FakeSupabase()
        self.script(_empty())

        wikidata.is_valid_company("Blibbet Widgets", sb)

        self.assertEqual(len(sb.upserts), 1)
        self.assertEqual(sb.upserts[0], {
            "name": "Blibbet Widgets",
            "wikidata_description": None,
            "is_company": None,
        })

    def test_no_result_plus_abstract_name_caches_a_false_verdict(self):
        """The name-shape heuristic still applies on a genuine no-result."""
        sb = _FakeSupabase()
        self.script(_empty())

        wikidata.is_valid_company("Semiconductor makers", sb)

        self.assertEqual(len(sb.upserts), 1)
        self.assertIs(sb.upserts[0]["is_company"], False)
        self.assertIsNone(sb.upserts[0]["wikidata_description"])

    def test_an_answered_description_is_cached_with_its_verdict(self):
        sb = _FakeSupabase()
        self.script(_ok([{"label": "Truist Financial",
                          "description": "American bank holding company"}]))

        self.assertTrue(wikidata.is_valid_company("Truist Financial", sb))
        self.assertEqual(sb.upserts, [{
            "name": "Truist Financial",
            "wikidata_description": "american bank holding company",
            "is_company": True,
        }])

    def test_top_n_results_with_no_label_match_cache_as_no_result(self):
        """Wikidata answered, but nothing it returned actually names this
        company. That is a no-result, not a failure, so it is cacheable."""
        wikidata._INDEXED_NAMES_CACHE = set()
        sb = _FakeSupabase()
        self.script(
            _ok([{"label": "Raintree County", "description": "1957 American film"}]),
        )

        wikidata.is_valid_company("Raintree", sb)

        self.assertEqual(len(sb.upserts), 1)
        self.assertIsNone(sb.upserts[0]["wikidata_description"])


# ---------------------------------------------------------------------------
# 4. Top-N scanning with a label check.
# ---------------------------------------------------------------------------
class LabelCheckTest(_WikidataTestBase):

    def test_unrelated_top_n_company_is_rejected(self):
        """THE regression this check exists for. 'Coca-Cola' returns Coca-Cola
        Europacific Partners, which is a real company, classifies True, and is
        the WRONG company. A naive 'any True in the top N' scan admits it."""
        results = [
            {"label": "Coca-Cola Europacific Partners",
             "description": "British multinational bottling company"},
            {"label": "Coca-Cola HBC", "description": "Swiss bottling company"},
        ]
        self.assertIsNone(wikidata._pick_description(results, wikidata._normalize_label("Coca-Cola")))

    def test_unrelated_top_n_non_company_is_rejected(self):
        results = [{"label": "Raintree County", "description": "1957 American film"}]
        self.assertIsNone(wikidata._pick_description(results, wikidata._normalize_label("Raintree")))

    def test_exact_label_match_beats_a_longer_sibling_earlier_in_the_list(self):
        results = [
            {"label": "Coca-Cola Europacific Partners",
             "description": "British multinational bottling company"},
            {"label": "The Coca-Cola Company",
             "description": "American multinational beverage corporation"},
        ]
        self.assertEqual(
            wikidata._pick_description(results, wikidata._normalize_label("Coca-Cola")),
            "american multinational beverage corporation")

    def test_top_n_recovers_a_match_below_result_zero(self):
        """The reason to scan past result[0] at all: the right company is third."""
        results = [
            {"label": "Truist Park", "description": "baseball stadium in Atlanta"},
            {"label": "Truist Insurance Holdings", "description": "insurance brokerage"},
            {"label": "Truist Financial", "description": "American bank holding company"},
        ]
        self.assertEqual(
            wikidata._pick_description(results, wikidata._normalize_label("Truist Financial")),
            "american bank holding company")

    def test_an_alias_counts_as_a_label(self):
        results = [{"label": "Meta Platforms",
                    "aliases": ["Facebook, Inc."],
                    "description": "American technology conglomerate"}]
        self.assertEqual(
            wikidata._pick_description(results, wikidata._normalize_label("Facebook")),
            "american technology conglomerate")

    def test_label_match_with_no_description_is_still_a_match(self):
        """Preserves the old empty-string-is-ambiguous behavior rather than
        silently downgrading a real entity to a no-result."""
        results = [{"label": "Acme Holdings"}]
        self.assertEqual(wikidata._pick_description(results, wikidata._normalize_label("Acme")), "")

    def test_normalize_label_equivalences(self):
        norm = wikidata._normalize_label
        self.assertEqual(norm("Truist Financial Corporation"), norm("Truist Financial"))
        self.assertEqual(norm("The Coca-Cola Company"), norm("Coca-Cola"))
        self.assertEqual(norm("O'Reilly Automotive, Inc."), norm("O'Reilly Automotive"))
        self.assertEqual(norm("Barclays PLC"), norm("Barclays"))
        self.assertNotEqual(norm("Coca-Cola Europacific Partners"), norm("Coca-Cola"))
        self.assertNotEqual(norm("Raintree County"), norm("Raintree"))
        self.assertEqual(norm("Inc"), "inc", "a bare legal token must not normalize to empty")

    def test_end_to_end_wrong_top_hit_does_not_become_a_company_verdict(self):
        wikidata._INDEXED_NAMES_CACHE = set()
        sb = _FakeSupabase()
        self.script(_ok([{"label": "Coca-Cola Europacific Partners",
                          "description": "British multinational bottling company"}]))

        wikidata.is_valid_company("Raintree", sb)

        self.assertEqual(len(sb.upserts), 1)
        self.assertIsNot(sb.upserts[0]["is_company"], True,
                         "an unrelated top-N hit must never mint a True verdict")


# ---------------------------------------------------------------------------
# 5. Query suffix-stripping.
# ---------------------------------------------------------------------------
class QuerySuffixStrippingTest(_WikidataTestBase):

    def test_strips_the_documented_zero_hit_names(self):
        cases = {
            "Truist Financial Corporation": "Truist Financial",
            "O'Reilly Automotive, Inc.": "O'Reilly Automotive",
            "Republic Services, Inc.": "Republic Services",
            "Howmet Aerospace Inc.": "Howmet Aerospace",
            "Murphy USA Inc.": "Murphy USA",
            "Corpay, Inc.": "Corpay",
            "Nordea Bank Abp Ltd": "Nordea Bank Abp",
        }
        for raw, want in cases.items():
            self.assertEqual(wikidata._strip_query_suffix(raw), want, raw)

    def test_returns_none_when_there_is_nothing_to_strip(self):
        for raw in ("Snowflake", "Coca-Cola", "Murphy USA"):
            self.assertIsNone(wikidata._strip_query_suffix(raw), raw)

    def test_never_strips_a_name_down_to_nothing(self):
        for raw in ("Inc", "Corp", "Co"):
            self.assertIsNone(wikidata._strip_query_suffix(raw), raw)

    def test_ladder_retries_the_stripped_form_after_a_genuine_zero_hit(self):
        """'Truist Financial Corporation' returns 0 hits; 'Truist Financial'
        returns the bank. Two calls, verbatim first."""
        fake = self.script(
            _empty(),
            _ok([{"label": "Truist Financial",
                  "description": "American bank holding company"}]),
        )
        result = wikidata._lookup_wikidata("Truist Financial Corporation")

        self.assertEqual(fake.queries, ["Truist Financial Corporation", "Truist Financial"])
        self.assertEqual(result.status, wikidata.STATUS_OK)
        self.assertEqual(result.description, "american bank holding company")

    def test_ladder_retries_when_the_first_query_hits_only_wrong_labels(self):
        fake = self.script(
            _ok([{"label": "Truist Park", "description": "baseball stadium"}]),
            _ok([{"label": "Truist Financial", "description": "American bank holding company"}]),
        )
        result = wikidata._lookup_wikidata("Truist Financial Corporation")

        self.assertEqual(fake.call_count, 2)
        self.assertEqual(result.status, wikidata.STATUS_OK)

    def test_no_second_call_when_the_verbatim_query_already_matched(self):
        fake = self.script(_ok([{"label": "Truist Financial Corporation",
                                 "description": "American bank holding company"}]))
        wikidata._lookup_wikidata("Truist Financial Corporation")
        self.assertEqual(fake.call_count, 1)

    def test_no_second_call_for_a_name_with_no_legal_suffix(self):
        fake = self.script(_empty())
        result = wikidata._lookup_wikidata("Blibbet Widgets")
        self.assertEqual(fake.call_count, 1)
        self.assertEqual(result.status, wikidata.STATUS_NO_RESULT)


# ---------------------------------------------------------------------------
# 6. Pacing and the per-run budget.
# ---------------------------------------------------------------------------
class RateLimiterTest(unittest.TestCase):

    def test_burst_up_to_the_window_is_free_then_paced(self):
        slept = []
        with patch.object(wikidata, "_sleep", slept.append):
            limiter = wikidata._SlidingWindowLimiter(3, 60.0)
            self.assertEqual([limiter.acquire() for _ in range(3)], [0.0, 0.0, 0.0])
            fourth = limiter.acquire()

        self.assertGreater(fourth, 55.0, "the 4th call in a 3-per-minute window must wait")
        self.assertEqual(len(slept), 1, "acquire sleeps at most once, it must not spin")

    def test_default_pacing_sits_inside_the_measured_budget(self):
        """Measured anonymous budget is 10 to 11 successful calls per ~52s
        window. Anything above 11/min reproduces the 429s this lane fixes."""
        self.assertLessEqual(wikidata._DEFAULT_CALLS_PER_WINDOW, 11)
        self.assertEqual(wikidata._RATE_WINDOW_SECONDS, 60.0)

    def test_search_limit_is_greater_than_one(self):
        self.assertGreater(wikidata._SEARCH_LIMIT, 1, "top-N scanning requires limit > 1")


class RunBudgetTest(_WikidataTestBase):

    def test_budget_exhaustion_stops_calling_out_and_caches_nothing(self):
        wikidata._INDEXED_NAMES_CACHE = set()
        sb = _FakeSupabase()
        fake = self.script(_empty())

        with patch.object(wikidata, "_MAX_CALLS_PER_RUN", 1):
            wikidata.reset_run_fetch_budget()
            wikidata.is_valid_company("First Name", sb)      # spends the budget
            wikidata.is_valid_company("Second Name", sb)     # over budget

        self.assertEqual(fake.call_count, 1, "no outbound call once the budget is spent")
        self.assertEqual([u["name"] for u in sb.upserts], ["First Name"],
                         "the over-budget name must be left uncached, not cached as a verdict")

    def test_reset_restores_the_budget(self):
        with patch.object(wikidata, "_MAX_CALLS_PER_RUN", 1):
            self.assertTrue(wikidata._claim_fetch_budget())
            self.assertFalse(wikidata._claim_fetch_budget())
            wikidata.reset_run_fetch_budget()
            self.assertTrue(wikidata._claim_fetch_budget())


# ---------------------------------------------------------------------------
# 7. Cache-hit path is unchanged and costs no network call.
# ---------------------------------------------------------------------------
class CacheHitTest(_WikidataTestBase):

    def test_cache_hit_makes_no_outbound_call(self):
        sb = _FakeSupabase({"Blackstone": {
            "is_company": True,
            "wikidata_description": "american alternative investment company"}})
        fake = self.script()

        self.assertTrue(wikidata.is_valid_company("Blackstone", sb))
        self.assertEqual(fake.call_count, 0)
        self.assertEqual(sb.upserts, [])


if __name__ == "__main__":
    unittest.main()
