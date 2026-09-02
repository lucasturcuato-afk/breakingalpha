"""Adviser-registry ingestion job: Form ADV Part 1 + Form 13F filer identity.

WHY. Company Intel's NUMBERS pillar is satisfied only by an EDGAR reporting
artifact: a validated XBRL fact, a sec_filings row, or an insider_transactions
row. Every one of those requires the name to be an issuer. Measured on the
2,869-name universe, 306 names hold exactly one pillar and all 306 are missing
NUMBERS. They are advisers, buyout firms and fund managers that will never file
a 10-K. This job gives that population a numbers artifact from two SEC
public-domain sources.

WHAT IT WRITES.
    adviser_registrations   one row per SEC-registered adviser (16,876), keyed
                            on CRD, carrying Item 5.F(2)(c) RAUM in full dollars
                            plus the adviser's own latest filing date.
    institutional_managers  one row per Form 13F filer identity (~20,200),
                            keyed on manager CIK, carrying an EXISTENCE FLAG and
                            the last filing date. No holdings, ever.

Both tables are ingested WHOLESALE and then linked: company_id is set on the
subset that matches a companies row by name, and left NULL on the rest. An
unlinked registry row is a normal state.

WHAT CREDITS THE PILLAR, which is narrower than what gets stored:
    ADV  raum_total_usd > 0. A filed 0.00 is a real answer (605 of 16,876
         roster rows, including BofA Securities and Needham & Company) and it
         is stored, but zero is not a number worth putting on a page.
    13F  files_13f_hr AND the last filing is within STALE_AFTER_DAYS. A 13F-NT
         carries no holdings and never credits. Neither does a filer whose last
         holdings report was in 2006.

WHAT IT NEVER DOES. No network calls. Both sources are on disk: the SEC monthly
IA firm-roster zip and a pre-built EDGAR submissions index. Building the 13F
filer list from the EDGAR API would be ~1M requests, which is not a reasonable
thing to do to EDGAR for a registry that changes quarterly.

Usage:
    python -m backend.ingest_adviser_registry --dry-run \\
        --adv-zip .../ia060126_0.zip --submissions-index .../submissions_index.jsonl
    python -m backend.ingest_adviser_registry \\
        --adv-zip ... --submissions-index ...        # real run (tables must exist)

NOTE: requires supabase/migrations/20260902120000_adv_13f_numbers_pillar.sql.
Until that migration is applied only --dry-run works.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from datetime import date, datetime, timezone
from typing import Optional, Sequence

from backend.registry.adv_part1 import AdviserRecord, load_roster_zip
from backend.registry.form_13f import STALE_AFTER_DAYS, ManagerRecord, load_managers
from backend.registry.match import Link, link_companies, load_overrides, normalize

logger = logging.getLogger(__name__)

UPSERT_BATCH = 500
ADVISER_TABLE = "adviser_registrations"
MANAGER_TABLE = "institutional_managers"
ADVISER_CONFLICT = "crd"
MANAGER_CONFLICT = "cik"

COMPANY_PAGE = 1000


def fetch_companies(sb) -> list[dict]:
    """Every companies row, keyset-paginated on id.

    PAGINATED ON PURPOSE. PostgREST caps an unqualified select at 1,000 rows and
    returns the truncation silently, so a bare .execute() here would match the
    matcher against the first 1,000 of 4,260 companies and under-report the
    link count by ~75% with no error anywhere.
    """
    out: list[dict] = []
    last: Optional[str] = None
    while True:
        q = sb.table("companies").select("id,name").order("id").limit(COMPANY_PAGE)
        if last is not None:
            q = q.gt("id", last)
        rows = q.execute().data or []
        out.extend(rows)
        if len(rows) < COMPANY_PAGE:
            break
        last = rows[-1]["id"]
    return out


def adviser_payload(rec: AdviserRecord, link: Optional[Link], source_file: str) -> dict:
    return {
        "crd": rec.crd,
        "company_id": link.company_id if link else None,
        "primary_business_name": rec.primary_business_name,
        "legal_name": rec.legal_name,
        "raum_total_usd": rec.raum_total_usd,
        "raum_discretionary_usd": rec.raum_discretionary_usd,
        "raum_non_discretionary_usd": rec.raum_non_discretionary_usd,
        "raum_total_accounts": rec.raum_total_accounts,
        "raum_reported_at": rec.raum_reported_at.isoformat() if rec.raum_reported_at else None,
        "sec_status": rec.sec_status,
        "match_tier": link.tier if link else None,
        "match_confirmed": bool(link.confirmed) if link else False,
        "source_file": source_file,
    }


def manager_payload(rec: ManagerRecord, link: Optional[Link], source_file: str) -> dict:
    return {
        "cik": rec.cik,
        "company_id": link.company_id if link else None,
        "filer_name": rec.filer_name,
        "files_13f_hr": rec.files_13f_hr,
        "notice_only": rec.notice_only,
        "last_filing_date": rec.last_filing_date.isoformat() if rec.last_filing_date else None,
        "forms": list(rec.forms),
        "match_tier": link.tier if link else None,
        "match_confirmed": bool(link.confirmed) if link else False,
        "source_file": source_file,
    }


def _registry_pairs(items, name_fields) -> list[tuple[int, str]]:
    """Flatten (key, name) pairs, deduped on (key, normalized name).

    An adviser's primary business name and legal name are usually the SAME
    string, and the 13F index repeats a filer under its former names. Feeding
    the duplicates to the matcher made every two-entity group look like a
    four-way ambiguity.
    """
    seen: set[tuple[int, str]] = set()
    pairs: list[tuple[int, str]] = []
    for item, key in items:
        for field in name_fields:
            value = getattr(item, field, None)
            names = value if isinstance(value, (list, tuple)) else [value]
            for name in names:
                if not name:
                    continue
                token = (key, normalize(name))
                if token in seen:
                    continue
                seen.add(token)
                pairs.append((key, name))
    return pairs


def _upsert(sb, table: str, rows: Sequence[dict], conflict: str, dry_run: bool) -> int:
    if dry_run:
        return len(rows)
    written = 0
    for start in range(0, len(rows), UPSERT_BATCH):
        chunk = list(rows[start:start + UPSERT_BATCH])
        sb.table(table).upsert(chunk, on_conflict=conflict).execute()
        written += len(chunk)
    return written


def run(
    *,
    adv_zip: str,
    submissions_index: str,
    sb=None,
    dry_run: bool = False,
    as_of: Optional[date] = None,
    stale_after_days: int = STALE_AFTER_DAYS,
) -> dict:
    """Parse, link and upsert both registries. Returns a stats dict."""
    as_of = as_of or datetime.now(timezone.utc).date()
    if sb is None:
        from backend.supabase_client import get_service_client

        sb = get_service_client()

    overrides = load_overrides()
    companies = fetch_companies(sb)

    advisers = load_roster_zip(adv_zip)
    managers = load_managers(submissions_index)

    adv_pairs = _registry_pairs(
        ((a, a.crd) for a in advisers), ("primary_business_name", "legal_name")
    )
    # Only holdings filers are offered to the matcher. A notice-only filer can
    # never credit the pillar, so linking it to a company would put a row on the
    # page that says nothing.
    mgr_pairs = _registry_pairs(
        ((m, m.cik) for m in managers if m.files_13f_hr), ("filer_name", "former_names")
    )

    adv_links = link_companies(companies, adv_pairs, overrides=overrides, override_field="crd")
    mgr_links = link_companies(companies, mgr_pairs, overrides=overrides, override_field="cik")
    adv_by_key = {link.registry_key: link for link in adv_links}
    mgr_by_key = {link.registry_key: link for link in mgr_links}

    adv_source = os.path.basename(adv_zip)
    mgr_source = os.path.basename(submissions_index)
    adv_rows = [adviser_payload(a, adv_by_key.get(a.crd), adv_source) for a in advisers]
    mgr_rows = [manager_payload(m, mgr_by_key.get(m.cik), mgr_source) for m in managers]

    creditable_adv = {
        link.company_id
        for a in advisers
        if a.has_raum_figure and (link := adv_by_key.get(a.crd)) is not None
    }
    creditable_mgr = {
        link.company_id
        for m in managers
        if m.supplies_numbers
        and m.is_current(as_of, stale_after_days)
        and (link := mgr_by_key.get(m.cik)) is not None
    }

    stats = {
        "as_of": as_of.isoformat(),
        "dry_run": dry_run,
        "advisers_parsed": len(advisers),
        "advisers_with_raum_figure": sum(1 for a in advisers if a.has_raum_figure),
        "advisers_linked": len(adv_links),
        "managers_parsed": len(managers),
        "managers_filing_13f_hr": sum(1 for m in managers if m.files_13f_hr),
        "managers_notice_only": sum(1 for m in managers if m.notice_only),
        "managers_linked": len(mgr_links),
        "companies_read": len(companies),
        "companies_credited_adv": len(creditable_adv),
        "companies_credited_13f": len(creditable_mgr),
        "companies_credited_union": len(creditable_adv | creditable_mgr),
        "blocked_by_override": sum(1 for o in overrides.values() if o.blocked),
    }
    stats["adviser_rows_upserted"] = _upsert(
        sb, ADVISER_TABLE, adv_rows, ADVISER_CONFLICT, dry_run
    )
    stats["manager_rows_upserted"] = _upsert(
        sb, MANAGER_TABLE, mgr_rows, MANAGER_CONFLICT, dry_run
    )
    return stats


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--adv-zip", required=True, help="SEC IA firm-roster zip (Part 1)")
    parser.add_argument(
        "--submissions-index", required=True, help="newline-delimited EDGAR submissions index"
    )
    parser.add_argument("--dry-run", action="store_true", help="parse and link, write nothing")
    parser.add_argument(
        "--stale-after-days",
        type=int,
        default=STALE_AFTER_DAYS,
        help="a 13F filer older than this does not credit the numbers pillar",
    )
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    stats = run(
        adv_zip=args.adv_zip,
        submissions_index=args.submissions_index,
        dry_run=args.dry_run,
        stale_after_days=args.stale_after_days,
    )
    print(json.dumps(stats, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
