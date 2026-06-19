"""brief_voice_guard.py -- deterministic impersonal/informational-only voice guard
for the daily briefs (morning brief + evening wrap market_pulse.narrative).

Python port of src/lib/brief-voice-guard.ts (PR #389), which is the source of
truth for the detection patterns and the FAIL-CLOSED contract. Kept in parity:

  1. Impersonal voice: no first person, singular or plural, including the
     institutional "we".
  2. Informational only: no reader-directed recommendation or exposure phrase.

Contract (enforce_brief_voice): detect -> one bounded re-ask -> fail-closed
fallback. On a double failure a reader-directed recommendation must NEVER
survive, even at the cost of leftover first person:
  (1) prefer any draft that is already recommendation-free (least first person
      among them); else
  (2) redact the recommendation-bearing sentences out of the least-first-person
      draft so the surfaced text is provably recommendation-free.

Pure and unit-testable: no network, no secrets, no DB. The caller injects the
model call as `regenerate`, mirroring the TS guard and the PR #385 opener guard.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable, Optional

# Pattern SOURCES (not compiled module-level objects). The TS guard rebuilds a
# fresh RegExp per check because its shared /g patterns carry lastIndex state.
# Python re objects are stateless, but we mirror the TS structure and compile
# fresh per check so there is provably no shared regex state.

# First person, singular and plural, plus contractions. Bare "i" is handled
# separately (enumerator exclusion needs a variable-width lookbehind that
# Python re does not support, so it is done in code below).
_FIRST_PERSON_SOURCES = [
    r"\b(?:we|us|our|ours|ourselves|me|my|mine|myself)\b",
    r"\b(?:we're|we've|we'll|we'd|i'm|i've|i'll|i'd|let's|lets)\b",
]

# Enumerators that make a bare "I" a roman-numeral-style label, not first person
# ("Class I", "Phase I", "Series I"). Mirrors the TS lookbehind list.
_BARE_I_ENUMERATORS = frozenset(
    {"class", "phase", "series", "type", "tier", "grade",
     "category", "part", "level", "form", "section"}
)

# Reader-directed recommendations and exposure/sizing guidance. Ported verbatim
# from the TS RECOMMENDATION_PATTERNS for parity.
_RECOMMENDATION_SOURCES = [
    r"\brecommend(?:s|ed|ing|ation|ations)?\b",
    r"\b(?:over|under)weight\b",
    r"\byou\s+(?:should|must|need\s+to|ought|may\s+want\s+to|can|could)\b",
    r"\b(?:increase|increasing|reduce|reducing|raise|raising|lower|lowering|cut|cutting|"
    r"boost|boosting|trim|trimming|pare|paring|build|building|scale|scaling)\s+"
    r"(?:your\s+|the\s+)?(?:exposure|position|positions|stake|allocation|holdings?|weighting)\b",
    r"\b(?:buy|sell)\b(?![-\s](?:side|off))",
    r"\badd(?:ing)?\s+to\s+(?:your\s+|the\s+)?position\b",
    r"\btake\s+profits?\b",
    r"\bgo\s+(?:long|short)\b",
]


@dataclass
class VoiceViolations:
    first_person: list[str]
    recommendations: list[str]


def _collect(text: str, sources: list[str]) -> list[str]:
    """Distinct lowercased matches across freshly compiled patterns."""
    hits: list[str] = []
    seen: set[str] = set()
    for src in sources:
        for m in re.compile(src, re.IGNORECASE).finditer(text):
            key = re.sub(r"\s+", " ", m.group(0).lower())
            if key not in seen:
                seen.add(key)
                hits.append(key)
    return hits


def _bare_i_matches(text: str) -> list[str]:
    """Bare 'i' / 'I' as first person, skipping enumerator labels like 'Class I'."""
    found = False
    for m in re.compile(r"\bi\b", re.IGNORECASE).finditer(text):
        prefix = text[: m.start()]
        pw = re.search(r"([A-Za-z]+)\s$", prefix)
        if pw and pw.group(1).lower() in _BARE_I_ENUMERATORS:
            continue
        found = True
    return ["i"] if found else []


def detect_voice_violations(memo: Optional[str]) -> VoiceViolations:
    text = memo or ""
    first = _collect(text, _FIRST_PERSON_SOURCES)
    for tok in _bare_i_matches(text):
        if tok not in first:
            first.append(tok)
    return VoiceViolations(first_person=first, recommendations=_collect(text, _RECOMMENDATION_SOURCES))


def violation_count(v: VoiceViolations) -> int:
    return len(v.first_person) + len(v.recommendations)


def has_voice_violation(memo: Optional[str]) -> bool:
    return violation_count(detect_voice_violations(memo)) > 0


def redact_recommendations(text: str) -> str:
    """Remove recommendation-bearing content so the result is provably free of any
    reader-directed recommendation/exposure phrase. Drops whole sentences that
    carry a recommendation (preserving headings and compliant sentences), then
    neutralizes any residual token. First person is left untouched. Fallback path
    only. Each pattern is compiled fresh here so there is no shared regex state."""
    rec_patterns = [re.compile(src, re.IGNORECASE) for src in _RECOMMENDATION_SOURCES]

    def carries_recommendation(s: str) -> bool:
        return any(p.search(s) for p in rec_patterns)

    out_lines = []
    for line in text.split("\n"):
        if not line.strip():
            out_lines.append(line)
            continue
        sentences = re.split(r"(?<=[.!?])\s+", line)
        out_lines.append(" ".join(s for s in sentences if not carries_recommendation(s)))

    out = "\n".join(out_lines)
    # Final guarantee: neutralize any residual phrase not bounded by sentence
    # punctuation (e.g. inside a bullet with no terminal period, or a heading).
    for p in rec_patterns:
        out = p.sub("[redacted]", out)
    out = re.sub(r"[ \t]{2,}", " ", out)
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out.strip()


def build_voice_correction(v: VoiceViolations) -> str:
    """Corrective instruction for the bounded re-ask. Names the detected
    violations so the model targets them without rewriting the substance."""
    found = list(v.first_person) + list(v.recommendations)
    found_line = (
        "Detected violations to remove: " + ", ".join(f'"{f}"' for f in found) + "."
        if found
        else ""
    )
    parts = [
        "COMPLIANCE REWRITE REQUIRED. The previous draft broke two hard rules. Rewrite the "
        "SAME brief: same facts, same structure, same paragraph count. Change ONLY the wording "
        "needed to comply.",
        "1. IMPERSONAL VOICE: remove ALL first person, singular and plural. No \"we\", \"us\", "
        "\"our\", \"I\", \"me\", \"my\". Do not use the institutional \"we\". Own every stance with "
        "a named actor, metric, filing, or event as the grammatical subject.",
        "2. INFORMATIONAL ONLY: no reader-directed recommendations or exposure guidance on any "
        "named security. Remove \"recommend\", \"buy\", \"sell\", \"increase exposure\", "
        "\"reduce exposure\", \"overweight\", \"underweight\", \"trim\", \"add to position\", "
        "\"take profits\", \"you should\". State what each development means, not what the reader "
        "should do.",
        found_line,
        "Keep the substance and paragraph count. Zero em-dashes; use periods and new sentences.",
    ]
    return "\n".join(p for p in parts if p)


@dataclass
class EnforceResult:
    memo: str
    violations_before: VoiceViolations
    reasked: bool
    still_violating: bool


def enforce_brief_voice(
    memo: str,
    regenerate: Callable[[str], Optional[str]],
    max_reasks: int = 1,
) -> EnforceResult:
    """Detect -> bounded re-ask -> FAIL-CLOSED fallback. Never raises. The surfaced
    text is always recommendation-free; first person may remain on the fallback
    path. `regenerate(correction)` returns the rewritten text or None on failure."""
    before = detect_voice_violations(memo)
    if violation_count(before) == 0:
        return EnforceResult(memo, before, False, False)

    reasked = False
    candidates = [memo]  # original first, then each non-empty re-ask

    for _ in range(max_reasks):
        correction = build_voice_correction(detect_voice_violations(candidates[-1]))
        nxt = regenerate(correction)
        reasked = True
        if nxt and nxt.strip():
            if not has_voice_violation(nxt):
                return EnforceResult(nxt, before, reasked, False)
            candidates.append(nxt)

    # No fully clean draft. Fail closed on recommendations.
    scored = [(text, detect_voice_violations(text)) for text in candidates]

    # 1. A recommendation-free draft can be surfaced as-is (first person may remain).
    #    min() is stable, so the earliest least-first-person draft wins on a tie.
    rec_free = [(t, v) for (t, v) in scored if len(v.recommendations) == 0]
    if rec_free:
        text, v = min(rec_free, key=lambda c: len(c[1].first_person))
        return EnforceResult(text, before, reasked, len(v.first_person) > 0)

    # 2. Every draft carries a recommendation: redact it out of the least-first-
    #    person draft so the surfaced text is provably recommendation-free.
    base_text, _v = min(scored, key=lambda c: len(c[1].first_person))
    redacted = redact_recommendations(base_text)
    after = detect_voice_violations(redacted)
    return EnforceResult(redacted, before, reasked, violation_count(after) > 0)
