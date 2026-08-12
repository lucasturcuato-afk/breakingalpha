"""Unit tests for the ingest observability instrumentation in backend/ingest.py.

The whole point of this change is that it is ADDITIVE: it counts and labels what
ingest already dropped, without moving a single article across the line. So the
central tests here are equivalence tests -- the instrumented gate against the
original compound predicate, over a case matrix that includes every drop shape.

Covers:
  1. Ingest gate: the three drop buckets partition the drops exactly, and the
     passing set is identical to the pre-change predicate.
  2. Grade source: every apply_relevance_grade branch stamps a marker, the
     grader-failure path is labelled legacy_fallback while still retaining the
     legacy score, and the run tally matches.
  3. gnews freshness: stale and no-link/title entries are counted, the counts
     reconcile against entries seen, and the kept set is unchanged.
  4. _article_row only emits the new column when the probe says it exists.

NO production Gemini or Supabase calls are made. Mirrors test_relevance_grade.py's
hard env override so a real key in the shell can never leak in.

Run:
    python -m unittest backend.tests.test_ingest_observability
"""

import os
import sys
import unittest
from datetime import datetime, timezone, timedelta
from unittest.mock import patch

# Hard override (NOT setdefault) so a real key in the shell can never leak in.
for _k, _v in {
    "GEMINI_API_KEY": "dummy-gemini-key-not-used",
    "SUPABASE_URL": "http://localhost:54321",
    "SUPABASE_SERVICE_ROLE_KEY": "dummy-service-role-not-used",
    "SUPABASE_ANON_KEY": "dummy-anon-not-used",
    "NEWS_API_KEY": "dummy-news-key-not-used",
    "FINNHUB_API_KEY": "dummy-finnhub-key-not-used",
    "FILTER_MAX_RATE_RETRIES": "2",
    "FILTER_PHASE_BUDGET_SEC": "100000",
    "FILTER_PARALLEL_WORKERS": "2",
}.items():
    os.environ[_k] = _v

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import ingest  # noqa: E402


def _legacy_result(score=8, relevant=True):
    return {
        "relevant": relevant,
        "relevance_score": score,
        "relevance_reason": "Material first-order event with figures.",
        "sentiment": "neutral",
        "companies": [],
    }


def _sec_result(score=6):
    r = _legacy_result(score)
    r["relevance_reason"] = "SEC 8-K filing by Acme (deterministic SEC bypass)"
    return r


# ---------------------------------------------------------------------------
# 1. Ingest gate: classification is exhaustive and pass/drop is unchanged
# ---------------------------------------------------------------------------
def _original_gate(results, gate):
    """The gate predicate EXACTLY as it read before instrumentation. The
    instrumented loop must agree with this on every input."""
    return [
        i for i, result in enumerate(results)
        if result and result.get("relevant") and result.get("relevance_score", 0) >= gate
    ]


def _instrumented_gate(results, gate):
    """The instrumented classification, mirroring run_ingestion's loop. Returns
    (passed_indices, dropped_by_reason)."""
    dropped = {"result_none": 0, "relevant_falsy": 0, "below_gate": 0}
    passed = []
    for i, result in enumerate(results):
        if not result:
            dropped["result_none"] += 1
            continue
        if not result.get("relevant"):
            dropped["relevant_falsy"] += 1
            continue
        if result.get("relevance_score", 0) < gate:
            dropped["below_gate"] += 1
            continue
        passed.append(i)
    return passed, dropped


class IngestGateClassificationTest(unittest.TestCase):
    #: Every drop shape the gate can see, plus the pass shapes.
    CASES = [
        None,                                    # filter returned nothing
        {},                                      # falsy dict: also result_none
        _legacy_result(9, relevant=False),       # high score but not relevant
        _legacy_result(0, relevant=False),       # not relevant, floor score
        _legacy_result(0),                       # relevant, below any gate >= 1
        _legacy_result(1),                       # relevant, exactly the new gate
        _legacy_result(5),                       # relevant, below the legacy gate
        _legacy_result(6),                       # relevant, exactly the legacy gate
        _legacy_result(10),                      # relevant, top of the range
        {"relevant": True},                      # no relevance_score key -> .get default 0
    ]

    def test_matches_original_predicate_on_every_gate(self):
        for gate in (0, 1, 6, 10):
            with self.subTest(gate=gate):
                expected = _original_gate(self.CASES, gate)
                passed, _ = _instrumented_gate(self.CASES, gate)
                self.assertEqual(passed, expected)

    def test_buckets_partition_the_drops_exactly(self):
        for gate in (0, 1, 6, 10):
            with self.subTest(gate=gate):
                passed, dropped = _instrumented_gate(self.CASES, gate)
                self.assertEqual(
                    len(passed) + sum(dropped.values()), len(self.CASES),
                    "every candidate must land in exactly one bucket",
                )

    def test_reasons_are_attributed_to_the_right_bucket(self):
        _, dropped = _instrumented_gate(self.CASES, 6)
        # None and {} are both falsy results.
        self.assertEqual(dropped["result_none"], 2)
        # Two relevant=False rows, regardless of their score.
        self.assertEqual(dropped["relevant_falsy"], 2)
        # relevant rows scoring 0, 1, 5 and the score-less {"relevant": True}.
        self.assertEqual(dropped["below_gate"], 4)

    def test_gate_of_one_keeps_everything_with_any_signal(self):
        """The production gate under RELEVANCE_GRADE_MODE=new. Only the true-0
        floor and the not-relevant rows drop; nothing else moves."""
        passed, dropped = _instrumented_gate(self.CASES, 1)
        self.assertEqual(dropped["below_gate"], 2)   # score 0 and the score-less row
        self.assertEqual(len(passed), 4)             # scores 1, 5, 6, 10


# ---------------------------------------------------------------------------
# 2. Grade source marker + run tally
# ---------------------------------------------------------------------------
class GradeSourceMarkerTest(unittest.TestCase):
    def setUp(self):
        self._mode = ingest.RELEVANCE_GRADE_MODE
        self._rate = ingest.RELEVANCE_GRADE_SHADOW_SAMPLE_RATE
        self._skip = ingest.GRADER_SKIP_IRRELEVANT
        ingest._reset_grade_source_tally()

    def tearDown(self):
        ingest.RELEVANCE_GRADE_MODE = self._mode
        ingest.RELEVANCE_GRADE_SHADOW_SAMPLE_RATE = self._rate
        ingest.GRADER_SKIP_IRRELEVANT = self._skip
        ingest._reset_grade_source_tally()

    _ARTICLE = {"title": "X", "summary": "", "source": "Yahoo", "url": "u"}

    def test_grader_failure_retains_legacy_score_and_is_labelled(self):
        """The defect this exists to fix: on a grader failure the legacy score is
        kept (unchanged behaviour) but the row now says where the score came
        from."""
        ingest.RELEVANCE_GRADE_MODE = "new"
        ingest.GRADER_SKIP_IRRELEVANT = 0
        result = _legacy_result(8)
        with patch.object(ingest, "grade_relevance", return_value=None):
            out = ingest.apply_relevance_grade(self._ARTICLE, result)
        self.assertEqual(out["relevance_score"], 8)  # behaviour unchanged
        self.assertEqual(out[ingest.GRADE_SOURCE_KEY], ingest.GRADE_SOURCE_LEGACY_FALLBACK)
        self.assertEqual(ingest._grade_source_snapshot(),
                         {ingest.GRADE_SOURCE_LEGACY_FALLBACK: 1})

    def test_grader_success_is_labelled_grader(self):
        ingest.RELEVANCE_GRADE_MODE = "new"
        ingest.GRADER_SKIP_IRRELEVANT = 0
        result = _legacy_result(8)
        with patch.object(ingest, "grade_relevance",
                          return_value={"score": 3, "band": "context", "reason": "r"}):
            out = ingest.apply_relevance_grade(self._ARTICLE, result)
        self.assertEqual(out["relevance_score"], 3)  # grade applied, as before
        self.assertEqual(out[ingest.GRADE_SOURCE_KEY], ingest.GRADE_SOURCE_GRADER)

    def test_sec_bypass_is_labelled_and_never_graded(self):
        ingest.RELEVANCE_GRADE_MODE = "new"
        result = _sec_result(6)
        with patch.object(ingest, "grade_relevance",
                          side_effect=AssertionError("must not grade SEC")):
            out = ingest.apply_relevance_grade(self._ARTICLE, result)
        self.assertEqual(out["relevance_score"], 6)
        self.assertEqual(out[ingest.GRADE_SOURCE_KEY], ingest.GRADE_SOURCE_SEC_PINNED)

    def test_cost_guard_skip_is_labelled(self):
        ingest.RELEVANCE_GRADE_MODE = "new"
        ingest.GRADER_SKIP_IRRELEVANT = 1
        result = _legacy_result(9, relevant=False)
        with patch.object(ingest, "grade_relevance",
                          side_effect=AssertionError("must not grade")):
            out = ingest.apply_relevance_grade(self._ARTICLE, result)
        self.assertEqual(out[ingest.GRADE_SOURCE_KEY], ingest.GRADE_SOURCE_LEGACY_SKIP)

    def test_shadow_is_labelled_legacy_even_when_the_shadow_grade_succeeds(self):
        """Shadow never mutates the stored score, so its provenance is legacy
        whether or not the shadow call worked."""
        ingest.RELEVANCE_GRADE_MODE = "shadow"
        ingest.RELEVANCE_GRADE_SHADOW_SAMPLE_RATE = 1.0
        result = _legacy_result(8)
        with patch.object(ingest, "grade_relevance",
                          return_value={"score": 2, "band": "noise", "reason": "r"}):
            out = ingest.apply_relevance_grade(self._ARTICLE, result)
        self.assertEqual(out["relevance_score"], 8)  # shadow writes nothing
        self.assertEqual(out[ingest.GRADE_SOURCE_KEY], ingest.GRADE_SOURCE_LEGACY_MODE)

    def test_legacy_mode_is_labelled_and_still_does_not_grade(self):
        ingest.RELEVANCE_GRADE_MODE = "legacy"
        result = _legacy_result(8)
        with patch.object(ingest, "grade_relevance",
                          side_effect=AssertionError("must not grade")):
            out = ingest.apply_relevance_grade(self._ARTICLE, result)
        self.assertEqual(out["relevance_score"], 8)
        self.assertEqual(out[ingest.GRADE_SOURCE_KEY], ingest.GRADE_SOURCE_LEGACY_MODE)

    def test_none_result_stays_none_and_tallies_nothing(self):
        ingest.RELEVANCE_GRADE_MODE = "new"
        self.assertIsNone(ingest.apply_relevance_grade(self._ARTICLE, None))
        self.assertEqual(ingest._grade_source_snapshot(), {})

    def test_tally_sums_across_a_mixed_batch(self):
        ingest.RELEVANCE_GRADE_MODE = "new"
        ingest.GRADER_SKIP_IRRELEVANT = 0
        good = {"score": 4, "band": "context", "reason": "r"}
        # Two graded, three fallbacks, one SEC.
        with patch.object(ingest, "grade_relevance", side_effect=[good, None, good, None, None]):
            for _ in range(5):
                ingest.apply_relevance_grade(self._ARTICLE, _legacy_result(8))
            ingest.apply_relevance_grade(self._ARTICLE, _sec_result(6))
        self.assertEqual(ingest._grade_source_snapshot(), {
            ingest.GRADE_SOURCE_GRADER: 2,
            ingest.GRADE_SOURCE_LEGACY_FALLBACK: 3,
            ingest.GRADE_SOURCE_SEC_PINNED: 1,
        })

    def test_marker_never_raises_into_the_grading_path(self):
        """_mark_grade_source is best-effort: an unstampable result must not take
        the grade down with it."""
        ingest._mark_grade_source(object(), ingest.GRADE_SOURCE_GRADER)  # no dict support
        self.assertEqual(ingest._grade_source_snapshot(), {})


# ---------------------------------------------------------------------------
# 3. gnews freshness counters
# ---------------------------------------------------------------------------
class _FakeFeed:
    def __init__(self, entries):
        self.entries = entries


def _entry(title="T", link="http://example.com/a", published=None):
    e = {"title": title, "link": link, "summary": "s"}
    if published is not None:
        e["published"] = published
    return e


class GnewsFreshnessCountersTest(unittest.TestCase):
    def _run(self, entries):
        with patch.object(ingest, "_fetch_feed_bytes", return_value=b""), \
             patch.object(ingest.feedparser, "parse", return_value=_FakeFeed(entries)):
            return ingest._fetch_single_gnews_feed("AAPL")

    def test_stale_entries_are_counted_not_just_dropped(self):
        now = datetime.now(timezone.utc)
        stale = (now - timedelta(days=ingest.INGEST_FRESHNESS_DAYS + 3)).isoformat()
        fresh = (now - timedelta(hours=2)).isoformat()
        articles, stats = self._run([
            _entry("fresh one", "http://x/1", fresh),
            _entry("stale one", "http://x/2", stale),
            _entry("stale two", "http://x/3", stale),
        ])
        self.assertEqual(len(articles), 1)          # drop behaviour unchanged
        self.assertEqual(stats["skipped_stale"], 2)
        self.assertEqual(stats["entries"], 3)

    def test_missing_link_or_title_is_counted(self):
        articles, stats = self._run([
            _entry("has both", "http://x/1"),
            _entry("no link", ""),
            _entry("", "http://x/3"),
        ])
        self.assertEqual(len(articles), 1)
        self.assertEqual(stats["skipped_no_link_or_title"], 2)

    def test_counts_reconcile_against_entries_seen(self):
        now = datetime.now(timezone.utc)
        stale = (now - timedelta(days=30)).isoformat()
        articles, stats = self._run([
            _entry("kept", "http://x/1", (now - timedelta(hours=1)).isoformat()),
            _entry("no date kept", "http://x/2"),                 # missing date -> let through
            _entry("bad date kept", "http://x/3", "not-a-date"),  # unparseable -> let through
            _entry("stale", "http://x/4", stale),
            _entry("no link", ""),
        ])
        self.assertEqual(len(articles), 3)
        self.assertEqual(
            stats["entries"],
            len(articles) + stats["skipped_stale"] + stats["skipped_no_link_or_title"],
        )

    def test_a_dead_feed_reports_zero_kept_with_a_nonzero_stale_count(self):
        """The regression shape: the fetch succeeds, the ticker contributes
        nothing, and until now that produced no signal at all."""
        stale = (datetime.now(timezone.utc) - timedelta(days=90)).isoformat()
        articles, stats = self._run([_entry(f"old {i}", f"http://x/{i}", stale) for i in range(5)])
        self.assertEqual(articles, [])
        self.assertEqual(stats["skipped_stale"], 5)

    def test_fetch_failure_still_returns_a_stats_dict(self):
        with patch.object(ingest, "_fetch_feed_bytes", side_effect=RuntimeError("boom")):
            articles, stats = ingest._fetch_single_gnews_feed("AAPL")
        self.assertEqual(articles, [])
        self.assertEqual(stats["entries"], 0)


# ---------------------------------------------------------------------------
# 4. _article_row column probe
# ---------------------------------------------------------------------------
class ArticleRowGradeSourceTest(unittest.TestCase):
    _ARTICLE = {
        "title": "T", "summary": "s", "url": "http://x/1", "source": "Yahoo",
        "published_at": None, "content_type": "snippet",
    }

    def _analysis(self, source=None):
        a = {"relevance_score": 7, "relevance_reason": "r", "companies": [],
             "themes": [], "sentiment": "neutral"}
        if source is not None:
            a[ingest.GRADE_SOURCE_KEY] = source
        return a

    def test_column_omitted_when_the_probe_says_it_is_missing(self):
        """Before sql/0026 lands, including the column would 400 the whole insert
        batch. It must simply not be in the row."""
        with patch.object(ingest, "_grade_source_column_available", return_value=False), \
             patch.object(ingest, "_publisher_columns_available", return_value=False):
            row = ingest._article_row(self._ARTICLE, self._analysis("grader"), [])
        self.assertNotIn("relevance_grade_source", row)

    def test_column_written_when_available(self):
        with patch.object(ingest, "_grade_source_column_available", return_value=True), \
             patch.object(ingest, "_publisher_columns_available", return_value=False):
            row = ingest._article_row(
                self._ARTICLE, self._analysis(ingest.GRADE_SOURCE_LEGACY_FALLBACK), []
            )
        self.assertEqual(row["relevance_grade_source"], ingest.GRADE_SOURCE_LEGACY_FALLBACK)

    def test_unstamped_analysis_stays_null_rather_than_being_guessed(self):
        with patch.object(ingest, "_grade_source_column_available", return_value=True), \
             patch.object(ingest, "_publisher_columns_available", return_value=False):
            row = ingest._article_row(self._ARTICLE, self._analysis(None), [])
        self.assertIsNone(row["relevance_grade_source"])


if __name__ == "__main__":
    unittest.main()
