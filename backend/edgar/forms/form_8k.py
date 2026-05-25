"""8-K filing parser. Fetches HTML body, extracts text, summarizes via Gemini."""
from __future__ import annotations

import logging
import os
import re
from typing import Optional

from backend.edgar.client import sec_get
from backend.edgar.constants import ITEM_CODE_DESCRIPTIONS

logger = logging.getLogger(__name__)


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
    try:
        import google.generativeai as genai
        genai.configure(api_key=os.environ["GEMINI_API_KEY"])
        model = genai.GenerativeModel("gemini-2.5-flash")
        resp = model.generate_content(prompt)
        return resp.text.strip()
    except Exception as e:
        logger.error("[8-K] gemini summarization failed: %s", e)
        return None
