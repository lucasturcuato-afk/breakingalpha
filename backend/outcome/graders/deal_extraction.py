"""Tier 2 (Gemini Flash): Deal extraction verification.

Checks whether extracted deal facts (acquirer, target, value, type)
were accurate by searching for subsequent news confirming or denying.
"""
from __future__ import annotations

import logging
from datetime import timedelta

from supabase import Client

from backend.outcome.types import GradeResult, Verdict, soft_fail_grade
from backend.outcome.evidence import (
    fetch_subsequent_articles,
    parse_created_at,
    build_evidence_context,
)
from backend.outcome.gemini import call_gemini_json, load_prompt

logger = logging.getLogger(__name__)

GRADER_VERSION = "deal_v0.1.0"


def grade(sb: Client, output: dict, window_days: int) -> GradeResult:
    output_id = output["id"]
    content = output.get("content") or {}

    # Deal extractions store facts in content jsonb
    company = content.get("company") or content.get("target") or ""
    acquirer = content.get("acquirer", "")
    deal_data = content.get("deal_data") or content

    if not company:
        return GradeResult(
            output_id=output_id,
            window_days=window_days,
            score=None,
            verdict=Verdict.UNGRADABLE.value,
            evidence_summary="No company/target in deal extraction content",
            grader_model="deterministic",
            grader_version=GRADER_VERSION,
        )

    created_at = parse_created_at(output)
    window_end = created_at + timedelta(days=window_days)

    # Search for subsequent deal news about this company
    articles = fetch_subsequent_articles(
        sb, ticker=company, sector=None, after=created_at, before=window_end
    )
    # Also try acquirer name
    if acquirer and len(articles) < 5:
        extra = fetch_subsequent_articles(
            sb, ticker=acquirer, sector=None, after=created_at, before=window_end, limit=10
        )
        seen = {a["id"] for a in articles}
        articles.extend(a for a in extra if a.get("id") not in seen)

    if not articles:
        return GradeResult(
            output_id=output_id,
            window_days=window_days,
            score=None,
            verdict=Verdict.UNGRADABLE.value,
            evidence_summary="No subsequent articles about this deal",
            evidence_data=build_evidence_context(
                output=output, window_days=window_days, articles=[],
            ),
            grader_model="deterministic",
            grader_version=GRADER_VERSION,
        )

    try:
        system = load_prompt("deal_extraction")
    except FileNotFoundError:
        return soft_fail_grade(output_id, window_days, "Missing prompt template", GRADER_VERSION)

    articles_text = "\n".join(
        f"- [{a.get('published_at', '?')[:10]}] {a.get('title', '?')} ({a.get('source', '?')}): "
        f"{(a.get('summary') or '')[:150]}"
        for a in articles[:15]
    )

    # Serialize the extracted deal facts
    import json
    deal_facts = json.dumps(
        {k: v for k, v in deal_data.items() if isinstance(v, (str, int, float, bool, type(None)))},
        indent=2,
        default=str,
    )[:2000]

    user_prompt = (
        f"EXTRACTED DEAL FACTS (extracted {created_at.strftime('%Y-%m-%d')}):\n"
        f"{deal_facts}\n\n"
        f"SUBSEQUENT EVIDENCE ({len(articles)} articles, {window_days}d window):\n"
        f"{articles_text}"
    )

    parsed, cost = call_gemini_json(system, user_prompt)

    if parsed is None:
        return soft_fail_grade(output_id, window_days, "Gemini call/parse failed", GRADER_VERSION)

    score = parsed.get("score")
    verdict_raw = parsed.get("verdict", "inconclusive")
    verdict_map = {
        "confirmed": Verdict.CONFIRMED.value,
        "partially_confirmed": Verdict.PARTIALLY_CONFIRMED.value,
        "inconclusive": Verdict.INCONCLUSIVE.value,
        "wrong": Verdict.WRONG.value,
    }
    verdict = verdict_map.get(verdict_raw, Verdict.INCONCLUSIVE.value)

    return GradeResult(
        output_id=output_id,
        window_days=window_days,
        score=score if isinstance(score, int) and 0 <= score <= 100 else None,
        verdict=verdict,
        confidence=parsed.get("confidence"),
        evidence_summary=(parsed.get("evidence_summary") or "")[:500],
        evidence_data=build_evidence_context(
            output=output, window_days=window_days, articles=articles,
        ),
        grader_model="gemini-2.5-flash",
        grader_version=GRADER_VERSION,
        cost_usd=cost,
    )
