"""Unit tests for per-call resolution horizons.

Covers the fixed horizon map (backend/call_horizons.py) and the grader's
due-scan, mode flag, and resolver-input mapping
(backend/grading/grade_brief_calls.py).

No network, no DB, no Gemini: the horizon map is pure, and the due-scan is
exercised against a fake Supabase table that records the filter chain and
applies it in memory.

Run from repo root: python -m unittest backend.tests.test_call_horizons
"""
import sys
import types
import unittest
from datetime import date

# grade_brief_calls imports the supabase SDK at module scope purely to build a
# client in main(). Nothing under test touches it (the due-scan runs against the
# fake table below), so stub it before import. This keeps the test hermetic and
# independent of whether the SDK's transport stack imports cleanly on the local
# Python, which it does not on 3.14 (httpcore raises on import).
if "supabase" not in sys.modules:
    _stub = types.ModuleType("supabase")
    _stub.create_client = lambda *a, **k: None  # noqa: E731
    sys.modules["supabase"] = _stub

from backend.call_horizons import (
    HORIZON_DAYS,
    MAX_HORIZON_DAYS,
    horizon_days,
    normalize_horizon_days,
    normalize_horizon_type,
    resolve_on_for,
    resolve_on_for_days,
)
from backend.grading.grade_brief_calls import (
    HORIZON_MODE_ACTIVE,
    HORIZON_MODE_OFF,
    call_to_graded_input,
    fetch_due_calls,
    horizon_grading_mode,
    is_due,
)

BRIEF_DATE = "2026-07-25"


# ---------------------------------------------------------------------------
# Fake Supabase: records the filter chain and applies it in memory.
# ---------------------------------------------------------------------------


class _FakeResp:
    def __init__(self, data):
        self.data = data


class _FakeNot:
    def __init__(self, q):
        self._q = q

    def is_(self, col, val):
        self._q.filters.append(("not.is", col, val))
        return self._q


class _FakeQuery:
    def __init__(self, rows):
        self._rows = rows
        self.filters = []

    def select(self, *_a, **_k):
        return self

    @property
    def not_(self):
        return _FakeNot(self)

    def eq(self, col, val):
        self.filters.append(("eq", col, val))
        return self

    def lte(self, col, val):
        self.filters.append(("lte", col, val))
        return self

    def execute(self):
        rows = self._rows
        for kind, col, val in self.filters:
            if kind == "eq":
                # grading_status is NOT NULL DEFAULT 'gradeable' (sql/0041); a
                # fixture row that omits it reads as the default, as the DB would.
                default = "gradeable" if col == "grading_status" else None
                rows = [r for r in rows if r.get(col, default) == val]
            elif kind == "lte":
                rows = [r for r in rows if r.get(col) is not None and r[col] <= val]
            elif kind == "not.is" and val == "null":
                rows = [r for r in rows if r.get(col) is not None]
        return _FakeResp(rows)


class _FakeSB:
    def __init__(self, rows):
        self._rows = rows
        self.last_query = None

    def table(self, _name):
        self.last_query = _FakeQuery(list(self._rows))
        return self.last_query


# ---------------------------------------------------------------------------
# The fixed horizon map
# ---------------------------------------------------------------------------


class TestHorizonMap(unittest.TestCase):
    def test_session_week_multiweek_yield_0_7_21(self):
        self.assertEqual(resolve_on_for(BRIEF_DATE, "session"), "2026-07-25")
        self.assertEqual(resolve_on_for(BRIEF_DATE, "week"), "2026-08-01")
        self.assertEqual(resolve_on_for(BRIEF_DATE, "multiweek"), "2026-08-15")
        self.assertEqual((horizon_days("session"), horizon_days("week"), horizon_days("multiweek")),
                         (0, 7, 21))

    def test_unknown_and_missing_fall_back_to_session(self):
        for bad in ["event", "EVENT", "quarter", "", "  ", None, 7, [], {}, "sessions"]:
            self.assertEqual(normalize_horizon_type(bad), "session", f"input {bad!r}")
            self.assertEqual(resolve_on_for(BRIEF_DATE, bad), BRIEF_DATE, f"input {bad!r}")

    def test_case_and_whitespace_tolerated(self):
        self.assertEqual(resolve_on_for(BRIEF_DATE, "  WEEK "), "2026-08-01")
        self.assertEqual(resolve_on_for(BRIEF_DATE, "MultiWeek"), "2026-08-15")

    def test_nothing_exceeds_the_90_day_cap(self):
        for name, days in HORIZON_DAYS.items():
            self.assertLessEqual(days, MAX_HORIZON_DAYS, name)
            span = date.fromisoformat(resolve_on_for(BRIEF_DATE, name)) - date.fromisoformat(BRIEF_DATE)
            self.assertLessEqual(span.days, MAX_HORIZON_DAYS, name)
        self.assertLessEqual(horizon_days("multiweek"), MAX_HORIZON_DAYS)

    def test_bad_brief_date_yields_none_so_the_call_is_never_due(self):
        for bad in [None, "", "not-a-date", 20260725, "2026-13-45"]:
            self.assertIsNone(resolve_on_for(bad, "week"), f"input {bad!r}")


# ---------------------------------------------------------------------------
# Variable horizons: a day count, not a bucket
# ---------------------------------------------------------------------------


class TestHorizonDays(unittest.TestCase):
    """The generator now states how many days a claim needs. The code clamps it
    and owns the date. A bounded non-negative integer cannot express a window in
    the past or a year out, so absurd values are unrepresentable rather than
    caught."""

    def test_real_counts_produce_the_right_date(self):
        cases = {
            0: "2026-07-25",   # same session, the old "session" bucket
            3: "2026-07-28",   # Thursday's print, which used to cost 7 days
            7: "2026-08-01",   # the old "week" bucket, unchanged
            13: "2026-08-07",  # off-bucket, the whole point
            21: "2026-08-15",  # the old "multiweek" bucket, unchanged
            45: "2026-09-08",
            90: "2026-10-23",  # the cap itself
        }
        for days, expected in cases.items():
            with self.subTest(days=days):
                self.assertEqual(resolve_on_for_days(BRIEF_DATE, days), expected)

    def test_the_named_buckets_still_agree_with_their_counts(self):
        for name, days in HORIZON_DAYS.items():
            with self.subTest(name=name):
                self.assertEqual(
                    resolve_on_for(BRIEF_DATE, name),
                    resolve_on_for_days(BRIEF_DATE, days),
                )

    def test_out_of_range_clamps_to_the_cap(self):
        self.assertEqual(normalize_horizon_days(91), MAX_HORIZON_DAYS)
        self.assertEqual(normalize_horizon_days(400), MAX_HORIZON_DAYS)
        self.assertEqual(normalize_horizon_days(10**9), MAX_HORIZON_DAYS)
        # 400 days out is not merely rejected, it is unreachable.
        span = (date.fromisoformat(resolve_on_for_days(BRIEF_DATE, 400))
                - date.fromisoformat(BRIEF_DATE))
        self.assertEqual(span.days, MAX_HORIZON_DAYS)

    def test_negative_and_non_integer_fall_back_to_same_session(self):
        for bad in [-1, -400, None, "", "  ", "soon", "week", [], {}, object(),
                    True, False, float("nan"), float("inf"), float("-inf")]:
            with self.subTest(bad=repr(bad)):
                self.assertEqual(normalize_horizon_days(bad), 0)
                self.assertEqual(resolve_on_for_days(BRIEF_DATE, bad), BRIEF_DATE)

    def test_no_count_can_resolve_before_the_brief(self):
        for raw in [-1, -90, -10**6, 0, 1, 45, 400]:
            with self.subTest(raw=raw):
                out = resolve_on_for_days(BRIEF_DATE, raw)
                self.assertGreaterEqual(out, BRIEF_DATE, f"input {raw!r}")

    def test_numeric_strings_and_floats_are_read_as_counts(self):
        self.assertEqual(normalize_horizon_days("7"), 7)
        self.assertEqual(normalize_horizon_days(" 13 "), 13)
        self.assertEqual(normalize_horizon_days(7.9), 7)

    def test_bad_brief_date_still_yields_none(self):
        for bad in [None, "", "not-a-date", 20260725, "2026-13-45"]:
            self.assertIsNone(resolve_on_for_days(bad, 13), f"input {bad!r}")

    def test_accepts_a_date_object_not_just_a_string(self):
        self.assertEqual(resolve_on_for(date(2026, 7, 25), "week"), "2026-08-01")

    def test_calendar_days_cross_month_and_year_boundaries(self):
        self.assertEqual(resolve_on_for("2026-12-28", "week"), "2027-01-04")
        self.assertEqual(resolve_on_for("2026-02-25", "multiweek"), "2026-03-18")


# ---------------------------------------------------------------------------
# The due-scan
# ---------------------------------------------------------------------------


class TestDueScan(unittest.TestCase):
    TODAY = "2026-08-01"

    def test_future_resolve_on_is_not_due_past_is(self):
        self.assertFalse(is_due({"resolve_on": "2026-08-15"}, self.TODAY))
        self.assertTrue(is_due({"resolve_on": "2026-07-25"}, self.TODAY))

    def test_resolve_on_equal_to_today_is_due(self):
        self.assertTrue(is_due({"resolve_on": self.TODAY}, self.TODAY))

    def test_null_resolve_on_is_never_due(self):
        for row in [{}, {"resolve_on": None}, {"resolve_on": ""},
                    {"resolve_on": None, "brief_date": "2020-01-01"}]:
            self.assertFalse(is_due(row, self.TODAY), f"row {row!r}")

    def test_active_scan_excludes_null_so_the_backlog_stays_untouched(self):
        # 3 historical rows (the pre-0014 backlog) + 1 due + 1 future.
        rows = [
            {"id": "old1", "brief_date": "2026-05-01", "resolve_on": None},
            {"id": "old2", "brief_date": "2026-06-01", "resolve_on": None},
            {"id": "old3", "brief_date": "2026-07-01", "resolve_on": None},
            {"id": "due", "brief_date": "2026-07-25", "resolve_on": "2026-08-01"},
            {"id": "future", "brief_date": "2026-07-25", "resolve_on": "2026-08-15"},
        ]
        sb = _FakeSB(rows)
        got = fetch_due_calls(sb, self.TODAY, HORIZON_MODE_ACTIVE)
        self.assertEqual([r["id"] for r in got], ["due"])
        # The query itself must carry the NOT NULL guard, not just the data.
        self.assertIn(("not.is", "resolve_on", "null"), sb.last_query.filters)
        self.assertIn(("lte", "resolve_on", self.TODAY), sb.last_query.filters)

    def test_a_row_that_says_ungradable_is_never_due_even_with_a_horizon(self):
        """sql/0041 marks legacy calls grading_status = 'ungradable'. The
        due-scan honours the marker itself, not the NULL resolve_on that
        happens to accompany it today."""
        rows = [
            {"id": "marked", "brief_date": "2026-05-01", "resolve_on": "2026-05-01",
             "grading_status": "ungradable", "ungradable_reason": "horizon_never_captured"},
            {"id": "due", "brief_date": "2026-05-01", "resolve_on": "2026-05-01"},
        ]
        got = fetch_due_calls(_FakeSB(rows), self.TODAY, HORIZON_MODE_ACTIVE)
        self.assertEqual([r["id"] for r in got], ["due"])

    def test_off_mode_selection_is_byte_identical_to_today_only(self):
        rows = [
            {"id": "today", "brief_date": self.TODAY, "resolve_on": None},
            {"id": "today2", "brief_date": self.TODAY, "resolve_on": "2026-08-20"},
            {"id": "yesterday", "brief_date": "2026-07-31", "resolve_on": "2026-07-31"},
            {"id": "due_but_old", "brief_date": "2026-07-25", "resolve_on": "2026-07-26"},
        ]
        sb = _FakeSB(rows)
        got = fetch_due_calls(sb, self.TODAY, HORIZON_MODE_OFF)
        self.assertEqual([r["id"] for r in got], ["today", "today2"])
        # Exactly one filter, the same equality the pre-horizons code used.
        self.assertEqual(sb.last_query.filters, [("eq", "brief_date", self.TODAY)])

    def test_off_mode_ignores_resolve_on_entirely(self):
        # A call due days ago must NOT be picked up while the flag is off.
        rows = [{"id": "due", "brief_date": "2026-07-01", "resolve_on": "2026-07-08"}]
        self.assertEqual(fetch_due_calls(_FakeSB(rows), self.TODAY, HORIZON_MODE_OFF), [])


# ---------------------------------------------------------------------------
# The flag
# ---------------------------------------------------------------------------


class TestHorizonFlag(unittest.TestCase):
    def test_default_and_unknown_resolve_to_off(self):
        self.assertEqual(horizon_grading_mode({}), HORIZON_MODE_OFF)
        for bad in ["", "  ", "on", "true", "1", "shadow", "ACTIVE!", "activ"]:
            self.assertEqual(horizon_grading_mode({"HORIZON_GRADING_MODE": bad}),
                             HORIZON_MODE_OFF, f"input {bad!r}")

    def test_active_is_the_only_value_that_enables_it(self):
        for good in ["active", "ACTIVE", " Active "]:
            self.assertEqual(horizon_grading_mode({"HORIZON_GRADING_MODE": good}),
                             HORIZON_MODE_ACTIVE, f"input {good!r}")


# ---------------------------------------------------------------------------
# Resolver-input mapping (what widens the window in price_attribution)
# ---------------------------------------------------------------------------


class TestResolverMapping(unittest.TestCase):
    CALL = {"id": "c1", "brief_date": "2026-07-25", "resolve_on": "2026-08-15",
            "claim_type": "ticker", "target_symbol": "NVDA"}

    def test_active_maps_resolve_on_to_brief_date_and_brief_date_to_window_start(self):
        got = call_to_graded_input(self.CALL, HORIZON_MODE_ACTIVE)
        # price_attribution treats brief_date as the window CLOSE.
        self.assertEqual(got["brief_date"], "2026-08-15")
        self.assertEqual(got["window_start"], "2026-07-25")

    def test_off_mode_passes_the_row_through_untouched(self):
        got = call_to_graded_input(self.CALL, HORIZON_MODE_OFF)
        self.assertIs(got, self.CALL)
        self.assertNotIn("window_start", got)

    def test_null_resolve_on_passes_through_even_when_active(self):
        row = {"id": "c2", "brief_date": "2026-07-25", "resolve_on": None}
        got = call_to_graded_input(row, HORIZON_MODE_ACTIVE)
        self.assertIs(got, row)
        self.assertNotIn("window_start", got)

    def test_session_horizon_collapses_to_a_single_session_window(self):
        row = {"id": "c3", "brief_date": BRIEF_DATE,
               "resolve_on": resolve_on_for(BRIEF_DATE, "session")}
        got = call_to_graded_input(row, HORIZON_MODE_ACTIVE)
        self.assertEqual(got["brief_date"], got["window_start"])


# ---------------------------------------------------------------------------
# End-to-end fixture: a simulated extractor payload per horizon type
# ---------------------------------------------------------------------------


def _rows_from_payload(payload: dict, brief_date: str) -> list[dict]:
    """The row-building logic of extract_and_persist_claims, minus the IO.

    Mirrors backend/synthesize.py extract_and_persist_claims so the fixture
    proves the same normalization and the same horizon map the pipeline uses.
    """
    allowed_types = {"aggregate", "sector", "index", "ticker"}
    allowed_dirs = {"bullish", "bearish", "neutral"}
    rows = []
    for c in payload.get("claims") or []:
        if not isinstance(c, dict):
            continue
        claim_text = (c.get("claim_text") or "").strip()
        claim_type = (c.get("claim_type") or "").strip().lower()
        direction = (c.get("expected_direction") or "").strip().lower()
        if not claim_text or claim_type not in allowed_types or direction not in allowed_dirs:
            continue
        rows.append({
            "brief_date": brief_date,
            "claim_text": claim_text,
            "claim_type": claim_type,
            "expected_direction": direction,
            "resolve_on": resolve_on_for(brief_date, c.get("horizon_type")),
        })
    return rows


class TestExtractorFixture(unittest.TestCase):
    PAYLOAD = {
        "claims": [
            {"claim_text": "SPY closes higher on a dovish Fed tone",
             "claim_type": "aggregate", "target_symbol": "SPY",
             "expected_direction": "bullish", "horizon_type": "session",
             "confidence": 0.6},
            {"claim_text": "Energy grinds higher as crude tightens through the week",
             "claim_type": "sector", "target_symbol": "XLE",
             "expected_direction": "bullish", "horizon_type": "week",
             "confidence": 0.5},
            {"claim_text": "Semis re-rate as the AI capex cycle turns",
             "claim_type": "ticker", "target_symbol": "NVDA",
             "expected_direction": "bullish", "horizon_type": "multiweek",
             "confidence": 0.55},
            {"claim_text": "Rates drift on an unnamed catalyst",
             "claim_type": "index", "target_symbol": "TLT",
             "expected_direction": "bearish", "horizon_type": "event",
             "confidence": 0.4},
            {"claim_text": "Financials hold up",
             "claim_type": "sector", "target_symbol": "XLF",
             "expected_direction": "neutral", "confidence": 0.4},
        ]
    }

    def test_each_horizon_type_produces_the_right_resolve_on_end_to_end(self):
        rows = _rows_from_payload(self.PAYLOAD, BRIEF_DATE)
        self.assertEqual(len(rows), 5)
        self.assertEqual([r["resolve_on"] for r in rows], [
            "2026-07-25",  # session  -> +0
            "2026-08-01",  # week     -> +7
            "2026-08-15",  # multiweek-> +21
            "2026-07-25",  # "event" is not a bucket -> session
            "2026-07-25",  # horizon_type absent     -> session
        ])

    def test_the_fixture_produces_a_real_mix_not_all_session(self):
        # If a future prompt change made everything same-session, this fails.
        rows = _rows_from_payload(self.PAYLOAD, BRIEF_DATE)
        distinct = {r["resolve_on"] for r in rows}
        self.assertGreater(len(distinct), 1, "every claim collapsed to one horizon")

    def test_due_scan_over_the_fixture_releases_calls_on_their_own_schedule(self):
        rows = [dict(r, id=str(i)) for i, r in enumerate(_rows_from_payload(self.PAYLOAD, BRIEF_DATE))]
        # Day of the brief: only the session calls are due.
        due = fetch_due_calls(_FakeSB(rows), "2026-07-25", HORIZON_MODE_ACTIVE)
        self.assertEqual([r["id"] for r in due], ["0", "3", "4"])
        # A week later the week call joins them.
        due = fetch_due_calls(_FakeSB(rows), "2026-08-01", HORIZON_MODE_ACTIVE)
        self.assertEqual([r["id"] for r in due], ["0", "1", "3", "4"])
        # Three weeks later everything has resolved.
        due = fetch_due_calls(_FakeSB(rows), "2026-08-15", HORIZON_MODE_ACTIVE)
        self.assertEqual(len(due), 5)


if __name__ == "__main__":
    unittest.main()
