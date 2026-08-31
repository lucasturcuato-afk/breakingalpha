"""CIK <-> ticker mapping sync. Downloads SEC's company_tickers.json daily."""
from __future__ import annotations

import logging
from typing import Optional

from supabase import Client

from backend.edgar.client import sec_get
from backend.edgar.name_agreement import names_agree

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
        update_stats = _update_companies_sec_cik(sb)
    except Exception as e:
        logger.error("[cik-sync] companies update failed: %s", e, exc_info=True)
        update_stats = {"updated": 0, "error": str(e)}
    companies_updated = update_stats.get("updated", 0)

    # Coverage stat
    coverage = sb.table("companies").select("id", count="exact").not_.is_("sec_cik", "null").execute()
    total = sb.table("companies").select("id", count="exact").not_.is_("ticker", "null").execute()
    coverage_pct = (coverage.count / total.count * 100) if total.count else 0

    logger.info("[cik-sync] upserted=%d companies_updated=%d coverage=%.1f%% detail=%s",
                upserted, companies_updated, coverage_pct, update_stats)
    return {
        "fetched": len(rows),
        "upserted": upserted,
        "companies_updated": companies_updated,
        "coverage_pct": round(coverage_pct, 1),
        # Per-outcome breakdown so a zero stops being ambiguous between
        # "nothing to do" and "the read silently returned 9 percent".
        "cik_update_detail": update_stats,
    }


def _page_all(sb: Client, table: str, cols: str, order_col: str,
              page_size: int = 1000) -> list[dict]:
    """Read every row. A bare .execute() is capped by PostgREST's default
    max-rows (1000 here), and the cap is SILENT: you get 1000 rows and no
    error. cik_tickers holds 11,072 rows, so the unpaginated read that used
    to back this job saw 9 percent of the table."""
    out: list[dict] = []
    page = 0
    while True:
        rows = (
            sb.table(table).select(cols).order(order_col)
            .range(page * page_size, (page + 1) * page_size - 1)
            .execute().data or []
        )
        out.extend(rows)
        if len(rows) < page_size:
            return out
        page += 1


def _build_ticker_index(mappings: list[dict]) -> dict[str, tuple[int, str]]:
    """ticker -> (cik, company_name), collapsing duplicate ticker rows.

    prod cik_tickers carries 11 tickers that map to two CIKs each, while SEC's
    own file has none: the table is ACCRETIVE, so a successor registrant is
    added alongside the predecessor instead of replacing it. The previous
    dict-build was last-write-wins over an unordered read, which resolved XOM
    to 'ExxonMobil Holdings Corp' rather than 'EXXON MOBIL CORP' and PARA to
    'Banzai International, Inc.' rather than 'Paramount Global'.

    Pick the SMALLEST cik, which is the same deterministic rule
    entity_resolver.lookup_cik_for_ticker already uses. One rule, not two.
    """
    grouped: dict[str, dict[int, str]] = {}
    for row in mappings:
        ticker = (row.get("ticker") or "").upper().strip()
        cik = row.get("cik")
        if not ticker or cik is None:
            continue
        grouped.setdefault(ticker, {})[cik] = row.get("company_name") or ""
    index: dict[str, tuple[int, str]] = {}
    for ticker, by_cik in grouped.items():
        if len(by_cik) > 1:
            logger.warning(
                "[cik-sync] ticker %s maps to %d ciks %s; taking smallest",
                ticker, len(by_cik), sorted(by_cik),
            )
        cik = min(by_cik)
        index[ticker] = (cik, by_cik[cik])
    return index


def _update_companies_sec_cik(sb: Client) -> dict:
    """Stamp companies.sec_cik from cik_tickers, gated on name agreement.

    Four things this must do that the ticker join alone does not:

    1. READ THE WHOLE TABLE. See _page_all.
    2. RESOLVE DUPLICATE TICKERS DETERMINISTICALLY. See _build_ticker_index.
    3. CHECK THE NAME. A ticker match alone is not identity. Our ticker column
       carries Finnhub-derived and extraction-noise values, so a bare join
       stamps 'Ola' with Coca-Cola's CIK 21344 and 'Gett' with Rigetti's
       1838359. The gate is FAIL OPEN: no authority name means no opinion,
       and the write proceeds.
    4. NOT MINT A SECOND HOLDER OF A CIK. The mint-time path
       (entity_resolver.populate_sec_cik_for_mint) has always had this
       existence guard. This path never did. Same column, two policies.

    The gate governs WRITES ONLY. It never clears an existing sec_cik, so a
    rejection costs a missing CIK, never a wrong one.

    Returns per-outcome counts so a no-op stops looking like a success.
    """
    mappings = _page_all(sb, "cik_tickers", "cik, ticker, company_name", "cik")
    ticker_index = _build_ticker_index(mappings)

    companies = _page_all(sb, "companies", "id, name, ticker, sec_cik", "id")

    # id -> cik for every row that already holds one, so we can refuse to mint
    # a second holder without a per-row SELECT.
    cik_holder: dict[int, str] = {}
    for c in companies:
        if c.get("sec_cik") is not None:
            cik_holder.setdefault(c["sec_cik"], c["id"])

    stats = {"updated": 0, "blocked_name": 0, "blocked_holder": 0,
             "failed": 0, "considered": 0}
    for c in companies:
        ticker = (c.get("ticker") or "").upper().strip()
        if not ticker:
            continue
        hit = ticker_index.get(ticker)
        if not hit:
            continue
        new_cik, registrant = hit
        if c.get("sec_cik") == new_cik:
            continue
        stats["considered"] += 1

        agrees, reason = names_agree(c.get("name") or "", registrant)
        if not agrees:
            stats["blocked_name"] += 1
            logger.info(
                "[cik-sync] name gate blocked %s: %r (%s) vs cik %d %r: %s",
                c["id"], c.get("name"), ticker, new_cik, registrant, reason,
            )
            continue

        holder = cik_holder.get(new_cik)
        if holder is not None and holder != c["id"]:
            stats["blocked_holder"] += 1
            logger.info(
                "[cik-sync] cik %d already held by %s; not stamping %s",
                new_cik, holder, c["id"],
            )
            continue

        try:
            sb.table("companies").update(
                {"sec_cik": new_cik}
            ).eq("id", c["id"]).execute()
            stats["updated"] += 1
            cik_holder[new_cik] = c["id"]
        except Exception as e:
            stats["failed"] += 1
            logger.error("[cik-sync] update %s failed: %s", c["id"], e)
    return stats
