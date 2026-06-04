"""XBRL financial-facts ingestion job (isolated daily refresh).

Phase 1 of docs/xbrl-financial-facts-spec.md: for every tracked CIK
(watchlist + top-mention, same resolver as backend/ingest_sec.py), fetch the
SEC Company Facts JSON, extract the v1 line-item history, run the validation
gate, and upsert into financial_facts. Quarantined facts are stored with
their reason but are excluded from financial_facts_latest and every read
path (fail-closed).

Deliberately separate from ingest_sec.py: Company Facts is per-company, not
per-filing, so a daily full refresh of tracked CIKs is simpler and
self-healing for restatements. Per-new-filing triggering is a later
optimization.

NOTE: requires the financial_facts table
(supabase/migrations/20260603120000_create_financial_facts.sql). Until that
migration is applied this job only works with --dry-run.

Usage:
    python -m backend.ingest_xbrl_facts --dry-run --max-ciks 5
    python -m backend.ingest_xbrl_facts            # real run (table must exist)
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import datetime, timezone
from typing import Optional

from supabase import create_client

from backend.edgar.submissions import get_watchlist_ciks
from backend.edgar.xbrl_facts import (
    extract_financial_facts,
    fetch_company_facts,
    log_hooks,
)
from backend.edgar.xbrl_validation import validate_facts

logger = logging.getLogger(__name__)

UPSERT_BATCH = 500
ON_CONFLICT = "accession_number,concept_tag,period_start,period_end,unit"


def run(*, dry_run: bool = False, max_ciks: Optional[int] = None,
        only_cik: Optional[int] = None) -> dict:
    sb = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )

    started_at = datetime.now(timezone.utc)
    stats = {
        "started_at": started_at.isoformat(),
        "ciks_processed": 0,
        "facts_extracted": 0,
        "facts_validated": 0,
        "facts_quarantined": 0,
        "facts_upserted": 0,
        "restatements": 0,
        "tag_drift": 0,
        "errors": 0,
    }

    watchlist = get_watchlist_ciks(sb)
    if only_cik:
        watchlist = [w for w in watchlist if w["cik"] == only_cik]
    if max_ciks:
        watchlist = watchlist[:max_ciks]

    for entry in watchlist:
        cik = entry["cik"]
        try:
            _process_cik(sb, entry, dry_run, stats)
        except Exception as e:
            logger.error("[xbrl] processing failed for CIK %s: %s", cik, e,
                         exc_info=True)
            stats["errors"] += 1

    completed_at = datetime.now(timezone.utc)
    if not dry_run:
        try:
            sb.table("pipeline_runs").insert({
                "brief_type": "xbrl_facts_ingestion",
                "started_at": started_at.isoformat(),
                "completed_at": completed_at.isoformat(),
                "duration_s": (completed_at - started_at).total_seconds(),
                "status": "success" if stats["errors"] == 0 else "partial",
                "selected_count": stats["facts_upserted"],
                "error_notes": str(stats),
            }).execute()
        except Exception as e:
            logger.error("[xbrl] pipeline_runs logging failed: %s", e)

    logger.info("[xbrl] complete: %s", stats)
    return stats


def _process_cik(sb, entry, dry_run, stats) -> None:
    cik = entry["cik"]
    ticker = entry["ticker"]
    stats["ciks_processed"] += 1

    company_facts = fetch_company_facts(cik)
    if not company_facts:
        logger.warning("[xbrl] no companyfacts for CIK %d (%s)", cik, ticker)
        return

    facts = extract_financial_facts(cik, company_facts)
    if not facts:
        return
    stats["facts_extracted"] += len(facts)

    # Validation gate. The cross-endpoint check is intentionally ON for
    # production: nothing publishes without reconciling against the
    # Company Concept endpoint.
    summary = validate_facts(facts, cik)
    stats["facts_validated"] += summary["validated"]
    stats["facts_quarantined"] += summary["quarantined"]

    hooks = log_hooks(cik, facts)
    stats["restatements"] += hooks["restatements"]
    stats["tag_drift"] += hooks["tag_drift"]

    if dry_run:
        logger.info(
            "[xbrl] DRY RUN %s (CIK %d): %d facts, %d validated, %d quarantined %s",
            ticker, cik, len(facts), summary["validated"],
            summary["quarantined"], summary["reasons"] or "",
        )
        return

    rows = [_to_row(f, entry) for f in facts]
    for i in range(0, len(rows), UPSERT_BATCH):
        batch = rows[i:i + UPSERT_BATCH]
        try:
            sb.table("financial_facts").upsert(
                batch, on_conflict=ON_CONFLICT
            ).execute()
            stats["facts_upserted"] += len(batch)
        except Exception as e:
            if "financial_facts" in str(e) and (
                "does not exist" in str(e) or "PGRST205" in str(e)
            ):
                raise RuntimeError(
                    "financial_facts table missing - the migration "
                    "20260603120000_create_financial_facts.sql has not been "
                    "applied. Run with --dry-run until it is."
                ) from e
            raise


def _to_row(fact: dict, entry: dict) -> dict:
    return {
        "company_id": entry.get("company_id"),
        "cik": fact["cik"],
        "accession_number": fact["accession_number"],
        "filing_url": fact["filing_url"],
        "taxonomy": fact["taxonomy"],
        "concept_tag": fact["concept_tag"],
        "metric_key": fact["metric_key"],
        "value": fact["value"],
        "unit": fact["unit"],
        "period_type": fact["period_type"],
        "period_start": fact["period_start"],
        "period_end": fact["period_end"],
        "fiscal_year": fact["fiscal_year"],
        "fiscal_period": fact["fiscal_period"],
        "sec_frame": fact["sec_frame"],
        "form": fact["form"],
        "filed_date": fact["filed_date"],
        "is_derived": fact["is_derived"],
        "derivation": fact["derivation"],
        "validation_status": fact["validation_status"],
        "validation_reason": fact["validation_reason"],
    }


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )
    parser = argparse.ArgumentParser(description="XBRL financial-facts ingestion")
    parser.add_argument("--dry-run", action="store_true",
                        help="Extract + validate + log, no DB writes")
    parser.add_argument("--max-ciks", type=int, help="Cap CIKs (testing)")
    parser.add_argument("--cik", type=int, help="Process a single CIK")
    args = parser.parse_args()
    result = run(dry_run=args.dry_run, max_ciks=args.max_ciks, only_cik=args.cik)
    sys.exit(0 if result.get("errors", 0) == 0 else 1)
