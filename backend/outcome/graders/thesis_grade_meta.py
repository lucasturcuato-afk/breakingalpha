"""Tier 1 (deterministic): Meta-grade a thesis_grade output.

Compares the early verdict (from this output's content) against the final
locked thesis outcome. Only gradable after the thesis is locked (90d+).
"""
from __future__ import annotations

import logging

from supabase import Client

from backend.outcome.types import GradeResult, Verdict, soft_fail_grade

logger = logging.getLogger(__name__)

GRADER_VERSION = "meta_v0.1.0"


def grade(sb: Client, output: dict, window_days: int) -> GradeResult:
    output_id = output["id"]
    content = output.get("content") or {}
    early_verdict = content.get("verdict")
    thesis_id = content.get("thesis_id")

    if not thesis_id or not early_verdict:
        return GradeResult(
            output_id=output_id,
            window_days=window_days,
            score=None,
            verdict=Verdict.UNGRADABLE.value,
            evidence_summary="Missing thesis_id or early verdict in output content",
            grader_model="deterministic",
            grader_version=GRADER_VERSION,
        )

    try:
        resp = (
            sb.table("theses")
            .select("outcome, locked_at, expired")
            .eq("id", str(thesis_id))
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
                evidence_summary="Thesis not found",
                grader_model="deterministic",
                grader_version=GRADER_VERSION,
            )

        thesis = rows[0]
        final_outcome = thesis.get("outcome")
        is_locked = thesis.get("locked_at") is not None
        is_expired = thesis.get("expired", False)

        # Only grade if thesis has reached a terminal state
        if not final_outcome or (not is_locked and not is_expired):
            return GradeResult(
                output_id=output_id,
                window_days=window_days,
                score=None,
                verdict=Verdict.INCONCLUSIVE.value,
                confidence=0.2,
                evidence_summary="Thesis not yet locked or expired",
                grader_model="deterministic",
                grader_version=GRADER_VERSION,
            )

        # Compare early verdict to final outcome
        if early_verdict == final_outcome:
            score, verdict = 90, Verdict.CONFIRMED.value
            summary = f"Early verdict '{early_verdict}' matched final outcome"
        elif early_verdict == "inconclusive":
            score, verdict = 50, Verdict.PARTIALLY_CONFIRMED.value
            summary = f"Early verdict was inconclusive; final outcome was '{final_outcome}'"
        else:
            score, verdict = 15, Verdict.WRONG.value
            summary = f"Early verdict '{early_verdict}' contradicted final '{final_outcome}'"

        return GradeResult(
            output_id=output_id,
            window_days=window_days,
            score=score,
            verdict=verdict,
            confidence=0.95,
            evidence_summary=summary,
            evidence_data={
                "early_verdict": early_verdict,
                "final_outcome": final_outcome,
                "locked": is_locked,
                "expired": is_expired,
            },
            grader_model="deterministic",
            grader_version=GRADER_VERSION,
        )
    except Exception as e:
        logger.error("thesis_grade_meta: failed for output %s: %s", output_id, e)
        return soft_fail_grade(output_id, window_days, f"meta-grade error: {e}", GRADER_VERSION)
