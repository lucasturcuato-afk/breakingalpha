"""Evidence fetchers — supporting + contradicting articles for a thesis (no writes)."""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

from pydantic import BaseModel

from .features import TICKER_TO_COMPANIES, _parse_dt


logger = logging.getLogger(__name__)


SUMMARY_TRUNCATION_CHARS = 400


class Article(BaseModel):
    """Subset of article columns the grader reads (mirror of articles schema)."""

    id: str
    title: str | None = None
    source: str | None = None
    sector: str | None = None
    companies: list[str] | None = None
    sentiment: str | None = None
    published_at: str | None = None
    summary: str | None = None
    themes: list[str] | None = None


_ARTICLE_COLUMNS = "id, title, source, sector, companies, sentiment, published_at, summary, themes"


def _parse_article_ids(raw: Any) -> list[str]:
    """Defensive parse of supporting_articles — handles list, JSON-string, or None."""
    if not raw:
        return []
    if isinstance(raw, list):
        return [str(x) for x in raw if x]
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                return [str(x) for x in parsed if x]
        except Exception:
            return []
    return []


def _coerce_rows(rows: list[dict] | None) -> list[Article]:
    """Validate raw PostgREST rows into Article pydantic models, dropping invalid entries."""
    out: list[Article] = []
    for r in rows or []:
        try:
            out.append(Article.model_validate(r))
        except Exception as e:
            logger.warning("evidence: dropped malformed article row id=%s (%s)", r.get("id"), e)
    return out


def _truncate_summaries(articles: list[Article]) -> list[Article]:
    """Clip each article's summary to SUMMARY_TRUNCATION_CHARS before returning."""
    for a in articles:
        if a.summary and len(a.summary) > SUMMARY_TRUNCATION_CHARS:
            a.summary = a.summary[:SUMMARY_TRUNCATION_CHARS]
    return articles


def fetch_supporting_articles(thesis: dict, supabase: Any) -> list[Article]:
    """Load the thesis's author-declared supporting articles by id (defensive parse)."""
    ids = _parse_article_ids(thesis.get("supporting_articles"))
    if not ids:
        return []
    try:
        resp = (
            supabase.table("articles")
            .select(_ARTICLE_COLUMNS)
            .in_("id", ids)
            .execute()
        )
    except Exception as e:
        logger.warning("evidence: supporting fetch failed for thesis=%s: %s", thesis.get("id"), e)
        return []
    articles = _coerce_rows(resp.data)
    return _truncate_summaries(articles)


def fetch_contradicting_candidates(
    thesis: dict,
    now: datetime,
    supabase: Any,
    limit: int = 25,
) -> list[Article]:
    """Layered company → sector → empty search for adversarial articles, excluding supporting ids."""
    sa_ids = _parse_article_ids(thesis.get("supporting_articles"))
    sector = (thesis.get("sector") or "").strip()
    ticker = (thesis.get("ticker") or "").upper()
    company = TICKER_TO_COMPANIES.get(ticker)
    generated_at = _parse_dt(thesis.get("generated_at"))
    if generated_at is None:
        return []

    def _run(build_query: Any) -> list[Article]:
        try:
            q = build_query()
            if sa_ids:
                q = q.not_.in_("id", sa_ids)
            resp = q.limit(limit).execute()
        except Exception as e:
            logger.warning("evidence: contradicting query failed for thesis=%s: %s", thesis.get("id"), e)
            return []
        return _coerce_rows(resp.data)

    # Layer A — companies contains(full_company_name)
    if company:
        def _layer_a() -> Any:
            return (
                supabase.table("articles")
                .select(_ARTICLE_COLUMNS)
                .gte("published_at", generated_at.isoformat())
                .lte("published_at", now.isoformat())
                .contains("companies", [company])
            )
        hits = _run(_layer_a)
        if hits:
            return _truncate_summaries(hits)

    # Layer B — sector match
    if sector:
        def _layer_b() -> Any:
            return (
                supabase.table("articles")
                .select(_ARTICLE_COLUMNS)
                .gte("published_at", generated_at.isoformat())
                .lte("published_at", now.isoformat())
                .eq("sector", sector)
            )
        hits = _run(_layer_b)
        if hits:
            return _truncate_summaries(hits)

    # Layer C — nothing plausible; caller marks inconclusive.
    return []
