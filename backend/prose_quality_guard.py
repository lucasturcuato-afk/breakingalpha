"""D15 prose quality guard: reject specific garbled constructions in the brief's
highest-distribution prose (lead_paragraph + market_pulse.narrative).

The bug: the morning brief shipped "Micron Technology's stock surge to a new
all-time high today ... underscores increasing investor confidence". "stock
surge ... underscores" is a noun phrase wired into a verb slot: it should read
"stock surged ..., and the move underscores ...". The existing voice guard
(first-person / recommendations) does not catch this.

This is NOT a general grammar engine. It is a tight, deterministic detector for a
small set of high-signal garbled patterns, plus a single targeted re-ask wired by
the caller. Pure and stdlib-only (re). Conservative: it flags only constructions
that are confidently broken, to avoid re-asking on good prose.
"""
from __future__ import annotations

import re

# Singular present-tense verbs that take a clause subject. When the SUBJECT of one
# of these is a bare noun phrase built on an event noun ("surge", "rise", "drop",
# "gain", "decline", "jump", "plunge", "rally", "move", "increase") with no verb
# of its own, the sentence reads as a fragment: "stock surge ... underscores".
_EVENT_NOUNS = (
    "surge", "surges", "rise", "rises", "drop", "drops", "gain", "gains",
    "decline", "declines", "jump", "jumps", "plunge", "plunges", "rally",
    "rallies", "fall", "falls", "climb", "climbs", "slide", "slides",
)
_CLAUSE_VERBS = (
    "underscores", "underscore", "highlights", "highlight", "signals",
    "signal", "reflects", "reflect", "suggests", "suggest", "marks",
    "mark", "shows", "show", "demonstrates", "demonstrate", "indicates",
    "indicate",
)


def _has_event_noun_subject_then_clause_verb(sentence: str) -> bool:
    """True when a sentence contains '<event noun> ... <clause verb>' with no
    intervening sentence-ending or finite verb on the event noun, i.e. the event
    noun is being used as a clause subject without its own predicate. Matches the
    'stock surge ... underscores' shape. Conservative window: the verb must follow
    the event noun within the same sentence."""
    low = sentence.lower()
    for noun in _EVENT_NOUNS:
        # Restrict to the COMPOUND-noun fragment signature that the bug exhibits:
        # a price/stock noun directly modifying the event noun ("stock surge",
        # "share price drop", "stock rally"), optionally with a possessive ("'s").
        # A clean determiner subject ("the rally signals ...") is grammatical and
        # must NOT be flagged, so it is intentionally excluded here.
        npat = re.compile(
            r"\b(?:stock|share|shares|price)(?:'s)?\s+" + re.escape(noun) + r"\b"
        )
        m = npat.search(low)
        if not m:
            continue
        tail = low[m.end():]
        for verb in _CLAUSE_VERBS:
            vpat = re.compile(r"\b" + re.escape(verb) + r"\b")
            vm = vpat.search(tail)
            if not vm:
                continue
            between = tail[:vm.start()]
            # If the event noun got its own past-tense / gerund predicate before the
            # clause verb, it is a well-formed sentence; do not flag.
            if re.search(r"\b(?:surged|rose|dropped|gained|declined|jumped|plunged|"
                         r"rallied|fell|climbed|slid|was|were|is|are|has|have|had)\b",
                         between):
                break
            return True
    return False


def _split_sentences(text: str) -> list[str]:
    # Light sentence split on terminal punctuation; good enough for detection.
    parts = re.split(r"(?<=[.!?])\s+", text.strip())
    return [p for p in parts if p.strip()]


def detect_garbled_prose(text: str) -> list[str]:
    """Return a list of garbled-construction reasons found in `text`. Empty list
    means the prose passes. Pure, never raises."""
    reasons: list[str] = []
    if not text or not isinstance(text, str):
        return reasons
    for sent in _split_sentences(text):
        if _has_event_noun_subject_then_clause_verb(sent):
            reasons.append(
                "noun-phrase event subject wired into a clause verb "
                f"(e.g. 'stock surge ... underscores'): {sent[:120]}"
            )
        # Doubled punctuation / empty clause artifacts.
        if re.search(r"[,;]\s*[,;]", sent):
            reasons.append(f"doubled punctuation: {sent[:120]}")
        # Dangling preposition into a terminal (a clause was dropped).
        if re.search(r"\b(?:on|at|as of|of|to|with)\s*[.;]", sent, re.IGNORECASE):
            reasons.append(f"dangling preposition before terminal: {sent[:120]}")
    return reasons


def has_garbled_prose(text: str) -> bool:
    return len(detect_garbled_prose(text)) > 0


def build_prose_correction(reasons: list[str]) -> str:
    """The correction note handed to the single targeted re-ask. Explicit failure
    example per the spec; not a general grammar lecture."""
    head = (
        "The prose below is grammatically broken. Rewrite ONLY to fix the grammar; "
        "keep every fact, figure, name, and the paragraph count.\n"
        "Failure example: \"Micron's stock surge to a new all-time high today "
        "underscores investor confidence\" -> \"Micron's stock surged to a new "
        "all-time high, and the move underscores investor confidence.\" Do not turn "
        "a noun phrase ('the surge') into the subject of a verb without giving it a "
        "verb of its own.\n"
    )
    if reasons:
        head += "Detected issues:\n- " + "\n- ".join(reasons[:6]) + "\n"
    return head
