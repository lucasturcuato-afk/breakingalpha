"""Form 4 (insider transactions) XML parser."""
from __future__ import annotations

import logging
from typing import Optional
import xml.etree.ElementTree as ET

from backend.edgar.client import sec_get
from backend.edgar.constants import CSUITE_TITLES, INSIDER_SALE_THRESHOLD_USD

logger = logging.getLogger(__name__)


def fetch_form4_xml(document_url: str) -> Optional[ET.Element]:
    """Fetch Form 4 XML. Returns ElementTree root or None."""
    resp = sec_get(document_url)
    if not resp:
        return None

    try:
        if "<ownershipDocument>" in resp.text:
            return ET.fromstring(resp.text)
        logger.warning("[form4] Response is not XML for %s", document_url)
        return None
    except ET.ParseError as e:
        logger.error("[form4] XML parse failed: %s", e)
        return None


def parse_form4(xml_root: ET.Element) -> list[dict]:
    """Parse Form 4 XML into list of transaction dicts. Applies filtering."""
    transactions = []

    reporting_owner = xml_root.find(".//reportingOwner")
    if reporting_owner is None:
        return []

    insider_name = _find_text(reporting_owner, ".//rptOwnerName") or "Unknown"
    is_officer = _find_text(reporting_owner, ".//isOfficer") == "1"
    is_director = _find_text(reporting_owner, ".//isDirector") == "1"
    officer_title = _find_text(reporting_owner, ".//officerTitle") or ""

    insider_title = officer_title.strip() if is_officer else ("Director" if is_director else "")
    is_csuite = any(title in insider_title.lower() for title in CSUITE_TITLES)

    for tx in xml_root.findall(".//nonDerivativeTransaction"):
        code = _find_text(tx, ".//transactionCode")
        if code not in {"P", "S"}:  # Only open-market P and S
            continue

        date = _find_text(tx, ".//transactionDate/value")
        shares = _find_text(tx, ".//transactionShares/value")
        price = _find_text(tx, ".//transactionPricePerShare/value")
        owned_after = _find_text(
            tx, ".//postTransactionAmounts/sharesOwnedFollowingTransaction/value"
        )

        try:
            shares_n = float(shares) if shares else 0
            price_n = float(price) if price else None
            total = (shares_n * price_n) if (shares_n and price_n) else None
        except (ValueError, TypeError):
            continue

        # Sales only if >$1M or by C-suite
        if code == "S":
            if (total is None or total < INSIDER_SALE_THRESHOLD_USD) and not is_csuite:
                continue

        transactions.append({
            "insider_name": insider_name,
            "insider_title": insider_title or None,
            "transaction_code": code,
            "transaction_date": date,
            "shares": shares_n,
            "price_per_share": price_n,
            "total_value": total,
            "shares_owned_after": float(owned_after) if owned_after else None,
        })

    return transactions


def _find_text(elem: ET.Element, xpath: str) -> Optional[str]:
    found = elem.find(xpath)
    return found.text.strip() if (found is not None and found.text) else None
