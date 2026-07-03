"""
Read-only dry-run harness for the attribution grader.

Compares, for each real morning_brief_calls row, the LEGACY naive verdict
against the NEW attribution-aware verdict over the SAME candle window, so
the diff is purely the attribution logic (not the data source). Surfaces
every flip, with the credibility-critical class called out separately:
calls the naive grader scored 'correct' that the attribution grader
downgrades because a benchmark move explains them (correct -> confounded).

This NEVER writes to the database and does NOT require
sql/0010_call_attribution_grading.sql to be applied. It only SELECTs
morning_brief_calls (+ a companies lookup for sector benchmarks) and
calls the paced Finnhub candle helper. Nothing is inserted.

Run
---
    # today's calls
    python -m backend.grading.dryrun_attribution

    # a wider sample to eyeball the flips before tuning thresholds
    python -m backend.grading.dryrun_attribution --since 2026-06-01 --limit 200

    # machine-readable, one JSON object per call (for spreadsheets/diffing)
    python -m backend.grading.dryrun_attribution --since 2026-06-01 --json

Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FINNHUB_API_KEY.
GEMINI is not needed (no verdict notes are generated in a dry run).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter
from datetime import date, timedelta

from supabase import create_client

from backend.grading.benchmarks import sectors_for_tickers
from backend.grading.price_attribution import PriceAttributionGrader
from backend.grading.resolver import default_resolver


# --- Legacy naive logic, reproduced verbatim for comparison only. ----------
# This is the pre-attribution rule the new grader replaces. It lives here
# (not imported) so the dry run keeps comparing against a frozen baseline
# even after the old code is gone.

def _naive_direction(entity_pct_frac: float) -> str:
    """0.1% dead band on the fractional move, matching the old grader."""
    if entity_pct_frac > 0.001:
        return "up"
    if entity_pct_frac < -0.001:
        return "down"
    return "flat"


def _naive_verdict(expected: str, actual: str) -> str:
    if expected == "bullish" and actual == "up":
        return "correct"
    if expected == "bearish" and actual == "down":
        return "correct"
    if expected == "neutral" and actual == "flat":
        return "correct"
    if expected == "neutral" and actual in ("up", "down"):
        return "partial"
    if expected in ("bullish", "bearish") and actual == "flat":
        return "partial"
    return "wrong"


# --- Flip classification ---------------------------------------------------

def _flip_class(naive: str, new_verdict: str, attribution: str | None) -> str:
    if naive == new_verdict:
        return "unchanged" if naive != "n/a" else "n/a"
    if naive == "correct" and new_verdict != "correct":
        # The credibility case: a naive hit the new grader will not credit.
        if attribution == "confounded":
            return "DOWNGRADE correct->confounded"
        return f"DOWNGRADE correct->{new_verdict}/{attribution or '-'}"
    if new_verdict == "correct" and naive != "correct":
        return f"UPGRADE {naive}->correct/{attribution or '-'}"
    return f"changed {naive}->{new_verdict}/{attribution or '-'}"


def _fmt_call(call: dict, naive: str, out, flip: str) -> str:
    meta = out.metadata
    sym = meta.get("entity_symbol") or call.get("target_symbol") or "?"
    if not out.is_gradable:
        return (
            f"  [{flip:32}] {call['claim_type']:9} {sym:6} "
            f"naive={naive:8} new=UNGRADABLE({meta.get('ungradable_reason')})"
        )
    benches = " ".join(
        f"{b['symbol']}{b['move_pct']:+.2f}%(exc{b['excess_pct']:+.2f})"
        for b in meta.get("benchmarks", [])
    ) or "no-benchmark"
    return (
        f"  [{flip:32}] {call['claim_type']:9} {sym:6} "
        f"exp={call['expected_direction']:7} "
        f"move={meta.get('entity_move_pct'):+.2f}% "
        f"tier={meta.get('tier'):12} "
        f"naive={naive:8} new={out.verdict:9}/{out.attribution or '-':12} "
        f"conf={meta.get('attribution_confidence')} | {benches}"
    )


def main() -> None:
    p = argparse.ArgumentParser(
        description="Read-only dry run: naive vs attribution verdicts. No DB writes."
    )
    p.add_argument("--since", help="ISO date; grade calls with brief_date >= this.")
    p.add_argument("--until", help="ISO date; brief_date <= this (default today).")
    p.add_argument("--limit", type=int, default=100, help="Max calls (default 100).")
    p.add_argument("--json", action="store_true", help="Emit one JSON object per call.")
    args = p.parse_args()

    sb = create_client(
        os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    )

    q = sb.table("morning_brief_calls").select("*")
    if args.since:
        q = q.gte("brief_date", args.since)
    else:
        q = q.gte("brief_date", (date.today() - timedelta(days=1)).isoformat())
    if args.until:
        q = q.lte("brief_date", args.until)
    q = q.order("brief_date", desc=True).limit(args.limit)
    calls = q.execute().data or []

    if not args.json:
        print(
            "[dryrun] READ-ONLY. No rows written; migration not required.\n"
            f"[dryrun] {len(calls)} calls in window."
        )
    if not calls:
        return

    tickers = {
        (c.get("target_symbol") or "").strip().upper()
        for c in calls
        if c.get("claim_type") == "ticker" and c.get("target_symbol")
    }
    ticker_sectors = sectors_for_tickers(sb, tickers)
    resolver = default_resolver(PriceAttributionGrader(ticker_sectors=ticker_sectors))

    flips: Counter = Counter()
    downgrades: list[str] = []
    lines: list[str] = []

    for call in calls:
        out = resolver.resolve(call)
        if out.is_gradable and out.actual_pct_change is not None:
            naive = _naive_verdict(
                (call.get("expected_direction") or "").lower(),
                _naive_direction(out.actual_pct_change),
            )
        else:
            naive = "n/a"  # naive grader would also have skipped (no price)
        flip = _flip_class(naive, out.verdict, out.attribution)
        flips[flip] += 1

        if args.json:
            print(json.dumps({
                "call_id": call["id"],
                "brief_date": call.get("brief_date"),
                "claim_type": call.get("claim_type"),
                "target_symbol": call.get("target_symbol"),
                "expected_direction": call.get("expected_direction"),
                "naive_verdict": naive,
                "new_verdict": out.verdict,
                "attribution": out.attribution,
                "flip": flip,
                "metadata": out.metadata,
            }))
            continue

        line = _fmt_call(call, naive, out, flip)
        lines.append(line)
        if flip.startswith("DOWNGRADE"):
            downgrades.append(line)

    if args.json:
        return

    # Credibility flips first: these are what you asked to eyeball.
    print("\n=== correct -> not-correct downgrades (the credibility flips) ===")
    print("\n".join(downgrades) if downgrades else "  (none in this window)")

    print("\n=== all calls ===")
    print("\n".join(lines))

    print("\n=== flip summary ===")
    for label, n in sorted(flips.items(), key=lambda kv: (-kv[1], kv[0])):
        print(f"  {n:4}  {label}")
    total_downgrades = sum(v for k, v in flips.items() if k.startswith("DOWNGRADE"))
    print(
        f"\n[dryrun] {total_downgrades}/{len(calls)} naive 'correct' calls "
        "downgraded by attribution. Eyeball the block above before tuning "
        "thresholds in backend/grading/price_attribution.py.",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
