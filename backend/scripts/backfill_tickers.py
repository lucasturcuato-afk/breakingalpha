"""
W2-C ticker backfill (re-runnable, idempotent).

This script delegates the matching algorithm to
backend.finnhub_helper.search_finnhub_ticker so the bulk backfill, the
web-fallback ticker population in entity_resolver.py, and the lazy
lookup at request time in src/lib/finnhub-ticker.ts all share one
canonical implementation. See finnhub_helper.py for the full match
rules: type filter, US-primary preference, suffix-strip retry,
internal-period-strip retry, first-2-tokens retry with denylist guard,
and the mention-count gate.

This script's job is the surrounding loop: page through companies that
need a ticker, call the helper, write back the result, log progress.

Mention-count gate:
  Per Amendment 3 of the rules-alignment sprint, only rows with
  mention_count >= 2 are matched. Rows with mention_count = 1 are
  almost always Gemini extraction noise (a single article mentioned
  the string and it has not recurred). The Warner false positive that
  motivated the gate was a 1-mention row.

Rate limits:
  Finnhub free tier is 60 req/min. We sleep 1.1s between calls between
  successive companies. Each per-company call may internally trigger
  up to 4 Finnhub requests (primary + 3 retries) so worst-case
  effective rate is ~15 names per minute.

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

# Dual-path import to mirror entity_resolver.py: cron runs with
# cwd=backend/; tests/dev run with cwd=repo-root.
try:
    from finnhub_helper import (  # cron context: cwd=backend/
        MIN_MENTION_COUNT_FOR_LOOKUP,
        search_finnhub_ticker,
    )
except ImportError:
    from backend.finnhub_helper import (  # test/dev context: cwd=repo-root
        MIN_MENTION_COUNT_FOR_LOOKUP,
        search_finnhub_ticker,
    )


SLEEP_BETWEEN_CALLS_SEC = 1.1
DRY_RUN_SAMPLE_SIZE = 10
PROGRESS_EVERY_N = 50


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


def _load_eligible_companies(supabase, batch_size: int = 1000) -> list:
    """
    Return rows that need a ticker AND clear the mention-count gate.

    Mention-count gate (Amendment 3): companies with mention_count < 2 are
    Gemini extraction noise. Filtered server-side here so we never spend
    a Finnhub call on them. The same gate is applied as a safety net
    inside finnhub_helper.search_finnhub_ticker.

    The IS NULL filter on ticker also excludes rows we've already
    populated in a previous run, so re-running this script is idempotent.
    """
    out: list = []
    offset = 0
    while True:
        resp = (
            supabase.table("companies")
            .select("id, name, mention_count")
            .is_("ticker", "null")
            .gte("mention_count", MIN_MENTION_COUNT_FOR_LOOKUP)
            .order("id")
            .range(offset, offset + batch_size - 1)
            .execute()
        )
        rows = resp.data or []
        out.extend(rows)
        if len(rows) < batch_size:
            return out
        offset += batch_size


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
        description="Backfill: populate companies.ticker via Finnhub /search."
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

    rows = _load_eligible_companies(supabase)
    total = len(rows)
    # Per-company nominal cost is one Finnhub call (best case) plus
    # SLEEP_BETWEEN_CALLS_SEC. Worst case (3 retries) is ~4x. ETA below
    # uses the nominal cost; expect 1.5x-3x in practice.
    eta_sec = total * SLEEP_BETWEEN_CALLS_SEC
    print(
        "backfill_tickers: eligible companies (ticker IS NULL AND mention_count >= {}) = {}; "
        "ETA at {:.1f}s/call ~ {}".format(
            MIN_MENTION_COUNT_FOR_LOOKUP, total, SLEEP_BETWEEN_CALLS_SEC, _format_eta(eta_sec)
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
    # so we don't burn ~50 minutes on a no-write rehearsal.
    dry_run_call_cap = DRY_RUN_SAMPLE_SIZE if args.dry_run else None

    try:
        for row in rows:
            cid = row.get("id")
            name = row.get("name")
            mc = row.get("mention_count")
            processed += 1

            if not cid or not name:
                errored += 1
                print(
                    "backfill_tickers: ERROR unusable row id={} name={!r}".format(cid, name),
                    file=sys.stderr,
                )
                continue

            if dry_run_call_cap is not None and sample_logged >= dry_run_call_cap:
                break

            ticker = search_finnhub_ticker(
                name, mention_count=mc, finnhub_key=finnhub_key
            )
            time.sleep(SLEEP_BETWEEN_CALLS_SEC)

            if args.dry_run:
                sample_logged += 1
                shown = ticker if ticker else "NO MATCH"
                print(
                    "backfill_tickers: SAMPLE {}: {!r} (mc={}) -> {}".format(
                        sample_logged, name, mc, shown
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

    skipped = 0  # rows with an existing ticker AND rows below the gate are excluded server-side
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
