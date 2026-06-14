"""Tier 1 (deterministic): Brief rollup grading.

Computes the parent brief's score as the average of its child
brief_section grades. No LLM call needed.
"""
from __future__ import annotations

import logging

from supabase import Client

from backend.outcome.types import GradeResult, Verdict

logger = logging.getLogger(__name__)

GRADER_VERSION = "rollup_v0.1.0"


def grade(sb: Client, output: dict, window_days: int) -> GradeResult:
    output_id = output["id"]
    content = output.get("content") or {}
    briefing_id = content.get("briefing_id") or output.get("source_id")

    if not briefing_id:
        return GradeResult(
            output_id=output_id,
            window_days=window_days,
            score=None,
            verdict=Verdict.UNGRADABLE.value,
            evidence_summary="No briefing_id to look up child sections",
            grader_model="deterministic",
            grader_version=GRADER_VERSION,
        )

    try:
        # Find child brief_section outputs for this briefing
        section_resp = (
            sb.table("outputs")
            .select("id")
            .eq("output_type", "brief_section")
            .contains("content", {"briefing_id": str(briefing_id)})
            .execute()
        )
        section_ids = [r["id"] for r in (section_resp.data or [])]

        if not section_ids:
            return GradeResult(
                output_id=output_id,
                window_days=window_days,
                score=None,
                verdict=Verdict.UNGRADABLE.value,
                evidence_summary="No child brief_section outputs found",
                grader_model="deterministic",
                grader_version=GRADER_VERSION,
            )

        # Fetch grades for those sections at this window only
        grades_resp = (
            sb.table("output_grades")
            .select("score, verdict, window_days")
            .in_("output_id", section_ids)
            .eq("window_days", window_days)
            .execute()
        )
        graded = [r for r in (grades_resp.data or []) if r.get("score") is not None]

        if not graded:
            return GradeResult(
                output_id=output_id,
                window_days=window_days,
                score=None,
                verdict=Verdict.INCONCLUSIVE.value,
                confidence=0.1,
                evidence_summary=f"0/{len(section_ids)} child sections graded",
                grader_model="deterministic",
                grader_version=GRADER_VERSION,
            )

        avg_score = round(sum(r["score"] for r in graded) / len(graded))
        coverage = len(graded) / len(section_ids)

        verdict = (
            Verdict.CONFIRMED.value if avg_score >= 70
            else Verdict.PARTIALLY_CONFIRMED.value if avg_score >= 40
            else Verdict.WRONG.value
        )

        return GradeResult(
            output_id=output_id,
            window_days=window_days,
            score=avg_score,
            verdict=verdict,
            confidence=round(min(0.9, coverage * 0.9), 2),
            evidence_summary=f"Avg of {len(graded)}/{len(section_ids)} sections = {avg_score}",
            evidence_data={
                "section_count": len(section_ids),
                "graded_count": len(graded),
                "scores": [r["score"] for r in graded],
            },
            grader_model="deterministic",
            grader_version=GRADER_VERSION,
        )
    except Exception as e:
        logger.error("brief_rollup: failed for output %s: %s", output_id, e)
        return GradeResult(
            output_id=output_id,
            window_days=window_days,
            score=None,
            verdict=Verdict.ERROR.value,
            evidence_summary=f"rollup error: {e}",
            grader_model="deterministic",
            grader_version=GRADER_VERSION,
        )
