"""Rule-based feature extractor for thesis grading (pure, no DB)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Iterable

from pydantic import BaseModel


# Maps single-stock tickers → full company name used in `articles.companies` (text[]).
# ETFs are deliberately absent — callers fall through to a sector-level match.
TICKER_TO_COMPANIES: dict[str, str] = {
    "MSFT": "Microsoft",
    "SPCE": "Virgin Galactic",
    "LMT":  "Lockheed Martin",
    "NVDA": "Nvidia",
    "AAPL": "Apple",
    "GOOG": "Alphabet",
    "GOOGL": "Alphabet",
    "AMZN": "Amazon",
    "META": "Meta Platforms",
    "TSLA": "Tesla",
}


SENTIMENT_TO_SCORE: dict[str, float] = {
    "bullish": 1.0,
    "neutral": 0.0,
    "bearish": -1.0,
}


class FeatureVector(BaseModel):
    """Six numeric rule features that calibrate the grader's reasoning."""

    tag_overlap_count: float
    new_article_count: float
    weighted_sentiment_alignment: float
    source_diversity_score: float
    time_elapsed_days: float
    supporting_vs_contradicting_ratio: float


# Local copy of thesis_grader._parse_dt — duplicated to avoid a circular import
# (thesis_grader imports from this module indirectly via grade_one wiring).
def _parse_dt(value: Any) -> datetime | None:
    """Coerce stringified/naive timestamp → aware UTC datetime; return None on failure."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        s = str(value).replace("Z", "+00:00")
        dt = datetime.fromisoformat(s)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _tag_overlap_count(thesis: dict, supporting: Iterable[dict]) -> float:
    """Sum of per-article sector-matches and ticker→company-matches across supporting set."""
    t_sector = (thesis.get("sector") or "").strip()
    t_ticker = (thesis.get("ticker") or "").upper()
    company = TICKER_TO_COMPANIES.get(t_ticker)
    total = 0
    for a in supporting:
        if t_sector and a.get("sector") == t_sector:
            total += 1
        if company and company in (a.get("companies") or []):
            total += 1
    return float(total)


def _new_article_count(thesis: dict, supporting: Iterable[dict]) -> float:
    """Count supporting articles published at/after thesis.generated_at."""
    gen = _parse_dt(thesis.get("generated_at"))
    if gen is None:
        return 0.0
    count = 0
    for a in supporting:
        pub = _parse_dt(a.get("published_at"))
        if pub is not None and pub >= gen:
            count += 1
    return float(count)


def _weighted_sentiment_alignment(thesis: dict, supporting: list[dict]) -> float:
    """Mean supporting-article sentiment score signed by the thesis conviction direction."""
    if not supporting:
        return 0.0
    conv = (thesis.get("conviction") or "").upper()
    direction = 1.0 if conv == "BULLISH" else -1.0 if conv == "BEARISH" else 0.0
    scores = [SENTIMENT_TO_SCORE.get((a.get("sentiment") or "").lower(), 0.0) for a in supporting]
    mean = sum(scores) / len(scores)
    return round(mean * direction, 4)


def _source_diversity_score(supporting: list[dict]) -> float:
    """Distinct sources / total supporting articles; 0.0 when no supporting."""
    if not supporting:
        return 0.0
    sources = {a.get("source") for a in supporting if a.get("source")}
    return round(len(sources) / len(supporting), 4)


def _time_elapsed_days(thesis: dict, now: datetime) -> float:
    """Integer day-count between thesis.generated_at and now, as float."""
    gen = _parse_dt(thesis.get("generated_at"))
    if gen is None:
        return 0.0
    return float((now - gen).days)


def _supporting_vs_contradicting_ratio(supporting: list[dict], contradicting: list[dict]) -> float:
    """Ratio of supporting to contradicting articles, floor 0, cap 10."""
    n_s, n_c = len(supporting), len(contradicting)
    if n_s == 0:
        return 0.0
    return round(min(10.0, n_s / max(1, n_c)), 4)


def extract_rule_features(
    thesis: dict,
    supporting: list[dict],
    contradicting: list[dict],
    now: datetime,
) -> FeatureVector:
    """Compute all six rule features from a thesis + its evidence bundles."""
    return FeatureVector(
        tag_overlap_count=_tag_overlap_count(thesis, supporting),
        new_article_count=_new_article_count(thesis, supporting),
        weighted_sentiment_alignment=_weighted_sentiment_alignment(thesis, supporting),
        source_diversity_score=_source_diversity_score(supporting),
        time_elapsed_days=_time_elapsed_days(thesis, now),
        supporting_vs_contradicting_ratio=_supporting_vs_contradicting_ratio(supporting, contradicting),
    )
