"""deal_type post-processing guard.

The bug: FILTER_PROMPT defines deal_type over seven values, nothing enforced it,
and the model bled ACTIVITY_TYPES entries into the column. 6.6% of the last 30
days of articles held an invalid value, every one of them a verbatim
ACTIVITY_TYPES string.

The load-bearing test is
TestEveryActivityTypeIsMapped::test_no_activity_type_can_reach_the_column. It
drives the real ACTIVITY_TYPES constant, so ADDING a value to that list without
adding a deal_type mapping fails here rather than silently polluting the column
again.
"""

from __future__ import annotations

import os
import sys

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


class TestKnownLeaksAreRemapped:
    @pytest.mark.parametrize("bad,expected", [
        ("Earnings & Results", "Earnings"),
        ("Fundraising", "Funding"),
        ("Macro & Policy", "Macro"),
        ("IPO & Capital Markets", "IPO"),
        ("Mergers & Acquisitions", "M&A"),
        ("Geopolitics", "Geopolitical"),
        ("Private Equity", "Funding"),
        ("Venture Capital", "Funding"),
        ("Regulation & Legal", "Other"),
    ])
    def test_observed_production_leak_maps_correctly(self, bad, expected):
        """These nine are the exact values measured in production."""
        assert validate_deal_type(bad) == expected

    def test_alias_matching_is_case_tolerant(self):
        assert validate_deal_type("earnings & results") == "Earnings"


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
