"""
article_quality.py — Deterministic article quality scoring.

Computes a 0-1 quality score from structural signals (no LLM).
Used at ingest time and for backfill. The score captures how
information-rich an article is, independent of topical relevance.

Signals:
  - Title quality: length, not clickbait-y
  - Summary richness: word count, sentence count
  - Entity presence: has companies, has sector
  - Content availability: full text vs snippet
  - Source diversity signal: has themes, has deal_type
"""
from __future__ import annotations


def compute_quality_score(article: dict) -> float:
    """Return a quality score in [0.0, 1.0] for the given article row/dict."""
    score = 0.0
    max_points = 0.0

    title = (article.get("title") or "").strip()
    summary = (article.get("summary") or "").strip()
    content = (article.get("content") or "").strip()
    companies = article.get("companies") or []
    themes = article.get("themes") or []
    sector = (article.get("sector") or "").strip()
    industry_verticals = article.get("industry_verticals") or []
    deal_type = (article.get("deal_type") or "").strip()
    sentiment = (article.get("sentiment") or "").strip()
    content_type = (article.get("content_type") or "snippet").strip()

    # 1. Title quality (max 2 pts)
    max_points += 2.0
    title_words = len(title.split())
    if 5 <= title_words <= 25:
        score += 1.0  # good length
    elif title_words > 2:
        score += 0.5  # acceptable
    # Penalty for all-caps clickbait
    if title == title.upper() and len(title) > 10:
        score -= 0.5
    # Bonus: title has a colon or dash (structured headline)
    if ":" in title or " — " in title or " - " in title:
        score += 0.5
    # Bonus: not a question headline (less clickbait-y)
    if not title.endswith("?"):
        score += 0.5

    # 2. Summary richness (max 3 pts)
    max_points += 3.0
    summary_words = len(summary.split())
    if summary_words >= 50:
        score += 1.5
    elif summary_words >= 25:
        score += 1.0
    elif summary_words >= 10:
        score += 0.5
    # Sentence count (more = more substantive)
    sentences = summary.count(".") + summary.count("!") + summary.count("?")
    if sentences >= 3:
        score += 1.0
    elif sentences >= 2:
        score += 0.5
    # Has numbers (quantitative content)
    if any(c.isdigit() for c in summary):
        score += 0.5

    # 3. Entity presence (max 2 pts)
    max_points += 2.0
    if isinstance(companies, list) and len(companies) >= 1:
        score += 1.0
    if isinstance(companies, list) and len(companies) >= 2:
        score += 0.5
    if sector or (isinstance(industry_verticals, list) and len(industry_verticals) >= 1):
        score += 0.5

    # 4. Content availability (max 1.5 pts)
    max_points += 1.5
    if content_type == "full_text" and len(content) > 200:
        score += 1.5
    elif len(content) > 0:
        score += 0.75

    # 5. Metadata completeness (max 1.5 pts)
    max_points += 1.5
    if isinstance(themes, list) and len(themes) >= 1:
        score += 0.5
    if deal_type:
        score += 0.5
    if sentiment and sentiment != "neutral":
        score += 0.25
    if isinstance(industry_verticals, list) and len(industry_verticals) >= 2:
        score += 0.25

    # Normalize to [0, 1]
    if max_points == 0:
        return 0.0
    return round(max(0.0, min(1.0, score / max_points)), 3)
