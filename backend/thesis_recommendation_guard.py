"""thesis_recommendation_guard.py -- deterministic informational-only guard for
GENERATED theses (title + rationale).

A registered rep cannot surface named-security directional recommendations.
Thesis titles historically opened with a directive prefix ("Buy AeroVironment...",
"Long JPMorgan...", "Short Defense Suppliers") and rationales closed with a
recommended-vehicle line ("The cleanest expression is AVAV, because ..."). Those
cross the informational-only line. This guard enforces descriptive framing
deterministically, because prompt text alone drifts under token pressure.

Python port of src/lib/thesis-recommendation-guard.ts, kept in parity, and
modeled EXACTLY on brief_voice_guard.py (PR #389 / #393): detect -> one bounded
re-ask -> FAIL-CLOSED fallback. On a double failure a directional recommendation
must NEVER survive:
  1. prefer any candidate that is already recommendation-free; else
  2. strip the directional title prefix and redact the recommendation/vehicle
     sentences out of the rationale so the surfaced text is provably clean.

What this guard does NOT touch: the structured fields the grader reads
(conviction, ticker, direction-via-conviction, horizon, verifiable_signal). Only
the reader-facing title and rationale are made descriptive. Grading stays as-is.

Pure and unit-testable: no network, no secrets, no DB. The caller injects the
model call as `regenerate`, mirroring the TS guard and the brief voice guard.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Callable, Optional

# Directional title prefixes the old prompt mandated. Anchored to the start of
# the title only. "Watch" is included per the recommendation-guard spec; it is a
# directive framing even though softer than buy/sell.
_TITLE_PREFIX_SOURCE = r"^\s*(?:buy|sell|long|short|avoid|watch)\b[\s:,-]*"

# Recommended-vehicle / best-way-to-play phrasings ("the cleanest expression is
# AVAV"). These name a security as a recommended instrument, not a subject of
# analysis.
_VEHICLE_SOURCES = [
    r"\b(?:the\s+)?cleanest\s+(?:expression|way\s+to\s+play)\b",
    r"\b(?:the\s+)?(?:best|purest|simplest)\s+(?:expression|way\s+to\s+play)\b",
    r"\bbest\s+way\s+to\s+(?:play|express)\b",
]

# Reader-directed recommendations and exposure/sizing guidance. Ported verbatim
# from brief_voice_guard._RECOMMENDATION_SOURCES for parity, so the two guards
# share one definition of "a recommendation".
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
class ThesisViolations:
    # The matched directional title prefix (lowercased), e.g. "buy ". Empty when
    # the title is already descriptive.
    directional_title: list[str] = field(default_factory=list)
    # Recommended-vehicle phrases found in title or rationale.
    vehicle: list[str] = field(default_factory=list)
    # Reader-directed recommendation/exposure phrases found in title or rationale.
    recommendations: list[str] = field(default_factory=list)


def _collect(text: str, sources: list[str]) -> list[str]:
    """Distinct lowercased matches across freshly compiled patterns."""
    hits: list[str] = []
    seen: set[str] = set()
    for src in sources:
        for m in re.compile(src, re.IGNORECASE).finditer(text):
            key = re.sub(r"\s+", " ", m.group(0).lower()).strip()
            if key and key not in seen:
                seen.add(key)
                hits.append(key)
    return hits


def detect_thesis_violations(
    title: Optional[str], rationale: Optional[str]
) -> ThesisViolations:
    t = title or ""
    r = rationale or ""
    combined = f"{t}\n{r}"
    prefix = _collect(t, [_TITLE_PREFIX_SOURCE])
    return ThesisViolations(
        directional_title=prefix,
        vehicle=_collect(combined, _VEHICLE_SOURCES),
        recommendations=_collect(combined, _RECOMMENDATION_SOURCES),
    )


def violation_count(v: ThesisViolations) -> int:
    return len(v.directional_title) + len(v.vehicle) + len(v.recommendations)


def has_thesis_violation(title: Optional[str], rationale: Optional[str]) -> bool:
    return violation_count(detect_thesis_violations(title, rationale)) > 0


def strip_directional_title(title: str) -> str:
    """Remove a single leading directional prefix so the title reads as analysis.
    Compiled fresh; capitalizes the new leading character so 'Buy AeroVironment'
    becomes 'AeroVironment', 'short defense' becomes 'Defense'. Idempotent."""
    out = re.compile(_TITLE_PREFIX_SOURCE, re.IGNORECASE).sub("", title or "", count=1)
    out = out.strip()
    if out:
        out = out[0].upper() + out[1:]
    return out


def redact_rationale(text: str) -> str:
    """Remove recommendation-bearing and recommended-vehicle content so the result
    is provably free of any reader-directed recommendation or named-vehicle call.
    Drops whole sentences that carry one (preserving compliant sentences and the
    evidence/invalidation close), then neutralizes any residual token. Fallback
    path only. Each pattern is compiled fresh so there is no shared regex state."""
    patterns = [
        re.compile(src, re.IGNORECASE)
        for src in (_VEHICLE_SOURCES + _RECOMMENDATION_SOURCES)
    ]

    def carries(s: str) -> bool:
        return any(p.search(s) for p in patterns)

    out_lines = []
    for line in (text or "").split("\n"):
        if not line.strip():
            out_lines.append(line)
            continue
        sentences = re.split(r"(?<=[.!?])\s+", line)
        out_lines.append(" ".join(s for s in sentences if not carries(s)))

    out = "\n".join(out_lines)
    # Final guarantee: neutralize any residual phrase not bounded by sentence
    # punctuation (e.g. a bullet or heading with no terminal period).
    for p in patterns:
        out = p.sub("[redacted]", out)
    out = re.sub(r"[ \t]{2,}", " ", out)
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out.strip()


def build_thesis_correction(v: ThesisViolations) -> str:
    """Corrective instruction for the bounded re-ask. Names the detected
    violations so the model targets them without rewriting the substance."""
    found = list(v.directional_title) + list(v.vehicle) + list(v.recommendations)
    found_line = (
        "Detected violations to remove: " + ", ".join(f'"{f}"' for f in found) + "."
        if found
        else ""
    )
    parts = [
        "COMPLIANCE REWRITE REQUIRED. The previous thesis crossed the "
        "informational-only line. Rewrite the SAME thesis: same companies, same "
        "facts, same catalyst, same structure. Change ONLY the wording needed to "
        "comply. Return the rewritten title and rationale.",
        "1. DESCRIPTIVE TITLE: the title states what is changing and why it "
        "matters, as analysis. Remove any directional prefix (\"Buy\", \"Sell\", "
        "\"Long\", \"Short\", \"Avoid\", \"Watch\"). Name the security or theme as "
        "the SUBJECT, e.g. \"AeroVironment Backlog Strengthens on New Orders\", "
        "not \"Buy AeroVironment\".",
        "2. NO RECOMMENDED VEHICLE: do not name a security as the instrument to "
        "trade. Remove \"the cleanest expression is [ticker]\", \"best way to "
        "play\", and any buy/sell/long/short/overweight/underweight/recommend/"
        "\"increase exposure\"/\"add to position\" phrasing. Name the security as "
        "the subject of analysis. Keep an evidence or invalidation close (\"What "
        "invalidates this: ...\").",
        found_line,
        "Keep the substance, the named companies, and the structure. Zero "
        "em-dashes; use periods and new sentences.",
    ]
    return "\n".join(p for p in parts if p)


@dataclass
class EnforceResult:
    title: str
    rationale: str
    violations_before: ThesisViolations
    reasked: bool
    still_violating: bool


def enforce_thesis_recommendation(
    title: str,
    rationale: str,
    regenerate: Callable[[str], Optional[tuple[str, str]]],
    max_reasks: int = 1,
) -> EnforceResult:
    """Detect -> bounded re-ask -> FAIL-CLOSED fallback. Never raises. The surfaced
    title + rationale are always free of a directional prefix, a recommended
    vehicle, and any reader-directed recommendation. `regenerate(correction)`
    returns the rewritten (title, rationale) or None on failure."""
    before = detect_thesis_violations(title, rationale)
    if violation_count(before) == 0:
        return EnforceResult(title, rationale, before, False, False)

    reasked = False
    # Candidates seen, in order: original first, then each non-empty re-ask.
    candidates: list[tuple[str, str]] = [(title, rationale)]

    for _ in range(max_reasks):
        correction = build_thesis_correction(detect_thesis_violations(*candidates[-1]))
        nxt = regenerate(correction)
        reasked = True
        if nxt and isinstance(nxt, tuple) and (nxt[0] or nxt[1]):
            nt, nr = nxt[0] or "", nxt[1] or ""
            if not has_thesis_violation(nt, nr):
                return EnforceResult(nt, nr, before, reasked, False)
            candidates.append((nt, nr))

    # No fully clean draft. Fail closed: a clean candidate wins; else redact.
    for ct, cr in candidates:
        if violation_count(detect_thesis_violations(ct, cr)) == 0:
            return EnforceResult(ct, cr, before, reasked, False)

    base_t, base_r = candidates[-1]
    safe_title = strip_directional_title(base_t)
    safe_rationale = redact_rationale(base_r)
    after = detect_thesis_violations(safe_title, safe_rationale)
    return EnforceResult(
        safe_title, safe_rationale, before, reasked, violation_count(after) > 0
    )
