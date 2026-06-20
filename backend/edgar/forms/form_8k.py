"""8-K filing parser. Fetches HTML body, extracts text, summarizes via Gemini."""
from __future__ import annotations

import logging
import os
import re
from typing import Optional

from google import genai
from google.genai import types

from backend.edgar.client import sec_get
from backend.edgar.constants import ITEM_CODE_DESCRIPTIONS

logger = logging.getLogger(__name__)

# Canonical model for this repo (matches summarize.py / synthesize.py).
GEMINI_MODEL = "gemini-2.5-flash"

# Lazy, import-safe client (mirrors backend/summarize.py). 8-K ingest must import
# cleanly even when GEMINI_API_KEY is absent; summarize_8k guards on None. This
# uses the google-genai SDK the rest of the project uses, so 8-K summarize runs
# under the same interpreter/.venv as everything else (the old google.generativeai
# package only existed in a separate homebrew interpreter).
try:
    _gemini_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
except Exception as e:  # missing key / malformed — non-fatal at import
    _gemini_client = None
    logger.warning("[8-K] Gemini client unavailable at import (%s)", e)


def _get_gemini_client() -> Optional["genai.Client"]:
    """Return the module client, lazily initializing if the key arrived late."""
    global _gemini_client
    if _gemini_client is None:
        try:
            _gemini_client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
        except Exception as e:
            logger.error("[8-K] gemini client init failed: %s", e)
            return None
    return _gemini_client


def fetch_8k_content(document_url: str) -> Optional[str]:
    """Fetch 8-K HTML, extract plain text. Returns None on failure."""
    resp = sec_get(document_url)
    if not resp:
        return None

    try:
        try:
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(resp.text, "html.parser")
            for tag in soup(["script", "style"]):
                tag.decompose()
            text = soup.get_text(separator=" ", strip=True)
        except ImportError:
            text = re.sub(r"<[^>]+>", " ", resp.text)
            text = re.sub(r"\s+", " ", text).strip()

        return text[:30000]
    except Exception as e:
        logger.error("[8-K] parse failed for %s: %s", document_url, e)
        return None


def summarize_8k(
    content: str, items: list[str], ticker: str, company_name: str
) -> Optional[str]:
    """Summarize 8-K content via Gemini. Returns 2-3 sentence summary or None."""
    item_desc = ", ".join(
        f"{code} ({ITEM_CODE_DESCRIPTIONS.get(code, 'unknown')})" for code in items
    )

    prompt = (
        "Summarize this SEC 8-K filing in 2-3 sentences for an investment research brief.\n\n"
        f"Company: {company_name} ({ticker})\n"
        f"Item codes: {item_desc}\n\n"
        f"Filing content (truncated):\n{content[:20000]}\n\n"
        "Output: 2-3 sentences. Lead with the most material fact. "
        'No fluff. No "the company announced".\n'
        'Example good: "Apple reported Q2 revenue of $111.2B, up 8% YoY, beating '
        "consensus by $3B. iPhone revenue grew 12% on strong China demand. "
        'Tim Cook flagged ongoing investment in AI infrastructure."'
    )
    client = _get_gemini_client()
    if client is None:
        return None
    try:
        resp = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                max_output_tokens=512,
                thinking_config=types.ThinkingConfig(thinking_budget=0),
            ),
        )
        text = (resp.text or "").strip()
        return text or None
    except Exception as e:
        logger.error("[8-K] gemini summarization failed: %s", e)
        return None
