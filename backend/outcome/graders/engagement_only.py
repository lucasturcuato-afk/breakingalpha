"""Tier 1 (deterministic): Engagement-only grading.

Used for user_addendum, mention_alert, cross_reference — output types
that are not structurally gradable for factual accuracy.
Score is derived entirely from user feedback signals.
"""
from __future__ import annotations

import logging

from supabase import Client

from backend.outcome.types import GradeResult, Verdict
from backend.outcome.evidence import fetch_user_feedback_for_output

logger = logging.getLogger(__name__)

GRADER_VERSION = "engagement_v0.1.0"


def grade(sb: Client, output: dict, window_days: int) -> GradeResult:
    output_id = output["id"]

    feedback = fetch_user_feedback_for_output(sb, output_id)

    if not feedback or feedback["feedback_count"] == 0:
        return GradeResult(
            output_id=output_id,
            window_days=window_days,
            score=None,
            verdict=Verdict.UNGRADABLE.value,
            evidence_summary="No user feedback recorded",
            evidence_data={"feedback": None},
            grader_model="deterministic",
            grader_version=GRADER_VERSION,
        )

    # Score derivation from engagement signals
    score = 50  # baseline
    if feedback["thumbs_up"] > 0:
        score = 80
    elif feedback["thumbs_down"] > 0:
        score = 20

    if feedback.get("exported"):
        score = min(100, score + 10)
    if feedback.get("shared"):
        score = min(100, score + 5)

    avg_dwell = feedback.get("avg_dwell_seconds")
    if avg_dwell and avg_dwell > 30 and score == 50:
        score = 60  # engaged but no explicit thumbs

    verdict = (
        Verdict.CONFIRMED.value if score >= 70
        else Verdict.PARTIALLY_CONFIRMED.value if score >= 40
        else Verdict.WRONG.value
    )

    return GradeResult(
        output_id=output_id,
        window_days=window_days,
        score=score,
        verdict=verdict,
        confidence=0.6 if feedback["thumbs_up"] or feedback["thumbs_down"] else 0.3,
        evidence_summary=f"Engagement: {feedback['thumbs_up']}👍 {feedback['thumbs_down']}👎 dwell={avg_dwell}s",
        evidence_data={"feedback": feedback},
        grader_model="deterministic",
        grader_version=GRADER_VERSION,
    )
