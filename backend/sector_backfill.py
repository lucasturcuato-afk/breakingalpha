"""
sector_backfill — nightly idempotent fill of companies.sector

Wired into run.py after INGEST so newly-ingested companies that arrived with
NULL sector get populated within 24h. Initial 1,214-row backfill was performed
on 2026-05-18 via the same logic (see migrations/2026-05-18-wd92-backfill-
companies-sector.sql for the canonical SQL).

Replicates the CTE+UPDATE in Python+supabase-py because the rest of the
backend uses no raw SQL at runtime (PostgREST only — no supabase.rpc() or
DATABASE_URL anywhere in backend/*.py). Aggregation happens in a single
fetch+groupby pass; writes are grouped by sector value into 11 batched
.update().in_() calls (one per canonical sector), not per-row.

Idempotent via the .or_('sector.is.null,sector.eq.') filter on every update —
already-populated rows are never touched, manually-set sectors are preserved.
"""

import os
from collections import Counter, defaultdict
from supabase import create_client

PLACEHOLDERS = {'null', '<null>', 'unknown', 'newco', 'targetco',
                'n/a', 'na', 'none', 'tbd', 'pending'}


def _fetch_all(sb, table, columns, *, filters=None, page_size=1000):
    rows, offset = [], 0
    while True:
        q = sb.table(table).select(columns)
        for f in (filters or []):
            q = f(q)
        batch = q.range(offset, offset + page_size - 1).execute().data
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return rows


def run():
    """Idempotent fill — only touches companies where sector IS NULL OR ''.

    Returns int — number of rows the UPDATE attempted to write (sum across
    sector groups). On steady state (no new NULL companies), returns 0.
    """
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])

    companies = _fetch_all(
        sb, "companies", "id, name, sector",
        filters=[lambda q: q.or_("sector.is.null,sector.eq.")],
    )
    if not companies:
        return 0

    articles = _fetch_all(
        sb, "articles", "primary_company, sector",
        filters=[
            lambda q: q.not_.is_("primary_company", "null"),
            lambda q: q.neq("primary_company", ""),
            lambda q: q.not_.is_("sector", "null"),
            lambda q: q.neq("sector", ""),
        ],
    )

    by_lc = defaultdict(Counter)
    for a in articles:
        pc = (a.get("primary_company") or "").strip()
        sec = (a.get("sector") or "").strip()
        if not pc or not sec:
            continue
        lc = pc.lower()
        if lc in PLACEHOLDERS:
            continue
        by_lc[lc][sec] += 1

    # Mode with alphabetical-ASC tiebreaker — matches the SQL ROW_NUMBER OVER
    # (ORDER BY count DESC, sector ASC) in the migration. Deterministic.
    mode_per_lc = {
        lc: sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
        for lc, counter in by_lc.items()
    }

    groups = defaultdict(list)
    for c in companies:
        lc = (c.get("name") or "").strip().lower()
        if lc in mode_per_lc:
            groups[mode_per_lc[lc]].append(c["id"])

    total = 0
    for sec, ids in groups.items():
        # Chunk to keep PostgREST URL length sane on the .in_() filter
        for i in range(0, len(ids), 500):
            chunk = ids[i:i + 500]
            (
                sb.table("companies")
                  .update({"sector": sec})
                  .in_("id", chunk)
                  .or_("sector.is.null,sector.eq.")
                  .execute()
            )
            total += len(chunk)

    return total


if __name__ == "__main__":
    n = run()
    print(f"sector_backfill: attempted writes on {n} companies")
