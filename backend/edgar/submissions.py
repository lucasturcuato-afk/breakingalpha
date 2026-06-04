"""SEC submissions API client. Polls per-CIK for new filings."""
from __future__ import annotations

import logging
import re
from datetime import date, timedelta
from typing import Optional

from supabase import Client

from backend.edgar.client import sec_get
from backend.edgar.constants import FILING_LOOKBACK_DAYS

logger = logging.getLogger(__name__)


def get_watchlist_ciks(sb: Client) -> list[dict]:
    """
    Returns list of {cik, ticker, company_id, company_name} for distinct CIKs
    from the watchlist + high-mention companies with CIKs.
    """
    seen_ciks: set[int] = set()
    results = []

    # Watchlist CIKs
    watchlist = sb.table("watchlist").select("identifier, type").execute().data or []
    tickers = [w["identifier"].upper() for w in watchlist if w.get("type") == "ticker"]

    if tickers:
        ct = (
            sb.table("cik_tickers")
            .select("cik, ticker, company_name")
            .in_("ticker", tickers)
            .execute()
            .data or []
        )
        for row in ct:
            if row["cik"] not in seen_ciks:
                seen_ciks.add(row["cik"])
                comp = (
                    sb.table("companies")
                    .select("id")
                    .eq("sec_cik", row["cik"])
                    .limit(1)
                    .execute()
                    .data
                )
                company_id = comp[0]["id"] if comp else None
                results.append({
                    "cik": row["cik"],
                    "ticker": row["ticker"],
                    "company_id": company_id,
                    "company_name": row["company_name"],
                })

    # Top-mention companies with CIKs (fill to ~200 total)
    top_companies = (
        sb.table("companies")
        .select("id, ticker, sec_cik, name")
        .not_.is_("sec_cik", "null")
        .order("mention_count", desc=True)
        .limit(200)
        .execute()
        .data or []
    )
    for c in top_companies:
        if c["sec_cik"] not in seen_ciks:
            seen_ciks.add(c["sec_cik"])
            results.append({
                "cik": c["sec_cik"],
                "ticker": (c.get("ticker") or "").upper(),
                "company_id": c["id"],
                "company_name": c["name"],
            })

    logger.info("[edgar] %d CIKs to poll (watchlist + top-mention)", len(results))
    return results


def get_xbrl_ciks(sb: Client) -> list[dict]:
    """
    ALL companies with a sec_cik, for the daily XBRL financials refresh.
    Same {cik, ticker, company_id, company_name} shape as get_watchlist_ciks
    so the two resolvers are drop-in compatible.

    Dedicated and UNCAPPED on purpose: widening XBRL coverage must not
    amplify into EDGAR's hourly poll, which keeps using get_watchlist_ciks
    (watchlist + top-200 by mentions). No watchlist union needed here:
    watchlist CIKs already carry sec_cik in companies (sync_cik_tickers
    maintains the column).

    Paged with .range(): PostgREST returns at most 1000 rows per request, so
    a single .execute() would silently truncate once the sec_cik universe
    outgrows one page. Secondary order on id keeps pages stable across
    mention_count ties.
    """
    seen: set[int] = set()
    results = []
    page, page_size = 0, 1000
    while True:
        rows = (
            sb.table("companies")
            .select("id, ticker, sec_cik, name")
            .not_.is_("sec_cik", "null")
            .order("mention_count", desc=True)
            .order("id")
            .range(page * page_size, (page + 1) * page_size - 1)
            .execute()
            .data or []
        )
        for c in rows:
            if c["sec_cik"] in seen:
                continue
            seen.add(c["sec_cik"])
            results.append({
                "cik": c["sec_cik"],
                "ticker": (c.get("ticker") or "").upper(),
                "company_id": c["id"],
                "company_name": c["name"],
            })
        if len(rows) < page_size:
            break
        page += 1

    logger.info("[xbrl] %d CIKs to refresh (all companies with sec_cik)",
                len(results))
    return results


def fetch_recent_filings(cik: int) -> Optional[list[dict]]:
    """Fetch recent filings for a CIK from submissions API."""
    padded = str(cik).zfill(10)
    url = f"https://data.sec.gov/submissions/CIK{padded}.json"
    resp = sec_get(url)
    if not resp:
        return None

    try:
        data = resp.json()
        recent = data.get("filings", {}).get("recent", {})
        accession = recent.get("accessionNumber", [])
        forms = recent.get("form", [])
        dates = recent.get("filingDate", [])
        accept_dts = recent.get("acceptanceDateTime", [])
        items_list = recent.get("items", [])
        primary_docs = recent.get("primaryDocument", [])

        filings = []
        for i in range(len(accession)):
            raw_items = items_list[i] if i < len(items_list) else ""
            filings.append({
                "accession_number": accession[i],
                "form": forms[i] if i < len(forms) else None,
                "filing_date": dates[i] if i < len(dates) else None,
                "acceptance_dt": accept_dts[i] if i < len(accept_dts) else None,
                "items": [s.strip() for s in raw_items.split(",") if s.strip()] if raw_items else [],
                "primary_document": primary_docs[i] if i < len(primary_docs) else None,
            })
        return filings
    except Exception as e:
        logger.error("[edgar] parse failed for CIK %d: %s", cik, e)
        return None


def filter_new_filings(
    sb: Client, cik: int, filings: list[dict], forms_of_interest: list[str]
) -> list[dict]:
    """Filter to forms we care about, within lookback window, AND not already ingested."""
    cutoff = date.today() - timedelta(days=FILING_LOOKBACK_DAYS)

    # Step 1: form type filter
    of_interest = [f for f in filings if f.get("form") in forms_of_interest]
    if not of_interest:
        return []

    # Step 2: date filter — skip filings older than FILING_LOOKBACK_DAYS
    recent = []
    n_filtered_date = 0
    for f in of_interest:
        filing_date_str = f.get("filing_date")
        if filing_date_str:
            try:
                filing_date = date.fromisoformat(filing_date_str)
                if filing_date < cutoff:
                    n_filtered_date += 1
                    continue
            except (ValueError, TypeError):
                pass  # If date is unparseable, let it through
        recent.append(f)

    if not recent:
        if n_filtered_date:
            logger.info(
                "[edgar] CIK %d: %d total, %d skipped (older than %dd), 0 new",
                cik, len(of_interest), n_filtered_date, FILING_LOOKBACK_DAYS,
            )
        return []

    # Step 3: dedup against existing accession numbers
    accession_numbers = [f["accession_number"] for f in recent]
    existing = (
        sb.table("sec_filings")
        .select("accession_number")
        .in_("accession_number", accession_numbers)
        .execute()
        .data or []
    )
    existing_set = {row["accession_number"] for row in existing}

    result = [f for f in recent if f["accession_number"] not in existing_set]
    n_filtered_dedup = len(recent) - len(result)

    logger.info(
        "[edgar] CIK %d: %d total, %d skipped (older than %dd), %d skipped (already in DB), %d new",
        cik, len(of_interest), n_filtered_date, FILING_LOOKBACK_DAYS, n_filtered_dedup, len(result),
    )
    return result


def build_document_url(cik: int, accession_number: str, primary_doc: str) -> str:
    """Construct full URL for the primary filing document."""
    accession_no_dashes = accession_number.replace("-", "")
    return f"https://www.sec.gov/Archives/edgar/data/{cik}/{accession_no_dashes}/{primary_doc}"


# Form 4 primaryDocument points at the XSL-rendered HTML viewer (e.g.
# "xslF345X06/wk-form4_X.xml"), which returns HTML, not parseable XML. The raw
# ownershipDocument XML sits in the same accession folder with the leading
# "xsl.../" path segment removed. Regex-guarded, so it is a no-op when no xsl
# prefix is present and cannot break filings that already point at raw XML.
_XSL_PREFIX_RE = re.compile(r"^xsl[^/]*/")


def build_form4_document_url(cik: int, accession_number: str, primary_doc: str) -> str:
    """Construct the raw Form 4 XML URL, stripping any XSL viewer path prefix."""
    raw_doc = _XSL_PREFIX_RE.sub("", primary_doc or "")
    return build_document_url(cik, accession_number, raw_doc)
