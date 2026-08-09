"""
Parity between backend/verdict_vocabulary.py and src/lib/verdict-vocabulary.ts.

The two files cannot import each other, so this test reads the TypeScript
source and asserts the Python mirror says the same words. #543 extracted the
canonical table on the TS side and four surfaces stopped saying Right/Wrong;
the Python email template kept its own copy and did not. This test is the thing
that makes "there is one vocabulary" true rather than aspirational.

Run: python -m unittest backend.tests.test_verdict_vocabulary_parity -v
"""

from __future__ import annotations

import os
import re
import sys
import unittest

_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.dirname(_HERE)
_REPO = os.path.dirname(_BACKEND)
for _p in (_BACKEND, _REPO):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from verdict_vocabulary import (  # noqa: E402
    TS_SOURCE,
    VERDICT_WORD,
    resolution_for_verdict,
    verdict_word,
)

#: supported: "Supported",  /  noCleanRead: "No clean read",  /  notGraded: undefined,
_ENTRY = re.compile(r"^\s*(\w+)\s*:\s*(?:\"([^\"]*)\"|undefined)\s*,", re.MULTILINE)


def _ts_verdict_word() -> dict[str, str | None]:
    """Parse VERDICT_WORD out of the TypeScript source of truth."""
    path = os.path.join(_REPO, TS_SOURCE)
    with open(path, encoding="utf-8") as fh:
        source = fh.read()
    start = source.index("export const VERDICT_WORD")
    body = source[start : source.index("};", start)]
    return {key: value if value else None for key, value in _ENTRY.findall(body)}


class TestVocabularyParity(unittest.TestCase):
    def test_the_typescript_source_is_where_we_think_it_is(self):
        self.assertTrue(
            os.path.exists(os.path.join(_REPO, TS_SOURCE)),
            f"{TS_SOURCE} moved; update TS_SOURCE in verdict_vocabulary.py",
        )

    def test_every_word_matches_the_typescript_table(self):
        ts = _ts_verdict_word()
        self.assertTrue(ts, "parsed nothing out of the TS file")
        for bucket, word in ts.items():
            if word is None:
                # notGraded is undefined in TS and absent in Python on purpose.
                self.assertNotIn(
                    bucket, VERDICT_WORD, f"{bucket} must stay absent in Python"
                )
                continue
            self.assertIn(bucket, VERDICT_WORD, f"TS has {bucket}, Python does not")
            self.assertEqual(VERDICT_WORD[bucket], word, bucket)

    def test_python_adds_no_word_the_typescript_side_does_not_know(self):
        ts = _ts_verdict_word()
        # "awaiting" is the one Python-only bucket: the email can render an open
        # call, which the scored-object card models as a state rather than a
        # verdict. Everything else must exist on both sides.
        extra = set(VERDICT_WORD) - set(ts) - {"awaiting"}
        self.assertEqual(extra, set(), f"Python invented {extra}")

    def test_the_retired_words_are_gone_from_both_sides(self):
        path = os.path.join(_REPO, TS_SOURCE)
        with open(path, encoding="utf-8") as fh:
            ts_source = fh.read()
        for retired in ("Right", "Wrong"):
            self.assertNotIn(f'"{retired}"', ts_source)
            self.assertNotIn(retired, VERDICT_WORD.values())


class TestVerdictMapping(unittest.TestCase):
    def test_stored_verdicts_map_to_the_observational_words(self):
        self.assertEqual(verdict_word("correct"), "Supported")
        self.assertEqual(verdict_word("wrong"), "Challenged")
        self.assertEqual(verdict_word("ungradable"), "No clean read")
        self.assertEqual(verdict_word("open"), "Awaiting")

    def test_partial_is_never_rounded_up_into_a_hit(self):
        self.assertEqual(resolution_for_verdict("partial"), "noCleanRead")
        self.assertEqual(verdict_word("partial"), "No clean read")

    def test_unknown_and_empty_degrade_to_no_clean_read(self):
        for raw in ("", None, "  ", "garbage", "MOSTLY_RIGHT"):
            self.assertEqual(verdict_word(raw), "No clean read", repr(raw))

    def test_casing_and_padding_do_not_change_the_word(self):
        self.assertEqual(verdict_word("  CORRECT "), "Supported")

    def test_every_bucket_has_a_word_so_the_lookup_cannot_keyerror(self):
        from verdict_vocabulary import RESOLUTION_BY_VERDICT

        for bucket in set(RESOLUTION_BY_VERDICT.values()):
            self.assertIn(bucket, VERDICT_WORD, bucket)


if __name__ == "__main__":
    unittest.main(verbosity=2)
