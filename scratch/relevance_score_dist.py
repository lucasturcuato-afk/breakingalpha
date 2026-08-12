"""THROWAWAY, READ-ONLY. Relevance-score distribution for the last 48h.

Do not commit. Delete after use.

Purpose: test whether the 23.4% of stored articles at relevance_score == 10 is
explained by grader failures falling back to the saturated legacy Flash-Lite
score, or by the new grader genuinely emitting too many 10s.

NOTE ON THE TIME COLUMN: `articles` has no `created_at`. Per the ingest comment
("articles has no created_at; the true ingest time lives in ingested_at"), this
uses `ingested_at`, which is the DB-defaulted write time.

SEC SPLIT: `apply_relevance_grade` never re-grades an article whose
relevance_reason contains "deterministic SEC bypass" -- those keep a score
pinned by item code and never touch the LLM. They must be separated out before
any claim about the grader's own distribution.

Run:
  cd ~/Desktop/signalera && set -a && . ./.env.local && set +a && \
  SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" .venv/bin/python scratch/relevance_score_dist.py
"""

from __future__ import annotations

import collections
import datetime
import os
import sys

from supabase import create_client

SEC_MARKER = "deterministic SEC bypass"
PAGE = 1000
MAX_ROWS = 20000


def _client():
    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("SUPABASE_ANON_KEY")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    )
    if not url or not key:
        sys.exit("missing SUPABASE_URL / key in env")
    return create_client(url, key)


def _table(title: str, counter: collections.Counter, total: int) -> None:
    print(f"\n{title}  (n={total})")
    if total == 0:
        print("  (no rows)")
        return
    print(f"  {'score':>6}  {'count':>7}  {'pct':>7}")
    for score in range(0, 11):
        c = counter.get(score, 0)
        print(f"  {score:>6}  {c:>7}  {100.0 * c / total:>6.1f}%")
    other = {k: v for k, v in counter.items() if k is None or k < 0 or k > 10}
    for k, v in sorted(other.items(), key=lambda kv: str(kv[0])):
        print(f"  {str(k):>6}  {v:>7}  {100.0 * v / total:>6.1f}%   <-- outside 0-10")


def main() -> None:
    sb = _client()
    cutoff = (
        datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=48)
    ).isoformat()

    rows: list[dict] = []
    for start in range(0, MAX_ROWS, PAGE):
        resp = (
            sb.table("articles")
            .select("id, relevance_score, relevance_reason, source, ingested_at")
            .gte("ingested_at", cutoff)
            .order("ingested_at", desc=True)
            .range(start, start + PAGE - 1)
            .execute()
        )
        page = resp.data or []
        rows.extend(page)
        if len(page) < PAGE:
            break

    total = len(rows)
    print(f"articles with ingested_at >= {cutoff}")
    print(f"rows fetched: {total}  (cap {MAX_ROWS})")

    allc = collections.Counter(r.get("relevance_score") for r in rows)
    sec, non_sec = [], []
    for r in rows:
        if SEC_MARKER in (r.get("relevance_reason") or ""):
            sec.append(r)
        else:
            non_sec.append(r)

    _table("ALL ARTICLES", allc, total)
    _table(
        "SEC-BYPASSED (relevance_reason contains 'deterministic SEC bypass') "
        "-- never graded by the LLM",
        collections.Counter(r.get("relevance_score") for r in sec),
        len(sec),
    )
    _table(
        "NON-SEC (the population the new grader actually scores)",
        collections.Counter(r.get("relevance_score") for r in non_sec),
        len(non_sec),
    )

    # Headline comparison the investigation turns on.
    def pct(c: collections.Counter, n: int, v: int) -> str:
        return "n/a" if not n else f"{100.0 * c.get(v, 0) / n:.1f}%"

    secc = collections.Counter(r.get("relevance_score") for r in sec)
    nonc = collections.Counter(r.get("relevance_score") for r in non_sec)
    print("\nSUMMARY")
    print(f"  share of ALL      at exactly 10: {pct(allc, total, 10)}")
    print(f"  share of SEC      at exactly 10: {pct(secc, len(sec), 10)}")
    print(f"  share of NON-SEC  at exactly 10: {pct(nonc, len(non_sec), 10)}")
    print(f"  SEC rows as share of all stored: "
          f"{'n/a' if not total else f'{100.0 * len(sec) / total:.1f}%'}")


if __name__ == "__main__":
    main()
