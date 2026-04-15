"""
fulltext.py — Full-text article scraping for open (non-paywalled) sources.

Exports:
  PAYWALLED_SOURCES  — set of source names that should never be scraped
  SCRAPEABLE_SOURCES — set of source names we attempt full-text extraction on
  fetch_full_text(url, source) -> str | None
"""

import time
import requests
from bs4 import BeautifulSoup

# ── Source classification ────────────────────────────────────────────────────

PAYWALLED_SOURCES = {
    "Bloomberg Tech",
    "NYT Business",
    "NYT Technology",
    "NYT World",
    "FT Tech",
    "WSJ Markets",
    "WSJ Tech",
    "Financial Times",
}

SCRAPEABLE_SOURCES = {
    "TechCrunch",
    "Axios",
    "GlobeNewswire",
    "PR Newswire",
    "Crunchbase News",
    "Defense News",
    "PE Hub",
    "The Times of India",
    "Ibtimes.com.au",
    "Livemint",
    "Breaking Defense",
    "C4ISRNET",
    "Pitchbook",
}

_USER_AGENT = "Mozilla/5.0 (compatible; Signalera/1.0)"
_TIMEOUT = 10
_MIN_TEXT_LENGTH = 200

# Tags that pollute article text
_STRIP_TAGS = {"script", "style", "nav", "aside", "footer", "header"}

# CSS selectors tried in priority order for main article body
_ARTICLE_SELECTORS = [
    "[class*='article-body']",
    "[class*='post-content']",
    "[class*='entry-content']",
    "[class*='story-body']",
]


def _clean_soup(soup):
    """Remove noise tags from a BeautifulSoup subtree (mutates in place)."""
    for tag_name in _STRIP_TAGS:
        for el in soup.find_all(tag_name):
            el.decompose()


def _extract_text(soup) -> str:
    """Extract and normalize text from a BeautifulSoup element."""
    raw = soup.get_text(separator=" ")
    # Collapse whitespace
    return " ".join(raw.split()).strip()


def fetch_full_text(url: str, source: str) -> str | None:
    """Fetch and extract full article text from a URL.

    Returns cleaned text (≥200 chars) or None on any failure.
    Does NOT sleep — caller is responsible for pacing.
    """
    if source in PAYWALLED_SOURCES:
        return None

    try:
        resp = requests.get(
            url,
            headers={"User-Agent": _USER_AGENT},
            timeout=_TIMEOUT,
            allow_redirects=True,
        )
        resp.raise_for_status()
    except requests.RequestException:
        return None
    except Exception:
        return None

    try:
        soup = BeautifulSoup(resp.text, "html.parser")

        # Strategy 1: <article> tag
        article_el = soup.find("article")
        if article_el:
            _clean_soup(article_el)
            text = _extract_text(article_el)
            if len(text) >= _MIN_TEXT_LENGTH:
                return text

        # Strategy 2: common article-body CSS class patterns
        for selector in _ARTICLE_SELECTORS:
            match = soup.select_one(selector)
            if match:
                _clean_soup(match)
                text = _extract_text(match)
                if len(text) >= _MIN_TEXT_LENGTH:
                    return text

        # Strategy 3: <main> tag
        main_el = soup.find("main")
        if main_el:
            _clean_soup(main_el)
            text = _extract_text(main_el)
            if len(text) >= _MIN_TEXT_LENGTH:
                return text

        # Strategy 4: fallback — concatenate all <p> tags
        _clean_soup(soup)
        paragraphs = soup.find_all("p")
        if paragraphs:
            text = " ".join(p.get_text(separator=" ") for p in paragraphs)
            text = " ".join(text.split()).strip()
            if len(text) >= _MIN_TEXT_LENGTH:
                return text

        return None
    except Exception:
        return None
