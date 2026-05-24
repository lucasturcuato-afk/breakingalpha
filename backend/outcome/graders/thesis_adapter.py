"""Tier 1 (deterministic): Copy thesis verdict into output_grades.

thesis_grader.py already grades theses. This adapter reads the existing
verdict from thesis_verdicts and maps it to an output_grades row.
"""
from __future__ import annotations

import logging
from typing import Optional

from supabase import Client

from backend.outcome.types import GradeResult, Verdict, soft_fail_grade

logger = logging.getLogger(__name__)

GRADER_VERSION = "adapter_v0.1.0"

_VERDICT_SCORE_MAP = {
    "confirmed": 85,
    "invalidated": 15,
    "inconclusive": 40,
}


def grade(sb: Client, output: dict, window_days: int) -> GradeResult:
    output_id = output["id"]
    source_id = output.get("source_id")
    content = output.get("content") or {}
    thesis_id = content.get("thesis_id") or source_id

    if not thesis_id:
        return GradeResult(
            output_id=output_id,
            window_days=window_days,
            score=None,
            verdict=Verdict.UNGRADABLE.value,
            evidence_summary="No thesis_id found in output",
            grader_model="deterministic",
            grader_version=GRADER_VERSION,
        )

    try:
        resp = (
            sb.table("thesis_verdicts")
            .select("verdict, confidence, notes")
            .eq("thesis_id", str(thesis_id))
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        if not rows:
            return GradeResult(
                output_id=output_id,
                window_days=window_days,
                score=None,
                verdict=Verdict.UNGRADABLE.value,
                evidence_summary="No thesis_verdicts row found",
                grader_model="deterministic",
                grader_version=GRADER_VERSION,
            )

        row = rows[0]
        verdict_str = row.get("verdict", "inconclusive")
        score = _VERDICT_SCORE_MAP.get(verdict_str, 40)
        confidence = row.get("confidence")

        return GradeResult(
            output_id=output_id,
            window_days=window_days,
            score=score,
            verdict=verdict_str if verdict_str in ("confirmed", "inconclusive") else (
                Verdict.WRONG.value if verdict_str == "invalidated" else Verdict.INCONCLUSIVE.value
            ),
            confidence=confidence,
            evidence_summary=row.get("notes", ""),
            evidence_data={"source": "thesis_verdicts", "thesis_id": str(thesis_id)},
            grader_model="deterministic",
            grader_version=GRADER_VERSION,
        )
    except Exception as e:
        logger.error("thesis_adapter: failed for output %s: %s", output_id, e)
        return soft_fail_grade(output_id, window_days, f"adapter error: {e}", GRADER_VERSION)
