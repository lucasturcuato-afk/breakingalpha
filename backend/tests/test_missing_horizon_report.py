"""resolve_on NULL is accounted for by what the row says, every grading run.

Why: 305 of 446 calls carried resolve_on NULL on 2026-09-06 and the due-scan
skipped them without a word. sql/0041 marks the 220 whose horizon was never
captured as grading_status = 'ungradable' with the reason on the row; the
grader counts those per reason. A gradeable row with resolve_on NULL is a
write-path defect and fails the run naming the fix. No date logic.

These pin the pure classifier and the predicate that decides whether the
writer may ever strip resolve_on. No IO.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.call_horizons import is_missing_column_error  # noqa: E402
from backend.grading.grade_brief_calls import FIX_FILE, missing_horizon_report  # noqa: E402


class TestMissingHorizonReport:
    def test_rows_that_say_ungradable_are_counted_by_reason(self):
        rows = [
            {"id": "a", "brief_date": "2026-05-01", "grading_status": "ungradable", "ungradable_reason": "horizon_never_captured"},
            {"id": "b", "brief_date": "2026-07-22", "grading_status": "ungradable", "ungradable_reason": "horizon_never_captured"},
            {"id": "c", "brief_date": "2026-06-01", "grading_status": "ungradable", "ungradable_reason": None},
        ]
        r = missing_horizon_report(rows)
        assert r["ungradable"] == 3 and r["defects"] == 0
        assert r["by_reason"] == {"horizon_never_captured": 2, "unstated": 1}

    def test_a_gradeable_row_with_no_resolve_on_is_a_defect_whatever_its_date(self):
        rows = [
            {"id": "old", "brief_date": "2026-05-01", "grading_status": "gradeable"},
            {"id": "new", "brief_date": "2026-09-06T13:00:00+00:00", "grading_status": "gradeable"},
        ]
        r = missing_horizon_report(rows)
        assert r["defects"] == 2 and r["defect_ids"] == ["old", "new"]
        assert r["defect_brief_dates"] == ["2026-05-01", "2026-09-06"]

    def test_a_row_without_the_column_is_treated_as_a_defect(self):
        """Before sql/0041 the column does not exist and the read itself fails
        with a missing-column error (handled in main). A row that somehow
        lacks the key still counts as a defect: absence of the marker is not
        permission to skip."""
        assert missing_horizon_report([{"id": "x", "brief_date": "2026-08-01"}])["defects"] == 1

    def test_empty_input(self):
        r = missing_horizon_report([])
        assert r == {"ungradable": 0, "by_reason": {}, "defects": 0, "defect_ids": [], "defect_brief_dates": []}

    def test_the_fix_named_in_the_failure_exists(self):
        assert (Path(__file__).resolve().parents[2] / FIX_FILE).is_file()


class TestMissingColumnPredicate:
    @pytest.mark.parametrize("msg", [
        "{'message': \"Could not find the 'resolve_on' column of 'morning_brief_calls' in the schema cache\", 'code': 'PGRST204'}",
        "column morning_brief_calls.resolve_on does not exist",
        "{'code': '42703', 'message': 'column \"grading_status\" does not exist'}",
    ])
    def test_schema_gap_is_recognised(self, msg):
        assert is_missing_column_error(Exception(msg))

    @pytest.mark.parametrize("msg", [
        "RemoteProtocolError: Server disconnected",
        "canceling statement due to statement timeout",
        "new row violates row-level security policy",
        "{'code': '23505', 'message': 'duplicate key value'}",
        "relation \"morning_brief_calls\" does not exist",
    ])
    def test_anything_else_is_not(self, msg):
        assert not is_missing_column_error(Exception(msg))
