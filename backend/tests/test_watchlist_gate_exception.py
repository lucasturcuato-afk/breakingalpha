"""WATCHLIST_GATE_EXCEPTION: a low-score rescue, never a relevance override.

The exception lets an article that scored BELOW the ingest gate be stored anyway
when it matches a ticker or company somebody tracks. Three properties make it
safe, and each one is asserted here rather than assumed:

  1. It sits strictly AFTER the `relevant` check, so it rescues a low score and
     can never resurrect an article the filter rejected.
  2. It is off by default, and an unset repo Variable (which renders as the
     EMPTY STRING, not as unset) keeps it off instead of raising at import.
  3. Sector watchlist entries never rescue. They are generic English words --
     'energy' matches "Bloom Energy Corp Stock (BE) Moved Up by 5.30%" -- which
     is the same false-positive class as the pre-#626 substring boost.

The gate loop itself is not importable in isolation (it lives inside
run_ingestion, which fetches feeds), so the branch ORDER is asserted against the
parsed source, and the branch BEHAVIOUR is asserted against a faithful
re-implementation of the same predicate chain. Both have to agree.
"""

import ast
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
import watchlist  # noqa: E402

SOURCE = (BACKEND / "ingest.py").read_text()


# ---------------------------------------------------------------------------
# 1. The branch sits after the relevant check
# ---------------------------------------------------------------------------
def _gate_loop_branches():
    """Return the ordered test-source of the gate loop's if/elif chain."""
    tree = ast.parse(SOURCE)
    for node in ast.walk(tree):
        if not isinstance(node, ast.For):
            continue
        body = node.body
        if len(body) != 1 or not isinstance(body[0], ast.If):
            continue
        first = ast.unparse(body[0].test)
        if "ingest_gate" not in first:
            continue
        branches, cur = [first], body[0]
        while cur.orelse and len(cur.orelse) == 1 and isinstance(cur.orelse[0], ast.If):
            cur = cur.orelse[0]
            branches.append(ast.unparse(cur.test))
        return branches
    raise AssertionError("gate loop not found in ingest.py")


class BranchOrderTest(unittest.TestCase):
    def test_the_chain_is_in_the_required_order(self):
        b = _gate_loop_branches()
        self.assertEqual(len(b), 4, b)
        self.assertIn("ingest_gate", b[0])
        self.assertIn("not result", b[1])
        self.assertIn("relevant", b[2])
        self.assertIn("wl_matcher", b[3])

    def test_rescue_is_the_last_branch(self):
        """If the rescue moved ahead of either drop test it could admit an
        article with no result, or one the filter marked not-relevant."""
        b = _gate_loop_branches()
        rescue = [i for i, t in enumerate(b) if "wl_matcher" in t]
        self.assertEqual(rescue, [3], b)

    def test_the_original_pass_predicate_is_unchanged(self):
        self.assertIn("result.get('relevant')", _gate_loop_branches()[0])
        self.assertIn("result.get('relevance_score', 0) >= ingest_gate",
                      _gate_loop_branches()[0])


# ---------------------------------------------------------------------------
# 2. Behaviour of that chain
# ---------------------------------------------------------------------------
def _classify(result, article, ingest_gate, wl_matcher):
    """The gate loop's predicate chain, branch for branch."""
    if result and result.get("relevant") and result.get("relevance_score", 0) >= ingest_gate:
        return "passed"
    elif not result:
        return "result_none"
    elif not result.get("relevant"):
        return "relevant_falsy"
    elif wl_matcher is not None and watchlist._matched_identifiers(wl_matcher, article):
        return "rescued"
    else:
        return "below_gate"


class RescueBehaviourTest(unittest.TestCase):
    def setUp(self):
        self.matcher = watchlist._build_identifier_matcher(["NVDA", "Bloom Energy"])
        self.article = {"title": "NVDA slips 2% on no news at all", "summary": ""}

    def test_low_score_watchlist_match_is_rescued(self):
        r = {"relevant": True, "relevance_score": 1}
        self.assertEqual(_classify(r, self.article, 3, self.matcher), "rescued")

    def test_not_relevant_is_never_rescued(self):
        """The blocker property: the filter's verdict is not overridable."""
        r = {"relevant": False, "relevance_score": 1}
        self.assertEqual(_classify(r, self.article, 3, self.matcher), "relevant_falsy")

    def test_not_relevant_with_a_high_score_is_still_dropped(self):
        r = {"relevant": False, "relevance_score": 9}
        self.assertEqual(_classify(r, self.article, 3, self.matcher), "relevant_falsy")

    def test_missing_result_is_never_rescued(self):
        self.assertEqual(_classify(None, self.article, 3, self.matcher), "result_none")

    def test_low_score_without_a_match_still_drops(self):
        r = {"relevant": True, "relevance_score": 1}
        off_topic = {"title": "Ford recalls 5,000 vehicles", "summary": ""}
        self.assertEqual(_classify(r, off_topic, 3, self.matcher), "below_gate")

    def test_matcher_none_disables_the_rescue_entirely(self):
        r = {"relevant": True, "relevance_score": 1}
        self.assertEqual(_classify(r, self.article, 3, None), "below_gate")

    def test_above_gate_passes_without_consulting_the_matcher(self):
        r = {"relevant": True, "relevance_score": 9}
        self.assertEqual(_classify(r, self.article, 3, None), "passed")

    def test_rescue_is_inert_at_a_gate_of_one(self):
        """Today's production gate. A score of 1 is already above it, so the
        exception changes nothing until the gate is actually raised."""
        r = {"relevant": True, "relevance_score": 1}
        self.assertEqual(_classify(r, self.article, 1, self.matcher), "passed")


# ---------------------------------------------------------------------------
# 3. Ticker/company only
# ---------------------------------------------------------------------------
class TickerCompanyOnlyTest(unittest.TestCase):
    ENTRIES = [
        {"identifier": "NVDA", "type": "ticker"},
        {"identifier": "Bloom Energy", "type": "company"},
        {"identifier": "Energy", "type": "sector"},
        {"identifier": "Technology", "type": "sector"},
    ]

    def _matcher(self, entries):
        with patch.object(ingest, "WATCHLIST_GATE_EXCEPTION", 1), \
             patch.object(ingest, "list_watchlist", return_value=entries):
            return ingest._watchlist_exception_matcher()

    def test_sector_words_do_not_rescue(self):
        m = self._matcher(self.ENTRIES)
        seagate = {"title": "Seagate Technology Holdings PLC Stock (STX) Moved Up 3.37%",
                   "summary": ""}
        self.assertEqual(watchlist._matched_identifiers(m, seagate), [])

    def test_ticker_still_rescues(self):
        m = self._matcher(self.ENTRIES)
        art = {"title": "NVDA drifts lower", "summary": ""}
        self.assertEqual(watchlist._matched_identifiers(m, art), ["nvda"])

    def test_company_entry_still_rescues(self):
        m = self._matcher(self.ENTRIES)
        art = {"title": "Bloom Energy Corp Stock (BE) Moved Up by 5.30%", "summary": ""}
        self.assertEqual(watchlist._matched_identifiers(m, art), ["bloom energy"])

    def test_the_allowed_types_are_exactly_ticker_and_company(self):
        self.assertEqual(ingest.WATCHLIST_EXCEPTION_TYPES, ("ticker", "company"))

    def test_a_sector_only_watchlist_builds_no_matcher(self):
        self.assertIsNone(self._matcher([{"identifier": "Energy", "type": "sector"}]))

    def test_type_matching_is_case_and_whitespace_insensitive(self):
        m = self._matcher([{"identifier": "NVDA", "type": " Ticker "}])
        self.assertIsNotNone(m)


# ---------------------------------------------------------------------------
# 4. Off by default, and safe when it fails
# ---------------------------------------------------------------------------
class FlagDefaultTest(unittest.TestCase):
    def test_default_is_off(self):
        self.assertEqual(ingest.WATCHLIST_GATE_EXCEPTION, 0)

    def test_empty_string_is_off(self):
        """What an unset repo Variable actually renders as in the job env."""
        with patch.dict(os.environ, {"WATCHLIST_GATE_EXCEPTION": ""}):
            self.assertEqual(ingest._int_env("WATCHLIST_GATE_EXCEPTION", 0), 0)

    def test_garbage_is_off_rather_than_raising(self):
        with patch.dict(os.environ, {"WATCHLIST_GATE_EXCEPTION": "yes"}):
            self.assertEqual(ingest._int_env("WATCHLIST_GATE_EXCEPTION", 0), 0)

    def test_one_turns_it_on(self):
        with patch.dict(os.environ, {"WATCHLIST_GATE_EXCEPTION": "1"}):
            self.assertEqual(ingest._int_env("WATCHLIST_GATE_EXCEPTION", 0), 1)

    def test_flag_off_skips_the_watchlist_read_entirely(self):
        calls = []

        def _boom():
            calls.append(1)
            raise AssertionError("watchlist must not be read when the flag is off")

        with patch.object(ingest, "WATCHLIST_GATE_EXCEPTION", 0), \
             patch.object(ingest, "list_watchlist", _boom):
            self.assertIsNone(ingest._watchlist_exception_matcher())
        self.assertEqual(calls, [])

    def test_a_failed_watchlist_read_disables_the_rescue_and_does_not_raise(self):
        def _boom():
            raise RuntimeError("supabase down")

        with patch.object(ingest, "WATCHLIST_GATE_EXCEPTION", 1), \
             patch.object(ingest, "list_watchlist", _boom):
            self.assertIsNone(ingest._watchlist_exception_matcher())

    def test_an_empty_watchlist_disables_the_rescue(self):
        with patch.object(ingest, "WATCHLIST_GATE_EXCEPTION", 1), \
             patch.object(ingest, "list_watchlist", return_value=[]):
            self.assertIsNone(ingest._watchlist_exception_matcher())


# ---------------------------------------------------------------------------
# 5. The accounting stays honest
# ---------------------------------------------------------------------------
class AccountingTest(unittest.TestCase):
    def test_the_funnel_line_reports_the_rescue(self):
        self.assertIn("rescued-by-watchlist {gate_rescued}", SOURCE)

    def test_the_stats_payload_carries_the_bucket(self):
        self.assertIn('"rescued_by_watchlist": gate_rescued', SOURCE)

    def test_rescued_articles_are_counted_inside_gate_passed(self):
        """gate_passed is len(relevant), and a rescue appends to relevant, so
        candidates = passed + dropped still partitions the pool exactly."""
        gate, matcher = 3, watchlist._build_identifier_matcher(["NVDA"])
        pool = [
            ({"relevant": True, "relevance_score": 9}, {"title": "x", "summary": ""}),
            ({"relevant": True, "relevance_score": 1}, {"title": "NVDA dips", "summary": ""}),
            ({"relevant": True, "relevance_score": 1}, {"title": "y", "summary": ""}),
            ({"relevant": False, "relevance_score": 1}, {"title": "NVDA dips", "summary": ""}),
            (None, {"title": "z", "summary": ""}),
        ]
        seen = [_classify(r, a, gate, matcher) for r, a in pool]
        passed = sum(1 for s in seen if s in ("passed", "rescued"))
        dropped = sum(1 for s in seen if s in ("result_none", "relevant_falsy", "below_gate"))
        self.assertEqual(passed, 2)
        self.assertEqual(dropped, 3)
        self.assertEqual(passed + dropped, len(pool))
        self.assertEqual(sum(1 for s in seen if s == "rescued"), 1)

    def test_the_migration_exists_and_is_additive(self):
        sql = (BACKEND.parent / "sql" /
               "0033_ingest_run_stats_watchlist_rescue.sql").read_text()
        self.assertIn("ADD COLUMN IF NOT EXISTS rescued_by_watchlist", sql)
        for destructive in ("DROP COLUMN", "DELETE FROM", "TRUNCATE", "UPDATE public."):
            self.assertNotIn(destructive, sql)

    def test_a_pending_migration_does_not_cost_the_whole_stats_row(self):
        self.assertIn("_STATS_OPTIONAL_KEYS", SOURCE)
        self.assertIn("rescued_by_watchlist", ingest._STATS_OPTIONAL_KEYS)


if __name__ == "__main__":
    unittest.main()
