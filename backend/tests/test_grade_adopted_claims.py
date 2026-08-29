"""Tests for grading adopted user claims.

The bug: backend/grading/grade_user_claims.py filtered .eq("source", "authored"),
so a call tracked from the brief was never selected by the due-scan and never
resolved. One predicate broke the last edge of the loop.

These tests pin the widened selection and, critically, that an adopted claim
grades to its OWN outcome row over its OWN window rather than inheriting the
brief call's verdict through adopted_from_call_id.

Selection only: no grading math, resolver, or threshold is exercised or changed.

No network, no DB, no Gemini. The due-scan runs against a fake Supabase table
that records the filter chain and applies it in memory.

Run from repo root: python -m unittest backend.tests.test_grade_adopted_claims
"""
import sys
import types
import unittest
from datetime import datetime, timezone

# grade_user_claims imports the supabase SDK at module scope purely to build a
# client in main(). Nothing under test touches it, so stub it before import:
# this keeps the test hermetic and independent of whether the SDK's transport
# stack imports cleanly on the local Python (it does not on 3.14).
if "supabase" not in sys.modules:
    _stub = types.ModuleType("supabase")
    _stub.create_client = lambda *a, **k: None  # noqa: E731
    sys.modules["supabase"] = _stub

from backend.grading.grade_user_claims import (  # noqa: E402
    GRADEABLE_SOURCES,
    claim_to_call,
    fetch_due_claims,
    is_price_gradeable,
    outcome_row,
)
from backend.grading.price_attribution import (  # noqa: E402
    TIER_SINGLE_STOCK,
    PriceAttributionGrader,
    scale_tier_for_sessions,
    window_scale,
    _grading_window,
)
from backend.grading.resolver import VERDICT_CORRECT  # noqa: E402

TODAY = "2026-08-10"
PRICE = {"method": "price_attribution", "version": 1}


def claim(**over) -> dict:
    base = {
        "id": "claim-1",
        "user_claim": "NVDA re-rates as the AI capex cycle turns",
        "claim_type": "ticker",
        "target_symbol": "NVDA",
        "expected_direction": "bullish",
        "resolution_method": dict(PRICE),
        "resolution_window_start": "2026-07-27",
        "resolution_window_end": "2026-08-03",
        "gradeable": True,
        "status": "open",
        "source": "authored",
        "adopted_from_call_id": None,
    }
    base.update(over)
    return base


# ---------------------------------------------------------------------------
# Fake Supabase: records the filter chain and applies it in memory.
# ---------------------------------------------------------------------------


class _Resp:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, rows):
        self._rows = rows
        self.filters = []

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self.filters.append(("eq", col, val))
        return self

    def in_(self, col, vals):
        self.filters.append(("in", col, tuple(vals)))
        return self

    def lte(self, col, val):
        self.filters.append(("lte", col, val))
        return self

    def execute(self):
        rows = self._rows
        for kind, col, val in self.filters:
            if kind == "eq":
                rows = [r for r in rows if r.get(col) == val]
            elif kind == "in":
                rows = [r for r in rows if r.get(col) in val]
            elif kind == "lte":
                rows = [r for r in rows if r.get(col) is not None and r[col] <= val]
        return _Resp(rows)


class _SB:
    def __init__(self, rows):
        self._rows = rows
        self.last_query = None

    def table(self, _name):
        self.last_query = _Query(list(self._rows))
        return self.last_query


def due_ids(rows, today=TODAY):
    """Ids the full pipeline would grade: due-scan then price-gradeability."""
    sb = _SB(rows)
    selected = fetch_due_claims(sb, today)
    return [c["id"] for c in selected if is_price_gradeable(c)]


# ---------------------------------------------------------------------------
# The fix: adopted claims are selected
# ---------------------------------------------------------------------------


class TestAdoptedSelection(unittest.TestCase):
    def test_adopted_gradeable_with_past_window_IS_selected(self):
        rows = [claim(id="a1", source="adopted", adopted_from_call_id="call-x",
                      resolution_window_end="2026-08-03")]
        self.assertEqual(due_ids(rows), ["a1"])

    def test_adopted_window_ending_exactly_today_is_selected(self):
        rows = [claim(id="a2", source="adopted", resolution_window_end=TODAY)]
        self.assertEqual(due_ids(rows), ["a2"])

    def test_adopted_not_gradeable_is_NOT_selected(self):
        rows = [claim(id="a3", source="adopted", gradeable=False,
                      resolution_window_end="2026-08-03")]
        self.assertEqual(due_ids(rows), [])

    def test_adopted_with_a_future_window_is_NOT_selected(self):
        rows = [claim(id="a4", source="adopted", resolution_window_end="2026-09-01")]
        self.assertEqual(due_ids(rows), [])

    def test_adopted_already_graded_is_NOT_reselected(self):
        rows = [claim(id="a5", source="adopted", status="graded",
                      resolution_window_end="2026-08-03")]
        self.assertEqual(due_ids(rows), [])

    def test_adopted_without_price_attribution_is_NOT_selected(self):
        rows = [claim(id="a6", source="adopted", resolution_method={"method": "none"},
                      resolution_window_end="2026-08-03")]
        self.assertEqual(due_ids(rows), [])

    def test_the_query_filters_by_source_membership_not_equality(self):
        sb = _SB([])
        fetch_due_claims(sb, TODAY)
        self.assertIn(("in", "source", ("authored", "adopted")), sb.last_query.filters)
        # The old predicate must be gone.
        self.assertNotIn(("eq", "source", "authored"), sb.last_query.filters)

    def test_an_unknown_future_source_is_not_swept_in_silently(self):
        # Enumerated, not deleted: a new source must be an explicit decision.
        rows = [claim(id="x1", source="imported", resolution_window_end="2026-08-03")]
        self.assertEqual(due_ids(rows), [])
        self.assertEqual(GRADEABLE_SOURCES, ("authored", "adopted"))


# ---------------------------------------------------------------------------
# Authored behavior is unchanged
# ---------------------------------------------------------------------------


class TestAuthoredUnchanged(unittest.TestCase):
    """Every authored fixture must select exactly as it did before the widening."""

    FIXTURES = [
        ("due", claim(id="f1", resolution_window_end="2026-08-03"), True),
        ("due today", claim(id="f2", resolution_window_end=TODAY), True),
        ("future window", claim(id="f3", resolution_window_end="2026-09-01"), False),
        ("not gradeable", claim(id="f4", gradeable=False,
                                resolution_window_end="2026-08-03"), False),
        ("already graded", claim(id="f5", status="graded",
                                 resolution_window_end="2026-08-03"), False),
        ("ungradable status", claim(id="f6", status="ungradable",
                                    resolution_window_end="2026-08-03"), False),
        ("archived", claim(id="f7", status="archived",
                           resolution_window_end="2026-08-03"), False),
        ("non-price method", claim(id="f8", resolution_method={"method": "none"},
                                   resolution_window_end="2026-08-03"), False),
    ]

    def _legacy_scan(self, rows):
        """The scan exactly as it was before this change, for a differential."""
        selected = [
            r for r in rows
            if r.get("source") == "authored"
            and r.get("gradeable") is True
            and r.get("status") == "open"
            and r.get("resolution_window_end") is not None
            and r["resolution_window_end"] <= TODAY
        ]
        return [c["id"] for c in selected if is_price_gradeable(c)]

    def test_each_authored_fixture_selects_as_expected(self):
        for label, row, expected in self.FIXTURES:
            with self.subTest(label):
                self.assertEqual(due_ids([row]) == [row["id"]], expected)

    def test_authored_selection_is_byte_identical_to_the_old_scan(self):
        rows = [row for _, row, _ in self.FIXTURES]
        self.assertEqual(due_ids(rows), self._legacy_scan(rows))

    def test_widening_adds_adopted_without_disturbing_authored(self):
        authored = [row for _, row, _ in self.FIXTURES]
        adopted = [claim(id="a1", source="adopted", adopted_from_call_id="call-x",
                         resolution_window_end="2026-08-03")]
        # Authored results are the same set whether or not adopted rows are present.
        self.assertEqual(due_ids(authored), self._legacy_scan(authored))
        mixed = due_ids(authored + adopted)
        self.assertEqual([i for i in mixed if i != "a1"], self._legacy_scan(authored))
        self.assertIn("a1", mixed)


# ---------------------------------------------------------------------------
# Independence: its own window, its own outcome row
# ---------------------------------------------------------------------------


class TestAdoptedGradesIndependently(unittest.TestCase):
    ADOPTED = claim(
        id="adopted-1",
        source="adopted",
        adopted_from_call_id="brief-call-99",
        resolution_window_start="2026-07-27",
        resolution_window_end="2026-08-03",
    )

    def test_outcome_row_is_keyed_on_the_claim_not_the_brief_call(self):
        row = outcome_row(self.ADOPTED, _FakeOutcome(), "notes")
        self.assertEqual(row["claim_id"], "adopted-1")
        self.assertNotIn("call_id", row)
        # The brief call id must not leak into the outcome anywhere.
        self.assertNotIn("brief-call-99", str(row))

    def test_it_is_graded_over_its_OWN_window_not_the_brief_call_session(self):
        mapped = claim_to_call(self.ADOPTED)
        # price_attribution reads brief_date as the window CLOSE.
        self.assertEqual(mapped["brief_date"], "2026-08-03")
        self.assertEqual(mapped["window_start"], "2026-07-27")
        self.assertEqual(mapped["id"], "adopted-1")

    def test_the_grading_input_never_references_adopted_from_call_id(self):
        mapped = claim_to_call(self.ADOPTED)
        self.assertNotIn("adopted_from_call_id", mapped)
        self.assertNotIn("brief-call-99", str(mapped))

    def test_an_adopted_and_an_authored_claim_map_identically(self):
        """No special-casing: the only difference is the source label."""
        authored = claim(id="x", source="authored", adopted_from_call_id=None,
                         resolution_window_start="2026-07-27",
                         resolution_window_end="2026-08-03")
        adopted = claim(id="x", source="adopted", adopted_from_call_id="call-9",
                        resolution_window_start="2026-07-27",
                        resolution_window_end="2026-08-03")
        self.assertEqual(claim_to_call(authored), claim_to_call(adopted))


# ---------------------------------------------------------------------------
# A same-session claim resolves.
#
# This is the load-bearing proof behind removing the one-day floor from
# resolveAdoptWindow in src/lib/call-horizons.ts. The commit sheet says
# "resolves at today's close" and the stored row used to say tomorrow, because
# the floor rewrote the window. The floor was justified by the belief that a
# zero-day window can never grade. It grades.
# ---------------------------------------------------------------------------


def _one_candle_fetcher(prices):
    """symbol -> (open, close), always exactly one daily bar."""

    def fetch(symbol, from_ts, to_ts):
        pair = prices.get(symbol.upper())
        if not pair:
            return None
        o, c = pair
        return {
            "open_price": o,
            "close_price": c,
            "pct_change": round((c - o) / o * 100, 2),
            "candle_count": 1,
            "from_ts": from_ts.isoformat(),
            "to_ts": to_ts.isoformat(),
        }

    return fetch


class TestZeroDayWindowGrades(unittest.TestCase):
    SESSION = "2026-07-02"

    def test_an_equal_start_and_end_is_one_whole_session(self):
        w = _grading_window("2026-08-28", "2026-08-28")
        self.assertEqual(w[0], datetime(2026, 8, 28, 0, 0, tzinfo=timezone.utc))
        self.assertEqual(
            w[1], datetime(2026, 8, 28, 23, 59, 59, tzinfo=timezone.utc)
        )

    def test_it_is_byte_identical_to_the_brief_call_window(self):
        # _grading_window collapses start onto d when start >= d, which is the
        # same branch a brief call takes by passing no window_start at all.
        # 51 of 416 morning_brief_calls rows carry resolve_on == brief_date and
        # grade through it every day.
        self.assertEqual(
            _grading_window("2026-08-28", "2026-08-28"),
            _grading_window("2026-08-28"),
        )

    def test_one_candle_grades_and_leaves_the_tier_alone(self):
        grader = PriceAttributionGrader(
            ticker_sectors={"NVDA": "technology"},
            fetch_candle=_one_candle_fetcher(
                {"NVDA": (100.0, 103.0), "XLK": (200.0, 200.4), "SPY": (500.0, 500.5)}
            ),
        )
        out = grader.resolve(
            {
                "id": "same-session-1",
                "claim_type": "ticker",
                "target_symbol": "NVDA",
                "expected_direction": "bullish",
                "brief_date": self.SESSION,
                "window_start": self.SESSION,
            }
        )
        self.assertTrue(out.is_gradable)
        self.assertEqual(out.verdict, VERDICT_CORRECT)
        self.assertEqual(out.metadata["tier"], TIER_SINGLE_STOCK.name)
        # The scaling keys are written only when the window ran over more than
        # one session. Their absence IS the proof the bar was not moved.
        self.assertNotIn("window_sessions", out.metadata)

    def test_one_session_never_scales_the_bar(self):
        self.assertEqual(window_scale(1), 1.0)
        self.assertIs(scale_tier_for_sessions(TIER_SINGLE_STOCK, 1), TIER_SINGLE_STOCK)

    def test_the_due_scan_selects_a_same_session_claim_on_its_own_date(self):
        # fetch_due_claims uses lte(resolution_window_end, today), so a window
        # closing today is due today. Nothing else in the scan cares that the
        # window is zero days long.
        rows = [
            claim(
                id="s1",
                source="adopted",
                adopted_from_call_id="call-x",
                resolution_window_start=TODAY,
                resolution_window_end=TODAY,
            )
        ]
        self.assertEqual(due_ids(rows), ["s1"])

    def test_a_same_session_claim_written_ungradeable_is_never_selected(self):
        # What the old floor plus a strict `>` produced: gradeable false, and
        # the scan cannot see it. Nothing else in the product closes it either.
        rows = [
            claim(
                id="s2",
                source="adopted",
                gradeable=False,
                resolution_window_start=TODAY,
                resolution_window_end=TODAY,
            )
        ]
        self.assertEqual(due_ids(rows), [])


class _FakeOutcome:
    """Minimal stand-in. No grading math is exercised or asserted here."""
    verdict = "correct"
    attribution = "clean"
    actual_open = 100.0
    actual_close = 104.0
    actual_pct_change = 0.04
    actual_direction = "up"
    metadata = {"grader": "price_attribution_v1"}
    is_gradable = True


if __name__ == "__main__":
    unittest.main()
