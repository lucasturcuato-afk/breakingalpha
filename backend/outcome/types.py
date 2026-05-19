"""Shared types for the outcome evaluator."""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from typing import Optional


class Verdict(str, Enum):
    CONFIRMED = "confirmed"
    PARTIALLY_CONFIRMED = "partially_confirmed"
    INCONCLUSIVE = "inconclusive"
    WRONG = "wrong"
    UNGRADABLE = "ungradable"
    ERROR = "error"


@dataclass
class GradeResult:
    output_id: str
    window_days: int
    score: Optional[int]  # 0-100, None = ungradable/error
    verdict: str  # Verdict value
    confidence: Optional[float] = None  # 0.0-1.0
    evidence_summary: Optional[str] = None
    evidence_data: dict = field(default_factory=dict)
    grader_model: str = "deterministic"
    grader_version: str = "0.1.0"
    cost_usd: Optional[float] = 0.0
    graded_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> dict:
        d = asdict(self)
        # Ensure verdict is a plain string for Supabase
        d["verdict"] = str(d["verdict"])
        return d


def soft_fail_grade(
    output_id: str,
    window_days: int,
    note: str,
    grader_version: str = "0.1.0",
) -> GradeResult:
    """Return a canonical error grade for when grading fails."""
    return GradeResult(
        output_id=output_id,
        window_days=window_days,
        score=None,
        verdict=Verdict.ERROR.value,
        confidence=None,
        evidence_summary=note,
        evidence_data={},
        grader_model="deterministic",
        grader_version=grader_version,
        cost_usd=0.0,
    )
