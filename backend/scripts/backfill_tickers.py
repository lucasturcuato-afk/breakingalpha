"""
W2-C one-time ticker backfill.

Diagnosis (2026-05-03):
  companies.ticker is null for every row (0 of 2,907). PR #196 ships a
  CompanyStockChart component but the conditional gate
    { ticker && <CompanyStockChart .../> }
  fails for every company. The code is correct; the data is missing.

This script populates companies.ticker by querying Finnhub
  GET https://finnhub.io/api/v1/search?q=<name>
for each row where ticker IS NULL and selecting the best Common Stock
match. It writes via supabase-py with the SERVICE ROLE key (bypasses RLS).

Matching algorithm (canonical, mirrored from src/app/api/finnhub-search/
route.ts but stricter on the type filter):

  candidates = [c for c in result if c.type == "Common Stock"]
  if empty: return None
  primary = [c for c in candidates if "." not in c.displaySymbol]
  if primary: return primary[0].symbol
  return candidates[0].symbol

Rate limits:
  Finnhub free tier is 60 req/min. We sleep 1.1s between calls (~55/min).
  On HTTP 429 we sleep 60s and retry once.

Usage:
  cd /Users/noahhanning/breakingalpha
  set -a && source .env.local && source backend/.env && set +a
  .venv/bin/python -m backend.scripts.backfill_tickers --dry-run
  .venv/bin/python -m backend.scripts.backfill_tickers   # live

ASCII only. No em-dashes.
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from typing import Optional

# Dual-path import to mirror entity_resolver.py / backfill_aliases.py:
# cron runs with cwd=backend/; tests/dev run with cwd=repo-root. We don't
# actually import a backend module today, but keep the pattern consistent
# so future helpers can be added cleanly.
try:
    import normalize  # noqa: F401  # cron context: cwd=backend/
except ImportError:
    try:
        from backend import normalize  # noqa: F401  # repo-root context
    except ImportError:
        pass


FINNHUB_SEARCH_URL = "https://finnhub.io/api/v1/search"
FINNHUB_TIMEOUT_SEC = 5
SLEEP_BETWEEN_CALLS_SEC = 1.1
RATE_LIMIT_SLEEP_SEC = 60
DRY_RUN_SAMPLE_SIZE = 10
PROGRESS_EVERY_N = 50

# Accepted Finnhub result types. ADRs cover foreign companies whose primary US
# listing is via depositary receipts (BABA, TSM, BUD, TM, etc.). Foreign-only
# listings (.L, .DE, .HK) are filtered out at the displaySymbol step regardless
# of type.
ACCEPTED_FINNHUB_TYPES = {"Common Stock", "ADR"}

# Corporate suffixes to strip when the primary search misses. Order in this
# list does NOT affect matching because we test endswith() with each suffix
# in turn and stop at the first hit; a longer suffix that subsumes a shorter
# one (e.g. "Corporation" vs "Corp") is checked first via list order.
# Case-insensitive, whitespace + comma tolerant on the boundary.
_CORPORATE_SUFFIXES = [
    "Corporation",
    "Incorporated",
    "Limited",
    "Company",
    "Holdings",
    "Holding",
    "Corp.",
    "Corp",
    "Inc.",
    "Inc",
    "Ltd.",
    "Ltd",
    "Co.",
    "Co",
    "LLC",
    "L.L.C.",
    "PLC",
    "plc",
    "P.L.C.",
    "S.A.",
    "SA",
    "N.V.",
    "NV",
    "GmbH",
    "AG",
    "SE",
]


def _strip_corporate_suffix(name: str) -> Optional[str]:
    """
    If name ends with a recognized corporate suffix (case-insensitive,
    whitespace-and-comma-tolerant), return the name with that suffix
    removed. Otherwise return None.

    The suffix must be preceded by either whitespace or a comma so we
    don't strip mid-word matches (e.g. "AGCO" must not strip to "GCO"
    by matching "AG").
    """
    base = name.strip()
    base_lower = base.lower()
    for suffix in _CORPORATE_SUFFIXES:
        sl = suffix.lower()
        # Must be preceded by whitespace, comma, or comma+space.
        for boundary in (" ", ",", ", "):
            tail = boundary + sl
            if base_lower.endswith(tail):
                stripped = base[: -len(tail)].rstrip(" ,").strip()
                if stripped and stripped != base:
                    return stripped
                return None
    return None


def _load_env() -> None:
    """
    Load env from .env.local at repo root (where SUPABASE_SERVICE_ROLE_KEY
    lives) and backend/.env (where SUPABASE_URL and FINNHUB_API_KEY live).
    Falls back to the process environment if python-dotenv is not installed.
    """
    try:
        from dotenv import load_dotenv  # type: ignore
    except ImportError:
        return
    here = os.path.dirname(os.path.abspath(__file__))
    backend_dir = os.path.dirname(here)
    repo_root = os.path.dirname(backend_dir)
    root_env = os.path.join(repo_root, ".env.local")
    if os.path.isfile(root_env):
        load_dotenv(root_env, override=False)
    backend_env = os.path.join(backend_dir, ".env")
    if os.path.isfile(backend_env):
        load_dotenv(backend_env, override=False)


def _get_supabase_client():
    """
    Build a supabase-py client using SERVICE ROLE auth so the backfill
    bypasses RLS. Anon key would silently no-op writes through the API.
    """
    from supabase import create_client

    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url:
        print("ERROR: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) is not set.", file=sys.stderr)
        sys.exit(1)
    if not key:
        print(
            "ERROR: SUPABASE_SERVICE_ROLE_KEY is not set. Backfill needs RLS bypass.",
            file=sys.stderr,
        )
        sys.exit(1)
    return create_client(url, key)


def _get_finnhub_key() -> str:
    key = os.environ.get("FINNHUB_API_KEY", "")
    if not key:
        print("ERROR: FINNHUB_API_KEY is not set.", file=sys.stderr)
        sys.exit(1)
    return key


def _count_missing_ticker(supabase) -> int:
    """
    Return the total count of companies rows where ticker IS NULL. Used
    only for the dry-run summary / ETA so we don't double-page the table.
    """
    resp = (
        supabase.table("companies")
        .select("id", count="exact")
        .is_("ticker", "null")
        .limit(1)
        .execute()
    )
    return resp.count or 0


def _iter_missing_ticker_companies(supabase, batch_size: int = 100):
    """
    Yield companies rows where ticker IS NULL, ordered by id, paged via
    .range(). Stops when a batch returns fewer rows than batch_size.

    Note: in LIVE mode each iteration writes back to the row's ticker
    field. We still page by offset because rows we just wrote no longer
    match the IS NULL filter, which would shift later rows leftward and
    cause us to skip companies. To avoid that, we accumulate ids of
    written rows in the caller and we order by id (stable). The simplest
    fix is to fetch the whole id-list up front when we know the count is
    bounded. We do that here.
    """
    offset = 0
    while True:
        resp = (
            supabase.table("companies")
            .select("id, name")
            .is_("ticker", "null")
            .order("id")
            .range(offset, offset + batch_size - 1)
            .execute()
        )
        rows = resp.data or []
        if not rows:
            return
        for r in rows:
            yield r
        if len(rows) < batch_size:
            return
        offset += batch_size


def _load_all_missing_ticker_companies(supabase, batch_size: int = 1000) -> list:
    """
    Pull the full list of (id, name) for rows where ticker IS NULL into
    memory up front. This is safer than paging while writing because LIVE
    writes flip ticker from NULL to a real value, which would cause an
    offset-paged query to skip rows. ~3k rows * ~80 bytes is trivial.
    """
    out: list = []
    offset = 0
    while True:
        resp = (
            supabase.table("companies")
            .select("id, name")
            .is_("ticker", "null")
            .order("id")
            .range(offset, offset + batch_size - 1)
            .execute()
        )
        rows = resp.data or []
        out.extend(rows)
        if len(rows) < batch_size:
            return out
        offset += batch_size


def _call_and_pick_us_primary(query: str, finnhub_key: str) -> Optional[str]:
    """
    Single Finnhub call. Returns the symbol of the best US-primary match, or
    None if no candidate qualifies.

    Match rules (W2-C canonical):
      candidates = [c for c in result if c.type in ('Common Stock', 'ADR')]
      primary    = [c for c in candidates if '.' not in c.displaySymbol]
      if primary: return primary[0].symbol
      return None  # foreign-only listings are deliberately not written

    Returns None on any non-200 / network error after one 429 retry. Errors
    are silent at the caller; we WARN to stderr but never propagate.
    """
    import requests

    params = {"q": query}
    headers = {"X-Finnhub-Token": finnhub_key}

    def _do_call():
        return requests.get(
            FINNHUB_SEARCH_URL,
            params=params,
            headers=headers,
            timeout=FINNHUB_TIMEOUT_SEC,
        )

    try:
        resp = _do_call()
    except Exception as ex:  # noqa: BLE001
        print(
            "backfill_tickers: WARN search failed for {!r}: {}".format(query, ex),
            file=sys.stderr,
        )
        return None

    if resp.status_code == 429:
        print(
            "backfill_tickers: WARN 429 rate-limited on {!r}; sleeping {}s and retrying once".format(
                query, RATE_LIMIT_SLEEP_SEC
            ),
            file=sys.stderr,
        )
        time.sleep(RATE_LIMIT_SLEEP_SEC)
        try:
            resp = _do_call()
        except Exception as ex:  # noqa: BLE001
            print(
                "backfill_tickers: WARN retry after 429 failed for {!r}: {}".format(query, ex),
                file=sys.stderr,
            )
            return None

    if resp.status_code != 200:
        print(
            "backfill_tickers: WARN non-200 status {} for {!r}".format(
                resp.status_code, query
            ),
            file=sys.stderr,
        )
        return None

    try:
        data = resp.json() or {}
    except Exception:  # noqa: BLE001
        return None

    result = data.get("result") or []
    if not isinstance(result, list):
        return None

    candidates = [
        c for c in result
        if isinstance(c, dict) and c.get("type") in ACCEPTED_FINNHUB_TYPES
    ]
    if not candidates:
        return None

    # Foreign-only filter: chosen MUST have a US-primary displaySymbol (no dot
    # exchange suffix). If every candidate is foreign-listed, return None
    # rather than write a .L / .DE / .HK ticker that the Yahoo chart proxy
    # may not handle gracefully.
    primary = [
        c for c in candidates
        if "." not in (c.get("displaySymbol") or "")
    ]
    if not primary:
        return None

    sym = primary[0].get("symbol")
    if not sym or not isinstance(sym, str):
        return None
    return sym.strip() or None


def search_ticker(name: str, finnhub_key: str) -> Optional[str]:
    """
    Two-pass ticker search with corporate-suffix strip retry.

    Pass 1: query Finnhub with the name as-is.
    Pass 2 (only if pass 1 misses): if the name ends with a recognized
            corporate suffix (Inc., Corp., Ltd., etc.), retry once with
            the suffix stripped. Many Finnhub matches fail when the
            suffix + period are included (verified: 'Hologic Inc.' returns
            zero candidates while 'Hologic' returns HOLX).

    Returns the chosen symbol (str) or None. Foreign-only listings
    (displaySymbol contains '.') are deliberately returned as None
    regardless of pass; W2-C policy stores NULL for non-US-primary.

    Sleeps SLEEP_BETWEEN_CALLS_SEC between the two passes so back-to-back
    Finnhub calls stay under the 60/min free-tier limit.
    """
    primary = _call_and_pick_us_primary(name, finnhub_key)
    if primary is not None:
        return primary

    stripped = _strip_corporate_suffix(name)
    if stripped is not None and stripped != name:
        time.sleep(SLEEP_BETWEEN_CALLS_SEC)
        return _call_and_pick_us_primary(stripped, finnhub_key)

    return None


def _format_eta(seconds: float) -> str:
    if seconds < 60:
        return "{:.0f}s".format(seconds)
    minutes = seconds / 60.0
    if minutes < 60:
        return "{:.1f} min".format(minutes)
    hours = minutes / 60.0
    return "{:.2f} hr".format(hours)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="One-time backfill: populate companies.ticker via Finnhub /search."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print proposed name->ticker for the first {} rows; do not write.".format(
            DRY_RUN_SAMPLE_SIZE
        ),
    )
    args = parser.parse_args()

    _load_env()
    finnhub_key = _get_finnhub_key()
    supabase = _get_supabase_client()

    mode = "DRY-RUN" if args.dry_run else "LIVE"
    print("backfill_tickers: starting (mode={})".format(mode))

    rows = _load_all_missing_ticker_companies(supabase)
    total = len(rows)
    eta_sec = total * SLEEP_BETWEEN_CALLS_SEC
    print(
        "backfill_tickers: companies missing ticker = {}; ETA at {:.1f}s/call ~ {}".format(
            total, SLEEP_BETWEEN_CALLS_SEC, _format_eta(eta_sec)
        )
    )

    if total == 0:
        print("inserted=0 skipped=0 no_match=0 errored=0 total=0")
        return 0

    updated = 0
    no_match = 0
    errored = 0
    processed = 0
    sample_logged = 0
    started = time.time()

    # In dry-run we only call Finnhub for the first DRY_RUN_SAMPLE_SIZE rows
    # so we don't burn ~50 minutes on a no-write rehearsal. The spec calls
    # for "first 10 rows actually queried, plus the total count + ETA".
    dry_run_call_cap = DRY_RUN_SAMPLE_SIZE if args.dry_run else None

    try:
        for row in rows:
            cid = row.get("id")
            name = row.get("name")
            processed += 1

            if not cid or not name:
                errored += 1
                print(
                    "backfill_tickers: ERROR unusable row id={} name={!r}".format(cid, name),
                    file=sys.stderr,
                )
                continue

            if dry_run_call_cap is not None and sample_logged >= dry_run_call_cap:
                # Stop spending API calls in dry-run after we've logged the
                # sample. Total / ETA are already printed above.
                break

            ticker = search_ticker(name, finnhub_key)
            time.sleep(SLEEP_BETWEEN_CALLS_SEC)

            if args.dry_run:
                sample_logged += 1
                shown = ticker if ticker else "NO MATCH"
                print(
                    "backfill_tickers: SAMPLE {}: {!r} -> {}".format(
                        sample_logged, name, shown
                    )
                )
                if ticker:
                    updated += 1
                else:
                    no_match += 1
                continue

            # LIVE
            if ticker is None:
                no_match += 1
            else:
                try:
                    supabase.table("companies").update({"ticker": ticker}).eq(
                        "id", cid
                    ).execute()
                    updated += 1
                except Exception as ex:  # noqa: BLE001
                    errored += 1
                    print(
                        "backfill_tickers: ERROR update id={} name={!r} ticker={!r}: {}".format(
                            cid, name, ticker, ex
                        ),
                        file=sys.stderr,
                    )

            if processed % PROGRESS_EVERY_N == 0:
                elapsed = time.time() - started
                print(
                    "backfill_tickers: [{}/{}] elapsed {:.0f}s, updated {}, no_match {}, errored {}".format(
                        processed, total, elapsed, updated, no_match, errored
                    )
                )
    except KeyboardInterrupt:
        print("backfill_tickers: interrupted", file=sys.stderr)
        return 130

    skipped = 0  # rows with an existing ticker are excluded by the IS NULL filter
    print(
        "inserted={} skipped={} no_match={} errored={} total={}".format(
            updated, skipped, no_match, errored, total if not args.dry_run else processed
        )
    )

    return 0 if errored == 0 else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("backfill_tickers: interrupted", file=sys.stderr)
        sys.exit(130)
    except Exception as ex:  # noqa: BLE001
        print("backfill_tickers: FATAL: {}".format(ex), file=sys.stderr)
        sys.exit(1)
