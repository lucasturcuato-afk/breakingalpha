"""Tier 1 (deterministic): Insider transaction grader.

Checks whether an insider buy generated positive follow-up sentiment
in subsequent articles. Simple heuristic: purchases should correlate
with positive coverage.
"""
from __future__ import annotations

import logging
from datetime import timedelta

from supabase import Client

from backend.outcome.types import GradeResult, Verdict
from backend.outcome.evidence import (
    fetch_subsequent_articles,
    parse_created_at,
    build_evidence_context,
)

logger = logging.getLogger(__name__)

GRADER_VERSION = "insider_tx_v0.1.0"


def grade(sb: Client, output: dict, window_days: int) -> GradeResult:
    output_id = output["id"]
    content = output.get("content") or {}
    ticker = content.get("ticker")
    tx_code = content.get("transaction_code")

    if not ticker or not tx_code:
        return GradeResult(
            output_id=output_id,
            window_days=window_days,
            score=None,
            verdict=Verdict.UNGRADABLE.value,
            evidence_summary="Missing ticker or transaction_code",
            grader_model="deterministic",
            grader_version=GRADER_VERSION,
        )

    created_at = parse_created_at(output)
    window_end = created_at + timedelta(days=window_days)

    articles = fetch_subsequent_articles(
        sb, ticker=ticker, sector=None, after=created_at, before=window_end, limit=15
    )

    if not articles:
        return GradeResult(
            output_id=output_id,
            window_days=window_days,
            score=None,
            verdict=Verdict.UNGRADABLE.value,
            evidence_summary="No subsequent articles found",
            evidence_data=build_evidence_context(
                output=output, window_days=window_days, articles=[],
            ),
            grader_model="deterministic",
            grader_version=GRADER_VERSION,
        )

    # Simple sentiment heuristic from article sentiments
    positive = sum(1 for a in articles if (a.get("sentiment") or "").lower() in ("positive", "bullish"))
    negative = sum(1 for a in articles if (a.get("sentiment") or "").lower() in ("negative", "bearish"))
    total = len(articles)

    expected_direction = "positive" if (tx_code or "").upper() == "P" else "negative"
    actual_lean = "positive" if positive > negative else ("negative" if negative > positive else "neutral")

    if actual_lean == expected_direction and total >= 3:
        score = 70
        verdict = Verdict.CONFIRMED.value
        summary = f"Insider {tx_code} followed by {actual_lean} sentiment ({positive}+ / {negative}-)"
    elif actual_lean == expected_direction:
        score = 55
        verdict = Verdict.PARTIALLY_CONFIRMED.value
        summary = f"Modest {actual_lean} sentiment ({positive}+ / {negative}-), limited coverage"
    elif actual_lean != "neutral" and actual_lean != expected_direction:
        score = 30
        verdict = Verdict.WRONG.value
        summary = f"Sentiment opposite to expected: {actual_lean} ({positive}+ / {negative}-)"
    else:
        score = 45
        verdict = Verdict.INCONCLUSIVE.value
        summary = f"Mixed/neutral sentiment ({positive}+ / {negative}-)"

    return GradeResult(
        output_id=output_id,
        window_days=window_days,
        score=score,
        verdict=verdict,
        confidence=0.5,
        evidence_summary=summary,
        evidence_data=build_evidence_context(
            output=output, window_days=window_days, articles=articles,
        ),
        grader_model="deterministic",
        grader_version=GRADER_VERSION,
    )
