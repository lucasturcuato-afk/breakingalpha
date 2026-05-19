"""Tier 2 (Gemini Flash): Brief section grading.

Grades individual brief sections (market_overview, deals_and_ma, etc.)
against subsequent evidence.
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
from backend.market_data import fetch_index_performance

logger = logging.getLogger(__name__)

GRADER_VERSION = "brief_section_v0.1.0"

# Map section_key to relevant index symbol for price context
_SECTION_INDEX_MAP = {
    "market_overview": "SPY",
    "macro_and_rates": "TNX",
    "sector_moves": "QQQ",
    "watchlist_hits": None,  # ticker-specific, extracted from content
    "contrarian_corner": "SPY",
    "lead_story": None,
}


def grade(sb: Client, output: dict, window_days: int) -> GradeResult:
    output_id = output["id"]
    content = output.get("content") or {}
    section_text = content.get("section_text", "")
    section_key = content.get("section_key", "unknown")

    if not section_text:
        return GradeResult(
            output_id=output_id,
            window_days=window_days,
            score=None,
            verdict=Verdict.UNGRADABLE.value,
            evidence_summary="No section_text in output content",
            grader_model="deterministic",
            grader_version=GRADER_VERSION,
        )

    created_at = parse_created_at(output)
    window_end = created_at + timedelta(days=window_days)

    # Determine sector/topic from section content
    sector = content.get("sector") or content.get("target_sector")
    articles = fetch_subsequent_articles(
        sb, ticker=None, sector=sector, after=created_at, before=window_end
    ) if sector else []

    # If no sector-based articles, try broader fetch
    if not articles:
        articles = fetch_subsequent_articles(
            sb, ticker=None, sector=None, after=created_at, before=window_end, limit=10
        ) if not sector else articles

    # Price context for this section type
    index_sym = _SECTION_INDEX_MAP.get(section_key)
    price_data = fetch_index_performance(index_sym, created_at, window_end) if index_sym else None

    if not articles and not price_data:
        return GradeResult(
            output_id=output_id,
            window_days=window_days,
            score=None,
            verdict=Verdict.UNGRADABLE.value,
            evidence_summary="No subsequent articles or index data available",
            evidence_data=build_evidence_context(
                output=output, window_days=window_days, articles=[],
            ),
            grader_model="deterministic",
            grader_version=GRADER_VERSION,
        )

    try:
        system = load_prompt("brief_section")
    except FileNotFoundError:
        return soft_fail_grade(output_id, window_days, "Missing prompt template", GRADER_VERSION)

    articles_text = "\n".join(
        f"- [{a.get('published_at', '?')[:10]}] {a.get('title', '?')} ({a.get('source', '?')}): "
        f"{(a.get('summary') or '')[:150]}"
        for a in articles[:15]
    )
    price_text = ""
    if price_data:
        price_text = (
            f"\nINDEX DATA ({index_sym}): "
            f"${price_data['open_price']} → ${price_data['close_price']} "
            f"({price_data['pct_change']:+.1f}%)"
        )

    briefing_type = content.get("briefing_type", "morning")
    user_prompt = (
        f"BRIEF SECTION (written {created_at.strftime('%Y-%m-%d')}, "
        f"type={briefing_type}, key={section_key}):\n"
        f"{section_text[:3000]}\n\n"
        f"SUBSEQUENT EVIDENCE ({len(articles)} articles, {window_days}d window):\n"
        f"{articles_text}\n"
        f"{price_text}"
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
            output=output, window_days=window_days, articles=articles, price_data=price_data,
        ),
        grader_model="gemini-2.5-flash",
        grader_version=GRADER_VERSION,
        cost_usd=cost,
    )
