"""SEC submissions API client. Polls per-CIK for new filings."""
from __future__ import annotations

import logging
import os
import re
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from supabase import Client

from backend.edgar.client import sec_get
from backend.edgar.constants import FILING_LOOKBACK_DAYS

logger = logging.getLogger(__name__)


# --- Poll tiering -----------------------------------------------------------
# The hourly EDGAR poll used to hard-cap at the top 200 companies by
# mention_count (plus the watchlist), which left 580 of the 792 CIK-bearing
# companies permanently unpolled. Uncapping outright is not safe: a first run
# over the tail sees every filing inside FILING_LOOKBACK_DAYS as new, measured
# at ~5.6 filings per tail CIK, and each new filing costs another SEC fetch
# plus (for 8-Ks) a Gemini summarize. That blows the 20 minute job timeout.
#
# So coverage widens by TIERING instead:
#   HOT  polled every run: watchlist CIKs, top-N by mention_count, and
#        companies that filed recently (they are the ones likely to file again)
#   TAIL sharded across runs: cik %% EDGAR_POLL_TAIL_SHARDS == slot, where slot
#        is derived from the run's UTC weekday+hour. With the default of 24
#        shards on an hourly cron, every tail CIK is polled once per day, well
#        inside the FILING_LOOKBACK_DAYS=14 window, so nothing is missed.
#
# Every knob is env-overridable. Defaults preserve the existing hot behavior.
DEFAULT_HOT_MENTION_LIMIT = 200
DEFAULT_HOT_RECENT_FILING_DAYS = 7
DEFAULT_HOT_RECENT_LIMIT = 150
DEFAULT_TAIL_SHARDS = 24
DEFAULT_TAIL_MAX_PER_RUN = 60


def _env_int(name: str, default: int) -> int:
    """Read a non-negative int from env, falling back to default on junk."""
    raw = os.environ.get(name)
    if raw is None or not str(raw).strip():
        return default
    try:
        value = int(str(raw).strip())
    except (TypeError, ValueError):
        logger.warning("[edgar] %s=%r is not an int, using %d", name, raw, default)
        return default
    if value < 0:
        logger.warning("[edgar] %s=%d is negative, using %d", name, value, default)
        return default
    return value


def _env_flag(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None or not str(raw).strip():
        return default
    return str(raw).strip().lower() not in {"0", "false", "no", "off"}


def tail_slot(now: datetime, shards: int) -> int:
    """Which tail shard a run at `now` (UTC) owns. Pure, no I/O.

    Slot walks the weekly hour grid so shard counts that do not divide 24
    still rotate through the whole tail instead of pinning to one bucket.
    """
    if shards <= 0:
        return 0
    return (now.weekday() * 24 + now.hour) % shards


def select_tail_ciks(
    candidates: list[dict],
    *,
    slot: int,
    shards: int,
    max_per_run: int,
    rotation: int = 0,
) -> list[dict]:
    """Pick this run's tail shard from the un-hot CIKs. Pure, no I/O.

    Selection is `cik % shards == slot`, ordered by cik for determinism. If the
    bucket overflows max_per_run the window is ROTATED by `rotation` before
    truncating, so an oversized bucket starves its high CIKs for a day rather
    than forever.
    """
    if shards <= 0 or not candidates:
        return []
    slot %= shards
    picked = sorted(
        (c for c in candidates if c["cik"] % shards == slot),
        key=lambda c: c["cik"],
    )
    if max_per_run and len(picked) > max_per_run:
        offset = rotation % len(picked)
        picked = (picked[offset:] + picked[:offset])[:max_per_run]
        logger.warning(
            "[edgar] tail shard %d has %d CIKs, capped to %d (rotation offset %d)",
            slot, len(candidates), max_per_run, offset,
        )
    return picked


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

    # Top-mention companies with CIKs. Was a hardcoded 200; now the explicit
    # EDGAR_POLL_HOT_MENTION_LIMIT knob, defaulting to the same 200.
    hot_limit = _env_int("EDGAR_POLL_HOT_MENTION_LIMIT", DEFAULT_HOT_MENTION_LIMIT)
    top_companies = (
        sb.table("companies")
        .select("id, ticker, sec_cik, name")
        .not_.is_("sec_cik", "null")
        .order("mention_count", desc=True)
        .limit(hot_limit)
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


def get_recent_filer_ciks(sb: Client) -> list[dict]:
    """CIKs that filed inside the recent window, as a hot tier.

    A company that just filed is the one most likely to file again, so it
    stays on the every-run poll even if its mention_count is low and its tail
    shard is not up today. Bounded by EDGAR_POLL_HOT_RECENT_LIMIT so the hot
    set cannot creep toward the full universe once the tail starts producing
    filings.
    """
    days = _env_int("EDGAR_POLL_HOT_RECENT_FILING_DAYS", DEFAULT_HOT_RECENT_FILING_DAYS)
    limit = _env_int("EDGAR_POLL_HOT_RECENT_LIMIT", DEFAULT_HOT_RECENT_LIMIT)
    if days <= 0 or limit <= 0:
        return []

    cutoff = (date.today() - timedelta(days=days)).isoformat()
    rows = (
        sb.table("sec_filings")
        .select("company_id")
        .gte("filing_date", cutoff)
        .not_.is_("company_id", "null")
        .order("filing_date", desc=True)
        .limit(1000)
        .execute()
        .data or []
    )
    # Preserve recency order while de-duplicating, then bound.
    company_ids: list = []
    seen_ids = set()
    for r in rows:
        cid = r.get("company_id")
        if cid and cid not in seen_ids:
            seen_ids.add(cid)
            company_ids.append(cid)
    company_ids = company_ids[:limit]
    if not company_ids:
        return []

    comps = (
        sb.table("companies")
        .select("id, ticker, sec_cik, name")
        .in_("id", company_ids)
        .not_.is_("sec_cik", "null")
        .execute()
        .data or []
    )
    return [
        {
            "cik": c["sec_cik"],
            "ticker": (c.get("ticker") or "").upper(),
            "company_id": c["id"],
            "company_name": c["name"],
        }
        for c in comps
    ]


def get_poll_ciks(sb: Client, *, now: Optional[datetime] = None) -> list[dict]:
    """CIKs to poll this run: the full hot set plus today's tail shard.

    Replaces the bare get_watchlist_ciks call in the hourly EDGAR ingest. The
    hot set is exactly what get_watchlist_ciks already returned (watchlist +
    top mention) widened by recent filers; the tail is every other CIK-bearing
    company, sharded so the whole universe is covered without blowing the job
    timeout. Set EDGAR_POLL_TAIL_SHARDS=0 to fall back to hot-only behavior.
    """
    now = now or datetime.now(timezone.utc)

    hot = get_watchlist_ciks(sb)
    seen = {e["cik"] for e in hot}
    for e in get_recent_filer_ciks(sb):
        if e["cik"] not in seen:
            seen.add(e["cik"])
            hot.append(e)

    shards = _env_int("EDGAR_POLL_TAIL_SHARDS", DEFAULT_TAIL_SHARDS)
    if not _env_flag("EDGAR_POLL_TAIL_ENABLED", True) or shards <= 0:
        logger.info("[edgar] tail sharding off, polling %d hot CIKs", len(hot))
        return hot

    universe = get_xbrl_ciks(sb, log_prefix="edgar")
    candidates = [c for c in universe if c["cik"] not in seen]
    tail = select_tail_ciks(
        candidates,
        slot=tail_slot(now, shards),
        shards=shards,
        max_per_run=_env_int("EDGAR_POLL_TAIL_MAX_PER_RUN", DEFAULT_TAIL_MAX_PER_RUN),
        rotation=now.toordinal(),
    )

    logger.info(
        "[edgar] polling %d CIKs: %d hot + %d tail (shard %d of %d, %d tail candidates)",
        len(hot) + len(tail), len(hot), len(tail),
        tail_slot(now, shards), shards, len(candidates),
    )
    return hot + tail


def get_xbrl_ciks(sb: Client, *, log_prefix: str = "xbrl") -> list[dict]:
    """
    ALL companies with a sec_cik, for the daily XBRL financials refresh.
    Same {cik, ticker, company_id, company_name} shape as get_watchlist_ciks
    so the two resolvers are drop-in compatible.

    UNCAPPED on purpose. The daily XBRL refresh consumes it whole; the hourly
    EDGAR poll consumes it through get_poll_ciks, which shards it rather than
    walking all of it in one run. No watchlist union needed here: watchlist
    CIKs already carry sec_cik in companies (sync_cik_tickers maintains the
    column).

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

    logger.info("[%s] %d CIKs in the sec_cik universe", log_prefix, len(results))
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
