"""
source_credibility.py — Signalera Source Credibility Layer (Phase 5)

Joins graded theses back to their supporting articles and attributes each
thesis outcome (confirmed / invalidated / inconclusive) to every source
that contributed an article. The resulting win-rate table is consumed by
`trend_mapper.py` as a gentle multiplier on cluster strength.

Schema
------
Run `SOURCE_CREDIBILITY_DDL` (below) ONCE in the Supabase SQL editor.
Safe to re-run (IF NOT EXISTS).

Wiring
------
Exposed via `main()`, wired into `backend/run.py` as a soft-fail step
after `pattern_memory`. Exposes `load_win_rates()` as a read helper for
`trend_mapper.py` to fetch `{source: win_rate}` at scoring time.
"""

import os
import json
import logging
from collections import defaultdict
from datetime import datetime, timezone

from supabase import create_client


logger = logging.getLogger(__name__)


supabase = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])


# ==========================================================================
# DDL — paste into Supabase SQL editor ONCE before this module runs
# ==========================================================================
SOURCE_CREDIBILITY_DDL = """
-- Signalera source credibility
-- Run ONCE in the Supabase SQL editor. Safe to re-run (IF NOT EXISTS).

create table if not exists source_credibility (
    source        text        primary key,
    n_theses      int         not null default 0,
    n_confirmed   int         not null default 0,
    n_invalidated int         not null default 0,
    win_rate      numeric     not null default 0,
    updated_at    timestamptz not null default now()
);

create index if not exists source_credibility_win_rate_idx
    on source_credibility (win_rate desc);

alter table source_credibility enable row level security;
create policy "Public read"   on source_credibility for select using (true);
create policy "Public insert" on source_credibility for insert with check (true);
create policy "Public update" on source_credibility for update using (true);
"""


DEFAULT_WIN_RATE = 0.5  # per the Phase 5 spec — used for unknown sources


# ==========================================================================
# Helpers
# ==========================================================================

def _r4(v):
    if v is None:
        return None
    try:
        return round(float(v), 4)
    except Exception:
        return None


def _preflight_schema() -> bool:
    try:
        supabase.table("source_credibility").select("source").limit(1).execute()
        return True
    except Exception as e:
        logger.error(
            "source_credibility: table missing (%s). "
            "RUN THIS IN SUPABASE SQL EDITOR:\n%s",
            e, SOURCE_CREDIBILITY_DDL,
        )
        return False


def _parse_article_ids(raw) -> list[str]:
    if not raw:
        return []
    if isinstance(raw, list):
        return [str(x) for x in raw if x]
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                return [str(x) for x in parsed if x]
        except Exception:
            return []
    return []


# ==========================================================================
# Aggregation
# ==========================================================================

def aggregate_source_outcomes() -> list[dict]:
    """
    Pull graded theses and their supporting articles, map each source to
    its confirmed / invalidated counts, and build upsert rows.
    """
    resp = (
        supabase.table("theses")
        .select("id, outcome, supporting_articles")
        .not_.is_("outcome", "null")
        .limit(5000)
        .execute()
    )
    theses_rows = resp.data or []
    if not theses_rows:
        return []

    # Collect every article id referenced by any graded thesis
    all_article_ids: set[str] = set()
    per_thesis_ids: dict[str, list[str]] = {}
    for t in theses_rows:
        ids = _parse_article_ids(t.get("supporting_articles"))
        per_thesis_ids[t["id"]] = ids
        all_article_ids.update(ids)

    if not all_article_ids:
        return []

    # Fetch those articles' sources in a single query (chunk to be safe)
    article_source: dict[str, str] = {}
    id_list = list(all_article_ids)
    for i in range(0, len(id_list), 500):
        chunk = id_list[i:i + 500]
        try:
            ar = (
                supabase.table("articles")
                .select("id, source")
                .in_("id", chunk)
                .execute()
            )
            for row in ar.data or []:
                aid = row.get("id")
                src = row.get("source")
                if aid and src:
                    article_source[aid] = src
        except Exception as e:
            logger.warning("source_credibility: article fetch chunk failed: %s", e)

    # Attribute each thesis outcome back to the contributing sources
    stats: dict[str, dict] = defaultdict(
        lambda: {"n_theses": 0, "n_confirmed": 0, "n_invalidated": 0}
    )
    for t in theses_rows:
        outcome = (t.get("outcome") or "").lower()
        seen_sources = set()
        for aid in per_thesis_ids.get(t["id"], []):
            src = article_source.get(aid)
            if not src or src in seen_sources:
                continue
            seen_sources.add(src)
            s = stats[src]
            s["n_theses"] += 1
            if outcome == "confirmed":
                s["n_confirmed"] += 1
            elif outcome == "invalidated":
                s["n_invalidated"] += 1

    now_iso = datetime.now(timezone.utc).isoformat()
    rows = []
    gated_sources = 0
    for src, s in stats.items():
        n = s["n_theses"]
        n_c = s["n_confirmed"]
        n_i = s["n_invalidated"]
        # Gate: skip sources with zero calibration signal (all-inconclusive).
        # Writing them would pollute source_credibility with 0% win_rate rows.
        if n_c + n_i == 0:
            gated_sources += 1
            continue
        win_rate = n_c / (n_c + n_i)  # denominator is signal count, not n_theses
        rows.append({
            "source": src,
            "n_theses": n,
            "n_confirmed": n_c,
            "n_invalidated": n_i,
            "win_rate": _r4(win_rate) or 0.0,
            "updated_at": now_iso,
        })

    if gated_sources and not rows:
        logger.info(
            "source_credibility: gated %d source(s) — zero calibration signal",
            gated_sources,
        )
    return rows


def upsert_sources(rows: list[dict]) -> int:
    if not rows:
        return 0
    try:
        supabase.table("source_credibility").upsert(
            rows, on_conflict="source"
        ).execute()
        return len(rows)
    except Exception as e:
        logger.exception("source_credibility: upsert failed: %s", e)
        return 0


# ==========================================================================
# Read helper consumed by trend_mapper.py
# ==========================================================================

def load_win_rates() -> dict[str, float] | None:
    """
    Return `{source: win_rate}` for every row in source_credibility. Returns
    an empty dict if the table exists but is empty. Returns None if the
    table itself is missing — callers use None as a signal to skip
    weighting entirely rather than applying 0.5 to every cluster on cold
    start.
    """
    try:
        resp = supabase.table("source_credibility").select("source, win_rate").execute()
        out: dict[str, float] = {}
        for r in resp.data or []:
            src = r.get("source")
            wr = r.get("win_rate")
            if src is None:
                continue
            try:
                out[src] = float(wr) if wr is not None else DEFAULT_WIN_RATE
            except Exception:
                out[src] = DEFAULT_WIN_RATE
        return out
    except Exception as e:
        logger.warning("source_credibility: load_win_rates failed: %s", e)
        return None


# ==========================================================================
# main()
# ==========================================================================

def main() -> dict | None:
    try:
        if not _preflight_schema():
            return None
        rows = aggregate_source_outcomes()
        written = upsert_sources(rows)
        print(f"  [source_credibility] sources={len(rows)} upserted={written}")
        logger.info("source_credibility: %d sources upserted", written)
        return {"sources": len(rows), "upserted": written}
    except Exception as e:
        logger.exception("source_credibility.main crashed: %s", e)
        return None


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    main()
