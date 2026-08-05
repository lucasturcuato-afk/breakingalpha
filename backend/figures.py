"""
figures.py - structural figure extraction for cross-source observation.

WHAT THIS IS FOR
----------------
Stage 1 cross-source observation needs to surface "source A cited a number the
others did not" and "these two sources carry different numbers for the same
thing". This module is the CHEAPEST honest version of that: deterministic regex
extraction over text that is already in the database. No LLM, no network, no
per-article cost.

WHAT THIS IS NOT
----------------
It is NOT claim extraction and it does NOT establish that two figures refer to
the same underlying quantity. A cluster can legitimately contain "$4.2B revenue"
and "$180B market cap"; both are money, neither disagrees with the other. Every
consumer MUST treat a divergence as an OBSERVATION worth a human look, never as
"one of these sources is wrong". `compare_figures` returns raw strings
alongside every finding precisely so a reader can dismiss a false pairing.

MEASURED SUBSTRATE LIMIT (recon, 6,000-article window)
------------------------------------------------------
    content_type = 'full_text'          51 rows      (0.85%)
    empty summary                       5,278 rows   (88%)
    title contains a money/pct figure   26.6%
    median title length                 68 chars

So in practice this runs against a headline. A headline omits nearly everything
by construction, which is why `compare_figures` reports omissions only for
figure KINDS and never claims a source "missed" a detail: at 68 characters,
absence is not evidence of absence.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

#: Figure kinds we extract. Deliberately narrow: each one has an unambiguous
#: unit, so two figures of the same kind are at least dimensionally comparable.
KIND_MONEY = "money"
KIND_PERCENT = "percent"
KIND_MULTIPLE = "multiple"

#: Scale words -> multiplier applied to a money figure.
_SCALES: dict[str, float] = {
    "k": 1e3, "thousand": 1e3,
    "m": 1e6, "mm": 1e6, "mn": 1e6, "million": 1e6,
    "b": 1e9, "bn": 1e9, "billion": 1e9,
    "t": 1e12, "tn": 1e12, "trillion": 1e12,
}

_SCALE_ALT = "|".join(sorted(_SCALES, key=len, reverse=True))

# $4.2B / $4.2 billion / US$1.5bn / $900
_MONEY_RE = re.compile(
    r"(?:US)?\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*(" + _SCALE_ALT + r")?\b",
    re.IGNORECASE,
)

# 12% / 12.5 percent / up 3 pct
_PERCENT_RE = re.compile(
    r"(-?\d{1,3}(?:\.\d+)?)\s*(?:%|percent\b|pct\b)",
    re.IGNORECASE,
)

# 3x / 12.5x  (guarded so "x" inside a word does not match)
_MULTIPLE_RE = re.compile(r"\b(\d{1,4}(?:\.\d+)?)\s?x\b", re.IGNORECASE)

#: Relative tolerance for calling two money figures divergent. 2% absorbs
#: ordinary rounding ("$4.2B" vs "$4.15B") without absorbing a real difference.
MONEY_REL_TOLERANCE = 0.02

#: Absolute tolerance in percentage points for percent figures. 0.5pp absorbs
#: "12%" vs "12.4%" rounding.
PERCENT_ABS_TOLERANCE = 0.5

#: Relative tolerance for multiples.
MULTIPLE_REL_TOLERANCE = 0.05


@dataclass(frozen=True)
class Figure:
    """One extracted numeric figure."""

    kind: str
    value: float
    raw: str

    def to_dict(self) -> dict:
        return {"kind": self.kind, "value": self.value, "raw": self.raw}


@dataclass
class FigureFinding:
    """One cross-source observation about figures inside a cluster.

    `kind` is one of 'divergence' or 'exclusive'. NEITHER asserts correctness.
    """

    kind: str
    figure_kind: str
    detail: str
    members: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "kind": self.kind,
            "figure_kind": self.figure_kind,
            "detail": self.detail,
            "members": self.members,
        }


def _to_float(raw: str) -> float | None:
    try:
        return float(raw.replace(",", ""))
    except Exception:
        return None


def extract_figures(text: str | None) -> list[Figure]:
    """Extract money / percent / multiple figures from text. Never raises.

    Order-preserving and deduplicated on (kind, value) so a headline repeating
    the same number does not look like two observations.
    """
    if not text or not isinstance(text, str):
        return []

    out: list[Figure] = []
    seen: set[tuple[str, float]] = set()

    def _add(kind: str, value: float | None, raw: str) -> None:
        if value is None:
            return
        key = (kind, round(value, 6))
        if key in seen:
            return
        seen.add(key)
        out.append(Figure(kind=kind, value=value, raw=raw.strip()))

    for m in _MONEY_RE.finditer(text):
        base = _to_float(m.group(1))
        if base is None:
            continue
        scale = (m.group(2) or "").lower()
        _add(KIND_MONEY, base * _SCALES.get(scale, 1.0), m.group(0))

    for m in _PERCENT_RE.finditer(text):
        _add(KIND_PERCENT, _to_float(m.group(1)), m.group(0))

    for m in _MULTIPLE_RE.finditer(text):
        _add(KIND_MULTIPLE, _to_float(m.group(1)), m.group(0))

    return out


def figures_diverge(kind: str, a: float, b: float) -> bool:
    """True when two same-kind figures differ beyond the kind's tolerance."""
    if kind == KIND_PERCENT:
        return abs(a - b) > PERCENT_ABS_TOLERANCE
    tol = MULTIPLE_REL_TOLERANCE if kind == KIND_MULTIPLE else MONEY_REL_TOLERANCE
    scale = max(abs(a), abs(b))
    if scale == 0:
        return False
    return abs(a - b) / scale > tol


def compare_figures(members: list[dict]) -> list[FigureFinding]:
    """Compare figures across the members of one same-event cluster.

    `members` is a list of dicts with at least `id`, `label` (the display name
    for the contributing outlet) and `text`. Returns observations only:

      divergence  two or more members carry same-kind figures that differ
                  beyond tolerance. This does NOT mean one is wrong; they may
                  simply be different quantities (revenue vs market cap).
      exclusive   exactly one member carries a figure of a kind no other member
                  carries. Reported at KIND level only, because a headline
                  omitting a number is not evidence the article omitted it.

    Pure and deterministic. Never raises.
    """
    findings: list[FigureFinding] = []
    if not members or len(members) < 2:
        return findings

    by_kind: dict[str, list[tuple[dict, Figure]]] = {}
    for m in members:
        try:
            figs = extract_figures(m.get("text"))
        except Exception:
            figs = []
        for f in figs:
            by_kind.setdefault(f.kind, []).append((m, f))

    for kind, pairs in sorted(by_kind.items()):
        holders = {id(m): m for m, _ in pairs}

        # exclusive: one member is the only one carrying this kind, and there
        # is at least one other member in the cluster that carries none.
        if len(holders) == 1 and len(members) > 1:
            m, f = pairs[0]
            findings.append(
                FigureFinding(
                    kind="exclusive",
                    figure_kind=kind,
                    detail=(
                        f"only {m.get('label') or 'one outlet'} carries a "
                        f"{kind} figure ({f.raw}); "
                        f"{len(members) - 1} other item(s) carry none"
                    ),
                    members=[{
                        "id": m.get("id"),
                        "label": m.get("label"),
                        "figures": [f.to_dict()],
                    }],
                )
            )
            continue

        # divergence: any two holders whose values differ beyond tolerance.
        by_member: dict[int, tuple[dict, list[Figure]]] = {}
        for m, f in pairs:
            entry = by_member.setdefault(id(m), (m, []))
            entry[1].append(f)

        entries = list(by_member.values())
        diverged = False
        for i in range(len(entries)):
            for j in range(i + 1, len(entries)):
                for fa in entries[i][1]:
                    for fb in entries[j][1]:
                        if figures_diverge(kind, fa.value, fb.value):
                            diverged = True
                            break
                    if diverged:
                        break
                if diverged:
                    break
            if diverged:
                break

        if diverged:
            findings.append(
                FigureFinding(
                    kind="divergence",
                    figure_kind=kind,
                    detail=(
                        f"{len(entries)} items carry {kind} figures that differ "
                        f"beyond tolerance. Observation only: they may refer to "
                        f"different quantities."
                    ),
                    members=[
                        {
                            "id": m.get("id"),
                            "label": m.get("label"),
                            "figures": [f.to_dict() for f in figs],
                        }
                        for m, figs in entries
                    ],
                )
            )

    return findings
