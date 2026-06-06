"""Tier 1 (deterministic): SEC filing materiality grader.

Checks whether a material 8-K event generated follow-up coverage
in subsequent articles. Non-material filings get a neutral score.
"""
from __future__ import annotations

import logging
from datetime import timedelta
from typing import Optional

from supabase import Client

from backend.outcome.types import GradeResult, Verdict
from backend.outcome.evidence import (
    fetch_subsequent_articles,
    parse_created_at,
    build_evidence_context,
)

logger = logging.getLogger(__name__)

GRADER_VERSION = "sec_filing_v0.2.0"


def _resolve_company_name(sb: Client, output: dict) -> Optional[str]:
    """Resolve a company name for article search.

    articles.companies stores company names (e.g. "Alphabet"), not tickers
    (e.g. "GOOGL"). SEC filings store ticker in content.ticker, so we need
    to resolve ticker → name via the companies table.
    """
    content = output.get("content") or {}
    company_id = content.get("company_id")
    ticker = content.get("ticker")

    # Path 1: resolve via company_id (778/857 filings have this)
    if company_id:
        try:
            resp = (
                sb.table("companies")
                .select("name")
                .eq("id", company_id)
                .limit(1)
                .execute()
            )
            if resp.data and resp.data[0].get("name"):
                return resp.data[0]["name"]
        except Exception as e:
            logger.warning("sec_filing: company_id lookup failed for %s: %s", company_id, e)

    # Path 2: resolve via ticker → companies.name
    if ticker:
        try:
            resp = (
                sb.table("companies")
                .select("name")
                .eq("ticker", ticker)
                .limit(1)
                .execute()
            )
            if resp.data and resp.data[0].get("name"):
                return resp.data[0]["name"]
        except Exception as e:
            logger.warning("sec_filing: ticker lookup failed for %s: %s", ticker, e)

    return None


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

    # Resolve ticker → company name for article search.
    # articles.companies stores names ("Alphabet"), not tickers ("GOOGL").
    company_name = _resolve_company_name(sb, output)
    search_key = company_name or ticker  # fall back to ticker if resolution fails

    if company_name:
        logger.debug("sec_filing: %s resolved ticker %s → %s", output_id[:8], ticker, company_name)
    else:
        logger.info("sec_filing: %s could not resolve ticker %s to company name, using ticker as-is", output_id[:8], ticker)

    articles = fetch_subsequent_articles(
        sb, ticker=search_key, sector=None, after=created_at, before=window_end, limit=15
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
