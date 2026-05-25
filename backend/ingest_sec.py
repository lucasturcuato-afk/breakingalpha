"""
SEC EDGAR Ingestion Orchestrator.

Polls submissions API per watchlist CIK, detects new filings, parses by form type,
writes to sec_filings / insider_transactions tables, and writes to outputs table
for substrate learning.
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import datetime, timezone
from typing import Optional

from supabase import create_client

from backend.edgar.cik_mapping import sync_cik_tickers
from backend.edgar.submissions import (
    get_watchlist_ciks,
    fetch_recent_filings,
    filter_new_filings,
    build_document_url,
)
from backend.edgar.forms.form_8k import fetch_8k_content, summarize_8k
from backend.edgar.forms.form_4 import fetch_form4_xml, parse_form4
from backend.edgar.forms.form_periodic import record_periodic_filing
from backend.edgar.constants import (
    FORMS_OF_INTEREST,
    MATERIAL_8K_ITEMS,
)
from backend.outputs import record_output

logger = logging.getLogger(__name__)


def run(
    *,
    sync_ciks_first: bool = True,
    dry_run: bool = False,
    max_ciks: Optional[int] = None,
) -> dict:
    sb = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    started_at = datetime.now(timezone.utc)
    stats = {
        "started_at": started_at.isoformat(),
        "ciks_polled": 0,
        "filings_8k_new": 0,
        "filings_4_new": 0,
        "filings_periodic_new": 0,
        "transactions_recorded": 0,
        "outputs_recorded": 0,
        "errors": 0,
    }

    if sync_ciks_first:
        sync_result = sync_cik_tickers(sb)
        stats["cik_sync"] = sync_result

    watchlist = get_watchlist_ciks(sb)
    if max_ciks:
        watchlist = watchlist[:max_ciks]

    for entry in watchlist:
        cik = entry["cik"]
        ticker = entry["ticker"]
        stats["ciks_polled"] += 1

        filings = fetch_recent_filings(cik)
        if not filings:
            continue

        new_filings = filter_new_filings(sb, cik, filings, FORMS_OF_INTEREST)
        if not new_filings:
            continue

        for filing in new_filings:
            try:
                _process_filing(sb, filing, entry, dry_run, stats)
            except Exception as e:
                logger.error(
                    "[edgar] processing failed for %s: %s",
                    filing.get("accession_number"), e,
                    exc_info=True,
                )
                stats["errors"] += 1

    completed_at = datetime.now(timezone.utc)
    if not dry_run:
        try:
            sb.table("pipeline_runs").insert({
                "brief_type": "edgar_ingestion",
                "started_at": started_at.isoformat(),
                "completed_at": completed_at.isoformat(),
                "duration_s": (completed_at - started_at).total_seconds(),
                "status": "success" if stats["errors"] == 0 else "partial",
                "selected_count": (
                    stats["filings_8k_new"]
                    + stats["filings_4_new"]
                    + stats["filings_periodic_new"]
                ),
                "error_notes": str(stats),
            }).execute()
        except Exception as e:
            logger.error("[edgar] pipeline_runs logging failed: %s", e)

    logger.info("[edgar] complete: %s", stats)
    return stats


def _process_filing(sb, filing, entry, dry_run, stats):
    """Route filing to correct form handler. Insert into sec_filings + outputs."""
    form = filing.get("form")
    accession = filing.get("accession_number")
    cik = entry["cik"]
    ticker = entry["ticker"]
    company_id = entry["company_id"]
    company_name = entry["company_name"]

    doc_url = build_document_url(cik, accession, filing.get("primary_document", ""))

    if form and form.startswith("8-K"):
        _process_8k(sb, filing, entry, doc_url, dry_run, stats)
    elif form and form.startswith("4"):
        _process_form4(sb, filing, entry, doc_url, dry_run, stats)
    elif form and (form.startswith("10-K") or form.startswith("10-Q")):
        _process_periodic(sb, filing, entry, doc_url, dry_run, stats)


def _process_8k(sb, filing, entry, doc_url, dry_run, stats):
    accession = filing["accession_number"]
    items = filing.get("items", [])
    ticker = entry["ticker"]
    company_id = entry["company_id"]
    company_name = entry["company_name"]
    cik = entry["cik"]
    is_material = any(item in MATERIAL_8K_ITEMS for item in items)

    if dry_run:
        logger.info(
            "[edgar] DRY RUN 8-K %s for %s: items=%s material=%s",
            accession, ticker, items, is_material,
        )
        stats["filings_8k_new"] += 1
        return

    content = fetch_8k_content(doc_url)
    summary = None
    if content:
        summary = summarize_8k(content, items, ticker, company_name)

    filing_row = sb.table("sec_filings").insert({
        "accession_number": accession,
        "cik": cik,
        "form_type": filing["form"],
        "filing_date": filing.get("filing_date"),
        "acceptance_dt": filing.get("acceptance_dt"),
        "items": items,
        "primary_doc_url": doc_url,
        "raw_content": content,
        "summary": summary,
        "company_id": company_id,
        "ticker": ticker,
    }).execute()
    filing_id = filing_row.data[0]["id"] if filing_row.data else None

    output_id = record_output(
        sb,
        output_type="sec_filing",
        content={
            "filing_id": str(filing_id) if filing_id else None,
            "accession_number": accession,
            "form_type": filing["form"],
            "items": items,
            "is_material": is_material,
            "ticker": ticker,
            "company_id": str(company_id) if company_id else None,
            "summary_excerpt": (summary or "")[:500],
            "doc_url": doc_url,
        },
        generation_context={
            "source": "sec_edgar",
            "cik": cik,
            "form_type": filing["form"],
            "prompt_version": "edgar_8k_v1.0",
        },
        source_table="sec_filings",
        source_id=filing_id,
    )

    if filing_id and output_id:
        sb.table("sec_filings").update({"output_id": output_id}).eq("id", filing_id).execute()
        stats["outputs_recorded"] += 1

    stats["filings_8k_new"] += 1
    logger.info("[edgar] 8-K %s %s: items=%s material=%s", ticker, accession, items, is_material)


def _process_form4(sb, filing, entry, doc_url, dry_run, stats):
    accession = filing["accession_number"]
    cik = entry["cik"]
    ticker = entry["ticker"]
    company_id = entry["company_id"]

    if dry_run:
        logger.info("[edgar] DRY RUN Form 4 %s for %s", accession, ticker)
        stats["filings_4_new"] += 1
        return

    xml_root = fetch_form4_xml(doc_url)
    if xml_root is None:
        return
    transactions = parse_form4(xml_root)
    if not transactions:
        return

    # Record the filing shell row even for Form 4
    try:
        sb.table("sec_filings").insert({
            "accession_number": accession,
            "cik": cik,
            "form_type": filing["form"],
            "filing_date": filing.get("filing_date"),
            "acceptance_dt": filing.get("acceptance_dt"),
            "items": [],
            "primary_doc_url": doc_url,
            "raw_content": None,
            "summary": f"Form 4: {len(transactions)} qualifying insider transaction(s)",
            "company_id": company_id,
            "ticker": ticker,
        }).execute()
    except Exception:
        pass  # Unique constraint may fire if already recorded

    for tx in transactions:
        try:
            insider_row = sb.table("insider_transactions").insert({
                "accession_number": accession,
                "cik": cik,
                "insider_name": tx["insider_name"],
                "insider_title": tx["insider_title"],
                "transaction_code": tx["transaction_code"],
                "transaction_date": tx["transaction_date"],
                "shares": tx["shares"],
                "price_per_share": tx["price_per_share"],
                "total_value": tx["total_value"],
                "shares_owned_after": tx["shares_owned_after"],
                "company_id": company_id,
                "ticker": ticker,
            }).execute()
            insider_id = insider_row.data[0]["id"] if insider_row.data else None

            output_id = record_output(
                sb,
                output_type="insider_transaction",
                content={
                    "transaction_id": str(insider_id) if insider_id else None,
                    "ticker": ticker,
                    "insider_name": tx["insider_name"],
                    "insider_title": tx["insider_title"],
                    "transaction_code": tx["transaction_code"],
                    "transaction_date": tx["transaction_date"],
                    "shares": tx["shares"],
                    "total_value": tx["total_value"],
                },
                generation_context={
                    "source": "sec_edgar",
                    "cik": cik,
                    "accession_number": accession,
                    "prompt_version": "edgar_form4_v1.0",
                },
                source_table="insider_transactions",
                source_id=insider_id,
            )
            if insider_id and output_id:
                sb.table("insider_transactions").update(
                    {"output_id": output_id}
                ).eq("id", insider_id).execute()
                stats["outputs_recorded"] += 1
            stats["transactions_recorded"] += 1
        except Exception as e:
            logger.error("[edgar] insider tx insert failed: %s", e)

    stats["filings_4_new"] += 1
    logger.info(
        "[edgar] Form 4 %s %s: %d qualifying txns", ticker, accession, len(transactions)
    )


def _process_periodic(sb, filing, entry, doc_url, dry_run, stats):
    accession = filing["accession_number"]
    cik = entry["cik"]
    ticker = entry["ticker"]
    company_id = entry["company_id"]

    if dry_run:
        logger.info("[edgar] DRY RUN %s %s for %s", filing["form"], accession, ticker)
        stats["filings_periodic_new"] += 1
        return

    result = record_periodic_filing(filing)
    try:
        sb.table("sec_filings").insert({
            "accession_number": accession,
            "cik": cik,
            "form_type": filing["form"],
            "filing_date": filing.get("filing_date"),
            "acceptance_dt": filing.get("acceptance_dt"),
            "items": [],
            "primary_doc_url": doc_url,
            "raw_content": result["raw_content"],
            "summary": result["summary"],
            "company_id": company_id,
            "ticker": ticker,
        }).execute()
        stats["filings_periodic_new"] += 1
    except Exception as e:
        logger.error("[edgar] periodic filing insert failed: %s", e)


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )
    parser = argparse.ArgumentParser(description="SEC EDGAR ingestion pipeline")
    parser.add_argument("--dry-run", action="store_true", help="Log filings without writing to DB")
    parser.add_argument("--no-sync", action="store_true", help="Skip CIK mapping sync")
    parser.add_argument("--max-ciks", type=int, help="Cap CIKs polled (for testing)")
    args = parser.parse_args()
    result = run(
        sync_ciks_first=not args.no_sync,
        dry_run=args.dry_run,
        max_ciks=args.max_ciks,
    )
    sys.exit(0 if result.get("errors", 0) == 0 else 1)
