"""
W2-C sector backfill (DRY-RUN ONLY in this PR).

Probes Finnhub /stock/profile2 for each company with ticker NOT NULL
AND sector IS NULL, maps finnhubIndustry -> one of the 11
INDUSTRY_VERTICALS used by /company directory chips
(src/app/company/page.tsx lines 121-133), and writes a CSV proposal.

LIVE EXECUTION: NOT IN THIS PR.
  This PR ships --dry-run only. Writes ONLY to the CSV at --out-csv.
  Zero DB mutations. Only GET requests against Finnhub. A separate
  user-approved PR will add a --live flag after the CSV has been
  reviewed and FINNHUB_TO_VERTICAL has been audited.

Rate limit: Finnhub free tier is 60/min. Sleep 1.1s between calls;
on a 429 the script bumps sleep to 2s and retries once.

Usage:
  cd /Users/noahhanning/breakingalpha
  set -a && source .env.local && source backend/.env && set +a
  .venv/bin/python3 -m backend.scripts.backfill_sectors \\
      --out-csv .session-artifacts/overnight/sector-backfill-proposed.csv \\
      [--limit N] [--dry-run]

ASCII only. No em-dashes.
"""
from __future__ import annotations

import argparse
import csv
import os
import sys
import time
from typing import Optional, Tuple


SLEEP_BETWEEN_CALLS_SEC = 1.1
SLEEP_AFTER_429_SEC = 2.0
PROGRESS_EVERY_N = 50
FINNHUB_PROFILE2_URL = "https://finnhub.io/api/v1/stock/profile2"

# 11 directory verticals; mirrors INDUSTRY_VERTICALS in src/app/company/page.tsx.
# Anything Finnhub returns that is not present below is emitted to the CSV
# with confidence=ambiguous so a human can audit before live execution.
# Utilities default to Industrials in this Phase 1 mapping.
_VERTICAL_KEYS: tuple = (
    ("Technology", ("semiconductors", "software", "computer services",
        "computer hardware", "internet software & services", "it services",
        "technology", "electronic equipment & instruments", "communications")),
    ("Healthcare & Biotech", ("pharmaceuticals", "biotechnology",
        "medical devices", "health care", "health care services",
        "managed health care", "life sciences tools & services")),
    ("Energy & Oil/Gas", ("oil & gas", "energy", "oil & gas production",
        "oil & gas services", "oil/gas refining & marketing",
        "oil & gas refining & marketing", "energy minerals")),
    ("Financial Services", ("banks", "banking", "capital markets", "insurance",
        "financial services", "diversified financial services",
        "consumer finance", "n/a finance")),
    ("Consumer & Retail", ("retail", "apparel", "consumer products",
        "beverages", "food", "restaurants", "food, beverage & tobacco",
        "household products", "personal products",
        "hotels, restaurants & leisure", "leisure products", "tobacco",
        "textiles, apparel & luxury goods", "diversified consumer services")),
    ("Aerospace & Defense", ("aerospace & defense", "aerospace", "defense")),
    ("Real Estate", ("real estate", "reits", "real estate services",
        "real estate investment trusts")),
    ("Media & Telecom", ("media", "telecommunications", "telecom wireless",
        "broadcasting & cable tv", "telecommunication",
        "wireless telecommunication services",
        "diversified telecommunication services")),
    ("Materials & Mining", ("metals & mining", "steel", "copper", "gold",
        "materials", "chemicals", "specialty chemicals",
        "containers & packaging")),
    ("Agriculture", ("agriculture", "farming", "agricultural products")),
    ("Industrials & Manufacturing", ("auto manufacturers",
        "auto parts & equipment", "industrial conglomerates", "machinery",
        "trucking", "railroads", "building materials", "construction",
        "construction materials", "transportation", "automobiles",
        "electrical equipment", "industrials", "logistics & transportation",
        "marine", "airlines", "utilities", "electric utilities",
        "road & rail", "trading companies & distributors",
        "professional services")),
)
FINNHUB_TO_VERTICAL: dict = {
    key: vertical for vertical, keys in _VERTICAL_KEYS for key in keys
}


def _load_env() -> None:
    """Load .env.local at repo root and backend/.env (mirrors backfill_tickers.py)."""
    try:
        from dotenv import load_dotenv  # type: ignore
    except ImportError:
        return
    here = os.path.dirname(os.path.abspath(__file__))
    backend_dir = os.path.dirname(here)
    repo_root = os.path.dirname(backend_dir)
    for path in (os.path.join(repo_root, ".env.local"),
                 os.path.join(backend_dir, ".env")):
        if os.path.isfile(path):
            load_dotenv(path, override=False)


def _get_supabase_client():
    """SERVICE ROLE auth for full read access. This script never writes."""
    from supabase import create_client
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required.", file=sys.stderr)
        sys.exit(1)
    return create_client(url, key)


def _get_finnhub_key() -> str:
    key = os.environ.get("FINNHUB_API_KEY", "")
    if not key:
        print("ERROR: FINNHUB_API_KEY is not set.", file=sys.stderr)
        sys.exit(1)
    return key


def _load_eligible_companies(supabase, batch_size: int = 1000) -> list:
    """Page through companies WHERE ticker IS NOT NULL AND sector IS NULL."""
    out: list = []
    offset = 0
    while True:
        resp = (supabase.table("companies")
                .select("id, name, ticker, mention_count")
                .not_.is_("ticker", "null")
                .is_("sector", "null")
                .order("mention_count", desc=True)
                .range(offset, offset + batch_size - 1)
                .execute())
        rows = resp.data or []
        out.extend(rows)
        if len(rows) < batch_size:
            return out
        offset += batch_size


def _map_industry(raw: Optional[str]) -> Tuple[str, str]:
    """Returns (mapped_sector, confidence in {"clean","ambiguous","failed"})."""
    if raw is None or not str(raw).strip():
        return ("", "ambiguous")
    normalized = " ".join(str(raw).lower().split())
    mapped = FINNHUB_TO_VERTICAL.get(normalized)
    return (mapped, "clean") if mapped else ("", "ambiguous")


def _fetch_profile(ticker: str, finnhub_key: str, requests_module) -> Tuple[Optional[str], bool]:
    """Returns (finnhubIndustry_raw, was_rate_limited). On any other error returns (None, False)."""
    try:
        resp = requests_module.get(FINNHUB_PROFILE2_URL,
            params={"symbol": ticker},
            headers={"X-Finnhub-Token": finnhub_key},
            timeout=15)
    except Exception as ex:  # noqa: BLE001
        print("backfill_sectors: fetch error for {}: {}".format(ticker, ex), file=sys.stderr)
        return (None, False)
    if resp.status_code == 429:
        return (None, True)
    if resp.status_code != 200:
        print("backfill_sectors: HTTP {} for {} body={}".format(
            resp.status_code, ticker, resp.text[:120]), file=sys.stderr)
        return (None, False)
    try:
        data = resp.json() or {}
    except Exception:  # noqa: BLE001
        return (None, False)
    industry = data.get("finnhubIndustry")
    return (str(industry) if industry is not None else None, False)


def main() -> int:
    parser = argparse.ArgumentParser(description=(
        "Backfill: propose companies.sector via Finnhub /stock/profile2. "
        "DRY-RUN ONLY in this PR. Writes a CSV; never writes the DB."))
    parser.add_argument("--out-csv", required=True, help="Path to write proposed-mapping CSV.")
    parser.add_argument("--limit", type=int, default=None, help="Cap rows probed (testing).")
    parser.add_argument("--dry-run", action="store_true", default=True,
        help="Default and only mode in this PR. Reserved for forward compatibility.")
    args = parser.parse_args()

    _load_env()
    finnhub_key = _get_finnhub_key()
    supabase = _get_supabase_client()
    import requests

    print("backfill_sectors: starting (mode=DRY-RUN, out_csv={})".format(args.out_csv))
    rows = _load_eligible_companies(supabase)
    if args.limit is not None:
        rows = rows[: args.limit]
    total = len(rows)
    print("backfill_sectors: eligible (ticker NOT NULL AND sector IS NULL) = {}".format(total))
    if total == 0:
        print("total=0 clean=0 ambiguous=0 failed=0")
        return 0

    out_dir = os.path.dirname(os.path.abspath(args.out_csv))
    if out_dir and not os.path.isdir(out_dir):
        os.makedirs(out_dir, exist_ok=True)

    clean = ambiguous = failed = processed = 0
    sleep_sec = SLEEP_BETWEEN_CALLS_SEC
    started = time.time()

    with open(args.out_csv, "w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["id", "name", "ticker", "finnhub_industry_raw",
                         "mapped_sector", "confidence"])
        try:
            for row in rows:
                cid = row.get("id")
                name = row.get("name") or ""
                ticker = row.get("ticker") or ""
                processed += 1
                if not ticker:
                    failed += 1
                    writer.writerow([cid, name, ticker, "", "", "failed"])
                    continue
                raw_industry, was_429 = _fetch_profile(ticker, finnhub_key, requests)
                if was_429:
                    if sleep_sec < SLEEP_AFTER_429_SEC:
                        sleep_sec = SLEEP_AFTER_429_SEC
                        print("backfill_sectors: rate-limited, sleep -> {}s".format(
                            sleep_sec), file=sys.stderr)
                    time.sleep(sleep_sec)
                    raw_industry, was_429 = _fetch_profile(ticker, finnhub_key, requests)
                if raw_industry is None:
                    failed += 1
                    writer.writerow([cid, name, ticker, "", "", "failed"])
                    time.sleep(sleep_sec)
                    continue
                mapped, confidence = _map_industry(raw_industry)
                if confidence == "clean":
                    clean += 1
                else:
                    ambiguous += 1
                writer.writerow([cid, name, ticker, raw_industry, mapped, confidence])
                time.sleep(sleep_sec)
                if processed % PROGRESS_EVERY_N == 0:
                    elapsed = time.time() - started
                    print("backfill_sectors: [{}/{}] elapsed {:.0f}s clean {} ambiguous {} failed {}".format(
                        processed, total, elapsed, clean, ambiguous, failed))
        except KeyboardInterrupt:
            print("backfill_sectors: interrupted", file=sys.stderr)
            return 130

    elapsed = time.time() - started
    print("backfill_sectors: DONE total={} clean={} ambiguous={} failed={} elapsed={:.0f}s".format(
        processed, clean, ambiguous, failed, elapsed))
    print("backfill_sectors: csv written to {}".format(args.out_csv))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("backfill_sectors: interrupted", file=sys.stderr)
        sys.exit(130)
    except Exception as ex:  # noqa: BLE001
        print("backfill_sectors: FATAL: {}".format(ex), file=sys.stderr)
        sys.exit(1)
