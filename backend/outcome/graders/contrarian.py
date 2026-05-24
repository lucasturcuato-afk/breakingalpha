"""Tier 2 (Gemini Flash): Contrarian signal grading.

Evaluates whether the bear-case / contrarian warning materialized.
A "confirmed" contrarian signal means the risk was prescient.
"""
from __future__ import annotations

import logging
from datetime import timedelta

from supabase import Client

from backend.outcome.types import GradeResult, Verdict, soft_fail_grade
from backend.outcome.evidence import (
    fetch_subsequent_articles,
    extract_ticker_from_output,
    extract_sector_from_output,
    parse_created_at,
    build_evidence_context,
)
from backend.outcome.gemini import call_gemini_json, load_prompt
from backend.market_data import fetch_historical_candle

logger = logging.getLogger(__name__)

GRADER_VERSION = "contrarian_v0.1.0"


def grade(sb: Client, output: dict, window_days: int) -> GradeResult:
    output_id = output["id"]
    content = output.get("content") or {}
    signal_text = content.get("signal_text") or content.get("text") or ""

    if not signal_text:
        return GradeResult(
            output_id=output_id,
            window_days=window_days,
            score=None,
            verdict=Verdict.UNGRADABLE.value,
            evidence_summary="No signal_text in output content",
            grader_model="deterministic",
            grader_version=GRADER_VERSION,
        )

    created_at = parse_created_at(output)
    window_end = created_at + timedelta(days=window_days)
    ticker = extract_ticker_from_output(output)
    sector = extract_sector_from_output(output)

    articles = fetch_subsequent_articles(
        sb, ticker=ticker, sector=sector, after=created_at, before=window_end
    )
    price_data = fetch_historical_candle(ticker, created_at, window_end) if ticker else None

    if not articles and not price_data:
        return GradeResult(
            output_id=output_id,
            window_days=window_days,
            score=None,
            verdict=Verdict.UNGRADABLE.value,
            evidence_summary="No subsequent evidence available",
            evidence_data=build_evidence_context(
                output=output, window_days=window_days, articles=[],
            ),
            grader_model="deterministic",
            grader_version=GRADER_VERSION,
        )

    try:
        system = load_prompt("contrarian")
    except FileNotFoundError:
        return soft_fail_grade(output_id, window_days, "Missing prompt template", GRADER_VERSION)

    articles_text = "\n".join(
        f"- [{a.get('published_at', '?')[:10]}] {a.get('title', '?')}: "
        f"{(a.get('summary') or '')[:150]}"
        for a in articles[:15]
    )
    price_text = ""
    if price_data:
        price_text = (
            f"\nPRICE DATA ({ticker}): "
            f"${price_data['open_price']} → ${price_data['close_price']} "
            f"({price_data['pct_change']:+.1f}%)"
        )

    user_prompt = (
        f"CONTRARIAN SIGNAL (written {created_at.strftime('%Y-%m-%d')}):\n"
        f"{signal_text[:3000]}\n\n"
        f"SUBSEQUENT EVIDENCE ({len(articles)} articles, {window_days}d window):\n"
        f"{articles_text}\n{price_text}"
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
