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
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

from supabase import create_client

from backend.edgar import shard_coverage
from backend.edgar.cik_mapping import sync_cik_tickers
from backend.edgar.submissions import (
    plan_poll,
    fetch_recent_filings,
    filter_new_filings,
    build_document_url,
    build_form4_document_url,
)
from backend.edgar.forms.form_8k import fetch_8k_content, summarize_8k
from backend.edgar.forms.form_4 import fetch_form4_xml, parse_form4
from backend.edgar.forms.form_periodic import record_periodic_filing
from backend.edgar.constants import (
    FILING_LOOKBACK_DAYS,
    FORMS_OF_INTEREST,
    MATERIAL_8K_ITEMS,
    RESUMMARIZE_LOOKBACK_DAYS,
    MAX_SUMMARY_ATTEMPTS,
    RESUMMARIZE_BASE_BACKOFF_HOURS,
    RESUMMARIZE_MAX_PER_RUN,
    RESUMMARIZE_CANDIDATE_LIMIT,
    RESUMMARIZE_SPACING_SEC,
)
from backend.outputs import record_output

logger = logging.getLogger(__name__)


def run(
    *,
    sync_ciks_first: bool = True,
    dry_run: bool = False,
    max_ciks: Optional[int] = None,
    scheduled_hour: Optional[str] = None,
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
        "filings_8k_resummarized": 0,
        "resummarize_failed": 0,
        "errors": 0,
        # Shard coverage. shards_targeted counts what this run set out to
        # cover; shards_covered counts what it actually finished and wrote to
        # the ledger. They differ whenever a whole-CIK fetch failed, which a
        # row-level error count cannot see.
        "shards_targeted": 0,
        "shards_covered": 0,
        "shards_incomplete": [],
        # Shards the per-run cap held short of full membership. Polled
        # completely, recorded with truncated=true, and NOT full coverage.
        "shards_truncated": [],
        "shards_backlog": 0,
        "shards_past_alert": [],
        "catchup_slots": [],
        "slot_source": None,
    }

    if sync_ciks_first:
        sync_result = sync_cik_tickers(sb)
        stats["cik_sync"] = sync_result

    plan = plan_poll(sb, scheduled_hour=scheduled_hour)
    stats["slot_source"] = plan.slot_source
    stats["shards_backlog"] = len(plan.backlog)
    stats["shards_past_alert"] = plan.stale
    stats["catchup_slots"] = [g.slot for g in plan.groups if g.run_kind == "catchup"]

    # --max-ciks is a testing cap over the flat list. It truncates shards
    # arbitrarily, so coverage is not recorded when it is in play: a shard
    # sliced in half is not a covered shard.
    truncated = bool(max_ciks)
    if truncated:
        flat = plan.entries[:max_ciks]
        logger.warning(
            "[edgar] --max-ciks %d truncates the poll; shard coverage will NOT "
            "be recorded for this run", max_ciks,
        )
        _poll_entries(sb, flat, dry_run, stats)
    else:
        # Hot first, then one shard at a time. Coverage is written as each
        # shard finishes rather than once at the end, so a run that dies
        # halfway keeps the shards it did complete and the next run picks up
        # exactly the ones it did not.
        _poll_entries(sb, plan.hot, dry_run, stats)
        for group in plan.groups:
            stats["shards_targeted"] += 1
            polled_ok = _poll_entries(sb, group.entries, dry_run, stats)
            selected = group.ciks
            missed = selected - polled_ok
            if missed:
                # Assert completion against the diff, not against the error
                # count. This is the shape that let a previous EDGAR backfill
                # skip five whole CIKs behind a swallowed `except: continue`.
                logger.error(
                    "[edgar] shard %d of %d incomplete: %d of %d CIKs did not "
                    "return filings (%s). Shard stays stale.",
                    group.slot, group.shards, len(missed), len(selected),
                    sorted(missed)[:10],
                )
                stats["shards_incomplete"].append(group.slot)
                continue
            if dry_run:
                logger.info(
                    "[edgar] DRY RUN shard %d of %d complete (%d CIKs), "
                    "coverage not recorded", group.slot, group.shards, len(selected),
                )
                continue
            if group.truncated:
                stats["shards_truncated"].append(group.slot)
            if shard_coverage.record_coverage(
                sb,
                shards=group.shards,
                shard=group.slot,
                covered_at=group.moment,
                slot_source=plan.slot_source,
                run_kind=group.run_kind,
                ciks_in_shard=group.members,
                ciks_selected=len(selected),
                ciks_polled=len(selected & polled_ok),
            ):
                stats["shards_covered"] += 1
            else:
                stats["shards_incomplete"].append(group.slot)

    # Self-heal: re-summarize 8-K rows whose summary is stuck NULL (bounded).
    try:
        resummarize_null_8k(sb, stats, dry_run=dry_run)
    except Exception as e:
        logger.error("[edgar] resummarize pass failed: %s", e, exc_info=True)
        stats["errors"] += 1

    completed_at = datetime.now(timezone.utc)
    if not dry_run:
        try:
            sb.table("pipeline_runs").insert({
                "brief_type": "edgar_ingestion",
                "started_at": started_at.isoformat(),
                "completed_at": completed_at.isoformat(),
                "duration_s": (completed_at - started_at).total_seconds(),
                "status": run_status(stats),
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
    if stats["shards_incomplete"]:
        logger.error(
            "[edgar] %d of %d targeted shard(s) NOT covered this run: %s",
            len(stats["shards_incomplete"]), stats["shards_targeted"],
            stats["shards_incomplete"],
        )
    if stats["shards_truncated"]:
        logger.warning(
            "[edgar] %d shard(s) recorded TRUNCATED (the per-run cap held them "
            "short of full membership): %s",
            len(stats["shards_truncated"]), stats["shards_truncated"],
        )
    return stats


def _poll_entries(sb, entries, dry_run, stats) -> set:
    """Poll a list of CIK entries. Returns the set of CIKs that answered.

    "Answered" means fetch_recent_filings returned a list, empty or not. A CIK
    that returned None (SEC 403, timeout, unparseable body) is NOT in the set,
    which is what makes an invisible whole-CIK failure visible to the caller.
    """
    polled_ok: set = set()
    for entry in entries:
        cik = entry["cik"]
        stats["ciks_polled"] += 1

        filings = fetch_recent_filings(cik)
        if filings is None:
            # Whole-CIK fetch failure. Not a row-level error, so it never
            # touched stats["errors"] and was invisible before this.
            continue
        polled_ok.add(cik)
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
    return polled_ok


def run_status(stats: dict) -> str:
    """pipeline_runs.status for a finished run. Pure, no I/O.

    Extends the existing precedent rather than inventing one: the old rule was
    'success' unless stats["errors"], and an incomplete shard now demotes the
    run the same way. Before this, every run reported success while delivering
    a fraction of the declared work, because delivering a fraction of the work
    was not something the run could observe about itself.
    """
    if stats.get("errors"):
        return "partial"
    if stats.get("shards_incomplete"):
        return "partial"
    return "success"


def should_alarm(stats: dict) -> bool:
    """Whether this run should exit non-zero and turn the job red. Pure.

    Deliberately NOT the same bar as `partial`. A single transient SEC 403
    leaves one shard stale, which the next run retries on its own; turning the
    job red for that would train everyone to ignore it. What cannot be left to
    self-healing is a shard stale past the alert threshold, because filings
    outside FILING_LOOKBACK_DAYS are dropped on ingest and no number of
    catch-up runs brings them back. That is the condition that already cost
    this pipeline data, and it is the one that pages.
    """
    if stats.get("errors"):
        return True
    if stats.get("shards_past_alert"):
        return True
    return False


def _parse_ts(value) -> Optional[datetime]:
    """Parse a Supabase timestamptz string to an aware datetime, or None.

    Delegates to the single definition in shard_coverage rather than keeping a
    second copy of the same wire-format parse.
    """
    return shard_coverage.parse_supabase_ts(value)


def _resummarize_eligible(
    attempts: int,
    last_attempt_at: Optional[datetime],
    now: datetime,
    *,
    max_attempts: int,
    base_backoff_hours: float,
) -> bool:
    """Decide whether a stuck-NULL row may be re-summarized this run.

    Pure (no I/O) so it is unit-testable. A row is eligible when it is under the
    attempt cap AND either was never attempted or has waited out an exponential
    backoff (base * 2**attempts) since its last attempt.
    """
    if attempts >= max_attempts:
        return False
    if last_attempt_at is None:
        return True
    required = timedelta(hours=base_backoff_hours * (2 ** attempts))
    return (now - last_attempt_at) >= required


def resummarize_null_8k(sb, stats, *, dry_run: bool = False) -> None:
    """Re-summarize 8-K rows whose summary is stuck NULL, bounded per run.

    Picks up recent NULL-summary rows that have stored raw_content, respects an
    attempt cap and exponential backoff (so persistently failing rows are not
    hammered), and re-runs summarize_8k on the stored content. Writes only the
    summary plus retry-tracking columns; never refetches from SEC.
    """
    now = datetime.now(timezone.utc)
    cutoff = (now.date() - timedelta(days=RESUMMARIZE_LOOKBACK_DAYS)).isoformat()

    rows = (
        sb.table("sec_filings")
        .select(
            "id, accession_number, ticker, company_id, items, raw_content, "
            "summary_attempts, summary_last_attempt_at"
        )
        .like("form_type", "8-K%")
        .is_("summary", "null")
        .gte("filing_date", cutoff)
        .lt("summary_attempts", MAX_SUMMARY_ATTEMPTS)
        .order("filing_date", desc=True)
        .limit(RESUMMARIZE_CANDIDATE_LIMIT)
        .execute()
        .data
        or []
    )

    eligible = []
    for r in rows:
        if not (r.get("raw_content") or "").strip():
            continue
        if _resummarize_eligible(
            r.get("summary_attempts") or 0,
            _parse_ts(r.get("summary_last_attempt_at")),
            now,
            max_attempts=MAX_SUMMARY_ATTEMPTS,
            base_backoff_hours=RESUMMARIZE_BASE_BACKOFF_HOURS,
        ):
            eligible.append(r)

    eligible = eligible[:RESUMMARIZE_MAX_PER_RUN]
    stats["resummarize_candidates"] = len(eligible)
    if dry_run or not eligible:
        logger.info(
            "[edgar] resummarize: %d eligible NULL-summary 8-K rows%s",
            len(eligible), " (dry run)" if dry_run else "",
        )
        return

    cids = sorted({r["company_id"] for r in eligible if r.get("company_id")})
    name_by_id = {}
    if cids:
        cn = sb.table("companies").select("id, name").in_("id", cids).execute().data or []
        name_by_id = {c["id"]: c["name"] for c in cn}

    for i, r in enumerate(eligible):
        if i:
            time.sleep(RESUMMARIZE_SPACING_SEC)
        ticker = r.get("ticker") or "?"
        company_name = name_by_id.get(r.get("company_id")) or ticker
        summary = summarize_8k(
            r.get("raw_content") or "", r.get("items") or [], ticker, company_name
        )
        update = {
            "summary_attempts": (r.get("summary_attempts") or 0) + 1,
            "summary_last_attempt_at": now.isoformat(),
        }
        if summary:
            update["summary"] = summary
            stats["filings_8k_resummarized"] += 1
        else:
            stats["resummarize_failed"] += 1
        try:
            sb.table("sec_filings").update(update).eq("id", r["id"]).execute()
        except Exception as e:
            logger.error(
                "[edgar] resummarize update failed for %s: %s",
                r.get("accession_number"), e,
            )
            stats["errors"] += 1

    logger.info(
        "[edgar] resummarize: %d attempted, %d filled, %d still pending",
        len(eligible), stats["filings_8k_resummarized"], stats["resummarize_failed"],
    )


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
        # Form 4 primaryDocument is the XSL HTML viewer; derive the raw XML URL.
        form4_doc_url = build_form4_document_url(
            cik, accession, filing.get("primary_document", "")
        )
        _process_form4(sb, filing, entry, form4_doc_url, dry_run, stats)
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
    parser.add_argument(
        "--scheduled-hour",
        help=(
            "UTC hour (0-23) or ISO-8601 timestamp this run was SCHEDULED for. "
            "The tail shard is derived from it, so a run that starts late still "
            "polls the shard it was scheduled to poll. Falls back to "
            "EDGAR_SCHEDULED_HOUR, then to execution time."
        ),
    )
    args = parser.parse_args()
    result = run(
        sync_ciks_first=not args.no_sync,
        dry_run=args.dry_run,
        max_ciks=args.max_ciks,
        scheduled_hour=args.scheduled_hour,
    )
    if should_alarm(result):
        stale = result.get("shards_past_alert") or []
        if stale:
            logger.error(
                "[edgar] FAILING THE JOB: shard(s) stale past the alert "
                "threshold and losing filings outside the %d day ingest "
                "window: %s. A catch-up cannot recover what has already fallen "
                "out of that window.",
                FILING_LOOKBACK_DAYS, stale,
            )
        sys.exit(1)
    sys.exit(0)
