"""10-K / 10-Q detection. Record the filing exists, link to URL, no body extraction.
XBRL financial extraction is a Phase 2 follow-up PR."""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def record_periodic_filing(filing: dict) -> dict:
    form = filing.get("form", "")
    summary = (
        f"{form} filing detected. Full financial detail extraction "
        "pending (XBRL parsing in follow-up PR)."
    )
    return {"summary": summary, "raw_content": None}
