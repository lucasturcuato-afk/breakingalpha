"""CIK <-> ticker mapping sync. Downloads SEC's company_tickers.json daily."""
from __future__ import annotations

import logging
from typing import Optional

from supabase import Client

from backend.edgar.client import sec_get

logger = logging.getLogger(__name__)
COMPANY_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"


def sync_cik_tickers(sb: Client) -> dict:
    """
    Download company_tickers.json, upsert into cik_tickers,
    update companies.sec_cik for matching tickers.
    Returns: {fetched, upserted, companies_updated, coverage_pct}
    """
    resp = sec_get(COMPANY_TICKERS_URL)
    if not resp:
        return {"error": "fetch failed"}

    raw = resp.json()
    # SEC format: {"0": {"cik_str": 320193, "ticker": "AAPL", "title": "Apple Inc."}, ...}
    rows = [
        {
            "cik": int(entry["cik_str"]),
            "ticker": entry["ticker"].upper().strip(),
            "company_name": entry["title"],
        }
        for entry in raw.values()
        if entry.get("ticker") and entry.get("cik_str")
    ]
    logger.info("[cik-sync] fetched %d ticker mappings", len(rows))

    # Upsert in batches (Supabase has request size limits)
    upserted = 0
    BATCH = 500
    for i in range(0, len(rows), BATCH):
        batch = rows[i:i + BATCH]
        try:
            sb.table("cik_tickers").upsert(batch, on_conflict="cik,ticker").execute()
            upserted += len(batch)
        except Exception as e:
            logger.error("[cik-sync] batch %d failed: %s", i, e)

    # Update companies.sec_cik
    try:
        companies_updated = _update_companies_sec_cik(sb)
    except Exception as e:
        logger.error("[cik-sync] companies update failed: %s", e)
        companies_updated = 0

    # Coverage stat
    coverage = sb.table("companies").select("id", count="exact").not_.is_("sec_cik", "null").execute()
    total = sb.table("companies").select("id", count="exact").not_.is_("ticker", "null").execute()
    coverage_pct = (coverage.count / total.count * 100) if total.count else 0

    logger.info("[cik-sync] upserted=%d companies_updated=%d coverage=%.1f%%",
                upserted, companies_updated, coverage_pct)
    return {
        "fetched": len(rows),
        "upserted": upserted,
        "companies_updated": companies_updated,
        "coverage_pct": round(coverage_pct, 1),
    }


def _update_companies_sec_cik(sb: Client) -> int:
    """Update companies.sec_cik by joining against cik_tickers on ticker."""
    mappings = sb.table("cik_tickers").select("cik, ticker").execute().data or []
    ticker_to_cik: dict[str, int] = {}
    for row in mappings:
        ticker_to_cik[row["ticker"]] = row["cik"]

    companies = (
        sb.table("companies")
        .select("id, ticker, sec_cik")
        .not_.is_("ticker", "null")
        .execute()
        .data or []
    )

    updated = 0
    for c in companies:
        ticker = (c.get("ticker") or "").upper().strip()
        if not ticker:
            continue
        new_cik = ticker_to_cik.get(ticker)
        if new_cik and c.get("sec_cik") != new_cik:
            try:
                sb.table("companies").update({"sec_cik": new_cik}).eq("id", c["id"]).execute()
                updated += 1
            except Exception as e:
                logger.error("[cik-sync] update %s failed: %s", c["id"], e)
    return updated
