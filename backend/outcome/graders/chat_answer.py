"""Tier 2 (Gemini Flash): Chat answer verification.

Grades factual accuracy and citation fidelity. Short window (3-7d) since
chat answers are verifiable quickly — no time-bound predictions.
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

GRADER_VERSION = "chat_v0.1.0"


def grade(sb: Client, output: dict, window_days: int) -> GradeResult:
    output_id = output["id"]
    content = output.get("content") or {}
    answer_text = content.get("answer_text") or content.get("answer") or ""

    if not answer_text:
        return GradeResult(
            output_id=output_id,
            window_days=window_days,
            score=None,
            verdict=Verdict.UNGRADABLE.value,
            evidence_summary="No answer_text in output content",
            grader_model="deterministic",
            grader_version=GRADER_VERSION,
        )

    created_at = parse_created_at(output)
    gen_ctx = output.get("generation_context") or {}
    user_question = gen_ctx.get("user_question") or content.get("question") or ""

    # Fetch cited article IDs if available
    cited_ids = content.get("cited_article_ids") or []
    cited_articles = []
    if cited_ids:
        try:
            resp = (
                sb.table("articles")
                .select("id, title, source, summary, published_at")
                .in_("id", cited_ids[:20])
                .execute()
            )
            cited_articles = resp.data or []
        except Exception as e:
            logger.warning("chat_answer: failed to fetch cited articles: %s", e)

    try:
        system = load_prompt("chat_answer")
    except FileNotFoundError:
        return soft_fail_grade(output_id, window_days, "Missing prompt template", GRADER_VERSION)

    cited_text = "\n".join(
        f"- {a.get('title', '?')} ({a.get('source', '?')}, {(a.get('published_at') or '?')[:10]}): "
        f"{(a.get('summary') or '')[:200]}"
        for a in cited_articles
    )

    user_prompt = (
        f"QUESTION: {user_question[:500]}\n\n"
        f"ANSWER (generated {created_at.strftime('%Y-%m-%d')}):\n"
        f"{answer_text[:3000]}\n\n"
        f"CITED ARTICLES ({len(cited_articles)}):\n"
        f"{cited_text or '(none)'}"
    )

    parsed, cost = call_gemini_json(system, user_prompt)

    if parsed is None:
        return soft_fail_grade(output_id, window_days, "Gemini call/parse failed", GRADER_VERSION)

    score = parsed.get("score")
    verdict_raw = parsed.get("verdict", "inconclusive")
    verdict_map = {
        "accurate": Verdict.CONFIRMED.value,
        "mostly_accurate": Verdict.PARTIALLY_CONFIRMED.value,
        "partially_inaccurate": Verdict.INCONCLUSIVE.value,
        "inaccurate": Verdict.WRONG.value,
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
            output=output, window_days=window_days, articles=cited_articles,
        ),
        grader_model="gemini-2.5-flash",
        grader_version=GRADER_VERSION,
        cost_usd=cost,
    )
