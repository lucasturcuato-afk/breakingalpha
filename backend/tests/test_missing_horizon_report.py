"""resolve_on NULL is counted every grading run, and a NEW one fails the run.

Why: 305 of 446 calls carried resolve_on NULL on 2026-09-06 and the due-scan
skipped them without a word. The legacy rows (before migration 0014, 2026-07-25)
are by design ungradeable, so they stay excluded, but as a printed count. A
NULL written since is a write-path defect and must stop the run.

These pin the pure classifier and the predicate that decides whether the
writer may ever strip resolve_on. No IO.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.call_horizons import HORIZON_CUTOVER_DATE, is_missing_column_error  # noqa: E402
from backend.grading.grade_brief_calls import missing_horizon_report  # noqa: E402


class TestMissingHorizonReport:
    def test_legacy_rows_are_counted_not_flagged(self):
        rows = [{"id": "a", "brief_date": "2026-05-01"}, {"id": "b", "brief_date": "2026-07-22"}]
        r = missing_horizon_report(rows, HORIZON_CUTOVER_DATE)
        assert r == {"legacy": 2, "new": 0, "new_ids": [], "new_brief_dates": []}

    def test_a_null_on_or_after_the_cutover_is_new(self):
        rows = [
            {"id": "a", "brief_date": "2026-07-22"},
            {"id": "b", "brief_date": HORIZON_CUTOVER_DATE},
            {"id": "c", "brief_date": "2026-09-06T13:00:00+00:00"},
        ]
        r = missing_horizon_report(rows, HORIZON_CUTOVER_DATE)
        assert r["legacy"] == 1 and r["new"] == 2
        assert r["new_ids"] == ["b", "c"]
        assert r["new_brief_dates"] == [HORIZON_CUTOVER_DATE, "2026-09-06"]

    def test_empty_input(self):
        assert missing_horizon_report([], HORIZON_CUTOVER_DATE)["new"] == 0

    def test_the_cutover_matches_the_measured_boundary(self):
        """Measured 2026-09-06: last NULL brief_date 2026-07-22, first set
        2026-07-27. The constant must sit strictly between them."""
        assert "2026-07-22" < HORIZON_CUTOVER_DATE <= "2026-07-27"


class TestMissingColumnPredicate:
    @pytest.mark.parametrize("msg", [
        "{'message': \"Could not find the 'resolve_on' column of 'morning_brief_calls' in the schema cache\", 'code': 'PGRST204'}",
        "column morning_brief_calls.resolve_on does not exist",
        "{'code': '42703', 'message': 'column \"is_lead\" does not exist'}",
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
