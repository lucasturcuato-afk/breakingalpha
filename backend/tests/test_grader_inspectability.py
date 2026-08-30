"""The grader's verdict survives to the store, and its rejects reach the log.

Two gaps, both of which made a false negative unauditable:

  1. grade_relevance() returns {"score", "band", "reason"} on every call. Only
     the score was kept. The band was set on the in-memory result and written
     nowhere; the reason was discarded at the call site. The reason that IS
     stored, relevance_reason, comes from the FILTER -- a different model on a
     different prompt -- and under RELEVANCE_GRADE_MODE=new it sits beside a
     score the grader has since replaced.

  2. An article scored below the gate is dropped, so no row exists, and the gate
     loop prints only on the PASS branch. There was no record anywhere of what
     the largest filter in the pipeline discards.

Neither change may touch the gate. That is asserted, not assumed.
"""

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "stub")
os.environ.setdefault("SUPABASE_ANON_KEY", "stub")
os.environ.setdefault("GEMINI_API_KEY", "stub")

BACKEND = Path(__file__).resolve().parent.parent
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

import ingest  # noqa: E402

SOURCE = (BACKEND / "ingest.py").read_text()
SQL = BACKEND.parent / "sql" / "0034_articles_relevance_grade_explanation.sql"


def _article(title="Some headline", publisher="Reuters"):
    return {"title": title, "summary": "", "source": "feed", "publisher": publisher}


def _graded(score=1, band="template/junk", reason="Price recap, no new fact."):
    return {"score": score, "band": band, "reason": reason}


# ---------------------------------------------------------------------------
# 1. The grade is stamped onto the result
# ---------------------------------------------------------------------------
class StampTest(unittest.TestCase):
    def _apply(self, grade, result=None):
        result = result or {"relevant": True, "relevance_score": 8,
                            "relevance_reason": "filter said so"}
        with patch.object(ingest, "RELEVANCE_GRADE_MODE", "new"), \
             patch.object(ingest, "grade_relevance", return_value=grade):
            return ingest.apply_relevance_grade(_article(), result)

    def test_reason_is_stamped(self):
        r = self._apply(_graded(reason="Template price recap."))
        self.assertEqual(r[ingest.GRADE_REASON_KEY], "Template price recap.")

    def test_band_is_stamped(self):
        r = self._apply(_graded(band="weak"))
        self.assertEqual(r[ingest.GRADE_BAND_KEY], "weak")

    def test_the_filter_score_is_preserved_before_the_overwrite(self):
        """Under `new` the grader overwrites relevance_score. Without this the
        filter's own number is gone by the time anything can compare them."""
        r = self._apply(_graded(score=1))
        self.assertEqual(r[ingest.LEGACY_SCORE_KEY], 8)
        self.assertEqual(r["relevance_score"], 1)

    def test_the_filter_reason_is_left_alone(self):
        """Two different scorers, two different fields. Neither overwrites the
        other, so the divergence stays visible."""
        r = self._apply(_graded())
        self.assertEqual(r["relevance_reason"], "filter said so")
        self.assertNotEqual(r["relevance_reason"], r[ingest.GRADE_REASON_KEY])

    def test_a_failed_grade_stamps_no_verdict(self):
        r = self._apply(None)
        self.assertIsNone(r.get(ingest.GRADE_REASON_KEY))
        self.assertIsNone(r.get(ingest.GRADE_BAND_KEY))
        self.assertEqual(r[ingest.GRADE_SOURCE_KEY], ingest.GRADE_SOURCE_LEGACY_FALLBACK)

    def test_sec_pinned_is_never_graded_or_stamped(self):
        sec = {"relevant": True, "relevance_score": 10,
               "relevance_reason": "deterministic SEC bypass: 8-K item 5.02"}
        with patch.object(ingest, "RELEVANCE_GRADE_MODE", "new"), \
             patch.object(ingest, "grade_relevance",
                          side_effect=AssertionError("must not grade SEC rows")):
            r = ingest.apply_relevance_grade(_article(), sec)
        self.assertIsNone(r.get(ingest.GRADE_REASON_KEY))
        self.assertEqual(r["relevance_score"], 10)

    def test_the_score_and_the_gate_are_untouched_by_the_stamping(self):
        """The stamp is additive. The number the gate reads must not move."""
        r = self._apply(_graded(score=4))
        self.assertEqual(r["relevance_score"], 4)
        self.assertIs(r["relevant"], True)


# ---------------------------------------------------------------------------
# 2. The row carries it, behind the hand-apply probe
# ---------------------------------------------------------------------------
class RowTest(unittest.TestCase):
    ANALYSIS = {
        "relevance_score": 1,
        "relevance_reason": "filter reason",
        ingest.GRADE_REASON_KEY: "grader reason",
        ingest.GRADE_BAND_KEY: "template/junk",
        "industry_verticals": [], "activity_types": [], "companies": [],
    }
    ART = {"title": "T", "summary": "S", "url": "u", "source": "f",
           "published_at": "2026-08-30T00:00:00Z"}

    def _row(self, available):
        with patch.object(ingest, "_grade_explanation_columns_available",
                          return_value=available), \
             patch.object(ingest, "_publisher_columns_available", return_value=False), \
             patch.object(ingest, "_grade_source_column_available", return_value=False):
            return ingest._article_row(self.ART, self.ANALYSIS, [])

    def test_columns_are_written_when_present(self):
        row = self._row(True)
        self.assertEqual(row[ingest.GRADE_REASON_KEY], "grader reason")
        self.assertEqual(row[ingest.GRADE_BAND_KEY], "template/junk")

    def test_columns_are_omitted_before_the_migration_lands(self):
        row = self._row(False)
        self.assertNotIn(ingest.GRADE_REASON_KEY, row)
        self.assertNotIn(ingest.GRADE_BAND_KEY, row)

    def test_the_filter_reason_column_is_unchanged(self):
        self.assertEqual(self._row(True)["relevance_reason"], "filter reason")

    def test_the_in_memory_legacy_score_is_never_a_column(self):
        analysis = dict(self.ANALYSIS, **{ingest.LEGACY_SCORE_KEY: 8})
        with patch.object(ingest, "_grade_explanation_columns_available",
                          return_value=True), \
             patch.object(ingest, "_publisher_columns_available", return_value=False), \
             patch.object(ingest, "_grade_source_column_available", return_value=False):
            row = ingest._article_row(self.ART, analysis, [])
        self.assertNotIn(ingest.LEGACY_SCORE_KEY, row)

    def test_the_migration_is_additive(self):
        sql = SQL.read_text()
        self.assertIn("ADD COLUMN IF NOT EXISTS relevance_grade_reason", sql)
        self.assertIn("ADD COLUMN IF NOT EXISTS relevance_band", sql)
        for destructive in ("DROP COLUMN", "DELETE FROM", "TRUNCATE", "UPDATE public."):
            self.assertNotIn(destructive, sql)


# ---------------------------------------------------------------------------
# 3. The reject log
# ---------------------------------------------------------------------------
def _pair(score, title, dropped_marker=False, publisher="Reuters"):
    a = _article(title=title, publisher=publisher)
    r = {"relevant": True, "relevance_score": score,
         ingest.GRADE_SOURCE_KEY: ingest.GRADE_SOURCE_GRADER,
         ingest.GRADE_BAND_KEY: "template/junk",
         ingest.GRADE_REASON_KEY: f"reason for {title}",
         ingest.LEGACY_SCORE_KEY: 8}
    return a, r


class RejectLogTest(unittest.TestCase):
    def _run(self, pairs, relevant, sample=50, gate=3):
        fresh = [a for a, _ in pairs]
        results = [r for _, r in pairs]
        out = []
        with patch.object(ingest, "GRADER_REJECT_LOG_SAMPLE", sample), \
             patch("builtins.print", lambda *a, **k: out.append(" ".join(map(str, a)))):
            ingest._log_grader_rejects(fresh, results, relevant, gate)
        return out

    def test_low_scores_are_logged(self):
        pairs = [_pair(0, "junk one"), _pair(2, "junk two")]
        lines = [l for l in self._run(pairs, []) if "GRADER_REJECT dropped" in l]
        self.assertEqual(len(lines), 2)

    def test_the_line_carries_every_requested_field(self):
        pairs = [_pair(1, "a price recap", publisher="Benzinga")]
        line = [l for l in self._run(pairs, []) if "GRADER_REJECT dropped" in l][0]
        self.assertIn("grader=1", line)
        self.assertIn("filter=8", line)
        self.assertIn("Benzinga", line)
        self.assertIn("a price recap", line)
        self.assertIn("reason for a price recap", line)
        self.assertIn("band=template/junk", line)

    def test_scores_above_the_window_are_not_logged(self):
        pairs = [_pair(3, "kept"), _pair(9, "good")]
        self.assertEqual([l for l in self._run(pairs, []) if "GRADER_REJECT dropped" in l], [])

    def test_non_grader_rows_are_excluded(self):
        """A legacy-fallback 1 was not the grader's verdict, so it is not
        evidence about the grader."""
        a, r = _pair(1, "fallback")
        r[ingest.GRADE_SOURCE_KEY] = ingest.GRADE_SOURCE_LEGACY_FALLBACK
        self.assertEqual([l for l in self._run([(a, r)], []) if "GRADER_REJECT dropped" in l], [])

    def test_dropped_is_read_from_the_actual_outcome_not_a_second_predicate(self):
        kept, rejected = _pair(1, "kept low"), _pair(1, "dropped low")
        lines = [l for l in self._run([kept, rejected], [kept]) if "GRADER_REJECT dropped" in l]
        by_title = {("kept low" if "kept low" in l else "dropped low"): l for l in lines}
        self.assertIn("dropped=no", by_title["kept low"])
        self.assertIn("dropped=yes", by_title["dropped low"])

    def test_sample_caps_the_output(self):
        pairs = [_pair(1, f"junk {i}") for i in range(500)]
        lines = [l for l in self._run(pairs, [], sample=50) if "GRADER_REJECT dropped" in l]
        self.assertEqual(len(lines), 50)

    def test_sample_strides_across_the_pool_rather_than_taking_the_head(self):
        """Fetch order is source-major, so the first N would be one feed."""
        pairs = [_pair(1, f"junk {i}") for i in range(500)]
        lines = [l for l in self._run(pairs, [], sample=5) if "GRADER_REJECT dropped" in l]
        # anchor on the title field: band=template/junk also contains "junk "
        idx = [int(l.split("title='junk ")[1].split("'")[0]) for l in lines]
        self.assertEqual(idx, [0, 100, 200, 300, 400])

    def test_zero_disables_it(self):
        pairs = [_pair(1, "junk")]
        self.assertEqual(self._run(pairs, [], sample=0), [])

    def test_empty_candidate_pool_says_so_without_failing(self):
        out = self._run([_pair(9, "good")], [])
        self.assertTrue(any("no grader-scored article" in l for l in out))

    def test_it_reports_the_full_population_not_just_the_sample(self):
        pairs = [_pair(1, f"junk {i}") for i in range(200)]
        out = self._run(pairs, [], sample=10)
        self.assertTrue(any("200 articles scored" in l and "sampling 10" in l for l in out))


# ---------------------------------------------------------------------------
# 4. Neither change touches the gate
# ---------------------------------------------------------------------------
class GateUntouchedTest(unittest.TestCase):
    def test_the_gate_expression_is_unchanged(self):
        self.assertIn(
            "ingest_gate = RELEVANCE_NEW_GATE if RELEVANCE_GRADE_MODE == \"new\" else 6",
            SOURCE)

    def test_the_audit_runs_after_the_loop_has_finished(self):
        """Called with `relevant` already built. If it ran earlier it would have
        to re-derive the outcome, which is the thing it must not do."""
        gate_loop = SOURCE.index('gate_dropped = {"result_none"')
        # rindex, not index: the def has the same argument list as the call site
        call = SOURCE.rindex("_log_grader_rejects(fresh, results, relevant, ingest_gate)")
        self.assertGreater(call, gate_loop)

    def test_the_audit_never_appends_to_relevant(self):
        body = SOURCE[SOURCE.index("def _log_grader_rejects"):
                      SOURCE.index("def _watchlist_exception_matcher")]
        self.assertNotIn("relevant.append", body)
        self.assertNotIn("ingest_gate =", body)

    def test_the_audit_writes_nothing(self):
        body = SOURCE[SOURCE.index("def _log_grader_rejects"):
                      SOURCE.index("def _watchlist_exception_matcher")]
        for write in ("supabase.table", ".insert(", ".update(", ".upsert("):
            self.assertNotIn(write, body)

    def test_default_sample_is_fifty(self):
        self.assertEqual(ingest.GRADER_REJECT_LOG_SAMPLE, 50)

    def test_empty_repo_variable_falls_back_to_the_default(self):
        with patch.dict(os.environ, {"GRADER_REJECT_LOG_SAMPLE": ""}):
            self.assertEqual(ingest._int_env("GRADER_REJECT_LOG_SAMPLE", 50), 50)


if __name__ == "__main__":
    unittest.main()
