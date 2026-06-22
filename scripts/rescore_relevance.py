"""
rescore_relevance.py - re-grade the existing articles corpus with the NEW
re-anchored relevance grader, in lockstep with production.

WHY THIS EXISTS
Backend flipped RELEVANCE_GRADE_MODE=new. New rows are de-saturated, but the
rolling 7-day Top Stories window still holds saturated LEGACY rows scored by the
old grader (avg ~8.7, full of exact-10s). Those legacy 10s resurface as today's
fresh, correctly-graded 10s age out. This script re-grades the in-window rows
through the SAME grader prod now uses so the window is internally consistent.

LOCKSTEP GUARANTEE
This script does NOT reimplement the prompt, model, schema, or parser. It imports
backend/ingest.py and calls ingest.grade_relevance(article) directly. The prompt
(ingest.py:RELEVANCE_GRADE_PROMPT), model (ingest.py:RELEVANCE_GRADE_MODEL),
response schema (ingest.py:RelevanceGrade), generation config (temp 0.2,
thinking_budget=0, max_output_tokens=2048), and score clamp
(ingest.py:_clamp_relevance_score) are therefore byte-identical to prod. If prod
changes the grader, this script changes with it on the next import. The grader
reads ONLY title + source + summary[:600] (ingest.py:534-540) - exactly the
fields this script feeds it.

WHAT IT TOUCHES
UPDATE articles SET relevance_score = <new> WHERE id = <id>. Nothing else. No
deletes, no other columns, no mentions, no companies. Idempotent: the grader is
near-deterministic at temp 0.2 and writes an absolute score, so running --write
twice converges to the same end state (the second pass re-grades to ~the same
number it just wrote).

MODES
  --dry-run (DEFAULT)  read + re-grade a sample + report. Writes NOTHING.
  --write              perform the UPDATEs. Must be passed EXPLICITLY.

The full-scope count and the BEFORE distribution come from a pure SQL aggregate
(no Gemini). In --dry-run, --sample N bounds how many rows get live-graded so
cost/latency are measured on a representative random sample and extrapolated.

USAGE (from repo root, with .env.local present and GEMINI_API_KEY set)
  # dry-run, sample 200 rows for the after-distribution + cost model:
  python scripts/rescore_relevance.py --dry-run --days 7 --sample 200

  # owner's manual step (NOT run by agents): apply the re-grade to all rows:
  python scripts/rescore_relevance.py --write --days 7
"""

import argparse
import concurrent.futures
import os
import random
import sys
import time
from datetime import datetime, timezone, timedelta

from dotenv import load_dotenv

load_dotenv()
load_dotenv(".env.local")

# Resolve backend/ so we can import the production grader and the shared service
# client. backend/ingest.py builds gemini_client at import and requires
# GEMINI_API_KEY; it also builds the Supabase service client. We reuse BOTH so
# the script stays in lockstep with prod rather than forking a second grader.
_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_BACKEND = os.path.join(_REPO_ROOT, "backend")
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)


def _build_supabase():
    """Service-role client, matching backend conventions (supabase_client.py).

    Falls back to anon if service role is absent - anon is enough for the SELECT
    aggregate and the --dry-run path (no writes). --write requires service role
    and will fail loud on RLS if anon is all that is present, which is correct."""
    from supabase import create_client

    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("SUPABASE_ANON_KEY")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    )
    if not url or not key:
        print("ERROR: SUPABASE_URL / key missing in env. Aborting (nothing done).")
        sys.exit(2)
    return create_client(url, key)


def _window_cutoff_iso(days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


# Gemini Flash pricing (USD per 1M tokens), gemini-2.5-flash standard tier.
# Used ONLY to translate measured token counts into a dollar figure. Adjust if
# the grader model (ingest.RELEVANCE_GRADE_MODEL) changes tier.
_FLASH_PRICE_IN_PER_M = 0.30
_FLASH_PRICE_OUT_PER_M = 2.50


def _fetch_scope_rows(supabase, cutoff_iso: str, min_score: float | None = None) -> list[dict]:
    """All in-window rows with the fields the grader needs + current score.

    Paginates because PostgREST caps a single response (default 1000). SELECT
    only - never mutates. When min_score is set, narrows the window to rows whose
    current relevance_score is at or above it (used to target un-rescored rows
    that still carry saturated legacy scores)."""
    rows: list[dict] = []
    page = 0
    page_size = 1000
    while True:
        query = (
            supabase.table("articles")
            .select("id, title, source, summary, relevance_score")
            .gte("ingested_at", cutoff_iso)
        )
        if min_score is not None:
            query = query.gte("relevance_score", min_score)
        resp = (
            query
            .order("id")
            .range(page * page_size, page * page_size + page_size - 1)
            .execute()
        )
        batch = resp.data or []
        rows.extend(batch)
        if len(batch) < page_size:
            break
        page += 1
    return rows


def _before_distribution(rows: list[dict]) -> dict:
    scores = [r["relevance_score"] for r in rows if r.get("relevance_score") is not None]
    n = len(scores)
    if n == 0:
        return {"n": 0}
    return {
        "n": n,
        "avg": round(sum(scores) / n, 3),
        "pct_ge8": round(100.0 * sum(1 for s in scores if s >= 8) / n, 1),
        "pct_eq10": round(100.0 * sum(1 for s in scores if s == 10) / n, 1),
        "pct_1to5": round(100.0 * sum(1 for s in scores if 1 <= s <= 5) / n, 1),
    }


def _grade_one(ingest, row: dict):
    """Re-grade one DB row via the production grader. Returns the grader dict
    {score, band, reason} or None on grader failure. Builds the article dict in
    exactly the shape grade_relevance reads (title, source, summary)."""
    article = {
        "title": row.get("title") or "",
        "source": row.get("source") or "",
        "summary": row.get("summary") or "",
    }
    return ingest.grade_relevance(article)


def _grade_rows_parallel(ingest, rows: list[dict], workers: int):
    """Re-grade rows with the SAME shared-pool parallelism prod uses
    (FILTER_PARALLEL_WORKERS). Returns (row, grade-or-None) pairs in input
    order."""
    results = [None] * len(rows)
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(_grade_one, ingest, row): i for i, row in enumerate(rows)}
        done = 0
        for fut in concurrent.futures.as_completed(futs):
            i = futs[fut]
            try:
                grade = fut.result()
            except Exception as exc:  # never let one row kill the pass
                print(f"  [rescore] row {rows[i].get('id')} grader raised: {exc}")
                grade = None
            results[i] = (rows[i], grade)
            done += 1
            if done % 25 == 0:
                print(f"  [rescore] graded {done}/{len(rows)}")
    return results


def _after_distribution(graded):
    """After-distribution over the sample. Mirrors prod's fallback contract: a
    grader failure (None) RETAINS the legacy score (apply_relevance_grade falls
    back to the legacy score when grade_relevance returns None,
    ingest.py:apply_relevance_grade), so the after-score for a failed row is its
    current score."""
    new_scores = []
    failures = 0
    for row, grade in graded:
        if grade is None:
            failures += 1
            new_scores.append(row.get("relevance_score"))
        else:
            new_scores.append(grade["score"])
    scores = [s for s in new_scores if s is not None]
    n = len(scores)
    dist = {"n": n, "grader_failures": failures}
    if n:
        dist.update(
            {
                "avg": round(sum(scores) / n, 3),
                "pct_ge8": round(100.0 * sum(1 for s in scores if s >= 8) / n, 1),
                "pct_eq10": round(100.0 * sum(1 for s in scores if s == 10) / n, 1),
                "pct_1to5": round(100.0 * sum(1 for s in scores if 1 <= s <= 5) / n, 1),
            }
        )
    return dist


def _spot_check(graded, k: int = 8):
    """A few before->after rows: the biggest demotions (legacy junk) and the
    retained high-scorers (genuine material), to eyeball that the right things
    move and the right things stay."""
    rows = [
        {
            "before": row.get("relevance_score"),
            "after": grade["score"],
            "band": grade["band"],
            "delta": grade["score"] - (row.get("relevance_score") or 0),
            "title": (row.get("title") or "")[:90],
        }
        for row, grade in graded
        if grade is not None and row.get("relevance_score") is not None
    ]
    demoted = sorted(rows, key=lambda r: r["delta"])[:k]
    retained = [r for r in rows if r["before"] >= 8 and r["after"] >= 8][:k]
    return {"demoted": demoted, "retained": retained}


def _cost_model(ingest, n_graded: int, wall_sec: float):
    """Translate the measured filter-usage counters (ingest._FILTER_USAGE, summed
    across the grader calls this run made) into per-row latency and per-row /
    full-scope cost. Uses the same usage accounting prod uses."""
    usage = dict(ingest._FILTER_USAGE)
    calls = usage.get("calls", 0) or 0
    prompt_tok = usage.get("prompt", 0) or 0
    out_tok = (usage.get("candidates", 0) or 0) + (usage.get("thoughts", 0) or 0)
    in_cost = prompt_tok / 1_000_000 * _FLASH_PRICE_IN_PER_M
    out_cost = out_tok / 1_000_000 * _FLASH_PRICE_OUT_PER_M
    total_cost = in_cost + out_cost
    per_row_cost = total_cost / calls if calls else 0.0
    per_row_latency = wall_sec / n_graded if n_graded else 0.0
    return {
        "graded_calls": calls,
        "prompt_tokens": prompt_tok,
        "output_tokens": out_tok,
        "in_cost_usd": round(in_cost, 4),
        "out_cost_usd": round(out_cost, 4),
        "sample_cost_usd": round(total_cost, 4),
        "per_row_cost_usd": round(per_row_cost, 6),
        "per_row_latency_s": round(per_row_latency, 3),
        "price_in_per_m": _FLASH_PRICE_IN_PER_M,
        "price_out_per_m": _FLASH_PRICE_OUT_PER_M,
    }


def run_dry(args) -> int:
    supabase = _build_supabase()
    cutoff = _window_cutoff_iso(args.days)

    # 1) Pure-SQL scope: full count + BEFORE distribution. No Gemini.
    print(f"[rescore] fetching scope rows ingested >= {cutoff} ({args.days}d window)...")
    rows = _fetch_scope_rows(supabase, cutoff, args.min_score)
    before = _before_distribution(rows)
    print(f"[rescore] full scope: {before['n']} rows")
    print(f"[rescore] BEFORE distribution (full scope): {before}")

    # 2) Live re-grade on a representative random sample for AFTER + cost.
    if not os.environ.get("GEMINI_API_KEY"):
        print("[rescore] GEMINI_API_KEY not set: cannot run the live re-grade.")
        print("[rescore] Reporting full-scope count + BEFORE distribution only.")
        print(
            "[rescore] cost model the script WOULD use: per-row = "
            f"prompt_tok/1e6*{_FLASH_PRICE_IN_PER_M} + out_tok/1e6*{_FLASH_PRICE_OUT_PER_M}, "
            "measured from ingest._FILTER_USAGE over the sample."
        )
        return 0

    import ingest  # noqa: E402  (import here: builds gemini_client, needs the key)

    sample_n = min(args.sample, len(rows))
    rng = random.Random(args.seed)
    sample = rng.sample(rows, sample_n) if sample_n < len(rows) else list(rows)
    print(f"[rescore] live re-grading random sample of {sample_n} (seed={args.seed})...")

    ingest._reset_filter_usage()
    t0 = time.monotonic()
    graded = _grade_rows_parallel(ingest, sample, args.workers)
    wall = time.monotonic() - t0

    after = _after_distribution(graded)
    spot = _spot_check(graded)
    cost = _cost_model(ingest, sample_n, wall)

    full_n = before["n"]
    extrapolated_cost = round(cost["per_row_cost_usd"] * full_n, 2)
    # Wall-clock at the configured worker count: rows / (rows-per-sec at this pool size).
    rows_per_sec = (sample_n / wall) if wall else 0.0
    extrapolated_wall_min = round((full_n / rows_per_sec) / 60.0, 1) if rows_per_sec else None

    print("\n========== DRY-RUN REPORT (writes NOTHING) ==========")
    print(f"window_days        : {args.days}")
    print(f"full_scope_rows    : {full_n}")
    print(f"BEFORE (full scope): {before}")
    print(f"AFTER  (sampled n={after['n']}, extrapolated): {after}")
    print(f"grader_failures    : {after.get('grader_failures')} (retained legacy score, per prod fallback)")
    print(f"cost (sample)      : {cost}")
    print(f"extrapolated_full_cost_usd : {extrapolated_cost}")
    print(f"extrapolated_full_wall_min : {extrapolated_wall_min} (at {args.workers} workers)")
    print("\n-- spot-check: biggest demotions (legacy junk demoting) --")
    for r in spot["demoted"]:
        print(f"  {r['before']:>2} -> {r['after']:<2} [{r['band']}] {r['title']}")
    print("\n-- spot-check: retained high (genuine material staying >=8) --")
    for r in spot["retained"]:
        print(f"  {r['before']:>2} -> {r['after']:<2} [{r['band']}] {r['title']}")
    print("=====================================================")
    return 0


def run_write(args) -> int:
    """Apply the re-grade to ALL in-window rows. UPDATE relevance_score only.

    This is the owner's manual step. Agents never run it. Idempotent: the grader
    writes an absolute score, so a second pass converges to the same state."""
    if not os.environ.get("GEMINI_API_KEY"):
        print("ERROR: --write needs GEMINI_API_KEY. Aborting (nothing written).")
        return 2
    supabase = _build_supabase()
    cutoff = _window_cutoff_iso(args.days)
    import ingest  # noqa: E402

    rows = _fetch_scope_rows(supabase, cutoff, args.min_score)
    print(f"[rescore:write] re-grading + updating {len(rows)} rows ({args.days}d window)...")
    ingest._reset_filter_usage()
    graded = _grade_rows_parallel(ingest, rows, args.workers)

    updated = 0
    skipped_fail = 0
    unchanged = 0
    for row, grade in graded:
        if grade is None:
            skipped_fail += 1  # prod fallback: keep legacy score, do not write
            continue
        if grade["score"] == row.get("relevance_score"):
            unchanged += 1
            continue
        # UPDATE relevance_score ONLY. No other column touched.
        supabase.table("articles").update({"relevance_score": grade["score"]}).eq(
            "id", row["id"]
        ).execute()
        updated += 1
    print(
        f"[rescore:write] done. updated={updated} unchanged={unchanged} "
        f"grader_failures_skipped={skipped_fail}"
    )
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description="Re-grade the articles corpus with the new relevance grader.")
    mode = p.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="read + re-grade a sample + report; writes nothing (DEFAULT)")
    mode.add_argument("--write", action="store_true", help="apply the UPDATEs (must be explicit)")
    p.add_argument("--days", type=int, default=7, help="window: rows ingested in the last N days (default 7)")
    p.add_argument("--min-score", type=float, default=None, help="narrow the window to rows with relevance_score >= this value (default: no filter; targets un-rescored rows still carrying saturated legacy scores)")
    p.add_argument("--sample", type=int, default=200, help="dry-run: rows to live-grade for the after-dist + cost (default 200)")
    p.add_argument("--workers", type=int, default=int(os.getenv("FILTER_PARALLEL_WORKERS", "50")), help="parallel grader workers (default FILTER_PARALLEL_WORKERS=50)")
    p.add_argument("--seed", type=int, default=1729, help="random seed for the dry-run sample")
    args = p.parse_args()

    if args.write:
        return run_write(args)
    return run_dry(args)  # default is dry-run


if __name__ == "__main__":
    raise SystemExit(main())
