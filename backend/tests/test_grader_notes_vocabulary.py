"""
The grader's verdict_notes sentence obeys the product's own copy rules.

verdict_notes is not internal. Two screens render it verbatim through
ScoredObject's calibration slot (`calibration: outcome.verdict_notes` in
src/lib/scored-object-map.ts): /review draws it as the grader's reading, and
/radar/calls draws it under each resolved call. So the sentence this module
composes is reader-facing copy and is bound by the same two rules the mobile
design gate (scripts/design-lint.mjs) enforces over src/:

  rule 1  banned substrings: buy, sell, hold, allocation, returns, performance
  rule 3  the outcome vocabulary is exactly supported / challenged /
          developing / awaiting. Right / wrong / correct / incorrect / win /
          won / loss / lost are out.

The composer used to interpolate the STORED verdict token straight into the
prose: "Bullish call graded correct (clean): OKLO moved +2.06% vs SPY -0.01%."
That is a raw column value in reader-facing text, outside the vocabulary, in
the exact position a reader reads a verdict from. design-lint never saw it
because design-lint lints src/ and this sentence is written in Python and
arrives through the database.

This test is that gate. It runs the composer over every verdict x attribution
combination, not a sample, so a future edit cannot restore a banned word on the
one branch nobody wrote a case for.

Run: python -m unittest backend.tests.test_grader_notes_vocabulary -v
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

from backend.grading.grade_brief_calls import (  # noqa: E402
    gemini_verdict_notes,
    ungradable_notes,
)
from backend.grading.resolver import Outcome  # noqa: E402
from backend.verdict_vocabulary import VERDICT_WORD  # noqa: E402

#: The design gate's own rule table, READ OUT OF THE GATE rather than mirrored
#: here. A second hand-typed copy of a lint's rules drifts from the lint the
#: first time someone widens rule 1 and does not know this file exists. Same
#: technique, and the same reason, as test_verdict_vocabulary_parity.py, which
#: reads src/lib/verdict-vocabulary.ts instead of restating it.
DESIGN_LINT_SOURCE = os.path.join(_REPO, "scripts", "design-lint.mjs")


def _design_lint_rules() -> tuple[tuple[str, ...], "re.Pattern[str]"]:
    """(banned substrings, forbidden-outcome-word pattern) from the lint."""
    with open(DESIGN_LINT_SOURCE, encoding="utf-8") as fh:
        src = fh.read()

    block = re.search(r"const BANNED = \[([^\]]*)\]", src)
    assert block, f"rule 1 not found in {DESIGN_LINT_SOURCE}"
    banned = tuple(re.findall(r"'([^']+)'", block.group(1)))
    assert len(banned) >= 6, f"rule 1 parsed as {len(banned)} terms, expected 6+"

    forbidden = re.search(r"const OUTCOME_FORBIDDEN = /(.+)/([a-z]*);", src)
    assert forbidden, f"rule 3 not found in {DESIGN_LINT_SOURCE}"
    flags = re.IGNORECASE if "i" in forbidden.group(2) else 0
    return banned, re.compile(forbidden.group(1), flags)


BANNED_SUBSTRINGS, OUTCOME_FORBIDDEN = _design_lint_rules()

#: Rule 2, escaped so this file is not itself a violation of it.
EM_DASH = "\u2014"

VERDICTS = ("correct", "wrong", "partial", "inconclusive", "ungradable", "open")
ATTRIBUTIONS = ("clean", "confounded", "inconclusive", None)
DIRECTIONS = ("bullish", "bearish")


def _outcome(verdict: str, attribution: str | None) -> Outcome:
    """A graded row with realistic benchmark metadata."""
    return Outcome(
        verdict=verdict,
        attribution=attribution,
        actual_pct_change=0.0206,
        actual_direction="up",
        metadata={
            "grader": "price_attribution_v1",
            "entity_symbol": "OKLO",
            "entity_move_pct": 2.06,
            "benchmarks": [
                {"symbol": "XLK", "role": "sector", "move_pct": 1.15},
                {"symbol": "SPY", "role": "market", "move_pct": -0.01},
            ],
        },
    )


class GraderNotesVocabulary(unittest.TestCase):
    def _assert_clean(self, sentence: str, label: str) -> None:
        lowered = sentence.lower()
        for banned in BANNED_SUBSTRINGS:
            self.assertNotIn(
                banned, lowered, f"banned substring {banned!r} in {label}: {sentence}"
            )
        match = OUTCOME_FORBIDDEN.search(sentence)
        self.assertIsNone(
            match,
            f"outcome word outside the vocabulary in {label}: {sentence}",
        )
        self.assertNotIn(EM_DASH, sentence, f"em-dash in {label}: {sentence}")

    def test_every_combination_is_clean(self):
        """No banned substring and no forbidden outcome word, on any branch."""
        checked = 0
        for verdict in VERDICTS:
            for attribution in ATTRIBUTIONS:
                for direction in DIRECTIONS:
                    sentence = gemini_verdict_notes(
                        "OKLO clears its sector into the print",
                        direction,
                        _outcome(verdict, attribution),
                    )
                    self._assert_clean(
                        sentence, f"{direction}/{verdict}/{attribution}"
                    )
                    checked += 1
        self.assertEqual(checked, len(VERDICTS) * len(ATTRIBUTIONS) * len(DIRECTIONS))

    def test_pins_the_exact_sentence(self):
        """The replacement text, pinned. Red on any silent rephrase.

        The first two are the strings /review and /radar/calls rendered before
        this change, rebuilt from the same rows:
          "Bullish call graded correct (clean): OKLO moved +2.06% vs SPY -0.01%."
          "Bullish call graded wrong (confounded): BEKE moved ..."
        """
        self.assertEqual(
            gemini_verdict_notes("x", "bullish", _outcome("correct", "clean")),
            "Supported. Bullish call, attribution clean:"
            " OKLO moved +2.06% vs XLK +1.15%, SPY -0.01%.",
        )
        self.assertEqual(
            gemini_verdict_notes("x", "bearish", _outcome("wrong", "clean")),
            "Challenged. Bearish call, attribution clean:"
            " OKLO moved +2.06% vs XLK +1.15%, SPY -0.01%.",
        )
        self.assertEqual(
            gemini_verdict_notes("x", "bullish", _outcome("wrong", "confounded")),
            "No clean read. Bullish call, attribution confounded:"
            " OKLO moved +2.06% vs XLK +1.15%, SPY -0.01%.",
        )
        self.assertEqual(
            gemini_verdict_notes("x", "bullish", _outcome("correct", None)),
            "Supported. Bullish call, attribution not recorded:"
            " OKLO moved +2.06% vs XLK +1.15%, SPY -0.01%.",
        )

    def test_attribution_wins_over_direction(self):
        """A move the grader could not credit is No clean read, either way.

        Same rule as scoredCallProps in src/lib/scored-object-map.ts. Without
        it the note reads "Challenged" beside a card reading "No clean read"
        for the same row.
        """
        from backend.grading.grade_brief_calls import outcome_word

        for attribution in ("confounded", "inconclusive"):
            for verdict in ("correct", "wrong", "partial"):
                self.assertEqual(
                    outcome_word(_outcome(verdict, attribution)),
                    VERDICT_WORD["noCleanRead"],
                    f"{verdict}/{attribution} must never read as a direction",
                )
        self.assertEqual(
            outcome_word(_outcome("correct", "clean")), VERDICT_WORD["supported"]
        )
        self.assertEqual(
            outcome_word(_outcome("wrong", "clean")), VERDICT_WORD["challenged"]
        )

    def test_the_word_comes_from_the_shared_table(self):
        """Every word the composer can emit is one the vocabulary defines."""
        from backend.grading.grade_brief_calls import outcome_word

        emitted = {
            outcome_word(_outcome(v, a)) for v in VERDICTS for a in ATTRIBUTIONS
        }
        self.assertTrue(emitted)
        self.assertTrue(
            emitted.issubset(set(VERDICT_WORD.values())),
            f"words outside verdict_vocabulary.VERDICT_WORD: "
            f"{emitted - set(VERDICT_WORD.values())}",
        )

    def test_ungradable_refusal_is_also_clean(self):
        """The not-graded sentence renders on the same surfaces."""
        for reason in (
            "unmapped_symbol",
            "no_price_data",
            "no_benchmark_data",
            "no_honest_grader",
            "something_new",
        ):
            outcome = Outcome(
                verdict="ungradable",
                metadata={"ungradable_reason": reason, "ungradable_detail": ""},
            )
            self._assert_clean(ungradable_notes(outcome), f"ungradable/{reason}")


if __name__ == "__main__":
    unittest.main()
