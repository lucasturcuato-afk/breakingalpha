"""parse_pre_block must not silently lose keys.

The list lives in SQL comments as much as in SQL. Two things in those comments
have already broken this parse, and both were SILENT: the result looked like a
clean list, just a shorter one, and a dropped key means a contaminated cluster
quietly becomes mergeable.
"""
import os
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from norm_v2_edgar_audit import parse_pre_block  # noqa: E402


def _write(body):
    f = tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, encoding="utf-8")
    f.write("-- PRE-BLOCK LIST\nUPDATE t SET risk='block'\n WHERE new_key IN (\n"
            + body + "\n );\n")
    f.close()
    return f.name


def test_plain_list():
    assert parse_pre_block(_write("   'aa',\n   'bb',\n   'cc'")) == ["aa", "bb", "cc"]


def test_comment_containing_a_closing_paren_does_not_truncate():
    """The real bug: '-- biotech); the identifier ...' ended the list early and
    dropped the entry after it, parsing 27 of 28 keys with no error."""
    body = ("   'aa',\n"
            "   'bb',       -- CSL Limited (CSL.AX, Australian\n"
            "                -- biotech); the identifier is suspect\n"
            "   'cc'")
    assert parse_pre_block(_write(body)) == ["aa", "bb", "cc"]


def test_quoted_words_in_comments_are_not_entries():
    body = ("   'aa',        -- 'Tata' could be Tata Motors\n"
            "   'bb'         -- Boyd Gaming's symbol\n")
    assert parse_pre_block(_write(body)) == ["aa", "bb"]


def test_comment_only_lines_are_skipped():
    body = ("   -- a heading comment with 'quotes' in it\n"
            "   'aa',\n"
            "   -- another\n"
            "   'bb'")
    assert parse_pre_block(_write(body)) == ["aa", "bb"]


def test_empty_list_is_refused():
    with pytest.raises(SystemExit):
        parse_pre_block(_write("   -- everything commented out\n"))


def test_unterminated_list_is_refused():
    f = tempfile.NamedTemporaryFile("w", suffix=".sql", delete=False, encoding="utf-8")
    f.write("-- PRE-BLOCK LIST\n WHERE new_key IN (\n   'aa',\n   'bb'\n")
    f.close()
    with pytest.raises(SystemExit):
        parse_pre_block(f.name)


def test_the_live_migration_parses_every_listed_key():
    keys = parse_pre_block()
    assert len(keys) == len(set(keys)), "duplicate key in the pre-block list"
    for required in ("axt", "compass", "tencent", "agi", "stran", "science", "csl"):
        assert required in keys, f"{required} missing from the live pre-block list"
