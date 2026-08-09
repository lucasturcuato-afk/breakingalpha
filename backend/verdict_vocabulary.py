"""
verdict_vocabulary.py - the ONE Python mapping from a graded state to the word
shown to a reader. Mirrors src/lib/verdict-vocabulary.ts exactly.

The vocabulary is observational, never a grade on a person: supported,
challenged, no clean read, awaiting. Attribution-based grading cannot support
the certainty "wrong" implies. The grader checks whether a move can be told
apart from its sector and the market; a direction that did not hold is a claim
the evidence challenged, not a person who was wrong.

#543 removed Right/Wrong from four TypeScript surfaces and extracted the table
to src/lib/verdict-vocabulary.ts. The email template kept a private copy and
therefore kept saying "Wrong" months after every other surface stopped. This
module exists so the Python side has exactly one copy too, and
tests/test_verdict_vocabulary_parity.py reads the TypeScript file and asserts
the two agree, so the pair cannot drift again without a red test.

Pure. No IO, no env, no network.
"""

from __future__ import annotations

#: Path of the TypeScript source of truth, relative to the repo root. The
#: parity test reads this file; nothing here imports it at runtime.
TS_SOURCE = "src/lib/verdict-vocabulary.ts"

#: Resolution bucket -> the word a reader sees. Keys and values must stay
#: identical to VERDICT_WORD in TS_SOURCE.
#:
#: "notGraded" is absent on purpose, matching the TypeScript `undefined`: an
#: absence is not a verdict, and the caller renders the reason instead.
VERDICT_WORD: dict[str, str] = {
    "supported": "Supported",
    "challenged": "Challenged",
    "noCleanRead": "No clean read",
    "awaiting": "Awaiting",
}

#: Stored `morning_brief_call_outcomes.verdict` -> resolution bucket.
#:
#: "partial" folds to noCleanRead rather than to a hit. A partially supported
#: direction is precisely the case attribution cannot separate from noise, and
#: rounding it up would quietly inflate the record this email exists to keep
#: honest.
RESOLUTION_BY_VERDICT: dict[str, str] = {
    "correct": "supported",
    "supported": "supported",
    "wrong": "challenged",
    "challenged": "challenged",
    "partial": "noCleanRead",
    "inconclusive": "noCleanRead",
    "ungradable": "noCleanRead",
    "open": "awaiting",
    "pending": "awaiting",
}

#: What an unrecognized verdict degrades to. Never a hit.
DEFAULT_RESOLUTION = "noCleanRead"


def resolution_for_verdict(verdict: str | None) -> str:
    """Bucket a stored verdict string. Unknown values degrade to noCleanRead."""
    key = (verdict or "").strip().lower()
    return RESOLUTION_BY_VERDICT.get(key, DEFAULT_RESOLUTION)


def verdict_word(verdict: str | None) -> str:
    """The reader-facing word for a stored verdict.

    Total by construction: every bucket in RESOLUTION_BY_VERDICT has an entry
    in VERDICT_WORD, and anything unrecognized lands on DEFAULT_RESOLUTION.
    """
    return VERDICT_WORD[resolution_for_verdict(verdict)]
