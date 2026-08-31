"""The audit's key port must equal backend/company_match.normalize_company_key.

That equality IS the contract. sql/proposals/0020b section 1 says the SQL
function must stay byte-identical to normalize_company_key, and the audit tool
ports the same rule into Python so it can measure the plan without a database.
Three implementations, one rule; any two drifting apart is the bug.

It has already happened once. The SQL used [[:punct:]], which is LOCALE
DEPENDENT and under a UTF-8 LC_CTYPE resolves to Unicode P* only, excluding the
ASCII symbols $ + < = > ^ \\ | ~ that Python's string.punctuation includes.
'Disney+' keyed to 'disney+' and '$MIR' to '$mir' in SQL while the application
folded both, so the audit measured 825 clusters and section 3 built 823.
"""
import os
import re
import string
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "backend"))

from norm_v2_edgar_audit import lookup_key_v2  # noqa: E402
from company_match import normalize_company_key  # noqa: E402


CASES = [
    "Caterpillar Inc.", "Archer-Daniels-Midland", "Kioxia Holdings Corp.",
    "Estée Lauder", "Group", "Moody's Analytics", "BP p.l.c.", "SAP SE",
    "Nokia Oyj", "The Coca-Cola Company", "Disney+", "$MIR", "Disney",
    "Mir", "AT&T", "Yahoo!", "E*TRADE", "Match.com", "3M", "L'Oréal",
    "Berkshire Hathaway Inc", "Prysmian Spa", "Equinor ASA", "AirTrunk Pte.",
    "IFM Investors Pty Ltd", "Schneider Electric S.E.",
]


@pytest.mark.parametrize("name", CASES)
def test_port_matches_the_application_matcher(name):
    assert lookup_key_v2(name) == normalize_company_key(name), name


@pytest.mark.parametrize("ch", list(string.punctuation))
def test_every_ascii_punctuation_char_folds_identically(ch):
    """The nine symbols $ + < = > ^ \\ | ~ are the ones a Unicode-only punct
    class silently keeps. Cover the whole set, not just the two that bit us."""
    name = f"Acme{ch}Corp"
    assert lookup_key_v2(name) == normalize_company_key(name), repr(ch)


def test_the_two_regression_cases_actually_fold():
    """Guards the assertion above from passing because BOTH sides broke."""
    assert lookup_key_v2("Disney+") == "disney"
    assert lookup_key_v2("$MIR") == "mir"


def test_sql_translate_operands_match_string_punctuation():
    """The SQL fix must be the same 32 characters, and the from/to strings must
    be equal length: translate() DELETES characters past the end of `to`."""
    repo = os.path.join(os.path.dirname(__file__), "..", "..")
    src = open(os.path.join(repo, "sql", "proposals",
                            "0020b_norm_v2_revised_phases.sql")).read()
    m = re.search(r"v_punct := translate\(\s*v_punct,\s*'((?:[^']|'')*)',\s*'( *)'\s*\);", src)
    assert m, "the translate() call is missing from section 1"
    frm, to = m.group(1).replace("''", "'"), m.group(2)
    assert frm == string.punctuation
    assert len(frm) == len(to) == 32
    # Comments legitimately NAME the class while explaining why it is gone, so
    # strip them before asserting it is not being CALLED.
    executable = "\n".join(re.sub(r"--.*$", "", ln) for ln in src.splitlines())
    assert "[[:punct:]]" not in executable, "the locale-dependent class is back"
