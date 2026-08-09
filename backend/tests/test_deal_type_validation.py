"""deal_type post-processing guard.

The bug: FILTER_PROMPT defines deal_type over seven values, nothing enforced it,
and the model wrote whatever it liked into the column. A FULL-TABLE census
(~162,000 rows) found 28 distinct invalid values across ~8,175 rows (~5%). A
30-day sample had shown only 9 of them, so the tail is long and thin.

Three distinct bugs live in that census, and the tests separate them:
  ACTIVITY_TYPES bleed  -- a value from the prompt's other enumeration.
  invented vocabulary   -- plausible categories in no enumeration at all.
  prompt text as data   -- "Joint-venture disambiguator" is a clause HEADING
                           copied out of the prompt, and "null" is the literal
                           4-character string where a JSON null was meant.

Load-bearing tests:

  TestEveryActivityTypeIsMapped::test_no_activity_type_can_reach_the_column
    drives the real ACTIVITY_TYPES constant, so adding a value to that list
    without a deal_type mapping fails here instead of polluting the column.

  TestSqlBackfillMatchesTheCodeMapping::test_sql_remaps_exactly_match_the_python_alias_map
    sql/0026 and _DEAL_TYPE_ALIASES are two hand-written copies of one decision
    table. Drift would have the backfill and ingest writing different answers,
    with nothing to catch it.
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

import pytest

# ingest.py builds a Supabase client and a Gemini client at import time, so the
# dummy-env + bare-import preamble from test_dedup_before_filter.py is required
# here too. No network call is made by any test in this file.
os.environ.setdefault("GEMINI_API_KEY", "dummy-key-not-used")
os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_ANON_KEY", "dummy-anon-not-used")
# get_service_client() refuses to fall back to the anon key, so the service-role
# key must be present for the import to succeed. Never used: no test here calls out.
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "dummy-service-role-not-used")

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ingest import (  # noqa: E402
    ACTIVITY_TYPES,
    DEAL_TYPES,
    _DEAL_TYPE_ALIASES,
    _DEAL_TYPE_NULL_STRINGS,
    _DEAL_TYPE_WARNED,
    validate_deal_type,
)


class TestValidValuesPassThrough:
    @pytest.mark.parametrize("value", DEAL_TYPES)
    def test_allowed_value_is_unchanged(self, value):
        assert validate_deal_type(value) == value

    def test_surrounding_whitespace_is_tolerated(self):
        assert validate_deal_type("  Earnings  ") == "Earnings"

    def test_case_variation_is_tolerated(self):
        assert validate_deal_type("earnings") == "Earnings"
        assert validate_deal_type("m&a") == "M&A"


class TestAbsentValuesStayNull:
    @pytest.mark.parametrize("value", [None, "", "   ", 0, 7, [], {}, True])
    def test_absent_or_non_string_returns_none(self, value):
        # FILTER_PROMPT explicitly permits null. A manufactured "Other" would be
        # less honest than NULL.
        assert validate_deal_type(value) is None


#: The FULL-TABLE census: every invalid deal_type found across ~162,000 rows,
#: with its row count and the value it must resolve to. Driving the tests from
#: this table means a mapping regression names the exact production value that
#: broke. `None` means "must become a real SQL NULL", not "Other".
CENSUS = [
    # value,                        rows,  expected
    ("Fundraising",                 2649,  "Funding"),
    ("Earnings & Results",          2573,  "Earnings"),
    ("IPO & Capital Markets",       1280,  "IPO"),
    ("Macro & Policy",               751,  "Macro"),
    ("Regulation & Legal",           402,  "Other"),
    ("Mergers & Acquisitions",       283,  "M&A"),
    ("Private Equity",               116,  "Funding"),
    ("Regulation",                    26,  "Other"),
    ("Regulatory",                    24,  "Other"),
    ("Venture Capital",               15,  "Funding"),
    ("Partnership",                   12,  "Other"),
    ("Public Company News",            6,  "Other"),
    ("null",                           6,  None),
    ("Product Launch",                 4,  "Other"),
    ("Market Movement",                4,  "Other"),
    ("Joint-venture disambiguator",    4,  "Other"),
    ("Macro/Geopolitical",             3,  "Macro"),
    ("Public Markets & Earnings",      3,  "Earnings"),
    ("Public Markets",                 2,  "Other"),
    ("Crypto & Digital Assets",        2,  "Other"),
    ("Geopolitics",                    2,  "Geopolitical"),
    ("Investment",                     2,  "Funding"),
    ("Hiring",                         1,  "Other"),
    ("Market Entry",                   1,  "Other"),
    ("PE",                             1,  "Funding"),
    ("Joint Venture",                  1,  "Funding"),
    ("Expansion",                      1,  "Other"),
    ("Infrastructure Investment",      1,  "Funding"),
]


class TestKnownLeaksAreRemapped:
    @pytest.mark.parametrize("bad,rows,expected",
                             CENSUS, ids=[c[0] for c in CENSUS])
    def test_every_census_value_maps_correctly(self, bad, rows, expected):
        """Every invalid value in the full-table census, all 28."""
        assert validate_deal_type(bad) == expected

    def test_the_census_covers_28_values(self):
        assert len(CENSUS) == 28
        assert len({c[0] for c in CENSUS}) == 28, "duplicate value in census"

    def test_census_row_total_matches_the_measurement(self):
        assert sum(c[1] for c in CENSUS) == 8175

    def test_alias_matching_is_case_tolerant(self):
        assert validate_deal_type("earnings & results") == "Earnings"

    def test_geopolitics_keeps_its_signal_rather_than_falling_to_other(self):
        """Geopolitics is the ACTIVITY_TYPES spelling of the valid deal_type
        Geopolitical. Sending it to Other would discard real signal, which is
        why it is mapped explicitly rather than left to the tail."""
        assert validate_deal_type("Geopolitics") == "Geopolitical"
        assert validate_deal_type("Geopolitics") != "Other"

    def test_joint_venture_follows_the_prompts_own_default(self):
        """FILTER_PROMPT's JV clause ends 'Default to Funding when ambiguous'."""
        assert validate_deal_type("Joint Venture") == "Funding"

    def test_prompt_fragment_is_not_treated_as_a_joint_venture(self):
        """'Joint-venture disambiguator' is a HEADING copied out of the prompt,
        not a classification. It carries no information about the article, so it
        goes to Other -- deliberately NOT to Funding via the JV rule."""
        assert validate_deal_type("Joint-venture disambiguator") == "Other"


class TestStringifiedNullBecomesRealNull:
    """The literal 4-character string 'null' (verified type=str, len=4) is
    distinct from the 451 rows holding a real SQL NULL. It must resolve to None:
    the model declined to assign a category, and inventing 'Other' would both
    fabricate one and contradict the prompt's own escape hatch."""

    @pytest.mark.parametrize("value", ["null", "NULL", "Null", " null ", "none",
                                       "N/A", "unknown"])
    def test_stringified_null_resolves_to_none(self, value):
        assert validate_deal_type(value) is None

    def test_it_is_not_coerced_to_other(self):
        assert validate_deal_type("null") != "Other"

    def test_it_does_not_warn_because_it_is_not_an_unknown_value(self, capsys):
        validate_deal_type("null")
        assert capsys.readouterr().out == ""

    def test_the_null_string_set_and_the_alias_map_do_not_overlap(self):
        overlap = {a.casefold() for a in _DEAL_TYPE_ALIASES} & _DEAL_TYPE_NULL_STRINGS
        assert not overlap, f"a value cannot be both NULL and an alias: {overlap}"


class TestEveryActivityTypeIsMapped:
    def test_no_activity_type_can_reach_the_column(self):
        """THE property: every ACTIVITY_TYPES value resolves to a valid
        deal_type. Driven off the real constant, so adding an activity type
        without a mapping fails here."""
        for activity in ACTIVITY_TYPES:
            assert activity in _DEAL_TYPE_ALIASES, (
                f"ACTIVITY_TYPES value {activity!r} has no deal_type mapping"
            )
            assert validate_deal_type(activity) in DEAL_TYPES

    def test_no_alias_maps_to_an_invalid_target(self):
        for alias, target in _DEAL_TYPE_ALIASES.items():
            assert target in DEAL_TYPES, f"{alias!r} maps to invalid {target!r}"

    def test_no_alias_shadows_a_valid_value(self):
        # An alias keyed on a legitimate deal_type would silently rewrite good data.
        assert not (set(_DEAL_TYPE_ALIASES) & set(DEAL_TYPES))


class TestUnrecognisedValues:
    def test_unknown_value_becomes_other(self):
        assert validate_deal_type("Completely Made Up") == "Other"

    def test_unknown_value_is_reported_once_not_per_article(self, capsys):
        _DEAL_TYPE_WARNED.discard("Brand New Leak")
        for _ in range(5):
            assert validate_deal_type("Brand New Leak") == "Other"
        out = capsys.readouterr().out
        assert out.count("Brand New Leak") == 1, "leak should print exactly once"
        assert "deal_type" in out
        _DEAL_TYPE_WARNED.discard("Brand New Leak")

    def test_a_valid_value_never_warns(self, capsys):
        validate_deal_type("Earnings")
        assert capsys.readouterr().out == ""


class TestOutputIsAlwaysStorable:
    @pytest.mark.parametrize("value", [
        "M&A", "Earnings & Results", "Fundraising", "nonsense", "", None, 42,
        "  IPO & Capital Markets  ", "GEOPOLITICS",
    ])
    def test_result_is_always_null_or_an_allowed_value(self, value):
        result = validate_deal_type(value)
        assert result is None or result in DEAL_TYPES


class TestSqlBackfillMatchesTheCodeMapping:
    """sql/0026 and _DEAL_TYPE_ALIASES are two hand-written copies of the same
    decision table. If they drift, the backfill writes one thing and ingest
    writes another, and nothing would catch it until the column disagreed with
    itself. This parses the SQL and compares."""

    SQL = Path(__file__).resolve().parents[2] / "sql" / "0026_deal_type_backfill.sql"

    def _sql_case_pairs(self) -> dict:
        """Extract WHEN 'x' THEN 'y' pairs from the section 2a UPDATE."""
        text = self.SQL.read_text(encoding="utf-8")
        body = text.split("-- 2a.")[1].split("-- Expect")[0]
        return dict(re.findall(r"WHEN\s+'([^']+)'\s+THEN\s+'([^']+)'", body))

    def test_sql_file_exists(self):
        assert self.SQL.is_file(), f"missing {self.SQL}"

    def test_sql_remaps_exactly_match_the_python_alias_map(self):
        assert self._sql_case_pairs() == dict(_DEAL_TYPE_ALIASES)

    def test_sql_targets_are_all_valid_deal_types(self):
        for src, dst in self._sql_case_pairs().items():
            assert dst in DEAL_TYPES, f"{src!r} -> invalid target {dst!r}"

    def test_sql_has_no_catch_all_else_branch_in_the_update(self):
        """An `ELSE 'Other'` would flatten any unreviewed value instead of
        leaving it visible for the next census."""
        text = self.SQL.read_text(encoding="utf-8")
        body = text.split("-- 2a.")[1].split("-- Expect")[0]
        assert "ELSE" not in body.upper(), "section 2a must not have an ELSE branch"

    def test_sql_sends_the_literal_null_string_to_a_real_null(self):
        text = self.SQL.read_text(encoding="utf-8")
        assert re.search(r"SET\s+deal_type\s*=\s*NULL\s*\n\s*WHERE\s+deal_type\s*=\s*'null'",
                         text), "section 2b must set the literal 'null' string to SQL NULL"

    def test_the_null_string_is_not_in_the_remap_case(self):
        """'null' must be handled by 2b, never remapped to a category by 2a."""
        assert "null" not in self._sql_case_pairs()

    def test_every_census_value_is_handled_by_the_sql(self):
        pairs = self._sql_case_pairs()
        text = self.SQL.read_text(encoding="utf-8")
        for value, _rows, expected in CENSUS:
            if expected is None:
                assert "'null'" in text
                continue
            assert value in pairs, f"census value {value!r} missing from sql/0026"
            assert pairs[value] == expected
