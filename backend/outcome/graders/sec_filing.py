"""Tier 1 (deterministic): SEC filing materiality grader.

Checks whether a material 8-K event generated follow-up coverage
in subsequent articles. Non-material filings get a neutral score.
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

GRADER_VERSION = "sec_filing_v0.1.0"


def grade(sb: Client, output: dict, window_days: int) -> GradeResult:
    output_id = output["id"]
    content = output.get("content") or {}
    ticker = content.get("ticker")
    items = content.get("items", [])
    is_material = content.get("is_material", False)

    if not is_material:
        return GradeResult(
            output_id=output_id,
            window_days=window_days,
            score=50,
            verdict=Verdict.INCONCLUSIVE.value,
            confidence=0.4,
            evidence_summary="Non-material 8-K, no directional expectation",
            evidence_data={"items": items},
            grader_model="deterministic",
            grader_version=GRADER_VERSION,
        )

    if not ticker:
        return GradeResult(
            output_id=output_id,
            window_days=window_days,
            score=None,
            verdict=Verdict.UNGRADABLE.value,
            evidence_summary="No ticker in filing content",
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
            evidence_summary="No subsequent articles found for this ticker",
            evidence_data=build_evidence_context(
                output=output, window_days=window_days, articles=[],
            ),
            grader_model="deterministic",
            grader_version=GRADER_VERSION,
        )

    article_count = len(articles)
    if article_count >= 5:
        score = 75
        verdict = Verdict.CONFIRMED.value
        summary = f"Material event generated significant coverage: {article_count} follow-up articles"
    elif article_count >= 2:
        score = 60
        verdict = Verdict.PARTIALLY_CONFIRMED.value
        summary = f"Modest follow-up coverage: {article_count} articles"
    else:
        score = 40
        verdict = Verdict.INCONCLUSIVE.value
        summary = f"Minimal coverage despite material classification: {article_count} article(s)"

    return GradeResult(
        output_id=output_id,
        window_days=window_days,
        score=score,
        verdict=verdict,
        confidence=0.6,
        evidence_summary=summary,
        evidence_data=build_evidence_context(
            output=output, window_days=window_days, articles=articles,
        ),
        grader_model="deterministic",
        grader_version=GRADER_VERSION,
    )
